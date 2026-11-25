/**
 * 世界树 · 多人房间（局域网跑团）
 *
 * 形态：一名 KP（主持人）+ 多名玩家，共享同一条世界线。
 * 推进：按 seat 顺序轮流；KP 可以跳过某人、可以强制推进。
 * 实时：每个房间一条 SSE 广播通道，任何成员的动作都会推给其他成员。
 *
 * 安全模型：局域网内互信，不做账号系统；用 memberId 区分身份。
 * 加入码 6 位，可选密码。
 */

import { randomBytes } from 'node:crypto';
import type { PartyMember, Room, RoomEvent, RoomRole, Session } from '@worldtree/shared';
import { shortId } from '@worldtree/shared';
import { all, one, parseJson, run } from '../db.js';
import { content } from '../content/store.js';
import { sessions } from '../repo.js';
import { createSession } from './sessions.js';
import { rollInvestigator } from './sessions.js';

/* ------------------------------------------------------------------ */
/* 存储                                                                */
/* ------------------------------------------------------------------ */

function rowToRoom(r: Record<string, any>): Room {
  return {
    id: r.id,
    code: r.code,
    worldId: r.world_id,
    sessionId: r.session_id,
    status: r.status,
    hostMemberId: r.host_member_id,
    members: parseJson<PartyMember[]>(r.members_json, []),
    turnMemberId: r.turn_member_id ?? null,
    round: r.round,
    turnBased: !!r.turn_based,
    kpMode: (r.kp_mode as 'human' | 'ai') ?? 'ai',
    passcode: r.passcode ?? undefined,
    ownerId: r.owner_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function saveRoom(room: Room): Room {
  const next = { ...room, updatedAt: Date.now() };
  run(
    `INSERT INTO rooms (id,code,world_id,session_id,status,host_member_id,members_json,turn_member_id,round,turn_based,kp_mode,passcode,owner_id,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       code=excluded.code, world_id=excluded.world_id, session_id=excluded.session_id,
       status=excluded.status, host_member_id=excluded.host_member_id, members_json=excluded.members_json,
       turn_member_id=excluded.turn_member_id, round=excluded.round, turn_based=excluded.turn_based, kp_mode=excluded.kp_mode,
       passcode=excluded.passcode, owner_id=excluded.owner_id, updated_at=excluded.updated_at`,
    [
      next.id,
      next.code,
      next.worldId,
      next.sessionId,
      next.status,
      next.hostMemberId,
      JSON.stringify(next.members),
      next.turnMemberId ?? null,
      next.round,
      next.turnBased ? 1 : 0,
      next.kpMode ?? 'ai',
      next.passcode ?? null,
      next.ownerId ?? null,
      next.createdAt,
      next.updatedAt,
    ],
  );
  return next;
}

export function getRoom(id: string): Room | undefined {
  const r = one<Record<string, any>>('SELECT * FROM rooms WHERE id = ?', [id]);
  return r ? rowToRoom(r) : undefined;
}

export function getRoomByCode(code: string): Room | undefined {
  const r = one<Record<string, any>>('SELECT * FROM rooms WHERE code = ?', [code.toUpperCase()]);
  return r ? rowToRoom(r) : undefined;
}

export function listRooms(): Room[] {
  return all<Record<string, any>>('SELECT * FROM rooms ORDER BY updated_at DESC').map(rowToRoom);
}

export function removeRoom(id: string): void {
  run('DELETE FROM rooms WHERE id = ?', [id]);
  listeners.delete(id);
}

/* ------------------------------------------------------------------ */
/* 广播                                                                */
/* ------------------------------------------------------------------ */

type Client = { id: string; send: (ev: RoomEvent) => void };

const listeners = new Map<string, Set<Client>>();

export function subscribe(roomId: string, send: (ev: RoomEvent) => void): () => void {
  const client: Client = { id: shortId('cli'), send };
  const set = listeners.get(roomId) ?? new Set<Client>();
  set.add(client);
  listeners.set(roomId, set);

  return () => {
    set.delete(client);
    if (!set.size) listeners.delete(roomId);
  };
}

export function broadcast(roomId: string, event: RoomEvent): void {
  const set = listeners.get(roomId);
  if (!set) return;
  for (const c of set) {
    try {
      c.send(event);
    } catch {
      set.delete(c);
    }
  }
}

export function onlineCount(roomId: string): number {
  return listeners.get(roomId)?.size ?? 0;
}

/* ------------------------------------------------------------------ */
/* 加入码                                                              */
/* ------------------------------------------------------------------ */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混字符

function makeCode(): string {
  let code = '';
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  // 冲突时重试
  return getRoomByCode(code) ? makeCode() : code;
}

export function findFreeCode(): string {
  return makeCode();
}

/* ------------------------------------------------------------------ */
/* 创建 / 加入                                                         */
/* ------------------------------------------------------------------ */

export interface CreateRoomInput {
  worldId: string;
  hostName: string;
  /** 房主角色卡 */
  characterId?: string;
  /** 房主作为 KP 还是玩家 */
  hostRole?: RoomRole;
  playerName?: string;
  passcode?: string;
  rulePackId?: string;
  /** 继承存档 */
  legacyId?: string;
  /** 谁是 KP：human=真人导演，ai=AI 接管 */
  kpMode?: 'human' | 'ai';
  /** 创建者账号（房间按账号隔离） */
  ownerId?: string | null;
}

export function createRoom(input: CreateRoomInput): { room: Room; session: Session } {
  const world = content.world(input.worldId);
  if (!world) throw new Error('世界不存在');

  const memberId = shortId('mem');
  const hostRole: RoomRole = input.hostRole ?? 'kp';

  const host: PartyMember = {
    id: memberId,
    name: input.hostName || (hostRole === 'kp' ? '主持人' : '玩家'),
    role: hostRole,
    characterId: input.characterId ?? null,
    ready: true,
    skipped: false,
    seat: 0,
    joinedAt: Date.now(),
    lastSeenAt: Date.now(),
  };

  // KP 也参与叙事，但如果是 KP 且没绑角色，则不给面板
  const party = [host];

  const { session } = createSession({
    worldId: input.worldId,
    title: `${world.title} · 团`,
    branchLabel: '多人团',
    playerName: input.playerName || host.name,
    playerCharacterId: input.characterId,
    rulePackId: input.rulePackId as never,
    legacyId: input.legacyId,
    party,
    ownerId: input.ownerId ?? null,
  });

  const room: Room = {
    id: shortId('room'),
    code: findFreeCode(),
    worldId: input.worldId,
    sessionId: session.id,
    status: 'lobby',
    hostMemberId: memberId,
    members: party,
    turnMemberId: memberId,
    round: 0,
    turnBased: true,
    kpMode: input.kpMode ?? (hostRole === 'kp' ? 'human' : 'ai'),
    passcode: input.passcode || undefined,
    ownerId: input.ownerId ?? null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // 把队伍写进会话状态
  const fresh = sessions.get(session.id)!;
  sessions.updateState(session.id, { ...fresh.state, party });
  saveRoom(room);

  return { room, session: sessions.get(session.id)! };
}

export interface JoinRoomInput {
  code: string;
  name: string;
  characterId?: string;
  role?: RoomRole;
  passcode?: string;
}

export function joinRoom(input: JoinRoomInput): { room: Room; member: PartyMember; session: Session } {
  const room = getRoomByCode(input.code);
  if (!room) throw new Error('房间不存在，检查一下加入码');
  if (room.status === 'finished') throw new Error('这个团已经结束了');
  if (room.passcode && room.passcode !== input.passcode) throw new Error('密码不对');

  if (room.members.length >= 8) throw new Error('房间已满（上限 8 人）');

  const seat = room.members.length;
  const member: PartyMember = {
    id: shortId('mem'),
    name: input.name || `玩家 ${seat + 1}`,
    role: input.role ?? 'player',
    characterId: input.characterId ?? null,
    ready: false,
    skipped: false,
    seat,
    joinedAt: Date.now(),
    lastSeenAt: Date.now(),
  };

  // 分配面板：有角色卡用角色卡的，否则随机生成
  const card = input.characterId ? content.character(input.characterId) : undefined;
  member.sheet = card?.sheet
    ? structuredClone(card.sheet)
    : rollInvestigator(Date.now() + seat * 137, member.name);
  member.abilities = card?.abilities ?? [];

  const members = [...room.members, member];
  const next = saveRoom({ ...room, members });

  // 同步到会话状态
  const session = sessions.get(room.sessionId)!;
  sessions.updateState(session.id, {
    ...session.state,
    party: 
      members.map((m) => ({
        ...m,
        sheet: m.id === member.id ? member.sheet : m.sheet,
      })),
  });

  broadcast(room.id, { type: 'member', member, action: 'join' });
  broadcast(room.id, { type: 'room', room: next });

  return { room: next, member, session: sessions.get(room.sessionId)! };
}

/* ------------------------------------------------------------------ */
/* 回合                                                                */
/* ------------------------------------------------------------------ */

/** 可行动成员（跳过被 skip 的、旁观的） */
function actionable(room: Room): PartyMember[] {
  return room.members.filter((m) => {
    if (m.skipped || m.role === 'spectator') return false;
    // AI 当 KP 时，没有人类 KP 的回合——KP 的工作由模型完成
    if (room.kpMode === 'ai' && m.role === 'kp') return false;
    return true;
  });
}

/** 计算下一个该谁行动 */
export function nextTurnMember(room: Room, from?: string | null): string | null {
  const list = actionable(room);
  if (!list.length) return null;
  const currentId = from ?? room.turnMemberId;
  if (!currentId) return list[0].id;

  const idx = list.findIndex((m) => m.id === currentId);
  if (idx < 0) return list[0].id;
  return list[(idx + 1) % list.length].id;
}

/** 推进回合 */
export function advanceTurn(roomId: string, opts: { forceTo?: string; wrap?: boolean } = {}): Room {
  const room = getRoom(roomId);
  if (!room) throw new Error('房间不存在');

  let next = opts.forceTo ?? nextTurnMember(room);
  // 一轮结束（回到第一个人）时 round +1
  const firstActionable = actionable(room)[0]?.id;
  const wrapped = opts.wrap ?? (!!next && next === firstActionable && room.turnMemberId !== firstActionable);

  const updated = saveRoom({
    ...room,
    turnMemberId: next,
    round: wrapped ? room.round + 1 : room.round,
  });

  broadcast(roomId, { type: 'turn', turnMemberId: updated.turnMemberId ?? null, round: updated.round });
  broadcast(roomId, { type: 'room', room: updated });
  return updated;
}

/** 开始游戏：从 lobby 进入 playing */
export function startRoom(roomId: string): Room {
  const room = getRoom(roomId);
  if (!room) throw new Error('房间不存在');
  const first = actionable(room)[0]?.id ?? room.hostMemberId;
  const updated = saveRoom({ ...room, status: 'playing', turnMemberId: first, round: 1 });
  broadcast(roomId, { type: 'room', room: updated });
  broadcast(roomId, { type: 'turn', turnMemberId: first, round: 1 });
  broadcast(roomId, { type: 'notice', text: '团开始了' });
  return updated;
}

/** 是否轮到该成员行动 */
export function canAct(room: Room, memberId: string): { ok: boolean; reason?: string } {
  if (room.status !== 'playing') return { ok: false, reason: '团还没开始' };
  if (!room.turnBased) return { ok: true };

  const member = room.members.find((m) => m.id === memberId);
  if (!member) return { ok: false, reason: '你不在这个团里' };

  // 真人 KP 随时可以下导演指令，不占玩家回合
  if (room.kpMode === 'human' && member.role === 'kp') return { ok: true };
  if (member.skipped) return { ok: false, reason: '你这一回合被跳过了' };
  if (member.role === 'spectator') return { ok: false, reason: '旁观者不能行动' };
  if (room.turnMemberId && room.turnMemberId !== memberId) {
    const who = room.members.find((m) => m.id === room.turnMemberId)?.name ?? '其他人';
    return { ok: false, reason: `现在轮到「${who}」` };
  }
  return { ok: true };
}

/** 跳过 / 取消跳过某人（仅房主） */
export function setMemberSkipped(roomId: string, memberId: string, skipped: boolean, byMemberId: string): Room {
  const room = getRoom(roomId);
  if (!room) throw new Error('房间不存在');
  if (byMemberId !== room.hostMemberId) throw new Error('只有房主能操作');

  const members = room.members.map((m) => (m.id === memberId ? { ...m, skipped } : m));
  let updated = saveRoom({ ...room, members });

  // 如果跳过的是当前行动者，立刻跳到下一个
  if (skipped && updated.turnMemberId === memberId) {
    updated = saveRoom({ ...updated, turnMemberId: nextTurnMember(updated) });
  }

  broadcast(roomId, { type: 'room', room: updated });
  broadcast(roomId, { type: 'turn', turnMemberId: updated.turnMemberId ?? null, round: updated.round });
  return updated;
}

/** 准备 / 取消准备 */
export function setMemberReady(roomId: string, memberId: string, ready: boolean): Room {
  const room = getRoom(roomId);
  if (!room) throw new Error('房间不存在');
  const members = room.members.map((m) => (m.id === memberId ? { ...m, ready } : m));
  const updated = saveRoom({ ...room, members });
  broadcast(roomId, { type: 'room', room: updated });
  return updated;
}

/** 踢人 / 离开 */
export function removeMember(roomId: string, memberId: string): Room {
  const room = getRoom(roomId);
  if (!room) throw new Error('房间不存在');
  const members = room.members.filter((m) => m.id !== memberId).map((m, i) => ({ ...m, seat: i }));
  if (!members.length) {
    removeRoom(roomId);
    return { ...room, members: [] };
  }
  const hostMemberId = room.hostMemberId === memberId ? members[0].id : room.hostMemberId;
  const updated = saveRoom({
    ...room,
    members,
    hostMemberId,
    turnMemberId: room.turnMemberId === memberId ? members[0].id : room.turnMemberId,
  });

  broadcast(roomId, { type: 'room', room: updated });
  broadcast(roomId, { type: 'notice', text: '有成员离开了' });
  return updated;
}

/** 绑定角色卡 */
export function bindCharacter(roomId: string, memberId: string, characterId: string | null): Room {
  const room = getRoom(roomId);
  if (!room) throw new Error('房间不存在');
  const card = characterId ? content.character(characterId) : undefined;

  const members = room.members.map((m) =>
    m.id === memberId
      ? {
          ...m,
          characterId: characterId ?? null,
          sheet: card?.sheet ? structuredClone(card.sheet) : m.sheet,
          abilities: card?.abilities ?? m.abilities ?? [],
        }
      : m,
  );
  const updated = saveRoom({ ...room, members });

  const session = sessions.get(room.sessionId)!;
  sessions.updateState(session.id, { ...session.state, party: members });

  broadcast(roomId, { type: 'room', room: updated });
  return updated;
}

/** 供 /api/chat 使用：校验并返回行动者 */
export function resolveActor(roomId: string, memberId?: string): { room: Room; member: PartyMember } {
  const room = getRoom(roomId);
  if (!room) throw new Error('房间不存在');

  const id = memberId ?? room.turnMemberId;
  if (!id) throw new Error('还没轮到任何人');
  const member = room.members.find((m) => m.id === id);
  if (!member) throw new Error('成员不存在');

  return { room, member };
}

/** 把队伍同步进会话状态（面板可能被回合改过） */
export function syncPartyToSession(roomId: string): void {
  const room = getRoom(roomId);
  if (!room) return;
  const session = sessions.get(room.sessionId);
  if (!session) return;
  sessions.updateState(session.id, { ...session.state, party: room.members });
}


