/**
 * 世界树 · 骰子与检定（纯函数，前后端共用）
 *
 * 所有随机都通过传入的 rng 产生，便于用种子复现同一条世界线的结果。
 */

import type {
  CheckDifficulty,
  CheckOutcome,
  CheckResult,
  CocSheet,
  DiceRoll,
  RulePack,
} from './types.js';
import { resolveWithStrategy } from './resolution.js';

export type Rng = () => number;

export const defaultRng: Rng = () => Math.random();

/* ------------------------------------------------------------------ */
/* 基础骰子                                                            */
/* ------------------------------------------------------------------ */

export function rollDie(sides: number, rng: Rng = defaultRng): number {
  return Math.floor(rng() * sides) + 1;
}

const DICE_RE = /(\d*)\s*[dD]\s*(\d+)((?:\s*[+-]\s*\d+)*)/;

/** 掷形如 2d6+3 / 1d100 / d20-1 的表达式 */
export function rollFormula(formula: string, label = '投骰', rng: Rng = defaultRng): DiceRoll {
  const cleaned = formula.replace(/\s+/g, '');
  const m = cleaned.match(DICE_RE);

  if (!m) {
    const n = Number(cleaned);
    return {
      formula,
      rolls: [],
      total: Number.isFinite(n) ? n : 0,
      label,
      detail: '非骰子表达式，按常量处理',
    };
  }

  const count = Math.min(Number(m[1] || 1), 50);
  const sides = Math.max(2, Number(m[2] || 6));
  const modifier = m[3]
    ? m[3].split(/(?=[+-])/).reduce((acc, part) => acc + Number(part || 0), 0)
    : 0;

  const rolls: number[] = [];
  for (let i = 0; i < count; i++) rolls.push(rollDie(sides, rng));

  const total = rolls.reduce((a, b) => a + b, 0) + modifier;
  return {
    formula: `${count}d${sides}${modifier ? (modifier > 0 ? `+${modifier}` : String(modifier)) : ''}`,
    rolls,
    total,
    modifier,
    label,
  };
}

/** 解析并掷出 effects 里的 "-1d3" / "+2" 这类数值 */
export function rollDelta(expr: string | number, rng: Rng = defaultRng): number {
  if (typeof expr === 'number') return expr;
  const cleaned = String(expr).trim();
  if (/^[+-]?\d+$/.test(cleaned)) return Number(cleaned);
  const negative = cleaned.startsWith('-');
  const body = cleaned.replace(/^[+-]/, '');
  const r = rollFormula(body, 'delta', rng);
  return negative ? -r.total : r.total;
}

/* ------------------------------------------------------------------ */
/* 检定                                                                */
/* ------------------------------------------------------------------ */

export const OUTCOME_LABELS: Record<CheckOutcome, string> = {
  critical: '大成功',
  extreme: '极难成功',
  hard: '困难成功',
  regular: '成功',
  fail: '失败',
  fumble: '大失败',
};

export const DIFFICULTY_LABELS: Record<CheckDifficulty, string> = {
  regular: '常规',
  hard: '困难',
  extreme: '极难',
};

const OUTCOME_RANK: Record<CheckOutcome, number> = {
  fumble: 0,
  fail: 1,
  regular: 2,
  hard: 3,
  extreme: 4,
  critical: 5,
};

const DIFFICULTY_RANK: Record<CheckDifficulty, number> = {
  regular: 2,
  hard: 3,
  extreme: 4,
};

/** 判定单个 d100 结果对应的成功等级 */
export function cocOutcome(roll: number, target: number, pack: RulePack): CheckOutcome {
  // 规则包若自带分档表，完全按表判（支持 10+/7-9 这类非数值体系）
  if (pack.outcomeBands?.length) {
    const hit = pack.outcomeBands.find((b) => roll >= b.min && (b.max === undefined || roll <= b.max));
    return hit?.outcome ?? 'fail';
  }

  const critical = pack.criticalValue ?? 1;
  const fumble = pack.fumbleValue ?? 100;
  if (roll === critical) return 'critical';
  if (roll === fumble) return 'fumble';
  // 简化体系：不细分困难/极难，只留成功与失败两档
  if (pack.simpleOutcome) return roll <= target ? 'regular' : 'fail';
  if (roll <= Math.floor(target / 5)) return 'extreme';
  if (roll <= Math.floor(target / 2)) return 'hard';
  if (roll <= target) return 'regular';
  // 低技能时扩大大失败区间（COC7 可选规则：技能 < 50 时 96-100 为大失败）
  if (pack.fumbleRange && target < pack.fumbleRange.below && roll >= pack.fumbleRange.from) {
    return 'fumble';
  }
  return 'fail';
}

export interface CheckOptions {
  skill: string;
  target: number;
  difficulty?: CheckDifficulty;
  /** 正数=奖励骰，负数=惩罚骰 */
  bonus?: number;
  /** 孤注一掷：失败后重掷，失败代价加倍 */
  pushed?: boolean;
  rng?: Rng;
  pack: RulePack;
}

/** 执行一次检定 */
export function performCheck(opts: CheckOptions): CheckResult {
  const { skill, target, pack } = opts;
  const rng = opts.rng ?? defaultRng;
  const difficulty: CheckDifficulty = pack.difficulties ? opts.difficulty ?? 'regular' : 'regular';

  // 走插件化的判定策略：规则包只声明「用哪个策略 + 填参数」，
  // 具体掷骰形态由策略决定（d100 / dN / 骰池 / 加总）。
  const strategyId = pack.strategy ?? (pack.dieFaces === 20 ? 'dN-threshold' : 'd100-threshold');
  const resolution = resolveWithStrategy(strategyId, {
    skill,
    target,
    difficulty,
    bonus: opts.bonus ?? 0,
    rng,
    params: {
      ...(pack.strategyParams ?? {}),
      // 这几个是平台统一注入的，插件不必重复写
      dieFaces: pack.dieFaces,
      bonusPenalty: pack.bonusPenalty,
    },
    pushed: opts.pushed,
  });

  // 等级判定：策略若自己给了 outcome（分档表命中），优先用它
  const outcome = resolution.outcome ?? cocOutcome(resolution.basis, resolution.target, pack);

  const success = pack.difficulties
    ? OUTCOME_RANK[outcome] >= DIFFICULTY_RANK[difficulty] && outcome !== 'fumble'
    : outcome !== 'fail' && outcome !== 'fumble';

  const label = OUTCOME_LABELS[outcome];
  const bits = [...resolution.detailParts];
  if (pack.difficulties && difficulty !== 'regular') {
    bits.push(`${DIFFICULTY_LABELS[difficulty]}难度`);
  }

  return {
    skill,
    target: resolution.target,
    difficulty,
    bonus: pack.bonusPenalty ? Math.max(-2, Math.min(2, opts.bonus ?? 0)) : 0,
    candidates: resolution.candidates ?? [resolution.basis],
    roll: resolution.basis,
    outcome,
    success,
    label,
    pushed: opts.pushed,
    detail: bits.join('，'),
  };
}

/** 消耗幸运改判：每 1 点幸运换 1 点差额 */
export function spendLuckToSucceed(check: CheckResult, availableLuck: number): { check: CheckResult; spent: number } | null {
  if (check.success) return null;
  const needed = check.roll - check.target;
  if (needed <= 0 || needed > availableLuck) return null;
  const newRoll = check.roll - needed;
  const outcome: CheckOutcome = newRoll <= Math.floor(check.target / 5) ? 'extreme' : newRoll <= Math.floor(check.target / 2) ? 'hard' : 'regular';
  return {
    check: {
      ...check,
      roll: newRoll,
      outcome,
      success: true,
      label: `${OUTCOME_LABELS[outcome]}（消耗幸运）`,
      luckSpent: needed,
      detail: `${check.detail}，消耗 ${needed} 点幸运改判`,
    },
    spent: needed,
  };
}

/* ------------------------------------------------------------------ */
/* 技能查表                                                            */
/* ------------------------------------------------------------------ */

export function resolveSkillValue(sheet: CocSheet | undefined, skill: string): number | null {
  if (!sheet) return null;
  const exact = sheet.skills.find((s) => s.name === skill);
  if (exact) return exact.value;
  const loose = sheet.skills.find((s) => s.name.includes(skill) || skill.includes(s.name));
  if (loose) return loose.value;

  // 属性：先精确匹配（大小写不敏感），再忽略大小写找一次
  const key = skill.trim();
  if (typeof sheet.attributes[key] === 'number') return sheet.attributes[key];
  const upper = key.toUpperCase();
  const hit = Object.keys(sheet.attributes).find((k) => k.toUpperCase() === upper);
  if (hit) return sheet.attributes[hit];
  // 允许直接用属性键做检定（D&D 的「力量检定」）
  const byLabel = Object.keys(sheet.attributes).find((k) => k === key);
  return byLabel ? sheet.attributes[byLabel] : null;
}

/** 目标值 → 难度阈值 */
export function difficultyTarget(target: number, difficulty: CheckDifficulty = 'regular'): number {
  if (difficulty === 'hard') return Math.floor(target / 2);
  if (difficulty === 'extreme') return Math.floor(target / 5);
  return target;
}
