import {
  compileScript,
  extractCharaFromPng,
  fromSTCard,
  fromSTWorldInfo,
  listRulePacks,
  MODE_DEFAULT_RULEPACK,
  toSTCard,
  toSTWorldInfo,
  type CharacterCard,
  type ContentHealth,
  type RulePackId,
  type StoryScript,
  type World,
  type WorldBook,
} from '@worldtree/shared';
import {
  checksum,
  listContentFiles,
  readBinaryFile,
  readTextFile,
  removeFile,
  safeFilename,
  writeBinaryFile,
  writeTextFile,
} from '../env.js';
import { all, one, parseJson, run } from '../db.js';
import { loadRulePackPlugins } from './rulepack-plugins.js';

/* ------------------------------------------------------------------ */
/* 类型                                                                 */
/* ------------------------------------------------------------------ */

export interface Loaded<T> {
  value: T | null;
  file: string;
  checksum: string;
  errors: string[];
  warnings: string[];
}

export interface ScriptRecord {
  id: string;
  sourceMd: string;
  script: StoryScript | null;
  errors: string[];
  warnings: string[];
  file: string;
}

/* ------------------------------------------------------------------ */
/* 默认值补全                                                          */
/* ------------------------------------------------------------------ */

function now(): number {
  return Date.now();
}

export function defaultWorld(partial: Partial<World> & { id: string; title: string }): World {
  const t = now();
  return {
    id: partial.id,
    title: partial.title,
    subtitle: partial.subtitle ?? '',
    description: partial.description ?? '',
    coverIcon: partial.coverIcon ?? 'auto_stories',
    coverColor: partial.coverColor ?? '#4f6f52',
    tags: partial.tags ?? [],
    author: partial.author ?? '佚名',
    mode: partial.mode ?? 'story',
    rulePackId: partial.rulePackId ?? MODE_DEFAULT_RULEPACK[partial.mode ?? 'story'] ?? 'narrative',
    opening: partial.opening ?? '',
    setting: partial.setting ?? '',
    rules: {
      allowFreeInput: true,
      choiceCount: 3,
      autoAdvance: false,
      autoCheck: true,
      failForward: false,
      ...(partial.rules ?? {}),
    },
    worldBookId: partial.worldBookId ?? null,
    characterIds: partial.characterIds ?? [],
    // 不写就保持 undefined，老世界文件不会被写进多余字段
    playerCardMode:
      partial.playerCardMode === 'fixed' ? 'fixed' : partial.playerCardMode === 'open' ? 'open' : undefined,
    scriptFile: partial.scriptFile,
    systemPromptOverride: partial.systemPromptOverride,
    // 不写就保持 undefined（默认行为 = 角色卡优先），老世界文件不写多余字段
    sheetRulePrecedence:
      partial.sheetRulePrecedence === 'world'
        ? 'world'
        : partial.sheetRulePrecedence === 'character'
          ? 'character'
          : undefined,
    inheritance: partial.inheritance,
    sorting: partial.sorting,
    createdAt: partial.createdAt ?? t,
    updatedAt: partial.updatedAt ?? t,
    file: partial.file,
    checksum: partial.checksum,
  };
}

/* ------------------------------------------------------------------ */
/* 读取：世界                                                            */
/* ------------------------------------------------------------------ */

export function loadWorldFile(rel: string): Loaded<World> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let raw: Record<string, unknown> = {};

  try {
    raw = JSON.parse(readTextFile(rel)) as Record<string, unknown>;
  } catch (err) {
    return { value: null, file: rel, checksum: '', errors: [`JSON 解析失败：${(err as Error).message}`], warnings };
  }

  const id = String(raw.id ?? rel.replace(/^worlds\//, '').replace(/\.json$/, ''));
  if (!raw.title) {
    errors.push('缺少 title');
    return { value: null, file: rel, checksum: '', errors, warnings };
  }

  const world = defaultWorld({
    ...(raw as Partial<World>),
    id,
    title: String(raw.title),
    file: rel,
  });

  if (world.worldBookId && !worldBookExists(world.worldBookId)) {
    warnings.push(`引用的世界书不存在：${world.worldBookId}`);
  }
  if (world.mode === 'script' && !world.scriptFile) {
    warnings.push('剧本模式的世界没有指定 scriptFile');
  }

  const text = JSON.stringify(raw);
  return { value: world, file: rel, checksum: checksum(text), errors, warnings };
}

export function saveWorldFile(world: World): void {
  const rel = world.file && world.file.startsWith('worlds/') ? world.file : `worlds/${safeFilename(world.id, '.json')}`;
  const payload = {
    ...world,
    file: undefined,
    checksum: undefined,
    updatedAt: Date.now(),
  };
  writeTextFile(rel, JSON.stringify(payload, null, 2));
  world.file = rel;
  world.updatedAt = payload.updatedAt;
  world.checksum = checksum(JSON.stringify(payload, null, 2));
}

/* ------------------------------------------------------------------ */
/* 读取：世界书                                                         */
/* ------------------------------------------------------------------ */

export function loadWorldBookFile(rel: string): Loaded<WorldBook> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let raw: Record<string, unknown>;

  try {
    raw = JSON.parse(readTextFile(rel)) as Record<string, unknown>;
  } catch (err) {
    return { value: null, file: rel, checksum: '', errors: [`JSON 解析失败：${(err as Error).message}`], warnings };
  }

  const fallbackId = rel.replace(/^worldbooks\//, '').replace(/\.json$/, '');

  // 兼容三种格式：原生 / ST World Info（有 entries 为对象）/ ST 扁平
  const isNative = typeof raw.id === 'string' && Array.isArray(raw.entries);
  let book: WorldBook;

  if (isNative) {
    book = {
      id: String(raw.id),
      name: String(raw.name ?? fallbackId),
      description: String(raw.description ?? ''),
      entries: (raw.entries as WorldBook['entries']) ?? [],
      scanDepth: Number(raw.scanDepth ?? 6),
      tokenBudget: Number(raw.tokenBudget ?? 4000),
      recursiveScanning: Boolean(raw.recursiveScanning),
      createdAt: Number(raw.createdAt ?? now()),
      updatedAt: Number(raw.updatedAt ?? now()),
      file: rel,
    };
  } else {
    const res = fromSTWorldInfo(raw, fallbackId);
    book = { ...res.book, file: rel };
    warnings.push(...res.warnings);
  }

  if (!book.entries.length) warnings.push('世界书没有条目');

  return { value: book, file: rel, checksum: checksum(JSON.stringify(raw)), errors, warnings };
}

export function saveWorldBookFile(book: WorldBook): void {
  const rel = book.file && book.file.startsWith('worldbooks/') ? book.file : `worldbooks/${safeFilename(book.id, '.json')}`;
  const payload = { ...book, file: undefined, checksum: undefined, updatedAt: Date.now() };
  writeTextFile(rel, JSON.stringify(payload, null, 2));
  book.file = rel;
  book.updatedAt = payload.updatedAt;
}

/* ------------------------------------------------------------------ */
/* 读取：角色卡（JSON 或 PNG 角色卡）                                   */
/* ------------------------------------------------------------------ */

export function loadCharacterFile(rel: string): Loaded<CharacterCard> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fallbackId = rel.replace(/^characters\//, '').replace(/\.(json|png)$/i, '');

  let parsed: unknown;
  try {
    if (rel.toLowerCase().endsWith('.png')) {
      const bytes = readBinaryFile(rel);
      const b64 = extractCharaFromPng(bytes);
      if (!b64) {
        return {
          value: null,
          file: rel,
          checksum: '',
          errors: ['PNG 中没有找到 chara 数据块（可能不是 SillyTavern 角色卡）'],
          warnings,
        };
      }
      parsed = JSON.parse(decodeBase64(b64));
    } else {
      parsed = JSON.parse(readTextFile(rel));
    }
  } catch (err) {
    return { value: null, file: rel, checksum: '', errors: [`读取失败：${(err as Error).message}`], warnings };
  }

  const obj = parsed as Record<string, unknown>;
  const isNative = typeof obj.id === 'string' && typeof obj.name === 'string' && !('data' in obj);

  let card: CharacterCard;

  if (isNative) {
    card = normalizeNativeCard(obj, fallbackId);
  } else {
    const res = fromSTCard(parsed, fallbackId);
    card = res.card;
    warnings.push(...res.warnings);
  }

  card.file = rel;
  const text = JSON.stringify(parsed);
  return { value: card, file: rel, checksum: checksum(text), errors, warnings };
}

function normalizeNativeCard(raw: Record<string, unknown>, fallbackId: string): CharacterCard {
  const t = now();
  return {
    id: String(raw.id ?? fallbackId),
    spec: 'chara_card_v2',
    specVersion: '2.0',
    name: String(raw.name ?? '未命名角色'),
    description: String(raw.description ?? ''),
    personality: String(raw.personality ?? ''),
    scenario: String(raw.scenario ?? ''),
    firstMes: String(raw.firstMes ?? raw.first_mes ?? ''),
    mesExample: String(raw.mesExample ?? raw.mes_example ?? ''),
    creatorNotes: String(raw.creatorNotes ?? ''),
    systemPrompt: String(raw.systemPrompt ?? ''),
    postHistoryInstructions: String(raw.postHistoryInstructions ?? ''),
    alternateGreetings: Array.isArray(raw.alternateGreetings) ? raw.alternateGreetings.map(String) : [],
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    creator: String(raw.creator ?? ''),
    characterVersion: String(raw.characterVersion ?? '1.0'),
    extensions: (raw.extensions as Record<string, unknown>) ?? {},
    characterBookId: (raw.characterBookId as string | null) ?? null,
    avatarIcon: String(raw.avatarIcon ?? 'person'),
    avatarColor: String(raw.avatarColor ?? '#4f6f52'),
    // 头像图片：老卡没有这个字段，保持 null，前端回落到 avatarIcon
    avatarImage: typeof raw.avatarImage === 'string' && raw.avatarImage ? raw.avatarImage : null,
    isPlayer: Boolean(raw.isPlayer),
    sheet: raw.sheet as CharacterCard['sheet'],
    abilities: raw.abilities as CharacterCard['abilities'],
    createdAt: Number(raw.createdAt ?? t),
    updatedAt: Number(raw.updatedAt ?? t),
    file: raw.file as string | undefined,
  };
}

export function saveCharacterFile(card: CharacterCard): void {
  const rel =
    card.file && card.file.startsWith('characters/') && card.file.toLowerCase().endsWith('.json')
      ? card.file
      : `characters/${safeFilename(card.id, '.json')}`;
  const payload = { ...card, file: undefined, checksum: undefined, updatedAt: Date.now() };
  writeTextFile(rel, JSON.stringify(payload, null, 2));
  card.file = rel;
  card.updatedAt = payload.updatedAt;
}

/** 导出为 ST V2 JSON */
export function exportCharacterAsST(card: CharacterCard): string {
  return JSON.stringify(toSTCard(card), null, 2);
}

export function exportWorldBookAsST(book: WorldBook): string {
  return JSON.stringify(toSTWorldInfo(book), null, 2);
}

/* ------------------------------------------------------------------ */
/* 读取：剧本                                                            */
/* ------------------------------------------------------------------ */

export function loadScriptFile(rel: string): ScriptRecord {
  const fallbackId = rel.replace(/^scripts\//, '').replace(/\.md$/, '');
  let source = '';
  try {
    source = readTextFile(rel);
  } catch (err) {
    return {
      id: fallbackId,
      sourceMd: '',
      script: null,
      errors: [`读取失败：${(err as Error).message}`],
      warnings: [],
      file: rel,
    };
  }

  const res = compileScript(source, { filename: rel.split('/').pop() });
  return {
    id: res.script?.id ?? fallbackId,
    sourceMd: source,
    script: res.script,
    errors: res.errors,
    warnings: res.warnings,
    file: rel,
  };
}

export function saveScriptFile(rel: string, markdown: string): ScriptRecord {
  writeTextFile(rel, markdown);
  return loadScriptFile(rel);
}

/* ------------------------------------------------------------------ */
/* 同步：文件 → 数据库镜像                                              */
/* ------------------------------------------------------------------ */

export function syncAllContent(): ContentHealth {
  const health: ContentHealth = {
    worlds: 0,
    characters: 0,
    worldbooks: 0,
    scripts: 0,
    rulepacks: 0,
    rulepackPlugins: 0,
    errors: [],
    warnings: [],
  };

  // 世界书（先同步，供世界与角色引用）
  run('DELETE FROM c_worldbooks');
  for (const f of listContentFiles('worldbooks', ['.json'])) {
    const loaded = loadWorldBookFile(f.rel);
    if (!loaded.value) {
      health.errors.push({ file: f.rel, message: loaded.errors.join('；') });
      continue;
    }
    run('INSERT OR REPLACE INTO c_worldbooks (id,data_json,file,checksum,sort_key) VALUES (?,?,?,?,?)', [
      loaded.value.id,
      JSON.stringify(loaded.value),
      f.rel,
      loaded.checksum,
      health.worldbooks++,
    ]);
    for (const w of loaded.warnings) health.warnings.push({ file: f.rel, message: w });
  }

  // 角色卡
  run('DELETE FROM c_characters');
  for (const f of listContentFiles('characters', ['.json', '.png'])) {
    const loaded = loadCharacterFile(f.rel);
    if (!loaded.value) {
      health.errors.push({ file: f.rel, message: loaded.errors.join('；') });
      continue;
    }
    run('INSERT OR REPLACE INTO c_characters (id,data_json,file,checksum,sort_key) VALUES (?,?,?,?,?)', [
      loaded.value.id,
      JSON.stringify(loaded.value),
      f.rel,
      loaded.checksum,
      health.characters++,
    ]);
    for (const w of loaded.warnings) health.warnings.push({ file: f.rel, message: w });
  }

  // 剧本
  run('DELETE FROM c_scripts');
  for (const f of listContentFiles('scripts', ['.md'])) {
    const rec = loadScriptFile(f.rel);
    run('INSERT OR REPLACE INTO c_scripts (id,data_json,source_md,file,errors,warnings,checksum) VALUES (?,?,?,?,?,?,?)', [
      rec.id,
      JSON.stringify(rec.script),
      rec.sourceMd,
      f.rel,
      JSON.stringify(rec.errors),
      JSON.stringify(rec.warnings),
      checksum(rec.sourceMd),
    ]);
    if (rec.script) health.scripts++;
    for (const e of rec.errors) health.errors.push({ file: f.rel, message: e });
    for (const w of rec.warnings) health.warnings.push({ file: f.rel, message: w });
  }

  // 世界（最后，便于校验引用）
  run('DELETE FROM c_worlds');
  for (const f of listContentFiles('worlds', ['.json'])) {
    const loaded = loadWorldFile(f.rel);
    if (!loaded.value) {
      health.errors.push({ file: f.rel, message: loaded.errors.join('；') });
      continue;
    }
    run('INSERT OR REPLACE INTO c_worlds (id,data_json,file,checksum,sort_key) VALUES (?,?,?,?,?)', [
      loaded.value.id,
      JSON.stringify(loaded.value),
      f.rel,
      loaded.checksum,
      health.worlds++,
    ]);
    for (const w of loaded.warnings) health.warnings.push({ file: f.rel, message: w });
  }

  return health;
}

/**
 * 同步 + 重载规则书插件。
 *
 * 内容文件（世界/角色/世界书/剧本）是同步读的，但插件是 ESM 动态 import，
 * 必须异步。所以给启动流程和 `POST /api/content/sync` 用这个版本；
 * 其它「保存后顺手重扫」的调用点继续用同步版即可 —— 那些操作不改插件。
 */
export async function syncAllContentAsync(): Promise<ContentHealth> {
  const health = syncAllContent();

  const packs = await loadRulePackPlugins();
  health.rulepackPlugins = packs.loaded.length;
  health.rulepacks = listRulePacks().length;
  for (const e of packs.errors) health.errors.push(e);
  for (const w of packs.warnings) health.warnings.push(w);

  return health;
}

/* ------------------------------------------------------------------ */
/* 读模型查询                                                          */
/* ------------------------------------------------------------------ */

function rowsToJson<T>(rows: { data_json: string }[]): T[] {
  return rows.map((r) => parseJson<T>(r.data_json, null as never)).filter(Boolean) as T[];
}

export const content = {
  worlds(): World[] {
    return rowsToJson<World>(all('SELECT data_json FROM c_worlds ORDER BY sort_key ASC'));
  },
  world(id: string): World | undefined {
    const r = one<{ data_json: string }>('SELECT data_json FROM c_worlds WHERE id = ?', [id]);
    return r ? parseJson<World>(r.data_json, null as never) : undefined;
  },
  characters(): CharacterCard[] {
    return rowsToJson<CharacterCard>(all('SELECT data_json FROM c_characters ORDER BY sort_key ASC'));
  },
  character(id: string): CharacterCard | undefined {
    const r = one<{ data_json: string }>('SELECT data_json FROM c_characters WHERE id = ?', [id]);
    return r ? parseJson<CharacterCard>(r.data_json, null as never) : undefined;
  },
  charactersMany(ids: string[]): CharacterCard[] {
    if (!ids.length) return [];
    const marks = ids.map(() => '?').join(',');
    return rowsToJson<CharacterCard>(all(`SELECT data_json FROM c_characters WHERE id IN (${marks})`, ids));
  },
  worldbooks(): WorldBook[] {
    return rowsToJson<WorldBook>(all('SELECT data_json FROM c_worldbooks ORDER BY sort_key ASC'));
  },
  worldbook(id: string): WorldBook | undefined {
    const r = one<{ data_json: string }>('SELECT data_json FROM c_worldbooks WHERE id = ?', [id]);
    return r ? parseJson<WorldBook>(r.data_json, null as never) : undefined;
  },
  scripts(): (ScriptRecord & { errors: string[] })[] {
    return all<{ id: string; data_json: string; source_md: string; file: string; errors: string; warnings: string }>(
      'SELECT * FROM c_scripts ORDER BY id ASC',
    ).map((r) => ({
      id: r.id,
      sourceMd: r.source_md,
      script: parseJson<StoryScript>(r.data_json, null as never),
      errors: parseJson<string[]>(r.errors, []),
      warnings: parseJson<string[]>(r.warnings, []),
      file: r.file,
    }));
  },
  script(id: string): ScriptRecord | undefined {
    const r = one<{ id: string; data_json: string; source_md: string; file: string; errors: string; warnings: string }>(
      'SELECT * FROM c_scripts WHERE id = ?',
      [id],
    );
    if (!r) return undefined;
    return {
      id: r.id,
      sourceMd: r.source_md,
      script: parseJson<StoryScript>(r.data_json, null as never),
      errors: parseJson<string[]>(r.errors, []),
      warnings: parseJson<string[]>(r.warnings, []),
      file: r.file,
    };
  },
  scriptByFile(file: string): ScriptRecord | undefined {
    const r = one<{ id: string }>('SELECT id FROM c_scripts WHERE file = ?', [file]);
    return r ? content.script(r.id) : undefined;
  },
};

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function worldBookExists(id: string): boolean {
  return !!one('SELECT 1 AS x FROM c_worldbooks WHERE id = ?', [id]);
}

function decodeBase64(text: string): string {
  return Buffer.from(text, 'base64').toString('utf8');
}

/* ------------------------------------------------------------------ */
/* 删除                                                                */
/* ------------------------------------------------------------------ */

export function deleteContentFile(rel: string | undefined): void {
  if (!rel) return;
  removeFile(rel);
}

/* ------------------------------------------------------------------ */
/* 统计                                                                */
/* ------------------------------------------------------------------ */

export function countSessionsByWorld(worldId: string): number {
  const r = one<{ c: number }>('SELECT COUNT(*) AS c FROM sessions WHERE world_id = ?', [worldId]);
  return r?.c ?? 0;
}

export function lastPlayedAt(worldId: string): number | undefined {
  const r = one<{ t: number | null }>('SELECT MAX(updated_at) AS t FROM sessions WHERE world_id = ?', [worldId]);
  return r?.t ?? undefined;
}
