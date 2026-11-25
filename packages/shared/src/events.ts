/**
 * 世界树 · 事件引擎（纯函数）
 *
 * 事件 = 触发时机 + 条件组 + 概率 + 冷却 + 效果。
 * 所有随机走 rng，触发记录会写进消息 meta，保证分叉后重演可复现。
 */

import type {
  EventCondition,
  EventFireRecord,
  EventRuntimeState,
  EventStateEffect,
  EventTrigger,
  GameEvent,
  SessionState,
} from './types.js';
import type { Rng } from './dice.js';
import { resourceMax, resourceValue } from './sheet.js';

export type { Rng };

/** 存在平铺字段上的内置资源键（其余资源在 sheet.resources） */
const FLAT_RESOURCE_KEYS = new Set(['hp', 'mp', 'san', 'luck']);

/* ------------------------------------------------------------------ */
/* 运行时状态                                                          */
/* ------------------------------------------------------------------ */

export function emptyEventState(): EventRuntimeState {
  return { fired: [], cooldowns: {}, counters: {}, turns: 0 };
}

/** 回合推进：冷却递减 */
export function tickEvents(state: EventRuntimeState): EventRuntimeState {
  const cooldowns: Record<string, number> = {};
  for (const [k, v] of Object.entries(state.cooldowns)) {
    if (v > 1) cooldowns[k] = v - 1;
  }
  return { ...state, cooldowns, turns: state.turns + 1 };
}

/* ------------------------------------------------------------------ */
/* 条件求值                                                            */
/* ------------------------------------------------------------------ */

export interface ConditionContext {
  state: SessionState;
  /** 本回合玩家输入，用于 scene 匹配 */
  playerInput?: string;
  turn?: number;
  rng?: Rng;
}

function compare(a: number, b: number, op: string): boolean {
  switch (op) {
    case 'eq':
      return a === b;
    case 'neq':
      return a !== b;
    case 'gt':
      return a > b;
    case 'lt':
      return a < b;
    case 'gte':
      return a >= b;
    case 'lte':
      return a <= b;
    default:
      return false;
  }
}

/** 求值单个条件 */
export function evaluateCondition(cond: EventCondition, ctx: ConditionContext): boolean {
  const { state } = ctx;

  switch (cond.type) {
    case 'flag':
      return cond.op === 'has' ? state.flags.includes(cond.value) : !state.flags.includes(cond.value);

    case 'var': {
      const raw = state.vars[cond.key];
      if (cond.op === 'exists') return raw !== undefined && raw !== null;
      if (cond.op === 'notExists') return raw === undefined || raw === null;
      if (raw === undefined) return false;
      if (typeof cond.value === 'number' && typeof raw === 'number') {
        return compare(raw, cond.value, cond.op);
      }
      if (cond.op === 'eq') return String(raw) === String(cond.value);
      if (cond.op === 'neq') return String(raw) !== String(cond.value);
      if (typeof raw === 'number' && typeof cond.value === 'string') {
        return compare(raw, Number(cond.value), cond.op);
      }
      return false;
    }

    case 'stat': {
      const sheet = state.sheet;
      if (!sheet) return false;
      // 资源键可能是 COC 的 san/hp，也可能是规则书声明的 ac/法术位
      const value = resourceValue(sheet, cond.stat);
      return compare(Number(value ?? 0), cond.value, cond.op);
    }

    case 'node':
      return state.nodeId === cond.nodeId;

    case 'turn':
      return compare(ctx.turn ?? state.events.turns, cond.value, cond.op);

    case 'scene': {
      const hay = `${state.scene} ${ctx.playerInput ?? ''}`;
      return hay.includes(cond.contains);
    }

    case 'check':
      // 检定类条件由规则引擎在调用前注入结果，这里只做占位
      return true;

    case 'chance': {
      const rng = ctx.rng ?? Math.random;
      return rng() * 100 < cond.value;
    }

    default:
      return false;
  }
}

/** 全部条件满足才触发（AND） */
export function conditionsMet(conds: EventCondition[] | undefined, ctx: ConditionContext): boolean {
  if (!conds?.length) return true;
  return conds.every((c) => evaluateCondition(c, ctx));
}

/* ------------------------------------------------------------------ */
/* 事件筛选与触发                                                       */
/* ------------------------------------------------------------------ */

export interface SelectEventsInput {
  events: GameEvent[];
  trigger: EventTrigger;
  ctx: ConditionContext;
  /** scope=node 时只看该节点的事件 */
  nodeId?: string;
}

/** 判断事件当前是否可触发（不再掷概率） */
export function eventAvailable(
  ev: GameEvent,
  trigger: EventTrigger,
  state: EventRuntimeState,
  nodeId?: string,
): boolean {
  if (!ev.enabled) return false;
  if (ev.trigger !== trigger) return false;
  if (ev.scope === 'node' && ev.nodeId && nodeId && ev.nodeId !== nodeId) return false;
  if (ev.once && state.fired.includes(ev.id)) return false;
  if ((state.cooldowns[ev.id] ?? 0) > 0) return false;
  return true;
}

/**
 * 挑选本回合要触发的事件。
 * 返回触发记录 + 更新后的状态。
 */
export function fireEvents(input: SelectEventsInput): {
  records: EventFireRecord[];
  state: EventRuntimeState;
} {
  const { events, trigger, ctx } = input;
  const rng = ctx.rng ?? Math.random;
  let state: EventRuntimeState = {
    ...ctx.state.events,
    fired: [...ctx.state.events.fired],
    cooldowns: { ...ctx.state.events.cooldowns },
    counters: { ...ctx.state.events.counters },
  };

  const candidates = events
    .filter((ev) => eventAvailable(ev, trigger, state, input.nodeId))
    .filter((ev) => conditionsMet(ev.conditions, ctx))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  const records: EventFireRecord[] = [];
  // 每回合最多触发 2 个事件，避免叙事被塞满
  const maxPerTurn = 2;

  for (const ev of candidates) {
    if (records.length >= maxPerTurn) break;

    const chance = typeof ev.chance === 'number' ? Math.max(0, Math.min(1, ev.chance)) : 1;
    const roll = rng();

    if (roll >= chance) continue;

    records.push({
      eventId: ev.id,
      name: ev.name,
      chance,
      roll: Number(roll.toFixed(3)),
      narrative: ev.narrative,
      notice: ev.notice,
      effects: ev.state,
    });

    if (ev.once) state.fired.push(ev.id);
    if (ev.cooldown > 0) state.cooldowns[ev.id] = ev.cooldown;
    state.counters[ev.id] = (state.counters[ev.id] ?? 0) + 1;

    // 解锁 / 锁定其它事件
    for (const id of ev.unlock ?? []) {
      state.cooldowns[id] = 0;
    }
    for (const id of ev.lock ?? []) {
      state.cooldowns[id] = Number.MAX_SAFE_INTEGER;
    }
  }

  return { records, state };
}

/* ------------------------------------------------------------------ */
/* 效果应用                                                            */
/* ------------------------------------------------------------------ */

/** 把事件状态效果合并进 state（不可变） */
export function applyEventEffects(state: SessionState, effect?: EventStateEffect | null): SessionState {
  if (!effect) return state;

  const next: SessionState = {
    ...state,
    vars: { ...state.vars },
    flags: [...state.flags],
    sheet: state.sheet
      ? {
          ...state.sheet,
          conditions: [...state.sheet.conditions],
          items: [...state.sheet.items],
          skills: state.sheet.skills.map((s) => ({ ...s })),
        }
      : state.sheet,
  };

  if (effect.set) {
    for (const [k, v] of Object.entries(effect.set)) {
      if (v === null) delete next.vars[k];
      else next.vars[k] = v;
    }
  }
  for (const f of effect.addFlags ?? []) {
    if (f && !next.flags.includes(f)) next.flags.push(f);
  }
  if (effect.removeFlags?.length) {
    next.flags = next.flags.filter((f) => !effect.removeFlags!.includes(f));
  }

  if (next.sheet) {
    const s = next.sheet;
    // 固定字段（COC 时代）逐项应用
    if (effect.sanDelta) s.san = Math.max(0, Math.min(s.sanMax, s.san + effect.sanDelta));
    if (effect.hpDelta) s.hp = Math.max(0, Math.min(s.hpMax, s.hp + effect.hpDelta));
    if (effect.mpDelta) s.mp = Math.max(0, Math.min(s.mpMax, s.mp + effect.mpDelta));
    if (effect.luckDelta) {
      const luck = (s.luck ?? s.attributes.LUCK) + effect.luckDelta;
      s.luck = Math.max(0, Math.min(s.luckMax ?? s.attributes.LUCK, luck));
    }
    // 通用资源：任何规则书声明的资源都从这里增减
    for (const [key, delta] of Object.entries(effect.resourceDelta ?? {})) {
      if (!delta) continue;
      const cur = resourceValue(s, key);
      const max = resourceMax(s, key);
      const upper = max > 0 ? max : Number.MAX_SAFE_INTEGER;
      const value = Math.max(0, Math.min(upper, cur + delta));
      if (FLAT_RESOURCE_KEYS.has(key)) {
        (s as unknown as Record<string, number>)[key] = value;
      } else {
        s.resources = { ...(s.resources ?? {}), [key]: value };
      }
    }
    for (const item of effect.addItems ?? []) {
      if (item && !s.items.includes(item)) s.items.push(item);
    }
    if (effect.removeItems?.length) {
      s.items = s.items.filter((i) => !effect.removeItems!.includes(i));
    }
    for (const c of effect.addConditions ?? []) {
      if (c && !s.conditions.includes(c)) s.conditions.push(c);
    }
  }

  return next;
}

/** 汇总多个事件记录的效果 */
export function mergeEventEffects(records: EventFireRecord[]): EventStateEffect | null {
  const withEffects = records.filter((r) => r.effects);
  if (!withEffects.length) return null;

  const merged: EventStateEffect = {
    set: {},
    addFlags: [],
    removeFlags: [],
    addItems: [],
    addConditions: [],
    sanDelta: 0,
    hpDelta: 0,
    mpDelta: 0,
    luckDelta: 0,
    resourceDelta: {},
  };

  for (const r of withEffects) {
    const e = r.effects!;
    if (e.set) Object.assign(merged.set!, e.set);
    merged.addFlags!.push(...(e.addFlags ?? []));
    merged.removeFlags!.push(...(e.removeFlags ?? []));
    merged.addItems!.push(...(e.addItems ?? []));
    merged.addConditions!.push(...(e.addConditions ?? []));
    merged.sanDelta! += e.sanDelta ?? 0;
    merged.hpDelta! += e.hpDelta ?? 0;
    merged.mpDelta! += e.mpDelta ?? 0;
    merged.luckDelta! += e.luckDelta ?? 0;
    for (const [k, v] of Object.entries(e.resourceDelta ?? {})) {
      merged.resourceDelta![k] = (merged.resourceDelta![k] ?? 0) + v;
    }
  }

  return merged;
}

/** 事件叙事片段 → 提示词块 */
export function renderEventNarrative(records: EventFireRecord[]): string {
  const lines = records
    .filter((r) => r.narrative)
    .map((r) => `【${r.name}】\n${r.narrative}`);
  return lines.length ? lines.join('\n\n') : '';
}
