import type { ID, Message, MessageMeta, Session, SessionState } from '@worldtree/shared';
import { all, one, parseJson, run } from './db.js';

type Row = Record<string, any>;

function rowToMessage(r: Row): Message {
  return {
    id: r.id,
    sessionId: r.session_id,
    role: r.role,
    content: r.content,
    meta: parseJson<MessageMeta>(r.meta_json, {}),
    createdAt: r.created_at,
  };
}

export function rowToSession(r: Row): Session {
  return {
    id: r.id,
    worldId: r.world_id,
    title: r.title,
    branchLabel: r.branch_label,
    characterIds: parseJson<ID[]>(r.character_ids_json, []),
    playerName: r.player_name,
    playerCharacterId: r.player_character_id ?? null,
    state: parseJson<SessionState>(r.state_json, null as never),
    parentId: r.parent_id ?? null,
    branchPointMessageId: r.branch_point_message_id ?? null,
    snapshot: parseJson<SessionState | null>(r.snapshot_json, null),
    messageCount: r.message_count,
    archived: !!r.archived,
    ownerId: r.owner_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/* ------------------------------------------------------------------ */
/* 会话                                                                */
/* ------------------------------------------------------------------ */

export const sessions = {
  list(): Session[] {
    return all('SELECT * FROM sessions ORDER BY updated_at DESC').map(rowToSession);
  },
  listByWorld(worldId: ID): Session[] {
    return all('SELECT * FROM sessions WHERE world_id = ? ORDER BY updated_at DESC', [worldId]).map(rowToSession);
  },
  /** 某账号在某世界的世界线（内容库共享，但存档按人隔离） */
  listByWorldOwned(worldId: ID, ownerId: ID | null): Session[] {
    if (!ownerId) return [];
    return all('SELECT * FROM sessions WHERE world_id = ? AND owner_id = ? ORDER BY updated_at DESC', [
      worldId,
      ownerId,
    ]).map(rowToSession);
  },
  /** 某账号的所有世界线 */
  listByOwner(ownerId: ID): Session[] {
    return all('SELECT * FROM sessions WHERE owner_id = ? ORDER BY updated_at DESC', [ownerId]).map(rowToSession);
  },
  get(id: ID): Session | undefined {
    const r = one('SELECT * FROM sessions WHERE id = ?', [id]);
    return r ? rowToSession(r) : undefined;
  },
  insert(s: Session): Session {
    run(
      `INSERT INTO sessions (id,world_id,title,branch_label,character_ids_json,player_name,player_character_id,
        state_json,parent_id,branch_point_message_id,snapshot_json,message_count,archived,owner_id,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        s.id,
        s.worldId,
        s.title,
        s.branchLabel,
        JSON.stringify(s.characterIds),
        s.playerName,
        s.playerCharacterId ?? null,
        JSON.stringify(s.state),
        s.parentId ?? null,
        s.branchPointMessageId ?? null,
        s.snapshot ? JSON.stringify(s.snapshot) : null,
        s.messageCount,
        s.archived ? 1 : 0,
        s.ownerId ?? null,
        s.createdAt,
        s.updatedAt,
      ],
    );
    return s;
  },
  updateState(id: ID, state: SessionState): void {
    run('UPDATE sessions SET state_json = ?, updated_at = ? WHERE id = ?', [JSON.stringify(state), Date.now(), id]);
  },
  update(id: ID, patch: Partial<Session>): Session | undefined {
    const cur = sessions.get(id);
    if (!cur) return undefined;
    const next: Session = { ...cur, ...patch, id, updatedAt: Date.now() };
    run(
      `UPDATE sessions SET title=?,branch_label=?,character_ids_json=?,player_name=?,player_character_id=?,
        state_json=?,archived=?,message_count=?,updated_at=? WHERE id=?`,
      [
        next.title,
        next.branchLabel,
        JSON.stringify(next.characterIds),
        next.playerName,
        next.playerCharacterId ?? null,
        JSON.stringify(next.state),
        next.archived ? 1 : 0,
        next.messageCount,
        next.updatedAt,
        id,
      ],
    );
    return next;
  },
  touch(id: ID, patch: Partial<Pick<Session, 'title' | 'branchLabel' | 'archived' | 'messageCount'>> = {}): void {
    const cur = sessions.get(id);
    if (!cur) return;
    run('UPDATE sessions SET title=?, branch_label=?, archived=?, message_count=?, updated_at=? WHERE id=?', [
      patch.title ?? cur.title,
      patch.branchLabel ?? cur.branchLabel,
      (patch.archived ?? cur.archived) ? 1 : 0,
      patch.messageCount ?? cur.messageCount,
      Date.now(),
      id,
    ]);
  },
  remove(id: ID): void {
    run('DELETE FROM messages WHERE session_id = ?', [id]);
    run('DELETE FROM message_states WHERE session_id = ?', [id]);
    run('DELETE FROM sessions WHERE id = ?', [id]);
  },
  countByWorld(worldId: ID): number {
    return one<{ c: number }>('SELECT COUNT(*) AS c FROM sessions WHERE world_id = ?', [worldId])?.c ?? 0;
  },
  lastPlayed(worldId: ID): number | undefined {
    return one<{ t: number | null }>('SELECT MAX(updated_at) AS t FROM sessions WHERE world_id = ?', [worldId])?.t ?? undefined;
  },
};

/* ------------------------------------------------------------------ */
/* 消息                                                                */
/* ------------------------------------------------------------------ */

export const messages = {
  list(sessionId: ID, limit?: number): Message[] {
    if (limit && limit > 0) {
      return all(
        'SELECT * FROM (SELECT * FROM messages WHERE session_id = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq ASC',
        [sessionId, limit],
      ).map(rowToMessage);
    }
    return all('SELECT * FROM messages WHERE session_id = ? ORDER BY seq ASC', [sessionId]).map(rowToMessage);
  },
  get(id: ID): Message | undefined {
    const r = one('SELECT * FROM messages WHERE id = ?', [id]);
    return r ? rowToMessage(r) : undefined;
  },
  append(msg: Message): Message {
    const seq =
      (one<{ s: number | null }>('SELECT MAX(seq) AS s FROM messages WHERE session_id = ?', [msg.sessionId])?.s ?? 0) + 1;
    run('INSERT INTO messages (id,session_id,role,content,meta_json,seq,created_at) VALUES (?,?,?,?,?,?,?)', [
      msg.id,
      msg.sessionId,
      msg.role,
      msg.content,
      JSON.stringify(msg.meta ?? {}),
      seq,
      msg.createdAt,
    ]);
    run('UPDATE sessions SET message_count = ?, updated_at = ? WHERE id = ?', [seq, Date.now(), msg.sessionId]);
    return msg;
  },
  updateMeta(id: ID, meta: MessageMeta): void {
    run('UPDATE messages SET meta_json = ? WHERE id = ?', [JSON.stringify(meta), id]);
  },
  count(sessionId: ID): number {
    return one<{ c: number }>('SELECT COUNT(*) AS c FROM messages WHERE session_id = ?', [sessionId])?.c ?? 0;
  },
  truncateAfter(sessionId: ID, messageId: ID): void {
    const target = one<{ seq: number }>('SELECT seq FROM messages WHERE id = ? AND session_id = ?', [messageId, sessionId]);
    if (!target) return;
    run('DELETE FROM messages WHERE session_id = ? AND seq > ?', [sessionId, target.seq]);
    run('DELETE FROM message_states WHERE session_id = ? AND seq > ?', [sessionId, target.seq]);
    const max = one<{ s: number | null }>('SELECT MAX(seq) AS s FROM messages WHERE session_id = ?', [sessionId]);
    run('UPDATE sessions SET message_count = ?, updated_at = ? WHERE id = ?', [max?.s ?? 0, Date.now(), sessionId]);
  },
  /** 复制到指定消息为止的历史（含该条），用于分叉 */
  copyUpTo(srcSessionId: ID, destSessionId: ID, messageId: ID): number {
    const target = one<{ seq: number }>('SELECT seq FROM messages WHERE id = ? AND session_id = ?', [messageId, srcSessionId]);
    const limitSeq = target?.seq ?? Number.MAX_SAFE_INTEGER;
    const rows = all<Row>('SELECT * FROM messages WHERE session_id = ? AND seq <= ? ORDER BY seq ASC', [
      srcSessionId,
      limitSeq,
    ]);
    let seq = 0;
    for (const r of rows) {
      seq++;
      const newId = `${r.id}_b${destSessionId.slice(-4)}`;
      run('INSERT INTO messages (id,session_id,role,content,meta_json,seq,created_at) VALUES (?,?,?,?,?,?,?)', [
        newId,
        destSessionId,
        r.role,
        r.content,
        r.meta_json,
        seq,
        r.created_at,
      ]);
      // 状态快照一起搬过去，分叉后才能精确回到那一刻
      run(
        `INSERT INTO message_states (message_id,session_id,seq,state_json)
         SELECT ?,?,?,state_json FROM message_states WHERE message_id = ?`,
        [newId, destSessionId, seq, r.id],
      );
    }
    run('UPDATE sessions SET message_count = ? WHERE id = ?', [rows.length, destSessionId]);
    return rows.length;
  },

  /* ---- 状态快照 ---- */

  /** 保存某条消息对应的完整会话状态 */
  saveState(messageId: ID, sessionId: ID, state: SessionState): void {
    const seq =
      (one<{ s: number | null }>('SELECT seq FROM messages WHERE id = ?', [messageId])?.s) ?? 0;
    run(
      `INSERT INTO message_states (message_id,session_id,seq,state_json) VALUES (?,?,?,?)
       ON CONFLICT(message_id) DO UPDATE SET state_json = excluded.state_json`,
      [messageId, sessionId, seq, JSON.stringify(state)],
    );
  },

  /** 取某条消息当时的状态；没有快照返回 undefined（老数据） */
  stateAt(messageId: ID): SessionState | undefined {
    const r = one<{ state_json: string }>('SELECT state_json FROM message_states WHERE message_id = ?', [messageId]);
    return r ? parseJson<SessionState | undefined>(r.state_json, undefined) : undefined;
  },

  /** 取「seq ≤ 该消息」里最后一份状态快照 —— 回退/分叉的兜底 */
  stateAtOrBefore(sessionId: ID, messageId: ID): SessionState | undefined {
    const target = one<{ seq: number }>('SELECT seq FROM messages WHERE id = ? AND session_id = ?', [messageId, sessionId]);
    if (!target) return undefined;
    const r = one<{ state_json: string }>(
      'SELECT state_json FROM message_states WHERE session_id = ? AND seq <= ? ORDER BY seq DESC LIMIT 1',
      [sessionId, target.seq],
    );
    return r ? parseJson<SessionState | undefined>(r.state_json, undefined) : undefined;
  },
};
