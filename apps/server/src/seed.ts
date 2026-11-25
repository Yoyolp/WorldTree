import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_DIR, CONTENT_SUBDIRS } from './env.js';

/**
 * 示例内容的源文件生成器。
 *
 * content/ 目录是唯一真源；这里只在「目录里一个文件都没有」时写入示例，
 * 之后所有编辑都直接改文件，不再覆盖。
 */

const FILES: Record<string, string> = {};

/* ------------------------------------------------------------------ */
/* 世界书：灰潮                                                         */
/* ------------------------------------------------------------------ */

FILES['worldbooks/gray-tide.json'] = JSON.stringify(
  {
    id: 'gray-tide',
    name: '灰潮 · 世界书',
    description: '港口城市「雾岬」的设定集：地理、组织、禁忌与旧神低语。',
    scanDepth: 8,
    tokenBudget: 5000,
    recursiveScanning: false,
    entries: [
      {
        id: 'entry_wumaa',
        comment: '雾岬港',
        keys: ['雾岬', '港口', '码头', '雾'],
        secondaryKeys: [],
        selective: true,
        selectiveLogic: 'and',
        constant: true,
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
        maxChars: 0,
        enabled: true,
        content:
          '雾岬是一座终年被灰白色海雾笼罩的港口城市。城市沿陡峭的悬崖层级而建，最下层是永远潮湿的旧码头，最上层是被称作「钟楼区」的富人宅邸。雾里会传来不属于任何船只的汽笛声。当地人相信：雾起时不要回应任何呼喊你名字的声音。',
      },
      {
        id: 'entry_harbor_master',
        comment: '港务长 韩叙',
        keys: ['港务长', '韩叙', '档案室'],
        secondaryKeys: [],
        selective: true,
        selectiveLogic: 'and',
        constant: false,
        caseSensitive: false,
        useRegex: false,
        matchWholeWords: false,
        priority: 80,
        insertionOrder: 1,
        position: 'before_char',
        depth: 0,
        probability: 100,
        useProbability: false,
        group: '',
        cooldown: 0,
        sticky: 0,
        maxChars: 0,
        enabled: true,
        content:
          '韩叙，五十七岁，港务长。左眼是浑浊的玻璃义眼。他保管着 1927 年那次「大退潮」的全部航运档案，但对外只承认那年「什么都没发生」。他习惯用指节敲桌面三下再开口。若玩家出示与失踪货轮「白鸢号」有关的证据，他会动摇。',
      },
      {
        id: 'entry_whiteswan',
        comment: '白鸢号',
        keys: ['白鸢号', '货轮', '失踪船'],
        secondaryKeys: [],
        selective: true,
        selectiveLogic: 'and',
        constant: false,
        caseSensitive: false,
        useRegex: false,
        matchWholeWords: false,
        priority: 90,
        insertionOrder: 2,
        position: 'before_char',
        depth: 0,
        probability: 100,
        useProbability: false,
        group: '',
        cooldown: 0,
        sticky: 0,
        maxChars: 0,
        enabled: true,
        content:
          '白鸢号，一艘载重两千吨的旧货轮，二十七年前在雾岬外海失踪，官方记录称「遭遇风暴全员罹难」。实际上它每七年会短暂地重新出现在海图上同一个坐标，船身没有锈迹，甲板上堆着从未卸下的货箱。货箱里装着数百枚刻有螺旋纹的铅制哨子。',
      },
      {
        id: 'entry_whistle',
        comment: '铅哨',
        keys: ['铅哨', '哨子', '螺旋纹'],
        secondaryKeys: [],
        selective: true,
        selectiveLogic: 'and',
        constant: false,
        caseSensitive: false,
        useRegex: false,
        matchWholeWords: false,
        priority: 70,
        insertionOrder: 3,
        position: 'before_char',
        depth: 0,
        probability: 100,
        useProbability: false,
        group: '',
        cooldown: 0,
        sticky: 0,
        maxChars: 0,
        enabled: true,
        content:
          '铅哨：巴掌大的铅制哨子，表面铸有向内旋转的螺旋纹。吹响时人耳听不见声音，但三公里内的海鸟会同时坠落。持有者每晚做梦，梦的内容逐日变得更接近「海底的走廊」。吹响三次的人不会再有第四次——因为吹第三次时，回声会先于人返回。',
      },
      {
        id: 'entry_tidecult',
        comment: '退潮会',
        keys: ['退潮会', '教徒', '仪式', '教团'],
        secondaryKeys: [],
        selective: true,
        selectiveLogic: 'and',
        constant: false,
        caseSensitive: false,
        useRegex: false,
        matchWholeWords: false,
        priority: 85,
        insertionOrder: 4,
        position: 'before_char',
        depth: 0,
        probability: 100,
        useProbability: false,
        group: '',
        cooldown: 0,
        sticky: 0,
        maxChars: 0,
        enabled: true,
        content:
          '退潮会：雾岬地下流传的教团，成员多为渔民与码头工人。他们相信海雾是「沉睡者」的呼吸，而每一次退潮都是它在翻身。集会地点在旧码头 7 号仓库下方，入口被水淹没，只在退潮的两小时内露出。教徒在集会时全体背诵一段无法被记录的祷词——任何录音设备都会只录到海浪声。',
      },
      {
        id: 'entry_sanrule',
        comment: '理智与雾',
        keys: ['直视', '不可名状', '低语'],
        secondaryKeys: [],
        selective: true,
        selectiveLogic: 'and',
        constant: false,
        caseSensitive: false,
        useRegex: false,
        matchWholeWords: false,
        priority: 60,
        insertionOrder: 5,
        position: 'after_char',
        depth: 0,
        probability: 100,
        useProbability: false,
        group: '',
        cooldown: 0,
        sticky: 0,
        maxChars: 0,
        enabled: true,
        content:
          '规则：任何角色在雾中直视「沉睡者」的形体，损失 1d10 点理智；听到完整的祷词，损失 1d6 点理智；触碰铅哨并吹响，损失 1d3 点理智。理智归零者不会死亡，而是会自愿走入海中，成为「回声」的一部分。',
      },
    ],
  },
  null,
  2,
);

/* ------------------------------------------------------------------ */
/* 世界书：图书馆                                                       */
/* ------------------------------------------------------------------ */

FILES['worldbooks/night-library.json'] = JSON.stringify(
  {
    id: 'night-library',
    name: '夜航图书馆 · 世界书',
    description: '馆内规则、管理员与那些「尚未完成」的书。',
    scanDepth: 6,
    tokenBudget: 3500,
    recursiveScanning: false,
    entries: [
      {
        id: 'entry_rules',
        comment: '图书馆规则',
        keys: ['图书馆', '规则', '借阅', '管理员'],
        secondaryKeys: [],
        selective: true,
        selectiveLogic: 'and',
        constant: true,
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
        maxChars: 0,
        enabled: true,
        content:
          '夜航图书馆规则：\n1. 只在雨夜出现，雨停即消失。馆内的钟永远停在 23:47。\n2. 书可以读，不可带走。试图带出时，书会变成一捧潮湿的灰。\n3. 读完一本，读者会遗忘一段与之等重的记忆——通常是自己都未必察觉的那种。\n4. 在馆内写下自己的故事，那本书会留下，而写作者成为新的管理员。',
      },
      {
        id: 'entry_admin',
        comment: '管理员',
        keys: ['老人', '管理员', '第一个读者'],
        secondaryKeys: [],
        selective: true,
        selectiveLogic: 'and',
        constant: false,
        caseSensitive: false,
        useRegex: false,
        matchWholeWords: false,
        priority: 80,
        insertionOrder: 1,
        position: 'before_char',
        depth: 0,
        probability: 100,
        useProbability: false,
        group: '',
        cooldown: 0,
        sticky: 0,
        maxChars: 0,
        enabled: true,
        content:
          '管理员：男性，约七十岁，穿灰色开衫，说话时会停下来听雨。他自称「第一个读者」。他记得馆里每一本书的位置，却记不清自己的名字。他并不阻止任何人写下故事，但会在你说出「我想留在这里」时，第一次真正地看你。',
      },
      {
        id: 'entry_books',
        comment: '那些书',
        keys: ['书', '书架', '借书'],
        secondaryKeys: [],
        selective: true,
        selectiveLogic: 'and',
        constant: false,
        caseSensitive: false,
        useRegex: false,
        matchWholeWords: false,
        priority: 60,
        insertionOrder: 2,
        position: 'before_char',
        depth: 0,
        probability: 100,
        useProbability: false,
        group: '',
        cooldown: 0,
        sticky: 0,
        maxChars: 0,
        enabled: true,
        content:
          '馆内的书没有封面标题，只有书脊上的一行小字，写着某个人的名字与一个年份。翻开任何一本，都会读到一段极为具体的、属于陌生人的生活片段。有些书只有一页，有些书厚得需要两个人才能抬起。',
      },
    ],
  },
  null,
  2,
);

/* ------------------------------------------------------------------ */
/* 角色卡                                                              */
/* ------------------------------------------------------------------ */

const cocSheet = {
  attributes: { STR: 50, CON: 55, SIZ: 60, DEX: 65, APP: 45, INT: 75, POW: 60, EDU: 80, LUCK: 55 },
  skills: [
    { name: '侦查', value: 60, category: '探索' },
    { name: '聆听', value: 45, category: '探索' },
    { name: '图书馆使用', value: 70, category: '知识' },
    { name: '心理学', value: 40, category: '社交' },
    { name: '潜行', value: 30, category: '行动' },
    { name: '闪避', value: 42, category: '行动' },
    { name: '急救', value: 35, category: '知识' },
    { name: '神秘学', value: 25, category: '知识' },
    { name: '母语', value: 80, category: '语言' },
    { name: '克苏鲁神话', value: 8, category: '禁忌' },
  ],
  hp: 11,
  hpMax: 11,
  mp: 12,
  mpMax: 12,
  san: 60,
  sanMax: 60,
  luck: 55,
  luckMax: 99,
  conditions: [],
  items: ['老式黄铜怀表', '记者证', '半盒火柴', '拍立得相机（剩 3 张）'],
  backstory: '二十七岁，《雾岬晨报》的次席记者。三年前从省城调来，本来只想混两年资历。',
  ideology: '真相值得被写下来，哪怕没有人愿意读。',
  significantPeople: '主编老周——唯一没有放弃他的报道的人。',
  meaningfulPlaces: '省城那间朝北的出租屋。',
  treasuredPossessions: '父亲留下的黄铜怀表。',
  traits: '嘴上玩世不恭，其实极度害怕被看穿。',
  injuries: '',
  phobias: '',
};

FILES['characters/lin-yan.json'] = JSON.stringify(
  {
    id: 'lin-yan',
    spec: 'chara_card_v2',
    specVersion: '2.0',
    name: '林砚',
    description:
      '二十七岁，《雾岬晨报》的次席记者。三年前从省城调来，本来只想混两年资历，却因为一篇关于失踪渔船的报道被主编冷藏，从此对这座城市起了执念。',
    personality: '嘴上玩世不恭，其实极度害怕被人看穿自己在意什么。习惯用玩笑掩饰紧张，在真正恐惧时反而会变得非常安静。',
    scenario: '受一封匿名信邀请，深夜抵达雾岬旧码头 7 号仓库。信上只有一句话：「白鸢号今晚会回来。」',
    firstMes: '「……所以，有人愿意解释一下为什么整座码头的钟都在同一分钟停了吗？」',
    mesExample:
      '记者：「我不信鬼，但我信证据。而证据现在正站在我面前，还在滴水。」\n记者（低声）：「好，我数到三。一，二——」',
    creatorNotes: '示例角色，玩家扮演。',
    systemPrompt: '林砚是玩家扮演的主角。他的台词要短、带着干涩的自嘲。不要替他说出超过一句的内心独白。',
    postHistoryInstructions: '',
    alternateGreetings: ['「我不太喜欢雾。它让人看不清自己站在哪里。」'],
    tags: ['调查员', '记者', '主角'],
    creator: '世界树示例',
    characterVersion: '1.0',
    extensions: {},
    characterBookId: null,
    avatarIcon: 'newspaper',
    avatarColor: '#3f5b6b',
    isPlayer: true,
    sheet: cocSheet,
  },
  null,
  2,
);

FILES['characters/han-xu.json'] = JSON.stringify(
  {
    id: 'han-xu',
    spec: 'chara_card_v2',
    specVersion: '2.0',
    name: '韩叙',
    description: '五十七岁，港务长，左眼是玻璃义眼。二十七年前「大退潮」唯一的官方见证人。',
    personality: '沉默，近乎粗暴。用敲桌子的次数代替语气。对任何提起「白鸢号」的人先是敌意，然后是疲惫的坦白。',
    scenario: '夜里独自留在港务局档案室，桌上摊着一本不该存在的旧航海日志。',
    firstMes: '（指节在桌面上敲了三下）「这里没人。你要问什么，趁我还没改主意。」',
    mesExample: '韩叙：「那年退潮，海床露出来了两公里。」他停了一下，「海床上没有沙。」',
    creatorNotes: '',
    systemPrompt: '韩叙从不说完整的往事，每次只给一小块，并且会先否认一次。',
    postHistoryInstructions: '',
    alternateGreetings: [],
    tags: ['NPC', '知情者'],
    creator: '世界树示例',
    characterVersion: '1.0',
    extensions: {},
    characterBookId: null,
    avatarIcon: 'badge',
    avatarColor: '#5a4a3a',
    isPlayer: false,
  },
  null,
  2,
);

FILES['characters/echo-girl.json'] = JSON.stringify(
  {
    id: 'echo-girl',
    spec: 'chara_card_v2',
    specVersion: '2.0',
    name: '回声少女',
    description:
      '一个看起来十六七岁的女孩，穿着的湿透的旧式连衣裙，赤脚，脚上总是沾着海草。她说话时会有一点点延迟，像隔着一层水。',
    personality: '温柔、好奇，对「上岸」这件事有着孩子气的兴奋，但对任何关于她来历的问题都会笑着绕开。',
    scenario: '在旧码头尽头出现，似乎在等一个她认识但玩家不认识的人。',
    firstMes: '（她歪了歪头，水珠从发梢滴落）「你比上一次来得早。」',
    mesExample: '「嘘——你听见了吗？海在数数。它数到七就会停下来。」',
    creatorNotes: '',
    systemPrompt: '回声少女的台词要像从很远的地方传来。她知道很多，但从不直接回答。',
    postHistoryInstructions: '',
    alternateGreetings: [],
    tags: ['NPC', '神秘'],
    creator: '世界树示例',
    characterVersion: '1.0',
    extensions: {},
    characterBookId: null,
    avatarIcon: 'water',
    avatarColor: '#3a5a7a',
    isPlayer: false,
  },
  null,
  2,
);

FILES['characters/gu-ruo.json'] = JSON.stringify(
  {
    id: 'gu-ruo',
    spec: 'chara_card_v2',
    specVersion: '2.0',
    name: '顾箬',
    description: '经营「灰鸥旧书店」，收藏了大量关于雾岬地方史的手抄本。半年前开始参加退潮会的集会，现在后悔了。',
    personality: '神经质、语速极快，一紧张就开始背诵书目编号。本质上是个善良的胆小鬼。',
    scenario: '在书店后间点着煤油灯，把所有门窗都反锁了。',
    firstMes: '「别开灯！……抱歉。灯一亮，它们就知道这里有人。」',
    mesExample: '「编号 M-114 到 M-119，全都在讲同一件事，全都在第七页被撕掉了。你觉得这是巧合吗？」',
    creatorNotes: '',
    systemPrompt: '顾箬提供线索时会夹杂大量无用的书目细节，玩家需要从中挑出关键。',
    postHistoryInstructions: '',
    alternateGreetings: [],
    tags: ['NPC', '线索'],
    creator: '世界树示例',
    characterVersion: '1.0',
    extensions: {},
    characterBookId: null,
    avatarIcon: 'menu_book',
    avatarColor: '#6b5b3a',
    isPlayer: false,
  },
  null,
  2,
);

FILES['characters/librarian.json'] = JSON.stringify(
  {
    id: 'librarian',
    spec: 'chara_card_v2',
    specVersion: '2.0',
    name: '灰衣管理员',
    description: '夜航图书馆的管理员，约七十岁。他说自己是第一个读者，也记不清自己原本的名字。',
    personality: '温和、慢，习惯用问题回答问题。从不催促，也从不挽留。',
    scenario: '在柜台后擦拭一盏铜灯，雨声很大。',
    firstMes:
      '「进来吧，外面雨大。」老人没有抬头，「书都在左边，你自己找。找不到也没关系——有些书还没决定要不要被找到。」',
    mesExample: '「你记得今天早上出门时，先迈的是哪只脚吗？」他笑了笑，「想不起来了？那本书大概就是那时候走的。」',
    creatorNotes: '',
    systemPrompt: '管理员永远不直接回答问题，而是回问一个更小、更具体的问题。',
    postHistoryInstructions: '',
    alternateGreetings: [],
    tags: ['NPC', '管理员'],
    creator: '世界树示例',
    characterVersion: '1.0',
    extensions: {},
    characterBookId: 'night-library',
    avatarIcon: 'local_library',
    avatarColor: '#4f6f52',
    isPlayer: false,
  },
  null,
  2,
);

/* ------------------------------------------------------------------ */
/* 剧本：末班列车（Markdown DSL）                                       */
/* ------------------------------------------------------------------ */

FILES['scripts/last-train.md'] = `---
id: last-train
title: 末班列车
start: car1
rulePack: coc7
---

# 第一节车厢 · 广播 {id=car1}

列车晃了一下，你从座位上惊醒。

车厢里空无一人。灯管在头顶发出细微的电流声。窗外没有城市，只有一片望不到边的雪原，和被雪覆盖的铁轨——它们在前方分岔，又分岔。

广播响了：「各位乘客，本次列车不设终点站。请在每一次停车前，做出选择。」

::: director
建立诡异但不恐怖的气氛，强调广播声音的不自然。不要提前揭示列车员身份。
:::

::: event 第一次广播 chance=100% once
广播里混进了一个不属于广播员的笑声，短促、克制。
- san: -1
:::

- [留在原地，观察车厢] -> seat {flag=谨慎} {check=侦查 常规}
- [走向第三节车厢] -> car3 {flag=好奇 var:车厢=3}
- [试着拉开车门] -> door {flag=鲁莽 san=-1d3}

# 座位下 {id=seat}

你退回座位。灯管闪了一下，你注意到座位底下有个旧皮箱，锁扣已经锈蚀。

哭声停了。整列车安静得只剩下铁轨的节拍。

::: event 皮箱低语 chance=40% cooldown=2
皮箱里传来极轻的、有节奏的敲击，像有人在里面用手指记数。
:::

- [打开皮箱] -> ticket {flag=开箱}
- [继续等，什么都不碰] -> stop7

# 第三节车厢 · 哭泣的人 {id=car3}

第三节车厢的门是开着的。一个穿旧制服的小女孩坐在窗边，抱着一个没有脸的布偶。

她抬头看你：「你也是被选中的吗？」

::: event 女孩的数数 chance=50% cooldown=3
女孩开始低声数数。你数到七的时候，她停了，然后重新从一开始。
- when: flag=好奇
:::

- [蹲下问她名字] -> girl {flag=交谈}
- [检查她怀里的布偶] -> doll {flag=布偶 san=-2}
- [继续往第四节走] -> car4

# 车门 · 雪原 {id=door}

你把手搭在门把上。金属冷得像冰。门开了一条缝，风灌进来，雪粒打在脸上——然后你听见，雪原深处有人在念你的名字。

你赶紧把门关上。手在抖。

::: on-enter
san: -2
:::

- [回到座位，冷静下来] -> seat
- [再开一次，这次听清它说什么] -> voice {flag=听清 san=-5}

# 车票 {id=ticket}

皮箱里只有一张车票，票面写着你的名字，日期是——今天。

背面有一行铅笔字：「第七次了。这次记得在两站之间下车。」

::: on-enter
flag: 持票
:::

- [按票上说的，在两站之间下车] -> end-off
- [把票撕掉] -> end-loop

# 第七次停车 {id=stop7}

列车开始减速。窗外，雪原上立着一盏孤零零的站牌，上面没有字。

广播：「本次停车，仅限选择下车者。」

- [下车] -> end-off
- [留在车上] -> end-loop

# 女孩与名字 {id=girl}

「我叫……我把名字忘在第七节车厢了。」她认真地说，「你能帮我拿回来吗？你的名字应该也在那里。」

- [答应她，去第七节] -> car4 {flag=承诺}
- [拒绝，问她列车的真相] -> end-loop {flag=追问}

# 布偶 {id=doll}

布偶的脸不是没有，而是被反复缝起过。你翻开它背后的标签，上面是列车员的编号，和你的生日。

女孩安静地看着你，笑了。

::: on-enter
san: -4
flag: 知道太多
:::

- [把布偶还给她，后退] -> car4
- [问她是第几个乘客] -> car4 {flag=第几个}

# 第四节 · 列车员 {id=car4}

第四节车厢的灯全灭了。只有尽头有一个人影，戴着帽子，正在擦一块早已不存在的窗玻璃。

「你来得比前六次都早。」他说，没有回头。

::: on-enter
san: -2
:::

- [问他「前六次」是什么] -> answer {flag=质问}
- [安静地坐下，等他先开口] -> silence
- [转身跑回第三节] -> car3 {flag=逃避}

# 雪原的声音 {id=voice}

这一次，你听清了。那不是你的名字，而是一串数字，和一句几乎被风吹散的话：

「……别让她数到七。」

::: on-enter
flag: 数字
san: -3
:::

- [记住数字，回到车厢] -> car4
- [跳下车，追着声音走] -> end-snow {flag=下车}

# 列车员的答案 {id=answer}

他终于转过身。帽子下面是你的脸，只是老了很多。

「前六次你都留在车上。所以这一次，我替你写了一张票。」

- [接过那张票] -> end-off {flag=接过}
- [问：如果我留下，会怎样？] -> end-loop

# 沉默 {id=silence}

你坐下。很久之后，车厢的灯一盏一盏亮起来，照出墙上密密麻麻的刻痕，每一道都是一个日期，最后一道是今天。

「到站了。」他说。

- [起身，走向打开的车门] -> end-off
- [坐下不动] -> end-loop

# 在世界之间下车 {id=end-off ending=在世界之间下车}

你踏下车门。雪没有想象中那么冷。

身后的列车没有立刻开走，而是安静地停在那里，像在等你回头。你没有。

远处有一盏灯，亮着，像一个还没被写下句号的句子。

# 第七次广播 {id=end-loop ending=第七次广播}

广播又响了，声音和最开始一模一样：

「各位乘客，本次列车不设终点站。请在每一次停车前，做出选择。」

你低头，发现手里的车票日期变了。你又回到了第一节车厢。

# 雪原深处 {id=end-snow ending=雪原深处}

雪很快盖住你的脚印。你追着那个声音走了很久，直到听不见铁轨，也听不见自己。

第七次之后，雪原上多了一个念着别人名字的声音。

::: world-events
## 雾中汽笛
- trigger: turn_end
- chance: 12%
- cooldown: 4
- when: san<40
- narrative: 雾里传来一声汽笛。你分不清是从车外，还是从自己的胸腔里。
- san: -1

## 记忆闪回
- trigger: turn_start
- chance: 30%
- cooldown: 5
- when: flag=持票
- narrative: 你突然想起一个不属于你的画面：一双穿旧皮鞋的脚，站在雪里，一动不动。
:::
`;

/* ------------------------------------------------------------------ */
/* 世界                                                                */
/* ------------------------------------------------------------------ */

FILES['worlds/gray-tide.json'] = JSON.stringify(
  {
    id: 'gray-tide',
    title: '灰潮',
    subtitle: '雾岬港的第七次退潮',
    description:
      '二十七年前，货轮「白鸢号」在雾中消失。今晚，码头上的钟同时停了。你手里有一封匿名信，和一个不该出现在海图上的坐标。',
    coverIcon: 'tsunami',
    coverColor: '#3f5b6b',
    tags: ['克苏鲁', '悬疑', '跑团', '港口'],
    author: '世界树示例',
    mode: 'coc',
    rulePackId: 'coc7',
    opening:
      '雾在凌晨两点漫过旧码头的铁轨。\n\n你踩在湿滑的木板上，手电的光柱被雾吞掉一半，只能照亮三米。远处传来一声汽笛——低沉、悠长，不属于任何一艘靠港的船。\n\n然后，整座码头的钟同时停了。',
    setting:
      '时代背景：1927 年的东亚某港口城市「雾岬」。技术水平接近现实 1920 年代，但存在超自然现象。\n\n核心谜团：货轮「白鸢号」每七年重现一次；退潮会认为海雾是「沉睡者」的呼吸；玩家手中的铅哨是打开某扇门的钥匙。\n\n基调：缓慢渗透的恐惧、潮湿、铅灰色、大量的雾与声音描写。避免血浆与怪物正面登场。',
    rules: {
      style: '冷静克制的中文叙事，短句，重感官（雾、盐、铁锈、湿木头）。',
      directives: [
        '每次回复后给出 2-4 个行动选项，选项之间要有真实的取舍。',
        '危险行为必须走技能检定，不要替玩家决定成败。',
        'NPC 不会主动说出全部真相，需要玩家施压或交换。',
      ],
      allowFreeInput: true,
      choiceCount: 3,
      autoAdvance: false,
      autoCheck: true,
      failForward: false,
    },
    worldBookId: 'gray-tide',
    characterIds: ['lin-yan', 'han-xu', 'echo-girl', 'gu-ruo'],
    systemPromptOverride: '',
  },
  null,
  2,
);

FILES['worlds/last-train.json'] = JSON.stringify(
  {
    id: 'last-train',
    title: '末班列车',
    subtitle: '一条会自己改道的铁轨',
    description:
      '你在末班车上醒来，车厢里没有其他乘客，窗外是一片你从未见过的雪原。列车员说：这趟车只在有人做出「正确选择」时才会到站。',
    coverIcon: 'train',
    coverColor: '#5a4a63',
    tags: ['剧本', '悬疑', '循环', '短篇'],
    author: '世界树示例',
    mode: 'script',
    rulePackId: 'coc7',
    opening:
      '列车晃了一下，你从座位上惊醒。\n\n车厢里空无一人。灯管在头顶发出细微的电流声。窗外没有城市，只有一片望不到边的雪原，和被雪覆盖的铁轨——它们在前方分岔，又分岔。\n\n广播响了：「各位乘客，本次列车不设终点站。请在每一次停车前，做出选择。」',
    setting:
      '这是一辆永远在夜间行驶的列车。车厢有七节，每节都对应一个「乘客的记忆」。列车员是一个穿着旧制服、脸被帽檐遮住的男人。铁轨会随着乘客的选择改变走向。\n\n核心机制：每次做出选择，列车会短暂停车；玩家若在停车时下车，会进入那节车厢对应的记忆。',
    rules: {
      style: '安静、略带诗意，大量关于光、雪、金属与回声的意象。',
      directives: ['严格按剧情节拍推进，不要提前揭示列车员身份。', '让每个选择都留下代价。'],
      allowFreeInput: true,
      choiceCount: 3,
      autoAdvance: false,
      autoCheck: true,
      failForward: false,
    },
    worldBookId: 'night-library',
    characterIds: ['lin-yan'],
    scriptFile: 'scripts/last-train.md',
    systemPromptOverride: '',
  },
  null,
  2,
);

FILES['worlds/night-library.json'] = JSON.stringify(
  {
    id: 'night-library',
    title: '夜航图书馆',
    subtitle: '一座只在雨夜出现的图书馆',
    description:
      '城市的第四个街角，每逢雨夜会多出一栋不属于这条街的建筑。它的门永远虚掩，里面的书在等人来读——也在等有人把自己写进去。',
    coverIcon: 'local_library',
    coverColor: '#4f6f52',
    tags: ['奇幻', '自由叙事', '治愈', '成长'],
    author: '世界树示例',
    mode: 'story',
    rulePackId: 'narrative',
    opening:
      '雨下到第三个小时的时候，你在回家的路口看见了一栋不该存在的建筑。\n\n两层高，砖是深绿色的，门楣上写着四个字：夜航图书馆。门缝里漏出暖黄的灯光，还有纸张翻动的声音。\n\n你站在雨里，伞沿的水连成一条线。',
    setting:
      '夜航图书馆只在雨夜出现，馆藏的是「还没被写出来的故事」。管理员是一位总在整理书脊的老人，他说自己是第一个读者。\n\n规则：\n1. 馆内的书可以读，但不能带走；\n2. 每读完一本，读者会遗忘自己的一段记忆；\n3. 若有人在馆内写下自己的故事，那本书就会永远留在馆里，而写作者会变成新的管理员。',
    rules: {
      style: '温柔、细腻，像雨声。允许留白，不必每次都给强冲突。',
      directives: [
        '把读者的情绪当作剧情推进的主要动力。',
        '每次回复给 2-3 个选项，其中一个可以偏向「什么都不做」。',
        '允许玩家用自然语言输入任何行为，包括对话与沉默。',
      ],
      allowFreeInput: true,
      choiceCount: 3,
      autoAdvance: false,
      autoCheck: false,
      failForward: true,
    },
    worldBookId: 'night-library',
    characterIds: ['librarian'],
    systemPromptOverride: '',
  },
  null,
  2,
);

/* ------------------------------------------------------------------ */
/* 写入                                                                */
/* ------------------------------------------------------------------ */

export function ensureSeed(): { created: number } {
  for (const sub of CONTENT_SUBDIRS) {
    mkdirSync(join(CONTENT_DIR, sub), { recursive: true });
  }

  const first = join(CONTENT_DIR, 'worlds', 'gray-tide.json');
  if (existsSync(first)) return { created: 0 };

  let created = 0;
  for (const [rel, content] of Object.entries(FILES)) {
    const abs = join(CONTENT_DIR, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content, 'utf8');
    created++;
  }
  return { created };
}


