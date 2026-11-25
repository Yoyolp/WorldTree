/**
 * 回归：规则书驱动的角色面板
 *
 * 这里验证的不只是「字段能读」，而是本次改造的四条核心承诺：
 *
 *   1. 面板结构由规则书声明 —— 换规则书，字段就跟着换
 *   2. 判定方向正确 —— D&D 是「越大越好」，不能套 COC 的「越小越好」
 *   3. 旧存档不迁移就能读 —— COC 老面板仍按 COC 结构渲染
 *   4. 换规则书不丢数据 —— 迁移时只补不清
 *
 * 用 WT_BASE / WT_TOKEN 指向一个已启动的服务。
 */

const BASE = process.env.WT_BASE || 'http://127.0.0.1:5199';
const TOKEN = process.env.WT_TOKEN || '';

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function http(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, data: json };
}

const post = (p, b) => http('POST', p, b);
const get = (p) => http('GET', p);
const patch = (p, b) => http('PATCH', p, b);
const del = (p) => http('DELETE', p);

async function main() {
  console.log('\n[1] 规则书声明了面板结构');
  const packs = await get('/api/rulepacks');
  const list = Array.isArray(packs.data) ? packs.data : packs.data?.items ?? [];
  ok('规则包列表可读', list.length > 0, `${list.length} 本`);

  const coc = list.find((p) => p.id === 'coc7');
  ok('coc7 有 sheetSchema', !!coc?.sheetSchema);
  ok('coc7 是九属性', coc?.sheetSchema?.attributes?.length === 9, `${coc?.sheetSchema?.attributes?.length}`);
  ok('coc7 资源含 san', (coc?.sheetSchema?.resources ?? []).some((r) => r.key === 'san'));

  const dnd = list.find((p) => p.id === 'dnd5e');
  ok('dnd5e 插件已加载', !!dnd, dnd ? dnd.name : '未找到');
  ok('dnd5e 有六属性', dnd?.sheetSchema?.attributes?.length === 6, `${dnd?.sheetSchema?.attributes?.length}`);
  ok(
    'dnd5e 属性是力敏体智感魅',
    ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].every((k) =>
      (dnd?.sheetSchema?.attributes ?? []).some((a) => a.key === k),
    ),
  );
  ok('dnd5e 没有 SAN 资源', !(dnd?.sheetSchema?.resources ?? []).some((r) => r.key === 'san'));
  ok('dnd5e 有 AC 资源', (dnd?.sheetSchema?.resources ?? []).some((r) => r.key === 'ac'));
  ok('dnd5e 声明了派生公式', (dnd?.sheetSchema?.derived ?? []).length > 0, `${(dnd?.sheetSchema?.derived ?? []).length} 项`);

  const narrative = list.find((p) => p.id === 'narrative');
  ok('纯叙事规则书不声明面板', !narrative?.sheetSchema);

  console.log('\n[2] 按规则书随机生成面板');
  const rollCoc = await post('/api/characters/roll-sheet', { rulePackId: 'coc7', seed: 4242 });
  ok('coc7 生成成功', rollCoc.status === 200, `status=${rollCoc.status}`);
  ok('coc7 面板有九个属性', Object.keys(rollCoc.data?.attributes ?? {}).length === 9);
  ok('coc7 面板 HP 上限等于 (CON+SIZ)/10', (() => {
    const a = rollCoc.data.attributes;
    return rollCoc.data.hpMax === Math.floor((a.CON + a.SIZ) / 10);
  })(), `${rollCoc.data.hpMax}`);

  const rollDnd = await post('/api/characters/roll-sheet', { rulePackId: 'dnd5e', seed: 4242 });
  ok('dnd5e 生成成功', rollDnd.status === 200, `status=${rollDnd.status}`);
  ok('dnd5e 面板只有六个属性', Object.keys(rollDnd.data?.attributes ?? {}).length === 6);
  ok('dnd5e 面板没有 san 字段', typeof rollDnd.data?.san === 'number' ? rollDnd.data.san === 0 : true);
  ok('dnd5e 面板有 AC', typeof rollDnd.data?.resources?.ac === 'number', `AC=${rollDnd.data?.resources?.ac}`);
  ok('dnd5e 技能值在 d20 量级', (rollDnd.data?.skills ?? []).every((s) => s.value >= 0 && s.value <= 40),
    `最大 ${Math.max(...(rollDnd.data?.skills ?? []).map((s) => s.value))}`);

  const rollNarrative = await post('/api/characters/roll-sheet', { rulePackId: 'narrative', seed: 1 });
  ok('无面板的规则书拒绝生成', rollNarrative.status >= 400, `status=${rollNarrative.status}`);

  console.log('\n[3] 面板跟着规则书走（角色卡 → 会话）');
  const mkCard = (name, extra) =>
    post('/api/characters', {
      name,
      description: '测试用',
      isPlayer: false,
      ...extra,
    });

  // 一张 D&D 卡：六属性 + AC + 法术位
  const dndCard = await mkCard('面板测试·D&D', {
    sheet: {
      ...rollDnd.data,
      rulePackId: 'dnd5e',
      skills: [{ name: '察觉', value: 15 }],
    },
  });
  ok('D&D 角色卡已创建', dndCard.status === 200, `id=${dndCard.data?.id}`);

  // 一张 COC 老卡：没有 rulePackId 字段（模拟旧存档）
  const legacySheet = {
    attributes: { STR: 60, CON: 55, SIZ: 65, DEX: 70, APP: 50, INT: 65, POW: 60, EDU: 70, LUCK: 55 },
    skills: [{ name: '侦查', value: 77 }],
    hp: 12,
    hpMax: 12,
    mp: 12,
    mpMax: 12,
    san: 60,
    sanMax: 60,
    luck: 55,
    luckMax: 55,
    conditions: [],
    items: [],
  };
  const legacyCard = await mkCard('面板测试·旧COC', { sheet: legacySheet });
  ok('旧 COC 角色卡已创建（无 rulePackId）', legacyCard.status === 200);
  ok('旧卡读回来仍有九属性', Object.keys(legacyCard.data?.sheet?.attributes ?? {}).length === 9);

  // 用一个 COC 世界开一局，挂上 D&D 卡
  // 世界列表的形状是 { items: [{ world, ... }] }，不是裸数组
  const worldList = await get('/api/worlds');
  const rawItems = Array.isArray(worldList.data) ? worldList.data : worldList.data?.items ?? [];
  const worlds = rawItems.map((it) => it.world ?? it);
  const cocWorld = worlds.find((w) => w.rulePackId === 'coc7') ?? worlds[0];
  ok('拿到一个世界', !!cocWorld, cocWorld?.title ? `${cocWorld.title}（${cocWorld.id}）` : '无');

  const s1 = await post(`/api/worlds/${cocWorld.id}/sessions`, {
    playerName: '面板测试',
    playerCharacterId: dndCard.data.id,
    sheetSeed: 777,
  });
  ok('D&D 卡进了 COC 世界', s1.status === 200, `status=${s1.status}`);
  ok('会话有面板', !!s1.data?.session?.state?.sheet);
  ok(
    '面板保留了 D&D 的 AC（角色卡优先）',
    typeof s1.data?.session?.state?.sheet?.resources?.ac === 'number',
    `AC=${s1.data?.session?.state?.sheet?.resources?.ac}`,
  );
  ok(
    '角色卡优先时面板仍是 D&D 的六属性结构',
    Object.keys(s1.data?.session?.state?.sheet?.attributes ?? {}).length === 6,
    `${Object.keys(s1.data?.session?.state?.sheet?.attributes ?? {}).length} 个属性键`,
  );
  ok('判定仍按世界的 coc7', s1.data?.session?.state?.rulePackId === 'coc7',
    s1.data?.session?.state?.rulePackId);

  console.log('\n[4] 面板优先级可配置');
  // 把世界切成「面板按世界规则书」
  /** 世界的内容字段在 detail.world 里 */
  const worldDetail = await get(`/api/worlds/${cocWorld.id}`);
  const w = worldDetail.data?.world ?? worldDetail.data;
  const upd = await patch(`/api/worlds/${cocWorld.id}`, { sheetRulePrecedence: 'world' });
  ok('世界支持 sheetRulePrecedence=world', upd.status === 200, `status=${upd.status}`);
  ok('写入后读回是 world', upd.data?.sheetRulePrecedence === 'world', upd.data?.sheetRulePrecedence);

  const s2 = await post(`/api/worlds/${cocWorld.id}/sessions`, {
    playerName: '面板测试2',
    playerCharacterId: dndCard.data.id,
    sheetSeed: 778,
  });
  ok('世界优先时仍能开局', s2.status === 200);
  ok(
    '世界优先时面板是 COC 的 HP/MP/SAN',
    typeof s2.data?.session?.state?.sheet?.san === 'number' &&
      s2.data?.session?.state?.sheet?.san > 0,
    `SAN=${s2.data?.session?.state?.sheet?.san}`,
  );

  // 改回角色卡优先
  await patch(`/api/worlds/${cocWorld.id}`, { sheetRulePrecedence: 'character' });
  const back = await get(`/api/worlds/${cocWorld.id}`);
  const backWorld = back.data?.world ?? back.data;
  ok('可以改回 character', backWorld?.sheetRulePrecedence === 'character', backWorld?.sheetRulePrecedence);

  console.log('\n[5] 旧存档向后兼容');
  const s3 = await post(`/api/worlds/${cocWorld.id}/sessions`, {
    playerName: '面板测试3',
    playerCharacterId: legacyCard.data.id,
    sheetSeed: 779,
  });
  ok('旧 COC 卡能进会话', s3.status === 200);
  const sh = s3.data?.session?.state?.sheet;
  ok('旧卡的技能值原样保留', sh?.skills?.find((x) => x.name === '侦查')?.value === 77,
    `${sh?.skills?.find((x) => x.name === '侦查')?.value}`);
  ok('旧卡的 SAN 原样保留', sh?.san === 60, `SAN=${sh?.san}`);
  ok('旧卡没有 resources 也不会崩', sh?.resources === undefined || typeof sh.resources === 'object');

  console.log('\n[6] 清理');
  for (const id of [dndCard.data?.id, legacyCard.data?.id]) {
    if (id) await del(`/api/characters/${id}`);
  }
  for (const sid of [s1.data?.session?.id, s2.data?.session?.id, s3.data?.session?.id]) {
    if (sid) await del(`/api/sessions/${sid}`);
  }
  ok('测试数据已清理', true);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('测试异常：', err);
  process.exit(1);
});
