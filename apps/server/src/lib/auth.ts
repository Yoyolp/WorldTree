/**
 * 认证与权限的 Fastify 钩子。
 *
 * 策略：
 *  - 除白名单（健康检查、登录、静态资源）外，所有 /api 请求都要登录。
 *  - 登录后 `request.user` 一定有值，路由里直接取用。
 *  - admin 专属接口用 `requireAdmin` 包一层，非 admin 返回 403。
 *
 * 为什么用 onRequest 而不是 preHandler：越早拦越省事，
 * 也避免下载类接口在 body 解析之后才发现没权限。
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { userByToken, type StoredUser } from './users.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** 当前登录用户；未登录时为 undefined */
    user?: StoredUser;
  }
}

/** 不需要登录就能访问的路径（精确匹配或以某前缀开头） */
const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/auth/login',
  '/api/auth/status',
]);

function isPublic(url: string): boolean {
  const path = url.split('?')[0];
  if (PUBLIC_PATHS.has(path)) return true;
  // 静态资源与前端路由：交给 @fastify/static，不拦
  if (!path.startsWith('/api')) return true;
  return false;
}

function bearer(req: FastifyRequest): string | undefined {
  const raw = req.headers.authorization;
  if (!raw) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  return m ? m[1].trim() : undefined;
}

/** 对外暴露：从请求里取 token（登出等场景用） */
export function bearerOf(req: FastifyRequest): string | undefined {
  return bearer(req);
}

/**
 * 注册全局鉴权钩子。
 * 注意：必须在注册业务路由**之前**调用。
 */
export function registerAuth(app: FastifyInstance): void {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // 保留 CORS 预检
    if (req.method === 'OPTIONS') return;

    const token = bearer(req);
    const user = userByToken(token);
    if (user) req.user = user;

    if (isPublic(req.url)) return;

    if (!user) {
      return reply.code(401).send({ error: '请先登录' });
    }
  });
}

/** 取当前用户；拿不到就抛（供 handler 内部用） */
export function currentUser(req: FastifyRequest): StoredUser {
  if (!req.user) throw new Error('未登录');
  return req.user;
}

/** admin 专属：非管理员直接抛错，由路由 catch 转 403 */
export function requireAdmin(req: FastifyRequest): StoredUser {
  const u = currentUser(req);
  if (u.role !== 'admin') {
    const err = new Error('只有管理员能做这个操作');
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }
  return u;
}
