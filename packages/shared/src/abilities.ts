/**
 * 世界树 · 能力（金手指）引擎
 *
 * 能力不是「写进提示词的一句话」，而是引擎真正会计算的东西：
 *  - 检定加值（checkBonus）
 *  - 属性加值（attributeBonus）
 *  - 自动授予标记（grantsFlags）
 *  - 使用代价（cost）
 *  - 使用次数（uses.max / recharge）
 */

import type {
  AbilityCost,
  AbilityRecharge,
  CharacterAbility,
  CocSheet,
  SessionState,
} from './types.js';
import { resourceValue } from './sheet.js';

/* ------------------------------------------------------------------ */
/* 收集                                                                */
/* ------------------------------------------------------------------ */

/** 合并多组能力（按 id 去重，后者覆盖前者） */
export function mergeAbilities(...lists: (CharacterAbility[] | undefined)[]): CharacterAbility[] {
  const map = new Map<string, CharacterAbility>();
  for (const list of lists) {
    for (const a of list ?? []) {
      if (!a?.id) continue;
      map.set(a.id, { ...map.get(a.id), ...a });
    }
  }
  return [...map.values()];
}

/** 当前会话内有效的能力（角色卡 + 继承来的） */
export function activeAbilities(state: SessionState, characterAbilities?: CharacterAbility[]): CharacterAbility[] {
  return mergeAbilities(characterAbilities, state.legacy?.abilities);
}

/* ------------------------------------------------------------------ */
/* 使用限制                                                            */
/* ------------------------------------------------------------------ */

export function usesLeft(ability: CharacterAbility, state: SessionState): number | null {
  if (!ability.uses) return null;
  const used = state.abilityUses?.[ability.id] ?? ability.used ?? 0;
  return Math.max(0, ability.uses.max - used);
}

export function canUseAbility(ability: CharacterAbility, state: SessionState): { ok: boolean; reason?: string } {
  if (!ability.unlocked) return { ok: false, reason: '尚未解锁' };
  const left = usesLeft(ability, state);
  if (left !== null && left <= 0) return { ok: false, reason: '使用次数已耗尽' };

  const cost = ability.effect.cost;
  if (cost && state.sheet) {
    const s = state.sheet;
    if (cost.san && s.san <= 0) return { ok: false, reason: '理智不足' };
    if (cost.hp && s.hp <= 0) return { ok: false, reason: '生命不足' };
    if (cost.mp && s.mp < cost.mp) return { ok: false, reason: '魔力不足' };
    // 通用资源代价：不足就拦下
    for (const [key, need] of Object.entries(cost.resource ?? {})) {
      if (!need) continue;
      if (resourceValue(s, key) < need) return { ok: false, reason: `${key} 不足` };
    }
  }
  return { ok: true };
}

export const RECHARGE_LABELS: Record<AbilityRecharge, string> = {
  scene: '每场景',
  turn: '每回合',
  session: '每局',
};

/** 新场景 / 新回合时按 recharge 重置使用次数 */

/* ------------------------------------------------------------------ */
/* 效果计算                                                            */
/* ------------------------------------------------------------------ */

/** 某技能从能力里获得的检定加值总和 */
export function checkBonusFrom(abilities: CharacterAbility[], skill: string, state?: SessionState): number {
  let sum = 0;
  for (const a of abilities) {
    if (!a.unlocked) continue;
    if (state) {
      const left = usesLeft(a, state);
      if (left !== null && left <= 0) continue;
    }
    for (const b of a.effect.checkBonus ?? []) {
      if (b.skill === skill) sum += b.value;
      // 支持「全部技能」这种写法
      else if (b.skill === '*' || b.skill === '任意') sum += b.value;
    }
  }
  return sum;
}

/** 属性加值总和（键不限，COC 或任意规则书声明的属性键） */
export function attributeBonusFrom(abilities: CharacterAbility[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of abilities) {
    if (!a.unlocked) continue;
    for (const [k, v] of Object.entries(a.effect.attributeBonus ?? {})) {
      out[k] = (out[k] ?? 0) + (v ?? 0);
    }
  }
  return out;
}

/** 把能力带来的属性加值应用到一个「有效面板」上（不改变原始面板） */
export function effectiveSheet(sheet: CocSheet | undefined, abilities: CharacterAbility[]): CocSheet | undefined {
  if (!sheet) return sheet;
  const bonus = attributeBonusFrom(abilities);
  if (!Object.keys(bonus).length) return sheet;

  const attributes = { ...sheet.attributes };
  for (const [key, v] of Object.entries(bonus)) {
    // 只加在面板上真实存在的属性键；不凭空造字段
    if (typeof attributes[key] !== 'number') continue;
    attributes[key] = Math.max(1, Math.min(99, attributes[key] + (v ?? 0)));
  }
  return { ...sheet, attributes };
}

/** 能力授予的初始标记 */
export function grantedFlags(abilities: CharacterAbility[]): string[] {
  const out: string[] = [];
  for (const a of abilities) {
    if (!a.unlocked) continue;
    for (const f of a.effect.grantsFlags ?? []) if (f) out.push(f);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 使用                                                                */
/* ------------------------------------------------------------------ */

export interface UseAbilityResult {
  ok: boolean;
  reason?: string;
  state: SessionState;
  /** 给模型的叙事提示 */
  narrative?: string;
  log?: string;
}

/** 使用一个能力：扣代价、记次数、给提示 */
export function useAbility(
  state: SessionState,
  ability: CharacterAbility,
): UseAbilityResult {
  const gate = canUseAbility(ability, state);
  if (!gate.ok) {
    return { ok: false, reason: gate.reason, state };
  }

  const next: SessionState = {
    ...state,
    flags: [...state.flags],
    abilityUses: { ...(state.abilityUses ?? {}) },
    sheet: state.sheet ? { ...state.sheet, conditions: [...state.sheet.conditions] } : state.sheet,
  };

  // 记次数
  next.abilityUses![ability.id] = (next.abilityUses![ability.id] ?? ability.used ?? 0) + 1;

  // 扣代价
  const cost: AbilityCost | undefined = ability.effect.cost;
  if (cost && next.sheet) {
    const s = next.sheet;
    if (cost.san) s.san = Math.max(0, Math.min(s.sanMax, s.san - cost.san));
    if (cost.hp) s.hp = Math.max(0, Math.min(s.hpMax, s.hp - cost.hp));
    if (cost.mp) s.mp = Math.max(0, Math.min(s.mpMax, s.mp - cost.mp));
    if (cost.luck) {
      const cur = s.luck ?? s.attributes.LUCK;
      s.luck = Math.max(0, Math.min(s.luckMax ?? s.attributes.LUCK, cur - cost.luck));
    }
    // 通用资源代价
    for (const [key, need] of Object.entries(cost.resource ?? {})) {
      if (!need) continue;
      const cur = resourceValue(s, key);
      const value = Math.max(0, cur - need);
      if (key === 'hp' || key === 'mp' || key === 'san' || key === 'luck') {
        (s as unknown as Record<string, number>)[key] = value;
      } else {
        s.resources = { ...(s.resources ?? {}), [key]: value };
      }
    }
  }

  // 一次性标记
  for (const f of ability.effect.onUseFlags ?? []) {
    if (f && !next.flags.includes(f)) next.flags.push(f);
  }

  const left = usesLeft(ability, next);
  const log = `${ability.name}${left !== null ? `（剩余 ${left} 次）` : ''}`;

  return {
    ok: true,
    state: next,
    narrative: ability.effect.onUseNarrative,
    log,
  };
}

/** 新场景 / 新回合时按 recharge 重置使用次数 */
export function resetUsesFor(
  state: SessionState,
  abilities: CharacterAbility[],
  recharge: AbilityRecharge,
): SessionState {
  const uses = { ...(state.abilityUses ?? {}) };
  let changed = false;
  for (const a of abilities) {
    if (a.uses?.recharge === recharge) {
      delete uses[a.id];
      changed = true;
    }
  }
  return changed ? { ...state, abilityUses: uses } : state;
}

/* ------------------------------------------------------------------ */
/* 展示                                                                */
/* ------------------------------------------------------------------ */

export const ABILITY_KIND_LABELS: Record<CharacterAbility['kind'], string> = {
  cheat: '金手指',
  skill: '技能',
  talent: '天赋',
  item: '物品',
  curse: '诅咒',
};

export const ABILITY_KIND_ICONS: Record<CharacterAbility['kind'], string> = {
  cheat: 'auto_awesome',
  skill: 'psychology',
  talent: 'stars',
  item: 'inventory_2',
  curse: 'warning',
};

/** 生成一段给提示词用的能力描述 */
export function renderAbilities(abilities: CharacterAbility[], state?: SessionState): string {
  if (!abilities.length) return '';
  const lines = abilities.map((a) => {
    const bits: string[] = [`【${ABILITY_KIND_LABELS[a.kind]}】${a.name}：${a.description}`];
    const bonus = a.effect.checkBonus?.map((b) => `${b.skill} ${b.value >= 0 ? '+' : ''}${b.value}`).join('，');
    if (bonus) bits.push(`检定加值：${bonus}`);
    const cost = a.effect.cost;
    if (cost) {
      const c = [
        cost.san ? `理智 -${cost.san}` : '',
        cost.hp ? `生命 -${cost.hp}` : '',
        cost.mp ? `魔力 -${cost.mp}` : '',
        cost.luck ? `幸运 -${cost.luck}` : '',
      ].filter(Boolean);
      if (c.length) bits.push(`代价：${c.join('，')}`);
    }
    if (a.uses) {
      const left = state ? usesLeft(a, state) : a.uses.max;
      bits.push(`${RECHARGE_LABELS[a.uses.recharge]} ${left ?? a.uses.max}/${a.uses.max} 次`);
    }
    return bits.join('；');
  });
  return lines.join('\n');
}
