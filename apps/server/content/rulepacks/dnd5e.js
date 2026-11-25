/**
 * 世界树 · 规则书插件示例：D&D 5e（简化版）
 *
 * 这个文件演示「加一本新规则书 = 加一个文件」：
 *
 *   - `strategy` + `strategyParams`  怎么判定
 *   - `sheetSchema`                  角色卡面板长什么样（属性/资源/技能/派生）
 *   - `icon` / `instructions`        前端图标与注入提示词的规则段落
 *
 * 放到 content/rulepacks/ 下，重启或点一次「同步内容」就会出现在规则书列表里。
 *
 * 判定说明：D&D 5e 原文是「d20 + 调整值 ≥ 难度(DC)」，属于「越大越好」。
 * 平台的 d20-threshold 是「d20 ≤ 目标」，方向相反，所以这里不用它，
 * 而是用 sum-compare 加 tiers 表达：
 *
 *   掷 1d20 + 调整值，≥ 15 极难成功 / ≥ 12 困难成功 / ≥ 8 成功 / 其余失败
 *
 * 「难度」由策略参数里的 difficultyThreshold 表示。这样既不骗平台，
 * 也不需要为它单独写一个策略。
 */

/** 属性调整值 = floor((属性-10)/2)，D&D 的核心公式 */
const mod = (key) => `floor((${key}-10)/2)`;

export default {
  id: 'dnd5e',
  name: '龙与地下城 5e（简化）',
  description:
    '六属性（力/敏/体/智/感/魅）+ 熟练加值，d20 + 调整值对抗 DC。' +
    '含 HP / AC / 法术位，支持短休与长休。这是一份可直接跑的简化实现，不是完整 PHB。',
  dieFaces: 20,

  /* ---- 判定 ---- */
  strategy: 'sum-compare',
  strategyParams: {
    diceCount: 1,
    dieSides: 20,
    // 调整值由技能值/能力提供，这里不固定
    modifier: 0,
    // D&D 的 DC：常规 10 / 困难 15 / 极难 20
    difficultyThresholds: { regular: 10, hard: 15, extreme: 20 },
    // 天然 20 大成功、天然 1 大失败
    criticalOn: 20,
    fumbleOn: 1,
  },
  criticalValue: 20,
  fumbleValue: 1,
  difficulties: true,
  bonusPenalty: true,
  luckSpend: false,
  pushedRolls: false,
  autoCheck: true,
  failForward: true,
  sanity: false,
  combat: true,
  initiativeAttribute: 'DEX',
  icon: 'swords',

  /* ---- 角色面板 ---- */
  sheetSchema: {
    label: 'D&D 5e 冒险者',
    attrLabel: '属性',
    resourceLabel: '状态',
    skillLabel: '技能（点击检定）',
    groups: ['身体', '心智', '社交'],

    attributes: [
      { key: 'STR', label: '力量', abbr: 'STR', min: 1, max: 30, default: 10, roll: '4d6', group: '身体', hint: '影响近战攻击与负重' },
      { key: 'DEX', label: '敏捷', abbr: 'DEX', min: 1, max: 30, default: 10, roll: '4d6', group: '身体', hint: '影响先攻、AC 与远程攻击' },
      { key: 'CON', label: '体质', abbr: 'CON', min: 1, max: 30, default: 10, roll: '4d6', group: '身体', hint: '影响 HP 与专注' },
      { key: 'INT', label: '智力', abbr: 'INT', min: 1, max: 30, default: 10, roll: '4d6', group: '心智', hint: '影响奥秘、历史、调查' },
      { key: 'WIS', label: '感知', abbr: 'WIS', min: 1, max: 30, default: 10, roll: '4d6', group: '心智', hint: '影响察觉、洞察、求生' },
      { key: 'CHA', label: '魅力', abbr: 'CHA', min: 1, max: 30, default: 10, roll: '4d6', group: '社交', hint: '影响说服、欺瞒、威吓' },
    ],

    resources: [
      { key: 'hp', label: 'HP', maxFormula: '10 + floor((CON-10)/2) * 2', color: '#b03a2e', dangerRatio: 0.3 },
      { key: 'ac', label: 'AC', initFormula: '10 + floor((DEX-10)/2)', bar: false, hint: '护甲等级' },
      { key: 'spell1', label: '一环法术位', maxFormula: '2', color: '#2e6db0', dangerRatio: 0.5 },
    ],

    skills: [
      {
        key: '运动', label: '运动', baseFormula: '10 + floor((STR-10)/2)', attribute: 'STR', group: '身体',
        tags: ['身体'],
        description: '攀爬、跳跃、游泳、推拉重物。',
        effectText: '用于克服物理障碍：翻墙、过河、掰开铁栅栏、在颠簸的甲板上站稳。\n\n- 成功：动作完成，不受伤。\n- 失败：可以重来，但每多试一次就多一分动静被听见。',
        examples: ['攀上城堡外墙', '在暴风雨中稳住船舵', '推倒一尊石像'],
      },
      {
        key: '体操', label: '体操', baseFormula: '10 + floor((DEX-10)/2)', attribute: 'DEX', group: '身体',
        tags: ['身体', '敏捷'],
        description: '平衡、翻滚、脱身、杂技动作。',
        effectText: '用于敏捷与身体控制。被擒抱时用它脱身，走窄梁时用它保持平衡。\n\n- 成功：干净完成，可继续行动。\n- 失败：摔倒或失去一个动作，姿态暴露。',
        examples: ['从二楼翻窗落地', '在铁索上走过深渊', '挣脱巨蛇的缠绕'],
      },
      {
        key: '隐匿', label: '隐匿', baseFormula: '10 + floor((DEX-10)/2)', attribute: 'DEX', group: '身体',
        tags: ['身体', '潜行'],
        description: '躲藏、潜行、不被察觉。',
        effectText: '用于避免被发现。通常与对方的**察觉**对抗。\n\n- 成功：对方没有发现你，你可以继续观察或偷袭。\n- 失败：你被发现，或者只争取到一瞬的犹豫。',
        examples: ['混进夜市的人群', '在哨兵背后潜行', '藏进装满粮袋的马车'],
      },
      {
        key: '奥秘', label: '奥秘', baseFormula: '10 + floor((INT-10)/2)', attribute: 'INT', group: '知识',
        tags: ['知识'],
        description: '辨认法术、魔法物品、异界生物与古老符号。',
        effectText: '用于识别「这是什么、它大概怎么运作」。\n\n- 成功：你知道它的名称、常见用途，以及一条已知的危险。\n- 失败：你只看出它有魔力，具体细节需要实验或找人问。',
        examples: ['辨认门上的符文', '判断一瓶药水的作用', '回忆某个恶魔的弱点'],
      },
      {
        key: '历史', label: '历史', baseFormula: '10 + floor((INT-10)/2)', attribute: 'INT', group: '知识',
        tags: ['知识'],
        description: '回忆王国、战争、家族与遗迹的往事。',
        effectText: '用于从「过去」里挖出有用的东西。\n\n- 成功：你记得一段相关的史实，可能包含人名、地点或一句预言。\n- 失败：你只知道泛泛的传说，真假难辨。',
        examples: ['这座塔是谁建的', '两个家族为何世仇', '古战场上埋了什么'],
      },
      {
        key: '调查', label: '调查', baseFormula: '10 + floor((INT-10)/2)', attribute: 'INT', group: '知识',
        tags: ['知识', '推理'],
        description: '搜查现场、推演线索、发现隐藏细节。',
        effectText: '用于「主动去找」。和**察觉**的区别是：察觉是被动注意到，调查是有目的地翻找。\n\n- 成功：你找到那条关键线索。\n- 失败：你找到一些东西，但需要别的手段才能读懂它。',
        examples: ['搜查书房找密信', '检查尸体上的伤口', '推敲密室的机关在哪'],
      },
      {
        key: '察觉', label: '察觉', baseFormula: '10 + floor((WIS-10)/2)', attribute: 'WIS', group: '感知',
        tags: ['感知'],
        description: '被动注意周围：声响、气味、视线、埋伏。',
        effectText: '用于「有没有注意到」。常与对方的**隐匿**对抗。\n\n- 成功：你察觉到异常，可以先一步反应。\n- 失败：你错过它，直到它主动找上你。',
        examples: ['听见走廊尽头的脚步', '发现树丛后的反光', '闻到空气里的血腥味'],
      },
      {
        key: '洞悉', label: '洞悉', baseFormula: '10 + floor((WIS-10)/2)', attribute: 'WIS', group: '感知',
        tags: ['感知', '社交'],
        description: '看穿谎言、动机与情绪。',
        effectText: '用于读人。和**欺瞒**对抗。\n\n- 成功：你知道对方在隐瞒什么方向，或者他真正想要什么。\n- 失败：你只能确定「他不太对劲」，但说不出哪里不对。',
        examples: ['判断商人是否在抬价', '看出贵族在害怕什么', '听出告密者的迟疑'],
      },
      {
        key: '求生', label: '求生', baseFormula: '10 + floor((WIS-10)/2)', attribute: 'WIS', group: '感知',
        tags: ['感知', '野外'],
        description: '追踪、辨向、觅食、读懂天气与野兽痕迹。',
        effectText: '用于荒野与追踪。\n\n- 成功：你找到方向、水源或足迹的走向。\n- 失败：你多花了半天，或者走进了一片更糟的地形。',
        examples: ['追踪逃犯的足迹', '在雾里辨认北方', '判断今晚会不会下雪'],
      },
      {
        key: '游说', label: '游说', baseFormula: '10 + floor((CHA-10)/2)', attribute: 'CHA', group: '社交',
        tags: ['社交'],
        description: '以道理与诚意说服他人。',
        effectText: '用于「让对方愿意」。适合有共同利益、或对方尚可沟通时。\n\n- 成功：对方答应，或至少愿意听你讲完。\n- 失败：对方拒绝，且可能提高要价。',
        examples: ['劝守卫放行', '和商会谈一笔生意', '说服村民撤离'],
      },
      {
        key: '欺瞒', label: '欺瞒', baseFormula: '10 + floor((CHA-10)/2)', attribute: 'CHA', group: '社交',
        tags: ['社交', '谎言'],
        description: '说谎、伪装身份、蒙混过关。',
        effectText: '用于「让对方相信假的」。和**洞悉**对抗。\n\n- 成功：对方信了，但谎言一旦被戳破，代价会比一开始就坦白更高。\n- 失败：对方起疑，你得马上想办法圆回来。',
        examples: ['冒充商队的人混进城', '对税吏谎报货量', '假装自己是占卜师'],
      },
      {
        key: '威吓', label: '威吓', baseFormula: '10 + floor((CHA-10)/2)', attribute: 'CHA', group: '社交',
        tags: ['社交', '胁迫'],
        description: '用气势、威胁或暴力暗示逼迫对方就范。',
        effectText: '用于「让对方不敢」。\n\n- 成功：对方退让或交代，但**态度会变差** —— 之后可能报复或告发。\n- 失败：对方不吃这一套，场面直接僵住甚至动手。',
        examples: ['逼问被抓的盗贼', '让债主再宽限三天', '喝退一群街头混混'],
      },
    ],
    freeSkills: true,
    skillMax: 40,

    derived: [
      { key: 'STRmod', label: '力量调整', formula: mod('STR') },
      { key: 'DEXmod', label: '敏捷调整', formula: mod('DEX') },
      { key: 'CONmod', label: '体质调整', formula: mod('CON') },
      { key: 'INTmod', label: '智力调整', formula: mod('INT') },
      { key: 'WISmod', label: '感知调整', formula: mod('WIS') },
      { key: 'CHAmod', label: '魅力调整', formula: mod('CHA') },
      { key: 'proficiency', label: '熟练加值', formula: '2', hint: '1-4 级固定 +2' },
      { key: 'passivePerception', label: '被动察觉', formula: '10 + floor((WIS-10)/2)' },
    ],
  },

  instructions: [
    '# 规则（龙与地下城 5e · 简化）',
    '这是一套跑团规则：角色有六项属性，行动结果由 d20 加调整值对抗难度决定。数值是骨架，具体发生什么由叙事填充。',
    '- 判定：掷 1d20 + 属性调整值（floor((属性-10)/2)），结果对抗难度 DC。',
    '- DC 参考：容易 10、中等 15、困难 20、极难 25。由系统掷骰，你只给出要检定什么属性/技能。',
    '- 近战攻击用力量，远程与先攻用敏捷；施法用对应施法属性。',
    '- HP 归零即倒地濒死，需要三次死亡豁免或队友救助。',
    '- 失败也要推进故事：给出新的线索、代价或麻烦，不要写成死路。',
    '- 描写要具体：剑刃的角度、魔法的颜色与温度、地城的潮湿气味。',
  ].join('\n'),
};
