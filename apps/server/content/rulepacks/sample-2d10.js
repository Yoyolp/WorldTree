/**
 * 示例规则书插件：2d10 加总值体系（类似 PbtA）
 *
 * 放进 content/rulepacks/ 后，启动日志会显示「规则包 N（插件 1）」，
 * 世界编辑器的规则包列表里会多出一张卡。
 *
 * 这个文件演示三件事：
 *   1. 用内置策略（sum-compare）而不写任何掷骰代码
 *   2. 用 outcomeBands 自定义成功等级分档（10+ / 7-9 / 6-）
 *   3. 自带 icon 与 instructions，平台不需要为它改任何代码
 *
 * 删掉这个文件再重启，规则包就消失了（resetRulePacks 会回到内置四包）。
 */

export default {
  id: 'sample-2d10',
  name: '示例 · 2d10 加总值',
  description: '2d10 + 修正值 对比难度；10 以上完全成功，7-9 部分成功，6 以下失败。用于演示插件机制。',

  dieFaces: 10,
  strategy: 'sum-compare',
  strategyParams: {
    diceCount: 2,
    dieSides: 10,
    modifier: 0,
    // 难度：常规 10 / 困难 12 / 极难 14
    difficultyThreshold: 10,
    tiers: [
      { min: 10, outcome: 'regular' },
      { min: 7, outcome: 'hard' },
      { min: 0, outcome: 'fail' },
    ],
  },

  // 这套体系靠 tiers 分档，不需要平台再做难度折减
  difficulties: false,
  bonusPenalty: false,
  luckSpend: false,
  pushedRolls: false,
  autoCheck: true,
  failForward: true,
  sanity: false,
  combat: false,

  icon: 'casino',
  instructions: [
    '# 规则（2d10 加总值）',
    '- 检定掷 2d10 求和，与难度值比较，由系统完成。',
    '- 10 以上：完全成功；7-9：部分成功（做到了一部分，但有代价或新麻烦）；6 以下：失败但剧情继续。',
    '- 部分成功是这套系统的核心：写「你做到了，但……」。',
  ].join('\n'),
};
