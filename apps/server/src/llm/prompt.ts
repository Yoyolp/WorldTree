import {
  estimateTokens,
  META_END,
  META_START,
  renderAbilities,
  resourceMax,
  resourceValue,
  splitMetaLoose,
  stripThinkBlocks,
  type CharacterAbility,
  type CharacterCard,
  type CheckResult,
  type EventFireRecord,
  type LlmConfig,
  type Message,
  type PartyMember,
  type RulePack,
  type Session,
  type World,
} from '@worldtree/shared';
import type { ChatTurn } from '../llm/client.js';
import { renderLore, type LoreHit } from '../lib/lore.js';

const META_TEMPLATE = `${META_START}
{
  "choices": [{"text": "选项文本（≤30 字）", "hint": "补充说明", "check": {"skill": "侦查", "difficulty": "regular"}}],
  "check": null,
  "state": {"set": {"变量名": "值"}, "addFlags": ["标记"], "removeFlags": [], "sanDelta": 0, "hpDelta": 0, "mpDelta": 0},
  "scene": "一句话概括当前场景",
  "summary": "可选：剧情概要",
  "goto": "可选：要跳转到的节点id"
}
${META_END}`;

export interface PromptInput {
  world: World;
  session: Session;
  characters: CharacterCard[];
  playerCharacter?: CharacterCard;
  history: Message[];
  loreHits: LoreHit[];
  playerInput: string;
  intent: string;
  pack: RulePack;
  nodeDirective?: string;
  checkResults?: CheckResult[];
  eventRecords?: EventFireRecord[];
  rollText?: string;
  config: LlmConfig;
  /** 玩家角色拥有的能力（含金手指与继承来的） */
  abilities?: CharacterAbility[];
  /** 本回合使用的能力 */
  usedAbility?: CharacterAbility | null;
  /** 多人：本次行动者 */
  actingMember?: PartyMember | null;
  /** 多人：房间内其他成员 */
  party?: PartyMember[];
  /** 继承数据已渲染好的段落 */
  legacyText?: string;
  /** 本团 KP 由谁担任 */
  kpMode?: 'human' | 'ai';
  /** 本回合是 KP 下导演指令 */
  directing?: boolean;
  /** 剧本：当前节点 id 与全部节点（让模型可以主动推进） */
  currentNodeId?: string;
  scriptNodes?: { id: string; title: string }[];
  /** 剧本：当前节拍标题（用于剧情牵引） */
  currentNodeTitle?: string;
  /** 剧情偏离主线的连续回合数（1 起算；0/undefined 表示正常） */
  plotDrift?: number;
  /** 剧情牵引时可以切过去的节点 id（当前节点之后的那一个） */
  plotTargetId?: string;
  /** 本回合给玩家准备的随机母题（偏离主线时用） */
  plotMotifs?: string[];
  /** 本回合有检定失败，且规则要求「失败就卡住」——模型必须写出明确代价 */
  checkBlocked?: boolean;
  /** 内容尺度红线（由 admin 的安全设置渲染而来） */
  safetyText?: string;
  /**
   * 玩家这一手有明显风险，但没有命中任何技能关键词。
   * 此时由模型自行判断「要不要检定、检定什么」，引擎不替玩家掷骰。
   */
  riskyAction?: boolean;
  /** 窗口很小的时候把设定压成摘要 */
  compactNarrative?: boolean;
}

/**
 * 面板 → 提示词文本。
 *
 * 以前这里写死了 `HP/MP/SAN/幸运` 四个资源、`STR(CON...)` 九属性。
 * 现在按规则书的 sheetSchema 遍历：属性用中文标签，资源用声明里的 label。
 * 规则书没声明 schema 的老路径，退回到「把所有数字字段铺出来」。
 */
function sheetText(
  name: string,
  sheet: NonNullable<Session['state']['sheet']>,
  pack?: RulePack,
): string {
  const schema = pack?.sheetSchema;

  // 属性：有 schema 就按 schema 顺序，并带中文标签
  const attrParts = schema?.attributes?.length
    ? schema.attributes
        .filter((d) => typeof sheet.attributes[d.key] === 'number')
        .map((d) => `${d.label}(${d.abbr ?? d.key}) ${sheet.attributes[d.key]}`)
    : Object.entries(sheet.attributes).map(([k, v]) => `${k} ${v}`);
  const attrs = attrParts.join(' / ');

  const skills = sheet.skills.map((s) => `${s.name} ${s.value}`).join('、');

  // 资源：按 schema 列，没有 schema 就用 COC 的四项
  const resourceDefs =
    schema?.resources?.length
      ? schema.resources
      : [
          { key: 'hp', label: 'HP' },
          { key: 'mp', label: 'MP' },
          { key: 'san', label: 'SAN' },
        ];
  const resourceParts = resourceDefs
    .map((d) => {
      const cur = resourceValue(sheet, d.key);
      const max = resourceMax(sheet, d.key);
      return max > 0 ? `${d.label} ${cur}/${max}` : `${d.label} ${cur}`;
    })
    .filter(Boolean);
  const luck = resourceValue(sheet, 'luck');
  if (luck > 0) resourceParts.push(`幸运 ${luck}`);

  return [
    `角色：${name}`,
    attrs ? `属性：${attrs}` : '',
    `状态：${resourceParts.join('，')}`,
    sheet.conditions?.length ? `状态标记：${sheet.conditions.join('、')}` : '',
    sheet.items?.length ? `随身物品：${sheet.items.join('、')}` : '',
    skills ? `技能：${skills}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 规则包 → 叙事规则段落。
 *
 * 规则段落由规则包自己提供（RulePack.instructions），平台不再按 id 硬编码
 * —— 否则每加一本规则书都要回来改这里。插件没写就用一段通用兜底。
 */
function packInstructions(pack: RulePack): string {
  if (pack.instructions?.trim()) return pack.instructions.trim();

  const dice = `1d${pack.dieFaces}`;
  return [
    `# 规则（${pack.name}）`,
    `- 检定使用 ${dice}，由系统掷骰，你只负责给出技能名与描写结果。`,
    pack.failForward
      ? '- 即使失败也推进故事：写「你成功了但……」「你没能做到，同时发现了……」。'
      : '- 失败要有具体代价，而不是简单一句「你失败了」。',
  ].join('\n');
}

/**
 * 偏离主线后可以即兴发挥的小事件母题。
 * AI 不负责「想点什么出来」，只负责把母题写成场景——小模型的发散质量会稳定很多。
 */
export const PLOT_MOTIFS = [
  '费尔奇和他的猫堵在你必经的走廊尽头',
  '皮皮鬼在上一层楼梯上唱歌，歌词里出现了你的名字',
  '一个低年级学生跑来塞给你一张折成四折的纸条，转身就跑',
  '走廊里的画像们突然同时停住了动作',
  '某扇门的把手是热的',
  '窗外一只猫头鹰撞在玻璃上，掉下去又飞上来',
  '空气里焦糖和烧焦羽毛的味道混在一起',
  '一个你不认识的老师在拐角叫住你，问你有没有走错楼层',
  '楼梯自己换了方向，把你送到不打算去的地方',
  '你听见有人在数数，从一数到七就重新开始',
  '厨房门缝里透出热气，有谁在里面争吵',
  '地上有一行湿脚印，到墙边就断了',
];

/** 偏离多少回合后开始悄悄往回收（不显示给玩家） */
export const PLOT_SOFT_RETURN = 4;
/** 偏离多少回合后启用兜底收束（不显示给玩家） */
export const PLOT_HARD_RETURN = 6;

/** 剧情插曲：玩家跑偏时把这一回合当成「额外回合」，用随机母题给它内容 */
export function plotInterlude(input: {
  plotDrift?: number;
  currentNodeTitle?: string;
  plotTargetId?: string;
  motifs?: string[];
}): string | null {
  const drift = input.plotDrift ?? 0;
  if (drift <= 0) return null;

  const beat = input.currentNodeTitle ? `「${input.currentNodeTitle}」` : '剧本当前节拍';
  const motifs = (input.motifs ?? []).slice(0, 3);
  const motifLines = motifs.length
    ? motifs.map((m) => `- ${m}`).join('\n')
    : '- 走廊尽头传来不该有的声音\n- 某个本该上锁的房间现在是开着的';

  const lines = [
    '# 主线之外的插曲回合',
    `玩家这一轮没有沿剧本节拍${beat}走。把这一回合当成**额外回合**来处理：`,
    '- 不要急着把玩家拉回来，也不要否定他刚做过的事；它确实发生了。',
    '- 从下面的素材里挑 1~2 条，编一件小事让他遇到。只写他看见、听见、碰到的东西，不要替他行动。',
    motifLines,
    '- 这件小事要有一点后果感（留下痕迹、被人记住、消耗时间），但**不要推进主线**，也不要引入剧本之外的重要角色。',
    '- 照常给选项。至少留一个指向当前节拍的选项，但写成玩家自己的念头，不要出现「回到主线」「继续剧情」这类词。',
  ];

  if (drift >= PLOT_SOFT_RETURN) {
    lines.push(
      '- 插曲可以收个尾了：让某件与节拍有关的东西重新出现（校长的传话、课程铃声、同学的求助），给玩家一个自然的台阶。',
    );
  }

  if (drift >= PLOT_HARD_RETURN) {
    lines.push(
      `- 兜底：如果玩家这一轮仍然完全没有碰到与${beat}有关的东西，可以用一次不可拒绝的事件把场景带回去（点名、宵禁、传唤、上课铃、有人直接来把他带走）。用剧情内的理由，不要提「主线」「剧本」「节拍」这些词，也不要说「现在回到」。`,
    );
    if (input.plotTargetId) {
      lines.push(`- 如果这样还不合适，就在元数据里写 "goto": "${input.plotTargetId}"，让故事自然翻到下一段。`);
    }
  }

  return lines.join('\n');
}

/** 组装系统提示 */
function buildSystem(input: PromptInput): string {
  const { world, session, characters, playerCharacter, loreHits, pack } = input;
  const blocks: string[] = [];
  // 窗口很小时（本地 4k 之类）把设定类文本压到摘要长度，把预算留给历史和输出
  const compact = !!input.compactNarrative;
  const cut = (s: string, n: number) => (s && s.length > n ? `${s.slice(0, n)}…` : s);

  blocks.push(
    `你是互动小说《${world.title}》的叙事引擎与主持人。严格遵守世界设定，以第二人称或第三人称持续推演，让玩家的每个选择都产生真实后果。`,
  );

  blocks.push(`# 世界设定\n${cut(world.setting || '（未填写）', compact ? 420 : 100000)}`);
  if (world.opening && !compact) blocks.push(`# 开场\n${world.opening}`);
  if (world.description && !compact) blocks.push(`# 简介\n${world.description}`);

  const rules = world.rules ?? {};
  const styleLines: string[] = [];
  if (rules.style) styleLines.push(`文风：${rules.style}`);
  for (const d of rules.directives ?? []) styleLines.push(`- ${d}`);
  if (styleLines.length) blocks.push(`# 叙事要求\n${styleLines.join('\n')}`);

  if (characters.length) {
    const cast = characters
      .map((c) => {
        const lines = [`## ${c.name}`];
        if (compact) {
          const brief = cut(c.description || c.personality || '', 110);
          if (brief) lines.push(brief);
          return lines.join('\n');
        }
        if (c.description) lines.push(`设定：${c.description}`);
        if (c.personality) lines.push(`性格：${c.personality}`);
        if (c.scenario) lines.push(`处境：${c.scenario}`);
        if (c.systemPrompt) lines.push(`演出提示：${c.systemPrompt}`);
        if (c.mesExample) lines.push(`台词示例：\n${c.mesExample}`);
        return lines.join('\n');
      })
      .join('\n\n');
    blocks.push(`# 登场角色\n${cast}`);
  }

  if (playerCharacter) {
    blocks.push(
      `# 玩家角色\n玩家扮演「${playerCharacter.name}」。${
        playerCharacter.description ? `背景：${cut(playerCharacter.description, compact ? 160 : 100000)}` : ''
      }`,
    );
  }
  // 自称与卡名一致时不重复说一遍（现在默认用角色卡名当玩家名）
  if (session.playerName && session.playerName !== playerCharacter?.name) {
    blocks.push(`玩家自称：${session.playerName}`);
  }

  // 多人：队伍
  if (input.party?.length) {
    const acting = input.actingMember;
    const lines = input.party.map((m) => {
      const role = m.role === 'kp' ? '主持人' : m.role === 'spectator' ? '旁观者' : '玩家';
      const who = m.characterId ? `${m.name}（扮演 ${m.characterId}）` : m.name;
      const mark = acting && acting.id === m.id ? ' ← 本回合行动者' : '';
      return `- [${role}] ${who}${mark}`;
    });
    blocks.push(
      `# 队伍\n${lines.join('\n')}\n` +
        (acting
          ? `本回合由「${acting.name}」行动。请以 TA 的视角推进这一段，不要把其他玩家的行动也写出来。`
          : ''),
    );
  }

  // 能力（金手指）
  const abilityText = renderAbilities(input.abilities ?? [], session.state);
  if (abilityText) {
    blocks.push(
      `# 角色能力\n${abilityText}\n` +
        '这些能力是真实存在的设定，可以在叙事中生效。带检定加值的能力，系统已经在掷骰时计算过了，你只需描写结果。',
    );
  }
  if (input.usedAbility) {
    const a = input.usedAbility;
    blocks.push(
      `# 本回合使用了能力：${a.name}\n${a.description}${a.effect.onUseNarrative ? `\n${a.effect.onUseNarrative}` : ''}\n请写出这个能力生效的过程与观感。`,
    );
  }

  // 继承：前作延续
  if (input.legacyText) {
    blocks.push(input.legacyText);
  }

  const lore = renderLore(loreHits, 'before_char');
  if (lore) blocks.push(lore);

  const stateLines: string[] = [];
  if (session.state.scene) stateLines.push(`当前场景：${session.state.scene}`);
  if (session.state.summary) stateLines.push(`前情提要：${session.state.summary}`);
  if (session.state.flags.length) stateLines.push(`关键标记：${session.state.flags.join('、')}`);
  const vars = Object.entries(session.state.vars ?? {});
  if (vars.length) {
    stateLines.push(
      `世界变量：${vars.map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('；')}`,
    );
  }
  if (session.state.sheet) {
    stateLines.push(sheetText(playerCharacter?.name ?? '调查员', session.state.sheet, pack));
  }
  if (stateLines.length) blocks.push(`# 当前状态\n${stateLines.join('\n')}`);

  const loreAfter = renderLore(loreHits, 'after_char');
  if (loreAfter) blocks.push(loreAfter);

  if (input.nodeDirective) blocks.push(`# 当前剧情节拍\n${input.nodeDirective}`);

  if (input.checkResults?.length) {
    const lines = input.checkResults.map(
      (c) => `- ${c.skill}：${c.detail} → ${c.label}${c.success ? '（成功）' : '（失败）'}`,
    );
    blocks.push(`# 刚刚的检定\n${lines.join('\n')}\n请严格按照检定结果推进：成功就写出收获，失败就写出代价。`);
    if (input.checkBlocked) {
      blocks.push(
        '# 失败必须生效\n' +
          '这一手的检定失败了，而且本世界不启用「失败也推进」。\n' +
          '不要把它写成侥幸成功，也不要让玩家直接达到目的：写出明确的阻力、损失或后果，' +
          '让玩家必须换个办法。',
      );
    }
  } else if (input.checkBlocked) {
    blocks.push(
      '# 失败必须生效\n这一手的检定失败了，不要让玩家直接达到目的：写出明确的阻力、损失或后果。',
    );
  }

  // 有风险但引擎没自动掷骰（没有明确技能可判）：把裁定权交给模型
  if (input.riskyAction) {
    blocks.push(
      '# 这一手有风险，但没有可自动判定的技能\n' +
        '引擎没有替你掷骰。请你判断：这次行动是否真的可能失败、失败了是否有代价。\n' +
        '- 如果确实该检定，就选一个最贴切的技能，在元数据的 check 字段里给出 ' +
        '`{"skill": "技能名", "difficulty": "regular|hard|extreme", "reason": "为什么"}`，' +
        '由玩家自己点确认后再掷。\n' +
        '- 如果这只是个普通动作（拿东西、说话、观察），就不要给 check，直接写结果。\n' +
        '- 不要因为句子里出现「尝试」「用力」这类词就认为必须检定。',
    );
  }

  const evtNarr = (input.eventRecords ?? []).filter((r) => r.narrative);
  if (evtNarr.length) {
    blocks.push(
      `# 本回合必定发生的事件\n请把这些事件自然融入叙事，不要生硬罗列：\n${evtNarr
        .map((e) => `【${e.name}】${e.narrative}`)
        .join('\n')}`,
    );
  }

  if (input.rollText) blocks.push(`# 掷骰结果\n${input.rollText}`);

  blocks.push(packInstructions(pack));

  // 内容尺度：放在输出格式之前，让模型先看到红线再决定怎么写
  if (input.safetyText) blocks.push(input.safetyText);

  blocks.push(
    '# 输出格式\n' +
      '- 每次回复 200-600 字，结尾停在一个需要玩家决策的悬念或问题上。\n' +
      '- 用连贯的叙事段落，不用列表写剧情；对话用引号，动作用短句。\n' +
      '- 不要替玩家做决定，不要写玩家角色的台词（除非玩家自己说了）。',
  );

  // 选项格式单独成块：小模型对「正面示例」比「禁止清单」敏感得多。
  // 之前只写了「不要用 >>>」，结果模型改用了 Markdown 列表，照样漏进正文。
  blocks.push(
    '# 选项怎么给（重要）\n' +
      '选项**只能**写在元数据的 choices 数组里，正文里绝对不要出现任何形式的选项列表。\n\n' +
      '正文里禁止出现的写法（这些都会被玩家当成正文看到，非常破坏体验）：\n' +
      '  ✗ `- 伸手去抓住那团光`\n' +
      '  ✗ `* 蹲下来看看`\n' +
      '  ✗ `1. 站起来`\n' +
      '  ✗ `>>> 大声喊`\n' +
      '  ✗ `选项：A / B / C`\n' +
      '  ✗ 写完「（请做出选择）」「你该怎么做？」之后接一串列表\n\n' +
      '正确做法：正文的最后一个自然段写完后**立即结束正文**，然后在元数据里给出：\n' +
      '  "choices": [{"text": "伸手去抓住那团光"}, {"text": "蹲下来看掌纹里的冰晶"}]\n\n' +
      '正文结尾可以是悬念、疑问或画面的停顿，但**不要**再罗列行动。',
  );

  blocks.push(
    '# 结构化输出（必须遵守）\n' +
      '在叙事正文之后追加一段元数据块，供程序解析。正文中不得出现该块的任何内容。\n' +
      `必须原样包含 ${META_START} 与 ${META_END} 两个标记，程序靠它们切分正文。\n` +
      '不要输出裸 JSON，不要用 ```json 代码块。JSON 必须合法（不要有注释、不要有尾逗号）：\n' +
      META_TEMPLATE,
  );

  if (input.scriptNodes?.length) {
    const list = input.scriptNodes
      .slice(0, 16)
      .map((n) => `  - ${n.id}：${n.title}`)
      .join('\n');
    blocks.push(
      `# 剧本位置\n当前节点：${input.currentNodeId ?? '（未进入）'}\n` +
        `可用节点：\n${list}\n\n` +
        '如果你认为玩家这一轮的行动足以把剧情推进到另一个节点，就在元数据里写 "goto": "节点id"。' +
        '不确定时不要写，剧情会留在当前节点继续展开。',
    );
  }

  const interlude = plotInterlude({
    plotDrift: input.plotDrift,
    currentNodeTitle: input.currentNodeTitle,
    plotTargetId: input.plotTargetId,
    motifs: input.plotMotifs,
  });
  if (interlude) blocks.push(interlude);

  if (input.directing) {
    blocks.push(
      '# 导演指令（KP）\n' +
        `主持人这样要求：${input.playerInput}\n\n` +
        '请严格按这条要求描述场景、NPC 与气氛。不要替任何玩家角色行动，也不要让他们说话。' +
        '如果这条指令会改变局势，就改；如果它只是一个镜头，就只写这个镜头。',
    );
  } else if (input.kpMode === 'ai') {
    blocks.push(
      '# 你是 KP（守秘人）\n' +
        '这场游戏没有人类主持人，你就是主持人：描述世界、扮演所有 NPC、裁定行动的结果与代价。\n' +
        '玩家们是调查员，你只描述他们能感知到的部分，不替他们做决定。',
    );
    blocks.push(
      '# 节奏：把故事拉长\n' +
        '- 不要急着收束。除非玩家明确要打出最后一击，否则让局面继续复杂化。\n' +
        '- 每回合至少留下一个新钩子：一条线索、一个没答完的问题、一个刚出现的威胁。\n' +
        '- 玩家去追旁支线索时，给足回报，不要强行把 TA 拉回主线。\n' +
        '- 失败也要推进：失败不是停止，而是付出更高代价的前进。\n' +
        '- 解开一个谜团时，露出更大的谜团。',
    );
  }

  if (world.systemPromptOverride) blocks.push(`# 额外指令\n${world.systemPromptOverride}`);

  // 放在最后：小模型对末尾指令最敏感
  if (input.config.disableThinking) {
    blocks.push('# 直接回答\n不要输出思考过程，不要写「让我想想」这类内心独白，直接写叙事正文和元数据。');
  }

  blocks.push(
    `# 收尾提醒\n回复 = 叙事正文（不含任何 JSON） + 一行 ${META_START} + JSON + 一行 ${META_END}。\n` +
      '如果一时写不出完整 JSON，宁可少写字段，也不要省略这两个标记。',
  );

  return blocks.join('\n\n');
}

/**
 * 历史净化：把历史消息里残留的元数据块、裸 JSON、`>>>` 选项行去掉。
 * 这些内容一旦回灌给小模型，它会认为这就是「标准格式」并继续模仿。
 */
export function cleanHistoryText(content: string): string {
  if (!content) return '';
  // 标准标记块
  const parsed = splitMetaLoose(content);
  let text = parsed.text || content;

  // 兜底：标记之后的一切都不是正文
  const marker = text.indexOf('<<<WT_META>>>');
  if (marker >= 0) text = text.slice(0, marker);

  // 兜底：去掉任何残留的标记片段与思考标签
  text = stripThinkBlocks(text).replace(/<<<[^>]*>>>/g, '');

  // 兜底：成对的花括号 JSON 块（跨行）
  text = text.replace(/\n\{\s*"[^]*?\}\s*$/g, '');

  return text.trim();
}

/** 粗略裁剪历史 */
function trimHistory(history: Message[], budgetChars: number): Message[] {
  const out: Message[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    const cost = m.content.length + 40;
    if (used + cost > budgetChars && out.length >= 6) break;
    used += cost;
    out.unshift(m);
  }
  return out;
}

function formatPlayerInput(input: PromptInput): string {
  const base = input.playerInput.trim();
  switch (input.intent) {
    case 'continue':
      return '（玩家选择继续，请顺着当前的紧张感推进剧情。）';
    case 'choice':
      return `（玩家选择了：${base}）`;
    case 'roll':
      return `（玩家进行了掷骰：${input.rollText ?? base}。请依据结果继续叙事。）`;
    case 'action':
      return `（玩家的行动：${base}）`;
    default:
      return base || '（玩家沉默地观察四周。）';
  }
}

/**
 * 把 at_depth 的世界书条目按 depth 插进历史。
 *
 * SillyTavern 的语义：depth=0 紧贴最新一条消息（最靠后），depth 越大越往
 * 历史深处走。这里把它当作「附在倒数第 depth+1 条消息之后」的系统备注插入。
 */
function insertDepthLore(turns: ChatTurn[], hits: LoreHit[]): ChatTurn[] {
  const depthHits = hits.filter((h) => (h.entry.position ?? 'before_char') === 'at_depth');
  if (!depthHits.length) return turns;

  const out = [...turns];
  // 按 depth 从大到小插，保证小 depth（更靠后）最后插入、位置正确
  const sorted = [...depthHits].sort((a, b) => (b.entry.depth ?? 0) - (a.entry.depth ?? 0));

  for (const hit of sorted) {
    const cap = hit.entry.maxChars > 0 ? hit.entry.maxChars : undefined;
    const body = `【${hit.entry.comment || hit.entry.keys[0] || '设定'}】\n${
      cap ? hit.entry.content.slice(0, cap) : hit.entry.content
    }`;
    const depth = Math.max(0, Math.min(hit.entry.depth ?? 0, out.length));
    // depth=0 → 插在最后一条之后；depth=1 → 倒数第二条之后……
    const at = Math.max(0, out.length - depth);
    out.splice(at, 0, { role: 'system', content: `<世界书·深度>\n${body}\n</世界书·深度>` });
  }
  return out;
}

/** 组装最终请求 */
export function buildChatTurns(input: PromptInput): ChatTurn[] {
  // 按模型真实的上下文窗口算预算，而不是我们自己假设的数字
  const win = Math.max(2048, input.config.contextWindow || 8192);
  const outReserve = Math.min(input.config.maxTokens || 2048, Math.floor(win * 0.33));
  // 0.88 是安全系数：token 估算永远只是估算，真超了会被服务端从头部砍掉
  const promptTokens = Math.max(900, Math.floor((win - outReserve - 128) * 0.88));

  // 系统提示自己就可能超预算（小窗口 + 大世界书 + 节点目录）。
  // 超了就从「最可以省」的部分开始往下删，绝不让服务端从头部截断——
  // 那会把输出格式、剧本位置这些最要命的东西一起剪掉。
  let system = buildSystem(input);
  // 给历史留出至少 40% 的空间：系统提示吃满预算时，模型会连「上一回合发生了什么」
  // 都看不到，写出来的东西自然接不上。
  const sysCap = Math.floor(promptTokens * 0.6);
  const dropLore = { ...input, loreHits: [] };
  const dropBig = { ...dropLore, scriptNodes: [], legacyText: '', eventRecords: [] };
  const compactAll = {
    ...dropBig,
    compactNarrative: true,
    party: [],
    abilities: [],
    checkResults: [],
  };
  for (const cand of [input, dropLore, dropBig, compactAll]) {
    system = buildSystem(cand);
    if (estimateTokens(system) <= sysCap) break;
  }

  const sysTokens = estimateTokens(system);
  // 历史预算：中文下 1 字≈1 token，所以「字符预算」不能比 token 预算更大。
  // 这里留 10% 余量给每条消息的 role/分隔开销。
  const charsBudget = Math.floor(Math.max(400, promptTokens - sysTokens) * 0.9);
  const history = trimHistory(input.history, charsBudget);

  const turns: ChatTurn[] = [{ role: 'system', content: system }];
  for (const m of history) {
    if (m.role === 'assistant' || m.role === 'user') {
      turns.push({ role: m.role, content: m.content });
    }
  }

  const last = turns[turns.length - 1];
  const plain = formatPlayerInput(input);
  // Qwen3 系认这一句：只写正文，别把预算花在思考上
  const playerLine = input.config.disableThinking ? `${plain}\n\n/no_think` : plain;
  if (last && last.role === 'user' && last.content === plain) {
    // 玩家这一句已经在历史里：直接补提示，别再重复一条
    last.content = playerLine;
  } else if (!(last && last.role === 'user' && last.content === playerLine)) {
    turns.push({ role: 'user', content: playerLine });
  }
  return insertDepthLore(turns, input.loreHits);
}

export function estimatePromptTokens(turns: ChatTurn[]): number {
  return turns.reduce((acc, t) => acc + estimateTokens(t.content) + 4, 0);
}
