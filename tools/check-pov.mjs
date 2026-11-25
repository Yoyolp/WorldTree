await import('./_auth-patch.mjs');
/**
 * 幕间成长 + 私密视角
 *
 * 用法：node tools/check-pov.mjs
 */
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
console.log('\n[1] 幕间技能成长');

{
  const created = await post('/api/worlds/gray-tide/sessions', { playerName: '调查员', sheetSeed: 777 });
  const sid = created.session.id;
  ok('世界线已建', !!sid);
  ok('初始没有用过的技能', (created.session.state.skillsUsed ?? []).length === 0);

  // 做一次必然成功的检定（目标值拉高）
  const skill = created.session.state.sheet.skills[0].name;
  const roll = await post(`/api/sessions/${sid}/roll`, { skill, seed: 1 });
  ok('手动检定成功', !!roll.check, `${roll.check?.skill} ${roll.check?.roll}/${roll.check?.target}`);

  // roll 端点不会写 skillsUsed，改用聊天触发一次自动检定
  const chat = await post('/api/chat', {
    sessionId: sid,
    content: '我仔细观察四周的墙角',
    intent: 'say',
  });
  ok('聊天推演成功', !!chat.done, chat.error ?? '');

  const after = await j(`/api/sessions/${sid}`);
  const used = after.session.state.skillsUsed ?? [];
  ok('成功用过的技能被记录', used.length > 0, used.join('、') || '无');

  const improved = await post(`/api/sessions/${sid}/improve`, {});
  ok('幕间结算可执行', Array.isArray(improved.results), improved.error ?? '');
  ok('结算覆盖了用过的技能', improved.results.length === used.length, `${improved.results.length} 项`);
  ok('结算后清空记录', (improved.state.skillsUsed ?? []).length === 0);

  if (improved.results.length) {
    const r = improved.results[0];
    ok('结果带前后数值', typeof r.before === 'number' && typeof r.after === 'number', `${r.skill} ${r.before}→${r.after}`);
    const sheetSkill = improved.state.sheet.skills.find((s) => s.name === r.skill);
    ok('面板已更新', !!sheetSkill && sheetSkill.value === r.after, `${sheetSkill?.value}`);
  }

  await fetch(`${B}/api/sessions/${sid}`, { method: 'DELETE' });
}

/* ------------------------------------------------------------------ */
console.log('\n[2] 私密消息的视角隔离');

{
  const created = await post('/api/rooms', {
    worldId: 'last-train',
    hostName: 'KP',
    hostRole: 'kp',
    kpMode: 'human',
  });
  const roomId = created.room.id;
  const sid = created.session.id;
  const kpId = created.room.hostMemberId;

  const p1 = await post('/api/rooms/join', { code: created.room.code, name: '甲', role: 'player' });
  const p2 = await post('/api/rooms/join', { code: created.room.code, name: '乙', role: 'player' });
  ok('两人加入', !!p1.member?.id && !!p2.member?.id);

  await post(`/api/rooms/${roomId}/start`, { memberId: kpId });

  // KP 发一条只给甲的私密指令
  const secret = await post('/api/chat', {
    sessionId: sid,
    content: '（只给甲看：你在座位下摸到一张写着名字的车票。）',
    intent: 'direct',
    roomId,
    memberId: kpId,
    privateTo: p1.member.id,
  });
  ok('私密消息已发送', !!secret.done, secret.error ?? '');
  ok('消息带 pov 标记', secret.done?.message?.meta?.pov === p1.member.id, secret.done?.message?.meta?.pov);

  // 再发一条所有人可见的
  await post('/api/chat', {
    sessionId: sid,
    content: '列车启动了。',
    intent: 'direct',
    roomId,
    memberId: kpId,
  });

  const viewA = await j(`/api/sessions/${sid}?memberId=${p1.member.id}`);
  const viewB = await j(`/api/sessions/${sid}?memberId=${p2.member.id}`);
  const viewNone = await j(`/api/sessions/${sid}`);

  const hasSecretA = viewA.messages.some((m) => m.content.includes('写着名字的车票'));
  const hasSecretB = viewB.messages.some((m) => m.content.includes('写着名字的车票'));

  ok('甲能看到私密消息', hasSecretA);
  ok('乙看不到私密消息', !hasSecretB);
  ok('公共消息两人都能看到',
    viewA.messages.some((m) => m.content.includes('列车启动了')) &&
      viewB.messages.some((m) => m.content.includes('列车启动了')));
  ok('不传 memberId 时返回全部（兼容旧行为）', viewNone.messages.length >= viewA.messages.length);

  await fetch(`${B}/api/sessions/${sid}`, { method: 'DELETE' });
  await post(`/api/rooms/${roomId}/leave`, { memberId: kpId });
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
