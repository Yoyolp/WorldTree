/**
 * 世界树 · 跨作品继承
 *
 * 一条世界线走到结局后，把「这个角色此刻是什么样」存成 LegacySnapshot：
 *   - 能力（金手指 + 学到的）
 *   - 面板（属性/技能/物品/状态）
 *   - 人际关系（vars 里 rel.* 约定）
 *   - 关键标记（做过哪些选择）
 *   - 世界变量（对环境造成的改变）
 *   - 结局摘要
 *
 * 续作在世界 JSON 里声明 accepts 白名单，只接收作者允许的字段。
 */

import type {
  CharacterAbility,
  CocSheet,
  InheritanceRule,
  LegacyField,
  LegacySnapshot,
  Relationship,
  ScriptChoice,
  Session,
  SessionState,
  World,
} from './types.js';

/* ------------------------------------------------------------------ */
/* 关系                                                                */
/* ------------------------------------------------------------------ */

/** 关系值约定存在 vars 里：rel.<目标名> = 数字，rel.<目标名>.note = 说明 */
export function extractRelationships(vars: Record<string, unknown>): Relationship[] {
  const out: Relationship[] = [];
  for (const [key, value] of Object.entries(vars ?? {})) {
    if (!key.startsWith('rel.')) continue;
    const rest = key.slice(4);
    if (rest.endsWith('.note')) continue;
    const target = rest;
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) continue;
    const note = vars[`rel.${target}.note`];
    out.push({
      target,
      value: Math.max(-100, Math.min(100, num)),
      note: typeof note === 'string' ? note : undefined,
    });
  }
  return out.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

export function relationshipOf(snapshot: LegacySnapshot | null | undefined, target: string): number | undefined {
  if (!snapshot) return undefined;
  return snapshot.relationships.find((r) => r.target === target)?.value;
}

/* ------------------------------------------------------------------ */
/* 生成快照                                                            */
/* ------------------------------------------------------------------ */

export interface BuildSnapshotInput {
  session: Session;
  world: World;
  characterName: string;
  characterId?: string | null;
  abilities: CharacterAbility[];
  ending: LegacySnapshot['ending'];
  summary?: string;
}

export function buildSnapshot(input: BuildSnapshotInput): LegacySnapshot {
  const state = input.session.state;
  const sheet = state.sheet;

  return {
    id: `legacy_${input.session.id.slice(-8)}_${Date.now().toString(36)}`,
    worldId: input.world.id,
    worldTitle: input.world.title,
    sessionId: input.session.id,
    sessionTitle: input.session.title,
    characterId: input.characterId ?? null,
    characterName: input.characterName,
    ending: input.ending,
    abilities: (input.abilities ?? []).filter((a) => a.inheritable !== false),
    sheet: sheet ? structuredClone(sheet) : undefined,
    relationships: extractRelationships(state.vars),
    items: [...(sheet?.items ?? [])],
    flags: [...state.flags],
    vars: { ...state.vars },
    summary: input.summary ?? state.summary ?? '',
    finalScene: state.scene,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/* ------------------------------------------------------------------ */
/* 白名单过滤                                                          */
/* ------------------------------------------------------------------ */

/** 按世界声明的 accepts 裁剪快照 */
export function filterLegacy(snapshot: LegacySnapshot, rule?: InheritanceRule | null): LegacySnapshot {
  if (!rule || !rule.enabled) {
    // 未声明继承：只给一段摘要，不影响数值
    return {
      ...snapshot,
      abilities: [],
      sheet: undefined,
      relationships: [],
      items: [],
      flags: [],
      vars: {},
    };
  }

  const accept = new Set<LegacyField>(rule.accepts ?? []);
  const decay = typeof rule.decay === 'number' ? Math.max(0, Math.min(1, rule.decay)) : 1;

  const out: LegacySnapshot = {
    ...snapshot,
    abilities: accept.has('abilities') ? snapshot.abilities.map((a) => cloneAbility(a, decay)) : [],
    sheet: accept.has('sheet') && snapshot.sheet ? scaleSheet(snapshot.sheet, decay) : undefined,
    relationships: accept.has('relationships')
      ? snapshot.relationships.map((r) => ({ ...r, value: Math.round(r.value * decay) }))
      : [],
    items: accept.has('items') ? [...snapshot.items] : [],
    flags: accept.has('flags') ? [...snapshot.flags] : [],
    vars: accept.has('vars') ? { ...snapshot.vars } : {},
    summary: accept.has('summary') ? snapshot.summary : '',
  };

  return out;
}

function cloneAbility(a: CharacterAbility, decay: number): CharacterAbility {
  if (decay === 1) return structuredClone(a);
  const clone = structuredClone(a);
  if (clone.effect?.checkBonus) {
    clone.effect.checkBonus = clone.effect.checkBonus.map((b) => ({
      ...b,
      value: Math.round(b.value * decay),
    }));
  }
  return clone;
}

function scaleSheet(sheet: CocSheet, decay: number): CocSheet {
  const s = structuredClone(sheet);
  if (decay === 1) return s;
  for (const skill of s.skills) {
    skill.value = Math.max(1, Math.round(skill.value * decay));
  }
  // 内置资源按比例衰减
  s.san = Math.round((s.san ?? 0) * decay);
  s.sanMax = Math.round((s.sanMax ?? 0) * decay);
  s.hp = Math.min(s.hp, s.hpMax);
  // 规则书声明的其它资源同样按比例缩放，上限不动（上限由属性推导）
  if (s.resources) {
    const next: Record<string, number> = { ...s.resources };
    for (const key of Object.keys(next)) {
      if (key.endsWith('Max')) continue;
      next[key] = Math.round(next[key] * decay);
    }
    s.resources = next;
  }
  return s;
}

/** 该世界是否接受来自某世界的继承 */
export function acceptsFromWorld(rule: InheritanceRule | undefined | null, sourceWorldId: string): boolean {
  if (!rule?.enabled) return false;
  if (!rule.fromWorldIds?.length) return true;
  return rule.fromWorldIds.includes(sourceWorldId) || rule.fromWorldIds.includes('*');
}

/* ------------------------------------------------------------------ */
/* 注入提示词                                                          */
/* ------------------------------------------------------------------ */

export function renderLegacy(snapshot: LegacySnapshot | null | undefined, rule?: InheritanceRule | null): string {
  if (!snapshot) return '';

  const title = rule?.header ?? '前作延续';
  const blocks: string[] = [];

  blocks.push(
    `# ${title}\n玩家角色「${snapshot.characterName}」来自《${snapshot.worldTitle}》的世界线「${snapshot.sessionTitle}」。` +
      (snapshot.ending.title ? `上一段故事的结局是「${snapshot.ending.title}」。` : ''),
  );

  if (snapshot.summary) blocks.push(`## 前情提要\n${snapshot.summary}`);

  if (snapshot.abilities.length) {
    const lines = snapshot.abilities.map((a) => {
      const bonus = a.effect?.checkBonus?.map((b) => `${b.skill} +${b.value}`).join('，');
      return `- ${a.name}（${a.kind}）：${a.description}${bonus ? `（${bonus}）` : ''}`;
    });
    blocks.push(`## 已拥有的能力\n${lines.join('\n')}`);
  }

  if (snapshot.relationships.length) {
    const lines = snapshot.relationships.map((r) => {
      const tone = r.value >= 50 ? '亲近' : r.value >= 20 ? '友好' : r.value <= -50 ? '敌视' : r.value <= -20 ? '冷淡' : '中立';
      return `- ${r.target}：${tone}（${r.value}）${r.note ? ` —— ${r.note}` : ''}`;
    });
    blocks.push(`## 人际关系\n${lines.join('\n')}\n请让这些关系在新故事里继续生效：老朋友会记得你，敌人不会突然忘记旧账。`);
  }

  if (snapshot.flags.length) {
    blocks.push(`## 曾经做出的关键选择\n${snapshot.flags.map((f) => `- ${f}`).join('\n')}`);
  }

  if (snapshot.items.length) {
    blocks.push(`## 随身携带\n${snapshot.items.join('、')}`);
  }

  const varEntries = Object.entries(snapshot.vars).filter(([k]) => !k.startsWith('rel.'));
  if (varEntries.length) {
    blocks.push(
      `## 你对世界造成的影响\n${varEntries
        .map(([k, v]) => `- ${k}：${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
        .join('\n')}`,
    );
  }

  blocks.push('以上是既成事实，不要否定它们。可以在叙事中自然引用，但不要一次性全部倒出。');

  return blocks.join('\n\n');
}

/* ------------------------------------------------------------------ */
/* 条件判断                                                            */
/* ------------------------------------------------------------------ */

/** 继承数据里可用的「标记集合」：flags + vars 键 + 能力名 */
export function legacyTokens(snapshot: LegacySnapshot | null | undefined): Set<string> {
  const set = new Set<string>();
  if (!snapshot) return set;
  for (const f of snapshot.flags) set.add(f);
  for (const k of Object.keys(snapshot.vars)) set.add(k);
  for (const a of snapshot.abilities) set.add(a.name);
  for (const r of snapshot.relationships) set.add(r.target);
  return set;
}

export function hasLegacyToken(state: SessionState, token: string): boolean {
  if (!state.legacy) return false;
  return legacyTokens(state.legacy).has(token);
}

/**
 * 判断一个剧本选项的继承/能力条件是否满足。
 *
 * 关于 requireAbility：能力可能来自两处 —— 角色卡自带的，或从继承里带来的。
 * 早先这里把「自身能力」写成了一个永远为空的 Set，导致只有继承能力才认，
 * 角色卡自带的金手指/天赋永远点不出对应分支。
 *
 * ownAbilities 由调用方传入（会话里能拿到角色卡能力）；不传时只认继承数据。
 */
export function choiceAvailable(
  choice: ScriptChoice,
  state: SessionState,
  ownAbilities?: CharacterAbility[],
): boolean {
  if (choice.requireFlag && !state.flags.includes(choice.requireFlag)) return false;
  if (choice.forbidFlag && state.flags.includes(choice.forbidFlag)) return false;

  if (choice.requireAbility) {
    const names = new Set<string>();
    for (const a of state.legacy?.abilities ?? []) names.add(a.name);
    for (const a of ownAbilities ?? []) names.add(a.name);
    if (!names.has(choice.requireAbility)) return false;
  }

  if (choice.requireLegacyFlag && !hasLegacyToken(state, choice.requireLegacyFlag)) return false;

  if (choice.requireRelationship) {
    const { target, min, max } = choice.requireRelationship;
    const value = relationshipOf(state.legacy, target);
    if (value === undefined) return false;
    if (typeof min === 'number' && value < min) return false;
    if (typeof max === 'number' && value > max) return false;
  }

  return true;
}

/** 把继承数据写进会话状态（导入时调用） */
export function applyLegacyToState(state: SessionState, legacy: LegacySnapshot): SessionState {
  const next: SessionState = {
    ...state,
    legacy,
    flags: [...state.flags],
    vars: { ...state.vars },
  };

  // 继承的关键标记合并进当前 flags，供剧本条件使用
  for (const f of legacy.flags) {
    if (f && !next.flags.includes(f)) next.flags.push(f);
  }
  // 世界变量（不含关系前缀的不覆盖当前值，只补空缺）
  for (const [k, v] of Object.entries(legacy.vars)) {
    if (!(k in next.vars)) next.vars[k] = v;
  }

  // 能力带来的初始标记
  for (const a of legacy.abilities) {
    if (!a.unlocked) continue;
    for (const f of a.effect.grantsFlags ?? []) {
      if (f && !next.flags.includes(f)) next.flags.push(f);
    }
  }

  return next;
}
