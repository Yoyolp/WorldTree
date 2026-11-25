/**
 * 世界树 · 模型输出协议
 *
 * 模型回复 = 叙事正文 + 一个元数据块：
 *
 *   雾从木板缝隙里渗出来……
 *
 *   <<<WT_META>>>
 *   {"choices": [...], "check": {...}, "state": {...}, "scene": "..."}
 *   <<<END_META>>>
 *
 * 前端流式渲染时剥离该块，服务端解析后落库。
 */

export const META_START = '<<<WT_META>>>';
export const META_END = '<<<END_META>>>';

export interface RawMetaChoice {
  text?: string;
  hint?: string;
  next?: string;
  prompt?: string;
  check?: { skill?: string; difficulty?: string };
}

export interface RawMetaCheck {
  skill?: string;
  difficulty?: string;
  reason?: string;
  bonus?: number;
}

export interface RawMetaState {
  set?: Record<string, unknown>;
  addFlags?: string[];
  removeFlags?: string[];
  sanDelta?: number;
  hpDelta?: number;
  mpDelta?: number;
  luckDelta?: number;
  /** 通用资源增减，如 `{ ac: -1 }`（非 COC 规则书用） */
  resourceDelta?: Record<string, number>;
  addItems?: string[];
  addConditions?: string[];
}

export interface RawMeta {
  choices?: RawMetaChoice[];
  check?: RawMetaCheck | null;
  state?: RawMetaState | null;
  scene?: string;
  summary?: string;
  /** 模型建议的场景切换 */
  goto?: string;
  /** 模型建议触发的事件 id */
  event?: string;
  /** 模型要求一次理智检定 */
  sanCheck?: { successLoss?: string; failLoss?: string };
}

/**
 * 从流式文本中剥离元数据块。
 * 同时处理「起始标记只到达了一半」的情况（例如末尾是 `<<<WT_ME`）。
 */
export function stripMetaStreaming(text: string): string {
  text = hideStreamingThink(text);
  const idx = text.indexOf(META_START);
  if (idx >= 0) return text.slice(0, idx);

  const maxCheck = Math.min(META_START.length - 1, text.length);
  for (let len = maxCheck; len > 0; len--) {
    const tail = text.slice(text.length - len);
    if (META_START.startsWith(tail)) return text.slice(0, text.length - len);
  }

  // 模型没写标记，直接在末尾贴裸 JSON：从「单独成行且像 JSON 的 {」开始隐藏，
  // 避免 JSON 边生成边显示在阅读区
  return stripStreamingJson(text);
}

/** 流式时隐藏正在生成的思考块，并清掉残留标签 */
function hideStreamingThink(text: string): string {
  const open = text.search(/<think\b/i);
  if (open >= 0) {
    const rest = text.slice(open);
    if (!/<\/think>/i.test(rest)) return text.slice(0, open);
  }
  return text.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '').replace(/<\/?think[^>]*>/gi, '');
}

/** 隐藏流式输出末尾正在生成的裸 JSON 块 */
/** 定位「元数据 JSON」的起始花括号：{ 后面紧跟 choices/state/scene 这类键 */
const META_JSON_START = /\{\s*"(choices|state|scene|check|summary|goto)"\s*:/g;

function findMetaJsonStart(text: string): number {
  let found = -1;
  META_JSON_START.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = META_JSON_START.exec(text)) !== null) found = m.index;
  return found;
}

function stripStreamingJson(text: string): string {
  const start = findMetaJsonStart(text);
  if (start < 0) return text;

  // 已经闭合就不动（完整 JSON 交给 splitMetaLoose 处理）
  const tail = text.slice(start);
  if (/\}\s*$/.test(tail)) return text;

  return text.slice(0, start).replace(/\s+$/, '');
}

/* ------------------------------------------------------------------ */
/* 容错：模型常见的三种跑偏                                            */
/*   1. 不写元数据标记，直接在末尾贴裸 JSON                            */
/*   2. 用 `>>> 选项A / 选项B` 这种行内格式给选项                      */
/*   3. 输出被上下文截断，JSON 缺右括号                                */
/* ------------------------------------------------------------------ */

/**
 * 剥掉思考块。Qwen3 / DeepSeek-R1 这类推理模型会把 ` thinking…<｜end▁of▁thinking｜>`
 * 或残留的闭合标签漏进正文；有人还会用 `</think>` 收尾。
 */
export function stripThinkBlocks(text: string): string {
  if (!text) return '';
  return text
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/<think\b[^>]*>[\s\S]*$/gi, '') // 未闭合的思考块：整段丢掉
    .replace(/<\/?think[^>]*>/gi, '')
    .replace(/<\/?reasoning[^>]*>/gi, '')
    .trim();
}

/** 行内选项：`>>> a / b / c` 或 `选项：a / b / c` */
const CHOICE_LINE = /^[ \t]*(?:>{2,}|选项[:：]|choices?[:：])[ \t]*(.+)$/gim;

/**
 * 正文**尾部**的 Markdown 列表项。
 *
 * 小模型经常无视提示词，把选项写成：
 *   - 伸手去抓住那团光
 *   - 蹲下来看掌纹里的冰晶
 * 这种既不是 `>>>` 也不是「选项：」，原来的正则完全匹配不到，
 * 结果就是一串裸列表直接显示给玩家。
 *
 * 这里只在「正文末尾」识别，避免误伤正文中间的描述性列表
 * （比如「你注意到几件事：- 门锁是新的 - 地板有血迹」后面还接着正文的情况）。
 */
const LIST_ITEM = /^[ \t]*([-*•]|\d+[.、)])\s+(.+)$/;

/** 引导句：紧跟在列表前后、明显是「请选择」的话，一并剥掉 */
const LEAD_IN = /^[ \t]*[（(]?\s*(请做出选择|请选择|你的选择|你该怎么做|你要怎么做|接下来)[^\n]*$/;

/**
 * 从正文尾部剥出 Markdown 列表型选项。
 *
 * 策略：从末尾往上扫，收集「连续」的列表行；允许中间夹空行，
 * 也允许列表前一行是「（请做出选择）」这类引导句。
 * 一旦遇到既不是列表、也不是引导句、也不是空行的内容就停止 ——
 * 保证只动尾部，不碰正文。
 */
export function extractTrailingListChoices(text: string): { text: string; choices: string[] } {
  const lines = text.split('\n');

  // 末尾可能有空行，先跳过多余空白再从真正的最后一行开始
  let end = lines.length - 1;
  while (end >= 0 && !lines[end].trim()) end--;
  if (end < 0) return { text, choices: [] };

  const tailChoices: string[] = [];
  let cursor = end;
  /** 已经剥到的最靠前的行号（含） */
  let cutFrom = end + 1;

  // 先允许列表前有一句引导语
  const leadInAt = (idx: number): boolean => idx >= 0 && LEAD_IN.test(lines[idx]);

  while (cursor >= 0) {
    const line = lines[cursor];
    const m = line.match(LIST_ITEM);

    if (m) {
      const bodyText = m[2].trim();
      // 太长的行不像选项（多半是正文里的一句话）
      if (bodyText && bodyText.length <= 60) {
        tailChoices.unshift(bodyText);
        cutFrom = cursor;
        cursor--;
        continue;
      }
      break;
    }

    // 空行：允许列表项之间的空行，继续往上找
    if (!line.trim()) {
      cursor--;
      continue;
    }

    // 引导句：剥掉它，然后继续往上找列表
    if (leadInAt(cursor)) {
      cutFrom = cursor;
      cursor--;
      continue;
    }

    // 其它内容：正文结束，停止
    break;
  }

  // 少于 2 条不认为是选项块（单条 `- xxx` 更可能是正文列表）
  if (tailChoices.length < 2) return { text, choices: [] };

  const kept = lines.slice(0, cutFrom).join('\n').replace(/[ \t]+$/gm, '').trimEnd();
  return { text: kept, choices: tailChoices };
}

/** 从正文里抽出模型自创的行内选项（去掉它们，同时把选项收集起来） */
export function extractChoiceLines(text: string): { text: string; choices: string[] } {
  const choices: string[] = [];
  const cleaned = stripThinkBlocks(text).replace(CHOICE_LINE, (_m, body: string) => {
    for (const piece of String(body).split(/\s*[/|｜]\s*/)) {
      const t = piece.trim().replace(/^[-*\d.、)\s]+/, '');
      if (t && t.length <= 40) choices.push(t);
    }
    return '';
  });
  let tidy = cleaned.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  // 再处理 Markdown 列表型选项（只在尾部）
  const trailing = extractTrailingListChoices(tidy);
  if (trailing.choices.length) {
    tidy = trailing.text.replace(/\n{3,}/g, '\n\n').trim();
    choices.push(...trailing.choices);
  }

  return { text: tidy, choices };
}

/** 补全被截断的 JSON：补齐未闭合的字符串与括号（不猜缺省字段） */
export function repairTruncatedJson(input: string): string | null {
  const s = input.trim();
  const first = s.indexOf('{');
  if (first < 0) return null;

  let body = s.slice(first);
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }

  if (inString) body += '"';
  // 砍掉尾部半截的 `"key": ` 或多余的逗号
  body = body.replace(/,\s*"[^"]*"\s*:\s*$/, '').replace(/,\s*$/, '');
  body = body.replace(/"\s*:\s*$/, '');
  body = body.replace(/,\s*$/, '');

  for (let i = stack.length - 1; i >= 0; i--) body += stack[i] === '{' ? '}' : ']';

  try {
    JSON.parse(body);
    return body;
  } catch {
    return null;
  }
}

/** 末尾是否已经出现「看起来像元数据」的 JSON */
function findTrailingJson(raw: string): { start: number; json: string } | null {
  const start = findMetaJsonStart(raw);
  if (start < 0) return null;

  const tail = raw.slice(start);
  if (tail.length < 20) return null;

  return { start, json: tail };
}

/** 尽力解析一段元数据 JSON：完整 → 截取花括号 → 补齐残缺括号 */
export function parseMetaJsonLoose(jsonPart: string): RawMeta | null {
  const trimmed = jsonPart
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as RawMeta;
  } catch {
    /* 继续 */
  }

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1)) as RawMeta;
    } catch {
      /* 继续 */
    }
  }

  // 本地补齐：模型输出被截断时（最常见的失败），不用再发一次修复请求
  const repaired = repairTruncatedJson(trimmed);
  if (repaired) {
    try {
      return JSON.parse(repaired) as RawMeta;
    } catch {
      /* 放弃 */
    }
  }
  return null;
}

/**
 * 把 `>>>` 行内选项补进 meta。
 *
 * 小模型经常不写 `<<<WT_META>>>`，而是直接在正文末尾用 `>>> 行动A` 列选项。
 * `extractChoiceLines` 能把这些行剥出来，但过去只用了它清干净的正文，
 * 抽出的选项被直接丢掉 —— 结果就是「模型明明给了选项，界面一个都没有」。
 *
 * 这里把它们包成标准 meta.choices（纯文本，没有 check / next）。
 * 如果 meta 里已经有结构化选项，则以结构化的为准，不覆盖。
 */
function mergeInlineChoices(meta: RawMeta | null, inline: string[]): RawMeta | null {
  if (!inline.length) return meta;
  if (meta?.choices?.length) return meta;
  return {
    ...(meta ?? {}),
    choices: inline.map((text) => ({ text })),
  };
}

/**
 * 容错解析：优先认标准标记；没有标记时尝试从尾部抓裸 JSON，
 * 并剥离模型自创的 `>>>` 行内选项（同时把它们保留为 meta.choices）。
 */
export function splitMetaLoose(raw: string): {
  text: string;
  meta: RawMeta | null;
  /** 解析是否走了兜底路径（用于监控与提示） */
  recovered: boolean;
  /** 模型没写结束标记，元数据是补齐救回来的 */
  truncated: boolean;
} {
  const strict = splitMetaStrict(raw);
  if (strict.meta) {
    const cleaned = extractChoiceLines(strict.text);
    return {
      text: cleaned.text,
      meta: mergeInlineChoices(strict.meta, cleaned.choices),
      recovered: false,
      truncated: strict.truncated,
    };
  }

  // 标记写了但 JSON 没写完：标记之后的全部内容都要切掉，绝不显示给玩家。
  // 先试本地补齐 —— 截断的 JSON 多数能救回来，就不必再花一次模型请求。
  const markerAt = raw.indexOf(META_START);
  if (markerAt >= 0) {
    const body = raw.slice(markerAt + META_START.length);
    const endAt = body.indexOf(META_END);
    const jsonPart = endAt >= 0 ? body.slice(0, endAt) : body;
    const salvaged = parseMetaJsonLoose(jsonPart);
    const cleaned = extractChoiceLines(raw.slice(0, markerAt));
    return {
      text: cleaned.text,
      meta: mergeInlineChoices(salvaged, cleaned.choices),
      recovered: true,
      truncated: endAt < 0,
    };
  }

  // 兜底一：没有标记，但末尾有裸 JSON
  const trailing = findTrailingJson(raw);
  if (trailing) {
    const candidate = trailing.json;
    let parsed: RawMeta | null = null;
    const textPart = raw.slice(0, trailing.start);

    for (const attempt of [candidate, repairTruncatedJson(candidate)]) {
      if (!attempt) continue;
      try {
        parsed = JSON.parse(attempt) as RawMeta;
        break;
      } catch {
        /* 继续尝试 */
      }
    }

    if (parsed) {
      const cleaned = extractChoiceLines(textPart);
      return {
        text: cleaned.text,
        meta: mergeInlineChoices(parsed, cleaned.choices),
        recovered: true,
        truncated: false,
      };
    }

    // 解析不出来：至少把这段 JSON 从正文里切掉，别让它显示给玩家
    const cleaned = extractChoiceLines(textPart);
    return {
      text: cleaned.text,
      meta: mergeInlineChoices(null, cleaned.choices),
      recovered: true,
      truncated: false,
    };
  }

  // 兜底二：整段都是正文，只清理行内选项
  const cleaned = extractChoiceLines(raw);
  return {
    text: cleaned.text,
    meta: mergeInlineChoices(null, cleaned.choices),
    recovered: false,
    truncated: false,
  };
}

/** 兼容旧调用：容错解析（可能带 recovered 标记） */
export function splitMeta(raw: string): ReturnType<typeof splitMetaLoose> {
  return splitMetaLoose(raw);
}

/** 严格模式：只认标准标记 */
export function splitMetaStrict(raw: string): {
  text: string;
  meta: RawMeta | null;
  truncated: boolean;
} {
  const start = raw.indexOf(META_START);
  if (start < 0) return { text: raw.trim(), meta: null, truncated: false };

  const text = raw.slice(0, start).trim();
  const rest = raw.slice(start + META_START.length);
  const end = rest.indexOf(META_END);
  const jsonPart = end >= 0 ? rest.slice(0, end) : rest;

  return { text, meta: parseMetaJsonLoose(jsonPart), truncated: end < 0 };
}

/**
 * 估算 token 数。
 *
 * 中文按 **1 字 1 token** 估（Qwen/Llama 系实测约 1.1~1.4 字/token）。
 * 宁可高估：低估会让提示词静默超窗，被服务端从**头部**截掉，
 * 表现就是模型失忆、输出写到一半断掉 —— 比「历史被裁短几轮」严重得多。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) > 0x2e80) cjk++;
  }
  return Math.ceil(cjk + (text.length - cjk) / 4);
}

/** 生成短 id */
export function shortId(prefix = ''): string {
  const s = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  return prefix ? `${prefix}_${s}` : s;
}

/** 可复现随机数（mulberry32） */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
