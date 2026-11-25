await import('./_auth-patch.mjs');
/**
 * 存档删除 / 导出 / 导入 的浏览器端验收
 * 用法：node tools/ui-check-save.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, readFileSync } from 'node:fs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9440;
const BASE = process.env.WT_BASE ?? 'http://127.0.0.1:5174';

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
};

const post = async (p, b) =>
  (await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();

// 准备数据：一条父线 + 一条分叉
const s = await post('/api/worlds/last-train/sessions', { sheetSeed: 4242 });
const parentId = s.session.id;
const fork = await post(`/api/sessions/${parentId}/fork`, { messageId: s.messages[0].id, label: '子线' });
const childId = fork.session.id;

console.log('准备数据：父线', parentId, '/ 子线', childId);

const child = spawn(
  EDGE,
  ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=D:\\tmp_e_save_${Date.now()}`, 'about:blank'],
  { stdio: 'ignore' },
);

async function getWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = await r.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {
      /* wait */
    }
    await sleep(250);
  }
  throw new Error('CDP 连接失败');
}

const ws = new WebSocket(await getWs());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
const reqs = [];
const errors = [];

ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
  if (m.method === 'Network.requestWillBeSent' && m.params.request.url.includes('/api/')) {
    reqs.push(`${m.params.request.method} ${m.params.request.url.replace(BASE, '')}`);
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
});

const send = (method, params = {}, sess) => {
  const mid = ++id;
  return new Promise((resolve, reject) => {
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params, sessionId: sess }));
  });
};

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId: cdp } = await send('Target.attachToTarget', { targetId, flatten: true });
const s2 = (m, p) => send(m, p, cdp);

await s2('Runtime.enable');
await s2('Page.enable');
await s2('Network.enable');
await s2('DOM.enable');
await s2('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
// 平台已加账号体系：先写 token 到 localStorage，再进目标页
if (process.env.WT_TOKEN) {
  await s2('Page.navigate', { url: `${BASE}/login` });
  await sleep(1500);
  await s2('Runtime.evaluate', {
    expression: `localStorage.setItem('wt.token', ${JSON.stringify(process.env.WT_TOKEN)}); 'ok'`,
    returnByValue: true,
  });
}
await s2('Page.navigate', { url: `${BASE}/sessions` });
await sleep(3200);

const ev = async (expr) => {
  const r = await s2('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

console.log('\n[1] 存档列表');

const before = await ev('document.querySelectorAll(".wt-session-card").length');
ok('列表渲染', before > 0, `${before} 张卡片`);
ok('有导入按钮', await ev('document.body.innerText.includes("导入存档")'));
ok('卡片有导出按钮', (await ev('document.querySelectorAll(".wt-session-card mdui-button-icon[aria-label=\\"导出存档\\"]").length')) > 0);

console.log('\n[2] 导出存档');

reqs.length = 0;
// 触发导出（浏览器会尝试下载）
await s2('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: 'D:\\tmp_dl' });
const dlResult = await ev(`(async () => {
  const card = [...document.querySelectorAll('.wt-session-card')][0];
  const btn = card.querySelector('mdui-button-icon[aria-label="导出存档"]');
  if (!btn) return 'no-btn';
  (btn.shadowRoot?.querySelector('button') || btn).click();
  await new Promise(r => setTimeout(r, 1200));
  return (document.querySelector('mdui-snackbar')||{}).innerText ?? 'no-toast';
})()`);
ok('点击导出有反馈', String(dlResult).includes('正在下载') || String(dlResult).includes('存档'), String(dlResult));

console.log('\n[3] 删除父线（确认弹窗 → 确定）');

reqs.length = 0;
const parentTitle = (await (await fetch(`${BASE}/api/sessions/${parentId}`)).json()).session.title;
const delResult = await ev(`(async () => {
  const cards = [...document.querySelectorAll('.wt-session-card')];
  // 按完整标题精确匹配，避免命中同名的分叉卡片
  const card = cards.find(c => c.querySelector('.wt-session-title').innerText === ${JSON.stringify(parentTitle)});
  if (!card) return { step: 'no-card', titles: cards.map(c => c.querySelector('.wt-session-title').innerText) };
  const title = card.querySelector('.wt-session-title').innerText;
  const del = [...card.querySelectorAll('mdui-button-icon')].pop();
  (del.shadowRoot?.querySelector('button') || del).click();
  await new Promise(r => setTimeout(r, 700));
  const dlg = document.querySelector('mdui-dialog[open]');
  if (!dlg) return { step: 'no-dialog', title };
  const desc = dlg.getAttribute('description');
  const btns = [...dlg.querySelectorAll('mdui-button')];
  const okBtn = btns[btns.length - 1];
  (okBtn.shadowRoot?.querySelector('button') || okBtn).click();
  await new Promise(r => setTimeout(r, 2200));
  return { title, desc, cards: document.querySelectorAll('.wt-session-card').length };
})()`);
ok('确认弹窗出现并有描述', !!delResult.desc, delResult.desc ?? String(delResult.step));
ok('弹窗提示会连带删除分叉', String(delResult.desc ?? '').includes('分叉'), delResult.desc ?? '');
const delCalled = reqs.some((r) => r.startsWith('DELETE /api/sessions/'));
ok('发出 DELETE 请求', delCalled, reqs.filter((r) => r.startsWith('DELETE')).join(' | '));

const parentGone = await (await fetch(`${BASE}/api/sessions/${parentId}`)).json();
const childGone = await (await fetch(`${BASE}/api/sessions/${childId}`)).json();
ok('父线已删除', !parentGone.session);
ok('子线被级联删除（不再变孤儿）', !childGone.session);

const remaining = await (await fetch(`${BASE}/api/worlds/last-train/sessions`)).json();
ok('世界详情里没有留下孤儿节点', remaining.items.every((x) => !x.parentId || remaining.items.some((y) => y.id === x.parentId)));

console.log('\n[4] 导入存档');

// 造一个存档文件
const src = await post('/api/worlds/harry-potter-1/sessions', { playerName: '导入测试' });
const save = await (await fetch(`${BASE}/api/sessions/${src.session.id}/export`)).json();
save.session.title = '导入验证线';
writeFileSync('D:\\tmp_save_test.wtsave.json', JSON.stringify(save, null, 2), 'utf8');
await fetch(`${BASE}/api/sessions/${src.session.id}`, { method: 'DELETE' });

reqs.length = 0;
const { root } = await s2('DOM.getDocument', { depth: -1 });
const { nodeId } = await s2('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
await s2('DOM.setFileInputFiles', { files: ['D:\\tmp_save_test.wtsave.json'], nodeId });
await sleep(3500);

const importCalled = reqs.some((r) => r.startsWith('POST /api/sessions/import'));
ok('发出导入请求', importCalled, reqs.filter((r) => r.includes('import')).join(' | '));

const listAfter = await (await fetch(`${BASE}/api/worlds/harry-potter-1/sessions`)).json();
const imported = listAfter.items.find((x) => x.title.includes('导入验证线') || x.title.includes('（导入）'));
ok('导入的世界线已入库', !!imported, imported?.title ?? listAfter.items.map((x) => x.title).join(','));
ok('导入后保留节点进度', !!imported?.state?.nodeId, imported?.state?.nodeId ?? '');
if (imported) await fetch(`${BASE}/api/sessions/${imported.id}`, { method: 'DELETE' });

console.log('\n[5] 错误导入被拦截');
const bad = await post('/api/sessions/import', { payload: save, worldId: 'last-train' });
ok('跨世界导入被拒绝', !!bad.error, bad.error ?? '未拦截');

console.log(`\nPAGE ERRORS: ${errors.length ? errors.slice(0, 2).join(' / ') : 'none'}`);
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);

ws.close();
child.kill();
process.exit(fail ? 1 : 0);
