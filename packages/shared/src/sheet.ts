/**
 * 世界树 · 角色面板的读写与迁移
 *
 * 面板的**结构**由规则书声明（`RulePack.sheetSchema`），
 * 面板的**数据**是通用键值（`CocSheet`）。这个文件负责把两者对上：
 *
 *   - 按 schema 新建一份面板           createSheetFromSchema()
 *   - 读资源值 / 上限                  resourceValue() / resourceMax()
 *   - 按 schema 算派生项               computeDerived()
 *   - 换规则书时迁移旧面板             migrateSheet()
 *
 * 之所以要有 migrateSheet：玩家可能拿一张 COC 卡去跑 D&D 世界。
 * 硬把两套字段互塞会丢数据，所以这里只做「能对上就对、对不上就留着」，
 * 不删除任何已有字段。
 */

import { evaluateFormula, evalDiceFormula, expandDice } from './formula.js';
import type {
  CocSheet,
  RulePack,
  SheetAttributeDef,
  SheetDerivedDef,
  SheetResourceDef,
  SheetSchema,
  SheetSkillDef,
} from './types.js';

/* ------------------------------------------------------------------ */
/* COC 的默认结构（也是旧存档的隐含结构）                                */
/* ------------------------------------------------------------------ */

/**
 * COC 7 版的面板结构。
 *
 * 内置的 coc7 / coc-d100 / script-lite 共用它；外部插件如果没写
 * sheetSchema 但想要「COC 那套」，可以直接 import 这个常量。
 */
export const COC_SHEET_SCHEMA: SheetSchema = {
  label: 'COC 7th 调查员',
  attrLabel: '属性',
  resourceLabel: '状态',
  skillLabel: '技能（点击检定）',
  attributes: [
    { key: 'STR', label: '力量', abbr: 'STR', min: 1, max: 99, default: 50, roll: '3d6*5', group: '身体' },
    { key: 'CON', label: '体质', abbr: 'CON', min: 1, max: 99, default: 50, roll: '3d6*5', group: '身体' },
    { key: 'SIZ', label: '体型', abbr: 'SIZ', min: 1, max: 99, default: 50, roll: '3d6*5', group: '身体' },
    { key: 'DEX', label: '敏捷', abbr: 'DEX', min: 1, max: 99, default: 50, roll: '3d6*5', group: '身体' },
    { key: 'APP', label: '外貌', abbr: 'APP', min: 1, max: 99, default: 50, roll: '3d6*5', group: '社交' },
    { key: 'INT', label: '智力', abbr: 'INT', min: 1, max: 99, default: 50, roll: '3d6*5', group: '心智' },
    { key: 'POW', label: '意志', abbr: 'POW', min: 1, max: 99, default: 50, roll: '3d6*5', group: '心智' },
    { key: 'EDU', label: '教育', abbr: 'EDU', min: 1, max: 99, default: 50, roll: '3d6*5', group: '心智' },
    { key: 'LUCK', label: '幸运', abbr: 'LUCK', min: 1, max: 99, default: 50, roll: '3d6*5', group: '心智' },
  ],
  resources: [
    { key: 'hp', label: 'HP', maxFormula: 'floor((CON+SIZ)/10)', color: '#4f8a5b' },
    { key: 'mp', label: 'MP', maxFormula: 'floor(POW/5)', color: '#3d7ea6' },
    { key: 'san', label: 'SAN', maxFormula: 'POW', color: '#7d5a96' },
  ],
  skills: [
    {
      key: '侦查', label: '侦查', baseFormula: '25', group: '感知',
      tags: ['感知'],
      description: '用视觉搜查现场，发现血迹、暗门、被翻动过的痕迹。',
      effectText: '用于「看见不该错过的东西」。\\n\\n- 成功：你发现了那个细节，并且大致明白它意味着什么。\\n- 失败：你什么也没看见，或者看见但没当回事。',
      examples: ['搜查旅馆房间', '检查尸体', '在书架上找夹层'],
    },
    {
      key: '聆听', label: '聆听', baseFormula: '20', group: '感知',
      tags: ['感知'],
      description: '捕捉声响：脚步、低语、门后的呼吸。',
      effectText: '用于「听见」。与**侦查**互补 —— 一个管看得见，一个管听得见。\\n\\n- 成功：你听清了大致的方位与人数。\\n- 失败：只有一片模糊的杂音。',
      examples: ['听门后是否有人', '分辨走廊里的脚步方向', '在雨声里听到求救'],
    },
    {
      key: '图书馆使用', label: '图书馆使用', baseFormula: '20', group: '知识',
      tags: ['知识'],
      description: '在档案、旧报纸与藏书里找到需要的那一条。',
      effectText: '用于查阅资料。花费的时间应当被写进故事里 —— 查资料从来不是免费的。\\n\\n- 成功：找到关键记载，可能附一条新的线索。\\n- 失败：你翻到了东西，但它指向更糟的地方。',
      examples: ['查二十七年前的船难报道', '找某个家族的族谱', '在教区档案里找失踪记录'],
    },
    {
      key: '心理学', label: '心理学', baseFormula: '10', group: '感知',
      tags: ['感知', '社交'],
      description: '观察他人的情绪、动机与是否在说谎。',
      effectText: '用于读人。注意：它读的是「人的状态」，不是「超自然真相」。\\n\\n- 成功：你判断出对方的真实情绪或隐瞒的方向。\\n- 失败：你把自己的不安投射到了对方身上。',
      examples: ['判断目击者是否在隐瞒', '看穿神父的伪装', '安抚失控的同伴'],
    },
    {
      key: '潜行', label: '潜行', baseFormula: '20', group: '行动',
      tags: ['行动', '潜行'],
      description: '悄悄移动，不发出声响、不被看见。',
      effectText: '与对方的**聆听**或**侦查**对抗。\\n\\n- 成功：你移动到位，且没有被发现。\\n- 失败：脚下的一块木板响了。',
      examples: ['摸进仓库后院', '跟在一辆马车后面', '从二楼绕开守卫'],
    },
    {
      key: '闪避', label: '闪避', baseFormula: 'floor(DEX/2)', group: '行动',
      tags: ['行动', '战斗'],
      description: '在战斗中躲开攻击。',
      effectText: '被攻击时可选择用闪避对抗。失败即被命中。\\n\\n基础值为 DEX 的一半，是战斗中最常用的防守手段。',
      examples: ['躲开挥来的撬棍', '侧身避开扑咬', '在狭窄走廊里后撤'],
    },
    {
      key: '格斗', label: '格斗', baseFormula: '25', group: '战斗',
      tags: ['战斗'],
      description: '拳脚、棍棒、刀械的近身攻击。',
      effectText: '近战攻击检定。成功则造成伤害并加上伤害加值（按 STR+SIZ 查表）。\\n\\n失败不代表你什么都没做，而是**没打中有效的部位**。',
      examples: ['用拳头打晕看守', '挥动铁管', '夺取对方的刀'],
    },
    {
      key: '射击', label: '射击', baseFormula: '20', group: '战斗',
      tags: ['战斗'],
      description: '枪械与弓弩的远程攻击。',
      effectText: '远程攻击检定。距离、光线、移动都会影响 —— 由主持人临时调整难度。\\n\\n在 COC 里枪械致命，但枪声会引来更糟的东西。',
      examples: ['向雾里的轮廓开枪', '打断吊灯的绳索', '在黑暗中瞄准'],
    },
    {
      key: '急救', label: '急救', baseFormula: '30', group: '知识',
      tags: ['知识', '治疗'],
      description: '止血、包扎、处理伤口与休克。',
      effectText: '用于稳定伤势。成功可恢复少量 HP 或让濒死者多撑一会儿。\\n\\n- 成功：伤情稳定。\\n- 失败：你浪费了时间，血还在流。',
      examples: ['给同伴包扎枪伤', '处理烧伤', '判断一个人是否还活着'],
    },
  ],
  freeSkills: true,
  skillMax: 99,
  derived: [{ key: 'MOV', label: 'MOV', formula: 'floor((DEX+SIZ)/2) > 0 ? 8 : 8' }],
};

/* ------------------------------------------------------------------ */
/* 读取                                                                */
/* ------------------------------------------------------------------ */

/** 取规则包的面板结构；没声明就返回 undefined（表示这套规则不用面板） */
export function getSheetSchema(pack: RulePack | undefined | null): SheetSchema | undefined {
  return pack?.sheetSchema;
}

/** 某个键是否是内置的平铺资源（hp/mp/san/luck） */
const FLAT_RESOURCES = new Set(['hp', 'mp', 'san', 'luck']);

/**
 * 读资源当前值。
 *
 * 内置的 hp/mp/san/luck 存在平铺字段上；其它资源在 `resources`。
 * 调用方不该关心这个区别 —— 一律用这个函数。
 */
export function resourceValue(sheet: CocSheet | undefined | null, key: string): number {
  if (!sheet) return 0;
  if (FLAT_RESOURCES.has(key)) {
    const v = (sheet as unknown as Record<string, unknown>)[key];
    if (typeof v === 'number') return v;
    // luck 缺省时回落到属性里的 LUCK
    if (key === 'luck') return sheet.attributes.LUCK ?? 0;
    return 0;
  }
  return sheet.resources?.[key] ?? 0;
}

/** 读资源上限 */
export function resourceMax(sheet: CocSheet | undefined | null, key: string): number {
  if (!sheet) return 0;
  if (FLAT_RESOURCES.has(key)) {
    const maxKey = key === 'luck' ? 'luckMax' : `${key}Max`;
    const v = (sheet as unknown as Record<string, unknown>)[maxKey];
    if (typeof v === 'number') return v;
    if (key === 'luck') return sheet.attributes.LUCK ?? 0;
    return 0;
  }
  return sheet.resources?.[`${key}Max`] ?? 0;
}

/** 写资源当前值（不可变，返回新面板） */
export function withResource(sheet: CocSheet, key: string, value: number): CocSheet {
  if (FLAT_RESOURCES.has(key)) {
    return { ...sheet, [key]: value } as CocSheet;
  }
  return { ...sheet, resources: { ...(sheet.resources ?? {}), [key]: value } };
}

/** 写资源上限（不可变） */
export function withResourceMax(sheet: CocSheet, key: string, value: number): CocSheet {
  if (FLAT_RESOURCES.has(key)) {
    const maxKey = key === 'luck' ? 'luckMax' : `${key}Max`;
    return { ...sheet, [maxKey]: value } as CocSheet;
  }
  return { ...sheet, resources: { ...(sheet.resources ?? {}), [`${key}Max`]: value } };
}

/** 属性表（算公式用） */
export function attrVars(sheet: CocSheet | undefined | null): Record<string, number> {
  return sheet ? { ...sheet.attributes } : {};
}

/** 把资源也并进变量表，公式里可以引用 `hp` 这类当前值 */
export function formulaVars(sheet: CocSheet | undefined | null): Record<string, number> {
  const vars = attrVars(sheet);
  if (!sheet) return vars;
  for (const [k, v] of Object.entries(sheet)) {
    if (typeof v === 'number') vars[k] = v;
  }
  for (const [k, v] of Object.entries(sheet.resources ?? {})) vars[k] = v;
  return vars;
}

/* ------------------------------------------------------------------ */
/* 派生项                                                              */
/* ------------------------------------------------------------------ */

export interface DerivedValue {
  key: string;
  label: string;
  value: number | null;
  text: string;
  suffix?: string;
}

/**
 * 算派生展示项。
 *
 * 公式失败时 value 为 null、text 为「—」，不抛异常 ——
 * 规则书写错公式不该让整个面板打不开。
 */
export function computeDerived(sheet: CocSheet, defs: SheetDerivedDef[] | undefined): DerivedValue[] {
  if (!defs?.length) return [];
  const vars = formulaVars(sheet);
  return defs.map((d) => {
    const raw = evaluateFormula(d.formula, vars);
    const value = raw === null ? null : Math.round(raw);
    return {
      key: d.key,
      label: d.label,
      value,
      text: value === null ? '—' : `${value}${d.suffix ?? ''}`,
      suffix: d.suffix,
    };
  });
}

/** 按 schema 算某项属性的合法范围 */
export function attrRange(def: SheetAttributeDef): { min: number; max: number } {
  return { min: def.min ?? 1, max: def.max ?? 99 };
}

/** 按 schema 算某个资源的上限；没写公式返回 undefined */
export function computeResourceMax(sheet: CocSheet, def: SheetResourceDef): number | undefined {
  if (!def.maxFormula) return undefined;
  const v = evaluateFormula(def.maxFormula, formulaVars(sheet));
  if (v === null) return undefined;
  return Math.max(def.min ?? 0, Math.round(v));
}

/** 按 schema 算某个技能的基准值 */
export function computeSkillBase(sheet: CocSheet, def: SheetSkillDef): number {
  if (def.baseFormula) {
    const v = evaluateFormula(def.baseFormula, formulaVars(sheet));
    if (v !== null) return Math.round(v);
  }
  return def.default ?? 0;
}

/* ------------------------------------------------------------------ */
/* 新建面板                                                            */
/* ------------------------------------------------------------------ */

/** 用 schema 的 roll 公式掷一组属性 */
export function rollAttributes(
  schema: SheetSchema,
  rng: () => number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const def of schema.attributes) {
    const { min, max } = attrRange(def);
    let value = def.default ?? Math.round((min + max) / 2);
    if (def.roll) {
      const r = evalDiceFormula(def.roll, out, rng);
      if (r.value !== undefined) value = r.value;
    }
    out[def.key] = Math.max(min, Math.min(max, Math.round(value)));
  }
  return out;
}

/**
 * 按 schema 新建一份面板。
 *
 * 传了 rng 就按 `roll` 公式掷属性，否则用 default。
 * 资源上限按 `maxFormula` 从属性算出来。
 */
export function createSheetFromSchema(
  schema: SheetSchema,
  options: { seedRng?: () => number; rulePackId?: string; name?: string } = {},
): CocSheet {
  const attributes = options.seedRng
    ? rollAttributes(schema, options.seedRng)
    : Object.fromEntries(
        schema.attributes.map((d) => [d.key, Math.max(d.min ?? 1, Math.min(d.max ?? 99, d.default ?? 50))]),
      );

  const sheet: CocSheet = {
    attributes,
    skills: [],
    // 先铺 0，下面按 schema 算
    hp: 0,
    hpMax: 0,
    mp: 0,
    mpMax: 0,
    san: 0,
    sanMax: 0,
    resources: {},
    conditions: [],
    items: [],
  };
  if (options.rulePackId) sheet.rulePackId = options.rulePackId;
  if (options.name) sheet.backstory = `${options.name}。`;

  // 资源：先算上限，再定当前值
  for (const def of schema.resources) {
    const max = computeResourceMax(sheet, def) ?? def.max ?? 0;
    let cur = max;
    if (def.initFormula) {
      const v = evaluateFormula(def.initFormula, formulaVars(sheet));
      if (v !== null) cur = Math.round(v);
    }
    const lo = def.min ?? 0;
    const hi = def.max ?? Number.MAX_SAFE_INTEGER;
    sheetFlattenSet(sheet, def.key, Math.max(lo, Math.min(hi, cur)));
    sheetFlattenSetMax(sheet, def.key, Math.max(lo, max));
  }

  // 技能
  if (schema.skills?.length) {
    sheet.skills = schema.skills.map((d) => ({ name: d.label || d.key, value: computeSkillBase(sheet, d) }));
  }

  return sheet;
}

/** 内部：写资源值（就地改，只在构造时用） */
function sheetFlattenSet(sheet: CocSheet, key: string, value: number): void {
  if (FLAT_RESOURCES.has(key)) {
    (sheet as unknown as Record<string, number>)[key] = value;
  } else {
    sheet.resources = { ...(sheet.resources ?? {}), [key]: value };
  }
}

function sheetFlattenSetMax(sheet: CocSheet, key: string, value: number): void {
  if (FLAT_RESOURCES.has(key)) {
    const maxKey = key === 'luck' ? 'luckMax' : `${key}Max`;
    (sheet as unknown as Record<string, number>)[maxKey] = value;
  } else {
    sheet.resources = { ...(sheet.resources ?? {}), [`${key}Max`]: value };
  }
}

/* ------------------------------------------------------------------ */
/* 迁移                                                                */
/* ------------------------------------------------------------------ */

/**
 * 把旧面板迁移到新 schema。
 *
 * 三种情况：
 *  1. 键能对上（COC → COC）：属性直接沿用，上限按新公式重算
 *  2. 部分能对上（COC → D&D）：同名键沿用，对不上的键留在 attributes 里不动
 *  3. 完全对不上：全部保留，新键用 default 补齐
 *
 * **不删任何东西** —— 玩家可能在别的规则书里还要用。多出来的键前端不展示而已。
 */
export function migrateSheet(
  sheet: CocSheet,
  schema: SheetSchema,
  options: { rulePackId?: string; rng?: () => number } = {},
): CocSheet {
  const next: CocSheet = {
    ...sheet,
    attributes: { ...sheet.attributes },
    skills: sheet.skills.map((s) => ({ ...s })),
    resources: { ...(sheet.resources ?? {}) },
    conditions: [...sheet.conditions],
    items: [...sheet.items],
  };

  // 属性：缺的补上，有的不动
  for (const def of schema.attributes) {
    const { min, max } = attrRange(def);
    const cur = next.attributes[def.key];
    if (typeof cur !== 'number' || !Number.isFinite(cur)) {
      let value = def.default ?? Math.round((min + max) / 2);
      if (def.roll && options.rng) {
        const r = evalDiceFormula(def.roll, next.attributes, options.rng);
        if (r.value !== undefined) value = r.value;
      }
      next.attributes[def.key] = Math.max(min, Math.min(max, Math.round(value)));
    }
  }

  // 资源：上限按新公式重算，当前值等比例缩放（免得出现 120/10 这种）
  for (const def of schema.resources) {
    const newMax = computeResourceMax(next, def) ?? def.max;
    if (newMax === undefined) {
      // 没有上限概念（如 AC），缺就补 default
      const cur = resourceValue(next, def.key);
      if (cur === 0 && def.min !== 0) sheetFlattenSet(next, def.key, 10);
      continue;
    }
    const oldMax = resourceMax(next, def.key);
    const oldCur = resourceValue(next, def.key);
    const ratio = oldMax > 0 ? oldCur / oldMax : 1;
    sheetFlattenSetMax(next, def.key, newMax);
    sheetFlattenSet(next, def.key, Math.max(0, Math.min(newMax, Math.round(newMax * ratio))));
  }

  // 技能：schema 里有、面板里没有的补上；已有的保留原值
  if (schema.skills?.length) {
    const have = new Set(next.skills.map((s) => s.name));
    for (const def of schema.skills) {
      const label = def.label || def.key;
      if (have.has(label) || have.has(def.key)) continue;
      next.skills.push({ name: label, value: computeSkillBase(next, def) });
    }
  }

  if (options.rulePackId) next.rulePackId = options.rulePackId;
  return next;
}

/**
 * 按 schema 规范化旧面板（补齐缺省字段）。
 *
 * 老存档的 `attributes` 只有 COC 那几个键，`resources` 根本没有。
 * 读盘时过一遍这个函数，后面就可以安全地用 resourceValue() 取值。
 */
export function normalizeSheet(sheet: CocSheet | undefined | null): CocSheet | undefined {
  if (!sheet) return undefined;
  const out: CocSheet = {
    ...sheet,
    attributes: { ...(sheet.attributes ?? {}) },
    skills: Array.isArray(sheet.skills) ? sheet.skills.map((s) => ({ ...s })) : [],
    resources: { ...(sheet.resources ?? {}) },
    conditions: Array.isArray(sheet.conditions) ? [...sheet.conditions] : [],
    items: Array.isArray(sheet.items) ? [...sheet.items] : [],
  };
  // 老存档没有 luck 时回落到 LUCK 属性
  if (typeof out.hp !== 'number') out.hp = 0;
  if (typeof out.hpMax !== 'number') out.hpMax = 0;
  if (typeof out.mp !== 'number') out.mp = 0;
  if (typeof out.mpMax !== 'number') out.mpMax = 0;
  if (typeof out.san !== 'number') out.san = 0;
  if (typeof out.sanMax !== 'number') out.sanMax = 0;
  if (out.luck === undefined) out.luck = out.attributes.LUCK;
  if (out.luckMax === undefined) out.luckMax = out.attributes.LUCK;
  return out;
}

/** 面板是否「能用」：至少要有一个属性或一个资源 */
export function sheetIsUsable(sheet: CocSheet | undefined | null): boolean {
  if (!sheet) return false;
  return Object.keys(sheet.attributes ?? {}).length > 0 || (sheet.skills?.length ?? 0) > 0;
}

/** 兼容：把 "3d6*5" 这类公式展开成掷好的数字串，供展示 */
export function describeRoll(expr: string, rng: () => number): string {
  return expandDice(expr, rng);
}
