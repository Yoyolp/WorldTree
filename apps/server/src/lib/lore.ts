/**
 * 世界书扫描（对齐 SillyTavern World Info 语义）
 *
 * 流程：
 *  1. 取最近 scanDepth 条消息拼成扫描窗口
 *  2. 逐条目做关键词匹配（主关键词 + 选择性逻辑的次关键词）
 *  3. 常驻条目直接入选
 *  4. 概率判定（useProbability）
 *  5. 分组去重（同组只留一个）
 *  6. 按优先级排序，在 tokenBudget 内注入
 */

import type { WorldBook, WorldBookEntry } from '@worldtree/shared';
import type { Rng } from '@worldtree/shared';

export interface LoreHit {
  entry: WorldBookEntry;
  matched: string[];
  reason: 'constant' | 'keyword' | 'secondary';
  /** 概率判定结果 */
  rolled?: number;
  /** 本期由 sticky 续命注入（不掷概率） */
  sticky?: boolean;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function testKey(text: string, key: string, entry: WorldBookEntry): boolean {
  const k = key.trim();
  if (!k) return false;

  if (entry.useRegex) {
    try {
      return new RegExp(k, entry.caseSensitive ? '' : 'i').test(text);
    } catch {
      return false;
    }
  }

  if (entry.matchWholeWords) {
    // 中文按子串，英文按词边界
    const isAscii = /^[\w\s-]+$/.test(k);
    if (isAscii) {
      const re = new RegExp(`\\b${escapeRegex(k)}\\b`, entry.caseSensitive ? '' : 'i');
      return re.test(text);
    }
  }

  return entry.caseSensitive ? text.includes(k) : text.toLowerCase().includes(k.toLowerCase());
}

/** 单条目匹配 */
function matchEntry(text: string, entry: WorldBookEntry): LoreHit | null {
  if (!entry.enabled) return null;
  if (entry.constant) return { entry, matched: [], reason: 'constant' };

  const matched = entry.keys.filter((k) => testKey(text, k, entry));
  if (!matched.length) return null;

  // 有次关键词且启用了 selective 时按逻辑判定
  if (entry.selective && entry.secondaryKeys.length) {
    const secMatched = entry.secondaryKeys.some((k) => testKey(text, k, entry));
    let pass = false;
    switch (entry.selectiveLogic) {
      case 'and':
        pass = secMatched;
        break;
      case 'or':
        pass = true;
        break;
      case 'not':
        pass = !secMatched;
        break;
    }
    if (!pass) return null;
    return { entry, matched: [...matched, ...(secMatched ? entry.secondaryKeys.filter((k) => testKey(text, k, entry)) : [])], reason: 'secondary' };
  }

  return { entry, matched, reason: 'keyword' };
}

export interface ScanOptions {
  book: WorldBook | undefined | null;
  /** 需要扫描的文本，从新到旧 */
  texts: string[];
  rng?: Rng;
  /** 已触发的条目 id → 剩余冷却回合（跨回合状态，由调用方持久化） */
  cooldowns?: Record<string, number>;
  /** 正在「粘住」的条目 id → 剩余回合（sticky 生效期间无条件注入） */
  sticky?: Record<string, number>;
}

export interface ScanResult {
  hits: LoreHit[];
  /** 扫描后应写回的冷却表 */
  cooldowns: Record<string, number>;
  /** 扫描后应写回的粘滞表 */
  sticky: Record<string, number>;
}

/**
 * 扫描世界书，返回本次应注入的条目。
 *
 * 与 SillyTavern 的对齐点：
 *  - constant 常驻条目无视关键词
 *  - probability 概率判定
 *  - group 同组只取优先级最高的一个
 *  - cooldown 触发后 N 回合内不再注入
 *  - sticky 触发后 N 回合内无条件注入
 *  - recursiveScanning 命中的内容再参与下一轮关键词扫描
 *  - at_depth 的条目按 depth 插进历史（由调用方 renderDepthLore 使用）
 */
export function scanWorldBook(opts: ScanOptions): ScanResult {
  const { book } = opts;
  if (!book || !book.entries.length) {
    return { hits: [], cooldowns: { ...(opts.cooldowns ?? {}) }, sticky: { ...(opts.sticky ?? {}) } };
  }

  const rng = opts.rng ?? Math.random;
  const window = opts.texts.slice(0, Math.max(1, book.scanDepth || 6)).join('\n');

  // 进来的冷却表：本回合还要先减 1（上一回合结束时写的值）
  const cooldowns: Record<string, number> = {};
  for (const [k, v] of Object.entries(opts.cooldowns ?? {})) {
    const left = Number(v) - 1;
    if (left > 0) cooldowns[k] = left;
  }
  const sticky: Record<string, number> = {};
  for (const [k, v] of Object.entries(opts.sticky ?? {})) {
    const left = Number(v) - 1;
    if (left > 0) sticky[k] = left;
  }

  /** 本轮命中（先按单轮算，递归时再迭代） */
  const collect = (text: string, skip: Set<string>): LoreHit[] => {
    const out: LoreHit[] = [];
    for (const entry of book.entries) {
      if (skip.has(entry.id)) continue;
      const hit = matchEntry(text, entry);
      if (!hit) continue;
      out.push(hit);
    }
    return out;
  };

  let pool = collect(window, new Set());
  const seen = new Set(pool.map((h) => h.entry.id));

  // 递归扫描：把命中条目的正文当作新文本再扫一遍
  if (book.recursiveScanning) {
    let frontier = pool;
    for (let depth = 0; depth < 3 && frontier.length; depth++) {
      const extraText = frontier.map((h) => h.entry.content).join('\n');
      const more = collect(extraText, seen).filter((h) => !h.entry.constant);
      for (const h of more) seen.add(h.entry.id);
      if (!more.length) break;
      pool = [...pool, ...more];
      frontier = more;
    }
  }

  // 粘滞：上回合触发的条目这几回合无条件注入
  for (const entry of book.entries) {
    if (sticky[entry.id] && !seen.has(entry.id)) {
      pool.push({ entry, matched: [], reason: 'constant', sticky: true });
      seen.add(entry.id);
    }
  }

  const raw: LoreHit[] = [];
  for (const hit of pool) {
    const entry = hit.entry;

    // 冷却中：这一回合不注入
    if (cooldowns[entry.id]) continue;

    // 概率判定（常驻 / 粘滞不掷）
    if (!entry.constant && !hit.sticky && entry.useProbability && entry.probability < 100) {
      const roll = rng() * 100;
      hit.rolled = Number(roll.toFixed(1));
      if (roll >= entry.probability) continue;
    }
    raw.push(hit);
  }

  // 分组：同组只保留优先级最高的一个
  const groups = new Map<string, LoreHit>();
  const ungrouped: LoreHit[] = [];
  for (const hit of raw) {
    const g = hit.entry.group?.trim();
    if (!g) {
      ungrouped.push(hit);
      continue;
    }
    const prev = groups.get(g);
    if (!prev) {
      groups.set(g, hit);
      continue;
    }
    const prevScore = (prev.entry.constant ? 1000 : 0) + prev.entry.priority;
    const newScore = (hit.entry.constant ? 1000 : 0) + hit.entry.priority;
    if (newScore > prevScore) groups.set(g, hit);
  }

  // 排序：常驻优先，再看 priority / insertionOrder
  const hits = [...ungrouped, ...groups.values()].sort((a, b) => {
    if (a.reason === 'constant' && b.reason !== 'constant') return -1;
    if (b.reason === 'constant' && a.reason !== 'constant') return 1;
    if (b.entry.priority !== a.entry.priority) return b.entry.priority - a.entry.priority;
    return a.entry.insertionOrder - b.entry.insertionOrder;
  });

  // 预算裁剪
  const budget = book.tokenBudget > 0 ? book.tokenBudget : 4000;
  const kept: LoreHit[] = [];
  let used = 0;
  for (const hit of hits) {
    const max = hit.entry.maxChars > 0 ? hit.entry.maxChars : Infinity;
    const cost = Math.min(hit.entry.content.length, max);
    if (used + cost > budget) continue;
    used += cost;
    kept.push(hit);
  }

  // 写回冷却与粘滞：本次注入的条目按定义挂上
  for (const hit of kept) {
    const e = hit.entry;
    if (e.cooldown > 0) cooldowns[e.id] = e.cooldown;
    if (e.sticky > 0) sticky[e.id] = e.sticky;
  }

  return { hits: kept, cooldowns, sticky };
}

/** 渲染成提示词片段，按 position 分组 */
export function renderLore(hits: LoreHit[], position: 'before_char' | 'after_char' | 'at_depth' = 'before_char'): string {
  const list = hits.filter((h) => (h.entry.position ?? 'before_char') === position);
  if (!list.length) return '';
  const body = list
    .map((h) => {
      const cap = h.entry.maxChars > 0 ? h.entry.maxChars : undefined;
      return `【${h.entry.comment || h.entry.keys[0] || '设定'}】\n${cap ? h.entry.content.slice(0, cap) : h.entry.content}`;
    })
    .join('\n\n');
  return `<世界书>\n${body}\n</世界书>`;
}

/** 深度注入条目（at_depth） */
export function renderDepthLore(hits: LoreHit[]): string {
  return renderLore(hits, 'at_depth');
}
