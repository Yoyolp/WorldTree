/**
 * 世界树 · 剧本 Markdown DSL
 *
 * 设计目标：人写友好、可 git diff、可让 AI 生成，编译成 JSON 节点图供引擎消费。
 *
 * ── 文件结构 ──────────────────────────────────────────────
 *
 *   ---
 *   id: last-train
 *   title: 末班列车
 *   rulePack: coc7
 *   ---
 *
 *   # 第一节车厢 {id=car1}
 *
 *   你从座位上惊醒，车厢空无一人。
 *
 *   ::: director
 *   建立诡异但不恐怖的气氛，强调广播声音的不自然。
 *   :::
 *
 *   ::: event 广播 once chance=35%
 *   广播响了：「本次列车不设终点站。」
 *   :::
 *
 *   ::: on-enter
 *   flag: 上车
 *   san: -1
 *   :::
 *
 *   - [留在原地] -> 座位下
 *   - [走向第三节] -> 第三节 {check=侦查 常规}
 *   - [拉开车门] -> 雪原 {san=-1d3 flag=鲁莽}
 *
 *   ## 座位下 {id=seat}
 *   ---
 *
 * ── 语法速查 ──────────────────────────────────────────────
 *
 *   标题          # 标题 {id=xxx}            定义节点
 *   正文          普通 Markdown 段落          即节点 content
 *   结束节点      {ending=结局标题}           标记结局
 *   :::director   导演备注（只给 AI）
 *   :::event      内嵌事件   ::: event 名称 [once] [chance=30%] [cooldown=3]
 *   :::on-enter   进入节点时的效果
 *   ---           分隔线，等同于 node 边界（可选）
 *   - [选项文本] -> 目标节点 {check=技能 难度} {san=-1} {flag=x} {var:k=v}
 *
 * 全局事件写在文末：
 *   ::: world-events
 *   ## fog_horn 雾中汽笛
 *   - trigger: turn_end
 *   - chance: 25%
 *   - cooldown: 3
 *   - when: flag=见过守门人
 *   - narrative: 雾里传来汽笛……
 *   - san: -1
 *   :::
 */

import type {
  CheckDifficulty,
  GameEvent,
  RulePackId,
  ScriptChoice,
  ScriptEffect,
  ScriptNode,
  StoryScript,
} from './types.js';

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function toId(raw: string, fallbackIndex: number): string {
  const t = raw.trim();
  if (!t) return `node-${fallbackIndex + 1}`;
  if (/^[\w-]+$/.test(t)) return t;
  return slug(t) || `node-${fallbackIndex + 1}`;
}

/** 解析 `{key=value key2="value 2"}` 形式的属性 */
function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w-]+)\s*=\s*("([^"]*)"|'([^']*)'|[^\s}]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    out[m[1]] = m[3] ?? m[4] ?? m[2];
  }
  return out;
}

/** 解析 front-matter */
function parseFrontMatter(src: string): { meta: Record<string, string>; body: string } {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: src };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      meta[line.slice(0, idx).trim()] = line
        .slice(idx + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
    }
  }
  return { meta, body: src.slice(m[0].length) };
}

const DIFFICULTY_MAP: Record<string, CheckDifficulty> = {
  常规: 'regular',
  normal: 'regular',
  regular: 'regular',
  困难: 'hard',
  hard: 'hard',
  极难: 'extreme',
  extreme: 'extreme',
};

function parseDifficulty(raw?: string): CheckDifficulty {
  if (!raw) return 'regular';
  return DIFFICULTY_MAP[raw.trim().toLowerCase()] ?? DIFFICULTY_MAP[raw.trim()] ?? 'regular';
}

/** 解析 `{check=侦查 常规 san=-1d3 flag=鲁莽 var:线索=铅哨}` */
function parseChoiceAttrs(raw: string): {
  check?: ScriptChoice['check'];
  effect: ScriptEffect;
  req: Partial<ScriptChoice>;
} {
  const attrs = parseAttrs(raw);
  const effect: ScriptEffect = {};
  const req: Partial<ScriptChoice> = {};
  let check: ScriptChoice['check'];
  let relMin: number | undefined;
  let relMax: number | undefined;
  let relTarget: string | undefined;

  // check=技能 难度：难度是裸词，parseAttrs 抓不到，这里单独扫
  const checkMatch = raw.match(/check\s*=\s*([^\s{}]+)(?:\s+(常规|困难|极难|regular|hard|extreme))?/i);
  if (checkMatch) {
    check = { skill: checkMatch[1], difficulty: parseDifficulty(checkMatch[2]) };
  }

  for (const [key, value] of Object.entries(attrs)) {
    switch (key) {
      case 'check': {
        // 已由上面的正则精确解析（含难度），此处只兜底没有难度的写法
        if (!check) {
          const [skill, diff] = value.split(/\s+/);
          if (skill) check = { skill, difficulty: parseDifficulty(diff) };
        }
        break;
      }
      case 'san':
        effect.sanDelta = numeric(value);
        break;
      case 'hp':
        effect.hpDelta = numeric(value);
        break;
      case 'mp':
        effect.mpDelta = numeric(value);
        break;
      case 'luck':
        effect.luckDelta = numeric(value);
        break;
      case 'flag':
        effect.addFlags = [...(effect.addFlags ?? []), value];
        break;
      case 'unflag':
        effect.removeFlags = [...(effect.removeFlags ?? []), value];
        break;
      case 'item':
        effect.addItems = [...(effect.addItems ?? []), value];
        break;
      case 'condition':
        effect.addConditions = [...(effect.addConditions ?? []), value];
        break;
      case 'goto':
        effect.goto = value;
        break;
      // 条件：require=flag:xxx / ability:名 / legacy:标记 / rel:目标
      case 'require': {
        const [kind, ...rest] = value.split(':');
        const arg = rest.join(':');
        if (kind === 'flag') req.requireFlag = arg;
        else if (kind === 'ability') req.requireAbility = arg;
        else if (kind === 'legacy') req.requireLegacyFlag = arg;
        else if (kind === 'rel') relTarget = arg;
        break;
      }
      case 'forbid': {
        const [kind, ...rest] = value.split(':');
        const arg = rest.join(':');
        if (kind === 'flag') req.forbidFlag = arg;
        break;
      }
      case 'min':
        relMin = numeric(value);
        break;
      case 'max':
        relMax = numeric(value);
        break;
      default:
        // var:xxx=值
        if (key.startsWith('var:') || key.startsWith('var-')) {
          const k = key.slice(4);
          effect.vars = { ...(effect.vars ?? {}), [k]: value };
        }
    }
  }

  if (relTarget) {
    req.requireRelationship = { target: relTarget, min: relMin, max: relMax };
  }

  return { check, effect: Object.keys(effect).length ? effect : {}, req };
}

/** 支持 "-1d3"、"+2"、"3" 这类写法（求值在引擎里做，这里保留表达式） */
function numeric(raw: string): number {
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : 0;
}

/* ------------------------------------------------------------------ */
/* 事件块解析                                                          */
/* ------------------------------------------------------------------ */

function parseEventBlock(header: string, body: string, nodeId?: string): GameEvent {
  // header: "event 广播 once chance=35% cooldown=3"
  const parts = header.replace(/^event\s+/, '').trim().split(/\s+/);
  const name = parts[0] ?? '事件';
  const flags = parts.slice(1);

  let once = false;
  let chance = 1;
  let cooldown = 0;
  let priority = 50;
  let trigger: GameEvent['trigger'] = nodeId ? 'enter_node' : 'turn_end';
  let sanCheck: GameEvent['sanCheck'];

  const parseSan = (raw: string): GameEvent['sanCheck'] | undefined => {
    const v = raw.trim();
    if (!v) return undefined;
    const [a, b] = v.split('/');
    if (b === undefined) return { failLoss: a || '1d6' };
    return { successLoss: a || '0', failLoss: b || '1d6' };
  };

  for (const f of flags) {
    if (f === 'once') once = true;
    else if (f.startsWith('chance=')) {
      const v = f.slice(7);
      chance = v.endsWith('%') ? Number(v.slice(0, -1)) / 100 : Number(v);
      if (!Number.isFinite(chance)) chance = 1;
    } else if (f.startsWith('cooldown=')) cooldown = Number(f.slice(9)) || 0;
    else if (f.startsWith('priority=')) priority = Number(f.slice(9)) || 50;
    else if (f.startsWith('trigger=')) trigger = f.slice(8) as GameEvent['trigger'];
    else if (f.startsWith('sanCheck=')) sanCheck = parseSan(f.slice(9));
  }

  // body 里可用 `- key: value` 覆盖
  const lines = body.split(/\r?\n/);
  const narrativeLines: string[] = [];
  const conditions: GameEvent['conditions'] = [];
  const state: NonNullable<GameEvent['state']> = {};
  let notice: string | undefined;

  for (const line of lines) {
    const m = line.match(/^\s*-\s*([\w-]+)\s*:\s*(.+)$/);
    if (!m) {
      narrativeLines.push(line);
      continue;
    }
    const [, k, v] = m;
    switch (k) {
      case 'sanCheck': {
        sanCheck = parseSan(v);
        break;
      }
      case 'chance': {
        const raw = v.trim();
        chance = raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw);
        break;
      }
      case 'cooldown':
        cooldown = Number(v) || 0;
        break;
      case 'priority':
        priority = Number(v) || 50;
        break;
      case 'trigger':
        trigger = v.trim() as GameEvent['trigger'];
        break;
      case 'when': {
        // when: flag=xxx / san<30 / node=yyy
        const c = parseConditionString(v.trim());
        if (c) conditions.push(c);
        break;
      }
      case 'notice':
        notice = v.trim();
        break;
      case 'san':
        state.sanDelta = numeric(v);
        break;
      case 'hp':
        state.hpDelta = numeric(v);
        break;
      case 'mp':
        state.mpDelta = numeric(v);
        break;
      case 'luck':
        state.luckDelta = numeric(v);
        break;
      case 'flag':
        state.addFlags = [...(state.addFlags ?? []), v.trim()];
        break;
      case 'item':
        state.addItems = [...(state.addItems ?? []), v.trim()];
        break;
      case 'goto':
        // goto 由调用方处理
        break;
      case 'narrative':
        narrativeLines.push(v);
        break;
      default:
        narrativeLines.push(line);
    }
  }

  return {
    id: `evt_${slug(name)}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    scope: nodeId ? 'node' : 'world',
    nodeId,
    enabled: true,
    once,
    chance,
    cooldown,
    priority,
    trigger,
    conditions,
    narrative: narrativeLines.join('\n').trim(),
    notice,
    sanCheck,
    state: Object.keys(state).length ? state : undefined,
  };
}

function parseConditionString(raw: string): GameEvent['conditions'][number] | null {
  const m = raw.match(/^([\w-]+)\s*(>=|<=|>|<|=|!=)\s*(.+)$/);
  if (!m) {
    if (raw.startsWith('flag=')) return { type: 'flag', op: 'has', value: raw.slice(5) };
    if (raw.startsWith('!flag=')) return { type: 'flag', op: 'not', value: raw.slice(6) };
    return null;
  }
  const [, key, op, value] = m;
  const cmp = op === '=' ? 'eq' : op === '!=' ? 'neq' : op === '>' ? 'gt' : op === '<' ? 'lt' : op === '>=' ? 'gte' : 'lte';

  if (key === 'flag') return { type: 'flag', op: 'has', value };
  if (key === 'san' || key === 'hp' || key === 'mp' || key === 'luck') {
    return { type: 'stat', stat: key, op: cmp, value: Number(value) };
  }
  if (key === 'node') return { type: 'node', nodeId: value };
  return { type: 'var', key, op: cmp, value: Number.isFinite(Number(value)) ? Number(value) : value };
}

/* ------------------------------------------------------------------ */
/* 主解析器                                                            */
/* ------------------------------------------------------------------ */

export interface ParseOptions {
  /** 文件名，用于生成 id */
  filename?: string;
  /** 默认规则包 */
  defaultRulePack?: RulePackId;
}

/**
 * 把 Markdown DSL 编译成 StoryScript。
 * 出错时返回 errors，script 仍尽量产出（部分可用），便于编辑器实时预览。
 */
export function compileScript(markdown: string, options: ParseOptions = {}): {
  script: StoryScript | null;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { meta, body } = parseFrontMatter(markdown);
  const baseId = meta.id || (options.filename ? slug(options.filename.replace(/\.md$/, '')) : 'script');

  const nodes: ScriptNode[] = [];
  const worldEvents: GameEvent[] = [];
  let current: ScriptNode | null = null;
  let currentIndex = 0;

  // 状态：是否在某个 block 内
  type BlockKind = 'director' | 'event' | 'on-enter' | 'world-events';
  let block: { kind: BlockKind; header: string; lines: string[] } | null = null;

  const flush = () => {
    if (!block) return;
    const text = block.lines.join('\n').trim();

    if (block.kind === 'director' && current) {
      current.directorNote = text;
    } else if (block.kind === 'event') {
      const ev = parseEventBlock(block.header, text, current?.id);
      if (current) current.events.push(ev);
      else worldEvents.push(ev);
    } else if (block.kind === 'on-enter' && current) {
      const effect: ScriptEffect = {};
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*-\s*([\w-]+)\s*:\s*(.+)$/) ?? line.match(/^\s*([\w-]+)\s*:\s*(.+)$/);
        if (!m) continue;
        const [, k, v] = m;
        switch (k) {
          case 'san':
            effect.sanDelta = numeric(v);
            break;
          case 'hp':
            effect.hpDelta = numeric(v);
            break;
          case 'mp':
            effect.mpDelta = numeric(v);
            break;
          case 'flag':
            effect.addFlags = [...(effect.addFlags ?? []), v.trim()];
            break;
          case 'item':
            effect.addItems = [...(effect.addItems ?? []), v.trim()];
            break;
          case 'var':
            effect.vars = { ...(effect.vars ?? {}), ...parseAttrs(v) };
            break;
          case 'goto':
            effect.goto = v.trim();
            break;
        }
      }
      current.onEnter = effect;
    } else if (block.kind === 'world-events') {
      // 文末全局事件：以 `## id 名称` 分组
      let cur: { header: string; lines: string[] } | null = null;
      for (const line of block.lines) {
        const h = line.match(/^#{1,4}\s+(.+)$/);
        if (h) {
          if (cur) worldEvents.push(parseEventBlock(cur.header, cur.lines.join('\n').trim()));
          cur = { header: `event ${h[1]}`, lines: [] };
        } else if (cur) {
          cur.lines.push(line);
        }
      }
      if (cur) worldEvents.push(parseEventBlock(cur.header, cur.lines.join('\n').trim()));
    }

    block = null;
  };

  const lines = body.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    /* --- block 开始 / 结束 --- */
    const blockStart = line.match(/^:::\s*([\w-]+)(.*)$/);
    if (blockStart) {
      flush();
      const kind = blockStart[1];
      if (kind === 'director' || kind === 'event' || kind === 'on-enter' || kind === 'world-events') {
        block = {
          kind,
          header: `${kind === 'event' ? 'event ' : ''}${blockStart[2].trim()}`,
          lines: [],
        };
      } else {
        warnings.push(`未知的块标记 ::: ${kind}（第 ${i + 1} 行），已忽略`);
      }
      continue;
    }
    if (line.trim() === ':::') {
      flush();
      continue;
    }
    if (block) {
      block.lines.push(line);
      continue;
    }

    /* --- 标题 = 新节点 --- */
    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (heading) {
      const raw = heading[1].trim();
      const attrMatch = raw.match(/^(.*?)\s*\{([^}]*)\}\s*$/);
      const title = (attrMatch ? attrMatch[1] : raw).trim();
      const attrs = attrMatch ? parseAttrs(attrMatch[2]) : {};

      currentIndex++;
      const node: ScriptNode = {
        id: toId(attrs.id ?? '', currentIndex - 1),
        title,
        content: '',
        choices: [],
        events: [],
        ending: attrs.ending !== undefined || attrs.end === 'true',
        endingTitle: attrs.ending && attrs.ending !== 'true' ? attrs.ending : undefined,
      };
      nodes.push(node);
      current = node;
      continue;
    }

    /* --- 分隔线也可作为节点边界 --- */
    if (/^---+$/.test(line.trim()) && current) {
      current = null;
      continue;
    }

    /* --- 选项行（支持多个 {..} 属性组） --- */
    const choiceMatch = line.match(/^\s*[-*]\s*\[(.+?)\]\s*(?:->\s*([^{\s]+))?\s*((?:\{[^}]*\}\s*)*)$/);
    if (choiceMatch && current) {
      const [, textRaw, target, attrsRaw] = choiceMatch;
      const combined = (attrsRaw ?? '').replace(/[{}]/g, ' ');
      const { check, effect, req } = attrsRaw
        ? parseChoiceAttrs(combined)
        : { effect: {} as ScriptEffect, req: {} as Partial<ScriptChoice> };
      current.choices.push({
        id: `c_${current.choices.length + 1}`,
        text: textRaw.trim(),
        next: target?.trim() || undefined,
        check,
        ...req,
        effects: Object.keys(effect).length ? effect : undefined,
      });
      continue;
    }

    /* --- 普通正文 --- */
    if (current) {
      current.content += (current.content ? '\n' : '') + line;
    } else if (line.trim()) {
      warnings.push(`第 ${i + 1} 行的内容在节点之外，已忽略：${line.trim().slice(0, 30)}`);
    }
  }
  flush();

  /* --- 后处理 --- */
  for (const n of nodes) {
    n.content = n.content.trim();
    if (!n.content) warnings.push(`节点「${n.title}」正文为空`);
  }

  // 清理未定义的选项目标
  // 支持用「节点标题」引用目标（手写更自然），找不到 id 时按标题回落到 id
  const ids = new Set(nodes.map((n) => n.id));
  const byTitle = new Map<string, string>();
  for (const n of nodes) {
    if (!byTitle.has(n.title)) byTitle.set(n.title, n.id);
  }

  const resolveTarget = (raw: string): string => {
    const t = raw.trim();
    if (ids.has(t)) return t;
    const byName = byTitle.get(t);
    if (byName) return byName;
    // 尝试宽松匹配：去掉空格与标点
    const norm = (s: string) => s.replace(/[\s·・、,，。:：]/g, '');
    const target = norm(t);
    for (const n of nodes) {
      if (norm(n.title) === target) return n.id;
    }
    return t;
  };

  for (const n of nodes) {
    for (const c of n.choices) {
      if (c.next) c.next = resolveTarget(c.next);
      if (c.effects?.goto) c.effects.goto = resolveTarget(c.effects.goto);
    }
  }

  for (const n of nodes) {
    for (const c of n.choices) {
      if (c.next && !ids.has(c.next)) {
        errors.push(`节点「${n.title}」的选项「${c.text}」指向不存在的节点：${c.next}`);
      }
    }
  }

  if (!nodes.length) {
    errors.push('没有解析出任何节点。节点用 `# 标题 {id=xxx}` 定义。');
    return { script: null, errors, warnings };
  }
  if (!nodes.some((n) => n.ending)) {
    warnings.push('剧本没有结局节点（用 `{ending=结局名}` 标记）');
  }

  const script: StoryScript = {
    id: baseId,
    title: meta.title ?? baseId,
    startNodeId: meta.start ? toId(meta.start, 0) : nodes[0].id,
    rulePackId: (meta.rulePack as RulePackId) || options.defaultRulePack || 'coc7',
    nodes,
    events: worldEvents,
  };

  if (!ids.has(script.startNodeId)) {
    errors.push(`起始节点不存在：${script.startNodeId}，已回落到第一个节点`);
    script.startNodeId = nodes[0].id;
  }

  return { script, errors, warnings };
}

/* ------------------------------------------------------------------ */
/* 反向序列化：JSON → Markdown                                         */
/* ------------------------------------------------------------------ */

export function serializeScript(script: StoryScript): string {
  const out: string[] = [];

  out.push('---');
  out.push(`id: ${script.id}`);
  out.push(`title: ${script.title}`);
  out.push(`start: ${script.startNodeId}`);
  out.push(`rulePack: ${script.rulePackId}`);
  out.push('---');
  out.push('');

  for (const node of script.nodes) {
    const attrs: string[] = [`id=${node.id}`];
    if (node.ending) attrs.push(`ending=${node.endingTitle ?? 'true'}`);
    out.push(`# ${node.title} {${attrs.join(' ')}}`);
    out.push('');
    if (node.content) {
      out.push(node.content);
      out.push('');
    }

    if (node.directorNote) {
      out.push('::: director');
      out.push(node.directorNote);
      out.push(':::');
      out.push('');
    }

    if (node.onEnter) {
      out.push('::: on-enter');
      const e = node.onEnter;
      if (e.sanDelta) out.push(`san: ${e.sanDelta}`);
      if (e.hpDelta) out.push(`hp: ${e.hpDelta}`);
      if (e.mpDelta) out.push(`mp: ${e.mpDelta}`);
      for (const f of e.addFlags ?? []) out.push(`flag: ${f}`);
      for (const it of e.addItems ?? []) out.push(`item: ${it}`);
      out.push(':::');
      out.push('');
    }

    for (const ev of node.events) {
      out.push(`::: event ${ev.name}${ev.once ? ' once' : ''} chance=${Math.round(ev.chance * 100)}%${ev.cooldown ? ` cooldown=${ev.cooldown}` : ''}`);
      if (ev.narrative) out.push(ev.narrative);
      if (ev.state?.sanDelta) out.push(`- san: ${ev.state.sanDelta}`);
      for (const f of ev.state?.addFlags ?? []) out.push(`- flag: ${f}`);
      out.push(':::');
      out.push('');
    }

    for (const c of node.choices) {
      const parts: string[] = [];
      if (c.check) parts.push(`check=${c.check.skill}${c.check.difficulty && c.check.difficulty !== 'regular' ? ` ${c.check.difficulty === 'hard' ? '困难' : '极难'}` : ''}`);
      if (c.effects?.sanDelta) parts.push(`san=${c.effects.sanDelta}`);
      if (c.effects?.hpDelta) parts.push(`hp=${c.effects.hpDelta}`);
      for (const f of c.effects?.addFlags ?? []) parts.push(`flag=${f}`);
      for (const [k, v] of Object.entries(c.effects?.vars ?? {})) parts.push(`var:${k}=${String(v)}`);
      const target = c.effects?.goto ?? c.next;
      out.push(`- [${c.text}]${target ? ` -> ${target}` : ''}${parts.length ? ` {${parts.join(' ')}}` : ''}`);
    }
    if (node.choices.length) out.push('');
  }

  if (script.events.length) {
    out.push('::: world-events');
    for (const ev of script.events) {
      out.push(`## ${ev.name}`);
      out.push(`- trigger: ${ev.trigger}`);
      out.push(`- chance: ${Math.round(ev.chance * 100)}%`);
      if (ev.once) out.push('- once: true');
      if (ev.cooldown) out.push(`- cooldown: ${ev.cooldown}`);
      for (const cond of ev.conditions) {
        if (cond.type === 'flag') out.push(`- when: flag=${cond.value}`);
        if (cond.type === 'stat') out.push(`- when: ${cond.stat}${cond.op === 'gt' ? '>' : cond.op === 'lt' ? '<' : '='}${cond.value}`);
      }
      if (ev.narrative) out.push(`- narrative: ${ev.narrative.replace(/\n/g, ' ')}`);
      if (ev.state?.sanDelta) out.push(`- san: ${ev.state.sanDelta}`);
      out.push('');
    }
    out.push(':::');
  }

  return out.join('\n').trim() + '\n';
}

/* ------------------------------------------------------------------ */
/* 节点查找                                                            */
/* ------------------------------------------------------------------ */

export function findNode(script: StoryScript | null | undefined, nodeId?: string | null): ScriptNode | undefined {
  if (!script || !nodeId) return undefined;
  return script.nodes.find((n) => n.id === nodeId);
}

export function startNode(script: StoryScript | null | undefined): ScriptNode | undefined {
  if (!script) return undefined;
  return findNode(script, script.startNodeId) ?? script.nodes[0];
}
