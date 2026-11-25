/**
 * 验收：角色卡编辑页的规则书下拉菜单
 *
 * 确认两件事：
 *   1. 规则书选择器是下拉菜单（mdui-select），不是并排按钮
 *   2. 切换规则书后面板字段跟着变
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9404;
const BASE = process.env.WT_BASE || 'http://127.0.0.1:5199';
const TOKEN = process.env.WT_TOKEN || '';

let pass = 0, fail = 0;
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const child = spawn(EDGE, ['--headless=new','--disable-gpu','--no-first-run',
  `--remote-debugging-port=${PORT}`,'--user-data-dir=D:\\tmp_edge_select','about:blank'], { stdio: 'ignore' });

async function getWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch { /* wait */ }
    await sleep(250);
  }
  throw new Error('no cdp');
}
const ws = new WebSocket(await getWs());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
});
const send = (method, params = {}, sess) => { const mid = ++id; return new Promise((res, rej) => { pending.set(mid, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: mid, method, params, sessionId: sess })); }); };
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId: cdp } = await send('Target.attachToTarget', { targetId, flatten: true });
const s = (m, p) => send(m, p, cdp);
await s('Runtime.enable'); await s('Page.enable');
await s('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

async function ev(expr) {
  const r = await s('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

await s('Page.navigate', { url: `${BASE}/login` });
await sleep(900);
await ev(`localStorage.setItem('wt.token', ${JSON.stringify(TOKEN)})`);

// 建一张带 COC 面板的临时卡
const mk = await ev(`(async () => {
  const r = await fetch('/api/characters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('wt.token') },
    body: JSON.stringify({
      name: '下拉菜单测试卡',
      sheet: {
        rulePackId: 'coc7',
        attributes: { STR: 50, CON: 50, SIZ: 50, DEX: 50, APP: 50, INT: 50, POW: 50, EDU: 50, LUCK: 50 },
        skills: [{ name: '侦查', value: 25 }],
        hp: 10, hpMax: 10, mp: 10, mpMax: 10, san: 50, sanMax: 50,
        luck: 50, luckMax: 50, conditions: [], items: []
      }
    }),
  });
  const j = await r.json();
  return j.id || '';
})()`);
ok('测试角色卡已创建', !!mk, mk);

console.log('\n[1] 面板页用下拉菜单选规则书');
await s('Page.navigate', { url: `${BASE}/characters/${mk}` });
await sleep(2400);

// 切到「面板」tab
await ev(`(() => {
  const tabs = [...document.querySelectorAll('mdui-tab')];
  const t = tabs.find(x => (x.textContent || '').includes('面板'));
  if (t) t.click();
  return !!t;
})()`);
await sleep(900);

const ui = await ev(`(() => {
  const section = [...document.querySelectorAll('section')].find(s => s.innerText.includes('使用的规则书'));
  if (!section) return { found: false };
  const sel = section.querySelector('mdui-select');
  const chips = section.querySelectorAll('button.wt-pack-chip');
  const picker = section.querySelector('.wt-pack-picker');
  return {
    found: true,
    hasSelect: !!sel,
    selectValue: sel ? (sel.value || sel.getAttribute('value') || '') : '',
    selectOptions: sel ? [...sel.querySelectorAll('mdui-menu-item')].map(i => i.getAttribute('value')) : [],
    chipCount: chips.length,
    hasOldPicker: !!picker,
    hasCodexLink: section.innerText.includes('查看规则'),
  };
})()`);
ok('找到规则书面板区', ui.found === true);
ok('是下拉菜单（mdui-select）', ui.hasSelect === true);
ok('下拉菜单有多个选项', (ui.selectOptions ?? []).length >= 2, (ui.selectOptions ?? []).join(','));
ok('当前值绑定到 coc7', ui.selectValue === 'coc7', ui.selectValue);
ok('不再渲染并排按钮', ui.chipCount === 0 && ui.hasOldPicker === false, `chips=${ui.chipCount}`);
ok('有跳到百科的入口', ui.hasCodexLink === true);

console.log('\n[2] 切换规则书后字段跟着变');
const before = await ev(`(() => {
  const section = [...document.querySelectorAll('section')].find(s => s.innerText.includes('使用的规则书'));
  return {
    attrBoxes: section ? section.querySelectorAll('.wt-attr-box').length : 0,
    resBoxes: section ? section.querySelectorAll('.wt-res-box').length : 0,
    labels: section ? [...section.querySelectorAll('.wt-attr-label')].map(e => e.innerText).join('|') : '',
  };
})()`);
ok('COC 显示九属性', before.attrBoxes === 9, `${before.attrBoxes} 个`);
ok('COC 显示三个资源', before.resBoxes === 3, `${before.resBoxes} 个`);

// 通过下拉菜单切到 dnd5e
await ev(`(() => {
  const section = [...document.querySelectorAll('section')].find(s => s.innerText.includes('使用的规则书'));
  const sel = section.querySelector('mdui-select');
  sel.value = 'dnd5e';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await sleep(1200);

const after = await ev(`(() => {
  const section = [...document.querySelectorAll('section')].find(s => s.innerText.includes('使用的规则书'));
  return {
    attrBoxes: section ? section.querySelectorAll('.wt-attr-box').length : 0,
    resBoxes: section ? section.querySelectorAll('.wt-res-box').length : 0,
    bodyHasWIS: document.body.innerText.includes('感知'),
    bodyHasSIZ: document.body.innerText.includes('体型'),
  };
})()`);
ok('切到 D&D 后变成六属性', after.attrBoxes === 6, `${after.attrBoxes} 个`);
ok('D&D 资源含 AC', after.resBoxes === 3, `${after.resBoxes} 个`);
ok('出现感知属性', after.bodyHasWIS === true);
ok('COC 专属字段不再显示', after.bodyHasSIZ === false);

console.log('\n[3] 保存后规则书标记写回');
await ev(`(() => {
  const btns = [...document.querySelectorAll('mdui-button')];
  const b = btns.find(x => (x.textContent || '').includes('保存'));
  if (b) b.click();
  return !!b;
})()`);
await sleep(1600);

const saved = await ev(`(async () => {
  const r = await fetch('/api/characters/${mk}', { headers: { Authorization: 'Bearer ' + localStorage.getItem('wt.token') } });
  const j = await r.json();
  const keys = j.sheet ? Object.keys(j.sheet.attributes) : [];
  return {
    rulePackId: j.sheet && j.sheet.rulePackId,
    attrKeys: keys.length,
    keys,
    hasAc: !!(j.sheet && j.sheet.resources && typeof j.sheet.resources.ac === 'number'),
  };
})()`);
ok('角色卡记住了新规则书', saved.rulePackId === 'dnd5e', saved.rulePackId);
// 迁移的语义是「只补不删」：D&D 的六属性全在，COC 多出来的
// SIZ/APP/POW/EDU/LUCK 保留原处（切回去还要用），所以总数会超过 6。
ok('D&D 的六属性齐全',
  ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].every((k) => saved.keys.includes(k)),
  saved.keys.join(','));
ok('COC 独有属性没有被删掉', saved.keys.includes('SIZ'), `${saved.attrKeys} 个键`);
ok('迁移后补上了 AC 资源', saved.hasAc === true);

console.log('\n[4] 清理与异常');
await ev(`fetch('/api/characters/${mk}', { method: 'DELETE', headers: { Authorization: 'Bearer ' + localStorage.getItem('wt.token') } }).then(r => r.status)`);
ok('清理完成', true);
ok('没有未捕获的 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | '));

child.kill();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
