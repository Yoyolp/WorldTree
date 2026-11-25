await import('./_auth-patch.mjs');
/**
 * 剧情插曲（A 条件变体 / B 日常事件池 / C 偏离=额外回合）
 *
 * 用法：npx tsx tools/check-plot.mjs
 * 前置：服务端已启动在 127.0.0.1:5174
 */
import { readFileSync } from 'node:fs';
import { compileScript } from '../packages/shared/src/script-dsl.ts';
import {
  emptyEventState,
  eventAvailable,
  conditionsMet,
  fireEvents,
} from '../packages/shared/src/events.ts';
import { splitMeta, META_START, META_END } from '../packages/shared/src/protocol.ts';
import {
  plotInterlude,
  PLOT_HARD_RETURN,
  PLOT_SOFT_RETURN,
  PLOT_MOTIFS,
} from '../apps/server/src/llm/prompt.ts';
import { buildOllamaBody } from '../apps/server/src/llm/client.ts';

const B = process.env.WT_BASE ?? 'http://127.0.0.1:5174';
const j = async (p) => (await fetch(B + p)).json();
const post = async (p, b) =>
  (await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();

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

/* ------------------------------------------------------------------ */
console.log('\n[1] 剧本编译：条件变体与日常事件池');

const md = readFileSync(new URL('../apps/server/content/scripts/harry-potter-1.md', import.meta.url), 'utf8');
const compiled = compileScript(md, { filename: 'harry-potter-1.md' });
const script = compiled.script;

ok('编译无错误', compiled.errors.length === 0, compiled.errors.slice(0, 3).join('; '));
ok('节点数仍是 45', script.nodes.length === 45, `${script.nodes.length}`);
ok('世界级事件 22 条（日常池）', script.events.length === 22, `${script.events.length}`);

const pool = script.events;
ok('日常池全部是 turn_start', pool.every((e) => e.trigger === 'turn_start'));
ok('日常池都带概率', pool.every((e) => e.chance > 0 && e.chance < 1));
ok('日常池都带冷却', pool.every((e) => e.cooldown > 0));
ok('日常池都按节点门控', pool.every((e) => e.conditions?.some((c) => c.type === 'node')));
ok('日常池都是一次性', pool.every((e) => e.once));

/* ------------------------------------------------------------------ */
console.log('\n[2] A · 条件变体互斥');

const allEvents = [...script.events, ...script.nodes.flatMap((n) => n.events)];
const byName = (n) => allEvents.find((e) => e.name === n);
const baseState = (flags, nodeId = 'ch09') => ({
  vars: {},
  flags,
  scene: '',
  nodeId,
  events: emptyEventState(),
  rulePackId: 'coc7',
  seed: 1,
});
const canFire = (ev, state) =>
  !!ev && eventAvailable(ev, ev.trigger, state.events) && conditionsMet(ev.conditions, { state, turn: 1 });

{
  // 斯内普的目光：斯莱特林一套，别院一套
  const normal = byName('斯内普的目光');
  const sly = byName('斯内普的目光·斯莱特林');
  ok('两版斯内普的目光都在', !!normal && !!sly);
  ok('格兰芬多 → 只有常规版',
    canFire(normal, baseState(['分院·格兰芬多'])) && !canFire(sly, baseState(['分院·格兰芬多'])));
  ok('斯莱特林 → 只有斯莱特林版',
    canFire(sly, baseState(['分院·斯莱特林'])) && !canFire(normal, baseState(['分院·斯莱特林'])));
  ok('未分院时 → 常规版',
    canFire(normal, baseState([])) && !canFire(sly, baseState([])));
}

{
  // 抢球：是否扶过纳威
  const normal = byName('抢球');
  const nev = byName('抢球·纳威的提醒');
  const st = (flags) => baseState(flags, 'ch10');
  ok('两版抢球都在', !!normal && !!nev);
  ok('没扶纳威 → 常规版', canFire(normal, st([])) && !canFire(nev, st([])));
  ok('扶过纳威 → 纳威版', canFire(nev, st(['与纳威交好'])) && !canFire(normal, st(['与纳威交好'])));
}

{
  // 奇洛的坦白：是否早就怀疑过斯内普
  const normal = byName('奇洛的坦白');
  const sus = byName('奇洛的坦白·你早就怀疑过');
  const st = (flags) => baseState(flags, 'ch21');
  ok('两版坦白都在', !!normal && !!sus);
  ok('没察觉矛盾 → 常规版', canFire(normal, st([])) && !canFire(sus, st([])));
  ok('察觉矛盾 → 「你早就怀疑过」版',
    canFire(sus, st(['察觉斯内普的矛盾'])) && !canFire(normal, st(['察觉斯内普的矛盾'])));
}

/* ------------------------------------------------------------------ */
console.log('\n[3] B · 日常事件按节点触发');

{
  const fire = (nodeId, events, state) =>
    fireEvents({
      events,
      trigger: 'turn_start',
      ctx: { state: { ...state, nodeId, events: state.events }, turn: 1, rng: () => 0 },
    });

  const st = baseState([]);
  const ch01 = fire('ch01', pool, st);
  ok('ch01 触发猫头鹰第二封', ch01.records.length === 1 && ch01.records[0].name === '猫头鹰的第二封信',
    ch01.records.map((r) => r.name).join(','));

  const ch02 = fire('ch02', pool, { ...st, events: ch01.state });
  ok('ch02 触发收音机，且不重复触发 ch01 的', ch02.records.length === 1 && ch02.records[0].name === '收音机自己响了',
    ch02.records.map((r) => r.name).join(','));

  const again = fire('ch01', pool, { ...st, events: ch01.state });
  ok('once 事件不会再次触发', again.records.length === 0);

  const nowhere = fire('ch21b', pool, st);
  ok('没有挂事件的节点不触发任何日常事件', nowhere.records.length === 0,
    nowhere.records.map((r) => r.name).join(',') || '无');

  // 学院专属：同一条节点上对应的那条一定会出现，别的学院那条一定不出现
  const sl = fire('ch12', pool, baseState(['分院·斯莱特林'], 'ch12'));
  const hp = fire('ch12', pool, baseState(['分院·赫奇帕奇'], 'ch12'));
  ok('ch12 斯莱特林 → 出斯莱特林看台，且不出赫奇帕奇看台',
    sl.records.some((r) => r.name === '斯莱特林看台') && !sl.records.some((r) => r.name === '赫奇帕奇看台'),
    sl.records.map((r) => r.name).join(','));
  ok('ch12 赫奇帕奇 → 出赫奇帕奇看台，且不出斯莱特林看台',
    hp.records.some((r) => r.name === '赫奇帕奇看台') && !hp.records.some((r) => r.name === '斯莱特林看台'),
    hp.records.map((r) => r.name).join(','));
}

/* ------------------------------------------------------------------ */
console.log('\n[4] C · 偏离 = 额外回合（插曲），收束只是兜底');

ok('不偏离时没有插曲块', plotInterlude({ plotDrift: 0 }) === null);
{
  const l1 = plotInterlude({ plotDrift: 1, currentNodeTitle: '第九章 · 第一堂魔药课' });
  ok('偏离 1 回合：当成额外回合', !!l1 && l1.includes('额外回合') && l1.includes('第一堂魔药课'));
  ok('偏离 1 回合：不硬拉回主线', !!l1 && !l1.includes('强制'));
  ok('偏离 1 回合：没有 goto 指令', !!l1 && !l1.includes('"goto"'));
  ok('偏离 1 回合：给默认母题', !!l1 && l1.includes('走廊尽头传来不该有的声音'));

  const withMotifs = plotInterlude({
    plotDrift: 2,
    currentNodeTitle: '第一章',
    motifs: ['费尔奇和他的猫堵在走廊尽头', '某扇门的把手是热的'],
  });
  ok('母题被写进提示词',
    !!withMotifs && withMotifs.includes('费尔奇和他的猫') && withMotifs.includes('某扇门的把手是热的'));

  const soft = plotInterlude({ plotDrift: PLOT_SOFT_RETURN, currentNodeTitle: 'X' });
  ok(`偏离 ${PLOT_SOFT_RETURN} 回合：开始给台阶`, !!soft && soft.includes('台阶'));

  const hard = plotInterlude({
    plotDrift: PLOT_HARD_RETURN,
    currentNodeTitle: '第九章 · 第一堂魔药课',
    plotTargetId: 'ch10',
  });
  ok(`偏离 ${PLOT_HARD_RETURN} 回合：启用兜底收束`, !!hard && hard.includes('兜底'));
  ok('兜底给出 goto', !!hard && hard.includes('"goto": "ch10"'));
  ok('兜底也不许提「剧本」字样', !!hard && hard.includes('不要提「主线」「剧本」'));

  const l9 = plotInterlude({ plotDrift: 9, currentNodeTitle: 'X' });
  ok('偏离再久也不无限升级（文案不变）',
    !!l9 && l9.includes('额外回合') && !l9.includes('第 9'));

  ok('母题库够用（≥8 条）', PLOT_MOTIFS.length >= 8, `${PLOT_MOTIFS.length}`);
}

/* ------------------------------------------------------------------ */
console.log('\n[5] 截断容错 · 本地补齐救回选项');

{
  // 模型写到一半断掉：没有结束标记、JSON 缺右括号
  const broken = `雾从门缝里渗进来。\n\n${META_START}\n{"choices":[{"text":"推门进去","check":{"skill":"侦查","difficulty":"regular"}},{"text":"退回雾里"}],"scene":"仓库门口"`;
  const parsed = splitMeta(broken);
  ok('标记后残缺的 JSON 被本地补齐', !!parsed.meta, parsed.meta ? 'ok' : 'null');
  ok('选项救回来了', (parsed.meta?.choices ?? []).length === 2, `${(parsed.meta?.choices ?? []).length} 个`);
  ok('被标记为截断', parsed.truncated === true);
  ok('正文里没有标记残留', !parsed.text.includes(META_START), JSON.stringify(parsed.text.slice(-40)));

  const complete = `正文\n\n${META_START}\n{"choices":[{"text":"A"}],"scene":"x"}\n${META_END}`;
  const good = splitMeta(complete);
  ok('完整输出不算截断', good.truncated === false && !!good.meta);
}

{
  const turns = [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }];
  const base = {
    provider: 'ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKey: '',
    model: 'qwen2.5:7b',
    temperature: 0.8,
    topP: 0.9,
    maxTokens: 2048,
    presencePenalty: 0,
    frequencyPenalty: 0,
    contextBudget: 24000,
    contextWindow: 12288,
    timeoutMs: 1000,
    stream: true,
  };
  const withCtx = buildOllamaBody({ ...base, numCtx: 12288 }, turns);
  ok('ollama 请求带上 num_ctx', withCtx.options?.num_ctx === 12288, `${withCtx.options?.num_ctx}`);
  ok('ollama 走原生 messages 结构', Array.isArray(withCtx.messages) && withCtx.messages.length === 2);

  const fallback = buildOllamaBody({ ...base, numCtx: 0 }, turns);
  ok('没填 num_ctx 时退回上下文窗口', fallback.options?.num_ctx === 12288, `${fallback.options?.num_ctx}`);

  const merged = buildOllamaBody({ ...base, numCtx: 8192, extraBody: '{"options":{"repeat_penalty":1.1},"keep_alive":"5m"}' }, turns);
  ok('extraBody 合并进 options', merged.options?.repeat_penalty === 1.1);
  ok('extraBody 的其它字段留在顶层', merged.keep_alive === '5m');
}

/* ------------------------------------------------------------------ */
console.log('\n[6] 端到端：自由行动不推进 → 计入偏离 → 选项后归零（全程无 log）');

{
  const created = await post('/api/worlds/harry-potter-1/sessions', { playerName: '一年级新生', sheetSeed: 2024 });
  const sid = created.session?.id;
  ok('世界线已建', !!sid);
  ok('起始节点是 ch01', created.session?.state?.nodeId === 'ch01', created.session?.state?.nodeId);

  const driftOf = (r) => r.done?.message?.meta?.plotDrift ?? r.done?.session?.state?.plotDrift ?? 0;
  const notices = (r) =>
    (r.events ?? []).filter((e) => e.type === 'notice' && /偏离|收束|拉回/.test(String(e.text)));

  // 三次自由行动：都不选剧本选项，节点不动，偏离应当累积
  const t1 = await post('/api/chat', { sessionId: sid, content: '我在车厢里翻自己的口袋，把每样东西都摆出来数了一遍', intent: 'action' });
  ok('第 1 回合完成', !!t1.done, t1.error ?? '');
  ok('第 1 回合偏离 = 1', driftOf(t1) === 1, `${driftOf(t1)}`);
  ok('第 1 回合没有偏离 log', notices(t1).length === 0, notices(t1).map((e) => e.text).join(' | '));

  const t2 = await post('/api/chat', { sessionId: sid, content: '我继续整理口袋，把信纸叠成方块又展开', intent: 'action' });
  ok('第 2 回合偏离 = 2', driftOf(t2) === 2, `${driftOf(t2)}`);
  ok('第 2 回合也没有偏离 log（界面不显示）', notices(t2).length === 0, notices(t2).map((e) => e.text).join(' | '));
  ok('第 2 回合选项正常给出', (t2.done?.message?.meta?.choices ?? []).length > 0,
    (t2.done?.message?.meta?.choices ?? []).map((c) => c.text).join(' / '));

  const t3 = await post('/api/chat', { sessionId: sid, content: '我把口袋翻过来抖了抖', intent: 'action' });
  ok('第 3 回合偏离 = 3', driftOf(t3) === 3, `${driftOf(t3)}`);
  ok('第 3 回合仍然没有 log', notices(t3).length === 0, notices(t3).map((e) => e.text).join(' | '));

  const saved = await j(`/api/sessions/${sid}`);
  ok('偏离计数已落库', saved.session.state.plotDrift === 3, `${saved.session.state.plotDrift}`);

  // 点一个能推进的剧本选项 → 回到主线
  const choices = t3.done?.message?.meta?.choices ?? [];
  const advancing = choices.find((c) => c.next);
  ok('存在可以推进的选项', !!advancing, advancing ? `${advancing.text}→${advancing.next}` : '无');
  if (advancing) {
    const t4 = await post('/api/chat', {
      sessionId: sid,
      content: advancing.text,
      intent: 'choice',
      choiceId: advancing.id,
      goto: advancing.next,
    });
    ok('推进回合完成', !!t4.done, t4.error ?? '');
    ok('偏离计数归零', (t4.done?.session?.state?.plotDrift ?? -1) === 0, `${t4.done?.session?.state?.plotDrift}`);
    ok('节点已前进', t4.done?.session?.state?.nodeId !== 'ch01', t4.done?.session?.state?.nodeId);
  }

  await fetch(`${B}/api/sessions/${sid}`, { method: 'DELETE' });
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);