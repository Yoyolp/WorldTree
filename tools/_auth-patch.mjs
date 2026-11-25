/**
 * 测试脚本的登录注入器。
 *
 * 平台加了账号体系后，所有 /api 都需要 token。测试脚本当初写的时候没有鉴权，
 * 与其在每个脚本里改几十处 fetch，不如统一在 Node 里包一层全局 fetch：
 * 自动给发往平台的请求补上 Authorization 头。
 *
 * 用法（在每个测试脚本的最顶部、任何 fetch 调用之前）：
 *   import './_auth-patch.mjs';
 *
 * 环境变量：
 *   WT_USER / WT_PASS  登录用账号（默认 admin / WT_ADMIN_PASSWORD）
 *   WT_TOKEN           直接给一个已有 token，跳过登录
 */

const BASE = process.env.WT_BASE ?? 'http://127.0.0.1:5174';
const USER = process.env.WT_USER ?? 'admin';
const PASS = process.env.WT_PASS ?? process.env.WT_ADMIN_PASSWORD ?? '';

let token = process.env.WT_TOKEN ?? '';
let loginPromise = null;

async function ensureToken() {
  if (token) return token;
  if (!PASS) {
    throw new Error(
      '测试需要登录：请设置 WT_ADMIN_PASSWORD（admin 初始密码），或直接给 WT_TOKEN。',
    );
  }
  if (!loginPromise) {
    loginPromise = (async () => {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: USER, password: PASS }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`测试登录失败：${data?.error ?? res.status}`);
      token = data.token;
      return token;
    })();
  }
  return loginPromise;
}

const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url ?? '';
  const isApi = url.startsWith(BASE) || url.startsWith('/api');

  if (isApi && !url.includes('/api/auth/login') && !url.includes('/api/health')) {
    const t = await ensureToken();
    const headers = new Headers(init.headers ?? {});
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${t}`);
    init = { ...init, headers };
  }
  return realFetch(input, init);
};
