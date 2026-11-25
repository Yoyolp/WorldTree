/**
 * 世界树 · COC 7 版检定引擎（完整）
 *
 * 这里放的都是纯函数：给定状态与随机源，返回结果，不碰数据库、不发请求。
 * 覆盖：
 *   - 理智检定（SAN check）与疯狂
 *   - 对抗检定（opposed）
 *   - 战斗：先攻、攻击对抗闪避/格斗、伤害、重伤、濒死
 *   - 团队检定（领队 + 帮手奖励骰）
 *   - 连续检定（累计成功数）
 *   - 技能成长（幕间提升）
 */

import { rollDelta, rollDie, type Rng } from './dice.js';
import { resourceMax, resourceValue } from './sheet.js';
import type {
  CheckDifficulty,
  CheckOutcome,
  CheckResult,
  CocSheet,
  CombatState,
  Combatant,
  RulePack,
} from './types.js';

/* ------------------------------------------------------------------ */
/* 基础                                                                */
/* ------------------------------------------------------------------ */

const OUTCOME_RANK: Record<CheckOutcome, number> = {
  fumble: -1,
  fail: 0,
  regular: 1,
  hard: 2,
  extreme: 3,
  critical: 4,
};

export function outcomeRank(o: CheckOutcome): number {
  return OUTCOME_RANK[o] ?? 0;
}

export const COMBAT_SKILLS = ['格斗', '射击', '闪避'] as const;

/* ------------------------------------------------------------------ */
/* 理智检定                                                            */
/* ------------------------------------------------------------------ */

export interface SanCheckSpec {
  /** 成功时损失的表达式，如 "0" / "1d4" */
  successLoss?: string;
  /** 失败时损失的表达式，如 "1d10" */
  failLoss: string;
  /** 触发源描述，写进日志 */
  reason?: string;
}

export interface SanCheckOutcome {
  /** 以当前 SAN 值为目标掷的那一次 d100 */
  check: CheckResult;
  /** 实际扣除的理智值 */
  loss: number;
  /** 损失的表达式（如 1/1d10） */
  expression: string;
  /** 是否陷入临时疯狂 */
  temporaryInsane: boolean;
  /** 疯狂发作的表现 */
  bout?: string;
  /** 是否永久疯狂（SAN 归零） */
  permanentInsane: boolean;
  /** 新的理智值 */
  sanAfter: number;
  detail: string;
}

const BOUTS = [
  '失忆：醒来时不知道自己刚才做了什么。',
  '假性残疾：坚信自己失明或失去了一条腿。',
  '暴力倾向：对最近的活物产生无法抑制的攻击冲动。',
  '偏执：认定在场的每个人都是同谋。',
  '重要之人：把眼前的人认成自己失去的那个。',
  '昏厥：当场失去意识。',
  '恐慌逃窜：不顾一切地远离，直到再也跑不动。',
  '歇斯底里：大笑、大哭，或两者交替。',
  '恐惧症：从此对某个具体的事物产生病态恐惧。',
  '狂热：对某个符号或存在产生近乎宗教的皈依感。',
];

/**
 * 理智检定：以当前 SAN 为目标掷骰。
 * 失败按 failLoss 扣，成功按 successLoss 扣（COC7 里是「1/1d10」这种写法）。
 * 单次损失 ≥5 → 临时疯狂（INT 检定失败才发作）。
 *
 * SAN 用哪个资源、疯狂判定用哪个属性，都由规则包声明：
 *  - `sanityResource`（默认 'san'）
 *  - `sanityBoutAttribute`（默认 'INT'）
 * 这样换成「理智/意志」叫法不同的规则书也不用改代码。
 */
export function sanCheck(
  sheet: CocSheet,
  spec: SanCheckSpec,
  pack: RulePack,
  rng: Rng,
  rollSkill: (skill: string, target: number, difficulty?: CheckDifficulty) => CheckResult,
): SanCheckOutcome {
  const sanKey = pack.sanityResource || 'san';
  const sanCur = resourceValue(sheet, sanKey);
  const sanCap = resourceMax(sheet, sanKey) || sanCur;
  const target = Math.max(1, Math.min(99, sanCur));
  const check = rollSkill('理智', target, 'regular');

  const failExpr = spec.failLoss || '1d6';
  const successExpr = spec.successLoss ?? '0';
  const expression = `${successExpr}/${failExpr}`;

  const lossExpr = check.success ? successExpr : failExpr;
  const loss = lossExpr === '0' || !lossExpr ? 0 : Math.max(0, rollDelta(lossExpr, rng));

  const sanAfter = Math.max(0, sanCur - loss);
  const temporaryInsane = loss >= 5 && pack.sanity;

  let bout: string | undefined;
  if (temporaryInsane) {
    // 临时疯狂：INT 检定「成功反而糟糕」——记住了才疯
    const boutKey = pack.sanityBoutAttribute || 'INT';
    const intTarget = sheet.attributes[boutKey] ?? sheet.attributes[boutKey.toUpperCase()] ?? 50;
    const intCheck = rollSkill('智力', intTarget, 'regular');
    if (intCheck.success) bout = BOUTS[rollDie(BOUTS.length, rng) - 1];
  }

  const permanentInsane = sanAfter <= 0;
  void sanCap;

  const bits = [`理智检定 ${check.roll}/${target}`, check.label, `失去 ${loss} 点理智`];
  if (temporaryInsane) bits.push(bout ? `临时疯狂：${bout}` : '临时疯狂（未发作）');
  if (permanentInsane) bits.push('永久疯狂');

  return {
    check,
    loss,
    expression,
    temporaryInsane,
    bout,
    permanentInsane,
    sanAfter,
    detail: bits.join('，'),
  };
}

/* ------------------------------------------------------------------ */
/* 对抗检定                                                            */
/* ------------------------------------------------------------------ */

export interface OpposedInput {
  /** 主动方 */
  actor: { name: string; skill: string; target: number; difficulty?: CheckDifficulty };
  /** 被动方 */
  target: { name: string; skill: string; target: number; difficulty?: CheckDifficulty };
}

export interface OpposedOutcome {
  actorCheck: CheckResult;
  targetCheck: CheckResult;
  /** 谁赢了；平局时为 'tie' */
  winner: 'actor' | 'target' | 'tie';
  /** 差值（成功等级之差） */
  margin: number;
  detail: string;
}

/**
 * 对抗检定：双方各掷，比成功等级；同级时技能值高者胜。
 */
export function opposedCheck(
  input: OpposedInput,
  rollSkill: (skill: string, target: number, difficulty?: CheckDifficulty) => CheckResult,
): OpposedOutcome {
  const actorCheck = rollSkill(input.actor.skill, input.actor.target, input.actor.difficulty ?? 'regular');
  const targetCheck = rollSkill(input.target.skill, input.target.target, input.target.difficulty ?? 'regular');

  const ra = outcomeRank(actorCheck.outcome);
  const rt = outcomeRank(targetCheck.outcome);

  let winner: OpposedOutcome['winner'] = 'tie';
  let margin = ra - rt;

  if (ra !== rt) {
    winner = ra > rt ? 'actor' : 'target';
  } else if (ra > 0) {
    // 同级：技能值高者胜
    if (input.actor.target !== input.target.target) {
      winner = input.actor.target > input.target.target ? 'actor' : 'target';
      margin = 0;
    }
  }

  const who =
    winner === 'actor' ? input.actor.name : winner === 'target' ? input.target.name : '平手';
  const detail =
    `${input.actor.name} ${input.actor.skill} ${actorCheck.roll}/${input.actor.target}（${actorCheck.label}）` +
    ` vs ${input.target.name} ${input.target.skill} ${targetCheck.roll}/${input.target.target}（${targetCheck.label}）` +
    ` → ${who}`;

  return { actorCheck, targetCheck, winner, margin, detail };
}

/* ------------------------------------------------------------------ */
/* 战斗                                                                */
/* ------------------------------------------------------------------ */

/** 伤害加值：按 STR+SIZ 查表 */
export function damageBonus(str: number, siz: number): string {
  const total = str + siz;
  if (total <= 64) return '-2';
  if (total <= 84) return '-1';
  if (total <= 124) return '0';
  if (total <= 164) return '1d4';
  if (total <= 204) return '1d6';
  return '2d6';
}

export interface Weapon {
  name: string;
  damage: string;
  /** 使用哪个技能 */
  skill: string;
  /** 是否吃伤害加值 */
  usesDb?: boolean;
  range?: string;
}

export const WEAPONS: Record<string, Weapon> = {
  拳头: { name: '拳头', damage: '1d3', skill: '格斗', usesDb: true },
  踢击: { name: '踢击', damage: '1d3', skill: '格斗', usesDb: true },
  小刀: { name: '小刀', damage: '1d4', skill: '格斗', usesDb: true },
  棍棒: { name: '棍棒', damage: '1d6', skill: '格斗', usesDb: true },
  斧头: { name: '斧头', damage: '1d8+2', skill: '格斗', usesDb: true },
  手枪: { name: '手枪', damage: '1d10', skill: '射击', range: '15 码' },
  步枪: { name: '步枪', damage: '2d6', skill: '射击', range: '50 码' },
  霰弹枪: { name: '霰弹枪', damage: '4d6', skill: '射击', range: '10 码' },
};

/** 把 "1d8+db" 里的 db 替换成实际表达式 */
export function resolveDamageExpr(weapon: Weapon, db: string): string {
  let expr = weapon.damage;
  if (!weapon.usesDb) return expr;
  if (db === '0') return expr;
  if (db.startsWith('-')) {
    // 负数加值：直接扣固定值
    const n = Number(db);
    return `${expr}${n}`; // 如 "1d4-1"
  }
  return `${expr}+${db}`;
}

export interface AttackResult {
  attack: CheckResult;
  defense?: CheckResult;
  hit: boolean;
  /** 是否暴击（极难成功） */
  critical: boolean;
  damage: number;
  damageExpr: string;
  /** 是否造成重伤 */
  majorWound: boolean;
  /** 目标是否进入濒死 */
  dying: boolean;
  detail: string;
}

/**
 * 一次攻击：攻击方掷格斗/射击，防守方可以选择闪避或格斗反击。
 * 规则：攻击成功且防守失败 → 命中；反击成功且攻击失败 → 防守方反伤（此处仅标记）。
 */
export function resolveAttack(input: {
  weapon: Weapon;
  attacker: { name: string; skillValue: number; db: string; difficulty?: CheckDifficulty };
  defender: { name: string; skill: string; skillValue: number; hp: number; hpMax: number };
  defenderChoice?: 'dodge' | 'fightBack';
  rng: Rng;
  rollSkill: (skill: string, target: number, difficulty?: CheckDifficulty) => CheckResult;
}): AttackResult {
  const { weapon, attacker, defender, rng } = input;
  const attack = input.rollSkill(weapon.skill, attacker.skillValue, attacker.difficulty ?? 'regular');

  const defenseSkill = (input.defenderChoice ?? 'dodge') === 'fightBack' ? '格斗' : '闪避';
  const defense = input.rollSkill(defenseSkill, defender.skillValue, 'regular');

  const ar = outcomeRank(attack.outcome);
  const dr = outcomeRank(defense.outcome);

  // 大失败直接算失手并可能自伤（这里只记录）
  const hit = ar > dr && ar > 0;
  const critical = attack.outcome === 'extreme' || attack.outcome === 'critical';

  let damage = 0;
  let damageExpr = resolveDamageExpr(weapon, attacker.db);
  if (hit) {
    if (critical && !damageExpr.includes('d')) {
      // 固定伤害的暴击：最大化
      damage = Number(damageExpr) || 0;
    } else {
      damage = Math.max(0, rollDelta(damageExpr, rng));
      if (critical) damage = Math.max(damage, Math.floor(damage * 1.5));
    }
  }

  const majorWound = damage >= Math.max(1, Math.ceil(defender.hpMax / 2));
  const dying = defender.hp - damage <= 0;

  const bits = [
    `${weapon.name}：${attack.skill} ${attack.roll}/${attacker.skillValue}（${attack.label}）`,
    `对 ${defender.name} 的${defenseSkill} ${defense.roll}/${defender.skillValue}（${defense.label}）`,
    hit ? `命中，伤害 ${damage}（${damageExpr}）` : '未命中',
  ];
  if (majorWound) bits.push('造成重伤');
  if (dying) bits.push('目标濒死');

  return { attack, defense, hit, critical, damage, damageExpr, majorWound, dying, detail: bits.join('，') };
}

/** 濒死：每轮体质检定，失败即死亡 */
export function dyingCheck(
  sheet: CocSheet,
  rng: Rng,
  rollSkill: (skill: string, target: number, difficulty?: CheckDifficulty) => CheckResult,
): { survived: boolean; check: CheckResult; detail: string } {
  const conKey = 'CON';
  const con = sheet.attributes[conKey] ?? sheet.attributes[conKey.toLowerCase()] ?? 50;
  const check = rollSkill('体质', con, 'regular');
  return {
    survived: check.success,
    check,
    detail: `濒死体质检定 ${check.roll}/${con}（${check.label}）→ ${check.success ? '撑住了' : '死亡'}`,
  };
}

/* ------------------------------------------------------------------ */
/* 战斗状态                                                            */
/* ------------------------------------------------------------------ */

export function makeCombatant(input: {
  id: string;
  name: string;
  memberId?: string | null;
  dex: number;
  hp: number;
  hpMax: number;
}): Combatant {
  return {
    id: input.id,
    name: input.name,
    memberId: input.memberId ?? null,
    dex: input.dex,
    hp: input.hp,
    hpMax: input.hpMax,
    initiative: input.dex,
    majorWound: false,
    dying: false,
    unconscious: false,
    conditions: [],
  };
}

/** 按 DEX 从高到低排先攻 */
export function rollInitiative(combatants: Combatant[], rng: Rng): Combatant[] {
  return [...combatants]
    .map((c) => ({ ...c, initiative: c.dex + rollDie(10, rng) / 10 }))
    .sort((a, b) => b.initiative - a.initiative);
}

export function startCombat(combatants: Combatant[], rng: Rng): CombatState {
  const ordered = rollInitiative(combatants, rng);
  return {
    active: true,
    round: 1,
    order: ordered.map((c) => c.id),
    turnIndex: 0,
    combatants: ordered,
    log: [`战斗开始：${ordered.map((c) => `${c.name}(DEX ${c.dex})`).join(' → ')}`],
  };
}

export function currentCombatant(combat: CombatState): Combatant | null {
  const id = combat.order[combat.turnIndex];
  return combat.combatants.find((c) => c.id === id) ?? null;
}

/** 把伤害应用到战斗单位上，处理重伤/濒死/昏迷 */
export function applyDamage(
  combatant: Combatant,
  damage: number,
  majorWound: boolean,
): { combatant: Combatant; notes: string[] } {
  const notes: string[] = [];
  const hp = Math.max(0, combatant.hp - damage);
  const next: Combatant = { ...combatant, hp, conditions: [...combatant.conditions] };

  if (majorWound && !next.majorWound) {
    next.majorWound = true;
    next.conditions.push('重伤');
    notes.push(`${next.name} 遭受重伤`);
  }
  if (hp <= 0 && !next.dying) {
    next.dying = true;
    next.conditions.push('濒死');
    notes.push(`${next.name} 陷入濒死`);
  } else if (hp === 0 && next.dying) {
    next.unconscious = true;
    next.conditions.push('昏迷');
    notes.push(`${next.name} 昏迷`);
  }
  return { combatant: next, notes };
}

/** 推进到下一个行动者，一轮结束则 round+1 */
export function advanceCombatTurn(combat: CombatState): CombatState {
  let index = combat.turnIndex + 1;
  let round = combat.round;
  if (index >= combat.order.length) {
    index = 0;
    round += 1;
  }
  return { ...combat, turnIndex: index, round };
}

/* ------------------------------------------------------------------ */
/* 团队检定                                                            */
/* ------------------------------------------------------------------ */

export interface TeamCheckOutcome {
  leaderCheck: CheckResult;
  /** 帮手数量（最多 2 个奖励骰） */
  helpers: number;
  bonus: number;
  success: boolean;
  detail: string;
}

/**
 * 团队检定：由技能最高的人领队，每个帮手给 1 个奖励骰（最多 2）。
 * 全员失败才算失败。
 */
export function teamCheck(input: {
  skill: string;
  members: { name: string; value: number }[];
  rollSkill: (skill: string, target: number, difficulty?: CheckDifficulty, bonus?: number) => CheckResult;
}): TeamCheckOutcome {
  if (!input.members.length) {
    throw new Error('团队检定需要至少一名成员');
  }
  const sorted = [...input.members].sort((a, b) => b.value - a.value);
  const leader = sorted[0];
  const helpers = Math.min(2, sorted.length - 1);
  const leaderCheck = input.rollSkill(input.skill, leader.value, 'regular', helpers);

  return {
    leaderCheck,
    helpers,
    bonus: helpers,
    success: leaderCheck.success,
    detail:
      `团队检定：${leader.name} 领队 ${input.skill} ${leaderCheck.roll}/${leader.value}` +
      (helpers ? `（${helpers} 个奖励骰）` : '') +
      ` → ${leaderCheck.label}`,
  };
}

/* ------------------------------------------------------------------ */
/* 连续检定                                                            */
/* ------------------------------------------------------------------ */

export interface ExtendedCheckState {
  skill: string;
  /** 需要累计的成功次数 */
  required: number;
  /** 已累计 */
  progress: number;
  /** 允许的失败次数 */
  failuresAllowed: number;
  failures: number;
  done: boolean;
  failed: boolean;
}

export function startExtendedCheck(input: {
  skill: string;
  required: number;
  failuresAllowed?: number;
}): ExtendedCheckState {
  return {
    skill: input.skill,
    required: Math.max(1, input.required),
    progress: 0,
    failuresAllowed: input.failuresAllowed ?? 0,
    failures: 0,
    done: false,
    failed: false,
  };
}

export function progressExtended(
  state: ExtendedCheckState,
  check: CheckResult,
): { state: ExtendedCheckState; detail: string } {
  const next: ExtendedCheckState = { ...state };
  if (check.success) {
    // 极难/大成功算 2 次进度
    const step = outcomeRank(check.outcome) >= 3 ? 2 : 1;
    next.progress = Math.min(next.required, next.progress + step);
  } else {
    next.failures += 1;
  }
  next.done = next.progress >= next.required;
  next.failed = !next.done && next.failures > next.failuresAllowed;
  return {
    state: next,
    detail: `连续检定 ${next.skill}：${next.progress}/${next.required}${next.done ? '（完成）' : next.failed ? '（中断）' : ''}`,
  };
}

/* ------------------------------------------------------------------ */
/* 技能成长                                                            */
/* ------------------------------------------------------------------ */

export interface ImprovementResult {
  skill: string;
  before: number;
  roll: number;
  grew: boolean;
  gained: number;
  after: number;
  detail: string;
}

/**
 * 技能成长：幕间对「用过且成功过」的技能各掷一次 d100。
 * 掷出 > 当前技能值（或 >95）→ +1d10。
 */
export function improvementCheck(skill: string, value: number, rng: Rng): ImprovementResult {
  const roll = rollDie(100, rng);
  const threshold = Math.min(value, 95);
  const grew = roll > threshold || roll > 95;
  const gained = grew ? 1 + rollDie(10, rng) : 0;
  const after = Math.min(99, value + gained);
  return {
    skill,
    before: value,
    roll,
    grew,
    gained,
    after,
    detail: `技能成长 ${skill}：掷 ${roll} vs ${threshold} → ${grew ? `+${gained}（${value}→${after}）` : '无提升'}`,
  };
}

/** 从技能表里取出值；技能表里没有时回落到属性，最后才返回 null */
export function skillValueOf(sheet: CocSheet | undefined, skill: string): number | null {
  if (!sheet) return null;
  const hit = sheet.skills.find((s) => s.name === skill);
  if (hit) return hit.value;
  // 允许直接拿属性当检定目标（D&D 的「力量检定」、COC 的「力量对抗」）
  if (typeof sheet.attributes[skill] === 'number') return sheet.attributes[skill];
  const key = Object.keys(sheet.attributes).find((k) => k.toUpperCase() === skill.toUpperCase());
  return key ? sheet.attributes[key] : null;
}
