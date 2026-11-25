import type { LlmConfig } from '@worldtree/shared';

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamCallbacks {
  onToken?: (text: string) => void;
  onReasoning?: (text: string) => void;
  signal?: AbortSignal;
}

export interface CompletionResult {
  text: string;
  reasoning?: string;
  raw?: unknown;
  /** 输出被长度限制截断（finish_reason=length / done_reason=length） */
  truncated?: boolean;
  /** 服务端回报的真实用量（有就记下来，用于校准 token 估算） */
  usage?: { prompt: number; completion: number };
}

export const DEFAULT_LLM: LlmConfig = {
  provider: 'openai-compatible',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.85,
  topP: 0.95,
  maxTokens: 2048,
  presencePenalty: 0.1,
  frequencyPenalty: 0.1,
  contextBudget: 24000,
  contextWindow: 12288,
  numCtx: 0,
  disableThinking: true,
  timeoutMs: 120000,
  stream: true,
};

/** 常见服务商预设，前端下拉直接用 */
export const PROVIDER_PRESETS: {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  hint: string;
}[] = [
  { id: 'openai-compatible', name: 'OpenAI 兼容', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', hint: '任何提供 /chat/completions 的服务' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', hint: '需要 API Key' },
  { id: 'moonshot', name: 'Moonshot / Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-32k', hint: '需要 API Key' },
  { id: 'qwen', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', hint: '需要 API Key' },
  { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus', hint: '需要 API Key' },
  { id: 'ollama', name: 'Ollama 本地', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b', hint: '本地运行，无需 Key' },
  { id: 'lmstudio', name: 'LM Studio 本地', baseUrl: 'http://127.0.0.1:1234/v1', model: 'local-model', hint: '本地运行，无需 Key' },
  { id: 'anthropic', name: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-latest', hint: '走 /messages 协议' },
];

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function parseJsonSafe(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extraHeaders(cfg: LlmConfig): Record<string, string> {
  if (!cfg.extraHeaders) return {};
  try {
    const parsed = JSON.parse(cfg.extraHeaders);
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function extraBody(cfg: LlmConfig): Record<string, unknown> {
  if (!cfg.extraBody) return {};
  try {
    const parsed = JSON.parse(cfg.extraBody);
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function isAnthropic(cfg: LlmConfig): boolean {
  return cfg.provider === 'anthropic' || /anthropic\.com/.test(cfg.baseUrl);
}

/** Ollama：走原生 /api/chat 才能控制 num_ctx（OpenAI 兼容接口不接受这个参数） */
function isOllama(cfg: LlmConfig): boolean {
  // 只认 11434 端口。很多本地推理服务（llama.cpp / LM Studio）在 OpenAI 兼容
  // 接口上长得一模一样，但根本没有 /api/chat，认错会把请求打到 404。
  return /:11434(?:$|\/)/.test(cfg.baseUrl) || (cfg.provider === 'ollama' && /\/api\//.test(cfg.baseUrl));
}

function ollamaBase(cfg: LlmConfig): string {
  return trimBase(cfg.baseUrl).replace(/\/v1$/, '');
}

/** 合并超时与外部中断信号 */
function combineSignal(timeoutMs: number, outer?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('请求超时')), timeoutMs);
  const onAbort = () => ctrl.abort(outer?.reason);
  if (outer) {
    if (outer.aborted) ctrl.abort(outer.reason);
    else outer.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    cleanup: () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    },
  };
}

/* ------------------------------------------------------------------ */
/* OpenAI 兼容协议                                                     */
/* ------------------------------------------------------------------ */

async function openaiChat(
  cfg: LlmConfig,
  turns: ChatTurn[],
  cb: StreamCallbacks = {},
): Promise<CompletionResult> {
  const url = `${trimBase(cfg.baseUrl)}/chat/completions`;
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: turns,
    temperature: cfg.temperature,
    top_p: cfg.topP,
    max_tokens: cfg.maxTokens,
    presence_penalty: cfg.presencePenalty,
    frequency_penalty: cfg.frequencyPenalty,
    stream: !!cfg.stream,
    ...(cfg.stream ? { stream_options: { include_usage: true } } : {}),
    // 推理模型：思考 token 与正文共享输出预算，关掉它能显著降低「JSON 写不完」
    ...(cfg.disableThinking ? { chat_template_kwargs: { enable_thinking: false } } : {}),
    ...extraBody(cfg),
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders(cfg),
  };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

  const { signal, cleanup } = combineSignal(cfg.timeoutMs, cb.signal);
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`模型接口返回 ${res.status}：${text.slice(0, 500) || res.statusText}`);
    }

    if (!cfg.stream || !res.body) {
      const data = await res.json() as any;
      const text = data?.choices?.[0]?.message?.content ?? '';
      const reasoning = data?.choices?.[0]?.message?.reasoning_content;
      if (text && cb.onToken) cb.onToken(text);
      const u = (data as any)?.usage;
      return {
        text,
        reasoning,
        raw: data,
        truncated: data?.choices?.[0]?.finish_reason === 'length',
        usage: u ? { prompt: Number(u.prompt_tokens) || 0, completion: Number(u.completion_tokens) || 0 } : undefined,
      };
    }

    let full = '';
    let reasoning = '';
    let truncated = false;
    let usage: { prompt: number; completion: number } | undefined;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        const json = parseJsonSafe(payload);
        if (!json) continue;
        const delta = json.choices?.[0]?.delta ?? {};
        const piece = delta.content ?? json.choices?.[0]?.text ?? '';
        if (piece) {
          full += piece;
          cb.onToken?.(piece);
        }
        const r = delta.reasoning_content ?? delta.reasoning;
        if (r) {
          reasoning += r;
          cb.onReasoning?.(r);
        }
        if (json.choices?.[0]?.finish_reason === 'length') truncated = true;
        if (json.usage?.prompt_tokens) {
          usage = {
            prompt: Number(json.usage.prompt_tokens) || 0,
            completion: Number(json.usage.completion_tokens) || 0,
          };
        }
      }
    }
    return { text: full, reasoning: reasoning || undefined, truncated, usage };
  } finally {
    cleanup();
  }
}

/* ------------------------------------------------------------------ */
/* Anthropic 协议                                                      */
/* ------------------------------------------------------------------ */

async function anthropicChat(
  cfg: LlmConfig,
  turns: ChatTurn[],
  cb: StreamCallbacks = {},
): Promise<CompletionResult> {
  const url = `${trimBase(cfg.baseUrl)}/messages`;
  const system = turns.filter((t) => t.role === 'system').map((t) => t.content).join('\n\n');
  const msgs = turns
    .filter((t) => t.role !== 'system')
    .map((t) => ({ role: t.role === 'assistant' ? 'assistant' : 'user', content: t.content }));

  const body: Record<string, unknown> = {
    model: cfg.model,
    system: system || undefined,
    messages: msgs,
    max_tokens: cfg.maxTokens,
    temperature: cfg.temperature,
    top_p: cfg.topP,
    stream: !!cfg.stream,
    ...extraBody(cfg),
  };
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    ...extraHeaders(cfg),
  };
  if (cfg.apiKey) headers['x-api-key'] = cfg.apiKey;

  const { signal, cleanup } = combineSignal(cfg.timeoutMs, cb.signal);
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`模型接口返回 ${res.status}：${text.slice(0, 500) || res.statusText}`);
    }
    if (!cfg.stream || !res.body) {
      const data = await res.json() as any;
      const text = (data?.content ?? []).map((b: any) => b?.text ?? '').join('');
      if (text && cb.onToken) cb.onToken(text);
      return { text, raw: data };
    }

    let full = '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const json = parseJsonSafe(trimmed.slice(5).trim());
        if (!json) continue;
        if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
          full += json.delta.text;
          cb.onToken?.(json.delta.text);
        }
      }
    }
    return { text: full };
  } finally {
    cleanup();
  }
}

/* ------------------------------------------------------------------ */
/* Ollama 原生协议（唯一能控制 num_ctx 的入口）                         */
/* ------------------------------------------------------------------ */

/** 组装 Ollama /api/chat 请求体（单独导出，便于测试 num_ctx 是否真的下发） */
export function buildOllamaBody(cfg: LlmConfig, turns: ChatTurn[]): Record<string, unknown> {
  const numCtx = Number(cfg.numCtx) > 0 ? Number(cfg.numCtx) : Number(cfg.contextWindow) || 8192;
  const extra = extraBody(cfg);
  return {
    model: cfg.model,
    messages: turns.map((t) => ({ role: t.role, content: t.content })),
    stream: !!cfg.stream,
    ...(cfg.disableThinking ? { think: false } : {}),
    options: {
      temperature: cfg.temperature,
      top_p: cfg.topP,
      num_predict: cfg.maxTokens,
      num_ctx: numCtx,
      ...(extra.options as Record<string, unknown> | undefined),
    },
    ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'options')),
  };
}

async function ollamaChat(
  cfg: LlmConfig,
  turns: ChatTurn[],
  cb: StreamCallbacks = {},
): Promise<CompletionResult> {
  const url = `${ollamaBase(cfg)}/api/chat`;
  // num_ctx 决定服务端真正的上下文长度；不写就用 Ollama 的默认值（常见 2048/4096），
  // 提示词超过它会被从头部静默截掉，模型随即失忆、丢格式。
  const body = buildOllamaBody(cfg, turns);

  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extraHeaders(cfg) };
  const { signal, cleanup } = combineSignal(cfg.timeoutMs, cb.signal);

  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama 返回 ${res.status}：${text.slice(0, 500) || res.statusText}`);
    }

    if (!cfg.stream || !res.body) {
      const data = (await res.json()) as any;
      const text = data?.message?.content ?? '';
      const reasoning = data?.message?.thinking ?? undefined;
      if (text && cb.onToken) cb.onToken(text);
      return { text, reasoning, raw: data, truncated: data?.done_reason === 'length' };
    }

    let full = '';
    let reasoning = '';
    let truncated = false;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const json = parseJsonSafe(trimmed) as any;
        if (!json) continue;
        const piece = json.message?.content ?? '';
        if (piece) {
          full += piece;
          cb.onToken?.(piece);
        }
        const thinking = json.message?.thinking;
        if (thinking) {
          reasoning += thinking;
          cb.onReasoning?.(thinking);
        }
        if (json.done && json.done_reason === 'length') truncated = true;
      }
    }
    return { text: full, reasoning: reasoning || undefined, truncated };
  } finally {
    cleanup();
  }
}

/* ------------------------------------------------------------------ */
/* 对外 API                                                            */
/* ------------------------------------------------------------------ */

export async function chatComplete(
  cfg: LlmConfig,
  turns: ChatTurn[],
  cb: StreamCallbacks = {},
): Promise<CompletionResult> {
  if (!cfg.baseUrl || !cfg.model) {
    throw new Error('尚未配置模型：请到「设置 → 模型接入」填写 Base URL 与模型名。');
  }
  if (isOllama(cfg)) return ollamaChat(cfg, turns, cb);
  return isAnthropic(cfg) ? anthropicChat(cfg, turns, cb) : openaiChat(cfg, turns, cb);
}

export interface TestResult {
  ok: boolean;
  message: string;
  models?: string[];
  latencyMs?: number;
}

/** 连接测试：优先拉 /models，失败则发一条极短补全 */
export async function testConnection(cfg: LlmConfig): Promise<TestResult> {
  const started = Date.now();
  const base = trimBase(cfg.baseUrl);
  const headers: Record<string, string> = { ...extraHeaders(cfg) };
  if (cfg.apiKey) {
    if (isAnthropic(cfg)) headers['x-api-key'] = cfg.apiKey;
    else headers.Authorization = `Bearer ${cfg.apiKey}`;
  }
  if (isAnthropic(cfg)) headers['anthropic-version'] = '2023-06-01';

  try {
    const res = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const data = await res.json().catch(() => null) as any;
      const models: string[] = (data?.data ?? data?.models ?? [])
        .map((m: any) => m?.id ?? m?.name)
        .filter((x: unknown): x is string => typeof x === 'string');
      return {
        ok: true,
        message: models.length ? `连接成功，可用模型 ${models.length} 个` : '连接成功',
        models,
        latencyMs: Date.now() - started,
      };
    }
  } catch {
    /* 忽略，走补全探测 */
  }

  try {
    const r = await chatComplete(
      { ...cfg, stream: false, maxTokens: 16, timeoutMs: 30000 },
      [{ role: 'user', content: '回复「ok」两个字符即可。' }],
    );
    return {
      ok: true,
      message: `连接成功（探测回复：${(r.text || '').slice(0, 40) || '空'}）`,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message, latencyMs: Date.now() - started };
  }
}

/** 拉取可用模型列表 */
export async function listModels(cfg: LlmConfig): Promise<string[]> {
  const base = trimBase(cfg.baseUrl);
  const headers: Record<string, string> = { ...extraHeaders(cfg) };
  if (cfg.apiKey) {
    if (isAnthropic(cfg)) headers['x-api-key'] = cfg.apiKey;
    else headers.Authorization = `Bearer ${cfg.apiKey}`;
  }
  if (isAnthropic(cfg)) headers['anthropic-version'] = '2023-06-01';
  const res = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`获取模型列表失败：${res.status}`);
  const data = await res.json() as any;
  return (data?.data ?? data?.models ?? [])
    .map((m: any) => m?.id ?? m?.name)
    .filter((x: unknown): x is string => typeof x === 'string')
    .sort();
}
