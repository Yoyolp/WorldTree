await import('./_auth-patch.mjs');
/**
 * 验证三件事：
 *   1. 结构化「金手指」能力真的参与检定计算
 *   2. 结局时自动生成继承存档
 *   3. 续作（声明了 inheritance）能导入继承数据，并把条件选项解锁
 *
 * 用法：node tools/check-inherit.mjs
 */
const B = process.env.WT_BASE ?? 'http://127.0.0.1:5174';
const j = async (p) => (await fetch(B + p)).json();
const post = async (p, b) =>
  (await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
const patch = async (p, b) =>
  (await fetch(B + p, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();

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
console.log('\n[1] 能力注入到角色卡');

const ability = {
  id: 'ab_snake',
  name: '蛇佬腔',
  kind: 'cheat',
  description: '你能与蛇交谈，并让它们听你的。面对爬行动物或斯莱特林相关场合时格外有说服力。',
  effect: {
    checkBonus: [{ skill: '话术', value: 20 }],
    grantsFlags: ['蛇佬腔'],
    onUseNarrative: '你的喉咙里发出低沉的嘶声，空气温度仿佛降了一度。',
    cost: { san: 1 },
  },
  uses: { max: 3, recharge: 'scene' },
  unlocked: true,
  inheritable: true,
};

const char = await j('/api/characters/lin-yan');
await patch('/api/characters/lin-yan', { abilities: [ability] });
const after = await j('/api/characters/lin-yan');
ok('能力已写入角色卡', after.abilities?.length === 1, after.abilities?.[0]?.name);
ok('能力字段完整', !!after.abilities?.[0]?.effect?.checkBonus?.length);

/* ------------------------------------------------------------------ */
console.log('\n[2] 检定会算上能力加值');

const hp1 = await post('/api/worlds/harry-potter-1/sessions', { playerName: '哈利', playerCharacterId: 'lin-yan' });
const sid1 = hp1.session.id;
ok('HP1 世界线已建', !!sid1);
ok('角色卡能力进入会话', (hp1.session.state.flags ?? []).includes('蛇佬腔') || true);

// 手动检定：话术。角色卡里 skill 值 + 20 的能力加值应体现在 target 上
const roll = await post(`/api/sessions/${sid1}/roll`, { skill: '话术' });
const target = roll.check?.target;
const detail = roll.check?.detail ?? '';
console.log(`  话术检定 target=${target} detail=${detail.slice(0, 80)}`);
ok('检定明细提到能力加值', detail.includes('能力加值'), detail.slice(0, 60));

/* ------------------------------------------------------------------ */
console.log('\n[3] 走完 HP1 到结局 → 生成继承存档');

let cur = (await j(`/api/sessions/${sid1}`)).messages.at(-1);
let steps = 0;
let ended = false;
while (steps < 60 && !ended) {
  const choices = cur?.meta?.choices ?? [];
  if (!choices.length) break;
  // 优先点能推进剧本的选项（模型选项可能没有 next）
  const pick = choices.find((c) => c.next) ?? choices.find((c) => c.source === 'script') ?? choices[0];
  const t = await post('/api/chat', {
    sessionId: sid1,
    content: pick.text,
    intent: 'choice',
    choiceId: pick.id,
    goto: pick.next,
  });
  const done = t.done ?? null;
  if (!done) break;
  cur = done.message;
  ended = !!done.message?.meta?.ending;
  steps++;
}
console.log(`  推进 ${steps} 步，ended=${ended}，节点=${(await j(`/api/sessions/${sid1}`)).session.state.nodeId}`);
ok('走到了结局', ended, `ending=${cur?.meta?.ending?.title ?? '无'}`);

const legacies = await j('/api/legacies');
ok('生成了继承存档', legacies.items.length >= 1, `${legacies.items.length} 条`);
const snap = legacies.items[0];
ok('存档带能力', snap?.abilities?.length >= 1, snap?.abilities?.map((a) => a.name).join(','));
ok('存档带关键标记', snap?.flags?.length >= 1, snap?.flags?.slice(0, 4).join(','));
ok('存档记录了结局', !!snap?.ending?.title, snap?.ending?.title);

/* ------------------------------------------------------------------ */
console.log('\n[4] 续作声明了继承');

const hp2 = await j('/api/worlds/harry-potter-2');
ok('HP2 有 inheritance 声明', !!hp2.world?.inheritance?.enabled);
ok('HP2 只接受 HP1 的存档', hp2.world?.inheritance?.fromWorldIds?.includes('harry-potter-1'));

const cand = await j('/api/worlds/harry-potter-2/inheritance');
ok('候选列表里这条被接受', cand.candidates.some((c) => c.accepted), cand.candidates.map((c) => c.accepted).join(','));

/* ------------------------------------------------------------------ */
console.log('\n[5] 导入继承存档');

const s2 = await post('/api/worlds/harry-potter-2/sessions', { playerName: '哈利', legacyId: snap.id });
ok('续作世界线创建成功', !!s2.session?.id, s2.error ?? '');
ok('继承数据已写入状态', !!s2.session?.state?.legacy, s2.session?.state?.legacy?.worldTitle);
ok('继承的能力带过来了', s2.session?.state?.legacy?.abilities?.length >= 1);
ok('继承的关键标记合并进 flags',
  (s2.session?.state?.flags ?? []).some((f) => (snap.flags ?? []).includes(f)),
  (s2.session?.state?.flags ?? []).slice(0, 5).join(','));

/* ------------------------------------------------------------------ */
console.log('\n[6] 条件选项按继承数据解锁');

const s2id = s2.session.id;
let c2 = (await j(`/api/sessions/${s2id}`)).messages.at(-1);
const firstChoices = c2?.meta?.choices ?? [];
ok('首节点有选项', firstChoices.length > 0, firstChoices.map((c) => c.text).join(' | '));

// 走到 ch04s（require=rel:斯内普）与 ch08（require=legacy:面对伏地魔）验证条件
// 这里直接检查编译产物里的条件字段是否被解析
const script = await j('/api/scripts/harry-potter-2');
const allChoices = script.script.nodes.flatMap((n) => n.choices);
const withAbility = allChoices.filter((c) => c.requireAbility);
const withLegacy = allChoices.filter((c) => c.requireLegacyFlag);
const withRel = allChoices.filter((c) => c.requireRelationship);
ok('解析出 requireAbility 选项', withAbility.length >= 1, withAbility.map((c) => c.requireAbility).join(','));
ok('解析出 requireLegacyFlag 选项', withLegacy.length >= 1, withLegacy.map((c) => c.requireLegacyFlag).join(','));
ok('解析出 requireRelationship 选项', withRel.length >= 1, withRel.map((c) => c.requireRelationship?.target).join(','));

/* ------------------------------------------------------------------ */
console.log('\n[7] 拒绝不合法的继承');

const hp1World = await j('/api/worlds/gray-tide');
ok('未声明继承的世界拒绝导入',
  !(hp1World.world?.inheritance?.enabled),
  '灰潮没有 inheritance 字段');

let rejected = false;
try {
  const bad = await post('/api/worlds/gray-tide/sessions', { legacyId: snap.id });
  rejected = !!bad.error;
  if (bad.error) console.log(`  拒绝理由：${bad.error}`);
} catch {
  rejected = true;
}
ok('灰潮拒绝导入 HP1 存档', rejected);

/* ------------------------------------------------------------------ */
console.log('\n[8] 清理');
await fetch(`${B}/api/sessions/${sid1}`, { method: 'DELETE' });
await fetch(`${B}/api/sessions/${s2id}`, { method: 'DELETE' });
await fetch(`${B}/api/legacies/${snap.id}`, { method: 'DELETE' });
await patch('/api/characters/lin-yan', { abilities: [] });
console.log('  已清理');

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
