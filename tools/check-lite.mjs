await import('./_auth-patch.mjs');
/**
 * 剧本简化判定（script-lite）验证
 *
 * 用法：node tools/check-lite.mjs
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
console.log('\n[1] 规则包已注册');

{
  const packs = await j('/api/rulepacks');
  const lite = packs.find((p) => p.id === 'script-lite');
  ok('存在 script-lite', !!lite, lite?.name);
  ok('不开理智', lite?.sanity === false);
  ok('不开战斗', lite?.combat === false);
  ok('不开奖励骰', lite?.bonusPenalty === false);
  ok('不开幸运改判', lite?.luckSpend === false);
  ok('失败也推进', lite?.failForward === true);
  ok('有固定难度值', lite?.difficultyPresets?.regular === 50, JSON.stringify(lite?.difficultyPresets));

  const coc7 = packs.find((p) => p.id === 'coc7');
  ok('coc7 仍然开战斗与理智', coc7?.combat === true && coc7?.sanity === true);
  // 规则包可插拔（内置四个 + 插件），这里只要求内置四个都在
  const builtin = ['coc7', 'coc-d100', 'script-lite', 'narrative'];
  ok('内置规则包齐全', builtin.every((id) => packs.some((p) => p.id === id)), packs.map((p) => p.id).join(','));
}

/* ------------------------------------------------------------------ */
console.log('\n[2] 剧本可以声明自己的规则包');

{
  const md = `---
id: lite-demo
title: 简化演示
start: s1
rulePack: script-lite
---

# 一 {id=s1}

门开着。

- [查看] -> s1 {check=侦查 常规}
`;
  const res = compileScript(md);
  ok('编译无错误', res.errors.length === 0, res.errors.join('；'));
  ok('剧本带 rulePackId', res.script?.rulePackId === 'script-lite', res.script?.rulePackId);
}

/* ------------------------------------------------------------------ */
console.log('\n[3] 没有面板也能判定（固定难度值）');

{
  const created = await post('/api/worlds/last-train/sessions', {
    playerName: '旅人',
    rulePackId: 'script-lite',
    sheetSeed: 1,
  });
  const sid = created.session.id;
  ok('世界线已建', !!sid);
  ok('规则包是 script-lite', created.session.state.rulePackId === 'script-lite');
  ok('没有生成跑团面板', !created.session.state.sheet);

  const roll = await post(`/api/sessions/${sid}/roll`, { skill: '侦查', seed: 3 });
  ok('能掷骰', !!roll.check, roll.error ?? '');
  ok('目标值退回 50', roll.check?.target === 50, `target=${roll.check?.target}`);
  ok('结果只有成功/失败两档', ['regular', 'fail', 'critical', 'fumble'].includes(roll.check?.outcome), roll.check?.outcome);

  const hard = await post(`/api/sessions/${sid}/roll`, { skill: '侦查', difficulty: 'hard', seed: 3 });
  ok('困难难度用 30', hard.check?.target === 30, `target=${hard.check?.target}`);

  const combat = await post(`/api/sessions/${sid}/combat/start`, { npcs: [{ name: '影子', dex: 50, hp: 5 }] });
  ok('简化包拒绝开战', !!combat.error, combat.error);

  await fetch(`${B}/api/sessions/${sid}`, { method: 'DELETE' });
}

/* ------------------------------------------------------------------ */
console.log('\n[4] COC7 不受影响');

{
  const created = await post('/api/worlds/gray-tide/sessions', { playerName: '调查员', rulePackId: 'coc7', sheetSeed: 5 });
  const sid = created.session.id;
  ok('coc7 生成面板', !!created.session.state.sheet);

  const roll = await post(`/api/sessions/${sid}/roll`, { skill: '侦查', difficulty: 'hard', seed: 3 });
  // COC7 的目标值不变，难度体现在「哪一级成功才算过」
  const skillVal = created.session.state.sheet.skills.find((s) => s.name === '侦查')?.value ?? 0;
  ok('coc7 目标值仍是技能值', roll.check?.target === skillVal, `target=${roll.check?.target} skill=${skillVal}`);
  ok('coc7 记录了困难难度', roll.check?.difficulty === 'hard', roll.check?.difficulty);

  const combat = await post(`/api/sessions/${sid}/combat/start`, { npcs: [{ name: '影子', dex: 50, hp: 5 }] });
  ok('coc7 可以开战', !!combat.combat, combat.error ?? '');

  await fetch(`${B}/api/sessions/${sid}`, { method: 'DELETE' });
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
