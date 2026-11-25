import type {
  CharacterAbility,
  CharacterCard,
  ChatRequest,
  CheckDifficulty,
  CocSheet,
  DiceRoll,
  GameEvent,
  LegacySnapshot,
  LlmConfig,
  LlmConnectionTest,
  Message,
  PartyMember,
  Room,
  RulePack,
  RulePackId,
  Session,
  StreamEvent,
  StoryScript,
  World,
  WorldBook,
  WorldSummary,
} from '@worldtree/shared';
import { getToken, http, notifyUnauthorized, setToken } from './http';

/* 内容安全设置（admin 可调）：控制叙事尺度红线 */
export interface SafetySettings {
  allowMature: boolean;
  allowExplicit: boolean;
  customRedLines: string[];
  showToPlayer: boolean;
}

/** 账号（admin 管理页用） */
export interface AccountUser {
  id: string;
  username: string;
  role: 'admin' | 'user';
  displayName: string;
  disabled: boolean;
  createdAt: number;
  lastLoginAt?: number;
}

export interface WorldDetail {
  world: World;
  characters: CharacterCard[];
  worldBook: WorldBook | null;
  script: StoryScript | null;
  scriptSource: string | null;
  scriptErrors: string[];
  sessions: Session[];
}

export interface SessionDetail {
  session: Session;
  world: World | null;
  messages: Message[];
  characters: CharacterCard[];
  script: StoryScript | null;
}

export interface ScriptRecord {
  id: string;
  sourceMd: string;
  script: StoryScript | null;
  errors: string[];
  warnings: string[];
  file: string;
}

export interface BranchNode {
  session: Session;
  children: BranchNode[];
}

export interface ContentHealth {
  worlds: number;
  characters: number;
  worldbooks: number;
  scripts: number;
  errors: { file: string; message: string }[];
  warnings: { file: string; message: string }[];
}

export interface ScriptListItem {
  id: string;
  file: string;
  title: string;
  nodeCount: number;
  eventCount: number;
  errors: string[];
  warnings: string[];
}

export const api = {
  /* 规则包 */
  listRulePacks: () => http.get<RulePack[]>('/api/rulepacks'),

  /* 内容 */
  contentHealth: () => http.get<ContentHealth>('/api/content/health'),
  syncContent: () => http.post<ContentHealth>('/api/content/sync'),

  /* 世界 */
  listWorlds: () => http.get<{ items: WorldSummary[]; total: number }>('/api/worlds'),
  getWorld: (id: string) => http.get<WorldDetail>(`/api/worlds/${id}`),
  createWorld: (body: Partial<World>) => http.post<World>('/api/worlds', body),
  updateWorld: (id: string, body: Partial<World>) => http.patch<World>(`/api/worlds/${id}`, body),
  deleteWorld: (id: string) => http.del<{ ok: boolean }>(`/api/worlds/${id}`),

  /* 剧本 */
  listScripts: () => http.get<{ items: ScriptListItem[] }>('/api/scripts'),
  getScript: (id: string) => http.get<ScriptRecord>(`/api/scripts/${id}`),
  saveScript: (id: string, markdown: string) =>
    http.put<ScriptRecord>(`/api/scripts/${id}`, { markdown }),
  compileScript: (markdown: string, filename?: string) =>
    http.post<{ script: StoryScript | null; errors: string[]; warnings: string[] }>('/api/scripts/compile', {
      markdown,
      filename,
    }),
  createScript: (body: { id?: string; title?: string; markdown?: string }) =>
    http.post<ScriptRecord>('/api/scripts', body),

  /* 世界书 */
  listBooks: () => http.get<{ items: WorldBook[]; total: number }>('/api/worldbooks'),
  getBook: (id: string) => http.get<WorldBook>(`/api/worldbooks/${id}`),
  createBook: (body: { name: string; description?: string }) => http.post<WorldBook>('/api/worldbooks', body),
  updateBook: (id: string, body: Partial<WorldBook>) => http.patch<WorldBook>(`/api/worldbooks/${id}`, body),
  deleteBook: (id: string) => http.del<{ ok: boolean }>(`/api/worldbooks/${id}`),
  importBook: (payload: unknown) =>
    http.post<{ book: WorldBook; warnings: string[] }>('/api/worldbooks/import', { payload }),

  /* 角色 */
  listCharacters: () => http.get<{ items: CharacterCard[]; total: number }>('/api/characters'),
  getCharacter: (id: string) => http.get<CharacterCard>(`/api/characters/${id}`),
  createCharacter: (body: Partial<CharacterCard>) => http.post<CharacterCard>('/api/characters', body),
  updateCharacter: (id: string, body: Partial<CharacterCard>) =>
    http.patch<CharacterCard>(`/api/characters/${id}`, body),
  deleteCharacter: (id: string) => http.del<{ ok: boolean }>(`/api/characters/${id}`),
  importCharacter: (payload: unknown) =>
    http.post<{ card: CharacterCard; warnings: string[] }>('/api/characters/import', { payload }),
  importCharacterPng: (base64: string) =>
    http.post<{ card: CharacterCard; warnings: string[] }>('/api/characters/import-png', { base64 }),
  rollSheet: (rulePackId?: string) => http.post<CocSheet>('/api/characters/roll-sheet', { rulePackId }),

  /* 图片资源（角色头像 / 世界书配图 / 世界封面） */
  uploadAsset: (data: string, prefix = 'img') =>
    http.post<{ path: string; size: number }>('/api/assets', { data, prefix }),
  deleteAsset: (path: string) =>
    // path 形如 assets/chr-xxx.png，接口挂在 assets 前缀下
    http.del<{ ok: boolean }>(`/api/assets/${path.replace(/^assets\//, '')}`),

  /* 世界线 */
  listSessions: (worldId: string) =>
    http.get<{ items: Session[]; total: number; tree: BranchNode[] }>(`/api/worlds/${worldId}/sessions`),
  getSession: (id: string, memberId?: string) =>
    http.get<SessionDetail>(`/api/sessions/${id}${memberId ? `?memberId=${encodeURIComponent(memberId)}` : ''}`),
  improve: (id: string) =>
    http.post<{
      results: { skill: string; before: number; after: number; roll: number; grew: boolean; gained: number; detail: string }[];
      state: import('@worldtree/shared').SessionState;
      message?: string;
    }>(`/api/sessions/${id}/improve`, {}),
  createSession: (worldId: string, body: Record<string, unknown>) =>
    http.post<{ session: Session; messages: Message[] }>(`/api/worlds/${worldId}/sessions`, body),
  updateSession: (id: string, body: Record<string, unknown>) => http.patch<Session>(`/api/sessions/${id}`, body),
  deleteSession: (id: string) => http.del<{ ok: boolean; deleted?: number }>(`/api/sessions/${id}`),
  importSession: (payload: unknown, worldId?: string) =>
    http.post<{ session: Session; messages: Message[] }>('/api/sessions/import', { payload, worldId }),
  forkSession: (id: string, messageId: string, label?: string) =>
    http.post<{ session: Session; messages: Message[] }>(`/api/sessions/${id}/fork`, { messageId, label }),
  rewindSession: (id: string, messageId: string) =>
    http.post<{ session: Session; messages: Message[] }>(`/api/sessions/${id}/rewind`, { messageId }),
  /** 结局选择：收尾（生成结尾并锁死）或进入尾声 */
  chooseEnding: (id: string, mode: 'closed' | 'epilogue') =>
    http.post<{ state: import('@worldtree/shared').SessionState; outro: string | null }>(
      `/api/sessions/${id}/ending`,
      { mode },
    ),

  /* 骰子 */
  roll: (formula: string, label?: string, seed?: number) =>
    http.post<DiceRoll>('/api/roll', { formula, label, seed }),
  rollCheck: (sessionId: string, skill: string, difficulty?: CheckDifficulty, bonus?: number) =>
    http.post<{ check: import('@worldtree/shared').CheckResult; state: Session['state']; target: number }>(
      `/api/sessions/${sessionId}/roll`,
      { skill, difficulty, bonus },
    ),
  detectIntent: (sessionId: string, content: string) =>
    http.post<{ kind: string; skill?: string; difficulty?: CheckDifficulty; risky: boolean }>(
      `/api/sessions/${sessionId}/intent`,
      { content },
    ),

  /* 设置 */
  getLlm: () => http.get<LlmConfig>('/api/settings/llm'),
  saveLlm: (body: Partial<LlmConfig>) => http.put<LlmConfig>('/api/settings/llm', body),
  getProviders: () =>
    http.get<{ id: string; name: string; baseUrl: string; model: string; hint: string }[]>('/api/settings/providers'),
  testLlm: (body: Partial<LlmConfig>) => http.post<LlmConnectionTest>('/api/settings/llm/test', body),
  listModels: (body: Partial<LlmConfig>) => http.post<{ models: string[] }>('/api/settings/llm/models', body),
  detectLlmContext: () =>
    http.get<{
      probe: { window: number; source: string } | null;
      declared: number;
      effective: number;
    }>('/api/settings/llm/detect'),
  getPrefs: () => http.get<Record<string, unknown>>('/api/settings/prefs'),
  savePrefs: (body: Record<string, unknown>) => http.put<Record<string, unknown>>('/api/settings/prefs', body),

  /* 内容安全（敏感内容分级，admin 可调） */
  getSafety: () => http.get<SafetySettings>('/api/settings/safety'),
  saveSafety: (body: Partial<SafetySettings>) => http.put<SafetySettings>('/api/settings/safety', body),

  /* 账号管理（admin） */
  listUsers: () => http.get<{ items: AccountUser[]; total: number }>('/api/users'),
  createUser: (body: { username: string; password: string; role?: 'admin' | 'user'; displayName?: string }) =>
    http.post<AccountUser>('/api/users', body),
  updateUser: (id: string, body: { disabled?: boolean; password?: string; displayName?: string }) =>
    http.patch<AccountUser>(`/api/users/${id}`, body),
  deleteUser: (id: string) => http.del<{ ok: boolean }>(`/api/users/${id}`),
};

/* ------------------------------------------------------------------ */
/* SSE 聊天流                                                          */
/* ------------------------------------------------------------------ */

export interface StreamHandlers {
  onEvent: (ev: StreamEvent) => void;
  onError?: (msg: string) => void;
  signal?: AbortSignal;
}

export async function streamChat(req: ChatRequest, handlers: StreamHandlers): Promise<void> {
  // 注意：这是原生 fetch，不走 http 封装，必须自己带 token。
  // 早先漏了这一行，表现就是「登录了，一点发送还是提示请登录」。
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch('/api/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify(req),
    signal: handlers.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = `请求失败（${res.status}）`;
    try {
      msg = JSON.parse(text)?.error ?? msg;
    } catch {
      /* ignore */
    }
    // 401 说明登录态失效：清掉本地 token，交给上层跳登录页
    if (res.status === 401 && token) {
      setToken(null);
      notifyUnauthorized();
    }
    handlers.onError?.(msg);
    return;
  }
  if (!res.body) {
    handlers.onError?.('浏览器不支持流式读取');
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const line = chunk.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        handlers.onEvent(JSON.parse(payload) as StreamEvent);
      } catch {
        /* 忽略无法解析的片段 */
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 继承存档                                                            */
/* ------------------------------------------------------------------ */

export interface LegacyCandidate {
  id: string;
  worldId: string;
  worldTitle: string;
  sessionTitle: string;
  characterName: string;
  ending: { nodeId?: string; title?: string; reached: boolean };
  createdAt: number;
  accepted: boolean;
  reason?: string;
}

export interface RoomListItem extends Room {
  online: number;
  worldTitle: string;
}

export interface RoomDetail {
  room: Room;
  session: Session | null;
  messages: Message[];
  world: World | null;
  online: number;
}

export const legaciesApi = {
  list: (filter: { worldId?: string; characterId?: string; sessionId?: string } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filter)) if (v) q.set(k, String(v));
    const qs = q.toString();
    return http.get<{ items: LegacySnapshot[]; total: number }>(`/api/legacies${qs ? `?${qs}` : ''}`);
  },
  get: (id: string) => http.get<LegacySnapshot>(`/api/legacies/${id}`),
  remove: (id: string) => http.del<{ ok: boolean }>(`/api/legacies/${id}`),
  /** 某世界能接收哪些继承存档 */
  forWorld: (worldId: string) =>
    http.get<{ rule: World['inheritance'] | null; candidates: LegacyCandidate[] }>(
      `/api/worlds/${worldId}/inheritance`,
    ),
};

/* ------------------------------------------------------------------ */
/* 多人房间                                                            */
/* ------------------------------------------------------------------ */

export interface CombatActionResponse {
  combat: import('@worldtree/shared').CombatState | null;
  state: import('@worldtree/shared').SessionState;
  log: string[];
  notes: string[];
}

export const combatApi = {
  get: (sessionId: string) =>
    http.get<{ combat: import('@worldtree/shared').CombatState | null }>(`/api/sessions/${sessionId}/combat`),
  start: (sessionId: string, npcs: { name: string; dex: number; hp: number }[], seed?: number) =>
    http.post<CombatActionResponse>(`/api/sessions/${sessionId}/combat/start`, { npcs, seed }),
  attack: (
    sessionId: string,
    body: { attackerId: string; defenderId: string; weapon?: string; defense?: 'dodge' | 'fightBack'; seed?: number },
  ) => http.post<CombatActionResponse>(`/api/sessions/${sessionId}/combat/attack`, body),
  next: (sessionId: string) => http.post<CombatActionResponse>(`/api/sessions/${sessionId}/combat/next`, {}),
  end: (sessionId: string) => http.post<CombatActionResponse>(`/api/sessions/${sessionId}/combat/end`, {}),
};

export const roomsApi = {
  list: () => http.get<{ items: RoomListItem[]; total: number }>('/api/rooms'),
  get: (id: string) => http.get<RoomDetail>(`/api/rooms/${id}`),
  byCode: (code: string) =>
    http.get<{ room: Room; worldTitle: string }>(`/api/rooms/code/${encodeURIComponent(code)}`),
  create: (body: {
    worldId: string;
    hostName: string;
    characterId?: string;
    hostRole?: 'kp' | 'player';
    kpMode?: 'human' | 'ai';
    playerName?: string;
    passcode?: string;
    rulePackId?: string;
    legacyId?: string;
  }) => http.post<{ room: Room; session: Session }>('/api/rooms', body),
  join: (body: { code: string; name: string; characterId?: string; role?: string; passcode?: string }) =>
    http.post<{ room: Room; member: PartyMember; session: Session }>('/api/rooms/join', body),
  start: (id: string, memberId: string) => http.post<Room>(`/api/rooms/${id}/start`, { memberId }),
  next: (id: string, memberId: string) => http.post<Room>(`/api/rooms/${id}/next`, { memberId }),
  ready: (id: string, memberId: string, ready: boolean) =>
    http.post<Room>(`/api/rooms/${id}/ready`, { memberId, ready }),
  skip: (id: string, memberId: string, targetId: string, skipped: boolean) =>
    http.post<Room>(`/api/rooms/${id}/skip`, { memberId, targetId, skipped }),
  bindCharacter: (id: string, memberId: string, characterId: string | null) =>
    http.post<Room>(`/api/rooms/${id}/character`, { memberId, characterId }),
  leave: (id: string, memberId: string) => http.post<Room>(`/api/rooms/${id}/leave`, { memberId }),
  /**
   * 房间实时事件流。
   *
   * 不用原生 EventSource —— 它无法携带 Authorization 头，加了账号体系后必然 401。
   * 这里用 fetch + ReadableStream 手读 SSE（服务端输出格式不变），
   * 既能带 token，也能统一处理 401。
   *
   * 返回一个 close() 函数：调用后中断连接并停止重连。
   */
  events: (id: string, onEvent: (ev: unknown) => void, onError?: (e: Error) => void, memberId?: string) => {
    let closed = false;
    let controller: AbortController | null = null;

    const connect = async () => {
      if (closed) return;
      controller = new AbortController();
      const headers: Record<string, string> = { Accept: 'text/event-stream' };
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;

      // memberId 用于服务端的房间归属校验（有加入码进团的人才有）
      const qs = memberId ? `?memberId=${encodeURIComponent(memberId)}` : '';

      try {
        const res = await fetch(`/api/rooms/${id}/events${qs}`, {
          headers,
          signal: controller.signal,
        });
        if (res.status === 401) {
          setToken(null);
          notifyUnauthorized();
          onError?.(new Error('请先登录'));
          return;
        }
        if (!res.ok || !res.body) {
          onError?.(new Error(`实时连接失败（${res.status}）`));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() ?? '';
          for (const chunk of chunks) {
            for (const line of chunk.split('\n')) {
              if (!line.startsWith('data:')) continue;
              const payload = line.slice(5).trim();
              if (!payload) continue;
              try {
                onEvent(JSON.parse(payload));
              } catch {
                /* 忽略无法解析的片段 */
              }
            }
          }
        }
      } catch (err) {
        if (closed) return;
        if ((err as Error).name !== 'AbortError') {
          onError?.(new Error('实时连接断开'));
          // 断线后 3 秒重连（房间是长连接，网络抖动很常见）
          setTimeout(() => void connect(), 3000);
        }
      }
    };

    void connect();

    return () => {
      closed = true;
      controller?.abort();
    };
  },
};

export type { GameEvent, RulePackId, CharacterAbility };


