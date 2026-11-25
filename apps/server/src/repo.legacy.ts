import type { LegacySnapshot } from '@worldtree/shared';
import { all, one, parseJson, run, type Row } from './db.js';

function rowToLegacy(r: Row): LegacySnapshot {
  return parseJson<LegacySnapshot>(r.data_json, null as never);
}

export const legacies = {
  list(filter: { worldId?: string; characterId?: string; sessionId?: string } = {}): LegacySnapshot[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.worldId) {
      where.push('world_id = ?');
      params.push(filter.worldId);
    }
    if (filter.characterId) {
      where.push('character_id = ?');
      params.push(filter.characterId);
    }
    if (filter.sessionId) {
      where.push('session_id = ?');
      params.push(filter.sessionId);
    }
    const sql = `SELECT * FROM legacies${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC`;
    return all<Row>(sql, params).map(rowToLegacy).filter(Boolean);
  },

  get(id: string): LegacySnapshot | undefined {
    const r = one<Row>('SELECT * FROM legacies WHERE id = ?', [id]);
    return r ? rowToLegacy(r) : undefined;
  },

  remove(id: string): void {
    run('DELETE FROM legacies WHERE id = ?', [id]);
  },
};

/** 保存一条继承存档（同一条世界线重复结局时覆盖） */
export function saveLegacy(snapshot: LegacySnapshot): LegacySnapshot {
  const existing = one<{ id: string }>('SELECT id FROM legacies WHERE session_id = ?', [snapshot.sessionId]);
  const id = existing?.id ?? snapshot.id;
  const payload: LegacySnapshot = { ...snapshot, id };

  run(
    `INSERT INTO legacies (id,world_id,session_id,character_id,character_name,data_json,created_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json, created_at=excluded.created_at`,
    [
      id,
      payload.worldId,
      payload.sessionId,
      payload.characterId ?? null,
      payload.characterName,
      JSON.stringify(payload),
      payload.createdAt,
    ],
  );
  return payload;
}
