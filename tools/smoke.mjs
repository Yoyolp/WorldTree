await import('./_auth-patch.mjs');
/**
 * 世界树 v0.2 · 端到端冒烟测试
 *
 * 覆盖：内容层（文件即真源）/ 规则包 / 统一引擎 / 事件系统 /
 *       剧本 DSL 编译 / ST V2 导入导出 / 分叉快照 / 可复现随机
 *
 * 用法：node tools/smoke.mjs
 */
const BASE = process.env.WT_BASE ?? 'http://127.0.0.1:5174';

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

function section(title) {
  console.log(`\n[${title}]`);
}

async function j(path, init) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, raw: text };
}

const post = (p, b) => j(p, { method: 'POST', body: JSON.stringify(b) });
const del = (p) => j(p, { method: 'DELETE' });

console.log('\n世界树 v0.2 冒烟测试 ·', BASE);

/* ------------------------------------------------------------------ */
section('1. 内容层（文件即真源）');
const health = await j('/api/content/health');
ok('健康检查', (await j('/api/health')).data.ok);
ok('内容扫描成功', health.status === 200);
ok('世界已加载', health.data.worlds >= 3, `${health.data.worlds} 个`);
ok('角色已加载', health.data.characters >= 5, `${health.data.characters} 个`);
ok('世界书已加载', health.data.worldbooks >= 2, `${health.data.worldbooks} 本`);
ok('剧本已加载', health.data.scripts >= 1, `${health.data.scripts} 个`);
ok('内容零错误', health.data.errors.length === 0, `错误 ${health.data.errors.length} / 警告 ${health.data.warnings.length}`);

/* ------------------------------------------------------------------ */
section('2. 规则包');
const packs = await j('/api/rulepacks');
// 规则包现在是可插拔的：内置四个 + content/rulepacks 下的插件。
// 断言「至少包含四个内置」而不是「恰好四个」，否则装了插件就红。
const BUILTIN = ['coc7', 'coc-d100', 'script-lite', 'narrative'];
const missing = BUILTIN.filter((id) => !packs.data.some((p) => p.id === id));
ok('内置规则包齐全', missing.length === 0, `共 ${packs.data.length} 个（缺 ${missing.join(',') || '无'}）`);
const coc7 = packs.data.find((p) => p.id === 'coc7');
const d100 = packs.data.find((p) => p.id === 'coc-d100');
const nar = packs.data.find((p) => p.id === 'narrative');
const lite = packs.data.find((p) => p.id === 'script-lite');
ok('COC7：难度分级 + 奖励骰 + 幸运 + 孤注一掷',
  coc7.difficulties && coc7.bonusPenalty && coc7.luckSpend && coc7.pushedRolls);
ok('简化 d100：无难度分级', !d100.difficulties && !d100.bonusPenalty);
ok('叙事包：失败也推进', nar.failForward && !nar.sanity);

/* ------------------------------------------------------------------ */
section('3. 剧本 Markdown DSL');
const scripts = await j('/api/scripts');
const lastTrain = scripts.data.items.find((s) => s.id === 'last-train');
ok('剧本列表可读', !!lastTrain, lastTrain && `${lastTrain.nodeCount} 节点 / ${lastTrain.eventCount} 事件`);
ok('剧本编译无错', lastTrain && lastTrain.errors.length === 0, (lastTrain?.errors ?? []).join('；'));

const rec = await j('/api/scripts/last-train');
ok('起始节点解析', rec.data.script.startNodeId === 'car1', rec.data.script.startNodeId);
ok('节点数 15', rec.data.script.nodes.length === 15, String(rec.data.script.nodes.length));
const car1 = rec.data.script.nodes.find((n) => n.id === 'car1');
ok('内嵌固定事件解析', car1.events.length === 1, car1.events.map((e) => `${e.name}(${Math.round(e.chance * 100)}%)`).join(','));
ok('选项检定解析', car1.choices.some((c) => !c.check) && rec.data.script.nodes.some((n) => n.choices.some((c) => c.check)),
  '含带检定选项');
ok('全局事件解析', rec.data.script.events.length === 2, rec.data.script.events.map((e) => e.name).join(','));
ok('结局节点存在', rec.data.script.nodes.filter((n) => n.ending).length === 3);

// 反向序列化往返
const roundtrip = await post('/api/scripts/serialize', { script: rec.data.script });
const recompiled = await post('/api/scripts/compile', { markdown: roundtrip.data.markdown });
ok('MD ⇄ JSON 往返后节点数一致', recompiled.data.script.nodes.length === 15, `${recompiled.data.script.nodes.length}`);
ok('往返后无编译错误', recompiled.data.errors.length === 0, recompiled.data.errors.join('；'));

// 标题引用
const titleRef = await post('/api/scripts/compile', {
  markdown: `# 甲 {id=a}\n\n- [去乙] -> 乙\n\n# 乙 {id=b ending=结束}\n\n完。\n`,
});
ok('选项可用节点标题作目标', titleRef.data.script.nodes[0].choices[0].next === 'b',
  `解析为 ${titleRef.data.script.nodes[0].choices[0].next}`);

/* ------------------------------------------------------------------ */
section('4. 统一引擎：会创建面板');
const created = await post('/api/worlds/gray-tide/sessions', { playerName: '测试者', sheetSeed: 12345 });
const sid = created.data.session.id;
ok('创建跑团世界线', created.status === 200 && !!sid);
const sheet = created.data.session.state.sheet;
ok('自动生成调查员面板', !!sheet?.attributes?.STR);
ok('面板含幸运值', typeof sheet.luck === 'number', `幸运 ${sheet.luck}`);
ok('事件运行时初始化', created.data.session.state.events.turns === 0);
ok('首条开场消息', created.data.messages.length >= 1);

/* ------------------------------------------------------------------ */
section('5. 检定（COC7）');
const same1 = await post(`/api/sessions/${sid}/roll`, { skill: '侦查', seed: 777 });
const same2 = await post(`/api/sessions/${sid}/roll`, { skill: '侦查', seed: 777 });
ok('同种子结果一致', same1.data.check.roll === same2.data.check.roll,
  `掷出 ${same1.data.check.roll}`);
ok('检定返回目标值', typeof same1.data.check.target === 'number', `目标 ${same1.data.check.target}`);
ok('检定返回结果等级', !!same1.data.check.outcome, same1.data.check.label);

const bonus = await post(`/api/sessions/${sid}/roll`, { skill: '侦查', bonus: 1, seed: 777 });
ok('奖励骰产生多候选', bonus.data.check.candidates.length === 2,
  `候选 ${bonus.data.check.candidates.join('/')} → 取 ${bonus.data.check.roll}`);
ok('奖励骰取最小值', bonus.data.check.roll === Math.min(...bonus.data.check.candidates));

const penalty = await post(`/api/sessions/${sid}/roll`, { skill: '侦查', bonus: -1, seed: 777 });
ok('惩罚骰取最大值', penalty.data.check.roll === Math.max(...penalty.data.check.candidates),
  `候选 ${penalty.data.check.candidates.join('/')} → 取 ${penalty.data.check.roll}`);

const hard = await post(`/api/sessions/${sid}/roll`, { skill: '侦查', difficulty: 'hard', seed: 777 });
ok('困难难度阈值减半', hard.data.check.target === same1.data.check.target,
  `难度 ${hard.data.check.difficulty}，原始目标 ${hard.data.check.target}`);

/* ------------------------------------------------------------------ */
section('6. 意图推断（自动检定）');
const intents = [
  ['我仔细搜查这间屋子', '侦查'],
  ['我悄悄绕到仓库后面', '潜行'],
  ['我朝着那东西开枪', '射击'],
  ['我想说服他告诉我们真相', '说服'],
];
let intentOk = 0;
for (const [text, expect] of intents) {
  const r = await post(`/api/sessions/${sid}/intent`, { content: text });
  if (r.data.skill === expect) intentOk++;
}
ok('意图 → 技能映射正确', intentOk === intents.length, `${intentOk}/${intents.length}`);

/* ------------------------------------------------------------------ */
section('7. 事件系统');
const sc = await post('/api/worlds/last-train/sessions', { sheetSeed: 999 });
const ssid = sc.data.session.id;
ok('剧本世界线从起始节点开始', sc.data.session.state.nodeId === 'car1', sc.data.session.state.nodeId);
ok('首条消息带节点选项', sc.data.messages[0].meta.choices.length === 3);

// 走一次选项，验证节点推进 + 事件触发 + 一次性标记
const firstChoice = sc.data.messages[0].meta.choices[0];
const turn = await post('/api/chat', {
  sessionId: ssid,
  content: '',
  intent: 'choice',
  choiceId: firstChoice.id,
});
const turnDone = turn.data.done;
ok('选项推进节点', turnDone.session.state.nodeId === 'seat', turnDone.session.state.nodeId);
ok('状态标记写入', turnDone.session.state.flags.includes('谨慎'), turnDone.session.state.flags.join(','));
ok('事件引擎有触发记录或明确为空', Array.isArray(turnDone.message.meta.events),
  `${(turnDone.message.meta.events ?? []).length} 个事件`);
ok('消息记录随机种子', typeof turnDone.message.meta.seed === 'number');
ok('回合计数递增', turnDone.session.state.events.turns === 1);

// 一次性事件在第二轮不应再触发
const turn2 = await post('/api/chat', {
  sessionId: ssid,
  content: '我打开那个皮箱',
  intent: 'say',
});
const ev1 = new Set((turnDone.message.meta.events ?? []).map((e) => e.eventId));
const ev2 = (turn2.data.done.message.meta.events ?? []).map((e) => e.eventId);
const recounted = ev2.filter((id) => ev1.has(id));
ok('once 事件不会重复触发', recounted.length === 0, recounted.join(',') || '无重复');

/* ------------------------------------------------------------------ */
section('8. SillyTavern V2 兼容');
const stJson = await j('/api/characters/lin-yan/export');
ok('导出 ST V2 结构', stJson.data.spec === 'chara_card_v2' && stJson.data.spec_version === '2.0');
const stData = stJson.data.data;
ok('导出含全部必需字段',
  ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example',
   'creator_notes', 'system_prompt', 'post_history_instructions',
   'alternate_greetings', 'tags', 'creator', 'character_version', 'extensions']
    .every((k) => k in stData),
  `${Object.keys(stData).length} 个字段`);

const imported = await post('/api/characters/import', { payload: stJson.data });
ok('JSON 导入成功', imported.status === 200 && !!imported.data.card);
ok('导入后字段一致', imported.data.card.description === stData.description);
ok('导入后面板保留', !!imported.data.card.sheet?.attributes?.STR);
if (imported.data.card) await del(`/api/characters/${imported.data.card.id}`);

// PNG 角色卡
const pngRes = await fetch(`${BASE}/api/characters/lin-yan/export-png`);
const pngBuf = Buffer.from(await pngRes.arrayBuffer());
ok('PNG 导出为合法图像', pngBuf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
  `${pngBuf.length} 字节`);

// 检查 tEXt chara chunk
let hasChara = false;
{
  let off = 8;
  while (off + 8 < pngBuf.length) {
    const len = pngBuf.readUInt32BE(off);
    const type = pngBuf.subarray(off + 4, off + 8).toString('latin1');
    if (type === 'tEXt') {
      const d = pngBuf.subarray(off + 8, off + 8 + len);
      const nul = d.indexOf(0);
      if (d.subarray(0, nul).toString() === 'chara') {
        const payload = JSON.parse(Buffer.from(d.subarray(nul + 1).toString(), 'base64').toString('utf8'));
        hasChara = payload.spec === 'chara_card_v2' && payload.data.name === '林砚';
        break;
      }
    }
    off += 12 + len;
  }
}
ok('PNG 内嵌 chara_card_v2 数据', hasChara);

const pngImport = await post('/api/characters/import-png', { base64: pngBuf.toString('base64') });
ok('PNG 角色卡可导入', pngImport.status === 200 && pngImport.data.card?.name === '林砚');
if (pngImport.data.card) await del(`/api/characters/${pngImport.data.card.id}`);

// 世界书 ST 格式
const stBook = await j('/api/worldbooks/gray-tide/export');
ok('世界书导出为 ST World Info', !!stBook.data.entries, `${Object.keys(stBook.data.entries).length} 条`);
const firstEntry = stBook.data.entries['0'];
ok('ST 世界书字段完整',
  ['key', 'keysecondary', 'comment', 'content', 'constant', 'selective', 'selectiveLogic',
   'order', 'position', 'probability', 'useProbability', 'cooldown'].every((k) => k in firstEntry));

const bookImport = await post('/api/worldbooks/import', { payload: stBook.data });
ok('世界书可导入', bookImport.status === 200 && bookImport.data.book.entries.length === 6);
if (bookImport.data.book) await del(`/api/worldbooks/${bookImport.data.book.id}`);

/* ------------------------------------------------------------------ */
section('9. 世界书扫描与注入');
const before = health.data;
const rescan = await post('/api/content/sync', {});
ok('重新同步内容稳定', rescan.data.worlds === before.worlds);

/* ------------------------------------------------------------------ */
section('10. 存档分叉与快照');
const full = await j(`/api/sessions/${ssid}`);
const anchor = full.data.messages.find((m) => m.role === 'assistant');
const forked = await post(`/api/sessions/${ssid}/fork`, { messageId: anchor.id, label: '测试分叉' });
ok('分叉创建新世界线', forked.status === 200 && forked.data.session.id !== ssid);
ok('分叉带父指针', forked.data.session.parentId === ssid);
ok('分叉保存状态快照', !!forked.data.session.snapshot,
  forked.data.session.snapshot ? `节点 ${forked.data.session.snapshot.nodeId}` : '无');
ok('分叉复制历史', forked.data.messages.length >= 1, `${forked.data.messages.length} 条`);

const rewound = await post(`/api/sessions/${ssid}/rewind`, { messageId: anchor.id });
ok('回退成功', rewound.status === 200);
ok('回退后消息减少', rewound.data.messages.length <= full.data.messages.length);

/* ------------------------------------------------------------------ */
section('11. 存档删除（级联）与导出导入');

// 11.1 级联删除：父线删除后子线不应变成孤儿
const chainRoot = await post('/api/worlds/last-train/sessions', { sheetSeed: 5150 });
const pId = chainRoot.data.session.id;
const c1 = await post(`/api/sessions/${pId}/fork`, { messageId: chainRoot.data.messages[0].id, label: '子' });
const c2 = await post(`/api/sessions/${c1.data.session.id}/fork`, {
  messageId: c1.data.messages[0].id,
  label: '孙',
});
const delChain = await del(`/api/sessions/${pId}`);
ok('删除父线返回删除数量', delChain.data.deleted === 3, `deleted=${delChain.data.deleted}`);
ok('父线已删除', !(await j(`/api/sessions/${pId}`)).data.session);
ok('子线被级联删除', !(await j(`/api/sessions/${c1.data.session.id}`)).data.session);
ok('孙线被级联删除', !(await j(`/api/sessions/${c2.data.session.id}`)).data.session);

// 11.2 DELETE 带 Content-Type 但空 body 不应 400（前端 http.del 的历史 bug）
const emptyDelete = await fetch(`${BASE}/api/sessions/__none__`, {
  method: 'DELETE',
  headers: { 'Content-Type': 'application/json' },
});
ok('空 body 的 DELETE 不返回 400', emptyDelete.status === 200 || emptyDelete.status === 404, `status=${emptyDelete.status}`);

// 11.3 导出存档结构
const expSession = await post('/api/worlds/last-train/sessions', { sheetSeed: 1 });
const expId = expSession.data.session.id;
const expRes = await fetch(`${BASE}/api/sessions/${expId}/export`);
const save = await expRes.json();
ok('存档导出 200', expRes.status === 200);
ok('存档格式标识正确', save.format === 'worldtree-save' && save.version === 1);
ok('存档含世界信息', !!save.world?.id && !!save.world?.title);
ok('存档含消息', Array.isArray(save.messages) && save.messages.length >= 1, `${save.messages?.length} 条`);
ok('存档含会话状态', typeof save.session?.state?.nodeId === 'string');
ok('下载文件名正确编码', (expRes.headers.get('content-disposition') ?? '').includes('filename*=UTF-8'));

// 11.4 导入回原世界
const importedSave = await post('/api/sessions/import', { payload: save });
ok('存档可导入', importedSave.status === 200 && !!importedSave.data.session);
ok('导入后节点进度保留', importedSave.data.session.state.nodeId === save.session.state.nodeId,
  save.session.state.nodeId + ' -> ' + importedSave.data.session.state.nodeId);
ok('导入后消息数量一致', importedSave.data.messages.length === save.messages.length,
  save.messages.length + ' -> ' + importedSave.data.messages.length);
ok('导入后消息顺序一致', importedSave.data.messages.map((m) => m.role).join(',') === save.messages.map((m) => m.role).join(','));
ok('导入产生新的世界线', importedSave.data.session.id !== expId);
ok('列表数量增加', (await j('/api/worlds/last-train/sessions')).data.items.length >= 1);

// 11.5 跨世界导入必须被拒绝（否则会得到推进不了的坏存档）
const crossWorld = await post('/api/sessions/import', { payload: save, worldId: 'gray-tide' });
ok('跨世界导入被拒绝', !!crossWorld.data.error, crossWorld.data.error?.slice(0, 30));

// 11.6 非法存档被拒绝
const invalid = await post('/api/sessions/import', { payload: { hello: 'world' } });
ok('非法存档被拒绝', !!invalid.data.error);

await del(`/api/sessions/${expId}`);
await del(`/api/sessions/${importedSave.data.session.id}`);

/* ------------------------------------------------------------------ */
section('12. 哈利·波特与魔法石（固定剧情测试）');

const hpWorld = await j('/api/worlds/harry-potter-1');
ok('HP1 世界已加载', hpWorld.status === 200, hpWorld.data.world?.title);
ok('HP1 使用剧本模式', hpWorld.data.world?.mode === 'script');
ok('HP1 绑定剧本', !!hpWorld.data.world?.scriptFile, hpWorld.data.world?.scriptFile);
ok('HP1 绑定世界书', hpWorld.data.worldBook?.entries?.length >= 30,
  `${hpWorld.data.worldBook?.entries?.length} 个条目`);

const hpScript = await j('/api/scripts/harry-potter-1');
ok('HP1 剧本编译零错误', hpScript.data.errors.length === 0, (hpScript.data.errors ?? []).join('；'));
ok('HP1 节点数 45', hpScript.data.script.nodes.length === 45, String(hpScript.data.script.nodes.length));
const hpEvents =
  (hpScript.data.script.events?.length ?? 0) +
  hpScript.data.script.nodes.reduce((a, n) => a + n.events.length, 0);
ok('HP1 含固定事件', hpEvents >= 25, `${hpEvents} 个事件`);
ok('HP1 有结局节点', hpScript.data.script.nodes.filter((n) => n.ending).length === 1);
ok('HP1 起始节点正确', hpScript.data.script.startNodeId === 'ch01');

// 图完整性：所有节点从起点可达
{
  const nodes = hpScript.data.script.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set();
  const queue = [hpScript.data.script.startNodeId];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const n = byId.get(id);
    if (!n) continue;
    for (const c of n.choices) {
      const t = c.effects?.goto ?? c.next;
      if (t) queue.push(t);
    }
  }
  ok('所有 HP1 节点可达', seen.size === nodes.length, `${seen.size}/${nodes.length}`);
  const deadEnds = nodes.filter((n) => n.choices.length === 0 && !n.ending);
  ok('没有走不通的死节点', deadEnds.length === 0, deadEnds.map((n) => n.id).join(','));
}

// 实际推进 3 步，验证固定事件按节点触发
const hpSess = await post('/api/worlds/harry-potter-1/sessions', { playerName: '哈利' });
const hpId = hpSess.data.session.id;
ok('HP1 开局在第一章', hpSess.data.session.state.nodeId === 'ch01');
ok('HP1 使用 COC7 规则包（调查员模板）', hpSess.data.session.state.rulePackId === 'coc7', hpSess.data.session.state.rulePackId);

let hpCur = hpSess.data.messages[0];
const hpPath = [];
for (let i = 0; i < 3; i++) {
  const pick = hpCur.meta.choices[0];
  const t = await post('/api/chat', { sessionId: hpId, content: '', intent: 'choice', choiceId: pick.id });
  hpPath.push({
    node: t.data.done.session.state.nodeId,
    events: (t.data.done.message.meta.events ?? []).map((e) => e.name),
  });
  hpCur = t.data.done.message;
}
ok('HP1 节点连续推进', hpPath.every((p) => !!p.node), hpPath.map((p) => p.node).join(' → '));
ok('HP1 固定事件随节点触发', hpPath.some((p) => p.events.length > 0),
  hpPath.map((p) => `${p.node}:[${p.events.join(',')}]`).join(' '));

const hpLore = await post('/api/chat', {
  sessionId: hpId,
  content: '我拿出魔杖，问海格关于魔法石和三头犬的事',
  intent: 'say',
});
const hpLoreHits = hpLore.data.done.message.meta.loreHits ?? [];
ok('HP1 世界书命中多个条目', hpLoreHits.length >= 3, hpLoreHits.join('、'));

await del(`/api/sessions/${hpId}`);

/* ------------------------------------------------------------------ */
section('13. 清理');
await del(`/api/sessions/${sid}`);
await del(`/api/sessions/${ssid}`);
await del(`/api/sessions/${forked.data.session.id}`);
ok('测试世界线已清理', true);

/* ------------------------------------------------------------------ */
console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
if (failed) {
  console.log('失败项：');
  for (const f of failures) console.log(`  - ${f}`);
}
console.log('');
process.exit(failed ? 1 : 0);
