/** 极薄的 fetch 封装，统一错误处理、JSON 解析与登录态注入 */

const TOKEN_KEY = 'wt.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 隐私模式下 localStorage 可能不可写，忽略 */
  }
}

/** 登录态失效时的回调（由 app store 注册，用于跳回登录页） */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

/** 供不走 http 封装的调用方（流式 / SSE）在收到 401 时手动触发 */
export function notifyUnauthorized(): void {
  onUnauthorized?.();
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined && init?.body !== null;

  // 只有真正带 body 时才设置 Content-Type：
  // Fastify 对「声明了 application/json 但 body 为空」的请求会直接返回 400
  // （FST_ERR_CTP_EMPTY_JSON_BODY），DELETE 会踩到这个坑。
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
  if (hasBody && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  // 带上登录 token
  const token = getToken();
  if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { ...init, headers });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  // 401：登录已失效，交给上层跳登录页。
  // 注意两点：
  //  - 登录接口自己的 401 不算（那是密码错，不是过期）
  //  - 只有在「本来带了 token」时才判定失效。未登录时的 401 是正常状态，
  //    清 token 会把刚登录写进去的凭证误删。
  if (res.status === 401 && !url.includes('/api/auth/login') && token) {
    setToken(null);
    onUnauthorized?.();
  }

  if (!res.ok) {
    let msg = `请求失败（${res.status}）`;
    if (data && typeof data === 'object' && 'error' in data) {
      msg = String((data as { error: unknown }).error);
    } else if (typeof data === 'string' && data) {
      msg = data;
    }
    throw new Error(msg);
  }
  return data as T;
}

export const http = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  del: <T>(url: string) => request<T>(url, { method: 'DELETE' }),
};

/** 把大文件切成小块转 base64，避免 String.fromCharCode(...largeArray) 爆栈 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(binary);
}
