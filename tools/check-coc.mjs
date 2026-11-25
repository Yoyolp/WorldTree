await import('./_auth-patch.mjs');
/**
 * COC7 检定引擎单测
 *
 * 用法：npx tsx tools/check-coc.mjs
 */
import {
  applyDamage,
  damageBonus,
  improvementCheck,
  makeCombatant,
  opposedCheck,
  progressExtended,
  resolveAttack,
  resolveDamageExpr,
  rollInitiative,
  sanCheck,
  startCombat,
  startExtendedCheck,
  teamCheck,
  advanceCombatTurn,
  currentCombatant,
  WEAPONS,
} from '../packages/shared/src/coc-checks.ts';
import { makeRng } from '../packages/shared/src/protocol.ts';
import { getRulePack } from '../packages/shared/src/rulepacks.ts';

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

const coc7 = getRulePack('coc7');

/** 造一个可控的 rollSkill：按队列返回结果 */
function scriptedRoller(queue) {
  let i = 0;
  return (skill, target, difficulty = 'regular', bonus = 0) => {
    const item = queue[i++] ?? { roll: target, success: true };
    const outcome = item.outcome ?? (item.success ? 'regular' : 'fail');
    return {
      skill,
      target,
      difficulty,
      bonus,
      candidates: [item.roll],
      roll: item.roll,
      outcome,
      success: item.success,
      label: item.success ? '常规成功' : '失败',
      detail: `掷出 ${item.roll}，目标 ${target}`,
    };
  };
}

const sheet = {
  attributes: { STR: 60, CON: 55, SIZ: 65, DEX: 70, APP: 50, INT: 65, POW: 60, EDU: 70, LUCK: 55 },
  skills: [
    { name: '侦查', value: 65 },
    { name: '格斗', value: 50 },
    { name: '闪避', value: 40 },
  ],
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

/* ------------------------------------------------------------------ */
console.log('\n[1] 理智检定');

{
  // 成功：1/1d10 只掉 1
  const out = sanCheck(sheet, { successLoss: '1', failLoss: '1d10' }, coc7, makeRng(1), scriptedRoller([{ roll: 30, success: true }]));
  ok('成功只掉成功档位的损失', out.loss === 1, `loss=${out.loss} 表达式 ${out.expression}`);
  ok('理智被扣减', out.sanAfter === 59, `sanAfter=${out.sanAfter}`);
  ok('未陷入疯狂', !out.temporaryInsane);
}

{
  // 失败：掉 1d10，可能 ≥5 → 临时疯狂
  const out = sanCheck(sheet, { successLoss: '1', failLoss: '1d10' }, coc7, makeRng(7), scriptedRoller([{ roll: 90, success: false }]));
  ok('失败掉失败档位的损失', out.loss >= 1, `loss=${out.loss}`);
  ok('SAN 相应减少', out.sanAfter === 60 - out.loss, `${out.sanAfter}`);
}

{
  // 强制大额损失：1d10 最大 10，用固定表达式 10
  const out = sanCheck(sheet, { successLoss: '0', failLoss: '10' }, coc7, makeRng(3), scriptedRoller([
    { roll: 95, success: false },   // 理智检定失败
    { roll: 20, success: true },    // INT 成功 → 发作
  ]));
  ok('单次损失 ≥5 判定临时疯狂', out.loss >= 5 && out.temporaryInsane, `loss=${out.loss}`);
  ok('临时疯狂有发作表现', !!out.bout, out.bout ?? '无');
}

{
  // SAN 归零 → 永久疯狂
  const low = { ...sheet, san: 3 };
  const out = sanCheck(low, { successLoss: '0', failLoss: '10' }, coc7, makeRng(3), scriptedRoller([{ roll: 99, success: false }]));
  ok('SAN 归零即永久疯狂', out.permanentInsane, `sanAfter=${out.sanAfter}`);
  ok('SAN 不会为负', out.sanAfter === 0);
}

/* ------------------------------------------------------------------ */
console.log('\n[2] 对抗检定');

{
  const out = opposedCheck(
    { actor: { name: '你', skill: '格斗', target: 50 }, target: { name: '列车员', skill: '闪避', target: 40 } },
    scriptedRoller([
      { roll: 10, success: true, outcome: 'extreme' },
      { roll: 35, success: true, outcome: 'regular' },
    ]),
  );
  ok('成功等级高者胜', out.winner === 'actor', out.detail);
  ok('差值正确', out.margin === 2, `margin=${out.margin}`);
}

{
  const out = opposedCheck(
    { actor: { name: '你', skill: '格斗', target: 50 }, target: { name: '列车员', skill: '闪避', target: 40 } },
    scriptedRoller([
      { roll: 60, success: false },
      { roll: 30, success: true },
    ]),
  );
  ok('失败方输', out.winner === 'target', out.detail);
}

{
  // 同级 → 技能高者胜
  const out = opposedCheck(
    { actor: { name: '你', skill: '格斗', target: 50 }, target: { name: '对手', skill: '闪避', target: 40 } },
    scriptedRoller([
      { roll: 40, success: true, outcome: 'regular' },
      { roll: 20, success: true, outcome: 'regular' },
    ]),
  );
  ok('同级时技能值高者胜', out.winner === 'actor', out.detail);
}

/* ------------------------------------------------------------------ */
console.log('\n[3] 伤害与战斗');

{
  ok('STR+SIZ ≤64 → -2', damageBonus(30, 30) === '-2');
  ok('125~164 → 1d4', damageBonus(70, 70) === '1d4');
  ok('205+ → 2d6', damageBonus(100, 110) === '2d6');

  const knife = WEAPONS['小刀'];
  ok('吃伤害加值的武器会拼上 db', resolveDamageExpr(knife, '1d4') === '1d4+1d4', resolveDamageExpr(knife, '1d4'));
  ok('db 为 0 时不拼接', resolveDamageExpr(knife, '0') === '1d4');
  ok('手枪不吃 db', resolveDamageExpr(WEAPONS['手枪'], '1d4') === '1d10');
}

{
  const rng = makeRng(11);
  const res = resolveAttack({
    weapon: WEAPONS['小刀'],
    attacker: { name: '你', skillValue: 60, db: '1d4' },
    defender: { name: '列车员', skill: '闪避', skillValue: 30, hp: 12, hpMax: 12 },
    rng,
    rollSkill: scriptedRoller([
      { roll: 20, success: true, outcome: 'hard' },
      { roll: 70, success: false },
    ]),
  });
  ok('攻击等级高于防守 → 命中', res.hit, res.detail);
  ok('命中产生伤害', res.damage > 0, `${res.damage}（${res.damageExpr}）`);
}

{
  const rng = makeRng(11);
  const res = resolveAttack({
    weapon: WEAPONS['小刀'],
    attacker: { name: '你', skillValue: 60, db: '0' },
    defender: { name: '列车员', skill: '闪避', skillValue: 80, hp: 12, hpMax: 12 },
    rng,
    rollSkill: scriptedRoller([
      { roll: 55, success: true },
      { roll: 5, success: true, outcome: 'extreme' },
    ]),
  });
  ok('防守成功等级更高 → 未命中', !res.hit && res.damage === 0, res.detail);
}

{
  const c = makeCombatant({ id: 'a', name: '你', dex: 60, hp: 12, hpMax: 12 });
  const hurt = applyDamage(c, 7, true);
  ok('伤害 ≥ 上限一半 → 重伤', hurt.combatant.majorWound, hurt.notes.join(','));
  ok('重伤加进状态标签', hurt.combatant.conditions.includes('重伤'));

  const down = applyDamage(c, 12, true);
  ok('HP 归零 → 濒死', down.combatant.dying && down.combatant.hp === 0, down.notes.join(','));
}

{
  const rng = makeRng(5);
  const list = [
    makeCombatant({ id: 'a', name: 'A', dex: 50, hp: 10, hpMax: 10 }),
    makeCombatant({ id: 'b', name: 'B', dex: 80, hp: 10, hpMax: 10 }),
    makeCombatant({ id: 'c', name: 'C', dex: 65, hp: 10, hpMax: 10 }),
  ];
  const ordered = rollInitiative(list, rng);
  ok('先攻按 DEX 从高到低', ordered[0].id === 'b' && ordered[2].id === 'a', ordered.map((x) => `${x.name}:${x.dex}`).join(' → '));

  const combat = startCombat(list, rng);
  ok('战斗开始在第 1 轮', combat.round === 1 && combat.active);
  ok('当前行动者是先攻最高的', currentCombatant(combat)?.id === 'b', currentCombatant(combat)?.name);

  let c2 = advanceCombatTurn(combat);
  c2 = advanceCombatTurn(c2);
  c2 = advanceCombatTurn(c2);
  ok('走完一轮 round+1', c2.round === 2 && c2.turnIndex === 0, `round=${c2.round} idx=${c2.turnIndex}`);
}

/* ------------------------------------------------------------------ */
console.log('\n[4] 团队检定');

{
  const out = teamCheck({
    skill: '潜行',
    members: [
      { name: '甲', value: 60 },
      { name: '乙', value: 40 },
      { name: '丙', value: 30 },
      { name: '丁', value: 20 },
    ],
    rollSkill: (skill, target, diff, bonus = 0) => ({
      skill, target, difficulty: diff, bonus, candidates: [1], roll: 1,
      outcome: 'regular', success: true, label: '常规成功', detail: '',
    }),
  });
  ok('技能最高者领队', out.leaderCheck.target === 60, `target=${out.leaderCheck.target}`);
  ok('帮手最多给 2 个奖励骰', out.helpers === 2 && out.bonus === 2, `helpers=${out.helpers}`);
}

/* ------------------------------------------------------------------ */
console.log('\n[5] 连续检定');

{
  let st = startExtendedCheck({ skill: '锁匠', required: 3 });
  st = progressExtended(st, { success: true, outcome: 'regular' }).state;
  ok('成功一次进度 +1', st.progress === 1 && !st.done);

  st = progressExtended(st, { success: true, outcome: 'extreme' }).state;
  ok('极难成功算 2 次进度', st.progress === 3 && st.done, `progress=${st.progress}`);

  let st2 = startExtendedCheck({ skill: '锁匠', required: 3, failuresAllowed: 0 });
  st2 = progressExtended(st2, { success: false, outcome: 'fail' }).state;
  ok('超出允许失败次数即中断', st2.failed, `failures=${st2.failures}`);
}

/* ------------------------------------------------------------------ */
console.log('\n[6] 技能成长');

{
  // 找一个掷出 > 技能值的种子
  let grew = 0;
  let notGrew = 0;
  for (let s = 1; s <= 40; s++) {
    const r = improvementCheck('侦查', 30, makeRng(s));
    r.grew ? grew++ : notGrew++;
  }
  ok('低技能更容易成长（掷 > 技能值）', grew > 0 && notGrew > 0, `成长 ${grew} 次 / 未成长 ${notGrew} 次`);

  const r = improvementCheck('侦查', 30, makeRng(3));
  if (r.grew) ok('成长幅度为 1~10', r.gained >= 1 && r.gained <= 10, `+${r.gained}`);
  else ok('未成长时不变', r.after === r.before);
}

/* ------------------------------------------------------------------ */
console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
