import {
  acceptsFromWorld,
  applyLegacyToState,
  COC_SHEET_SCHEMA,
  createSheetFromSchema,
  emptyEventState,
  filterLegacy,
  getRulePack,
  makeRng,
  migrateSheet,
  MODE_DEFAULT_RULEPACK,
  normalizeSheet,
  shortId,
  type CharacterCard,
  type CocSheet,
  type PartyMember,
  type RulePack,
  type RulePackId,
  type Session,
  type SessionState,
  type StoryScript,
  type World,
} from '@worldtree/shared';
import { content } from '../content/store.js';
import { messages, sessions } from '../repo.js';
import { legacies } from '../repo.legacy.js';
import { enterNode, initialState } from '../engine/resolver.js';

/* ------------------------------------------------------------------ */
/* 面板生成                                                            */
/* ------------------------------------------------------------------ */

/** 生成一名随机调查员（COC 结构，供没声明 sheetSchema 的老路径兜底） */
export function rollInvestigator(seed = Date.now(), name = '调查员'): CocSheet {
  const rng = makeRng(seed);
  return createSheetFromSchema(COC_SHEET_SCHEMA, { seedRng: rng, rulePackId: 'coc7', name });
}

/**
 * 按规则书声明的面板结构生成面板。
 *
 * 规则书没声明 schema（纯叙事类）时返回 undefined —— 这类规则本来就不该有面板。
 */
export function rollSheetForPack(
  pack: RulePack,
  seed = Date.now(),
  name = '调查员',
): CocSheet | undefined {
  if (!pack.sheetSchema) return undefined;
  const rng = makeRng(seed);
  return createSheetFromSchema(pack.sheetSchema, { seedRng: rng, rulePackId: pack.id, name });
}

function cloneSheetSafe(sheet: CocSheet | undefined): CocSheet | undefined {
  return sheet ? cloneSheet(sheet) : undefined;
}

/** 把角色卡的面板克隆一份（避免改动原件） */
function cloneSheet(sheet: CocSheet): CocSheet {
  const normalized = normalizeSheet(sheet) ?? sheet;
  return {
    ...normalized,
    attributes: { ...normalized.attributes },
    skills: normalized.skills.map((s) => ({ ...s })),
    resources: { ...(normalized.resources ?? {}) },
    conditions: [...normalized.conditions],
    items: [...normalized.items],
    luck: normalized.luck ?? normalized.attributes.LUCK,
    luckMax: normalized.luckMax ?? normalized.attributes.LUCK,
  };
}

/**
 * 决定「这张卡的面板按哪本规则书渲染」。
 *
 * 角色卡自己声明的 `sheet.rulePackId` 是它的原生规则书；
 * 世界也可以通过 `sheetRulePrecedence: 'world'` 强制用世界的规则书。
 *
 * 注意：这只影响**面板长什么样**。检定判定永远用 `session.state.rulePackId`，
 * 不会因为换了渲染方式就换一套成功率。
 */
export function resolveSheetPack(
  world: World | undefined,
  pack: RulePack,
  sheet: CocSheet | undefined,
): RulePack {
  if (!world || world.sheetRulePrecedence !== 'world') {
    // 角色卡优先（默认）：卡片声明过就用它
    const cardPackId = sheet?.rulePackId;
    if (cardPackId && cardPackId !== pack.id) {
      const cardPack = getRulePack(cardPackId);
      if (cardPack.sheetSchema) return cardPack;
    }
  }
  return pack;
}

/* ------------------------------------------------------------------ */
/* 创建会话                                                            */
/* ------------------------------------------------------------------ */

export interface CreateSessionInput {
  worldId: string;
  title?: string;
  branchLabel?: string;
  characterIds?: string[];
  playerName?: string;
  /** 玩家扮演的角色卡：undefined=用世界自带，null=不绑定，字符串=指定 */
  playerCharacterId?: string | null;
  rulePackId?: RulePackId;
  /** 生成调查员的种子 */
  sheetSeed?: number;
  /** 继承存档 id：把前作的结局数据带进这条新世界线 */
  legacyId?: string;
  /** 多人：初始队伍 */
  party?: PartyMember[];
  /** 归属账号（世界线与存档按人隔离） */
  ownerId?: string | null;
}

export function createSession(input: CreateSessionInput): { session: Session; messages: ReturnType<typeof messages.list> } {
  const world = content.world(input.worldId);
  if (!world) throw new Error('世界不存在');

  /* ---------- 主角卡：世界自带的，或者玩家从角色库里挑的 ---------- */
  const playerCardMode = world.playerCardMode ?? 'open';
  const builtInPlayer = content.charactersMany(world.characterIds).find((c) => c.isPlayer);

  /**
   * 三种语义要分开：
   * - `undefined`：没指定，用世界自带的主角卡（老行为）
   * - `null`：明确「不绑定角色卡」，按规则包随机生成调查员
   * - 字符串：玩家指定了这张卡
   */
  let playerChar: CharacterCard | undefined;
  if (input.playerCharacterId) {
    playerChar = content.character(input.playerCharacterId);
    if (!playerChar) throw new Error('指定的角色卡不存在');
  } else if (input.playerCharacterId === undefined) {
    playerChar = builtInPlayer;
  }

  // 剧本把主角写死时，只认这个世界自带的角色卡
  if (playerCardMode === 'fixed') {
    if (input.playerCharacterId === null) {
      throw new Error(`《${world.title}》的主角是固定的，不能选择「不绑定角色卡」`);
    }
    if (playerChar && !world.characterIds.includes(playerChar.id)) {
      throw new Error(`《${world.title}》的主角是固定的，不能换成别的角色卡`);
    }
    playerChar ??= builtInPlayer;
  }

  let characterIds = input.characterIds?.length ? [...input.characterIds] : [...world.characterIds];
  // 主角卡必须在队伍里，否则面板与提示词都取不到它
  if (playerChar && !characterIds.includes(playerChar.id)) characterIds = [...characterIds, playerChar.id];
  // 固定主角的世界不接受外来的同行角色
  if (playerCardMode === 'fixed') {
    characterIds = characterIds.filter((id) => world.characterIds.includes(id));
  }
  const resolvedPlayerCharId = playerChar?.id ?? null;
  const now = Date.now();
  let script: StoryScript | null = null;
  if (world.scriptFile) {
    script = content.scriptByFile(world.scriptFile)?.script ?? null;
  } else if (world.mode === 'script') {
    script = content.script(world.id)?.script ?? null;
  }

  // 优先级：显式指定 > 世界 > 剧本自己声明的 > 模式默认
  const rulePackId =
    input.rulePackId ??
    world.rulePackId ??
    script?.rulePackId ??
    MODE_DEFAULT_RULEPACK[world.mode] ??
    'narrative';
  const pack = getRulePack(rulePackId);

  const seed = input.sheetSeed ?? now;
  let state = initialState(script, rulePackId, seed);

  // 跑团面板：有就生成。
  // 老逻辑按 `pack.sanity || mode==='coc'` 判断，等于把「有没有理智值」当成
  // 「有没有面板」—— D&D 没有 SAN 但有 HP/AC，会被误判成无面板。
  // 现在只问一句：这本规则书声明了面板结构吗？
  const sheetPack = resolveSheetPack(world, pack, playerChar?.sheet);
  if (pack.sheetSchema || world.mode === 'coc') {
    if (playerChar?.sheet) {
      // 角色卡自带面板：按它的原生规则书迁移一次，缺的字段补上
      const schema = sheetPack.sheetSchema ?? pack.sheetSchema;
      const cloned = cloneSheet(playerChar.sheet);
      state = {
        ...state,
        sheet: schema ? migrateSheet(cloned, schema, { rulePackId: sheetPack.id }) : cloned,
      };
    } else {
      // 没有现成面板：按「渲染用的那本规则书」掷一份
      const generated = rollSheetForPack(sheetPack, seed, input.playerName || playerChar?.name);
      if (generated) state = { ...state, sheet: generated };
    }
  }

  /* ---------- 分院：按角色卡的标签/能力关键词判定 ---------- */
  if (world.sorting?.houses?.length) {
    const who = playerChar;

    const haystack = who
      ? [
          who.name,
          who.description,
          who.personality ?? '',
          who.creatorNotes ?? '',
          ...(who.tags ?? []),
          ...(who.abilities ?? []).map((a) => `${a.name}${a.description}`),
        ].join(' ')
      : '';

    const hit = world.sorting.houses.find((h) =>
      (h.keywords ?? []).some((k) => k && haystack.includes(k)),
    );
    const house = hit?.name ?? world.sorting.fallback ?? world.sorting.houses[0]?.name;
    if (house) {
      state = {
        ...state,
        flags: [...new Set([...state.flags, `分院·${house}`])],
        vars: { ...state.vars, house },
      };
    }
  }

  /* ---------- 继承：把前作结局带进来 ---------- */
  if (input.legacyId) {
    const raw = legacies.get(input.legacyId);
    if (!raw) throw new Error('继承存档不存在');

    const rule = world.inheritance;
    if (!rule?.enabled) {
      throw new Error(`《${world.title}》没有声明支持继承，不能导入前作存档`);
    }
    if (!acceptsFromWorld(rule, raw.worldId)) {
      throw new Error(`《${world.title}》只接受来自指定世界的存档，不接受《${raw.worldTitle}》`);
    }

    const filtered = filterLegacy(raw, rule);
    state = applyLegacyToState(state, filtered);

    // 继承的面板优先于随机生成
    if (filtered.sheet) {
      state = { ...state, sheet: filtered.sheet };
    }
  }

  /* ---------- 多人：初始化队伍 ---------- */
  if (input.party?.length) {
    const partySchema = (sheetPack.sheetSchema ?? pack.sheetSchema);
    state = {
      ...state,
      party: input.party.map((m, i) => {
        const cardSheet = m.characterId ? content.character(m.characterId)?.sheet : undefined;
        const base = m.sheet ?? (cardSheet ? cloneSheetSafe(cardSheet) : undefined);
        let sheet: CocSheet | null | undefined = base ?? undefined;
        if (sheet && partySchema) {
          sheet = migrateSheet(sheet, partySchema, { rulePackId: sheetPack.id });
        } else if (!sheet) {
          sheet = rollSheetForPack(sheetPack, seed + i * 101, m.name);
        }
        return { ...m, seat: m.seat ?? i, sheet: sheet ?? undefined };
      }),
    };
  }

  const count = sessions.countByWorld(world.id);
  const session: Session = {
    id: shortId('ses'),
    worldId: world.id,
    title: input.title || `${world.title} · 世界线 ${count + 1}`,
    branchLabel: input.branchLabel || `第 ${count + 1} 条世界线`,
    characterIds,
    playerName: input.playerName?.trim() || playerChar?.name || '旅人',
    playerCharacterId: resolvedPlayerCharId,
    state,
    parentId: null,
    branchPointMessageId: null,
    snapshot: null,
    messageCount: 0,
    archived: false,
    ownerId: input.ownerId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  sessions.insert(session);

  // 剧本模式：写入起始节点作为第一条消息
  if (script) {
    const node = script.nodes.find((n) => n.id === state.nodeId) ?? script.nodes[0];
    if (node) {
      const msgId = shortId('msg');
      messages.append({
        id: msgId,
        sessionId: session.id,
        role: 'assistant',
        content: node.content,
        meta: { choices: node.choices, nodeId: node.id, scene: node.title, scripted: true, rulePackId },
        createdAt: now,
      });
      // 开局状态也存一份，否则从第一条消息分叉时无从还原
      messages.saveState(msgId, session.id, state);
      sessions.touch(session.id, { messageCount: 1 });
    }
  } else {
    // 自由叙事：开场白 + 角色首句
    const parts: string[] = [];
    if (world.opening) parts.push(world.opening);
    const cast = content.charactersMany(characterIds);
    const first = cast.find((c) => c.firstMes)?.firstMes;
    if (first) parts.push(first);
    if (parts.length) {
      const msgId = shortId('msg');
      messages.append({
        id: msgId,
        sessionId: session.id,
        role: 'assistant',
        content: parts.join('\n\n'),
        meta: { scene: state.scene || '', rulePackId },
        createdAt: now,
      });
      messages.saveState(msgId, session.id, state);
      sessions.touch(session.id, { messageCount: 1 });
    }
  }

  return { session: sessions.get(session.id)!, messages: messages.list(session.id) };
}

/* ------------------------------------------------------------------ */
/* 分叉 / 回退                                                         */
/* ------------------------------------------------------------------ */

export interface ForkInput {
  sessionId: string;
  messageId: string;
  label?: string;
}

/**
 * 从某条消息分叉。
 *
 * 关键点：分支必须从**分叉那一刻**的状态继续，而不是父线「现在」的状态。
 * 优先用该消息存的完整状态快照；老数据没有快照时，退回到「seq ≤ 该消息」
 * 的最近一份快照；再没有才用父线当前状态兜底（并明确这是近似）。
 */
export function forkSession(input: ForkInput): { session: Session; messages: ReturnType<typeof messages.list> } {
  const parent = sessions.get(input.sessionId);
  if (!parent) throw new Error('世界线不存在');
  const world = content.world(parent.worldId);
  if (!world) throw new Error('世界不存在');

  const now = Date.now();
  const count = sessions.countByWorld(world.id);

  const snapshotState =
    messages.stateAt(input.messageId) ??
    messages.stateAtOrBefore(parent.id, input.messageId) ??
    JSON.parse(JSON.stringify(parent.state)) as SessionState;

  const snapshot: SessionState = JSON.parse(JSON.stringify(snapshotState));

  const child: Session = {
    ...parent,
    id: shortId('ses'),
    title: `${world.title} · 分叉 ${count + 1}`,
    branchLabel: input.label || `分叉 ${count + 1}`,
    parentId: parent.id,
    branchPointMessageId: input.messageId,
    snapshot,
    // 子线当前状态 = 分叉点状态；否则新线一打开就跳到父线的结局
    state: JSON.parse(JSON.stringify(snapshot)),
    messageCount: 0,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  sessions.insert(child);

  const copied = messages.copyUpTo(parent.id, child.id, input.messageId);
  sessions.touch(child.id, { messageCount: copied });
  return { session: sessions.get(child.id)!, messages: messages.list(child.id) };
}

/**
 * 回退到某条消息：删掉它之后的内容，并把状态还原到那一刻。
 * 不还原状态的话，界面上「退回上一段」，但面板里还是未来的血量与节点。
 */
export function rewindSession(sessionId: string, messageId: string): { session: Session; messages: ReturnType<typeof messages.list> } {
  const s = sessions.get(sessionId);
  if (!s) throw new Error('世界线不存在');

  const restored =
    messages.stateAt(messageId) ?? messages.stateAtOrBefore(sessionId, messageId);

  messages.truncateAfter(sessionId, messageId);
  if (restored) sessions.updateState(sessionId, restored);
  sessions.touch(sessionId, { messageCount: messages.count(sessionId) });
  return { session: sessions.get(sessionId)!, messages: messages.list(sessionId) };
}

/** 收集某条世界线的所有后代（含自身） */
export function collectDescendants(sessionId: string): string[] {
  const target = sessions.get(sessionId);
  if (!target) return [];
  const all = sessions.listByWorld(target.worldId);
  const byParent = new Map<string, string[]>();
  for (const s of all) {
    if (!s.parentId) continue;
    const list = byParent.get(s.parentId) ?? [];
    list.push(s.id);
    byParent.set(s.parentId, list);
  }

  const out: string[] = [];
  const stack = [sessionId];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    for (const child of byParent.get(id) ?? []) stack.push(child);
  }
  return out;
}

/** 统计删除一条世界线会连带删掉多少条分叉 */
export function descendantCount(sessionId: string): number {
  return Math.max(0, collectDescendants(sessionId).length - 1);
}

/**
 * 删除世界线。
 * 有分叉时连同所有后代一起删除——否则子线会因为父节点消失而变成孤儿，
 * 在世界详情页的树里再也看不到。
 */
export function deleteSession(sessionId: string): { deleted: number } {
  const ids = collectDescendants(sessionId);
  for (const id of ids) sessions.remove(id);
  return { deleted: ids.length };
}


/* ------------------------------------------------------------------ */
/* 世界线树                                                            */
/* ------------------------------------------------------------------ */

export interface BranchTreeNode {
  session: Session;
  children: BranchTreeNode[];
}

export function sessionTree(worldId: string): BranchTreeNode[] {
  const list = sessions.listByWorld(worldId);
  const map = new Map<string, BranchTreeNode>();
  for (const s of list) map.set(s.id, { session: s, children: [] });
  const roots: BranchTreeNode[] = [];
  for (const s of list) {
    const node = map.get(s.id)!;
    const parent = s.parentId ? map.get(s.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/* ------------------------------------------------------------------ */
/* 内置面板                                                            */
/* ------------------------------------------------------------------ */

export function draftCharacter(): CharacterCard {
  const now = Date.now();
  return {
    id: shortId('char'),
    spec: 'chara_card_v2',
    specVersion: '2.0',
    name: '无名者',
    description: '',
    personality: '',
    scenario: '',
    firstMes: '',
    mesExample: '',
    creatorNotes: '',
    systemPrompt: '',
    postHistoryInstructions: '',
    alternateGreetings: [],
    tags: [],
    creator: '',
    characterVersion: '1.0',
    extensions: {},
    characterBookId: null,
    avatarIcon: 'person',
    avatarColor: '#4f6f52',
    isPlayer: false,
    sheet: undefined,
    createdAt: now,
    updatedAt: now,
  };
}

export { emptyEventState, rollInvestigator as generateSheet };

/* ------------------------------------------------------------------ */
/* 存档导入                                                            */
/* ------------------------------------------------------------------ */

export interface SaveFileV1 {
  format: 'worldtree-save';
  version: number;
  exportedAt: number;
  world?: { id?: string; title?: string };
  session: Record<string, unknown>;
  messages?: Record<string, unknown>[];
}

/**
 * 把导出的存档文件导入到指定世界。
 * 规则：
 *  - 世界线 id 重新生成，避免冲突
 *  - 消息保留原有顺序与内容，id 重新生成
 *  - 若原世界线有分叉父节点，父指针会被清空（导入后作为根节点）
 */
export function importSession(
  save: SaveFileV1,
  worldId: string,
  ownerId?: string | null,
): { session: Session; messages: ReturnType<typeof messages.list> } {
  const raw = save.session;
  const now = Date.now();

  const rawState = (raw.state ?? {}) as Partial<SessionState>;
  const state: SessionState = {
    vars: (rawState.vars as Record<string, unknown>) ?? {},
    flags: (rawState.flags as string[]) ?? [],
    scene: (rawState.scene as string) ?? '',
    nodeId: rawState.nodeId as string | undefined,
    sheet: rawState.sheet,
    summary: rawState.summary as string | undefined,
    events: rawState.events ?? emptyEventState(),
    rulePackId: rawState.rulePackId ?? 'narrative',
    seed: rawState.seed ?? now,
  };

  const existing = sessions.listByWorld(worldId).length;
  const baseTitle = String(raw.title ?? '导入的世界线');

  const session: Session = {
    id: shortId('ses'),
    worldId,
    title: `${baseTitle}（导入）`,
    branchLabel: String(raw.branchLabel ?? `导入 ${existing + 1}`),
    characterIds: (raw.characterIds as string[]) ?? [],
    playerName: String(raw.playerName ?? '旅人'),
    playerCharacterId: (raw.playerCharacterId as string | null) ?? null,
    state,
    parentId: null,
    branchPointMessageId: null,
    snapshot: null,
    messageCount: 0,
    archived: false,
    ownerId: ownerId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  sessions.insert(session);

  const list = Array.isArray(save.messages) ? save.messages : [];
  let count = 0;
  for (const m of list) {
    const role = String(m.role ?? 'assistant');
    if (!['system', 'user', 'assistant', 'tool'].includes(role)) continue;
    const msgId = shortId('msg');
    const meta = (m.meta as Record<string, unknown>) ?? {};
    messages.append({
      id: msgId,
      sessionId: session.id,
      role: role as Session['state'] extends never ? never : 'user' | 'assistant' | 'system' | 'tool',
      content: String(m.content ?? ''),
      meta,
      createdAt: Number(m.createdAt ?? now),
    });
    count++;
  }
  // 导入的存档没有逐条状态快照：给最后一条补一份「当前状态」，
  // 这样至少从末尾分叉 / 回退是可用的；中间历史仍按最近快照兜底。
  const lastMsg = messages.list(session.id).at(-1);
  if (lastMsg) messages.saveState(lastMsg.id, session.id, session.state);
  sessions.touch(session.id, { messageCount: count });

  return { session: sessions.get(session.id)!, messages: messages.list(session.id) };
}




