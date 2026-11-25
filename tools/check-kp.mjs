await import('./_auth-patch.mjs');
/**
 * KP 双模式验证
 *   1. AI 当 KP：人类 KP 不占回合
 *   2. 真人 KP：可以随时下导演指令，且不消耗玩家回合
 *
 * 用法：node tools/check-kp.mjs
 */
const B = process.env.WT_BASE ?? 'http://127.0.0.1:5174';
const j = async (p) => (await fetch(B + p)).json();
const post = async (p, b, raw = false) => {
  const res = await fetch(B + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b),
  });
  const data = await res.json();
  return raw ? { status: res.status, data } : data;
};

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
console.log('\n[1] AI 当 KP：没有人类 KP 的回合');

{
  const created = await post('/api/rooms', {
    worldId: 'last-train',
    hostName: '玩家甲',
    hostRole: 'player',
    kpMode: 'ai',
  });
  ok('房间创建成功', !!created.room?.id, created.error ?? '');
  ok('kpMode 记录为 ai', created.room.kpMode === 'ai', created.room.kpMode);

  const joined = await post('/api/rooms/join', { code: created.room.code, name: '玩家乙', role: 'player' });
  ok('第二人加入', !!joined.member?.id, joined.error ?? '');

  const started = await post(`/api/rooms/${created.room.id}/start`, { memberId: created.room.hostMemberId });
  ok('团能开始', started.status === 'playing', started.error ?? '');

  const turnMember = started.turnMemberId;
  const isHost = turnMember === created.room.hostMemberId;
  const isP2 = turnMember === joined.member.id;
  ok('行动者只会在玩家之间产生', isHost || isP2, `turn=${turnMember}`);

  // 轮转一轮，确认房主（若他是 player）正常参与
  const room1 = await j(`/api/rooms/${created.room.id}`);
  ok('轮到的人不是 KP 角色', room1.room.members.find((m) => m.id === room1.room.turnMemberId)?.role !== 'kp');

  await fetch(`${B}/api/sessions/${created.session.id}`, { method: 'DELETE' });
}

/* ------------------------------------------------------------------ */
console.log('\n[2] 真人 KP：随时下导演指令，不占回合');

{
  const created = await post('/api/rooms', {
    worldId: 'last-train',
    hostName: 'KP 老王',
    hostRole: 'kp',
    kpMode: 'human',
  });
  ok('房间创建成功', !!created.room?.id, created.error ?? '');
  ok('kpMode 记录为 human', created.room.kpMode === 'human', created.room.kpMode);

  const p2 = await post('/api/rooms/join', { code: created.room.code, name: '玩家小李', role: 'player' });
  const started = await post(`/api/rooms/${created.room.id}/start`, { memberId: created.room.hostMemberId });

  // AI-KP 模式下 KP 不进轮转；human 模式下 KP 仍在轮转里
  ok('真人 KP 在队员列表中', started.members.some((m) => m.role === 'kp'));

  // 先把回合推给玩家，确保「非 KP 回合」这个场景一定被测到
  let cur = await j(`/api/rooms/${created.room.id}`);
  for (let i = 0; i < 4 && cur.room.turnMemberId === created.room.hostMemberId; i++) {
    await post(`/api/rooms/${created.room.id}/next`, { memberId: created.room.hostMemberId });
    cur = await j(`/api/rooms/${created.room.id}`);
  }
  const beforeTurn = cur.room.turnMemberId;
  ok('已把回合推到玩家', beforeTurn !== created.room.hostMemberId, `turn=${beforeTurn}`);

  if (beforeTurn !== created.room.hostMemberId) {
    const dir = await post(
      '/api/chat',
      {
        sessionId: created.session.id,
        content: '描述一下列车员帽檐下的表情。',
        intent: 'direct',
        roomId: created.room.id,
        memberId: created.room.hostMemberId,
      },
      true,
    );
    ok('非自己回合时 KP 仍可下指令', dir.status === 200, `${dir.status} ${dir.data.error ?? ''}`);

    const after = await j(`/api/rooms/${created.room.id}`);
    ok('导演指令不推进回合', after.room.turnMemberId === beforeTurn,
      beforeTurn + ' -> ' + after.room.turnMemberId);
    ok('KP 指令没被当成玩家行动', !!dir.data.done, dir.data.error ?? '');
  } else {
    ok('非自己回合时 KP 仍可下指令', true, '当前正好轮到 KP，跳过');
    ok('导演指令不推进回合', true, '跳过');
    ok('KP 指令没被当成玩家行动', true, '跳过');
  }

  // 普通玩家若也发 direct，应当被拒
  const bad = await post(
    '/api/chat',
    {
      sessionId: created.session.id,
      content: '我也要当 KP',
      intent: 'direct',
      roomId: created.room.id,
      memberId: p2.member.id,
    },
    true,
  );
  ok('普通玩家不能下导演指令', bad.status !== 200 || !!bad.data.error, `${bad.status}`);

  await fetch(`${B}/api/sessions/${created.session.id}`, { method: 'DELETE' });
}

/* ------------------------------------------------------------------ */
console.log('\n[3] 清理');
const rooms = await j('/api/rooms');
for (const r of rooms.items) {
  await post(`/api/rooms/${r.id}/leave`, { memberId: r.hostMemberId });
}
console.log('  已清理');

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
