/**
 * 世界树 · 共享领域模型
 *
 * 设计要点：
 * 1. 角色卡 / 世界书 字段与 SillyTavern V2 对齐，可直接导入导出生态资源。
 * 2. 三种推演模式（自由叙事 / 剧本 / 跑团）共用同一套状态与规则引擎，
 *    差别只在「选项来源」与「规则包」。
 * 3. 事件（固定事件 + 概率事件）由引擎按条件求值，随机结果写进消息以保证可复现。
 */

export type ID = string;

/* ------------------------------------------------------------------ */
/* 通用                                                                */
/* ------------------------------------------------------------------ */

/**
 * 规则包标识。
 *
 * 曾经是封闭联合类型（'coc7' | 'coc-d100' | ...），现在打开成字符串：
 * 规则书以插件形式从 content/rulepacks/ 加载，平台不认识新的 id 也要能跑。
 * 内置的四个 id 见 rulepacks.ts 的 BUILTIN_RULEPACKS。
 */
export type RulePackId = string;

/** 推演模式：只影响选项来源与默认规则包 */
export type PlayMode = 'story' | 'script' | 'coc';

export interface Timestamps {
  createdAt: number;
  updatedAt: number;
}

export interface FileSource {
  /** 相对 content/ 的路径，例如 characters/lin-yan.json */
  file?: string;
  /** 文件指纹，用于判断是否被外部编辑过 */
  checksum?: string;
}

/* ------------------------------------------------------------------ */
/* 骰子 / 检定                                                         */
/* ------------------------------------------------------------------ */

export type DiceRoll = {
  formula: string;
  rolls: number[];
  total: number;
  modifier?: number;
  label: string;
  detail?: string;
};

export type CheckOutcome = 'critical' | 'extreme' | 'hard' | 'regular' | 'fail' | 'fumble';
export type CheckDifficulty = 'regular' | 'hard' | 'extreme';

export interface CheckResult {
  skill: string;
  /** 技能目标值 */
  target: number;
  difficulty: CheckDifficulty;
  /** 奖励骰数（正）或惩罚骰数（负） */
  bonus: number;
  /** 所有候选十位骰结果 */
  candidates: number[];
  /** 最终采用的点数 */
  roll: number;
  outcome: CheckOutcome;
  success: boolean;
  /** 中文结果描述，如「困难成功」 */
  label: string;
  /** 消耗的幸运值 */
  luckSpent?: number;
  /** 是否为孤注一掷 */
  pushed?: boolean;
  detail?: string;
}

/* ------------------------------------------------------------------ */
/* 角色面板：结构由规则书声明，数据是通用键值                            */
/* ------------------------------------------------------------------ */

/**
 * COC 的九项属性键。
 *
 * 面板本身已经通用化了（`CocSheet.attributes` 是任意键值），
 * 这个类型只剩「COC 系规则书用哪几个键」的意义，
 * 供内置 COC 规则包与相关工具函数使用。
 */
export type CocAttributeKey = 'STR' | 'CON' | 'SIZ' | 'DEX' | 'APP' | 'INT' | 'POW' | 'EDU' | 'LUCK';

export interface CocSkill {
  name: string;
  value: number;
  /** 技能分类 */
  category?: string;
  /** 是否为职业技能 */
  occupation?: boolean;
}

/** 面板的一项属性（力/敏/智……） */
export interface SheetAttributeDef {
  /** 数据键，如 STR / 力量 / dex */
  key: string;
  /** 中文显示名 */
  label: string;
  /** 英文缩写 / 角标，如 STR */
  abbr?: string;
  /** 编辑与生成时的下界（默认 1） */
  min?: number;
  /** 上界（默认 99） */
  max?: number;
  /** 新建面板时的初始值 */
  default?: number;
  /** 「随机生成」时的骰式，如 "3d6*5"；省略则用 default */
  roll?: string;
  /** 编辑页分组（同组排在一起） */
  group?: string;
  /** 鼠标悬停说明 */
  hint?: string;
}

/**
 * 面板的一项资源（HP / MP / SAN / AC / 法术位……）。
 *
 * `key` 直接作为存储键。为了兼容旧存档，COC 的
 * `hp/hpMax/mp/mpMax/san/sanMax/luck/luckMax` 仍写在面板的平铺字段上，
 * 其余资源写进 `CocSheet.resources`。
 */
export interface SheetResourceDef {
  key: string;
  label: string;
  /** 上限公式，如 "(CON+SIZ)/10"；省略表示无上限（如 AC） */
  maxFormula?: string;
  /** 初始值公式，省略则等于上限 */
  initFormula?: string;
  /** 进度条颜色；省略用主题色 */
  color?: string;
  /** false 时显示为数字徽章而不是进度条（AC、速度这类） */
  bar?: boolean;
  /** 低于该比例（0-1）时标红，默认 0.25 */
  dangerRatio?: number;
  min?: number;
  max?: number;
  hint?: string;
}

/** 面板的一项技能 */
export interface SheetSkillDef {
  key: string;
  label: string;
  /** 基础值公式，如 "DEX/2"、"10+WIS"；省略用 default */
  baseFormula?: string;
  /** 新建时的默认值（无 baseFormula 时用） */
  default?: number;
  /** 关联属性，用于展示「属性调整值」 */
  attribute?: string;
  group?: string;
  hint?: string;
  /**
   * 一句话效果，展示在百科的技能表里。
   * 例如「观察痕迹、发现隐藏的门与脚印」
   */
  description?: string;
  /**
   * 详细说明，支持 Markdown。百科页点开技能时展示。
   *
   * 注意：这只是**给玩家读的规则说明**，不参与任何判定计算。
   * 想让技能真的影响掷骰，请用 `baseFormula`（改基础值）
   * 或角色的 `abilities[].effect.checkBonus`（改加值）。
   */
  effectText?: string;
  /** 分类标签，如 ['社交', '战斗']，百科里用于筛选 */
  tags?: string[];
  /** 典型用法示例，百科里作为「什么时候用」的提示 */
  examples?: string[];
}

/** 只读派生展示项（伤害加值、移动力、先攻……） */
export interface SheetDerivedDef {
  key: string;
  label: string;
  /** 公式，结果四舍五入取整 */
  formula: string;
  /** 展示单位后缀，如 "米" */
  suffix?: string;
  hint?: string;
}

/**
 * 面板结构声明：规则书告诉平台「这套规则的角色卡长什么样」。
 *
 * 平台只认这个结构，不问规则书是谁。COC 九属性 + HP/MP/SAN 是一个
 * SheetSchema，D&D 六属性 + HP/AC/法术位 是另一个。
 */
export interface SheetSchema {
  /** 面板自称，展示在面板副标题，如 "COC 7th 调查员" */
  label?: string;
  /** 属性区标题（默认「属性」） */
  attrLabel?: string;
  /** 资源区标题（默认「状态」） */
  resourceLabel?: string;
  /** 技能区标题（默认「技能（点击检定）」） */
  skillLabel?: string;
  /** 分组顺序；不写则按出现顺序 */
  groups?: string[];
  attributes: SheetAttributeDef[];
  resources: SheetResourceDef[];
  /** 技能表；省略表示这套规则没有技能列表 */
  skills?: SheetSkillDef[];
  /** 允许玩家自己添加技能条目（默认 true） */
  freeSkills?: boolean;
  /** 技能值的上界，用于编辑页输入框（默认 99） */
  skillMax?: number;
  /** 只读派生项 */
  derived?: SheetDerivedDef[];
}

/* ------------------------------------------------------------------ */
/* 角色面板（数据）                                                     */
/* ------------------------------------------------------------------ */

/**
 * 角色面板。
 *
 * 历史上这里是 `Record<CocAttributeKey, number>`，只有 COC 能用。
 * 现在 `attributes` 是任意键值，具体有哪些键、叫什么名字、有哪些资源，
 * 全部由规则包的 `SheetSchema` 决定 —— 这就是「支持任意规则书」的关键。
 *
 * 迁移策略：`hp/mp/san/luck` 这些平铺字段保留不动，老存档零改动即可继续读；
 * 新规则的额外资源进 `resources`。取值的正确方式是 `sheet.ts` 里的
 * `resourceValue()` / `resourceMax()`，不要直接摸字段。
 */
export interface CocSheet {
  /** 属性：键由 SheetSchema.attributes 声明 */
  attributes: Record<string, number>;
  skills: CocSkill[];

  /* ---- COC 系的四个内置资源（保留平铺字段以兼容旧存档） ---- */
  hp: number;
  hpMax: number;
  mp: number;
  mpMax: number;
  san: number;
  sanMax: number;
  /** 幸运（可消耗，用于改判） */
  luck?: number;
  luckMax?: number;

  /**
   * 其它资源（新规则书用）。键形如 `ac`、`spellSlots1`。
   * 上限也放在这里，键名约定为 `<key>Max`。
   */
  resources?: Record<string, number>;

  /** 这份面板是按哪本规则书建的（切换规则书时据此迁移字段） */
  rulePackId?: RulePackId;

  /** 状态标签 */
  conditions: string[];
  items: string[];
  /** 背景故事 */
  backstory?: string;
  /** 信念/理念 */
  ideology?: string;
  /** 重要之人 */
  significantPeople?: string;
  /** 意义非凡之地 */
  meaningfulPlaces?: string;
  /** 宝贵之物 */
  treasuredPossessions?: string;
  /** 特质 */
  traits?: string;
  /** 伤口与疤 */
  injuries?: string;
  /** 恐惧症与狂躁症 */
  phobias?: string;
}

/* ------------------------------------------------------------------ */
/* 世界书（SillyTavern World Info 兼容）                                */
/* ------------------------------------------------------------------ */

export type SelectiveLogic = 'and' | 'or' | 'not';
export type LorePosition = 'before_char' | 'after_char' | 'at_depth';

export interface WorldBookEntry {
  id: string;
  /** 备注名（仅作者可见，对应 ST 的 comment） */
  comment: string;
  /** 主关键词 */
  keys: string[];
  /** 次关键词 */
  secondaryKeys: string[];
  /** 是否选择性匹配（有次关键词时启用） */
  selective: boolean;
  selectiveLogic: SelectiveLogic;
  /** 常驻：无视关键词始终注入 */
  constant: boolean;
  caseSensitive: boolean;
  /** 关键词按正则解析 */
  useRegex: boolean;
  /** 整词匹配 */
  matchWholeWords: boolean;
  /** 注入优先级（越大越优先） */
  priority: number;
  /** 插入顺序（同优先级内排序，对齐 ST insertion_order） */
  insertionOrder: number;
  /** 注入位置 */
  position: LorePosition;
  /** position=at_depth 时的深度 */
  depth: number;
  /** 触发概率 0-100 */
  probability: number;
  /** 是否启用概率 */
  useProbability: boolean;
  /** 分组（同组内只取一个） */
  group: string;
  /** 冷却回合数（0 = 无冷却） */
  cooldown: number;
  /** 生效后保持回合数 */
  sticky: number;
  /** 条目内容 */
  content: string;
  /** 最大注入字符数（0 = 不限制） */
  maxChars: number;
  enabled: boolean;
  /**
   * 条目配图（相对 content/ 的路径，如 assets/wb_xxx.png）。
   * 纯展示用，不会注入提示词，也不会占用 token 预算。
   */
  image?: string;
  /** 配图说明（alt 文本 / 图注） */
  imageCaption?: string;
}

export interface WorldBook extends Timestamps, FileSource {
  id: ID;
  name: string;
  description: string;
  entries: WorldBookEntry[];
  /** 扫描最近 N 条消息 */
  scanDepth: number;
  /** 注入总预算（字符） */
  tokenBudget: number;
  /** 递归扫描（命中的内容再扫一次） */
  recursiveScanning: boolean;
}

/* ------------------------------------------------------------------ */
/* 角色卡（SillyTavern V2 兼容）                                       */
/* ------------------------------------------------------------------ */

export interface CharacterCard extends Timestamps, FileSource {
  id: ID;
  spec: 'chara_card_v2';
  specVersion: '2.0';

  /** ST: name */
  name: string;
  /** ST: description */
  description: string;
  /** ST: personality */
  personality: string;
  /** ST: scenario */
  scenario: string;
  /** ST: first_mes */
  firstMes: string;
  /** ST: mes_example */
  mesExample: string;
  /** ST: creator_notes */
  creatorNotes: string;
  /** ST: system_prompt */
  systemPrompt: string;
  /** ST: post_history_instructions */
  postHistoryInstructions: string;
  /** ST: alternate_greetings */
  alternateGreetings: string[];
  /** ST: tags */
  tags: string[];
  /** ST: creator */
  creator: string;
  /** ST: character_version */
  characterVersion: string;
  /** ST: extensions（原样保留未知字段） */
  extensions: Record<string, unknown>;

  /** 绑定的世界书（本地扩展） */
  characterBookId?: ID | null;

  /* ---- 本平台扩展 ---- */
  /** Material Icons 图标名（没有头像图片时作为占位） */
  avatarIcon: string;
  /** 头像底色 */
  avatarColor: string;
  /**
   * 头像图片（相对 content/ 的路径，如 assets/chr_xxx.png）。
   * 有值时优先显示图片，否则回落到 avatarIcon。
   */
  avatarImage?: string | null;
  /** 是否为玩家角色（调查员） */
  isPlayer: boolean;
  /** 跑团面板 */
  sheet?: CocSheet;
  /** 能力（含「金手指」）。结构化的能力会被引擎真正计算，不只是写进提示词 */
  abilities?: CharacterAbility[];
}

/* ------------------------------------------------------------------ */
/* 事件系统                                                            */
/* ------------------------------------------------------------------ */

export type EventTrigger =
  | 'turn_start'
  | 'turn_end'
  | 'enter_node'
  | 'player_action'
  | 'before_narration';

export type EventScope = 'world' | 'node';

export type CompareOp = 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'exists' | 'notExists';

export type EventCondition =
  | { type: 'flag'; op: 'has' | 'not'; value: string }
  | { type: 'var'; key: string; op: CompareOp; value?: string | number | boolean }
  /**
   * 资源条件。`stat` 是资源键：内置 hp/mp/san/luck，
   * 也可以是规则书声明的任意资源（如 dnd 的 ac、法术位）。
   */
  | { type: 'stat'; stat: string; op: CompareOp; value: number }
  | { type: 'node'; nodeId: string }
  | { type: 'turn'; op: CompareOp; value: number }
  | { type: 'scene'; contains: string }
  | { type: 'check'; skill: string; difficulty?: CheckDifficulty; mustSucceed?: boolean }
  | { type: 'chance'; value: number };

export interface EventStateEffect {
  set?: Record<string, unknown>;
  addFlags?: string[];
  removeFlags?: string[];
  sanDelta?: number;
  hpDelta?: number;
  mpDelta?: number;
  luckDelta?: number;
  /**
   * 通用资源增减：`{ ac: -1, spellSlots1: -1 }`。
   *
   * 上面的 sanDelta/hpDelta/... 是 COC 时代的固定字段，保留是为了旧剧本不用改；
   * 新规则书的资源用这个。两者会叠加，写在同一事件里也安全。
   */
  resourceDelta?: Record<string, number>;
  addItems?: string[];
  removeItems?: string[];
  addConditions?: string[];
}

export interface GameSceneSanSpec {
  /** 成功时损失，如 "0" / "1d4" */
  successLoss?: string;
  /** 失败时损失，如 "1d10" */
  failLoss: string;
}

export interface GameEvent {
  id: string;
  /** 触发时要求一次理智检定 */
  sanCheck?: GameSceneSanSpec;
  name: string;
  scope: EventScope;
  /** 所在节点（scope=node 时有效） */
  nodeId?: string;
  enabled: boolean;
  /** 只触发一次 */
  once: boolean;
  /** 触发概率 0-1（1 表示必定） */
  chance: number;
  /** 冷却回合 */
  cooldown: number;
  /** 优先级，越大越先判定 */
  priority: number;
  trigger: EventTrigger;
  conditions: EventCondition[];
  /** 注入给模型的叙事片段 */
  narrative?: string;
  /** 直接展示给玩家的系统提示 */
  notice?: string;
  /** 状态变更 */
  state?: EventStateEffect;
  /** 跳转到节点 */
  goto?: string;
  /** 触发后解锁 / 锁定的事件 */
  unlock?: string[];
  lock?: string[];
  /** 叙事注入强度提示 */
  weight?: number;
}

/** 事件运行时状态，随会话保存 */
export interface EventRuntimeState {
  /** 已触发过的 once 事件 */
  fired: string[];
  /** 剩余冷却回合 */
  cooldowns: Record<string, number>;
  /** 触发计数 */
  counters: Record<string, number>;
  /** 回合数 */
  turns: number;
}

export interface EventFireRecord {
  eventId: string;
  name: string;
  chance: number;
  roll: number;
  narrative?: string;
  notice?: string;
  effects?: EventStateEffect;
}

/* ------------------------------------------------------------------ */
/* 剧本（Markdown DSL 编译产物）                                       */
/* ------------------------------------------------------------------ */

export interface ScriptEffect {
  vars?: Record<string, unknown>;
  addFlags?: string[];
  removeFlags?: string[];
  sanDelta?: number;
  hpDelta?: number;
  mpDelta?: number;
  luckDelta?: number;
  /** 通用资源增减（新规则书用，如 `{ ac: -1 }`）；与上面的固定字段叠加 */
  resourceDelta?: Record<string, number>;
  addItems?: string[];
  addConditions?: string[];
  /** 跳转到节点（优先于 choice.next） */
  goto?: string;
}

export interface ScriptChoice {
  id: string;
  text: string;
  /** 目标节点 id */
  next?: string;
  requireFlag?: string;
  forbidFlag?: string;
  /** 需要某个能力才显示 */
  requireAbility?: string;
  /** 需要继承数据里的某个标记（来自前作的关键选择） */
  requireLegacyFlag?: string;
  /** 需要与某个对象的关系值达到阈值，如 { target: '斯内普', min: 30 } */
  requireRelationship?: { target: string; min?: number; max?: number };
  /** 检定要求 */
  check?: { skill: string; difficulty?: CheckDifficulty };
  effects?: ScriptEffect;
  /** 选择后给模型的引导 */
  prompt?: string;
  /** 选项来源：模型临场生成 / 剧本节点固定 */
  source?: 'model' | 'script';
}

export interface ScriptNode {
  id: string;
  title: string;
  content: string;
  directorNote?: string;
  choices: ScriptChoice[];
  /** 节点内嵌固定事件 */
  events: GameEvent[];
  onEnter?: ScriptEffect;
  ending: boolean;
  endingTitle?: string;
}

export interface StoryScript {
  id: string;
  title: string;
  startNodeId: string;
  rulePackId: RulePackId;
  nodes: ScriptNode[];
  /** 全局事件表 */
  events: GameEvent[];
}

export interface ScriptCompileResult {
  script: StoryScript | null;
  errors: string[];
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* 世界                                                                */
/* ------------------------------------------------------------------ */

export interface WorldRules {
  style?: string;
  directives?: string[];
  allowFreeInput?: boolean;
  choiceCount?: number;
  autoAdvance?: boolean;
  /** 是否启用自动检定推断 */
  autoCheck?: boolean;
  /** 失败也推进（fail forward） */
  failForward?: boolean;
}

/**
 * 面板规则书优先级。
 *
 * 「面板」指角色卡上那一堆属性/资源/技能长什么样；
 * 「判定」永远跟世界走，不受这个字段影响。
 */
export type SheetRulePrecedence = 'character' | 'world';

export interface World extends Timestamps, FileSource {
  id: ID;
  title: string;
  subtitle: string;
  description: string;
  /** Material Icons 图标名 */
  coverIcon: string;
  /** 封面主色 */
  coverColor: string;
  tags: string[];
  author: string;
  mode: PlayMode;
  /** 使用的规则包 */
  rulePackId: RulePackId;
  opening: string;
  setting: string;
  rules: WorldRules;
  worldBookId?: ID | null;
  characterIds: ID[];
  /**
   * 玩家可以用哪张角色卡当主角：
   * - `open`（默认）：可以用本世界队内的角色，也可以从角色库里挑自己的卡
   * - `fixed`：主角已由剧本写死，只能用本世界自带的角色卡
   *
   * 不写这个字段时按 `open` 处理，所以老世界不需要迁移。
   */
  playerCardMode?: 'open' | 'fixed';
  /** 剧本源文件（相对 content/） */
  scriptFile?: string;
  systemPromptOverride?: string;
  /**
   * 角色卡面板以哪边的规则书为准。
   *
   * 角色卡可以自带 `sheet.rulePackId`（它按哪本规则书建的面板），
   * 世界也有自己的 `rulePackId`。两者不一致时（比如拿一张 D&D 卡进 COC 世界）：
   *
   *  - `character`（默认）：面板按角色卡声明渲染。检定仍走世界规则。
   *  - `world`：面板按世界的规则书渲染，角色卡多出来的字段保留但不显示。
   *
   * 不论选哪个，**掷骰判定永远用世界的规则书** —— 同一世界内不能出现两套成功率。
   */
  sheetRulePrecedence?: SheetRulePrecedence;
  /** 继承规则：声明本世界接受哪些来自前作的存档数据 */
  inheritance?: InheritanceRule;
  /**
   * 分院规则：进入世界线时按角色卡的标签/能力/描述关键词判定归属，
   * 结果写成 flags「分院·<学院名>」并写入 vars.house，供剧本分支使用。
   */
  sorting?: {
    houses: { name: string; keywords: string[] }[];
    /** 都没命中时归入哪个学院（默认取 houses[0]） */
    fallback?: string;
  };
}

/* ------------------------------------------------------------------ */
/* 会话 / 世界线                                                       */
/* ------------------------------------------------------------------ */

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** 一条被世界书扫描命中的条目摘要（带配图，供阅读器展示） */
export interface LoreHitDetail {
  /** 条目备注名或首个关键词 */
  name: string;
  /** 配图（assets/xxx.png），没有则为空 */
  image?: string;
  /** 图注 */
  caption?: string;
}

export interface MessageMeta {
  choices?: ScriptChoice[];
  rolls?: DiceRoll[];
  checks?: CheckResult[];
  events?: EventFireRecord[];
  statePatch?: Record<string, unknown>;
  loreHits?: string[];
  /**
   * 命中条目的结构化信息（含配图）。
   *
   * 保留 loreHits 的字符串数组是为了兼容旧存档与「调试面板」这类只想知道
   * 命中名字的地方；需要在阅读器里展示配图时读这个字段。
   */
  loreHitDetails?: LoreHitDetail[];
  scene?: string;
  nodeId?: string;
  model?: string;
  tokens?: number;
  scripted?: boolean;
  error?: string;
  /** 本回合随机种子，用于复现 */
  seed?: number;
  rulePackId?: RulePackId;
  /** 本回合使用的能力 */
  ability?: { id: ID; name: string; kind: string };
  /** 多人：本回合行动者 */
  memberId?: ID;
  /** 本回合是否走到了结局 */
  ending?: { nodeId?: string; title?: string };
  /**
   * 刚刚到达结局时才有：前端据此弹出「写结尾 / 继续尾声」的选择卡。
   * 只在第一次到达时出现，之后不再重复。
   */
  endingChoice?: { nodeId?: string; title?: string };
  /** 玩家已选择「就此结束」：前端应禁用输入 */
  endingClosed?: boolean;
  /** 模型原始输出（含被剥离的元数据），用于排障 */
  rawOutput?: string;
  /** 元数据是否走了兜底解析 */
  recovered?: boolean;
  /** 模型输出被截断（没写 `<<<END_META>>>`），元数据靠本地补齐救回来的 */
  outputTruncated?: boolean;
  /** 服务端回报的真实 token 用量（用于校准与排障） */
  usage?: { prompt: number; completion: number };
  /** 本回合思考链长度（字符数）。接近输出上限说明思考吃了预算 */
  reasoningLen?: number;
  /** 模型建议但尚未掷的检定（由玩家点确认） */
  suggestedCheck?: { skill: string; difficulty?: CheckDifficulty; reason?: string };
  /** 该消息只对某个成员可见（私密视角） */
  pov?: ID;
  /** 剧情偏离主线的连续回合数（0 表示刚推进过剧本） */
  plotDrift?: number;
  /** 理智检定结果 */
  sanCheck?: {
    expression: string;
    loss: number;
    sanAfter: number;
    temporaryInsane: boolean;
    bout?: string;
    permanentInsane: boolean;
    detail: string;
  };
}

export interface Message {
  id: ID;
  sessionId: ID;
  role: MessageRole;
  content: string;
  meta: MessageMeta;
  createdAt: number;
}

export interface SessionState {
  vars: Record<string, unknown>;
  flags: string[];
  scene: string;
  nodeId?: string;
  sheet?: CocSheet;
  summary?: string;
  events: EventRuntimeState;
  rulePackId: RulePackId;
  /** 世界线种子，保证随机可复现 */
  seed: number;
  /** 多人：队伍成员（单人时为空） */
  party?: PartyMember[];
  /** 继承自前作的数据（导入时写入） */
  legacy?: LegacySnapshot | null;
  /** 能力运行时状态：abilityId -> 已用次数 */
  abilityUses?: Record<string, number>;
  /** 本回合触发的能力效果提示 */
  abilityLog?: string[];
  /** 战斗状态（不在战斗中为 null） */
  combat?: CombatState | null;
  /** 本幕成功用过的技能（幕间可掷成长） */
  skillsUsed?: string[];
  /**
   * 剧情偏离计数：玩家自由发挥、剧本节点长时间没推进时递增。
   * 系统据此逐级加压，把故事牵引回剧本。
   */
  plotDrift?: number;
  /**
   * 世界书的跨回合状态：cooldown 与 sticky 需要记住「上回合注入了什么」，
   * 否则这两个字段就是摆设。老存档没有这一项，按空表处理。
   */
  lore?: {
    cooldowns: Record<string, number>;
    sticky: Record<string, number>;
  };
  /**
   * 结局状态。
   *
   * 之前「到达结局」被当成节点的静态属性，每回合重算，
   * 导致结局存档被反复生成、结局提示每轮弹一次。
   * 这里记录「结局这件事已经发生过」，用一次性状态代替重复判定。
   *
   * 老存档没有这个字段 → 视为还没处理过结局（`undefined`）。
   */
  ending?: {
    /** 结局节点的 id 与标题 */
    nodeId?: string;
    title?: string;
    /** 是否已经提示过玩家「故事到这里结束」 */
    announced: boolean;
    /**
     * 玩家在结局处做出选择后的模式：
     *  - 'closed'    选了「写一段结尾，结束」→ 不能再对话
     *  - 'epilogue'  选了「继续自由对话」→ 尾声模式，可以聊但不再提示
     *  - undefined   还在等玩家选
     */
    mode?: 'closed' | 'epilogue';
    /** 是否已经生成过一段收尾叙事 */
    outroGenerated?: boolean;
  };
}

export interface Session extends Timestamps {
  id: ID;
  worldId: ID;
  title: string;
  branchLabel: string;
  characterIds: ID[];
  playerName: string;
  playerCharacterId?: ID | null;
  state: SessionState;
  parentId?: ID | null;
  branchPointMessageId?: ID | null;
  messageCount: number;
  archived: boolean;
  /** 分叉时保存的状态快照，保证分支从分叉点继续 */
  snapshot?: SessionState | null;
  /** 归属账号：世界线与存档按人隔离（内容库仍共享） */
  ownerId?: ID | null;
}

/* ------------------------------------------------------------------ */
/* 规则包                                                              */
/* ------------------------------------------------------------------ */

/** 成功等级的分档规则：掷值落在 [min, max] 内即该等级 */
export interface OutcomeBand {
  outcome: CheckOutcome;
  /** 下界（含）。阈值类填骰值，骰池类填成功数，加总类填总值 */
  min: number;
  /** 上界（含）。省略表示无上界 */
  max?: number;
}

export interface RulePack {
  id: RulePackId;
  name: string;
  description: string;
  /**
   * 骰面数。dN-threshold 策略真正会用它掷骰；
   * 其它策略下它只作为「这个体系用什么骰」的元信息展示。
   */
  dieFaces: number;

  /* ---- 判定策略（插件核心） ---- */
  /**
   * 判定策略 id，见 resolution.ts 的 STRATEGIES：
   * 'd100-threshold' | 'dN-threshold' | 'dice-pool' | 'sum-compare'
   * 插件可以注册自定义策略后用这里的 id 引用。
   */
  strategy?: string;
  /** 策略参数，直接传给 ResolutionStrategy.resolve */
  strategyParams?: Record<string, unknown>;
  /**
   * 成功等级分档。省略时用策略默认（阈值类走 COC 的大成功/极难/困难/常规/失败/大失败）。
   * 给了就完全按这张表判，适合「10+ / 7-9 / 6-」这类非数值体系。
   */
  outcomeBands?: OutcomeBand[];
  /** 大成功判定：直接指定骰值（如 COC 的 1） */
  criticalValue?: number;
  /** 大失败判定：直接指定骰值（如 COC 的 100） */
  fumbleValue?: number;
  /** 低技能时的大失败区间：{ below: 50, from: 96 } 表示目标<50 时 96-100 皆大失败 */
  fumbleRange?: { below: number; from: number };
  /**
   * 只分成功/失败两档（criticalValue / fumbleValue 仍保留戏剧性极值）。
   * 用于简化体系：不需要「困难成功 / 极难成功」这种细分。
   */
  simpleOutcome?: boolean;

  /* ---- 能力开关 ---- */
  /** 支持困难/极难难度 */
  difficulties: boolean;
  /** 支持奖励/惩罚骰 */
  bonusPenalty: boolean;
  /** 支持消耗幸运改判 */
  luckSpend: boolean;
  /** 支持孤注一掷 */
  pushedRolls: boolean;
  /** 自动从玩家行动推断检定 */
  autoCheck: boolean;
  /** 失败也推进剧情 */
  failForward: boolean;
  /** 理智机制 */
  sanity: boolean;
  /**
   * 理智用哪个资源键。默认 'san'。
   * 有些规则书叫 Resolve / 意志值 / 理智值 —— 改这里即可。
   */
  sanityResource?: string;
  /**
   * 临时疯狂时用来「扛住」的属性键。默认 'INT'（COC：智力检定成功才发疯）。
   */
  sanityBoutAttribute?: string;
  /**
   * 先攻用哪个属性键。默认 'DEX'。D&D 可用 'DEX'，其它系统可改成 '敏捷'。
   */
  initiativeAttribute?: string;
  /** 是否支持战斗流程 */
  combat: boolean;
  /**
   * 没有角色面板 / 没有该技能时的固定难度值。
   * 剧本简化包靠这个，让作者不写技能值也能检定。
   */
  difficultyPresets?: Record<CheckDifficulty, number>;

  /* ---- 角色面板 ---- */
  /**
   * 这套规则的角色卡长什么样（属性 / 资源 / 技能 / 派生项）。
   *
   * 省略表示「本规则不使用跑团面板」。有了它，角色卡编辑页与阅读器面板
   * 都能按规则书动态渲染，不必再为每套规则改前端。
   */
  sheetSchema?: SheetSchema;

  /* ---- 展示 ---- */
  /** Material Icons 名称，前端不必再维护一张映射表 */
  icon?: string;
  /** 注入系统提示的规则段落；插件自带，平台不再按 id 硬编码 */
  instructions?: string;
  /** 是否由插件文件加载（false/undefined = 平台内置） */
  external?: boolean;
  /** 插件来源文件（相对 content/），便于排障 */
  file?: string;
  /** 加载时的错误与警告 */
  errors?: string[];
  warnings?: string[];
}

/* ------------------------------------------------------------------ */
/* 战斗                                                                */
/* ------------------------------------------------------------------ */

export interface Combatant {
  id: ID;
  name: string;
  /** 对应房间成员（玩家）；NPC 为 null */
  memberId?: ID | null;
  dex: number;
  hp: number;
  hpMax: number;
  /** 先攻值（DEX + 小数） */
  initiative: number;
  majorWound: boolean;
  dying: boolean;
  unconscious: boolean;
  conditions: string[];
}

export interface CombatState {
  active: boolean;
  round: number;
  /** combatant id 的行动顺序 */
  order: ID[];
  turnIndex: number;
  combatants: Combatant[];
  log: string[];
}

/* ------------------------------------------------------------------ */
/* 能力（金手指）                                                       */
/* ------------------------------------------------------------------ */

export type AbilityKind = 'cheat' | 'skill' | 'talent' | 'item' | 'curse';

/** 能力的使用次数限制周期 */
export type AbilityRecharge = 'scene' | 'turn' | 'session';

export interface AbilityCost {
  san?: number;
  hp?: number;
  mp?: number;
  luck?: number;
  /** 其它资源的代价（新规则书用，如 `{ ac: 1 }`） */
  resource?: Record<string, number>;
}

export interface AbilityEffect {
  /** 检定加值：某技能 +N（负数为减值） */
  checkBonus?: { skill: string; value: number }[];
  /**
   * 属性临时加值。键是面板属性的数据键（COC 的 STR，或任意规则书声明的键）。
   */
  attributeBonus?: Record<string, number>;
  /** 自动获得的标记（进入世界线时写入 flags） */
  grantsFlags?: string[];
  /** 每次使用时的代价 */
  cost?: AbilityCost;
  /** 使用后一次性给予的标记 */
  onUseFlags?: string[];
  /** 使用后注入给模型的叙事提示 */
  onUseNarrative?: string;
}

export interface CharacterAbility {
  id: string;
  name: string;
  /** 类型：金手指 / 技能 / 天赋 / 物品 / 诅咒 */
  kind: AbilityKind;
  /** 一句话说明，展示在角色卡与阅读器 */
  description: string;
  /** 引擎可计算的效果 */
  effect: AbilityEffect;
  /** 使用次数限制 */
  uses?: {
    max: number;
    /** 何时恢复 */
    recharge: AbilityRecharge;
  };
  /** 已使用次数（运行时会被会话状态覆盖） */
  used?: number;
  /** 是否已解锁（未解锁不能在游戏中主动使用） */
  unlocked: boolean;
  /** 解锁条件描述（可选，由剧本或 GM 判定） */
  unlockHint?: string;
  /** 是否随继承带走（默认 true） */
  inheritable?: boolean;
}

/* ------------------------------------------------------------------ */
/* 继承（跨作品的剧情延续）                                             */
/* ------------------------------------------------------------------ */

/** 可以声明继承的字段 */
export type LegacyField =
  | 'abilities'
  | 'sheet'
  | 'relationships'
  | 'items'
  | 'flags'
  | 'vars'
  | 'summary';

export const LEGACY_FIELDS: LegacyField[] = [
  'abilities',
  'sheet',
  'relationships',
  'items',
  'flags',
  'vars',
  'summary',
];

export interface Relationship {
  /** 对象（NPC 名或角色卡 id） */
  target: string;
  /** 关系值：-100 敌对 ~ 100 亲密 */
  value: number;
  /** 关系描述，如「救命恩人」「杀父仇人」 */
  note?: string;
}

/** 一条世界线的结局存档，用于带进续作 */
export interface LegacySnapshot extends Timestamps {
  id: ID;
  /** 来源世界 */
  worldId: ID;
  worldTitle: string;
  /** 来源世界线 */
  sessionId: ID;
  sessionTitle: string;
  /** 角色 */
  characterId?: ID | null;
  characterName: string;
  /** 结局 */
  ending: {
    nodeId?: string;
    title?: string;
    /** 是否走到了结局节点 */
    reached: boolean;
  };
  /** 继承字段 */
  abilities: CharacterAbility[];
  sheet?: CocSheet;
  relationships: Relationship[];
  items: string[];
  flags: string[];
  vars: Record<string, unknown>;
  summary: string;
  /** 玩家在该世界线里的最终场景 */
  finalScene?: string;
}

/** 世界声明的继承规则 */
export interface InheritanceRule {
  /** 是否接受继承 */
  enabled: boolean;
  /** 接受哪些字段 */
  accepts: LegacyField[];
  /** 只接受这些世界（为空表示任意世界） */
  fromWorldIds?: ID[];
  /** 继承时对所有数值的缩放（0-1，用于「多年以后」衰减） */
  decay?: number;
  /** 注入提示词时的标题 */
  header?: string;
}

/* ------------------------------------------------------------------ */
/* 多人：房间与队伍                                                     */
/* ------------------------------------------------------------------ */

export type RoomRole = 'kp' | 'player' | 'spectator';
export type RoomStatus = 'lobby' | 'playing' | 'finished';

export interface PartyMember {
  id: ID;
  /** 房间内的显示名 */
  name: string;
  role: RoomRole;
  /** 绑定的角色卡 */
  characterId?: ID | null;
  /** 该成员的跑团面板（多人时每人一份） */
  sheet?: CocSheet;
  /** 成员能力（来自角色卡 + 继承） */
  abilities?: CharacterAbility[];
  /** 是否已准备 */
  ready: boolean;
  /** 是否被跳过回合 */
  skipped: boolean;
  /** 加入顺序，决定行动顺序 */
  seat: number;
  joinedAt: number;
  /** 最近活跃时间 */
  lastSeenAt?: number;
}

export interface Room extends Timestamps {
  id: ID;
  /** 6 位加入码，同局域网内输入即可加入 */
  code: string;
  worldId: ID;
  sessionId: ID;
  status: RoomStatus;
  /** 房主（通常是 KP） */
  hostMemberId: ID;
  members: PartyMember[];
  /** 当前轮到谁（memberId） */
  turnMemberId?: ID | null;
  /** 已完成回合数 */
  round: number;
  /** 是否按顺序轮流 */
  turnBased: boolean;
  /**
   * KP 由谁担任：
   *  human —— 房主当 KP，KP 的输入是「导演指令」，不占玩家回合
   *  ai    —— AI 当 KP，负责世界与 NPC，并尽量把故事拉长
   */
  kpMode?: 'human' | 'ai';
  /** 加入是否需要密码（局域网简易） */
  passcode?: string;
  /** 房间归属账号（创建者） */
  ownerId?: ID | null;
}

/** 房间广播事件（SSE） */
export type RoomEvent =
  | { type: 'room'; room: Room }
  | { type: 'message'; message: Message; session: Session }
  | { type: 'turn'; turnMemberId: ID | null; round: number }
  | { type: 'member'; member: PartyMember; action: 'join' | 'leave' | 'update' }
  | { type: 'notice'; text: string }
  | { type: 'stream'; text: string }
  | { type: 'error'; message: string };

/* ------------------------------------------------------------------ */
/* LLM 配置                                                            */
/* ------------------------------------------------------------------ */

export interface LlmConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  presencePenalty: number;
  frequencyPenalty: number;
  /** 我们这边组装提示词时的字符预算（旧字段，保留兼容） */
  contextBudget: number;
  /** 模型真实的上下文窗口（tokens）。7B 本地模型常见 4096/8192，云端常见 128k */
  contextWindow: number;
  /**
   * Ollama 的 num_ctx。走 `/api/chat` 原生协议时才生效，
   * OpenAI 兼容接口不接受这个参数（这是本地模型被静默截断的主因）。
   */
  numCtx?: number;
  /**
   * 关掉推理模型的思考链。Qwen3 / Qwen3.5 这类模型会把思考 token 算进
   * max_tokens，思考一长，JSON 就没机会写完 —— 表现为「输出被截断、没选项」。
   */
  disableThinking?: boolean;
  timeoutMs: number;
  extraHeaders?: string;
  extraBody?: string;
  stream: boolean;
}

export interface LlmConnectionTest {
  ok: boolean;
  message: string;
  models?: string[];
  latencyMs?: number;
}

/* ------------------------------------------------------------------ */
/* 流式协议                                                            */
/* ------------------------------------------------------------------ */

export type StreamEvent =
  | { type: 'start'; sessionId: ID; messageId: ID }
  | { type: 'token'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'rolls'; rolls: DiceRoll[] }
  | { type: 'checks'; checks: CheckResult[] }
  | { type: 'events'; events: EventFireRecord[] }
  | {
      type: 'ability';
      ability: { id: ID; name: string; kind: string };
      usesLeft: number | null;
      log: string;
    }
  | { type: 'choices'; choices: ScriptChoice[] }
  | { type: 'state'; state: SessionState }
  | { type: 'notice'; text: string }
  | { type: 'done'; message: Message; session: Session }
  | { type: 'error'; message: string };

/* ------------------------------------------------------------------ */
/* 请求体                                                              */
/* ------------------------------------------------------------------ */

export type ChatIntent = 'say' | 'action' | 'choice' | 'continue' | 'roll' | 'direct';

export interface ChatRequest {
  sessionId: ID;
  content: string;
  intent: ChatIntent;
  choiceId?: string;
  /** 手动掷骰 / 检定 */
  roll?: {
    formula?: string;
    skill?: string;
    difficulty?: CheckDifficulty;
    bonus?: number;
    push?: boolean;
    spendLuck?: number;
  };
  /** 多人：房间 id */
  roomId?: ID;
  /** 多人：行动者 memberId（决定用谁的说话人与面板） */
  memberId?: ID;
  /** 本回合使用的能力 id */
  useAbility?: ID;
  /** 模型给出的选项要跳转到的剧本节点（选项里带 next 时由前端带回） */
  goto?: string;
  /** 本团的 KP 由谁担任（由服务端按房间补齐） */
  kpMode?: 'human' | 'ai';
  /** 私密消息：只发给这个成员（KP 耳语） */
  privateTo?: ID;
}

export interface ListResult<T> {
  items: T[];
  total: number;
}

export interface WorldSummary {
  world: World;
  sessionCount: number;
  lastPlayedAt?: number;
}

/** 内容库巡检结果 */
export interface ContentHealth {
  worlds: number;
  characters: number;
  worldbooks: number;
  scripts: number;
  /** 已加载的规则包总数（内置 + 插件） */
  rulepacks: number;
  /** 其中来自 content/rulepacks 的插件数 */
  rulepackPlugins: number;
  errors: { file: string; message: string }[];
  warnings: { file: string; message: string }[];
}

