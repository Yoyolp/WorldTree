/**
 * 生成《哈利·波特与密室》示例续作，用来验证「继承」功能：
 *   - 世界声明 inheritance，只接受来自 harry-potter-1 的存档
 *   - 剧本节点里有 requireLegacyFlag / requireAbility / requireRelationship 条件
 *
 * 用法：node tools/gen-hp2.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const CONTENT = join(process.cwd(), 'apps', 'server', 'content');

function write(rel, data) {
  const abs = join(CONTENT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, data, 'utf8');
  console.log(`✓ ${rel}`);
}

const script = `---
id: harry-potter-2
title: 哈利·波特与密室
start: ch01
rulePack: narrative
---

# 第一章 · 多比的警告 {id=ch01}

暑假的最后一周。女贞路四号，哈利的卧室窗户上装着铁栏杆。

一个家养小精灵坐在他的床上，耳朵像蝙蝠翅膀，眼睛有网球那么大。

「哈利·波特不能回霍格沃茨。」它说，「今年会有可怕的事情发生。」

::: director
这是续作的开场。如果玩家带着上一部的能力与关系进来，让多比也「知道」这些事——比如它听说过你干过什么。
:::

::: event 多比的警告 once chance=100%
小精灵用头撞墙，撞得砰砰响。「多比必须阻止哈利·波特回去！」
:::

- [问它到底有什么危险] -> ch02
- [直接拒绝，我要回学校] -> ch02

# 第二章 · 会飞的汽车 {id=ch02}

9¾ 站台的墙没有打开。哈利和罗恩撞在砖墙上，被弹了回来。

「我们得飞过去。」罗恩说。

::: on-enter
flag: 错过特快
:::

::: event 撞墙 once chance=100%
行李车撞在砖墙上，发出沉闷的响声。海德薇在笼子里尖叫。
- san: -1
:::

- [开走韦斯莱家的飞车] -> ch03
- [等猫头鹰送信求助] -> ch03

# 第三章 · 石化的猫 {id=ch03}

万圣节前夜。走廊的墙上用血写着：「密室已被打开，继承人的敌人，当心了。」

费尔奇夫人诺丽丝被吊在火把架上，全身僵硬。

::: on-enter
san: -2
flag: 见过石化
:::

::: event 血迹 once chance=100%
墙上的血还是湿的。哈利闻到了一股铁锈味。
:::

- [去找邓布利多] -> ch04
- [三人组自己查] -> ch04

# 第四章 · 决斗俱乐部 {id=ch04}

::: director
洛哈特主持的决斗俱乐部。这一段用来展示：上一部的关系会改变这里的态度。
:::

吉德罗·洛哈特站在台上，牙齿白得刺眼。「示范一下——」

斯内普走上台，魔杖在手里转了个圈。

::: event 蛇出现 once chance=100%
马尔福变出一条黑蛇。蛇直起身体，朝贾斯廷·芬列里游过去。
- flag: 见过决斗俱乐部
:::

- [说蛇佬腔，让蛇停下] -> ch05
- [站着不动] -> ch05
- [你与斯内普的关系让你本能地看向他] -> ch05s {require=rel:斯内普 min=-100}

# 第四章补 · 斯内普的眼神 {id=ch05s}

斯内普没有看蛇，他在看你。

::: director
如果玩家继承了与斯内普的关系，这里应该有个只有老玩家才懂的瞬间。
:::

- [继续] -> ch05

# 第五章 · 蛇佬腔 {id=ch05}

哈利听见自己嘴里发出嘶嘶声。黑蛇停了下来，转过头看他。

整间教室静得能听见蜡烛燃烧。

「你在说什么？」贾斯廷问。

::: on-enter
flag: 暴露蛇佬腔
:::

::: event 全场安静 once chance=100%
有人后退了一步。有人开始低声议论：「他会说蛇语……」
:::

- [如果你带着蛇佬腔这类能力，让它自然生效] -> ch06 {require=ability:蛇佬腔}
- [解释你不是继承人] -> ch06

# 第六章 · 里德尔的日记 {id=ch06}

一枚黑色的小本子落在盥洗室的地上。翻开它，字迹像在呼吸。

「我叫汤姆·里德尔。」

::: event 日记回应 once chance=100%
纸面上浮出一行字：「你好。你能看见我，说明你也很特别。」
- flag: 拿到日记
:::

- [问他密室的事] -> ch07

# 第七章 · 密室入口 {id=ch07}

桃金娘的盥洗室。水龙头上有条小蛇的刻痕。

哈利对着它发出嘶嘶声。水池沉下去，露出一条漆黑的管道。

::: on-enter
san: -2
:::

::: event 入口打开 once chance=100%
一股潮湿的、混着霉味的空气从管道里涌上来。
:::

- [滑下去] -> ch08

# 第八章 · 决战 {id=ch08}

密室深处。金妮躺在地上，脸色惨白。

一个黑头发的男孩站在她旁边，慢慢变成实体。「我是汤姆·里德尔。伏地魔的过去。」

::: on-enter
san: -4
flag: 面对里德尔
:::

::: event 福克斯到来 once chance=100%
一只火红的鸟从天花板飞下，嘴里衔着一顶旧帽子。剑就在帽子里。
:::

- [用蛇牙刺穿日记] -> end
- [你曾与伏地魔正面交锋过，你不害怕] -> end {require=legacy:面对伏地魔}

# 结局 · 密室关闭 {id=end ending=密室关闭}

日记本被刺穿，墨水像血一样从纸页里涌出来。

金妮醒了。哈利用袖子擦掉她脸上的灰。

—— 第二学年完 ——
`;

const world = {
  id: 'harry-potter-2',
  title: '哈利·波特与密室',
  subtitle: '第二学年 · 续作 / 支持继承',
  description:
    '续作示例：它声明接受来自《哈利·波特与魔法石》的结局存档。带着上一部的能力、人际关系和关键选择进入二年级，剧情会因为你的过去而改变。',
  coverIcon: 'menu_book',
  coverColor: '#3c5a6e',
  tags: ['哈利波特', '续作', '继承', '测试'],
  author: '世界树示例',
  mode: 'script',
  rulePackId: 'narrative',
  opening:
    '暑假的最后一周。女贞路四号。\n\n你的窗户上装着铁栏杆，一个家养小精灵坐在你的床上。\n\n「哈利·波特不能回霍格沃茨。」它说。',
  setting: `1992 年的英国，霍格沃茨第二学年。

主线：密室被打开，学生不断被石化，哈利发现自己是蛇佬腔，被怀疑是斯莱特林的继承人，最终在密室中面对伏地魔的少年形态汤姆·里德尔。

如果你是从《魔法石》继承过来的角色，这个世界会记住你上一部做过什么：你与谁成了朋友或敌人、你有没有面对过伏地魔、你拥有哪些能力。`,
  rules: {
    style: '英式童话奇幻，比第一部更阴暗一些，但仍保留校园幽默。',
    directives: [
      '严格跟着剧情节拍走，不要提前跳到后面的章节。',
      '如果玩家带着上一部的继承数据，请让这些过去自然生效，不要当作没发生过。',
      '不要把洛哈特写得可爱——他是骗子，但要写得可笑。',
    ],
    allowFreeInput: true,
    choiceCount: 2,
    autoAdvance: false,
    autoCheck: false,
    failForward: true,
  },
  worldBookId: 'harry-potter-1',
  characterIds: [],
  scriptFile: 'scripts/harry-potter-2.md',
  systemPromptOverride:
    '这是《哈利·波特与魔法石》的续作。玩家扮演哈利·波特，现在二年级。请用第三人称有限视角叙述。',
  inheritance: {
    enabled: true,
    accepts: ['abilities', 'relationships', 'flags', 'items', 'summary'],
    fromWorldIds: ['harry-potter-1'],
    decay: 1,
    header: '二年级 · 你从上一部带回来的东西',
  },
};

write('scripts/harry-potter-2.md', script);
write('worlds/harry-potter-2.json', JSON.stringify(world, null, 2));

console.log(`\n节点：${(script.match(/^# /gm) || []).length}`);
