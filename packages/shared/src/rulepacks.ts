/**
 * 世界树 · 规则包注册表
 *
 * 规则书不再写死在类型里，而是「注册」进来的：
 *
 *   - 内置四个包（COC7 / 简化 d100 / 剧本简化 / 叙事）在下面声明
 *   - 外部插件由 apps/server 的 content/rulepacks 加载器读入后
 *     调 registerRulePack() 注册，来源是 content/rulepacks/*.js|*.ts
 *
 * 每个包只声明「用哪个判定策略 + 参数」，掷骰逻辑在 resolution.ts。
 * 这样加一本新规则书 ≈ 写一个文件，不需要改平台代码。
 */

import type { RulePack, RulePackId } from './types.js';
import { COC_SHEET_SCHEMA } from './sheet.js';

/**
 * COC 7 版的分档：
 *   1 大成功 / ≤目标÷5 极难 / ≤目标÷2 困难 / ≤目标 常规 / 96-100 且目标<50 大失败
 */
export const coc7Pack: RulePack = {
  id: 'coc7',
  name: '克苏鲁的呼唤 7 版',
  description: 'd100 检定，含难度等级（常规/困难/极难）、奖励与惩罚骰、消耗幸运改判、孤注一掷。',
  dieFaces: 100,
  strategy: 'd100-threshold',
  strategyParams: { bonusPenalty: true },
  criticalValue: 1,
  fumbleValue: 100,
  fumbleRange: { below: 50, from: 96 },
  difficulties: true,
  bonusPenalty: true,
  luckSpend: true,
  pushedRolls: true,
  autoCheck: true,
  failForward: false,
  sanity: true,
  combat: true,
  sheetSchema: COC_SHEET_SCHEMA,
  icon: 'casino',
  instructions: [
    '# 规则（克苏鲁的呼唤 7 版）',
    '这是一套恐怖调查规则：角色脆弱、知识危险，最好的结局往往是「活着离开」。数值用来表达「你能做到什么、你承受不住什么」。',
    '- 检定使用 1d100，小于等于技能值即成功；困难难度需 ≤ 技能/2，极难需 ≤ 技能/5。',
    '- 掷骰由系统完成，你只负责给出「需要检定什么技能」以及描写结果，不要自己编骰值。',
    '- 失败要有具体代价：受伤、惊动对方、损失时间、理智动摇，而不是简单「你失败了」。',
    '- 恐怖来自未知与克制：多写声音、气味、触感，不轻易展示怪物全貌。',
    '- 理智损失用 sanDelta 记录，并描写心理变化。',
  ].join('\n'),
};

export const cocD100Pack: RulePack = {
  id: 'coc-d100',
  name: '简化 d100',
  description: '只判定 1d100 ≤ 技能值。适合快节奏跑团或非克苏鲁题材。',
  dieFaces: 100,
  strategy: 'd100-threshold',
  strategyParams: { bonusPenalty: false },
  criticalValue: 1,
  fumbleValue: 100,
  difficulties: false,
  bonusPenalty: false,
  luckSpend: true,
  pushedRolls: false,
  autoCheck: true,
  failForward: true,
  sanity: true,
  combat: true,
  sheetSchema: COC_SHEET_SCHEMA,
  icon: 'percent',
  instructions: [
    '# 规则（简化 d100）',
    '- 检定使用 1d100，小于等于技能值即成功，不区分难度层级。',
    '- 掷骰由系统完成，你只负责给出技能名与描写结果。',
    '- 失败也应有推进：给出新的线索或新的麻烦。',
  ].join('\n'),
};

export const scriptLitePack: RulePack = {
  id: 'script-lite',
  name: '剧本简化判定',
  description:
    '为剧本设计：一次 d100 ≤ 目标即成功，没有奖励骰、没有幸运改判、没有理智、没有战斗。' +
    '角色没有面板时按难度固定值判定（普通 50 / 困难 30 / 极难 15）。失败也推进剧情。',
  dieFaces: 100,
  strategy: 'd100-threshold',
  strategyParams: { bonusPenalty: false },
  criticalValue: 1,
  fumbleValue: 100,
  // 剧本简化只留成功/失败两档（1 大成功、100 大失败仍保留戏剧性）
  simpleOutcome: true,
  difficulties: false,
  bonusPenalty: false,
  luckSpend: false,
  pushedRolls: false,
  autoCheck: true,
  failForward: true,
  sanity: false,
  combat: false,
  difficultyPresets: { regular: 50, hard: 30, extreme: 15 },
  icon: 'bolt',
  instructions: [
    '# 规则（剧本简化判定）',
    '- 一次 d100，小于等于目标值即成功。不区分难度层级，也没有幸运改判。',
    '- 角色可能没有完整面板：没有技能值时按固定目标值（常规 50 / 困难 30 / 极难 15）。',
    '- 失败也推进剧情：把失败写成一个转折，而不是死路。',
    '- 只保留 1（大成功）和 100（大失败）两个戏剧性结果。',
  ].join('\n'),
};

/**
 * 叙事优先包：真正掷 d20。
 *
 * 早先这里 dieFaces 写成 20，但 performCheck 读进变量后从未使用，
 * 所有规则包实际都按 d100 掷 —— 文档与实现不符。现在走 dN-threshold，
 * dieFaces 真正生效。
 */
export const narrativePack: RulePack = {
  id: 'narrative',
  name: '叙事优先',
  description: '检定只作为叙事调味，掷 1d20 对比目标值，失败也会推进剧情（fail forward）。适合纯文字互动小说。',
  dieFaces: 20,
  strategy: 'dN-threshold',
  strategyParams: {},
  criticalValue: 1,
  fumbleValue: 20,
  difficulties: false,
  bonusPenalty: false,
  luckSpend: false,
  pushedRolls: false,
  autoCheck: false,
  failForward: true,
  sanity: false,
  combat: false,
  icon: 'menu_book',
  instructions: [
    '# 规则（叙事优先，1d20）',
    '- 剧情优先。只有当结果确实不确定且双方都有代价时才建议检定。',
    '- 需要检定时在 check 字段给出技能名；系统会掷 1d20 与目标值比较。',
    '- 即使失败也推进故事（fail forward）：写「你成功了但……」「你没能做到，同时发现了……」。',
    '- 不要用数值堆砌叙述，情感与画面比数据重要。',
  ].join('\n'),
};

/* ------------------------------------------------------------------ */
/* 注册表                                                              */
/* ------------------------------------------------------------------ */

const registry = new Map<RulePackId, RulePack>();

/** 内置包（顺序即前端展示顺序） */
export const BUILTIN_RULEPACKS: RulePack[] = [coc7Pack, cocD100Pack, scriptLitePack, narrativePack];

for (const p of BUILTIN_RULEPACKS) registry.set(p.id, p);

/** 所有已注册规则包（内置 + 插件），按注册顺序 */
export function listRulePacks(): RulePack[] {
  return [...registry.values()];
}

/** 兼容旧名：RULE_PACK_LIST 仍是数组 */
export const RULE_PACK_LIST: RulePack[] = listRulePacks();

/** 兼容旧名：RULE_PACKS 以 id 为键 */
export const RULE_PACKS: Record<string, RulePack> = Object.fromEntries(
  BUILTIN_RULEPACKS.map((p) => [p.id, p]),
);

/**
 * 注册（或覆盖）一个规则包。
 *
 * 插件加载器用它；内置包同 id 会被覆盖，便于用文件热修内置规则。
 */
export function registerRulePack(pack: RulePack): void {
  registry.set(pack.id, pack);
}

/** 移除一个规则包（重扫内容前清掉旧的插件包） */
export function unregisterRulePack(id: RulePackId): void {
  registry.delete(id);
}

/** 清掉所有插件包，只留内置 —— 内容重扫前调用 */
export function resetRulePacks(): void {
  registry.clear();
  for (const p of BUILTIN_RULEPACKS) registry.set(p.id, p);
}

/**
 * 取规则包。
 *
 * 未知 id 一律回落 coc7：宁可让玩家看到「按 COC 判」，
 * 也不要因为作者写错 id 直接把推演打成异常。
 */
export function getRulePack(id: RulePackId | undefined | null): RulePack {
  return (id ? registry.get(id) : undefined) ?? coc7Pack;
}

/** 是否存在这个规则包（用于校验世界/剧本声明的 id） */
export function hasRulePack(id: RulePackId | undefined | null): boolean {
  return !!id && registry.has(id);
}

export const MODE_DEFAULT_RULEPACK: Record<string, RulePackId> = {
  story: 'narrative',
  script: 'coc7',
  coc: 'coc7',
};
