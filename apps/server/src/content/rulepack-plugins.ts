/**
 * 世界树 · 规则书插件加载器
 *
 * 规则书以**可执行模块**的形式放进 content/rulepacks/，启动或重扫时加载：
 *
 *   content/rulepacks/
 *     ├─ my-rules.js        ← 也可以 .mjs / .ts
 *     └─ another.ts
 *
 * 一个插件文件默认导出一个 RulePack 对象（或一个返回它的工厂函数）：
 *
 *   export default {
 *     id: 'my-rules',
 *     name: '我的规则书',
 *     dieFaces: 10,
 *     strategy: 'dice-pool',
 *     strategyParams: { poolSize: 7, successThreshold: 6, successesNeeded: 2 },
 *     difficulties: false,
 *     ... 其余开关
 *     instructions: '# 规则\n- ……',
 *   }
 *
 * 也可以顺带注册自定义判定策略：
 *
 *   export const strategy = {
 *     id: 'fate-dice',
 *     name: 'Fate 骰',
 *     description: '4 个骰子，+ / - / 空白',
 *     resolve(ctx) { ... }
 *   }
 *   export default { id: 'fate', strategy: 'fate-dice', ... }
 *
 * 安全说明：这是**可执行代码**，等价于允许在服务端跑任意 JS。
 * 只加载你自己信任的文件；插件目录不进版本库分发（见 README 的账号体系说明）。
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RulePack } from '@worldtree/shared';
import { registerRulePack, registerStrategy, resetRulePacks } from '@worldtree/shared';
import { CONTENT_DIR } from '../env.js';

/** 插件目录：content/rulepacks */
export const RULEPACK_DIR = join(CONTENT_DIR, 'rulepacks');

const EXTS = ['.js', '.mjs', '.cjs', '.ts'];

export interface RulePackLoadResult {
  loaded: RulePack[];
  errors: { file: string; message: string }[];
  warnings: { file: string; message: string }[];
}

/** 列出插件文件 */
function listPluginFiles(): { rel: string; abs: string }[] {
  if (!existsSync(RULEPACK_DIR)) return [];
  return readdirSync(RULEPACK_DIR)
    .filter((name) => EXTS.some((e) => name.toLowerCase().endsWith(e)))
    .filter((name) => !name.startsWith('.'))
    .map((name) => ({ rel: `rulepacks/${name}`, abs: join(RULEPACK_DIR, name) }))
    .filter((f) => {
      try {
        return statSync(f.abs).isFile();
      } catch {
        return false;
      }
    });
}

/** 校验插件导出的对象至少像个规则包 */
function validatePack(raw: unknown, file: string): { pack?: RulePack; error?: string } {
  if (!raw || typeof raw !== 'object') return { error: '模块默认导出不是对象' };
  const p = raw as Partial<RulePack>;

  if (!p.id || typeof p.id !== 'string') return { error: '缺少 id 字段' };
  if (!/^[\w.-]+$/.test(p.id)) return { error: `id 含非法字符：${p.id}（只允许字母数字、下划线、点、连字符）` };
  if (!p.name || typeof p.name !== 'string') return { error: '缺少 name 字段' };

  const pack: RulePack = {
    // 先铺默认值，插件只写关心的字段
    id: p.id,
    name: p.name,
    description: p.description ?? '',
    dieFaces: Number(p.dieFaces) || 100,
    strategy: p.strategy,
    strategyParams: p.strategyParams ?? {},
    outcomeBands: p.outcomeBands,
    criticalValue: p.criticalValue,
    fumbleValue: p.fumbleValue,
    fumbleRange: p.fumbleRange,
    simpleOutcome: p.simpleOutcome ?? false,
    difficulties: p.difficulties ?? false,
    bonusPenalty: p.bonusPenalty ?? false,
    luckSpend: p.luckSpend ?? false,
    pushedRolls: p.pushedRolls ?? false,
    autoCheck: p.autoCheck ?? true,
    failForward: p.failForward ?? true,
    sanity: p.sanity ?? false,
    combat: p.combat ?? false,
    difficultyPresets: p.difficultyPresets,
    sanityResource: p.sanityResource,
    sanityBoutAttribute: p.sanityBoutAttribute,
    initiativeAttribute: p.initiativeAttribute,
    sheetSchema: p.sheetSchema,
    icon: p.icon ?? 'extension',
    instructions: p.instructions,
    external: true,
    file,
    errors: [],
    warnings: [],
  };

  // strategy 不存在时给警告，但仍允许加载（会用 d100 兜底）
  if (pack.strategy && !p.strategy) {
    pack.warnings?.push('strategy 字段为空');
  }

  // 面板结构：只做最基本的形状校验，公式是否正确由 shared 的求值器兜底
  if (p.sheetSchema) {
    if (!Array.isArray(p.sheetSchema.attributes) || !p.sheetSchema.attributes.length) {
      pack.warnings?.push('sheetSchema.attributes 为空，角色面板将没有属性');
    }
    if (!Array.isArray(p.sheetSchema.resources)) {
      pack.warnings?.push('sheetSchema.resources 不是数组，已按空处理');
      pack.sheetSchema = { ...p.sheetSchema, resources: [] };
    }
    // 资源 key 不能和内置的 hp/mp/san/luck 打架后又被 resources 覆盖
    const dupKeys = p.sheetSchema.resources.filter((r) => !r?.key).map(() => '');
    if (dupKeys.length) pack.warnings?.push('sheetSchema.resources 里有条目缺少 key');
  }

  return { pack };
}

/**
 * 重新加载全部插件。
 *
 * 先 resetRulePacks() 把注册表退回内置四包，再逐个 import 插件。
 * 这样删掉一个插件文件、重启/重扫后它就真的消失了，不会残留。
 */
export async function loadRulePackPlugins(): Promise<RulePackLoadResult> {
  const result: RulePackLoadResult = { loaded: [], errors: [], warnings: [] };

  // 回到内置状态，避免重复注册与残留
  resetRulePacks();

  for (const f of listPluginFiles()) {
    try {
      // 加时间戳绕开 ESM 模块缓存：改了文件重扫就生效，不必重启进程
      const url = `${pathToFileURL(f.abs).href}?v=${statSync(f.abs).mtimeMs}`;
      const mod = (await import(url)) as {
        default?: unknown;
        strategy?: unknown;
      };

      // 可选：插件自带判定策略
      if (mod.strategy && typeof mod.strategy === 'object') {
        const s = mod.strategy as { id?: string; resolve?: unknown };
        if (s.id && typeof s.resolve === 'function') {
          registerStrategy(s as never);
        } else {
          result.warnings.push({ file: f.rel, message: '导出的 strategy 缺少 id 或 resolve，已忽略' });
        }
      }

      // 默认导出可以是对象，也可以是返回对象的工厂函数
      let raw = mod.default;
      if (typeof raw === 'function') {
        raw = await (raw as () => unknown | Promise<unknown>)();
      }

      // 也支持具名导出 pack
      if (!raw && (mod as { pack?: unknown }).pack) {
        raw = (mod as { pack?: unknown }).pack;
      }

      const { pack, error } = validatePack(raw, f.rel);
      if (error || !pack) {
        result.errors.push({ file: f.rel, message: error ?? '解析失败' });
        continue;
      }

      if (pack.id && ['coc7', 'coc-d100', 'script-lite', 'narrative'].includes(pack.id)) {
        pack.warnings?.push(`覆盖了内置规则包「${pack.id}」`);
        result.warnings.push({ file: f.rel, message: `覆盖内置规则包「${pack.id}」` });
      }

      registerRulePack(pack);
      result.loaded.push(pack);
      for (const w of pack.warnings ?? []) result.warnings.push({ file: f.rel, message: w });
    } catch (err) {
      result.errors.push({ file: f.rel, message: `加载失败：${(err as Error).message}` });
    }
  }

  return result;
}
