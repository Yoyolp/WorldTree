/**
 * 无头浏览器验收：规则百科页
 *
 * 单元测试只能证明「数据对、渲染函数对」，证明不了「页面真的跑起来了」——
 * 比如组件挂载顺序、mdui 组件初始化、v-html 是否真的插进了 DOM。
 * 这个脚本用 Edge CDP 真开一个页面，检查渲染结果。
 *
 * 用法：
 *   node tools/ui-check-codex.mjs
 * 需要：
 *   WT_BASE（默认 http://127.0.0.1:5174）、WT_TOKEN
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9402;
const BASE = process.env.WT_BASE || 'http://127.0.0.1:5174';
const TOKEN = process.env.WT_TOKEN || '';

if (!TOKEN) {
  console.error('缺少 WT_TOKEN');
  process.exit(1);
}

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

const child = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=D:\\tmp_edge_codex',
    'about:blank',
  ],
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
  throw new Error('无法连接 CDP');
}

const ws = new WebSocket(await getWs());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
const errors = [];

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails.text);
  }
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
await s('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});

async function ev(expr) {
  const r = await s('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  }
  return r.result.value;
}

// 先落一个同源页面，才能写 localStorage
await s('Page.navigate', { url: `${BASE}/login` });
await sleep(900);
await ev(`localStorage.setItem('wt.token', ${JSON.stringify(TOKEN)})`);

console.log('\n[1] 打开百科页');
await s('Page.navigate', { url: `${BASE}/codex` });
await sleep(2600);

const boot = await ev(`(() => ({
  title: document.title,
  url: location.pathname,
  h1: (document.querySelector('h1') || {}).innerText || '',
  items: [...document.querySelectorAll('.wt-codex-item')].length,
  hasMain: !!document.querySelector('.wt-codex-main'),
}))()`);
ok('页面标题正确', String(boot.title).includes('规则百科'), boot.title);
ok('路由停在 /codex', boot.url === '/codex', boot.url);
ok('渲染出一级标题', boot.h1.includes('规则百科'), boot.h1);
ok('左侧列出规则书', boot.items >= 4, `${boot.items} 本`);
ok('右侧详情区已挂载', boot.hasMain === true);

console.log('\n[2] 默认选中第一本');
// 注意：.wt-codex-item 里第一个文本节点是图标名（如 casino），
// 取名字要用 .wt-codex-item-name，不能用 innerText 首行。
const first = await ev(`(() => {
  const active = document.querySelector('.wt-codex-item.active');
  const h2 = (document.querySelector('.wt-codex-hero h2') || {}).innerText || '';
  const name = active ? (active.querySelector('.wt-codex-item-name') || {}).innerText || '' : '';
  return { active: name, h2 };
})()`);
ok('有选中项', !!first.active, first.active);
ok('详情标题与选中项一致', first.h2.length > 0 && first.active.includes(first.h2.slice(0, 4)),
  `${first.active} → ${first.h2}`);

console.log('\n[3] 切到 D&D 规则书');
await ev(`(() => {
  const btns = [...document.querySelectorAll('.wt-codex-item')];
  const t = btns.find(b => b.innerText.includes('龙与地下城'));
  if (t) t.click();
  return !!t;
})()`);
await sleep(1200);

const dnd = await ev(`(() => ({
  h2: (document.querySelector('.wt-codex-hero h2') || {}).innerText || '',
  url: location.search,
  attrs: [...document.querySelectorAll('.wt-kv')].length,
  skillCards: [...document.querySelectorAll('.wt-skill-card')].length,
  derived: [...document.querySelectorAll('.wt-derived-chip')].length,
  toggles: [...document.querySelectorAll('.wt-toggle.on')].length,
  bodyHasAC: document.body.innerText.includes('AC'),
  bodyHasSpell: document.body.innerText.includes('法术位'),
  bodyHasSAN: /\\bSAN\\b/.test(document.body.innerText),
}))()`);
ok('标题切换成 D&D', dnd.h2.includes('龙与地下城'), dnd.h2);
ok('URL 带上 pack 参数（可分享）', dnd.url.includes('pack=dnd5e'), dnd.url);
ok('渲染出属性/资源表', dnd.attrs >= 2, `${dnd.attrs} 张表`);
ok('渲染出技能卡片', dnd.skillCards >= 10, `${dnd.skillCards} 张`);
ok('渲染出派生数值', dnd.derived >= 6, `${dnd.derived} 项`);
ok('有能力开关亮起', dnd.toggles >= 3, `${dnd.toggles} 个开启`);
ok('显示 AC', dnd.bodyHasAC);
ok('显示法术位', dnd.bodyHasSpell);
ok('D&D 面板不显示 SAN', !dnd.bodyHasSAN);

console.log('\n[4] 点开技能看效果');
await ev(`(() => {
  const c = document.querySelector('.wt-skill-card');
  if (c) c.click();
  return !!c;
})()`);
await sleep(700);

const detail = await ev(`(() => {
  const d = document.querySelector('.wt-skill-detail');
  if (!d) return { has: false };
  const md = d.querySelector('.wt-md');
  const ex = [...d.querySelectorAll('.wt-examples li')].map(e => e.innerText);
  return {
    has: true,
    name: (d.querySelector('strong') || {}).innerText || '',
    hasEffectHtml: !!md && md.children.length > 0,
    mdTags: md ? [...md.querySelectorAll('*')].map(e => e.tagName).slice(0, 12) : [],
    examples: ex.length,
    chips: [...d.querySelectorAll('.wt-chip')].map(e => e.innerText),
  };
})()`);
ok('技能详情面板出现', detail.has === true);
ok('显示了技能名', !!detail.name, detail.name);
ok('效果说明渲染成 HTML 结构', detail.hasEffectHtml === true, (detail.mdTags ?? []).join(','));
ok('列出用法示例', (detail.examples ?? 0) > 0, `${detail.examples} 条`);
ok('展示关联属性等信息', (detail.chips ?? []).length > 0, (detail.chips ?? []).join(' | '));

console.log('\n[5] 规则原文以 Markdown 渲染');
const doc = await ev(`(() => {
  const d = document.querySelector('.wt-codex-doc');
  if (!d) return { has: false };
  return {
    has: true,
    h1: d.querySelectorAll('h1').length,
    li: d.querySelectorAll('li').length,
    p: d.querySelectorAll('p').length,
    rawScript: d.innerHTML.includes('<script>'),
    rawBold: d.innerHTML.includes('**'),
  };
})()`);
ok('规则原文区块存在', doc.has === true);
ok('标题被解析成 h1', (doc.h1 ?? 0) > 0, `${doc.h1} 个`);
ok('列表被解析成 li', (doc.li ?? 0) > 0, `${doc.li} 个`);
ok('段落被解析成 p', (doc.p ?? 0) > 0, `${doc.p} 个`);
ok('没有未解析的 ** 残留', doc.rawBold === false);
ok('没有注入 script', doc.rawScript === false);

console.log('\n[6] 搜索与筛选');
// mdui-text-field 是 shadow DOM 组件，没有原生 <input> 子节点：
// 必须设自定义元素自己的 value 属性，再在它身上派发 input 事件。
const searchable = await ev(`(() => {
  const f = document.querySelector('.wt-codex-search');
  if (!f) return false;
  f.value = '克苏鲁';
  f.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
ok('找到搜索框', searchable === true);
await sleep(700);
const searched = await ev(`[...document.querySelectorAll('.wt-codex-item')].length`);
ok('搜索能过滤规则书', searched < 6 && searched >= 1, `${searched} 本`);

console.log('\n[7] 从别处带参数跳转进百科');
// 清掉搜索词，避免影响后续判断
await ev(`(() => {
  const f = document.querySelector('.wt-codex-search');
  if (f) { f.value = ''; f.dispatchEvent(new Event('input', { bubbles: true })); }
})()`);
await sleep(400);

await s('Page.navigate', { url: `${BASE}/codex?pack=coc7` });
await sleep(2200);
const jumped = await ev(`(() => {
  const active = document.querySelector('.wt-codex-item.active');
  return {
    h2: (document.querySelector('.wt-codex-hero h2') || {}).innerText || '',
    active: active ? (active.querySelector('.wt-codex-item-name') || {}).innerText || '' : '',
    bodyHasSAN: /\\bSAN\\b/.test(document.body.innerText),
  };
})()`);
ok('带 ?pack= 能直接定位', jumped.h2.includes('克苏鲁'), jumped.h2);
ok('选中项同步', jumped.active.includes('克苏鲁'), jumped.active);
ok('COC 面板显示 SAN', jumped.bodyHasSAN === true);

console.log('\n[8] 运行期无异常');
ok('没有未捕获的 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | '));

child.kill();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
