import { DatabaseSync } from 'node:sqlite';
import { DB_FILE, ensureDirs } from './env.js';

let db: DatabaseSync | null = null;

/**
 * 数据库是「读模型」：内容以 content/ 目录文件为真源，
 * 启动时扫描文件同步进来；会话与消息是运行期数据，只存库。
 */
const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 内容镜像（从 content/ 文件同步）
CREATE TABLE IF NOT EXISTS c_worlds (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  file TEXT,
  checksum TEXT,
  sort_key INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS c_characters (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  file TEXT,
  checksum TEXT,
  sort_key INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS c_worldbooks (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  file TEXT,
  checksum TEXT,
  sort_key INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS c_scripts (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  source_md TEXT NOT NULL,
  file TEXT,
  errors TEXT NOT NULL DEFAULT '[]',
  warnings TEXT NOT NULL DEFAULT '[]',
  checksum TEXT
);

-- 运行期数据
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  title TEXT NOT NULL,
  branch_label TEXT NOT NULL DEFAULT '',
  character_ids_json TEXT NOT NULL DEFAULT '[]',
  player_name TEXT NOT NULL DEFAULT '旅人',
  player_character_id TEXT,
  state_json TEXT NOT NULL DEFAULT '{}',
  parent_id TEXT,
  branch_point_message_id TEXT,
  snapshot_json TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  -- 世界线归属账号。内容库共享，但存档/世界线按人隔离。
  owner_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_world ON sessions(world_id);
-- 注意：owner_id 的索引进 idx_sessions_owner
-- 不能写在这里 —— 老库里 sessions 表还没这一列，先建索引会直接报错。
-- 统一放到 getDb() 的补列之后执行。

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}',
  seq INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);

-- 每条助手消息对应的「完整会话状态快照」。
-- 分叉与回退都从这里取那一刻的真实状态，而不是拿父线当前状态近似。
-- 单独建表而不是塞进 meta_json：前端会整批拉消息，快照体积不小，不该跟着走。
CREATE TABLE IF NOT EXISTS message_states (
  message_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  state_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_message_states_session ON message_states(session_id, seq);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 继承存档：一条世界线走到结局后留下的「这个角色此刻是什么样」
CREATE TABLE IF NOT EXISTS legacies (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  character_id TEXT,
  character_name TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_legacies_world ON legacies(world_id);
CREATE INDEX IF NOT EXISTS idx_legacies_session ON legacies(session_id);

-- 多人房间
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  world_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'lobby',
  host_member_id TEXT NOT NULL,
  members_json TEXT NOT NULL DEFAULT '[]',
  turn_member_id TEXT,
  round INTEGER NOT NULL DEFAULT 0,
  turn_based INTEGER NOT NULL DEFAULT 1,
  passcode TEXT,
  -- 房主账号（房间按创建者隔离；加入码进团的人也能看到）
  owner_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);
`;

export function getDb(): DatabaseSync {
  if (db) return db;
  ensureDirs();
  db = new DatabaseSync(DB_FILE);
  /** 轻量迁移：给已存在的表补列 */
function ensureColumn(table: string, column: string, ddl: string): void {
  const cols = all<{ name: string }>(`PRAGMA table_info(${table})`);
  if (cols.some((c) => c.name === column)) return;
  run(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
db.exec(SCHEMA);

// 已存在的库：补上后加的列（老存档 owner_id 为 NULL，按「无主」处理）
ensureColumn('rooms', 'kp_mode', "kp_mode TEXT NOT NULL DEFAULT 'ai'");
ensureColumn('rooms', 'owner_id', 'owner_id TEXT');
ensureColumn('sessions', 'owner_id', 'owner_id TEXT');

// 补列之后再建依赖新列的索引（顺序错了会报 no such column）
run('CREATE INDEX IF NOT EXISTS idx_sessions_owner ON sessions(owner_id)');
  return db;
}

export type Row = Record<string, unknown>;

export function all<T = Row>(sql: string, params: unknown[] = []): T[] {
  return getDb().prepare(sql).all(...(params as never[])) as T[];
}

export function one<T = Row>(sql: string, params: unknown[] = []): T | undefined {
  return getDb().prepare(sql).get(...(params as never[])) as T | undefined;
}

export function run(sql: string, params: unknown[] = []): void {
  getDb().prepare(sql).run(...(params as never[]));
}

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function transaction<T>(fn: () => T): T {
  const d = getDb();
  d.exec('BEGIN');
  try {
    const out = fn();
    d.exec('COMMIT');
    return out;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}
