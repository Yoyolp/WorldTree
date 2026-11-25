/**
 * 世界树 · 判定策略（纯函数）
 *
 * 规则书千差万别，但「怎么掷、怎么算成功」其实收敛成几大类。
 * 这里把每一类抽成一个**策略**，规则包只负责「选哪个策略 + 填参数」：
 *
 *   d100-threshold   百分骰 ≤ 目标值（COC 全系、无限恐怖、【C】系列）
 *   d20-threshold    单骰 ≤ 目标值（DnD 属性检定、叙事包）
 *   dice-pool        n 个 dN，数「≥ 阈值」的个数（WoD / 影之诗 / 骰池类）
 *   sum-compare      加总值 + 修正 vs 难度（PbtA 2d6+属性、Savage Worlds）
 *
 * 每个策略都是纯函数：给定 surfaces（随机源）与参数，返回 ResolutionResult。
 * 插件若需要矩阵骰、命运骰这类形态，可以在自己的模块里实现
 * `resolve(ctx)` 覆盖默认分发（见 rulepacks 的 strategy: 'custom'）。
 */

import type { CheckDifficulty, CheckOutcome } from './types.js';
import type { Rng } from './dice.js';

/* ------------------------------------------------------------------ */
/* 结果形态                                                            */
/* ------------------------------------------------------------------ */

/** 一次判定的原始掷骰明细，用于日志与可复现记录 */
export interface ResolutionRoll {
  /** 掷出的各个骰面 */
  dice: number[];
  /** 加值 / 减值合计 */
  modifier: number;
  /** 取用的最终值（阈值类用这个跟目标比） */
  value: number;
  /** 失败重掷时为 true */
  pushed?: boolean;
}

/** 策略输出的「中立」结果：具体成功等级由规则包的分级表决定 */
export interface ResolutionResult {
  roll: ResolutionRoll;
  /** 供分级表使用的原始数值（阈值类=骰值，骰池=成功数，加总=总值） */
  basis: number;
  /** 目标值（难度调整后），用于展示 */
  target: number;
  /** 策略自认为的等级（可选；为空时由 gradeOutcome 统一判定） */
  outcome?: CheckOutcome;
  /** 展示用明细片段，如「掷出 42，目标 60」 */
  detailParts: string[];
  /** 所有候选骰值（COC 奖励/惩罚骰时可能有多个） */
  candidates?: number[];
}

/** 策略执行所需的上下文 */
export interface ResolutionContext {
  skill: string;
  /** 技能原始值（未做难度折减） */
  target: number;
  difficulty: CheckDifficulty;
  /** 正数=奖励，负数=惩罚 */
  bonus: number;
  rng: Rng;
  /** 规则包参数（各策略自定义字段） */
  params: Record<string, unknown>;
  /** 失败重掷 */
  pushed?: boolean;
}

/** 一个判定策略 */
export interface ResolutionStrategy {
  id: string;
  name: string;
  /** 人类可读的说明，会展示在规则包详情里 */
  description: string;
  resolve(ctx: ResolutionContext): ResolutionResult;
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function rollDie(sides: number, rng: Rng): number {
  return Math.floor(rng() * sides) + 1;
}

function num(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== null && v !== '' ? n : fallback;
}

function bool(params: Record<string, unknown>, key: string, fallback = false): boolean {
  const v = params[key];
  return typeof v === 'boolean' ? v : fallback;
}

/**
 * 难度折减：把「目标值」按难度缩到更严的档位。
 *
 * **默认不做折减**，只有插件显式给了 `difficultyDivisor` 才生效：
 *
 * COC7 的难度是靠「成功等级秩比较」实现的（掷出困难成功才算过困难检定），
 * 目标值本身保持技能原值。如果这里再除一次，等于把难度应用了两遍，
 * 困难检定会变得几乎不可能通过。
 *
 * 例外是那些没有成功等级概念的体系（骰池、加总值），它们只能靠改目标值
 * 来体现难度，这时才用 `{ hard: 2, extreme: 5 }` 这种配置。
 */
export function applyDifficultyDivisor(
  target: number,
  difficulty: CheckDifficulty,
  params: Record<string, unknown> = {},
): number {
  if (difficulty === 'regular') return target;
  const map = params.difficultyDivisor as Record<string, number> | undefined;
  if (!map) return target;
  const div = Number(map[difficulty]) || 1;
  return Math.max(1, Math.floor(target / div));
}

/* ------------------------------------------------------------------ */
/* 策略 1：d100 阈值                                                    */
/* ------------------------------------------------------------------ */

/**
 * 百分骰 ≤ 目标即成功。
 *
 * 支持 COC7 的奖励/惩罚骰：个位骰固定，十位骰掷 N 次，
 * 奖励取最小、惩罚取最大。不支持奖励骰的体系把 bonus 强制归零。
 */
export const d100Threshold: ResolutionStrategy = {
  id: 'd100-threshold',
  name: 'd100 阈值',
  description: '掷 1d100，小于等于目标值即成功；可选奖励/惩罚骰（多组十位骰取极值）。',
  resolve(ctx) {
    const useBonus = bool(ctx.params, 'bonusPenalty', false);
    const bonus = useBonus ? Math.max(-2, Math.min(2, ctx.bonus ?? 0)) : 0;
    const target = applyDifficultyDivisor(ctx.target, ctx.difficulty, ctx.params);

    const unit = rollDie(10, ctx.rng) - 1;
    const tensCount = 1 + Math.abs(bonus);
    const candidates: number[] = [];
    for (let i = 0; i < tensCount; i++) {
      const tens = rollDie(10, ctx.rng) - 1;
      let v = tens * 10 + unit;
      // 00 + 0 = 100
      if (v === 0) v = 100;
      candidates.push(v);
    }

    const roll = bonus >= 0 ? Math.min(...candidates) : Math.max(...candidates);

    const detailParts: string[] = [`掷出 ${roll}`, `目标 ${target}`];
    if (useBonus && bonus) detailParts.push(bonus > 0 ? `${bonus} 个奖励骰` : `${-bonus} 个惩罚骰`);
    if (candidates.length > 1) detailParts.push(`候选 ${candidates.join('/')}`);

    return {
      roll: { dice: candidates, modifier: 0, value: roll, pushed: ctx.pushed },
      basis: roll,
      target,
      detailParts,
      candidates,
    };
  },
};

/* ------------------------------------------------------------------ */
/* 策略 2：单骰阈值（d20 等）                                            */
/* ------------------------------------------------------------------ */

/**
 * 掷 1dN，≤ 目标即成功。
 *
 * 这是 narrative 包真正应该用的东西：声明 dieFaces=20 就掷 d20，
 * 声明 100 就掷 d100。此前的实现把 dieFaces 读进变量后从未使用，
 * 所有规则包都按 d100 掷 —— 文档写 d20、实际掷 d100。
 */
export const dNThreshold: ResolutionStrategy = {
  id: 'dN-threshold',
  name: '单骰阈值',
  description: '掷 1dN（N 由规则包的 dieFaces 指定），小于等于目标值即成功。',
  resolve(ctx) {
    const faces = Math.max(2, num(ctx.params, 'dieFaces', 20));
    const target = applyDifficultyDivisor(ctx.target, ctx.difficulty, ctx.params);

    // 奖励/惩罚骰：掷多次取最优/最差
    const useBonus = bool(ctx.params, 'bonusPenalty', false);
    const bonus = useBonus ? Math.max(-2, Math.min(2, ctx.bonus ?? 0)) : 0;
    const count = 1 + Math.abs(bonus);

    const dice: number[] = [];
    for (let i = 0; i < count; i++) dice.push(rollDie(faces, ctx.rng));

    const roll = bonus >= 0 ? Math.min(...dice) : Math.max(...dice);

    const detailParts: string[] = [`掷出 ${roll}`, `目标 ${target}`, `1d${faces}`];
    if (count > 1) detailParts.push(`候选 ${dice.join('/')}`);

    return {
      roll: { dice, modifier: 0, value: roll, pushed: ctx.pushed },
      basis: roll,
      target,
      detailParts,
      candidates: dice,
    };
  },
};

/* ------------------------------------------------------------------ */
/* 策略 3：骰池成功数                                                   */
/* ------------------------------------------------------------------ */

/**
 * 掷 N 个 d10（或其它面数），数「≥ 阈值」的个数。
 *
 * 覆盖 WoD / 影之诗 / 各类骰池系统。成功数 ≥ 需要的成功数即成功。
 * 可选：掷出 1 时抵消一个成功（botchRule: 'cancel'）。
 */
export const dicePool: ResolutionStrategy = {
  id: 'dice-pool',
  name: '骰池成功数',
  description: '掷 N 个骰子，统计大于等于阈值的个数；个数达到所需成功数即成功。',
  resolve(ctx) {
    const poolSize = Math.max(1, num(ctx.params, 'poolSize', 5));
    const sides = Math.max(2, num(ctx.params, 'poolDieFaces', 10));
    const threshold = num(ctx.params, 'successThreshold', 8);
    const needSuccess = Math.max(1, num(ctx.params, 'successesNeeded', 1));
    const cancel = String(ctx.params.botchRule ?? 'none') === 'cancel';

    // 难度换算成「所需成功数」的增加
    const diffBonus = ctx.difficulty === 'extreme' ? 2 : ctx.difficulty === 'hard' ? 1 : 0;
    const required = needSuccess + diffBonus;

    const dice: number[] = [];
    for (let i = 0; i < poolSize; i++) dice.push(rollDie(sides, ctx.rng));

    let successes = dice.filter((d) => d >= threshold).length;
    if (cancel) {
      const ones = dice.filter((d) => d === 1).length;
      successes = Math.max(0, successes - ones);
    }

    const detailParts: string[] = [
      `掷出 ${dice.join('/')}`,
      `成功 ${successes}`,
      `需 ${required}`,
    ];

    // 骰池的「成功」是成功数达标，不是骰值 ≤ 目标 —— 必须自己给 outcome，
    // 否则会被 cocOutcome 按阈值语义判反（成功数 3 > 目标 2 会被当成失败）。
    let outcome: CheckOutcome;
    if (successes < required) {
      outcome = successes === 0 && cancel ? 'fumble' : 'fail';
    } else if (successes >= required + 2) {
      outcome = 'extreme';
    } else if (successes >= required + 1) {
      outcome = 'hard';
    } else {
      outcome = 'regular';
    }

    return {
      roll: { dice, modifier: 0, value: successes, pushed: ctx.pushed },
      basis: successes,
      // 骰池的目标语义是「需要的成功数」，存进 target 便于统一展示
      target: required,
      outcome,
      detailParts,
      candidates: dice,
    };
  },
};

/* ------------------------------------------------------------------ */
/* 策略 4：加总值对比                                                   */
/* ------------------------------------------------------------------ */

/**
 * 掷若干骰子 + 修正值，与难度值比较。
 *
 * 覆盖 PbtA（2d6+属性，10+/7-9/6- 三档）、Savage Worlds、D&D 的 d20+调整值 等。
 * params:
 *   diceCount  骰子个数（默认 2）
 *   dieSides   骰面（默认 6）
 *   modifier   固定修正（默认 0）
 *   tiers      分档阈值 [{ min, outcome }]，从高到低匹配。
 *              **只有在没有 difficultyThresholds 时才参与判定** ——
 *              否则会把「DC 20 但总值 10」判成成功。
 *   difficultyThresholds  各难度对应的门槛，如 { regular: 10, hard: 15, extreme: 20 }
 *   difficultyThreshold    单一门槛（difficultyThresholds 没给该项时用它）
 *   difficultyShift        把分档线整体推移，如 { hard: 3, extreme: 6 }
 *   criticalOn 骰面等于该值时直接大成功（D&D 的天然 20）
 *   fumbleOn   骰面等于该值时直接大失败（D&D 的天然 1）
 */
export const sumCompare: ResolutionStrategy = {
  id: 'sum-compare',
  name: '加总值对比',
  description: '掷 N 个骰子求和并加上修正值，与难度值比较；可按区间划分成功等级。',
  resolve(ctx) {
    const count = Math.max(1, num(ctx.params, 'diceCount', 2));
    const sides = Math.max(2, num(ctx.params, 'dieSides', 6));
    const modifier = num(ctx.params, 'modifier', 0);

    const dice: number[] = [];
    for (let i = 0; i < count; i++) dice.push(rollDie(sides, ctx.rng));
    const total = dice.reduce((a, b) => a + b, 0) + modifier;

    // 难度 → 门槛：优先查表，其次单值，最后按难度给默认
    const thresholdMap = (ctx.params.difficultyThresholds as Record<string, number> | undefined) ?? {};
    const perDifficulty = Number(thresholdMap[ctx.difficulty]);
    const hasThresholdTable = Object.keys(thresholdMap).length > 0 || ctx.params.difficultyThreshold !== undefined;
    const difficultyValue = Number.isFinite(perDifficulty)
      ? perDifficulty
      : num(
          ctx.params,
          'difficultyThreshold',
          ctx.difficulty === 'extreme' ? 12 : ctx.difficulty === 'hard' ? 10 : 8,
        );

    // 分档线整体推移（只在用 tiers 时有意义）
    const shiftMap = (ctx.params.difficultyShift as Record<string, number> | undefined) ?? {};
    const shift = ctx.difficulty === 'regular' ? 0 : Number(shiftMap[ctx.difficulty]) || 0;

    // 天然大成功 / 大失败：优先于一切数值判定
    const critOn = Number(ctx.params.criticalOn);
    const fumbleOn = Number(ctx.params.fumbleOn);
    const naturalCrit = Number.isFinite(critOn) && dice.includes(critOn);
    const naturalFumble = Number.isFinite(fumbleOn) && dice.includes(fumbleOn);

    const tiers = (ctx.params.tiers as { min: number; outcome: CheckOutcome }[] | undefined) ?? [];
    const sorted = [...tiers].sort((a, b) => b.min - a.min);
    // 有门槛表时，tiers 不参与判定（否则 DC 会被绕过）
    const hit = hasThresholdTable ? undefined : sorted.find((t) => total >= t.min + shift);

    const detailParts: string[] = [
      `${dice.join('+')}${modifier ? (modifier > 0 ? `+${modifier}` : String(modifier)) : ''} = ${total}`,
      `难度 ${difficultyValue}`,
    ];
    if (shift) detailParts.push(`阈值 +${shift}`);
    if (naturalCrit) detailParts.push('天然大成功');

    // 加总值是「越大越好」，跟阈值类的「越小越好」方向相反，
    // 所以没给 tiers 时必须自己判，不能留给 cocOutcome（它按 ≤ 目标算成功）。
    let outcome: CheckOutcome;
    if (naturalCrit) {
      outcome = 'critical';
    } else if (naturalFumble) {
      outcome = 'fumble';
    } else if (hit) {
      outcome = hit.outcome;
    } else if (total < difficultyValue + shift) {
      outcome = 'fail';
    } else if (hasThresholdTable) {
      // 有门槛表但没给 tiers：按「超出 DC 多少」分档（D&D 每 5 点一档）
      const gradeMap = (ctx.params.marginGrades as Record<string, number> | undefined) ?? {
        hard: 5,
        extreme: 10,
      };
      const over = total - (difficultyValue + shift);
      if (over >= (Number(gradeMap.extreme) || 10)) outcome = 'extreme';
      else if (over >= (Number(gradeMap.hard) || 5)) outcome = 'hard';
      else outcome = 'regular';
    } else {
      outcome = 'regular';
    }

    return {
      roll: { dice, modifier, value: total, pushed: ctx.pushed },
      basis: total,
      target: difficultyValue + shift,
      outcome,
      detailParts,
      candidates: dice,
    };
  },
};

/* ------------------------------------------------------------------ */
/* 注册表                                                              */
/* ------------------------------------------------------------------ */

export const STRATEGIES: Record<string, ResolutionStrategy> = {
  'd100-threshold': d100Threshold,
  'dN-threshold': dNThreshold,
  'dice-pool': dicePool,
  'sum-compare': sumCompare,
};

export const STRATEGY_LIST: ResolutionStrategy[] = Object.values(STRATEGIES);

export function getStrategy(id: string | undefined | null): ResolutionStrategy | undefined {
  return id ? STRATEGIES[id] : undefined;
}

/**
 * 允许外部（插件）注册新的判定策略。
 *
 * 插件模块若导出 `strategy` 对象，加载器会调用这里注册；
 * 之后规则包只需写 `strategy: '我的策略id'`。
 */
export function registerStrategy(strategy: ResolutionStrategy): void {
  STRATEGIES[strategy.id] = strategy;
}

/** 按 strategy id 解析；未知策略回落到 d100（最保守，不会崩） */
export function resolveWithStrategy(
  strategyId: string | undefined | null,
  ctx: ResolutionContext,
): ResolutionResult {
  const strategy = getStrategy(strategyId) ?? d100Threshold;
  return strategy.resolve(ctx);
}
