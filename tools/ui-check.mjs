/**
 * 无头浏览器交互验收（统一引擎版）
 * 用法：node tools/ui-check.mjs <sessionId>
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9401;
const BASE = 'http://127.0.0.1:5174';
const sessionId = process.argv[2];
if (!sessionId) throw new Error('需要 sessionId');

const child = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=D:\\tmp_edge_v2',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function getWs() {
  for (let i = 0; i < 50; i++) {
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
await s('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await s('Page.navigate', { url: `${BASE}/play/${sessionId}` });
await sleep(2600);

async function ev(expr) {
  const r = await s('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

const INIT_EXPR = [
  '({',
  '  msgs: document.querySelectorAll(".wt-msg").length,',
  '  choices: [...document.querySelectorAll(".wt-choice-text")].map(e => e.innerText),',
  '  pack: (document.querySelector(".wt-pack-chip") || {}).innerText || "",',
  '  scene: (document.querySelector(".wt-scene-chip") || {}).innerText || "",',
  '  hasSheet: document.body.innerText.includes("SAN"),',
  '  primary: getComputedStyle(document.documentElement).getPropertyValue("--mdui-color-primary").trim(),',
  '  iconFonts: [...document.querySelectorAll("span")].filter(e => /material-icons/.test(e.className)).length,',
  '})',
].join('\n');

console.log('INIT', JSON.stringify(await ev(INIT_EXPR), null, 1));

const CLICK_EXPR = [
  '(() => {',
  '  const btns = [...document.querySelectorAll(".wt-choice")];',
  '  const withCheck = btns.find(b => b.querySelector(".wt-choice-check"));',
  '  const t = withCheck || btns[0];',
  '  if (!t) return "no-choice";',
  '  t.click();',
  '  return t.innerText.replace(/\\n/g, " | ").trim();',
  '})()',
].join('\n');

console.log('CLICKED:', await ev(CLICK_EXPR));
await sleep(4500);

const AFTER_EXPR = [
  '(() => {',
  '  const b = [...document.querySelectorAll(".wt-msg")];',
  '  const roll = document.querySelector(".wt-roll");',
  '  const san = document.body.innerText.match(/SAN\\s*(\\d+)\\/(\\d+)/);',
  '  return {',
  '    msgs: b.length,',
  '    rollCard: roll ? roll.innerText.replace(/\\n/g, " | ").slice(0, 140) : null,',
  '    eventChips: [...document.querySelectorAll(".wt-event-name")].map(e => e.innerText),',
  '    choices: [...document.querySelectorAll(".wt-choice-text")].map(e => e.innerText),',
  '    lastText: b.length ? b[b.length - 1].innerText.slice(0, 160) : "",',
  '    san: san ? san.slice(1).join("/") : "",',
  '  };',
  '})()',
].join('\n');

console.log('AFTER', JSON.stringify(await ev(AFTER_EXPR), null, 1));
console.log('PAGE ERRORS', errors.length ? errors.slice(0, 3) : 'none');

ws.close();
child.kill();
process.exit(0);
