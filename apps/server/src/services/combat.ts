/**
 * 世界树 · 战斗流程
 *
 * 战斗状态存在 session.state.combat 里，随世界线一起存档/分叉。
 * 一条战斗由若干 combatant 组成，按 DEX 先攻轮转。
 */

import {
  advanceCombatTurn,
  applyDamage,
  currentCombatant,
  damageBonus,
  dyingCheck,
  getRulePack,
  makeCombatant,
  performCheck,
  resolveAttack,
  resourceMax,
  resourceValue,
  skillValueOf,
  startCombat,
  WEAPONS,
  type CheckDifficulty,
  type CocSheet,
  type CombatState,
  type Combatant,
  type Session,
  type SessionState,
} from '@worldtree/shared';
import { content } from '../content/store.js';
import { sessions } from '../repo.js';

export interface CombatActionResult {
  combat: CombatState | null;
  state: SessionState;
  log: string[];
  notes: string[];
}

function rngFor(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function saveState(sessionId: string, state: SessionState): SessionState {
  sessions.updateState(sessionId, state);
  return state;
}

/** 取面板里的先攻值：优先 DEX，没有就用规则书的先攻属性，最后 50 */
function initiativeOf(sheet: CocSheet | null | undefined, pack: ReturnType<typeof getRulePack>): number {
  if (!sheet) return 50;
  const key = pack.initiativeAttribute || 'DEX';
  const v = sheet.attributes[key] ?? sheet.attributes[key.toUpperCase()] ?? sheet.attributes.DEX;
  return typeof v === 'number' ? v : 50;
}

/** 取面板里的 HP（战斗只认 hp 这个资源名） */
function hpOf(sheet: CocSheet | null | undefined): { hp: number; hpMax: number } {
  return {
    hp: sheet ? resourceValue(sheet, 'hp') || 10 : 10,
    hpMax: sheet ? resourceMax(sheet, 'hp') || 10 : 10,
  };
}

/** 开始战斗：玩家来自会话面板/队伍，NPC 由调用方给出 */
export function beginCombat(
  session: Session,
  input: { npcs?: { name: string; dex: number; hp: number; hpMax?: number }[]; seed?: number },
): CombatActionResult {
  const pack = getRulePack(session.state.rulePackId);
  if (!pack.combat) throw new Error('当前规则包不支持战斗');

  const combatants: Combatant[] = [];
  const party = session.state.party ?? [];

  if (party.length) {
    for (const m of party) {
      if (m.role === 'spectator') continue;
      const sheet = m.sheet ?? session.state.sheet;
      const { hp, hpMax } = hpOf(sheet);
      combatants.push(
        makeCombatant({
          id: `m_${m.id}`,
          name: m.name,
          memberId: m.id,
          dex: initiativeOf(sheet, pack),
          hp,
          hpMax,
        }),
      );
    }
  } else {
    const sheet = session.state.sheet;
    const { hp, hpMax } = hpOf(sheet);
    combatants.push(
      makeCombatant({
        id: 'm_player',
        name: session.playerName || '你',
        dex: initiativeOf(sheet, pack),
        hp,
        hpMax,
      }),
    );
  }

  for (const [i, npc] of (input.npcs ?? []).entries()) {
    combatants.push(
      makeCombatant({
        id: `n_${i}`,
        name: npc.name || `敌人 ${i + 1}`,
        dex: npc.dex,
        hp: npc.hp,
        hpMax: npc.hpMax ?? npc.hp,
      }),
    );
  }

  if (!combatants.length) throw new Error('没有可参战的单位');

  const combat = startCombat(combatants, rngFor(input.seed ?? Date.now()));
  const state = saveState(session.id, { ...session.state, combat });
  return { combat, state, log: combat.log, notes: [] };
}

export interface AttackInput {
  attackerId: string;
  defenderId: string;
  /** 武器名，见 WEAPONS */
  weapon?: string;
  /** 防守方选择闪避还是格斗反击 */
  defense?: 'dodge' | 'fightBack';
  seed?: number;
}

export function attack(session: Session, input: AttackInput): CombatActionResult {
  const combat = session.state.combat;
  if (!combat?.active) throw new Error('当前不在战斗中');

  const attacker = combat.combatants.find((c) => c.id === input.attackerId);
  const defender = combat.combatants.find((c) => c.id === input.defenderId);
  if (!attacker || !defender) throw new Error('参战单位不存在');

  const rng = rngFor(input.seed ?? Date.now() + combat.round * 97);
  const pack = getRulePack(session.state.rulePackId);

  // 取攻击者自己的面板（单人用主面板，多人用成员面板）
  const sheet = combatantSheet(session, attacker);
  const defSheet = combatantSheet(session, defender);

  const weapon = WEAPONS[input.weapon ?? '拳头'] ?? WEAPONS['拳头'];
  const attackSkill = weapon.skill;
  // 伤害加值按 STR/SIZ 查表；没有这两项时按 0 处理
  const db = sheet ? damageBonus(sheet.attributes.STR ?? 50, sheet.attributes.SIZ ?? 50) : '0';

  const rollSkill = (skill: string, target: number, difficulty: CheckDifficulty = 'regular') =>
    performCheck({ skill, target, difficulty, rng, pack });

  const result = resolveAttack({
    weapon,
    attacker: {
      name: attacker.name,
      skillValue: skillValueOf(sheet, attackSkill) ?? 25,
      db,
    },
    defender: {
      name: defender.name,
      skill: input.defense === 'fightBack' ? '格斗' : '闪避',
      skillValue: skillValueOf(defSheet, input.defense === 'fightBack' ? '格斗' : '闪避') ?? 25,
      hp: defender.hp,
      hpMax: defender.hpMax,
    },
    defenderChoice: input.defense ?? 'dodge',
    rng,
    rollSkill,
  });

  const log: string[] = [result.detail];
  const notes: string[] = [];

  let combatants = combat.combatants.map((c) => c);
  if (result.hit && result.damage > 0) {
    const applied = applyDamage(defender, result.damage, result.majorWound);
    notes.push(...applied.notes);
    combatants = combatants.map((c) => (c.id === defender.id ? applied.combatant : c));

    // 濒死：立刻做一次体质检定
    if (applied.combatant.dying && defSheet) {
      const dc = dyingCheck(defSheet, rng, rollSkill);
      log.push(dc.detail);
      if (!dc.survived) {
        combatants = combatants.map((c) =>
          c.id === defender.id ? { ...c, conditions: [...new Set([...c.conditions, '死亡'])] } : c,
        );
      }
    }
  }

  const nextCombat: CombatState = { ...combat, combatants, log: [...combat.log, ...log].slice(-40) };
  const state = saveState(session.id, { ...session.state, combat: nextCombat });
  return { combat: nextCombat, state, log, notes };
}

/** 取某个参战单位对应的面板 */
function combatantSheet(session: Session, c: Combatant) {
  if (c.memberId) {
    const member = session.state.party?.find((m) => m.id === c.memberId);
    if (member?.sheet) return member.sheet;
  }
  return session.state.sheet;
}

/** 轮到下一个 */
export function nextCombatTurn(session: Session): CombatActionResult {
  const combat = session.state.combat;
  if (!combat?.active) throw new Error('当前不在战斗中');
  const next = advanceCombatTurn(combat);
  const who = currentCombatant(next);
  const log = [`第 ${next.round} 轮，轮到 ${who?.name ?? '—'}`];
  const updated: CombatState = { ...next, log: [...combat.log, ...log].slice(-40) };
  const state = saveState(session.id, { ...session.state, combat: updated });
  return { combat: updated, state, log, notes: [] };
}

/** 结束战斗，把 HP 写回面板 */
export function endCombat(session: Session): CombatActionResult {
  const combat = session.state.combat;
  if (!combat) throw new Error('当前不在战斗中');

  let state: SessionState = { ...session.state, combat: null };

  // 单人的 HP 写回主面板
  const solo = combat.combatants.find((c) => c.id === 'm_player');
  if (solo && state.sheet) {
    state = {
      ...state,
      sheet: {
        ...state.sheet,
        hp: solo.hp,
        conditions: [
          ...new Set([...state.sheet.conditions, ...solo.conditions.filter((x) => x !== '重伤')]),
        ],
      },
    };
  }

  // 多人：写回各自面板
  if (state.party?.length) {
    state = {
      ...state,
      party: state.party.map((m) => {
        const c = combat.combatants.find((x) => x.memberId === m.id);
        if (!c || !m.sheet) return m;
        return { ...m, sheet: { ...m.sheet, hp: c.hp } };
      }),
    };
  }

  const saved = saveState(session.id, state);
  return { combat: null, state: saved, log: ['战斗结束'], notes: [] };
}

/** 不改变状态，只读取当前战斗 */
export function readCombat(session: Session): CombatState | null {
  return session.state.combat ?? null;
}

/** 让规则包里的技能值可查（供 UI 显示） */
export { skillValueOf };
