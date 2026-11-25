/**
 * 归属校验小工具。
 *
 * 内容库（世界 / 角色 / 世界书 / 剧本）是共享的 —— 所有登录用户都能读、能改。
 * 但**世界线（存档）与房间**属于创建者：别人看不见、也改不了。
 *
 * 这里的策略是「看不见就当不存在」：越权访问返回 404 而不是 403，
 * 避免用户通过状态码探测别人有哪些世界线。
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Session } from '@worldtree/shared';
import { sessions } from '../repo.js';
import { getRoom } from '../services/rooms.js';
import type { Room } from '@worldtree/shared';

/** 当前用户是否是该世界线的所有者。老数据 ownerId 为空时视为「无主」，仅 admin 可访问。 */
export function ownsSession(session: Session, userId: string, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  if (!session.ownerId) return false;
  return session.ownerId === userId;
}

/**
 * 取一个「当前用户可访问」的世界线。
 * 不存在或不属于该用户时，直接向 reply 写入 404 并返回 null —— 调用方拿到 null 就 return。
 */
export function requireSessionAccess(
  req: FastifyRequest,
  reply: FastifyReply,
  sessionId: string,
): Session | null {
  const s = sessions.get(sessionId);
  if (!s) {
    reply.code(404).send({ error: '世界线不存在' });
    return null;
  }
  const user = req.user!;
  if (!ownsSession(s, user.id, user.role === 'admin')) {
    // 故意报「不存在」，不泄露别人有没有这条世界线
    reply.code(404).send({ error: '世界线不存在' });
    return null;
  }
  return s;
}

/** 取一个「当前用户可访问」的房间（房主可访问；已在房间里的成员也可访问） */
export function requireRoomAccess(
  req: FastifyRequest,
  reply: FastifyReply,
  roomId: string,
  memberId?: string,
): Room | null {
  const room = getRoom(roomId);
  if (!room) {
    reply.code(404).send({ error: '房间不存在' });
    return null;
  }
  const user = req.user!;
  if (user.role === 'admin') return room;
  if (room.ownerId && room.ownerId === user.id) return room;
  // 有加入码进团的人：memberId 在成员表里就算合法（加入码本身就是凭证）
  if (memberId && room.members.some((m) => m.id === memberId)) return room;
  reply.code(404).send({ error: '房间不存在' });
  return null;
}
