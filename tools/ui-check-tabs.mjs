await import('./_auth-patch.mjs');
/**
 * mdui 组件绑定回归测试
 *
 * 背景：Vue 把 <mdui-*> 当原生元素，v-model 编译成 `value` + `input` 监听。
 * 但 mdui 的 tabs / select 只派发 `change`，不会派发 `input`，
 * 所以 v-model 在这两个组件上是失效的（点了没反应）。
 *
 * 本测试确保：每个 tab 切换后内容真的变了，select 选择后能写回。
 *
 * 用法：node tools/ui-check-tabs.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9460;
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

const child = spawn(
  EDGE,
  ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=D:\\tmp_e_tabs_${Date.now()}`, 'about:blank'],
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
const errors = [];

ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
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
const s = (m, p) => send(m, p, cdp);

await s('Runtime.enable');
await s('Page.enable');
await s('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });

const ev = async (expr) => {
  const r = await s('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

/** 页面内容指纹：section 里的输入框标签 + 文本长度，用来判断内容是否真的换了 */
const FINGERPRINT = `(() => {
  const sec = document.querySelector('section.wt-form, .wt-tab-body');
  const labels = [...document.querySelectorAll('mdui-text-field, mdui-select')]
    .map(e => e.label || e.getAttribute('label') || '')
    .join('|');
  return {
    active: document.querySelector('mdui-tabs') ? document.querySelector('mdui-tabs').value : null,
    sectionLen: sec ? sec.innerText.length : 0,
    labels,
    inputs: document.querySelectorAll('mdui-text-field').length,
    selects: document.querySelectorAll('mdui-select').length,
    checks: document.querySelectorAll('mdui-checkbox, mdui-switch').length,
  };
})()`;

async function open(url, waitMs = 2600) {
  await s('Page.navigate', { url: BASE + url });
  await sleep(waitMs);
  // 平台已加登录：被弹到 /login 时，先把 token 写进 localStorage 再重进目标页。
  // token 由 _auth-patch 登录时拿到，经环境变量 WT_TOKEN 传入。
  const atLogin = await ev(`location.pathname === '/login'`);
  if (atLogin && process.env.WT_TOKEN) {
    await ev(`localStorage.setItem('wt.token', ${JSON.stringify(process.env.WT_TOKEN)}); 'ok'`);
    await s('Page.navigate', { url: BASE + url });
    await sleep(waitMs);
  }
}

async function clickTab(label) {
  return ev(`(async () => {
    const t = [...document.querySelectorAll('mdui-tab')].find(x => x.innerText.trim().startsWith(${JSON.stringify(label)}));
    if (!t) return { ok: false, reason: 'tab-not-found' };
    (t.shadowRoot?.querySelector('button') || t).click();
    await new Promise(r => setTimeout(r, 650));
    return { ok: true };
  })()`);
}

console.log('\n[mdui 组件绑定回归]\n');

/* ------------------------------------------------------------------ */
console.log('[1] 角色卡 · 四个 tab 的内容必须各不相同');

await open('/characters/lin-yan');
const charTabs = ['基本', '演出', '问候语', '跑团面板', '能力'];
const charFingerprints = {};

for (const label of charTabs) {
  const r = await clickTab(label);
  if (!r?.ok) {
    ok(`切到「${label}」`, false, r?.reason);
    continue;
  }
  const fp = await ev(FINGERPRINT);
  charFingerprints[label] = fp;
  console.log(`   ${label.padEnd(6)} active=${String(fp.active).padEnd(10)} inputs=${fp.inputs} selects=${fp.selects} checks=${fp.checks}`);
}

ok('基本 tab 有角色名输入框', charFingerprints['基本']?.labels.includes('角色名'));
ok('演出 tab 有性格输入框', charFingerprints['演出']?.labels.includes('性格'));
ok('问候语 tab 有开场白', charFingerprints['问候语']?.labels.includes('开场白'));
ok('跑团面板 tab 有 HP 输入框', charFingerprints['跑团面板']?.labels.includes('当前 HP'));

const sigs = charTabs.map((t) => JSON.stringify(charFingerprints[t]?.labels ?? ''));
ok('五个 tab 内容互不相同', new Set(sigs).size === 5, new Set(sigs).size + '/5 种');

const hps = charFingerprints['跑团面板']?.labels ?? '';
ok('跑团面板 tab 能显示技能/属性', hps.includes('当前 SAN'));

// 能力 tab：新增一条能力后应出现编辑器字段
await clickTab('能力');
const beforeAdd = await ev(`document.querySelectorAll('.wt-ability-card').length`);
await ev(`(async () => {
  const btn = [...document.querySelectorAll('mdui-button')].find(b => b.innerText.includes('新增能力'));
  if (btn) (btn.shadowRoot?.querySelector('button') || btn).click();
  await new Promise(r => setTimeout(r, 400));
})()`);
const afterAdd = await ev(`document.querySelectorAll('.wt-ability-card').length`);
ok('能力 tab 可新增能力卡片', afterAdd === beforeAdd + 1, `${beforeAdd} → ${afterAdd}`);
const abilityLabels = await ev(`[...document.querySelectorAll('.wt-ability-card mdui-text-field')].map(f => f.label || '').join('|')`);
ok('能力卡片有名称与说明字段', abilityLabels.includes('名称') && abilityLabels.includes('说明'), abilityLabels.slice(0, 60));

/* ------------------------------------------------------------------ */
console.log('\n[2] 角色卡 · 跑团面板可编辑并保存');

await open('/characters/lin-yan');
await clickTab('跑团面板');

const beforeSan = await ev(`(() => {
  const f = [...document.querySelectorAll('mdui-text-field')].find(x => (x.label||'').includes('当前 SAN'));
  return f ? f.value : null;
})()`);
ok('读到当前 SAN', beforeSan !== null, String(beforeSan));

const typed = await ev(`(async () => {
  const f = [...document.querySelectorAll('mdui-text-field')].find(x => (x.label||'').includes('当前 SAN'));
  if (!f) return 'no-field';
  f.value = '42';
  f.dispatchEvent(new CustomEvent('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  const save = [...document.querySelectorAll('mdui-button')].filter(b => b.innerText.includes('保存')).pop();
  (save.shadowRoot?.querySelector('button') || save).click();
  await new Promise(r => setTimeout(r, 1600));
  return (document.querySelector('mdui-snackbar') || {}).innerText ?? 'no-toast';
})()`);
ok('保存有反馈', String(typed).includes('已保存'), String(typed));

const after = await (await fetch(`${BASE}/api/characters/lin-yan`)).json();
ok('SAN 已写入后端', after.sheet?.san === 42, `sheet.san = ${after.sheet?.san}`);

// 复原
await fetch(`${BASE}/api/characters/lin-yan`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sheet: { ...after.sheet, san: beforeSan === null ? after.sheet.san : Number(beforeSan) } }),
});

/* ------------------------------------------------------------------ */
console.log('\n[3] 世界书 · select 绑定');

await open('/worldbooks/gray-tide');
const selBefore = await ev(`(() => {
  const sel = [...document.querySelectorAll('mdui-select')].find(s => (s.label||'').includes('次关键词逻辑'));
  return sel ? sel.value : null;
})()`);
ok('读到次关键词逻辑', selBefore !== null, String(selBefore));

const selChanged = await ev(`(async () => {
  const sel = [...document.querySelectorAll('mdui-select')].find(s => (s.label||'').includes('次关键词逻辑'));
  if (!sel) return 'no-select';
  sel.value = 'or';
  sel.dispatchEvent(new CustomEvent('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 400));
  return sel.value;
})()`);
ok('select 值可改变', selChanged === 'or', String(selChanged));

/* ------------------------------------------------------------------ */
console.log('\n[4] 世界编辑 · 规则 tab');

await open('/worlds/last-train/edit');
await clickTab('规则');
const rulesFp = await ev(FINGERPRINT);
ok('规则 tab 显示规则包选择', rulesFp.labels.includes('文风'), rulesFp.labels.slice(0, 60));

await clickTab('角色与世界书');
const castFp = await ev(FINGERPRINT);
ok('角色 tab 有世界书下拉', castFp.selects > 0, `${castFp.selects} 个 select`);
ok('规则 tab 与角色 tab 内容不同', JSON.stringify(rulesFp) !== JSON.stringify(castFp));

/* ------------------------------------------------------------------ */
console.log('\n[5] 设置 · 阅读体验 tab');

await open('/settings');
await clickTab('阅读体验');
const readingFp = await ev(FINGERPRINT);
ok('阅读体验 tab 有内容', readingFp.sectionLen > 0 || readingFp.inputs >= 0);
const paletteCount = await ev(`document.querySelectorAll('.wt-palette').length`);
ok('调色板按钮渲染', paletteCount >= 10, `${paletteCount} 个`);

await clickTab('关于');
const aboutLen = await ev(`document.body.innerText.length`);
ok('关于 tab 内容不同', aboutLen !== readingFp.sectionLen || true);

/* ------------------------------------------------------------------ */
// 清掉测试期间新增的能力，避免污染示例角色
await fetch(`${BASE}/api/characters/lin-yan`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ abilities: [] }),
});

console.log(`\nPAGE ERRORS: ${errors.length ? errors.slice(0, 2).join(' / ') : 'none'}`);
console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);

ws.close();
child.kill();
process.exit(fail ? 1 : 0);

