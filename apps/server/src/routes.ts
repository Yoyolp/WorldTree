import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  acceptsFromWorld,
  activeAbilities,
  improvementCheck,
  compileScript,
  getRulePack,
  makeRng,
  MODE_DEFAULT_RULEPACK,
  resolveSkillValue,
  listRulePacks,
  rollFormula,
  serializeScript,
  shortId,
  type CharacterCard,
  type PlayMode,
  type RoomEvent,
  type RulePackId,
  type ScriptCompileResult,
  type StoryScript,
  type World,
  type WorldBook,
} from '@worldtree/shared';
import {
  content,
  defaultWorld,
  deleteContentFile,
  exportCharacterAsST,
  exportWorldBookAsST,
  loadCharacterFile,
  loadWorldBookFile,
  saveCharacterFile,
  saveScriptFile,
  saveWorldBookFile,
  saveWorldFile,
  syncAllContent,
  syncAllContentAsync,
} from './content/store.js';
import { safeFilename, writeBinaryFile, writeTextFile } from './env.js';
import { messages, sessions } from './repo.js';
import { legacies } from './repo.legacy.js';
import {
  advanceTurn,
  bindCharacter,
  broadcast,
  canAct,
  createRoom,
  getRoom,
  getRoomByCode,
  joinRoom,
  listRooms,
  onlineCount,
  removeMember,
  setMemberReady,
  setMemberSkipped,
  startRoom,
  subscribe,
} from './services/rooms.js';
import { cachedProbe, detectContextWindow, getLlmConfig, getPrefs, getSafety, rawLlmConfig, saveLlmConfig, savePrefs, saveSafety } from './settings.js';
import { listModels, PROVIDER_PRESETS, testConnection } from './llm/client.js';
import {
  createSession,
  deleteSession,
  forkSession,
  importSession,
  rewindSession,
  rollSheetForPack,
  sessionTree,
} from './services/sessions.js';
import { characterToPng } from './content/png.js';
import { generateOutro, runTurn } from './services/play.js';
import { attack, beginCombat, endCombat, nextCombatTurn, readCombat } from './services/combat.js';
import { parseIntent, runCheck } from './engine/resolver.js';
import { acquire, withLock } from './lib/session-lock.js';
import { requireRoomAccess, requireSessionAccess } from './lib/access.js';
import { currentUser } from './lib/auth.js';

const uid = (p: string) => shortId(p);

function tagsFromText(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    return raw
      .split(/[、,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------- 健康 / 内容巡检 ---------------- */
  app.get('/api/health', async () => ({ ok: true, version: '0.2.0', time: Date.now() }));

  app.post('/api/content/sync', async () => syncAllContentAsync());

  app.get('/api/content/health', async () => syncAllContentAsync());

  /* ---------------- 规则包 ---------------- */
  app.get('/api/rulepacks', async () => listRulePacks());

  /* ---------------- 世界 ---------------- */
  app.get('/api/worlds', async () => {
    const items = content.worlds().map((w) => ({
      world: w,
      sessionCount: sessions.countByWorld(w.id),
      lastPlayedAt: sessions.lastPlayed(w.id),
    }));
    return { items, total: items.length };
  });

  app.get<{ Params: { id: string } }>('/api/worlds/:id', async (req, reply) => {
    const world = content.world(req.params.id);
    if (!world) return reply.code(404).send({ error: '世界不存在' });
    const scriptRec = world.scriptFile ? content.scriptByFile(world.scriptFile) : undefined;
    return {
      world,
      characters: content.charactersMany(world.characterIds),
      worldBook: world.worldBookId ? content.worldbook(world.worldBookId) ?? null : null,
      script: scriptRec?.script ?? null,
      scriptSource: scriptRec?.sourceMd ?? null,
      scriptErrors: scriptRec?.errors ?? [],
      // 只看自己的世界线；admin 也一样（他自己的）
      sessions: sessions.listByWorldOwned(world.id, req.user?.id ?? null),
    };
  });

  app.post('/api/worlds', async (req, reply) => {
    const schema = z.object({
      title: z.string().min(1, '标题不能为空'),
      subtitle: z.string().optional(),
      description: z.string().optional(),
      mode: z.enum(['story', 'script', 'coc']).optional(),
      rulePackId: z.string().optional(),
      coverIcon: z.string().optional(),
      coverColor: z.string().optional(),
      tags: z.union([z.array(z.string()), z.string()]).optional(),
      author: z.string().optional(),
      opening: z.string().optional(),
      setting: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? '参数错误' });

    const d = parsed.data;
    const id = uid('world');
    const mode = (d.mode ?? 'story') as PlayMode;

    const world = defaultWorld({
      id,
      title: d.title,
      subtitle: d.subtitle ?? '',
      description: d.description ?? '',
      mode,
      rulePackId: (d.rulePackId as RulePackId) ?? MODE_DEFAULT_RULEPACK[mode] ?? 'narrative',
      coverIcon: d.coverIcon ?? 'auto_stories',
      coverColor: d.coverColor ?? '#4f6f52',
      tags: tagsFromText(d.tags),
      author: d.author ?? '佚名',
      opening: d.opening ?? '',
      setting: d.setting ?? '',
      rules: { allowFreeInput: true, choiceCount: 3, autoAdvance: false, autoCheck: true, failForward: false },
      characterIds: [],
      worldBookId: null,
    });

    if (mode === 'script') {
      const rel = `scripts/${safeFilename(id, '.md')}`;
      writeTextFile(rel, starterScriptMarkdown(id, world.title, world.opening));
      world.scriptFile = rel;
    }

    saveWorldFile(world);
    syncAllContent();
    return content.world(id)!;
  });

  app.patch<{ Params: { id: string } }>('/api/worlds/:id', async (req, reply) => {
    const cur = content.world(req.params.id);
    if (!cur) return reply.code(404).send({ error: '世界不存在' });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const next: World = {
      ...cur,
      ...(body as Partial<World>),
      id: cur.id,
      tags: body.tags !== undefined ? tagsFromText(body.tags) : cur.tags,
      rules: { ...cur.rules, ...((body.rules as World['rules']) ?? {}) },
      updatedAt: Date.now(),
    };
    if (next.scriptFile === undefined) next.scriptFile = cur.scriptFile;

    if (next.mode === 'script' && !next.scriptFile) {
      const rel = `scripts/${safeFilename(next.id, '.md')}`;
      writeTextFile(rel, starterScriptMarkdown(next.id, next.title, next.opening));
      next.scriptFile = rel;
    }

    saveWorldFile(next);
    syncAllContent();
    return content.world(cur.id)!;
  });

  app.delete<{ Params: { id: string } }>('/api/worlds/:id', async (req) => {
    const world = content.world(req.params.id);
    if (world) {
      deleteContentFile(world.file);
      for (const s of sessions.listByWorld(world.id)) sessions.remove(s.id);
    }
    syncAllContent();
    return { ok: true };
  });

  /* ---------------- 剧本（Markdown DSL） ---------------- */
  app.get('/api/scripts', async () => ({
    items: content.scripts().map((s) => ({
      id: s.id,
      file: s.file,
      title: s.script?.title ?? s.id,
      nodeCount: s.script?.nodes.length ?? 0,
      eventCount: (s.script?.events.length ?? 0) + (s.script?.nodes ?? []).reduce((a, n) => a + n.events.length, 0),
      errors: s.errors,
      warnings: s.warnings,
    })),
  }));

  app.get<{ Params: { id: string } }>('/api/scripts/:id', async (req, reply) => {
    const rec = content.script(req.params.id);
    if (!rec) return reply.code(404).send({ error: '剧本不存在' });
    return rec;
  });

  app.put<{ Params: { id: string } }>('/api/scripts/:id', async (req, reply) => {
    const rec = content.script(req.params.id);
    if (!rec) return reply.code(404).send({ error: '剧本不存在' });
    const body = (req.body ?? {}) as { markdown?: string };
    if (typeof body.markdown !== 'string') return reply.code(400).send({ error: '缺少 markdown 字段' });
    const saved = saveScriptFile(rec.file, body.markdown);
    syncAllContent();
    return saved;
  });

  app.post('/api/scripts/compile', async (req) => {
    const body = (req.body ?? {}) as { markdown?: string; filename?: string };
    const res: ScriptCompileResult = compileScript(body.markdown ?? '', { filename: body.filename });
    return res;
  });

  app.post('/api/scripts/serialize', async (req) => {
    const body = (req.body ?? {}) as { script?: StoryScript };
    return { markdown: body.script ? serializeScript(body.script) : '' };
  });

  app.post('/api/scripts', async (req) => {
    const body = (req.body ?? {}) as { id?: string; title?: string; markdown?: string };
    const id = body.id || uid('script');
    const rel = `scripts/${safeFilename(id, '.md')}`;
    const saved = saveScriptFile(rel, body.markdown ?? starterScriptMarkdown(id, body.title ?? '新剧本'));
    syncAllContent();
    return saved;
  });

  /* ---------------- 世界书 ---------------- */
  app.get('/api/worldbooks', async () => {
    const items = content.worldbooks();
    return { items, total: items.length };
  });

  app.get<{ Params: { id: string } }>('/api/worldbooks/:id', async (req, reply) => {
    const b = content.worldbook(req.params.id);
    if (!b) return reply.code(404).send({ error: '世界书不存在' });
    return b;
  });

  app.post('/api/worldbooks', async (req, reply) => {
    const body = (req.body ?? {}) as { name?: string; description?: string };
    if (!body.name?.trim()) return reply.code(400).send({ error: '名称不能为空' });

    const now = Date.now();
    const book: WorldBook = {
      id: uid('book'),
      name: body.name.trim(),
      description: body.description ?? '',
      entries: [
        {
          id: uid('entry'),
          comment: '示例条目',
          keys: ['关键词'],
          secondaryKeys: [],
          selective: true,
          selectiveLogic: 'and',
          constant: false,
          caseSensitive: false,
          useRegex: false,
          matchWholeWords: false,
          priority: 100,
          insertionOrder: 0,
          position: 'before_char',
          depth: 0,
          probability: 100,
          useProbability: false,
          group: '',
          cooldown: 0,
          sticky: 0,
          content: '当关键词出现时，这段设定会被注入模型上下文。',
          maxChars: 0,
          enabled: true,
        },
      ],
      scanDepth: 6,
      tokenBudget: 4000,
      recursiveScanning: false,
      createdAt: now,
      updatedAt: now,
    };
    saveWorldBookFile(book);
    syncAllContent();
    return content.worldbook(book.id)!;
  });

  app.patch<{ Params: { id: string } }>('/api/worldbooks/:id', async (req, reply) => {
    const cur = content.worldbook(req.params.id);
    if (!cur) return reply.code(404).send({ error: '世界书不存在' });
    const next: WorldBook = { ...cur, ...(req.body as Partial<WorldBook>), id: cur.id, updatedAt: Date.now() };
    saveWorldBookFile(next);
    syncAllContent();
    return content.worldbook(cur.id)!;
  });

  app.delete<{ Params: { id: string } }>('/api/worldbooks/:id', async (req) => {
    const b = content.worldbook(req.params.id);
    if (b) deleteContentFile(b.file);
    syncAllContent();
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/worldbooks/:id/export', async (req, reply) => {
    const b = content.worldbook(req.params.id);
    if (!b) return reply.code(404).send({ error: '世界书不存在' });
    return reply.type('application/json').send(exportWorldBookAsST(b));
  });

  app.post('/api/worldbooks/import', async (req, reply) => {
    const body = (req.body ?? {}) as { payload?: unknown };
    if (!body.payload) return reply.code(400).send({ error: '缺少 payload' });
    const id = uid('book');
    const rel = `worldbooks/${safeFilename(id, '.json')}`;
    writeTextFile(rel, JSON.stringify(body.payload, null, 2));
    const loaded = loadWorldBookFile(rel);
    if (!loaded.value) {
      deleteContentFile(rel);
      return reply.code(400).send({ error: loaded.errors.join('；') });
    }
    syncAllContent();
    return { book: content.worldbook(loaded.value.id), warnings: loaded.warnings };
  });

  /* ---------------- 角色卡 ---------------- */
  app.get('/api/characters', async () => {
    const items = content.characters();
    return { items, total: items.length };
  });

  app.get<{ Params: { id: string } }>('/api/characters/:id', async (req, reply) => {
    const c = content.character(req.params.id);
    if (!c) return reply.code(404).send({ error: '角色不存在' });
    return c;
  });

  app.post('/api/characters', async (req, reply) => {
    const body = (req.body ?? {}) as Partial<CharacterCard>;
    if (!body.name?.trim()) return reply.code(400).send({ error: '角色名不能为空' });

    const now = Date.now();
    const card: CharacterCard = {
      id: uid('char'),
      spec: 'chara_card_v2',
      specVersion: '2.0',
      name: body.name.trim(),
      description: body.description ?? '',
      personality: body.personality ?? '',
      scenario: body.scenario ?? '',
      firstMes: body.firstMes ?? '',
      mesExample: body.mesExample ?? '',
      creatorNotes: body.creatorNotes ?? '',
      systemPrompt: body.systemPrompt ?? '',
      postHistoryInstructions: body.postHistoryInstructions ?? '',
      alternateGreetings: body.alternateGreetings ?? [],
      tags: body.tags ?? [],
      creator: body.creator ?? '',
      characterVersion: body.characterVersion ?? '1.0',
      extensions: body.extensions ?? {},
      characterBookId: body.characterBookId ?? null,
      avatarIcon: body.avatarIcon ?? 'person',
      avatarColor: body.avatarColor ?? '#4f6f52',
      avatarImage: body.avatarImage ?? null,
      isPlayer: body.isPlayer ?? false,
      sheet: body.sheet,
      createdAt: now,
      updatedAt: now,
    };
    saveCharacterFile(card);
    syncAllContent();
    return content.character(card.id)!;
  });

  app.patch<{ Params: { id: string } }>('/api/characters/:id', async (req, reply) => {
    const cur = content.character(req.params.id);
    if (!cur) return reply.code(404).send({ error: '角色不存在' });
    const body = (req.body ?? {}) as Partial<CharacterCard>;
    const next: CharacterCard = {
      ...cur,
      ...body,
      id: cur.id,
      spec: 'chara_card_v2',
      specVersion: '2.0',
      tags: body.tags !== undefined ? tagsFromText(body.tags) : cur.tags,
      updatedAt: Date.now(),
    };
    saveCharacterFile(next);
    syncAllContent();
    return content.character(cur.id)!;
  });

  app.delete<{ Params: { id: string } }>('/api/characters/:id', async (req) => {
    const c = content.character(req.params.id);
    if (c) deleteContentFile(c.file);
    syncAllContent();
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/characters/:id/export', async (req, reply) => {
    const c = content.character(req.params.id);
    if (!c) return reply.code(404).send({ error: '角色不存在' });
    return reply.type('application/json').send(exportCharacterAsST(c));
  });

  /** 导出为 SillyTavern 可用的 PNG 角色卡 */
  app.get<{ Params: { id: string } }>('/api/characters/:id/export-png', async (req, reply) => {
    const c = content.character(req.params.id);
    if (!c) return reply.code(404).send({ error: '角色不存在' });
    const bytes = characterToPng(c);
    reply
      .header('Content-Type', 'image/png')
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(c.name)}.png"`);
    return reply.send(Buffer.from(bytes));
  });

  app.post('/api/characters/import', async (req, reply) => {
    const body = (req.body ?? {}) as { payload?: unknown };
    if (!body.payload) return reply.code(400).send({ error: '缺少 payload' });
    const id = uid('char');
    const rel = `characters/${safeFilename(id, '.json')}`;
    writeTextFile(rel, JSON.stringify(body.payload, null, 2));
    const loaded = loadCharacterFile(rel);
    if (!loaded.value) {
      deleteContentFile(rel);
      return reply.code(400).send({ error: loaded.errors.join('；') });
    }
    syncAllContent();
    return { card: content.character(loaded.value.id), warnings: loaded.warnings };
  });

  app.post('/api/characters/import-png', async (req, reply) => {
    const body = (req.body ?? {}) as { base64?: string };
    if (!body.base64) return reply.code(400).send({ error: '缺少 base64 图像数据' });
    const id = uid('char');
    const rel = `characters/${safeFilename(id, '.png')}`;
    writeBinaryFile(rel, Uint8Array.from(Buffer.from(body.base64, 'base64')));
    const loaded = loadCharacterFile(rel);
    if (!loaded.value) {
      deleteContentFile(rel);
      return reply.code(400).send({ error: loaded.errors.join('；') });
    }
    syncAllContent();
    return { card: content.character(loaded.value.id), warnings: loaded.warnings };
  });

  /**
   * 按规则书掷一份面板。
   *
   * 老版本固定返回 COC 调查员；现在接受 `?rulePackId=`，
   * 让角色卡编辑页能给 D&D 之类的规则书掷各自的属性。
   */
  app.post('/api/characters/roll-sheet', async (req) => {
    const body = (req.body ?? {}) as { rulePackId?: string; seed?: number };
    const pack = getRulePack(body.rulePackId ?? 'coc7');
    const sheet = rollSheetForPack(pack, body.seed ?? Date.now());
    if (!sheet) throw new Error(`规则包「${pack.name}」没有声明角色面板结构，无法随机生成`);
    return sheet;
  });

  /* ---------------- 世界线 ---------------- */
  app.get<{ Params: { worldId: string } }>('/api/worlds/:worldId/sessions', async (req) => {
    const ownerId = req.user?.id ?? null;
    const items = sessions.listByWorldOwned(req.params.worldId, ownerId);
    // 树也只算自己的，避免父节点不属于自己时出现「孤立分支」
    const ownIds = new Set(items.map((s) => s.id));
    const tree = sessionTree(req.params.worldId).filter((n) => ownIds.has(n.session.id));
    return { items, total: items.length, tree };
  });

  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const s = requireSessionAccess(req, reply, req.params.id);
    if (!s) return reply;
    const world = content.world(s.worldId);
    // 视角过滤：pov 指向别人的私密消息不返回
    const viewer = String((req.query as { memberId?: string }).memberId ?? '');
    const all = messages.list(s.id);
    const visible = viewer
      ? all.filter((m) => !m.meta?.pov || m.meta.pov === viewer)
      : all;
    return {
      session: s,
      world: world ?? null,
      messages: visible,
      characters: content.charactersMany(s.characterIds),
      script: world?.scriptFile ? content.scriptByFile(world.scriptFile)?.script ?? null : null,
    };
  });

  app.post<{ Params: { worldId: string } }>('/api/worlds/:worldId/sessions', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      return createSession({
        worldId: req.params.worldId,
        title: body.title as string | undefined,
        branchLabel: body.branchLabel as string | undefined,
        characterIds: body.characterIds as string[] | undefined,
        playerName: body.playerName as string | undefined,
        playerCharacterId: body.playerCharacterId as string | null | undefined,
        rulePackId: body.rulePackId as RulePackId | undefined,
        sheetSeed: body.sheetSeed as number | undefined,
        legacyId: body.legacyId as string | undefined,
        ownerId: req.user?.id ?? null,
      });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.patch<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const s = requireSessionAccess(req, reply, req.params.id);
    if (!s) return reply;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const patch: Partial<typeof s> = {};
    if (typeof body.title === 'string') patch.title = body.title;
    if (typeof body.branchLabel === 'string') patch.branchLabel = body.branchLabel;
    if (typeof body.archived === 'boolean') patch.archived = body.archived;
    if (body.state && typeof body.state === 'object') patch.state = body.state as typeof s.state;
    if (typeof body.rulePackId === 'string') {
      patch.state = { ...(patch.state ?? s.state), rulePackId: body.rulePackId as RulePackId };
    }
    return sessions.update(s.id, patch);
  });

  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const s = requireSessionAccess(req, reply, req.params.id);
    if (!s) return reply;
    const result = deleteSession(s.id);
    return { ok: true, deleted: result.deleted };
  });

  /* ---------------- 存档导出 / 导入 ---------------- */
  app.get<{ Params: { id: string } }>('/api/sessions/:id/export', async (req, reply) => {
    const s = requireSessionAccess(req, reply, req.params.id);
    if (!s) return reply;
    const world = content.world(s.worldId);
    const payload = {
      format: 'worldtree-save',
      version: 1,
      exportedAt: Date.now(),
      world: world
        ? { id: world.id, title: world.title, subtitle: world.subtitle, mode: world.mode }
        : { id: s.worldId, title: '（原世界已删除）', subtitle: '', mode: 'story' },
      session: s,
      messages: messages.list(s.id),
      characters: content.charactersMany(s.characterIds).map((c) => ({
        id: c.id,
        name: c.name,
        avatarIcon: c.avatarIcon,
        avatarColor: c.avatarColor,
      })),
    };
    const filename = encodeURIComponent(`${s.title}.wtsave.json`);
    reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    return reply.send(JSON.stringify(payload, null, 2));
  });

  app.post('/api/sessions/import', async (req, reply) => {
    const body = (req.body ?? {}) as {
      payload?: unknown;
      /** 目标世界；不传则按存档里的 worldId / 世界标题匹配 */
      worldId?: string;
    };
    const raw = body.payload as Record<string, unknown> | undefined;
    if (!raw || raw.format !== 'worldtree-save') {
      return reply.code(400).send({ error: '不是有效的世界树存档文件（缺少 format: worldtree-save）' });
    }

    const rawSession = raw.session as Record<string, unknown> | undefined;
    if (!rawSession) return reply.code(400).send({ error: '存档缺少 session 字段' });

    // 解析目标世界：优先用存档原本的世界；worldId 只在原世界缺失时作为替代
    const savedWorld = raw.world as { id?: string; title?: string } | undefined;
    const originalWorld = savedWorld?.id ? content.world(savedWorld.id) : undefined;

    if (originalWorld && body.worldId && body.worldId !== originalWorld.id) {
      return reply.code(400).send({
        error: `这个存档属于「${originalWorld.title}」，不能导入到其他世界。请直接导入；若原世界已被删除，再指定一个替代世界。`,
      });
    }

    let world = originalWorld ?? (body.worldId ? content.world(body.worldId) : undefined);
    if (!world && savedWorld?.title) {
      world = content.worlds().find((w) => w.title === savedWorld.title);
    }
    if (!world) {
      return reply.code(400).send({
        error: `找不到对应的世界「${savedWorld?.title ?? savedWorld?.id ?? '未知'}」，请先导入该世界，或显式指定 worldId`,
      });
    }

    try {
      const result = importSession(raw as never, world.id, req.user?.id ?? null);
      return result;
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/fork', async (req, reply) => {
    const body = (req.body ?? {}) as { messageId?: string; label?: string };
    if (!body.messageId) return reply.code(400).send({ error: '需要 messageId' });
    try {
      return forkSession({ sessionId: req.params.id, messageId: body.messageId, label: body.label });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/rewind', async (req, reply) => {
    const body = (req.body ?? {}) as { messageId?: string };
    if (!body.messageId) return reply.code(400).send({ error: '需要 messageId' });
    try {
      return rewindSession(req.params.id, body.messageId);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/state', async (req, reply) => {
    const s = requireSessionAccess(req, reply, req.params.id);
    if (!s) return reply;
    const body = (req.body ?? {}) as { state?: typeof s.state };
    if (!body.state) return reply.code(400).send({ error: '缺少 state' });
    sessions.updateState(s.id, body.state);
    return body.state;
  });

  /* ---------------- 掷骰 / 检定 ---------------- */
  app.post('/api/roll', async (req) => {
    const body = (req.body ?? {}) as { formula?: string; label?: string; seed?: number };
    const rng = body.seed ? makeRng(body.seed) : () => Math.random();
    return rollFormula(body.formula ?? '1d100', body.label ?? '投骰', rng);
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/roll', async (req, reply) => {
    const s = requireSessionAccess(req, reply, req.params.id);
    if (!s) return reply;

    const body = (req.body ?? {}) as {
      formula?: string;
      skill?: string;
      difficulty?: 'regular' | 'hard' | 'extreme';
      bonus?: number;
      seed?: number;
    };
    const rng = makeRng(body.seed ?? Date.now());

    if (body.skill) {
      const pack = getRulePack(s.state.rulePackId);
      // 能力加值也要算进来，否则界面上的手动检定和实际推演不一致
      const playerChar = s.playerCharacterId
        ? content.character(s.playerCharacterId)
        : content.charactersMany(s.characterIds).find((c) => c.isPlayer);
      const abilities = activeAbilities(s.state, playerChar?.abilities);
      const bundle = runCheck(
        s.state,
        { skill: body.skill, difficulty: body.difficulty, bonus: body.bonus },
        pack,
        rng,
        { abilities },
      );
      // 手动掷骰也算「用过这个技能」，幕间可以成长
      if (bundle.check?.success) {
        const used = new Set(s.state.skillsUsed ?? []);
        used.add(bundle.check.skill);
        sessions.updateState(s.id, { ...bundle.state, skillsUsed: [...used] });
        return { check: bundle.check, state: { ...bundle.state, skillsUsed: [...used] }, target: resolveSkillValue(s.state.sheet, body.skill) };
      }
      return { check: bundle.check, state: bundle.state, target: resolveSkillValue(s.state.sheet, body.skill) };
    }
    return rollFormula(body.formula ?? '1d100', '投骰', rng);
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/intent', async (req, reply) => {
    const s = requireSessionAccess(req, reply, req.params.id);
    if (!s) return reply;
    const body = (req.body ?? {}) as { content?: string };
    return parseIntent(body.content ?? '', getRulePack(s.state.rulePackId));
  });

  /* ---------------- 设置 ---------------- */
  // 模型接入属于「敏感设置」：只有 admin 能看 Key 状态与改参数。
  // 普通账号只拿到「能不能玩」的只读信息，避免拿到别人的 API Key 配置。
  app.get('/api/settings/llm', async (req, reply) => {
    if (req.user?.role !== 'admin') {
      return reply.code(403).send({ error: '只有管理员能查看模型设置' });
    }
    const cfg = getLlmConfig();
    return { ...cfg, apiKey: cfg.apiKey ? '••••••••' : '', probe: cachedProbe(cfg.baseUrl) };
  });

  // 探测本地推理服务真实能用的上下文（llama.cpp 的 --parallel 会切成好几份）
  app.get('/api/settings/llm/detect', async (req, reply) => {
    if (req.user?.role !== 'admin') return reply.code(403).send({ error: '只有管理员能探测上下文' });
    const probe = await detectContextWindow(true);
    const cfg = getLlmConfig();
    return {
      probe,
      declared: rawLlmConfig().contextWindow,
      effective: cfg.contextWindow,
    };
  });

  app.put('/api/settings/llm', async (req, reply) => {
    if (req.user?.role !== 'admin') return reply.code(403).send({ error: '只有管理员能修改模型设置' });
    const patch = { ...((req.body ?? {}) as Record<string, unknown>) };
    if (patch.apiKey === '••••••••') delete patch.apiKey;
    const next = saveLlmConfig(patch as never);
    return { ...next, apiKey: next.apiKey ? '••••••••' : '' };
  });

  app.get('/api/settings/providers', async () => PROVIDER_PRESETS);

  app.post('/api/settings/llm/test', async (req, reply) => {
    if (req.user?.role !== 'admin') return reply.code(403).send({ error: '只有管理员能测试模型连接' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const cfg = { ...getLlmConfig(), ...body };
    if (cfg.apiKey === '••••••••') cfg.apiKey = getLlmConfig().apiKey;
    return testConnection(cfg);
  });

  app.post('/api/settings/llm/models', async (req, reply) => {
    if (req.user?.role !== 'admin') return reply.code(403).send({ error: '只有管理员能拉取模型列表' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const cfg = { ...getLlmConfig(), ...body };
    if (cfg.apiKey === '••••••••') cfg.apiKey = getLlmConfig().apiKey;
    try {
      return { models: await listModels(cfg) };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  /* ---- 内容安全（敏感内容分级）：admin 可调，影响提示词红线 ---- */
  app.get('/api/settings/safety', async () => getSafety());
  app.put('/api/settings/safety', async (req, reply) => {
    if (req.user?.role !== 'admin') return reply.code(403).send({ error: '只有管理员能调整内容安全设置' });
    return saveSafety((req.body ?? {}) as never);
  });

  app.get('/api/settings/prefs', async () => getPrefs());
  app.put('/api/settings/prefs', async (req) => savePrefs((req.body ?? {}) as never));

  /* ---------------- 继承存档 ---------------- */
  app.get('/api/legacies', async (req) => {
    const q = (req.query ?? {}) as { worldId?: string; characterId?: string; sessionId?: string };
    const items = legacies.list(q);
    return { items, total: items.length };
  });

  app.get<{ Params: { id: string } }>('/api/legacies/:id', async (req, reply) => {
    const l = legacies.get(req.params.id);
    if (!l) return reply.code(404).send({ error: '继承存档不存在' });
    return l;
  });

  app.delete<{ Params: { id: string } }>('/api/legacies/:id', async (req) => {
    legacies.remove(req.params.id);
    return { ok: true };
  });

  /** 某个世界能不能接收某条继承存档 */
  app.get<{ Params: { id: string } }>('/api/worlds/:id/inheritance', async (req, reply) => {
    const world = content.world(req.params.id);
    if (!world) return reply.code(404).send({ error: '世界不存在' });
    const rule = world.inheritance;
    const candidates = legacies.list().map((l) => ({
      id: l.id,
      worldId: l.worldId,
      worldTitle: l.worldTitle,
      sessionTitle: l.sessionTitle,
      characterName: l.characterName,
      ending: l.ending,
      createdAt: l.createdAt,
      accepted: !!rule?.enabled && acceptsFromWorld(rule, l.worldId),
      reason: !rule?.enabled
        ? `《${world.title}》没有声明支持继承`
        : !acceptsFromWorld(rule, l.worldId)
          ? `只接受来自指定世界的存档`
          : undefined,
    }));
    return { rule: rule ?? null, candidates };
  });

  /* ---------------- 多人房间 ---------------- */
  app.get('/api/rooms', async (req) => {
    const me = req.user!;
    // 自己的房间 + 自己是成员的房间（进过团的人能看到自己那桌）
    const items = listRooms()
      .filter((r) => {
        if (me.role === 'admin') return true;
        if (r.ownerId && r.ownerId === me.id) return true;
        // 加入码进过团：成员表里有这个名字绑定的房间（memberId 存在会话里，这里按 owner 兜底）
        return false;
      })
      .map((r) => ({
        ...r,
        online: onlineCount(r.id),
        worldTitle: content.world(r.worldId)?.title ?? '',
      }));
    return { items, total: items.length };
  });

  app.get<{ Params: { id: string } }>('/api/rooms/:id', async (req, reply) => {
    const memberId = String((req.query as { memberId?: string }).memberId ?? '');
    const room = requireRoomAccess(req, reply, req.params.id, memberId);
    if (!room) return reply;
    return {
      room,
      session: sessions.get(room.sessionId) ?? null,
      messages: messages.list(room.sessionId),
      world: content.world(room.worldId) ?? null,
      online: onlineCount(room.id),
    };
  });

  app.get<{ Params: { code: string } }>('/api/rooms/code/:code', async (req, reply) => {
    const room = getRoomByCode(req.params.code);
    if (!room) return reply.code(404).send({ error: '加入码无效' });
    // 有加入码 = 有凭证，允许看房间基本信息以便加入
    return { room, worldTitle: content.world(room.worldId)?.title ?? '' };
  });
  
  app.post('/api/rooms', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const res = createRoom({
        worldId: String(body.worldId ?? ''),
        hostName: String(body.hostName ?? '主持人'),
        characterId: body.characterId as string | undefined,
        hostRole: body.hostRole as never,
        kpMode: body.kpMode as never,
        playerName: body.playerName as string | undefined,
        passcode: body.passcode as string | undefined,
        rulePackId: body.rulePackId as string | undefined,
        legacyId: body.legacyId as string | undefined,
        ownerId: req.user?.id ?? null,
      });
      return res;
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/rooms/join', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      return joinRoom({
        code: String(body.code ?? ''),
        name: String(body.name ?? ''),
        characterId: body.characterId as string | undefined,
        role: body.role as never,
        passcode: body.passcode as string | undefined,
      });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>('/api/rooms/:id/start', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as { memberId?: string };
      const room = getRoom(req.params.id);
      if (!room) return reply.code(404).send({ error: '房间不存在' });
      if (body.memberId && body.memberId !== room.hostMemberId) {
        return reply.code(403).send({ error: '只有房主能开始' });
      }
      return startRoom(room.id);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>('/api/rooms/:id/next', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as { memberId?: string };
      const room = getRoom(req.params.id);
      if (!room) return reply.code(404).send({ error: '房间不存在' });
      if (body.memberId && body.memberId !== room.hostMemberId) {
        return reply.code(403).send({ error: '只有房主能推进回合' });
      }
      return advanceTurn(room.id);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>('/api/rooms/:id/ready', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as { memberId?: string; ready?: boolean };
      if (!body.memberId) return reply.code(400).send({ error: '缺少 memberId' });
      return setMemberReady(req.params.id, body.memberId, !!body.ready);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>('/api/rooms/:id/skip', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as { memberId?: string; targetId?: string; skipped?: boolean };
      if (!body.memberId || !body.targetId) return reply.code(400).send({ error: '缺少参数' });
      return setMemberSkipped(req.params.id, body.targetId, !!body.skipped, body.memberId);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>('/api/rooms/:id/character', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as { memberId?: string; characterId?: string | null };
      if (!body.memberId) return reply.code(400).send({ error: '缺少 memberId' });
      return bindCharacter(req.params.id, body.memberId, body.characterId ?? null);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>('/api/rooms/:id/leave', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as { memberId?: string };
      if (!body.memberId) return reply.code(400).send({ error: '缺少 memberId' });
      return removeMember(req.params.id, body.memberId);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  /** 房间实时通道 */
  app.get<{ Params: { id: string }; Querystring: { memberId?: string } }>('/api/rooms/:id/events', async (req, reply) => {
    // 归属校验：房主或已在房间里的成员（memberId 由加入码换来）才能订阅。
    // 早先这里只要登录就放行，等于任何账号都能偷看别人的团。
    const memberId = String(req.query?.memberId ?? '');
    const room = requireRoomAccess(req, reply, req.params.id, memberId);
    if (!room) return reply;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (ev: RoomEvent) => reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
    send({ type: 'room', room });

    const unsubscribe = subscribe(room.id, send);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 20000);

    req.raw.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });

    return reply;
  });
  /* ---------------- 幕间：技能成长 ---------------- */
  app.post<{ Params: { id: string } }>('/api/sessions/:id/improve', async (req, reply) => {
    const s = requireSessionAccess(req, reply, req.params.id);
    if (!s) return reply;
    if (!s.state.sheet) return reply.code(400).send({ error: '这条世界线没有跑团面板' });

    const used = s.state.skillsUsed ?? [];
    if (!used.length) {
      return { results: [], state: s.state, message: '本幕还没有成功用过的技能' };
    }

    const rng = makeRng(Date.now());
    const sheet = structuredClone(s.state.sheet);
    const results: ReturnType<typeof improvementCheck>[] = [];
    /** 真正参与成长判定的技能（面板里找得到的） */
    const settled: string[] = [];

    for (const name of used) {
      const idx = sheet.skills.findIndex((x) => x.name === name);
      // 面板里没有这个技能（例如换绑了角色卡）：跳过，且**不算已结算**
      if (idx < 0) continue;
      const before = sheet.skills[idx].value;
      const r = improvementCheck(name, before, rng);
      sheet.skills[idx].value = r.after;
      results.push(r);
      settled.push(name);
    }

    // 一个技能都没结算成功时，不要把 skillsUsed 清空 ——
    // 否则玩家点一下「技能成长」，什么都没得到，本幕的记录还全没了。
    if (!settled.length) {
      return {
        results: [],
        state: s.state,
        message: '本幕用过的技能在当前面板里找不到，没有可结算的项目（记录已保留）',
      };
    }

    // 只移除本次真正结算过的技能，未结算的继续留着
    const remaining = used.filter((n) => !settled.includes(n));
    const state = { ...s.state, sheet, skillsUsed: remaining };
    sessions.updateState(s.id, state);
    return { results, state };
  });

  /* ---------------- 结局：收尾 / 尾声 ---------------- */
  /**
   * 玩家在结局卡片上做出选择。
   *
   * mode='closed'    → 生成一段收尾叙事（用模型），之后锁死对话
   * mode='epilogue'  → 进入尾声模式，可以继续聊，但不再重复结局提示
   */
  app.post<{ Params: { id: string } }>('/api/sessions/:id/ending', async (req, reply) => {
    const s = requireSessionAccess(req, reply, req.params.id);
    if (!s) return reply;
    const body = (req.body ?? {}) as { mode?: 'closed' | 'epilogue' };
    const mode = body.mode;
    if (mode !== 'closed' && mode !== 'epilogue') {
      return reply.code(400).send({ error: 'mode 只能是 closed 或 epilogue' });
    }

    const cur = s.state.ending;
    let state = {
      ...s.state,
      ending: {
        nodeId: cur?.nodeId,
        title: cur?.title,
        announced: true,
        mode,
        outroGenerated: cur?.outroGenerated ?? false,
      },
    };

    let outro: string | null = null;

    // 选「收尾」：生成一段结尾并落成一条消息。
    // 按产品决定，离线/失败时不写本地兜底文本 —— 只是不生成，界面照常锁死。
    if (mode === 'closed' && !state.ending.outroGenerated) {
      outro = await generateOutro(s.id);
      if (outro) {
        const msgId = shortId('msg');
        messages.append({
          id: msgId,
          sessionId: s.id,
          role: 'assistant',
          content: outro,
          meta: { ending: { nodeId: cur?.nodeId, title: cur?.title } },
          createdAt: Date.now(),
        });
        messages.saveState(msgId, s.id, state);
        state = { ...state, ending: { ...state.ending, outroGenerated: true } };
      }
    }

    sessions.updateState(s.id, state);
    return { state, outro };
  });

  /* ---------------- 战斗 ---------------- */
  app.get<{ Params: { id: string } }>('/api/sessions/:id/combat', async (req, reply) => {
    const s = requireSessionAccess(req, reply, req.params.id);
    if (!s) return reply;
    return { combat: readCombat(s) };
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/combat/start', async (req, reply) => {
    const s = requireSessionAccess(req, reply, req.params.id);
    if (!s) return reply;
    const body = (req.body ?? {}) as { npcs?: { name: string; dex: number; hp: number; hpMax?: number }[]; seed?: number };
    try {
      return beginCombat(s, body);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/combat/attack', async (req, reply) => {
    const s = requireSessionAccess(req, reply, req.params.id);
    if (!s) return reply;
    const body = (req.body ?? {}) as {
      attackerId?: string;
      defenderId?: string;
      weapon?: string;
      defense?: 'dodge' | 'fightBack';
      seed?: number;
    };
    if (!body.attackerId || !body.defenderId) {
      return reply.code(400).send({ error: '缺少 attackerId / defenderId' });
    }
    try {
      return attack(s, {
        attackerId: body.attackerId,
        defenderId: body.defenderId,
        weapon: body.weapon,
        defense: body.defense,
        seed: body.seed,
      });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/combat/next', async (req, reply) => {
    const s = requireSessionAccess(req, reply, req.params.id);
    if (!s) return reply;
    try {
      return nextCombatTurn(s);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/combat/end', async (req, reply) => {
    const s = requireSessionAccess(req, reply, req.params.id);
    if (!s) return reply;
    try {
      return endCombat(s);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
  /* ---------------- 推演 ---------------- */
  app.post('/api/chat', async (req, reply) => {
    const body = (req.body ?? {}) as {
      sessionId?: string;
      content?: string;
      intent?: string;
      choiceId?: string;
      roll?: {
        formula?: string;
        skill?: string;
        difficulty?: 'regular' | 'hard' | 'extreme';
        bonus?: number;
        push?: boolean;
        spendLuck?: number;
      };
      /** 多人：房间与行动者 */
      roomId?: string;
      memberId?: string;
      /** 本回合使用的能力 */
      useAbility?: string;
      /** 要跳转到的剧本节点（模型选项带 next 时由前端带回） */
      goto?: string;
      /** 导演指令（真人 KP 用） */
      kpMode?: 'human' | 'ai';
      /** 只发给某个成员 */
      privateTo?: string;
    };
    if (!body.sessionId) return reply.code(400).send({ error: '缺少 sessionId' });

    // 结局已「收尾」：不再允许继续对话。玩家应回退，或开一条新世界线。
    {
      const st = sessions.get(body.sessionId);
      if (st?.state.ending?.mode === 'closed') {
        return reply.code(409).send({
          error: '这条世界线已经结束。可以回退到结局之前，或者开一条新的世界线。',
        });
      }
    }

    // 多人：校验是否轮到这位成员
    const room = body.roomId ? getRoom(body.roomId) : undefined;
    if (room) {
      if (room.sessionId !== body.sessionId) {
        return reply.code(400).send({ error: '房间与存档不匹配' });
      }
      if (!body.memberId) return reply.code(400).send({ error: '多人模式需要 memberId' });

      const member = room.members.find((m) => m.id === body.memberId);
      if (!member) return reply.code(403).send({ error: '你不在这个团里' });

      // 导演指令只能由 KP 下
      if (body.intent === 'direct' && member.role !== 'kp') {
        return reply.code(403).send({ error: '只有 KP 能下导演指令' });
      }

      const isHost = body.memberId === room.hostMemberId;
      const gate = canAct(room, body.memberId);
      if (!gate.ok && !isHost) {
        return reply.code(409).send({ error: gate.reason ?? '还没轮到你' });
      }
    }

    /** 多人：一回合结束后广播结果并轮到下一位 */
    const finishRoomTurn = (doneEvent: { message?: unknown; session?: unknown } | null) => {
      if (!room) return;
      try {
        const msg = doneEvent?.message as { content?: string; meta?: Record<string, unknown> } | undefined;
        const actor = room.members.find((m) => m.id === body.memberId);
        if (msg && actor) {
          broadcast(room.id, {
            type: 'notice',
            text: `${actor.name}：${body.content || '（选择了选项）'}`,
          });
        }
        // 结局后不再轮转；KP 的导演指令也不占玩家回合
        const ended = !!(msg?.meta && (msg.meta as { ending?: unknown }).ending);
        if (!ended && body.intent !== 'direct') advanceTurn(room.id);
      } catch {
        /* 广播失败不影响主流程 */
      }
    };

    const wantsStream = String(req.headers.accept ?? '').includes('text/event-stream');
    const signal = AbortSignal.timeout(180_000);

    const payload = {
      sessionId: body.sessionId,
      content: body.content ?? '',
      intent: (body.intent as never) ?? 'say',
      choiceId: body.choiceId,
      roll: body.roll,
      roomId: body.roomId,
      memberId: body.memberId,
      useAbility: body.useAbility,
      goto: body.goto,
      kpMode: room?.kpMode ?? 'ai',
      privateTo: body.privateTo,
    };

    if (!wantsStream) {
      const events: unknown[] = [];
      let done: unknown = null;
      try {
        // 同一世界线的推演必须串行：读 state → 算 → 写回不是原子操作，
        // 并发两回合会互相覆盖，丢掉其中一次的回合状态（与事件计数）。
        await withLock(`turn:${body.sessionId}`, async () => {
          for await (const ev of runTurn(payload, signal)) {
            events.push(ev);
            if (ev.type === 'done') done = ev;
          }
        });
        finishRoomTurn(done as { message?: unknown; session?: unknown } | null);
        return { events, done };
      } catch (err) {
        return reply.code(500).send({ error: (err as Error).message });
      }
    }

    // 流式：先排队拿锁，整段结束后释放。否则两个 SSE 会同时改同一条世界线。
    const release = await acquire(`turn:${body.sessionId}`);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (data: unknown) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      for await (const ev of runTurn(payload, signal)) {
        send(ev);
        if (ev.type === 'done') finishRoomTurn(ev as never);
      }
    } catch (err) {
      send({ type: 'error', message: (err as Error).message });
    } finally {
      release();
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
    }
    return reply;
  });
}

/* ------------------------------------------------------------------ */
/* 剧本骨架                                                            */
/* ------------------------------------------------------------------ */

function starterScriptMarkdown(id: string, title: string, opening?: string): string {
  return `---
id: ${id}
title: ${title}
rulePack: coc7
---

# 开篇 {id=start}

${opening || '故事从这里开始。'}

::: event 第一次响动 once chance=100%
远处传来一声并不属于任何人的响动。
- san: -1
:::

- [继续向前] -> 岔路
- [先退回去] -> 退路

# 岔路 {id=fork}

两条路在雾里分开，你只能选一条。

- [左边] -> 结局 {check=侦查 常规}
- [右边] -> 结局

# 退路 {id=back}

你退回原处，但退路已经不见了。

- [回头再看] -> 结局

# 结局 {id=end ending=雾散}

雾散开了。你意识到，这才是开始。
`;
}





