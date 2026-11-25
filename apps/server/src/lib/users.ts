/**
 * 世界树 · 账号体系（文件存储）
 *
 * 设计目标与边界：
 *  - 单机 / 小圈子使用，用户量很小（作者自用 + 几个朋友），所以不引数据库，
 *    直接写 `users.json`。人多了再换。
 *  - 密码用 Node 内置 `scrypt` 加盐哈希，明文永不落盘、永不返回给前端。
 *  - 只有一个内置管理员 `admin`，账号由它创建 —— 没有自助注册，减少暴露面。
 *  - 登录后发一枚随机 token，存在服务端内存 + 落盘（重启不掉线），
 *    前端放 localStorage，每次请求带 `Authorization: Bearer <token>`。
 *
 * 这不是「抗公网攻击」的账号系统：没有验证码、没有登录限流之外的防护。
 * 它解决的是「同一局域网里谁都能改你的内容」这个问题，不是「暴露到公网」。
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DATA_DIR } from '../env.js';

/* ------------------------------------------------------------------ */
/* 类型                                                                */
/* ------------------------------------------------------------------ */

export type UserRole = 'admin' | 'user';

export interface StoredUser {
  id: string;
  username: string;
  role: UserRole;
  /** scrypt 哈希（hex） */
  passwordHash: string;
  /** 盐（hex） */
  salt: string;
  /** 显示名 */
  displayName: string;
  /** 是否停用（停用后不能登录，但数据保留） */
  disabled: boolean;
  createdAt: number;
  lastLoginAt?: number;
}

/** 返回给前端的用户信息（绝不含哈希与盐） */
export interface PublicUser {
  id: string;
  username: string;
  role: UserRole;
  displayName: string;
  disabled: boolean;
  createdAt: number;
  lastLoginAt?: number;
}

interface UserFile {
  version: number;
  users: StoredUser[];
  /** 登录会话：token → { userId, createdAt, expiresAt } */
  sessions: Record<string, { userId: string; createdAt: number; expiresAt: number }>;
}

const USERS_FILE = join(DATA_DIR, 'users.json');
const ADMIN_USERNAME = 'admin';
/** 会话有效期：30 天（自用场景，不用频繁重登） */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** scrypt 参数：N=16384 在本机约 50ms，够用且不拖慢登录 */
const SCRYPT_N = 16384;
const KEY_LEN = 64;

/* ------------------------------------------------------------------ */
/* 文件读写                                                            */
/* ------------------------------------------------------------------ */

let cache: UserFile | null = null;

function emptyFile(): UserFile {
  return { version: 1, users: [], sessions: {} };
}

function load(): UserFile {
  if (cache) return cache;
  if (!existsSync(USERS_FILE)) {
    cache = emptyFile();
    return cache;
  }
  try {
    const raw = JSON.parse(readFileSync(USERS_FILE, 'utf8')) as Partial<UserFile>;
    cache = {
      version: raw.version ?? 1,
      users: Array.isArray(raw.users) ? raw.users : [],
      sessions: raw.sessions && typeof raw.sessions === 'object' ? raw.sessions : {},
    };
  } catch {
    // 文件损坏：不要静默清空（那等于把所有人的密码删了），而是报错停下
    throw new Error(`users.json 解析失败，请检查或备份后重建：${USERS_FILE}`);
  }
  return cache;
}

/** 原子写入：先写临时文件再 rename，避免断电/中断留下半截 JSON */
function persist(): void {
  if (!cache) return;
  mkdirSync(dirname(USERS_FILE), { recursive: true });
  const tmp = `${USERS_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
  renameSync(tmp, USERS_FILE);
}

/* ------------------------------------------------------------------ */
/* 密码                                                                */
/* ------------------------------------------------------------------ */

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N }).toString('hex');
}

function makeSalt(): string {
  return randomBytes(16).toString('hex');
}

/** 恒定时间比较，避免时序侧信道 */
function verifyPassword(user: StoredUser, password: string): boolean {
  const attempt = Buffer.from(hashPassword(password, user.salt), 'hex');
  const stored = Buffer.from(user.passwordHash, 'hex');
  if (attempt.length !== stored.length) return false;
  return timingSafeEqual(attempt, stored);
}

/* ------------------------------------------------------------------ */
/* 用户 CRUD                                                           */
/* ------------------------------------------------------------------ */

export function toPublic(u: StoredUser): PublicUser {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    displayName: u.displayName,
    disabled: u.disabled,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
  };
}

export function listUsers(): PublicUser[] {
  return load().users.map(toPublic);
}

export function getUser(id: string): StoredUser | undefined {
  return load().users.find((u) => u.id === id);
}

export function getUserByName(username: string): StoredUser | undefined {
  const name = username.trim().toLowerCase();
  return load().users.find((u) => u.username.toLowerCase() === name);
}

/** 账号名规则：3-24 位，字母数字下划线连字符；大小写不敏感去重 */
export function validateUsername(raw: string): string | null {
  const name = String(raw ?? '').trim();
  if (name.length < 3 || name.length > 24) return '账号名需 3-24 个字符';
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return '账号名只能包含字母、数字、下划线与连字符';
  return null;
}

export function createUser(input: {
  username: string;
  password: string;
  role?: UserRole;
  displayName?: string;
}): PublicUser {
  const f = load();
  const bad = validateUsername(input.username);
  if (bad) throw new Error(bad);
  if (String(input.password ?? '').length < 6) throw new Error('密码至少 6 位');
  if (getUserByName(input.username)) throw new Error('这个账号名已经被占用了');

  const salt = makeSalt();
  const user: StoredUser = {
    id: `usr_${randomBytes(6).toString('hex')}`,
    username: input.username.trim(),
    role: input.role ?? 'user',
    passwordHash: hashPassword(input.password, salt),
    salt,
    displayName: (input.displayName ?? input.username).trim() || input.username,
    disabled: false,
    createdAt: Date.now(),
  };
  f.users.push(user);
  persist();
  return toPublic(user);
}

/** 修改密码（自己改自己的，或 admin 重置别人的） */
export function setPassword(userId: string, password: string): void {
  if (String(password ?? '').length < 6) throw new Error('密码至少 6 位');
  const u = getUser(userId);
  if (!u) throw new Error('用户不存在');
  u.salt = makeSalt();
  u.passwordHash = hashPassword(password, u.salt);
  // 改密后踢掉该用户所有会话
  const f = load();
  for (const [token, s] of Object.entries(f.sessions)) {
    if (s.userId === userId) delete f.sessions[token];
  }
  persist();
}

export function setDisabled(userId: string, disabled: boolean): void {
  const u = getUser(userId);
  if (!u) throw new Error('用户不存在');
  if (u.username.toLowerCase() === ADMIN_USERNAME && disabled) {
    throw new Error('不能停用内置管理员账号');
  }
  u.disabled = disabled;
  // 停用后立刻踢下线
  if (disabled) {
    const f = load();
    for (const [token, s] of Object.entries(f.sessions)) {
      if (s.userId === userId) delete f.sessions[token];
    }
  }
  persist();
}

export function deleteUser(userId: string): void {
  const f = load();
  const u = f.users.find((x) => x.id === userId);
  if (!u) throw new Error('用户不存在');
  if (u.username.toLowerCase() === ADMIN_USERNAME) throw new Error('不能删除内置管理员账号');
  f.users = f.users.filter((x) => x.id !== userId);
  for (const [token, s] of Object.entries(f.sessions)) {
    if (s.userId === userId) delete f.sessions[token];
  }
  persist();
}

/* ------------------------------------------------------------------ */
/* 登录 / 会话                                                         */
/* ------------------------------------------------------------------ */

export interface LoginResult {
  token: string;
  user: PublicUser;
}

export function login(username: string, password: string): LoginResult {
  const u = getUserByName(username);
  // 账号不存在时也跑一次哈希，避免「响应时间差异」暴露账号是否存在
  if (!u) {
    hashPassword(password ?? '', makeSalt());
    throw new Error('账号或密码不对');
  }
  if (u.disabled) throw new Error('这个账号已被停用');
  if (!verifyPassword(u, password ?? '')) throw new Error('账号或密码不对');

  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  const f = load();
  f.sessions[token] = { userId: u.id, createdAt: now, expiresAt: now + SESSION_TTL_MS };
  u.lastLoginAt = now;
  pruneSessions();
  persist();
  return { token, user: toPublic(u) };
}

/** 用 token 换用户；过期/不存在返回 undefined */
export function userByToken(token: string | undefined | null): StoredUser | undefined {
  if (!token) return undefined;
  const f = load();
  const s = f.sessions[token];
  if (!s) return undefined;
  if (s.expiresAt < Date.now()) {
    delete f.sessions[token];
    persist();
    return undefined;
  }
  const u = f.users.find((x) => x.id === s.userId);
  if (!u || u.disabled) return undefined;
  return u;
}

export function logout(token: string | undefined | null): void {
  if (!token) return;
  const f = load();
  if (f.sessions[token]) {
    delete f.sessions[token];
    persist();
  }
}

/** 清理过期会话（登录时顺手做，不需要定时器） */
function pruneSessions(): void {
  const f = load();
  const now = Date.now();
  let changed = false;
  for (const [token, s] of Object.entries(f.sessions)) {
    if (s.expiresAt < now) {
      delete f.sessions[token];
      changed = true;
    }
  }
  if (changed) persist();
}

/* ------------------------------------------------------------------ */
/* 初始化：确保内置 admin 存在                                          */
/* ------------------------------------------------------------------ */

export interface SeedAdminResult {
  created: boolean;
  /** 只在「本次刚创建」时返回，供启动日志打印一次；之后再也拿不到明文 */
  initialPassword?: string;
}

export function ensureAdmin(): SeedAdminResult {
  const f = load();
  const existing = f.users.find((u) => u.username.toLowerCase() === ADMIN_USERNAME);
  if (existing) {
    // 已有 admin：确保它一定是 admin 角色且未被停用
    if (existing.role !== 'admin' || existing.disabled) {
      existing.role = 'admin';
      existing.disabled = false;
      persist();
    }
    return { created: false };
  }

  // 生成一个高强度初始密码（去掉易混字符，方便手抄）
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(20);
  let password = '';
  for (const b of bytes) password += alphabet[b % alphabet.length];

  const salt = makeSalt();
  f.users.push({
    id: `usr_${randomBytes(6).toString('hex')}`,
    username: ADMIN_USERNAME,
    role: 'admin',
    passwordHash: hashPassword(password, salt),
    salt,
    displayName: '管理员',
    disabled: false,
    createdAt: Date.now(),
  });
  persist();
  return { created: true, initialPassword: password };
}

export const USER_FILE_PATH = USERS_FILE;
