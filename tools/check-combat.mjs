await import('./_auth-patch.mjs');
/**
 * 战斗流程 + SAN 检定接入 验证
 *
 * 用法：node tools/check-combat.mjs
 */
import { compileScript } from '../packages/shared/src/script-dsl.ts';

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
console.log('\n[1] 剧本 DSL 支持理智检定');

{
  const md = `---
id: san-test
title: 理智测试
start: s1
---

# 一 {id=s1}

走廊尽头的门开着。

::: event 目睹 {id=evt_san} once sanCheck=1/1d10
门后那东西转过头来。
:::

- [继续] -> s1
`;
  const res = compileScript(md);
  const evt = res.script?.events?.[0] ?? res.script?.nodes?.[0]?.events?.[0];
  ok('编译无错误', res.errors.length === 0, res.errors.join('；'));
  ok('事件带 sanCheck', !!evt?.sanCheck, JSON.stringify(evt?.sanCheck));
  ok('成功/失败档位正确', evt?.sanCheck?.successLoss === '1' && evt?.sanCheck?.failLoss === '1d10');
}

/* ------------------------------------------------------------------ */
console.log('\n[2] 战斗流程');

const created = await post('/api/worlds/gray-tide/sessions', { playerName: '调查员', sheetSeed: 4242 });
const sid = created.session.id;
ok('世界线已建', !!sid);
ok('有跑团面板', !!created.session.state.sheet, `HP ${created.session.state.sheet?.hp}/${created.session.state.sheet?.hpMax}`);

const started = await post(`/api/sessions/${sid}/combat/start`, {
  npcs: [{ name: '雾中影', dex: 55, hp: 10 }],
  seed: 99,
});
ok('战斗开始', !!started.combat?.active, started.error ?? '');
ok('双方都在场', started.combat?.combatants.length === 2, started.combat?.combatants.map((c) => c.name).join(' vs '));
ok('有先攻顺序', (started.combat?.order.length ?? 0) === 2, started.combat?.order.join(' → '));

const playerC = started.combat.combatants.find((c) => c.id === 'm_player');
const npcC = started.combat.combatants.find((c) => c.id !== 'm_player');
ok('玩家单位 ID 正确', !!playerC, playerC?.name);
ok('NPC 血量记录', npcC?.hp === 10, `hp=${npcC?.hp}`);

const hit = await post(`/api/sessions/${sid}/combat/attack`, {
  attackerId: playerC.id,
  defenderId: npcC.id,
  weapon: '小刀',
  defense: 'dodge',
  seed: 12345,
});
ok('攻击有结果', !!hit.combat, hit.error ?? '');
ok('有检定明细', (hit.log ?? []).length > 0, (hit.log ?? [])[0]?.slice(0, 70));
const npcAfter = hit.combat.combatants.find((c) => c.id === npcC.id);
ok('命中则扣血', npcAfter.hp <= npcC.hp, `hp ${npcC.hp} → ${npcAfter.hp}`);
ok('战斗日志累积', (hit.combat.log ?? []).length >= 2, `${hit.combat.log.length} 条`);

const next = await post(`/api/sessions/${sid}/combat/next`, {});
ok('回合能推进', !!next.combat, next.error ?? '');
ok('轮次或索引变化', next.combat.turnIndex !== started.combat.turnIndex || next.combat.round !== started.combat.round,
  `round=${next.combat.round} idx=${next.combat.turnIndex}`);

const ended = await post(`/api/sessions/${sid}/combat/end`, {});
ok('战斗可以结束', ended.combat === null, String(ended.combat));

const detail = await j(`/api/sessions/${sid}`);
ok('战斗状态已清空', !detail.session.state.combat);
ok('HP 写回了面板', detail.session.state.sheet.hp === npcC.hp || detail.session.state.sheet.hp <= created.session.state.sheet.hp,
  `面板 HP = ${detail.session.state.sheet.hp}`);

/* ------------------------------------------------------------------ */
console.log('\n[3] 战斗外不能攻击');
{
  const bad = await post(`/api/sessions/${sid}/combat/attack`, { attackerId: 'x', defenderId: 'y' });
  ok('不在战斗中时拒绝攻击', !!bad.error, bad.error);
}

await fetch(`${B}/api/sessions/${sid}`, { method: 'DELETE' });

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
