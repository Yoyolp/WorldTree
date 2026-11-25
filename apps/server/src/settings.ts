import type { LlmConfig } from '@worldtree/shared';
import { one, parseJson, run } from './db.js';
import { DEFAULT_LLM } from './llm/client.js';

const KEY = 'llm';

/* ------------------------------------------------------------------ */
/* 设置存取（键值表）                                                   */
/* ------------------------------------------------------------------ */

export const settings = {
  get<T>(key: string): T | undefined {
    const r = one<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    return r ? parseJson<T | undefined>(r.value, undefined) : undefined;
  },
  set(key: string, value: unknown): void {
    run('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [
      key,
      JSON.stringify(value),
    ]);
  },
};

/* ------------------------------------------------------------------ */
/* 模型配置                                                            */
/* ------------------------------------------------------------------ */

export function getLlmConfig(): LlmConfig {
  const cfg = rawLlmConfig();
  // Ollama 的真实窗口由 num_ctx 决定。提示词预算一旦超过它，服务端会从**头部**截断，
  // 模型随即失忆：格式要求、剧本位置、世界设定全丢。所以这里强制对齐。
  const numCtx = Number(cfg.numCtx) > 0 ? Number(cfg.numCtx) : 0;
  if (numCtx) {
    cfg.numCtx = numCtx;
    if (!cfg.contextWindow || cfg.contextWindow > numCtx) cfg.contextWindow = numCtx;
  }
  // 探测到的真实窗口更小就听探测的 —— 用户填的数字经常是「模型的标称上限」，
  // 而运行时被 --parallel / num_ctx 切过之后实际能用的只有一小截。
  const probe = probes.get(cfg.baseUrl);
  if (probe && probe.window > 0 && cfg.contextWindow > probe.window) {
    cfg.contextWindow = probe.window;
  }
  return cfg;
}

export function saveLlmConfig(patch: Partial<LlmConfig>): LlmConfig {
  const next = { ...getLlmConfig(), ...patch };
  settings.set(KEY, next);
  probes.delete(next.baseUrl);
  void detectContextWindow(true);
  return next;
}

/* ------------------------------------------------------------------ */
/* 上下文窗口自动探测                                                  */
/* ------------------------------------------------------------------ */

export interface WindowProbe {
  /** 每个请求实际能用的上下文 */
  window: number;
  source: string;
  at: number;
}

const probes = new Map<string, WindowProbe>();

/** 不做任何探测与夹取的原始配置 */
export function rawLlmConfig(): LlmConfig {
  return { ...DEFAULT_LLM, ...(settings.get<Partial<LlmConfig>>(KEY) ?? {}) };
}

function stripV1(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
}

/**
 * 问本地推理服务「你到底有多少上下文」。
 * 填在设置页的数字经常对不上运行时（llama.cpp 的 --parallel 会把上下文切份），
 * 而服务端截断是静默的 —— 只有主动探测才能发现。
 */
async function probeWindow(baseUrl: string): Promise<{ window: number; source: string } | null> {
  const base = stripV1(baseUrl);

  // llama.cpp / llama-server
  try {
    const res = await fetch(`${base}/props`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const j = (await res.json()) as any;
      const ctx = Number(j?.default_generation_settings?.n_ctx);
      const slots = Math.max(1, Number(j?.total_slots) || 1);
      if (ctx > 0) {
        return {
          window: Math.floor(ctx / slots),
          source: `llama.cpp（n_ctx ${ctx} ÷ ${slots} 个并发槽）`,
        };
      }
    }
  } catch {
    /* 不是 llama.cpp */
  }

  // Ollama
  try {
    const res = await fetch(`${base}/api/ps`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const j = (await res.json()) as any;
      const ctx = Number((j?.models ?? [])[0]?.context_length ?? 0);
      if (ctx > 0) return { window: ctx, source: 'Ollama /api/ps' };
    }
  } catch {
    /* 不是 Ollama */
  }

  return null;
}

export async function detectContextWindow(force = false): Promise<WindowProbe | null> {
  const cfg = rawLlmConfig();
  const key = cfg.baseUrl;
  const cached = probes.get(key);
  if (!force && cached && Date.now() - cached.at < 5 * 60_000) return cached;

  const found = await probeWindow(key);
  if (!found) return cached ?? null;

  const probe: WindowProbe = { ...found, at: Date.now() };
  probes.set(key, probe);
  return probe;
}

export function cachedProbe(baseUrl?: string): WindowProbe | null {
  return probes.get(baseUrl ?? rawLlmConfig().baseUrl) ?? null;
}

/* ------------------------------------------------------------------ */
/* 外观偏好                                                            */
/* ------------------------------------------------------------------ */

export interface AppPrefs {
  theme: 'auto' | 'light' | 'dark';
  /** Material You 调色板 id，或 'auto'（按世界封面色生成） */
  palette: string;
  color: string;
  fontScale: number;
  readerWidth: number;
  streamEnabled: boolean;
  showMeta: boolean;
  iconStyle: 'outlined' | 'filled' | 'round';
}

const PREFS_KEY = 'prefs';

export const DEFAULT_PREFS: AppPrefs = {
  theme: 'auto',
  palette: 'auto',
  color: '#4f6f52',
  fontScale: 1,
  readerWidth: 760,
  streamEnabled: true,
  showMeta: false,
  iconStyle: 'outlined',
};

export function getPrefs(): AppPrefs {
  return { ...DEFAULT_PREFS, ...(settings.get<Partial<AppPrefs>>(PREFS_KEY) ?? {}) };
}

export function savePrefs(patch: Partial<AppPrefs>): AppPrefs {
  const next = { ...getPrefs(), ...patch };
  settings.set(PREFS_KEY, next);
  return next;
}

/* ------------------------------------------------------------------ */
/* 内容安全（敏感内容分级）                                             */
/* ------------------------------------------------------------------ */

/**
 * 「敏感内容」在这里指叙事尺度，不是账号安全。
 *
 * 这台机器上跑的是本地/自建模型，没有平台级审查，所以红线完全由管理员定义：
 *  - 关闭时注入「不得描写露骨性、极端暴力、未成年人不当内容」的硬性红线
 *  - 开启时放开创作尺度，但仍保留法律底线（未成年人不当内容永远禁止）
 *
 * 这是「给作者自己用的旋钮」，不是一个内容审核系统。
 */
export interface SafetySettings {
  /** 是否允许较大尺度的暴力 / 恐怖 / 成人向描写 */
  allowMature: boolean;
  /** 是否允许露骨性描写（allowMature 打开时才生效） */
  allowExplicit: boolean;
  /** 额外的自定义红线（每行一条，注入提示词） */
  customRedLines: string[];
  /** 是否把红线也展示给玩家（默认只给模型） */
  showToPlayer: boolean;
}

export const DEFAULT_SAFETY: SafetySettings = {
  allowMature: false,
  allowExplicit: false,
  customRedLines: [],
  showToPlayer: false,
};

const SAFETY_KEY = 'safety';

export function getSafety(): SafetySettings {
  return { ...DEFAULT_SAFETY, ...(settings.get<Partial<SafetySettings>>(SAFETY_KEY) ?? {}) };
}

export function saveSafety(patch: Partial<SafetySettings>): SafetySettings {
  const next = { ...getSafety(), ...patch };
  // 没开 allowMature 就不可能开 allowExplicit，避免配置矛盾
  if (!next.allowMature) next.allowExplicit = false;
  settings.set(SAFETY_KEY, next);
  return next;
}

/** 把安全设置渲染成提示词段落 */
export function renderSafety(safety: SafetySettings): string {
  const lines: string[] = ['# 内容尺度'];
  if (!safety.allowMature) {
    lines.push(
      '- 保持克制：不写露骨性描写，不写猎奇式虐待细节，不美化自我伤害。',
      '- 恐怖感来自未知、氛围与心理压力，而不是血腥堆砌。',
    );
  } else if (!safety.allowExplicit) {
    lines.push(
      '- 允许较重的暴力、恐怖与成人向主题，但不写露骨性描写，不做性暴力细节。',
      '- 血腥与心理压迫可以有，仍要服务于叙事，不是猎奇展示。',
    );
  } else {
    lines.push(
      '- 允许成人向主题与露骨描写，但仍需服务于剧情与人物，不做无意义的猎奇堆砌。',
    );
  }
  // 法律底线：无论如何都不能碰
  lines.push('- 绝对禁止：涉及未成年人的性内容、以及任何真实人物的性化描写。');
  for (const r of safety.customRedLines ?? []) {
    if (r.trim()) lines.push(`- ${r.trim()}`);
  }
  return lines.join('\n');
}
