/**
 * 认证与账号管理路由。
 *
 * 端点：
 *  - POST /api/auth/login     登录，发 token
 *  - POST /api/auth/logout    登出
 *  - GET  /api/auth/status    当前登录态（前端启动时探测）
 *  - POST /api/auth/password  改自己的密码
 *  - GET  /api/users          （admin）账号列表
 *  - POST /api/users          （admin）新建账号
 *  - PATCH /api/users/:id     （admin）停用/启用、重置密码、改显示名
 *  - DELETE /api/users/:id    （admin）删除账号
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { currentUser, requireAdmin } from './lib/auth.js';
import {
  createUser,
  deleteUser,
  listUsers,
  login,
  logout,
  setDisabled,
  setPassword,
  toPublic,
  userByToken,
  type UserRole,
} from './lib/users.js';
import { bearerOf } from './lib/auth.js';

function bad(reply: FastifyReply, err: unknown) {
  const e = err as Error & { statusCode?: number };
  return reply.code(e.statusCode ?? 400).send({ error: e.message });
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------- 登录 / 登出 / 状态 ---------------- */

  app.post('/api/auth/login', async (req, reply) => {
    const body = (req.body ?? {}) as { username?: string; password?: string };
    if (!body.username || !body.password) {
      return reply.code(400).send({ error: '请输入账号和密码' });
    }
    try {
      const result = login(body.username, body.password);
      return result;
    } catch (err) {
      return reply.code(401).send({ error: (err as Error).message });
    }
  });

  app.post('/api/auth/logout', async (req) => {
    logout(bearerOf(req));
    return { ok: true };
  });

  app.get('/api/auth/status', async (req) => {
    const u = userByToken(bearerOf(req));
    return { authed: !!u, user: u ? toPublic(u) : null };
  });

  /** 改自己的密码（需要旧密码） */
  app.post('/api/auth/password', async (req, reply) => {
    const me = currentUser(req);
    const body = (req.body ?? {}) as { oldPassword?: string; newPassword?: string };
    try {
      // 用旧密码再验一次，防止 token 泄露后被直接改密
      login(me.username, body.oldPassword ?? '');
      setPassword(me.id, body.newPassword ?? '');
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  /* ---------------- 账号管理（仅 admin） ---------------- */

  app.get('/api/users', async (req, reply) => {
    try {
      requireAdmin(req);
      return { items: listUsers(), total: listUsers().length };
    } catch (err) {
      return bad(reply, err);
    }
  });

  app.post('/api/users', async (req, reply) => {
    try {
      requireAdmin(req);
      const body = (req.body ?? {}) as {
        username?: string;
        password?: string;
        role?: UserRole;
        displayName?: string;
      };
      const user = createUser({
        username: body.username ?? '',
        password: body.password ?? '',
        role: body.role === 'admin' ? 'admin' : 'user',
        displayName: body.displayName,
      });
      return user;
    } catch (err) {
      return bad(reply, err);
    }
  });

  app.patch<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
    try {
      requireAdmin(req);
      const body = (req.body ?? {}) as {
        disabled?: boolean;
        password?: string;
        displayName?: string;
      };
      if (typeof body.disabled === 'boolean') setDisabled(req.params.id, body.disabled);
      if (body.password) setPassword(req.params.id, body.password);
      const updated = listUsers().find((u) => u.id === req.params.id);
      if (!updated) return reply.code(404).send({ error: '用户不存在' });
      return updated;
    } catch (err) {
      return bad(reply, err);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
    try {
      requireAdmin(req);
      deleteUser(req.params.id);
      return { ok: true };
    } catch (err) {
      return bad(reply, err);
    }
  });
}
