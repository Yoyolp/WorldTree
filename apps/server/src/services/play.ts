import {
  activeAbilities,
  buildSnapshot,
  effectiveSheet,
  emptyEventState,
  getRulePack,
  makeRng,
  mergeAbilities,
  META_END,
  META_START,
  performCheck,
  renderLegacy,
  resetUsesFor,
  sanCheck,
  shortId,
  splitMeta,
  stripMetaStreaming,
  useAbility as applyAbilityUse,
  withResource,
  type CharacterAbility,
  type ChatRequest,
  type CheckDifficulty,
  type CheckResult,
  type DiceRoll,
  type EventFireRecord,
  type GameEvent,
  type Message,
  type MessageMeta,
  type PartyMember,
  type RulePack,
  type ScriptChoice,
  type Session,
  type SessionState,
  type StoryScript,
  type StreamEvent,
  type World,
} from '@worldtree/shared';
import { content } from '../content/store.js';
import { messages as messageRepo, sessions as sessionRepo } from '../repo.js';
import { saveLegacy } from '../repo.legacy.js';
import { chatComplete, type ChatTurn } from '../llm/client.js';
import { buildChatTurns, estimatePromptTokens, PLOT_HARD_RETURN, PLOT_MOTIFS } from '../llm/prompt.js';
import { scanWorldBook, type LoreHit } from '../lib/lore.js';
import { getLlmConfig, getSafety, renderSafety } from '../settings.js';
import { EventQueue } from '../lib/queue.js';
import {
  applyChoice,
  applyScriptEffect,
  enterNode,
  findNode,
  initialState,
  parseIntent,
  resolveEvents,
  runCheck,
  endTurn,
} from '../engine/resolver.js';

export interface PlayContext {
  world: World;
  session: Session;
  script: StoryScript | null;
}

export function loadContext(sessionId: string): PlayContext {
  const session = sessionRepo.get(sessionId);
  if (!session) throw new Error('世界线不存在');

  const world = content.world(session.worldId);
  if (!world) throw new Error('世界不存在（可能对应的 content 文件已被删除）');

  let script: StoryScript | null = null;
  if (world.scriptFile) {
    const rec = content.scriptByFile(world.scriptFile);
    script = rec?.script ?? null;
    if (!script) {
      // 兜底：按 id 找
      script = content.script(session.worldId)?.script ?? null;
    }
  } else if (world.mode === 'script') {
    script = content.script(world.id)?.script ?? null;
  }

  return { world, session, script };
}

/* ------------------------------------------------------------------ */
/* 元数据合并                                                          */
/* ------------------------------------------------------------------ */

function mergeModelMeta(
  state: SessionState,
  raw: ReturnType<typeof splitMeta>['meta'],
): { state: SessionState; meta: MessageMeta; checkRequest?: { skill: string; difficulty: CheckDifficulty } } {
  const meta: MessageMeta = {};
  if (!raw) return { state, meta };

  let next = state;

  if (raw.state) {
    next = applyScriptEffect(next, {
      vars: raw.state.set,
      addFlags: raw.state.addFlags,
      removeFlags: raw.state.removeFlags,
      sanDelta: raw.state.sanDelta,
      hpDelta: raw.state.hpDelta,
      mpDelta: raw.state.mpDelta,
      luckDelta: raw.state.luckDelta,
      addItems: raw.state.addItems,
      addConditions: raw.state.addConditions,
    });
    meta.statePatch = { ...(raw.state as Record<string, unknown>) };
  }

  if (raw.scene) {
    next = { ...next, scene: raw.scene };
    meta.scene = raw.scene;
  }
  if (raw.summary) next = { ...next, summary: raw.summary };

  if (raw.choices?.length) {
    meta.choices = raw.choices.slice(0, 6).map((c, i) => ({
      id: `ai_${i}`,
      text: String(c.text ?? '').slice(0, 80),
      hint: c.hint,
      prompt: c.prompt,
      // 选项可以直接指定要去的剧本节点；没写就跟着整段的 goto
      next: c.next || raw.goto || undefined,
      check: c.check?.skill
        ? { skill: c.check.skill, difficulty: (c.check.difficulty as CheckDifficulty) ?? 'regular' }
        : undefined,
    }));
  }

  const checkRequest =
    raw.check?.skill
      ? { skill: raw.check.skill, difficulty: (raw.check.difficulty as CheckDifficulty) ?? 'regular' }
      : undefined;

  // 注意：这里不再自动掷骰。模型只是「建议」检定，由玩家在前端点确认。
  return { state: next, meta, checkRequest };
}

/* ------------------------------------------------------------------ */
/* 元数据格式修复（兜底）                                               */
/* ------------------------------------------------------------------ */

/**
 * 小模型经常忘写标记、或者把 JSON 写残。本地正则救不回来时，
 * 再发一次极小的请求，让它「只把这段转成 JSON」。
 */
async function repairMetaWithModel(rawTail: string, config: ReturnType<typeof getLlmConfig>) {
  if (!config.baseUrl || !config.model) return null;
  const tail = rawTail.slice(-3000);
  if (!tail.includes('{')) return null;

  try {
    const res = await chatComplete(
      { ...config, maxTokens: 600, temperature: 0, stream: false, timeoutMs: 45000 },
      [
        {
          role: 'system',
          content:
            '你是格式修复器。把用户给出的文本转换成严格的 JSON，只输出 JSON 本体，不要任何解释、不要代码围栏。\n' +
            '允许的字段：choices（数组，每项 {text, hint, check:{skill,difficulty}, next}）、check、state{set,addFlags,removeFlags,sanDelta,hpDelta,mpDelta}、scene、summary、goto。\n' +
            '原文里没有的字段直接省略。无法确定的字段不要编造。',
        },
        { role: 'user', content: tail },
      ],
    );

    const text = (res.text ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first < 0 || last <= first) return null;
    return JSON.parse(text.slice(first, last + 1));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 主推演                                                              */
/* ------------------------------------------------------------------ */

export async function* runTurn(req: ChatRequest, abortSignal?: AbortSignal): AsyncGenerator<StreamEvent> {
  const { world, session, script } = loadContext(req.sessionId);
  const config = getLlmConfig();
  const pack = getRulePack(session.state.rulePackId ?? world.rulePackId);

  const chars = content.charactersMany(session.characterIds.length ? session.characterIds : world.characterIds);

  /* ---------- 多人：确定本回合的行动者 ---------- */
  const party: PartyMember[] = session.state.party ?? [];
  const actingMember: PartyMember | null =
    (req.memberId ? party.find((m) => m.id === req.memberId) : undefined) ??
    (party.length === 1 ? party[0] : null);

  const effectiveCharacterId =
    actingMember?.characterId ?? session.playerCharacterId ?? chars.find((c) => c.isPlayer)?.id ?? null;

  const playerChar = effectiveCharacterId ? content.character(effectiveCharacterId) : chars.find((c) => c.isPlayer);

  /* ---------- 能力：角色卡 + 继承来的 ---------- */
  const abilities: CharacterAbility[] = activeAbilities(session.state, playerChar?.abilities);

  const book = world.worldBookId ? content.worldbook(world.worldBookId) : undefined;
  const history = messageRepo.list(session.id);
  const assistantId = shortId('msg');

  // 记录玩家输入
  messageRepo.append({
    id: shortId('msg'),
    sessionId: session.id,
    role: 'user',
    content: req.content || '（继续）',
    meta: { memberId: actingMember?.id, ...(req.privateTo ? { pov: req.privateTo } : {}) },
    createdAt: Date.now(),
  });

  yield { type: 'start', sessionId: session.id, messageId: assistantId };

  // 本回合种子：会话种子 + 已发生的回合数，保证「同一存档点重演结果不变」。
  // 早先这里掺了 Date.now()，导致同一条世界线两次同样的输入掷出不同点数，
  // 分叉重演也就复现不了 —— 已有事件记录里的 roll 会跟状态对不上。
  const seed = (session.state.seed ?? session.createdAt) + (session.state.events?.turns ?? 0) * 7919;
  const rng = makeRng(seed);

  let state: SessionState = {
    ...session.state,
    events: session.state.events ?? emptyEventState(),
  };

  // 多人：把行动者的面板作为本回合的「当前面板」
  if (actingMember?.sheet) {
    state = { ...state, sheet: actingMember.sheet };
  }

  /* ---------- 1. 剧本节点推进 ---------- */
  let nodeDirective: string | undefined;
  let scriptedChoices: ScriptChoice[] | undefined;
  let scriptedNodeId = state.nodeId;
  let isEnding = false;
  let endingTitle: string | undefined;
  /**
   * 本回合是否**刚刚**走进结局节点。
   *
   * `isEnding` 是「当前节点是结局节点」的静态属性，停在结局里每回合都为 true；
   * 而「结局刚刚发生」只应该成立一次 —— 用它来决定要不要生成存档、
   * 要不要弹提示、要不要让玩家做「收尾 / 尾声」的选择。
   */
  let justReachedEnding = false;
  /** 结局节点 id（跨回合记住，供后续判断是否停在结局里） */
  const previousNodeId = state.nodeId;
  /** 玩家本回合选中的剧本选项（用于后续检定） */
  let pickedChoice: ScriptChoice | undefined;

  if (script) {
    const currentNode = state.nodeId ? findNode(script, state.nodeId) : undefined;
    const activeNode = currentNode ?? script.nodes[0];

    if (!currentNode && activeNode) {
      // 第一次进入：需要结算 on-enter
      const entered = enterNode(script, activeNode.id, state, { ownAbilities: playerChar?.abilities });
      state = entered.state;
      scriptedNodeId = activeNode.id;
      scriptedChoices = entered.choices;
      nodeDirective = entered.directive;
      isEnding = entered.ending;
      endingTitle = entered.endingTitle;
      if (entered.ending && previousNodeId !== activeNode.id) justReachedEnding = true;
    } else if (currentNode) {
      // 已经在这个节点里：只取选项与描述，**不重跑 on-enter**，
      // 否则玩家在节点里多待一回合就再扣一次 san/hp。
      const entered = enterNode(script, currentNode.id, state, { applyOnEnter: false, ownAbilities: playerChar?.abilities });
      state = entered.state;
      scriptedChoices = entered.choices;
      nodeDirective = entered.directive;
      isEnding = entered.ending;
      endingTitle = entered.endingTitle;
    }

    // 玩家点的选项是否属于当前剧本节点（模型的选项 id 不会命中这里）
    if (req.intent === 'choice') {
      pickedChoice =
        currentNode?.choices.find((c) => c.id === req.choiceId) ??
        currentNode?.choices.find((c) => c.text === req.content);
    }

    if (pickedChoice) {
      // 剧本选项：按节点定义推进（只有这一条会改 state.nodeId）
      const advanced = applyChoice(script, state, pickedChoice, { ownAbilities: playerChar?.abilities });
      state = advanced.state;
      scriptedNodeId = advanced.nodeId ?? scriptedNodeId;
      scriptedChoices = advanced.choices;
      nodeDirective = advanced.directive;
      isEnding = advanced.ending;
      endingTitle = advanced.endingTitle;
      if (advanced.ending && advanced.nodeId !== previousNodeId) justReachedEnding = true;
    } else if (req.goto) {
      // 模型选项：它指定了要去的节点。指回当前节点等于原地踏步，不重复结算。
      const gotoNode = findNode(script, req.goto);
      if (gotoNode && gotoNode.id !== scriptedNodeId) {
        const entered = enterNode(script, gotoNode.id, state, { ownAbilities: playerChar?.abilities });
        state = entered.state;
        scriptedNodeId = gotoNode.id;
        scriptedChoices = entered.choices;
        nodeDirective = entered.directive;
        isEnding = entered.ending;
        endingTitle = entered.endingTitle;
        if (entered.ending && gotoNode.id !== previousNodeId) justReachedEnding = true;
      }
    }
  }
  /* ---------- 2. 意图推断 ---------- */
  // 世界规则可以关掉自动检定：pack.autoCheck 是「规则包支持」，world.rules.autoCheck
  // 是「这个世界的作者要不要」。两者都为真才自动掷。
  const worldRules = world.rules ?? {};
  const autoCheckOn = worldRules.autoCheck !== false && pack.autoCheck;
  // 世界的 failForward 覆盖规则包默认：作者可以在某个世界里开「失败也推进」
  const failForward = worldRules.failForward ?? pack.failForward;
  const intent = parseIntent(req.content, pack);

  /* ---------- 2.5 能力使用 ---------- */
  let usedAbility: CharacterAbility | null = null;
  if (req.useAbility) {
    const ability = abilities.find((a) => a.id === req.useAbility || a.name === req.useAbility);
    if (!ability) {
      yield { type: 'notice', text: `没有找到能力「${req.useAbility}」` };
    } else {
      const result = applyAbilityUse(state, ability);
      if (!result.ok) {
        yield { type: 'notice', text: `无法使用「${ability.name}」：${result.reason ?? '条件不满足'}` };
      } else {
        state = result.state;
        usedAbility = ability;
        if (result.narrative) yield { type: 'notice', text: result.narrative };
        yield {
          type: 'ability',
          ability: { id: ability.id, name: ability.name, kind: ability.kind },
          usesLeft: ability.uses ? Math.max(0, ability.uses.max - (state.abilityUses?.[ability.id] ?? 0)) : null,
          log: result.log ?? ability.name,
        };
      }
    }
  }

  /* ---------- 3. 事件判定（进入节点 / 回合开始 / 玩家行动） ---------- */
  /** 剧本级全局事件；节点内嵌事件由 eventsOfNode 现取 */
  const allEvents: GameEvent[] = [...(script?.events ?? [])];

  /** 收集某节点上的内嵌事件 */
  const eventsOfNode = (nodeId?: string): GameEvent[] => {
    if (!script || !nodeId) return [];
    const node = findNode(script, nodeId);
    if (!node) return [];
    return (node.events ?? []).map((ev) => ({ ...ev, scope: 'node', nodeId: node.id }));
  };

  const firedEvents: EventFireRecord[] = [];

  /** 触发某节点的 enter_node 事件 */
  const fireNodeEnter = (nodeId: string | undefined) => {
    if (!nodeId) return;
    // 只留 enter_node：resolveEvents 内部按 trigger 严格过滤，
    // 这里再放 turn_start 进来只会是噪音（永远匹配不上）。
    const nodeEvs = eventsOfNode(nodeId).filter((e) => e.trigger === 'enter_node');
    if (!nodeEvs.length) return;
    const entered = resolveEvents({
      events: nodeEvs,
      trigger: 'enter_node',
      state,
      nodeId,
      playerInput: req.content,
      rng,
      turn: state.events.turns,
    });
    state = entered.state;
    firedEvents.push(...entered.records);
  };

  // 新会话第一回合：先补触发起始节点（进入时发生的事件）
  if (state.events.turns === 0) {
    fireNodeEnter(session.state.nodeId ?? scriptedNodeId);
  }

  // 选择后进入新节点：触发新节点的进入事件
  if (req.intent === 'choice' && pickedChoice && scriptedNodeId && scriptedNodeId !== session.state.nodeId) {
    fireNodeEnter(scriptedNodeId);
  }

  // 全局事件 + 当前节点事件（turn_start / player_action）
  const currentEvs = [...eventsOfNode(scriptedNodeId), ...allEvents];
  const turnStart = resolveEvents({
    events: currentEvs,
    trigger: 'turn_start',
    state,
    nodeId: scriptedNodeId,
    playerInput: req.content,
    rng,
    turn: state.events.turns,
  });
  state = turnStart.state;
  firedEvents.push(...turnStart.records);

  const actionEvents = resolveEvents({
    events: currentEvs,
    trigger: 'player_action',
    state,
    nodeId: scriptedNodeId,
    playerInput: req.content,
    rng,
    turn: state.events.turns,
  });
  state = actionEvents.state;
  firedEvents.push(...actionEvents.records);

  // 事件跳转
  if (script && state.nodeId && state.nodeId !== scriptedNodeId) {
    const jumped = enterNode(script, state.nodeId, state, { ownAbilities: playerChar?.abilities });
    state = jumped.state;
    scriptedNodeId = jumped.nodeId;
    scriptedChoices = jumped.choices;
    nodeDirective = jumped.directive;
    isEnding = jumped.ending;
    endingTitle = jumped.endingTitle;
  }

  /* ---------- 3.2 剧情偏离计数 ---------- */
  // 只有「玩家这一手把节点推进了」才算回到主线。模型本回合写的 goto 不会
  // 立刻改节点，它要等玩家点那个选项才生效，所以这里只看节点有没有变。
  const advancedThisTurn = !script || scriptedNodeId !== session.state.nodeId;
  const plotDrift = advancedThisTurn ? 0 : (session.state.plotDrift ?? 0) + 1;
  const plotNodeTitle = script && scriptedNodeId ? findNode(script, scriptedNodeId)?.title : undefined;
  const plotTargetId = scriptedChoices?.find((c) => c.next)?.next;
  // 偏离时把这一回合当「额外回合」：抽两个母题给模型当素材，而不是硬拉回主线
  const plotMotifs =
    plotDrift > 0 ? shuffleTake(PLOT_MOTIFS, 3, rng) : undefined;

  /* ---------- 3.5 理智检定 ---------- */
  const sanResults: NonNullable<MessageMeta['sanCheck']>[] = [];
  const rollForSan = (skill: string, target: number, difficulty: CheckDifficulty = 'regular') =>
    performCheck({ skill, target, difficulty, rng, pack });

  // 事件里声明的理智检定
  const findEventById = (id: string): GameEvent | undefined =>
    allEvents.find((e) => e.id === id) ??
    script?.nodes.flatMap((n) => n.events).find((e) => e.id === id);

  for (const record of firedEvents) {
    const spec = findEventById(record.eventId)?.sanCheck;
    if (!spec || !state.sheet || !pack.sanity) continue;
    const out = sanCheck(state.sheet, { successLoss: spec.successLoss, failLoss: spec.failLoss }, pack, rng, rollForSan);
    // SAN 的存储键由规则书决定（默认 'san'），不能硬写 sheet.san
    const sanKey = pack.sanityResource || 'san';
    state = {
      ...state,
      sheet: withResource(
        {
          ...state.sheet,
          conditions: out.bout
            ? [...new Set([...state.sheet.conditions, `临时疯狂：${out.bout}`])]
            : [...state.sheet.conditions],
        },
        sanKey,
        out.sanAfter,
      ),
    };
    sanResults.push({
      expression: out.expression,
      loss: out.loss,
      sanAfter: out.sanAfter,
      temporaryInsane: out.temporaryInsane,
      bout: out.bout,
      permanentInsane: out.permanentInsane,
      detail: out.detail,
    });
  }



  /* ---------- 4. 世界书 ---------- */
  const scanTexts = [...history.slice(-8).map((m) => m.content), req.content];
  const loreScan = scanWorldBook({
    book,
    texts: scanTexts,
    rng,
    // 冷却与粘滞跨回合存在 state.lore 里（老存档没有就是空表）
    cooldowns: state.lore?.cooldowns,
    sticky: state.lore?.sticky,
  });
  const loreHits: LoreHit[] = loreScan.hits;
  state = { ...state, lore: { cooldowns: loreScan.cooldowns, sticky: loreScan.sticky } };

  /* ---------- 5. 检定 ---------- */
  const checks: CheckResult[] = [];
  const rolls: DiceRoll[] = [];
  let rollText: string | undefined;
  /** 本回合有检定失败且不允许失败推进：模型必须写出代价，不能写成成功 */
  let checkBlocked = false;

  if (req.intent === 'roll' && req.roll) {
    if (req.roll.skill) {
      const bundle = runCheck(
        state,
        { skill: req.roll.skill, difficulty: req.roll.difficulty, bonus: req.roll.bonus },
        pack,
        rng,
        { spendLuck: req.roll.spendLuck, push: req.roll.push, abilities, failForward },
      );
      state = bundle.state;
      if (bundle.check) checks.push(bundle.check);
      rollText = bundle.check ? `${bundle.check.skill}：${bundle.check.detail} → ${bundle.check.label}` : undefined;
    } else {
      const roll = (await import('@worldtree/shared')).rollFormula(req.roll.formula || '1d100', '投骰', rng);
      rolls.push(roll);
      rollText = `${roll.formula} → ${roll.total}`;
    }
    if (checks.length) yield { type: 'checks', checks };
    if (rolls.length) yield { type: 'rolls', rolls };
  } else if (req.intent === 'choice') {
    // 选项自带检定（用刚才选中的那个选项）
    const checkReq =
      pickedChoice?.check ??
      (intent.skill ? { skill: intent.skill, difficulty: intent.difficulty } : undefined);
    if (checkReq) {
      const bundle = runCheck(state, checkReq, pack, rng, { abilities, failForward });
      state = bundle.state;
      if (bundle.check) {
        checks.push(bundle.check);
        rollText = `${bundle.check.skill}：${bundle.check.detail} → ${bundle.check.label}`;
        // 失败且不允许「失败推进」时，明确告诉模型这一手要付代价、不能当成功写
        if (bundle.blocked) checkBlocked = true;
      }
    }
    if (checks.length) yield { type: 'checks', checks };
  } else if (intent.skill && autoCheckOn && intent.risky) {
    // 自动检定：有风险的行为（世界关掉 autoCheck 时不掷）
    const bundle = runCheck(state, { skill: intent.skill, difficulty: intent.difficulty }, pack, rng, { abilities, failForward });
    state = bundle.state;
    if (bundle.check) {
      checks.push(bundle.check);
      rollText = `${bundle.check.skill}：${bundle.check.detail} → ${bundle.check.label}`;
      if (bundle.blocked) checkBlocked = true;
    }
    if (checks.length) yield { type: 'checks', checks };
  }

  /* ---------- 6. 事件（回合结束前、叙事前） ---------- */
  // 两种时机分别判定：resolveEvents 会按 trigger 过滤，混在一起调用会让
  // turn_end 的事件永远匹配不上（旧 bug）。
  for (const trig of ['before_narration', 'turn_end'] as const) {
    const evs = allEvents.filter((e) => e.trigger === trig);
    if (!evs.length) continue;
    const pass = resolveEvents({
      events: evs,
      trigger: trig,
      state,
      nodeId: scriptedNodeId,
      playerInput: req.content,
      rng,
      turn: state.events.turns,
    });
    state = pass.state;
    firedEvents.push(...pass.records);
  }

  if (firedEvents.length) {
    yield { type: 'events', events: firedEvents };
    for (const ev of firedEvents) {
      if (ev.notice) yield { type: 'notice', text: ev.notice };
    }
  }

  /* ---------- 7. 组装提示词 ---------- */
  /* ---------- 记录用过的技能（幕间可成长） ---------- */
  if (checks.length) {
    const used = new Set(state.skillsUsed ?? []);
    for (const c of checks) if (c.success) used.add(c.skill);
    state = { ...state, skillsUsed: [...used] };
  }
  const turns: ChatTurn[] = buildChatTurns({
    world,
    session: { ...session, state },
    characters: chars.filter((c) => c.id !== playerChar?.id),
    playerCharacter: playerChar,
    history,
    loreHits,
    playerInput: req.content,
    intent: req.intent,
    pack,
    nodeDirective,
    checkResults: checks,
    eventRecords: firedEvents,
    rollText,
    config,
    abilities,
    usedAbility,
    actingMember,
    party,
    legacyText: renderLegacy(state.legacy, world.inheritance),
    kpMode: req.kpMode,
    directing: req.intent === 'direct',
    currentNodeId: scriptedNodeId,
    scriptNodes: script?.nodes.map((n) => ({ id: n.id, title: n.title })),
    currentNodeTitle: plotNodeTitle,
    plotDrift,
    plotTargetId,
    plotMotifs,
    checkBlocked,
    safetyText: renderSafety(getSafety()),
    // 有风险动作但没有明确技能时，把判断权交给模型：
    // 由它在元数据里给出 check，而不是引擎硬塞一个技能去掷。
    riskyAction: intent.risky && !checks.length && !intent.skill,
  });

  /* ---------- 8. 调用模型 ---------- */
  const queue = new EventQueue<StreamEvent>();
  let rawBuffer = '';
  let visibleLength = 0;
  let failure: string | null = null;
  let modelTruncated = false;
  let modelUsage: { prompt: number; completion: number } | undefined;
  let reasoningLen = 0;

  const worker = (async () => {
    try {
      const result = await chatComplete(config, turns, {
        signal: abortSignal,
        onToken: (piece) => {
          rawBuffer += piece;
          const visible = stripMetaStreaming(rawBuffer);
          if (visible.length > visibleLength) {
            queue.push({ type: 'token', text: visible.slice(visibleLength) });
            visibleLength = visible.length;
          }
        },
        onReasoning: (piece) => {
          reasoningLen += piece.length;
          queue.push({ type: 'reasoning', text: piece });
        },
      });
      if (!rawBuffer && result.text) {
        rawBuffer = result.text;
        const visible = stripMetaStreaming(result.text);
        queue.push({ type: 'token', text: visible });
        visibleLength = visible.length;
      }
      if (result.truncated) modelTruncated = true;
      if (result.usage) modelUsage = result.usage;
    } catch (err) {
      failure = (err as Error).message;
    } finally {
      queue.close();
    }
  })();

  for await (const ev of queue) yield ev;
  await worker;

  /* ---------- 9. 离线兜底 ---------- */
  if (!rawBuffer.trim()) {
    const fallback = fallbackNarration(world, state, req, failure, scriptedChoices, pack);
    yield { type: 'notice', text: failure ? `模型调用失败，已切换为离线旁白：${failure}` : '已使用离线旁白模式' };
    yield { type: 'token', text: stripMetaStreaming(fallback).trim() };
    rawBuffer = fallback;
  }

  /* ---------- 10. 解析与落库 ---------- */
  let parsed = splitMeta(rawBuffer);
  const text = parsed.text || stripMetaStreaming(rawBuffer).trim();

  // 本地修复不了（标记缺失 + JSON 残缺），再花一次小请求把尾巴转成 JSON
  if (!parsed.meta) {
    const repaired = await repairMetaWithModel(rawBuffer, config);
    if (repaired) parsed = { ...parsed, meta: repaired as never, recovered: true };
  }

  // 输出被截断（没写结束标记 / finish_reason=length），且本地也补不出元数据：
  // 这是「上下文窗口配小了」的典型症状，必须让用户看见，否则只会反复丢选项
  const outputTruncated = modelTruncated || parsed.truncated;
  if (outputTruncated) {
    // 思考链很长却没写成 JSON：九成是推理模型把输出预算吃光了
    const thinkingAte = reasoningLen > 400;
    let hint: string;
    if (!parsed.meta) {
      hint = thinkingAte
        ? '模型把输出预算花在思考上了，选项没写完。到设置里打开「关闭模型思考链」，或把最大输出 tokens 调大。'
        : '模型输出被截断，选项没能救回来。多半是上下文窗口填大了：到设置里点「探测真实上下文」，按探测结果填。';
    } else {
      hint = thinkingAte
        ? '模型这次没写完就被截断了（正文可能断在半句）。它把预算花在思考上了，建议关掉思考链。'
        : '模型这次没写完就被截断了（正文可能断在半句）。到设置里点「探测真实上下文」，按探测结果填。';
    }
    yield { type: 'notice', text: hint };
  }

  const merged = mergeModelMeta(state, parsed.meta);
  state = merged.state;

  // 模型主动要求的理智检定
  const modelSan = parsed.meta?.sanCheck;
  if (modelSan && state.sheet && pack.sanity) {
    const out = sanCheck(
      state.sheet,
      { successLoss: modelSan.successLoss, failLoss: modelSan.failLoss ?? '1d6' },
      pack,
      rng,
      (skill, target) => performCheck({ skill, target, difficulty: 'regular', rng, pack }),
    );
    const sanKey = pack.sanityResource || 'san';
    state = {
      ...state,
      sheet: withResource(
        {
          ...state.sheet,
          conditions: out.bout
            ? [...new Set([...state.sheet.conditions, `临时疯狂：${out.bout}`])]
            : [...state.sheet.conditions],
        },
        sanKey,
        out.sanAfter,
      ),
    };
    sanResults.push({
      expression: out.expression,
      loss: out.loss,
      sanAfter: out.sanAfter,
      temporaryInsane: out.temporaryInsane,
      bout: out.bout,
      permanentInsane: out.permanentInsane,
      detail: out.detail,
    });
  }

  // 模型建议的检定：不自动掷，交给玩家确认
  const pendingCheck = checks.length ? undefined : merged.checkRequest;

  if (script && scriptedNodeId) state = { ...state, nodeId: scriptedNodeId };
  state = { ...state, plotDrift };

  const meta: MessageMeta = { ...merged.meta };
  if (rolls.length) meta.rolls = rolls;
  if (checks.length) meta.checks = checks;
  // 始终写入事件数组，便于前端区分「没有事件」和「字段缺失」
  meta.events = firedEvents;

  if (sanResults.length) meta.sanCheck = sanResults[sanResults.length - 1];

  // 模型建议的检定：不自动掷，等玩家确认
  if (pendingCheck) {
    meta.suggestedCheck = { skill: pendingCheck.skill, difficulty: pendingCheck.difficulty };
  }

  // 选项来源：模型给的优先（更有临场感）；模型没给推进路径时，补上剧本分支，
  // 否则剧本世界会永远停在同一个节点
  if (meta.choices?.length) {
    const scripted = scriptedChoices ?? [];
    const scriptByText = new Map(scripted.map((c) => [c.text.trim(), c]));

    // 模型常把剧本选项原样抄一遍。文本相同就继承剧本的 next，
    // 否则去重会把「唯一能推进剧情」的那份删掉，导致永远停在同一节点。
    const modelChoices = meta.choices.map((c) => {
      const twin = scriptByText.get(c.text.trim());
      const next = c.next ?? twin?.next;
      // 模型有时把 goto 指回当前节点，那等于原地踏步，直接丢掉
      return { ...c, source: 'model' as const, next: next && next !== scriptedNodeId ? next : undefined };
    });

    const canAdvance = modelChoices.some((c) => c.next);
    const seen = new Set(modelChoices.map((c) => c.text.trim()));
    const fallback = canAdvance
      ? []
      : scripted.filter((c) => !seen.has(c.text.trim())).map((c) => ({ ...c, source: 'script' as const }));

    // 偏离很久（兜底收束档位）才把剧本分支排到队首。平时不抢玩家的选择。
    const ordered =
      plotDrift >= PLOT_HARD_RETURN ? [...fallback, ...modelChoices] : [...modelChoices, ...fallback];
    // 世界可以配置给玩家几个选项（默认 3，上限 8）
    const wantCount = Math.max(1, Math.min(8, Number(worldRules.choiceCount) || 3));
    let cut = ordered.slice(0, Math.max(wantCount, 1));

    // 关键兜底：如果截断把「唯一能推进剧本的选项」切掉了，用最后一条剧本分支补回来。
    // 模型给的 >>> 行内选项是纯文本、没有 next；当它把 3 个位置占满时，
    // 剧本世界就会永远被困在当前节点。这里保证至少留一条能往下走的。
    if (scripted.length && !cut.some((c) => c.next)) {
      const advanceChoice = ordered.find((c) => c.next);
      if (advanceChoice && !cut.includes(advanceChoice)) {
        // 替换最后一条，而不是追加：保持选项数量符合世界配置
        cut = [...cut.slice(0, Math.max(1, cut.length - 1)), advanceChoice];
      }
    }
    meta.choices = cut;
  } else if (scriptedChoices?.length) {
    const wantCount = Math.max(1, Math.min(8, Number(worldRules.choiceCount) || 3));
    meta.choices = scriptedChoices.slice(0, Math.max(wantCount, 1)).map((c) => ({ ...c, source: 'script' as const }));
  }

  if (scriptedNodeId) meta.nodeId = scriptedNodeId;
  if (loreHits.length) {
    meta.loreHits = loreHits.map((h) => h.entry.comment || h.entry.keys[0] || '条目');
    // 结构化版本带上配图：阅读器要在气泡里把命中的图显示出来
    meta.loreHitDetails = loreHits.map((h) => ({
      name: h.entry.comment || h.entry.keys[0] || '条目',
      ...(h.entry.image ? { image: h.entry.image } : {}),
      ...(h.entry.imageCaption ? { caption: h.entry.imageCaption } : {}),
    }));
  }
  if (script) meta.scripted = true;
  if (plotDrift > 0) meta.plotDrift = plotDrift;
  if (failure) meta.error = failure;
  meta.model = config.model;
  meta.tokens = estimatePromptTokens(turns);
  if (req.privateTo) meta.pov = req.privateTo;
  meta.seed = seed;
  meta.rulePackId = pack.id;
  // 原始输出留一份，便于在阅读器里排查格式问题
  meta.rawOutput = rawBuffer.slice(0, 6000);
  meta.recovered = parsed.recovered;
  if (outputTruncated) meta.outputTruncated = true;
  if (modelUsage) meta.usage = modelUsage;
  if (reasoningLen > 0) meta.reasoningLen = reasoningLen;

  if (usedAbility) {
    meta.ability = { id: usedAbility.id, name: usedAbility.name, kind: usedAbility.kind };
  }
  if (actingMember) meta.memberId = actingMember.id;

  if (isEnding && endingTitle) state = { ...state, scene: endingTitle };

  /*
   * 结局处理。
   *
   * 两种情况要分开：
   *  1. 刚走进结局节点（justReachedEnding）—— 生成/更新继承存档，弹一次提示，
   *     并让前端显示「写结尾 / 尾声」的选择卡。
   *  2. 已经停在结局节点里继续聊（尾声模式）—— 只更新存档内容（反映状态变化），
   *     不再重复弹提示、不再重复标记结局。
   *
   * 之前没有这个区分，`isEnding` 每回合都为 true，
   * 于是结局存档被反复覆盖、提示每轮弹一次。
   */
  if (isEnding) {
    const endingState = state.ending ?? { announced: false };

    // 存档照常生成/更新：结局那一刻生成一次，之后尾声里状态有变也刷新
    try {
      const snapshot = buildSnapshot({
        session: { ...session, state },
        world,
        characterName: playerChar?.name ?? session.playerName,
        characterId: effectiveCharacterId,
        abilities,
        ending: { nodeId: scriptedNodeId, title: endingTitle, reached: true },
        // 模型没写 summary 时，用最后一段叙述兜底，保证续作至少有前情可读
        summary: state.summary || text.slice(0, 1200),
      });
      saveLegacy(snapshot);
    } catch (err) {
      meta.error = `继承存档生成失败：${(err as Error).message}`;
    }

    // 结局信息始终写进 meta，前端据此显示结局标记（这是「事实」，不是「提示」）
    meta.ending = { nodeId: scriptedNodeId, title: endingTitle };

    // 只有第一次到达时才提示 + 要求玩家做选择
    if (!endingState.announced) {
      state = {
        ...state,
        ending: {
          nodeId: scriptedNodeId,
          title: endingTitle,
          announced: true,
          mode: endingState.mode,
        },
      };
      meta.endingChoice = {
        nodeId: scriptedNodeId,
        title: endingTitle,
      };
      yield {
        type: 'notice',
        text: `故事走到了结局「${endingTitle ?? '结局'}」。要就此收尾，还是继续留在尾声里？`,
      };
    } else {
      // 已经提示过：把当前选择状态带上，避免前端重复弹卡
      state = { ...state, ending: { ...endingState, nodeId: scriptedNodeId, title: endingTitle } };
    }

    // 已选「结束」：不再允许继续对话
    if (state.ending?.mode === 'closed') {
      meta.endingClosed = true;
    }
  }

  // 多人：把本回合的面板写回成员
  if (actingMember && state.party?.length) {
    state = {
      ...state,
      party: state.party.map((m) =>
        m.id === actingMember.id ? { ...m, sheet: state.sheet } : m,
      ),
    };
  }

  // 回合结束：冷却递减
  state = endTurn(state);

  // 能力次数恢复：「每回合」型的在这一回合结束后重置，
  // 「每场景」型的在场景（scene 名）变化时重置。
  state = resetUsesFor(state, abilities, 'turn');
  if (session.state.scene !== state.scene) {
    state = resetUsesFor(state, abilities, 'scene');
  }

  // 偏离不进 UI：这一整套「把故事拉回来」的机制对玩家是不可见的兜底手段
  if (meta.choices?.length) yield { type: 'choices', choices: meta.choices };
  yield { type: 'state', state };

  const assistantMessage: Message = {
    id: assistantId,
    sessionId: session.id,
    role: 'assistant',
    content: text,
    meta,
    createdAt: Date.now(),
  };
  messageRepo.append(assistantMessage);
  // 存下这一刻的完整状态：分叉 / 回退要靠它精确还原，而不是拿父线当前状态近似
  messageRepo.saveState(assistantMessage.id, session.id, state);
  sessionRepo.updateState(session.id, state);

  const updatedSession = sessionRepo.get(session.id)!;
  yield { type: 'done', message: assistantMessage, session: updatedSession };
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

/** 从数组里随机抽 n 个（可复现：走会话 rng） */
function shuffleTake<T>(list: readonly T[], n: number, rng: () => number): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.max(0, Math.min(n, copy.length)));
}

/* ------------------------------------------------------------------ */
/* 离线兜底叙事                                                        */
/* ------------------------------------------------------------------ */

function fallbackNarration(
  world: World,
  state: SessionState,
  req: ChatRequest,
  error: string | null,
  scriptedChoices: ScriptChoice[] | undefined,
  pack: RulePack,
): string {
  const lines: string[] = [];
  if (error) lines.push(`（离线模式）《${world.title}》的叙事引擎暂时没能连上模型。`);

  const scene = state.scene ? `你仍在「${state.scene}」。` : '';

  if (world.mode === 'coc') {
    lines.push(`${scene}空气里有潮湿的铁锈味。你握紧手中的光源，听见自己的呼吸比想象中更响。`);
    lines.push(`刚才的声响又靠近了一些——你没有退路，只能决定下一步。`);
  } else if (world.mode === 'script') {
    lines.push(`${scene}故事在此停顿了一瞬，仿佛世界本身也在等你的选择。`);
  } else {
    lines.push(`${scene}风声穿过树冠，光线缓慢移动。你意识到自己正站在一个必须做出选择的时刻。`);
  }
  if (req.content) lines.push(`你做出的事：「${req.content.slice(0, 60)}」——世界给出了回应。`);

  const choices = scriptedChoices?.length
    ? scriptedChoices.map((c) => ({ text: c.text }))
    : [{ text: '向前走近，看清那东西' }, { text: '先退回安全处观察' }, { text: '大声呼喊，试探回应' }];

  lines.push('');
  lines.push(META_START);
  lines.push(JSON.stringify({ choices, scene: state.scene || '未知之地' }));
  lines.push(META_END);
  void pack;
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* 结局收尾                                                            */
/* ------------------------------------------------------------------ */

/**
 * 生成一段「收尾叙事」。
 *
 * 只在玩家于结局卡片上选「就此结束」时调用一次。
 * 不写进主流程的 runTurn，因为它不需要掷骰、事件、状态变更 ——
 * 它只是一段散文，用来把故事合上。
 *
 * 失败（模型没配 / 离线 / 超时）时返回 null，由调用方决定怎么提示；
 * 按产品决定：**离线不写**，所以这里不做本地兜底生成。
 */
export async function generateOutro(sessionId: string): Promise<string | null> {
  const { world, session, script } = loadContext(sessionId);
  const config = getLlmConfig();
  if (!config.baseUrl || !config.model) return null;

  const ending = session.state.ending;
  const node = script && ending?.nodeId ? findNode(script, ending.nodeId) : undefined;
  const history = messageRepo.list(session.id);
  const recent = history.slice(-6);

  const turns: ChatTurn[] = [
    {
      role: 'system',
      content:
        `你是互动小说《${world.title}》的叙事引擎。故事已经走到了结局` +
        `${ending?.title ? `「${ending.title}」` : ''}。\n\n` +
        `请写一段**收尾**，把故事合上：\n` +
        `- 150-300 字，第二人称或第三人称都可以，保持一贯的文风。\n` +
        `- 呼应前面的关键意象，给读者一个情绪上的落点。\n` +
        `- 不要再抛出新悬念，不要再给选项，不要在正文里列任何列表。\n` +
        `- 直接输出正文，不要任何元数据、不要 JSON、不要解释。`,
    },
  ];
  // 结局节点自带的正文当作「已知结局」的底色
  if (node?.content) turns.push({ role: 'assistant', content: node.content });
  for (const m of recent) {
    if (m.role === 'user' || m.role === 'assistant') {
      turns.push({ role: m.role, content: m.content.slice(0, 1200) });
    }
  }
  turns.push({ role: 'user', content: '（故事到这里了。请写一段收尾。）' });

  try {
    const res = await chatComplete({ ...config, stream: false, maxTokens: 700 }, turns);
    const text = (res.text ?? '').trim();
    if (!text) return null;
    // 万一模型又贴了元数据，切掉
    return splitMeta(text).text.trim() || text;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 会话初始化                                                          */
/* ------------------------------------------------------------------ */

export { initialState };





