/**
 * 统一规则引擎
 *
 * 三种模式（自由叙事 / 剧本 / 跑团）共用这一套流程：
 *
 *   意图 → 是否需要检定 → 掷骰 → 事件判定 → 状态变更 → 组装提示词 → 模型 → 解析 → 落库
 *
 * 差别只在「规则包」与「选项来源」。
 */

import {
  applyEventEffects,
  checkBonusFrom,
  choiceAvailable,
  effectiveSheet,
  emptyEventState,
  findNode,
  fireEvents,
  getRulePack,
  makeRng,
  mergeEventEffects,
  performCheck,
  renderEventNarrative,
  resolveSkillValue,
  resourceMax,
  resourceValue,
  rollFormula,
  spendLuckToSucceed,
  startNode,
  tickEvents,
  type CharacterAbility,
  type CheckDifficulty,
  type CheckResult,
  type EventFireRecord,
  type GameEvent,
  type RulePack,
  type Rng,
  type ScriptChoice,
  type ScriptEffect,
  type SessionState,
  type StoryScript,
} from '@worldtree/shared';

/* ------------------------------------------------------------------ */
/* 意图推断                                                            */
/* ------------------------------------------------------------------ */

export interface ParsedIntent {
  /** 玩家想做什么 */
  kind: 'observe' | 'social' | 'move' | 'investigate' | 'fight' | 'use' | 'other';
  /** 建议检定的技能（可能为空） */
  skill?: string;
  /** 建议难度 */
  difficulty?: CheckDifficulty;
  /** 是否是有风险的行为 */
  risky: boolean;
}

const SKILL_HINTS: { pattern: RegExp; skill: string; kind: ParsedIntent['kind'] }[] = [
  { pattern: /(观察|查看|打量|环视|张望|扫视|搜索|搜查|寻找|找一找|检查|翻找|搜索|搜寻)/, skill: '侦查', kind: 'investigate' },
  { pattern: /(听|倾听|侧耳|声音)/, skill: '聆听', kind: 'observe' },
  { pattern: /(跑|逃|溜|躲|藏|悄悄|潜行|摸过去|绕到)/, skill: '潜行', kind: 'move' },
  { pattern: /(说服|劝说|交谈|询问|商量|谈判|搭话)/, skill: '说服', kind: 'social' },
  { pattern: /(撒谎|欺骗|骗|伪装|冒充)/, skill: '话术', kind: 'social' },
  { pattern: /(恐吓|威胁|逼问|吼)/, skill: '恐吓', kind: 'social' },
  { pattern: /(看书|查阅|资料|档案|图书馆|翻找文献|查书)/, skill: '图书馆使用', kind: 'investigate' },
  { pattern: /(拆|撬|开锁|修理|机械|机关)/, skill: '锁匠', kind: 'use' },
  { pattern: /(驾驶|开车|掌舵)/, skill: '驾驶', kind: 'move' },
  { pattern: /(爬|攀|翻墙|跳跃)/, skill: '攀爬', kind: 'move' },
  { pattern: /(游泳|潜水|水下)/, skill: '游泳', kind: 'move' },
  { pattern: /(开枪|射击|枪|箭)/, skill: '射击', kind: 'fight' },
  { pattern: /(攻击|挥|刺|打|格斗|揍|拳|踢|砍)/, skill: '格斗', kind: 'fight' },
  { pattern: /(急救|包扎|治疗|止血)/, skill: '急救', kind: 'use' },
  { pattern: /(看人|察言观色|他在想|表情|心理)/, skill: '心理学', kind: 'observe' },
  { pattern: /(神秘|仪式|咒|符文|符号|邪教)/, skill: '神秘学', kind: 'investigate' },
  { pattern: /(躲开|闪避|避开)/, skill: '闪避', kind: 'move' },
];

const RISKY_WORDS = /(危险|冒险|尝试|强行|硬闯|冲|闯|爬|跳|破坏|攻击|威胁|跳下|潜入|开枪|刺|砍|撬|拆)/;

/**
 * 从玩家输入里推断意图与「可能」需要检定的技能。
 *
 * 注意这里只做「建议」，不做裁定：
 *  - 命中明确技能关键词（观察、说服、撬锁…）才给出 skill
 *  - 只是「有风险」但没有明确技能时，不再凭空塞一个技能。
 *    早先这里兜底返回「闪避」，导致「掏出铅哨，尝试吹响」被判成闪避检定，
 *    玩家会看到跟行动毫无关系的掷骰。
 *  - 真正要不要检定、检定什么，交给模型在元数据里给 check，
 *    或者玩家自己点「检定」——引擎不替玩家做主。
 */
export function parseIntent(content: string, _pack?: RulePack): ParsedIntent {
  const text = content ?? '';
  const risky = RISKY_WORDS.test(text);

  for (const h of SKILL_HINTS) {
    if (h.pattern.test(text)) {
      return {
        kind: h.kind,
        skill: h.skill,
        difficulty: risky ? 'hard' : 'regular',
        risky,
      };
    }
  }

  // 没有明确技能关键词：只报告「这是个有风险的动作」，不指定技能。
  return { kind: 'other', risky, skill: undefined };
}

/* ------------------------------------------------------------------ */
/* 状态变更                                                            */
/* ------------------------------------------------------------------ */

/** 把剧本/选项的 effect 应用进 state（不可变） */
export function applyScriptEffect(state: SessionState, effect?: ScriptEffect | null): SessionState {
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

  if (effect.vars) {
    for (const [k, v] of Object.entries(effect.vars)) {
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
    if (effect.sanDelta) s.san = Math.max(0, Math.min(s.sanMax, s.san + effect.sanDelta));
    if (effect.hpDelta) s.hp = Math.max(0, Math.min(s.hpMax, s.hp + effect.hpDelta));
    if (effect.mpDelta) s.mp = Math.max(0, Math.min(s.mpMax, s.mp + effect.mpDelta));
    if (effect.luckDelta) {
      const cur = s.luck ?? s.attributes.LUCK;
      s.luck = Math.max(0, Math.min(s.luckMax ?? s.attributes.LUCK, cur + effect.luckDelta));
    }
    // 通用资源增减（非 COC 规则书走这条）
    for (const [key, delta] of Object.entries(effect.resourceDelta ?? {})) {
      if (!delta) continue;
      const cur = resourceValue(s, key);
      const max = resourceMax(s, key);
      const upper = max > 0 ? max : Number.MAX_SAFE_INTEGER;
      const value = Math.max(0, Math.min(upper, cur + delta));
      if (key === 'hp' || key === 'mp' || key === 'san' || key === 'luck') {
        (s as unknown as Record<string, number>)[key] = value;
      } else {
        s.resources = { ...(s.resources ?? {}), [key]: value };
      }
    }
    for (const it of effect.addItems ?? []) {
      if (it && !s.items.includes(it)) s.items.push(it);
    }
    for (const c of effect.addConditions ?? []) {
      if (c && !s.conditions.includes(c)) s.conditions.push(c);
    }
  }

  return next;
}

/* ------------------------------------------------------------------ */
/* 剧本节点推进                                                        */
/* ------------------------------------------------------------------ */

export interface NodeAdvance {
  state: SessionState;
  nodeId?: string;
  choices: ScriptChoice[];
  sceneText?: string;
  nodeTitle?: string;
  ending: boolean;
  endingTitle?: string;
  directive?: string;
}

function describeNode(node: { title: string; content: string; directorNote?: string; ending?: boolean }, choices: ScriptChoice[]): string {
  const lines = [`【节拍】${node.title}`, node.content];
  if (node.directorNote) lines.push(`导演备注：${node.directorNote}`);
  lines.push(`可选分支：${choices.map((c) => c.text).join(' / ') || '（自由发展）'}`);
  if (node.ending) lines.push('这是结局节点，请收束故事。');
  return lines.filter(Boolean).join('\n');
}

function filterChoices(
  choices: ScriptChoice[] | undefined,
  state: SessionState,
  ownAbilities?: CharacterAbility[],
): ScriptChoice[] {
  // 复用共享层的条件判定：包含 flag / 能力 / 继承标记 / 关系阈值
  // ownAbilities 是角色卡自带的能力，少了它「角色卡自带金手指」的分支永远不显示
  return (choices ?? []).filter((c) => choiceAvailable(c, state, ownAbilities));
}

/**
 * 进入某个节点。
 *
 * `applyOnEnter` 默认 true。玩家「已经在这个节点里、又待了一回合」时，
 * 调用方必须传 false —— 否则 `::: on-enter` 里的 san/hp/items 会每回合
 * 重复结算，玩家在一个节点里坐着不动就会把血条耗干。
 */
export function enterNode(
  script: StoryScript | null,
  nodeId: string | undefined,
  state: SessionState,
  options: { applyOnEnter?: boolean; ownAbilities?: CharacterAbility[] } = {},
): NodeAdvance {
  const node = findNode(script, nodeId);
  if (!node) {
    return { state, choices: [], ending: false };
  }
  const applyOnEnter = options.applyOnEnter !== false;
  let next = applyOnEnter ? applyScriptEffect(state, node.onEnter) : state;
  next = { ...next, nodeId: node.id, scene: node.title || next.scene };

  const choices = filterChoices(node.choices, next, options.ownAbilities);
  return {
    state: next,
    nodeId: node.id,
    choices,
    sceneText: node.content,
    nodeTitle: node.title,
    ending: !!node.ending,
    endingTitle: node.endingTitle,
    directive: describeNode(node, choices),
  };
}

/** 玩家做出某个选择 */
export function applyChoice(
  script: StoryScript | null,
  state: SessionState,
  choice: ScriptChoice,
  options: { ownAbilities?: CharacterAbility[] } = {},
): NodeAdvance {
  const afterEffect = applyScriptEffect(state, choice.effects);
  const target = choice.effects?.goto ?? choice.next;
  if (!target) {
    return { state: afterEffect, choices: [], ending: false };
  }
  return enterNode(script, target, afterEffect, { ownAbilities: options.ownAbilities });
}

/* ------------------------------------------------------------------ */
/* 事件判定                                                            */
/* ------------------------------------------------------------------ */

export interface EventContext {
  events: GameEvent[];
  trigger: GameEvent['trigger'];
  state: SessionState;
  nodeId?: string;
  playerInput?: string;
  rng: Rng;
  turn: number;
}

/** 判定并应用事件 */
export function resolveEvents(ctx: EventContext): { state: SessionState; records: EventFireRecord[] } {
  const { records, state: eventState } = fireEvents({
    events: ctx.events,
    trigger: ctx.trigger,
    nodeId: ctx.nodeId,
    ctx: {
      state: ctx.state,
      playerInput: ctx.playerInput,
      turn: ctx.turn,
      rng: ctx.rng,
    },
  });

  if (!records.length) {
    return { state: { ...ctx.state, events: eventState }, records };
  }

  const effect = mergeEventEffects(records);
  let next = applyEventEffects({ ...ctx.state, events: eventState }, effect);

  // goto：第一个带 goto 的事件决定跳转
  for (const r of records) {
    const ev = ctx.events.find((e) => e.id === r.eventId);
    if (ev?.goto) {
      next = { ...next, nodeId: ev.goto };
      break;
    }
  }

  return { state: next, records };
}

/* ------------------------------------------------------------------ */
/* 检定                                                                */
/* ------------------------------------------------------------------ */

export interface CheckRequest {
  skill: string;
  difficulty?: CheckDifficulty;
  bonus?: number;
  reason?: string;
}

export interface CheckOutcomeBundle {
  check: CheckResult | null;
  /** 检定后可能修改的状态（如消耗幸运） */
  state: SessionState;
  /** 检定是否改变了叙事方向 */
  blocked: boolean;
}

/** 执行检定并把结果反映到状态（消耗幸运、理智损失等由事件负责） */
export function runCheck(
  state: SessionState,
  req: CheckRequest,
  pack: RulePack,
  rng: Rng,
  options: { spendLuck?: number; push?: boolean; abilities?: CharacterAbility[]; failForward?: boolean } = {},
): CheckOutcomeBundle {
  const abilities = options.abilities ?? [];
  // 能力可以提供属性加值 → 用「有效面板」算目标值
  const sheet = effectiveSheet(state.sheet, abilities);
  // 没有技能值时退回规则包的固定难度（剧本简化包靠这个）
  const fallback = pack.difficultyPresets?.[(req.difficulty ?? 'regular') as CheckDifficulty] ?? 50;
  const base = resolveSkillValue(sheet, req.skill) ?? fallback;
  const abilityBonus = checkBonusFrom(abilities, req.skill, state);
  const target = base + abilityBonus;

  let check = performCheck({
    skill: req.skill,
    target,
    difficulty: req.difficulty,
    bonus: req.bonus,
    rng,
    pack,
  });

  if (abilityBonus) {
    check = {
      ...check,
      detail: `${check.detail}（能力加值 ${abilityBonus > 0 ? '+' : ''}${abilityBonus}）`,
    };
  }

  let next = state;

  // 消耗幸运改判
  if (options.spendLuck && pack.luckSpend && state.sheet && !check.success) {
    const available = state.sheet.luck ?? state.sheet.attributes.LUCK;
    const luck = spendLuckToSucceed(check, available);
    if (luck) {
      check = luck.check;
      next = applyScriptEffect(next, { luckDelta: -luck.spent });
    }
  }

  // 孤注一掷：失败后重掷（代价由叙事承担）
  if (options.push && pack.pushedRolls && !check.success && !check.pushed) {
    const pushed = performCheck({
      skill: req.skill,
      target,
      difficulty: req.difficulty,
      bonus: req.bonus,
      rng,
      pack,
    });
    check = { ...pushed, pushed: true, detail: `${pushed.detail}（孤注一掷）` };
  }

  // 失败是否「卡住」剧情：规则包说失败也推进，或这个世界的作者这么要求
  const failForward = options.failForward ?? pack.failForward;
  const blocked = !check.success && !failForward;
  return { check, state: next, blocked };
}

/* ------------------------------------------------------------------ */
/* 会话初始化                                                          */
/* ------------------------------------------------------------------ */

export function initialState(script: StoryScript | null, rulePackId: SessionState['rulePackId'], seed = Date.now()): SessionState {
  const node = script ? startNode(script) : undefined;
  const state: SessionState = {
    vars: {},
    flags: [],
    scene: node?.title ?? '',
    nodeId: node?.id,
    events: emptyEventState(),
    rulePackId,
    seed,
  };
  if (node) {
    return applyScriptEffect(state, node.onEnter);
  }
  return state;
}

/** 每回合结束推进事件冷却 */
export function endTurn(state: SessionState): SessionState {
  return { ...state, events: tickEvents(state.events) };
}

/* ------------------------------------------------------------------ */
/* 便捷工具                                                            */
/* ------------------------------------------------------------------ */

export { getRulePack, makeRng, rollFormula, findNode, startNode, renderEventNarrative };
export type { RulePack, ScriptChoice, SessionState, CheckResult, EventFireRecord };

