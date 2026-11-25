await import('./_auth-patch.mjs');
/**
 * 多人房间端到端验证：
 *   房主开团 → 第二人加入 → 开始 → 轮流行动 → 越权被拒 → 跳过 → 离开
 *
 * 用法：node tools/check-rooms.mjs
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
console.log('\n[1] 创建房间');

const created = await post('/api/rooms', { worldId: 'last-train', hostName: 'KP 老张', hostRole: 'kp' });
ok('房间创建成功', !!created.room?.id, created.error ?? '');
const roomId = created.room?.id;
const kpId = created.room?.hostMemberId;
ok('生成了 6 位加入码', /^[A-Z0-9]{6}$/.test(created.room?.code ?? ''), created.room?.code);
ok('初始状态为 lobby', created.room?.status === 'lobby');
ok('房主是 KP', created.room?.members.find((m) => m.id === kpId)?.role === 'kp');
ok('会话已创建', !!created.session?.id);
ok('会话里带 party', (created.session?.state?.party ?? []).length === 1);

/* ------------------------------------------------------------------ */
console.log('\n[2] 加入码进团');

// 给韩叙配一条能力，验证能力能随角色卡进团
await fetch(`${B}/api/characters/han-xu`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    abilities: [
      {
        id: 'ab_test',
        name: '听力过人',
        kind: 'talent',
        description: '你能听见别人听不见的动静。',
        effect: { checkBonus: [{ skill: '聆听', value: 15 }] },
        unlocked: true,
        inheritable: true,
      },
    ],
  }),
});

const joined = await post('/api/rooms/join', {
  code: created.room.code,
  name: '玩家小李',
  role: 'player',
  characterId: 'han-xu',
});
ok('加入成功', !!joined.member?.id, joined.error ?? '');
const p2Id = joined.member?.id;
ok('房间变成 2 人', joined.room?.members.length === 2);
ok('新成员分到了面板', !!joined.member?.sheet, `SAN=${joined.member?.sheet?.san}`);
ok('新成员带上了角色卡能力', (joined.member?.abilities ?? []).some((a) => a.name === '听力过人'), (joined.member?.abilities ?? []).map((a) => a.name).join(','));
ok('座位号递增', joined.room?.members[1]?.seat === 1);

const badCode = await post('/api/rooms/join', { code: 'ZZZZZZ', name: '路人' }, true);
ok('错误加入码被拒绝', badCode.status === 400, badCode.data.error);

/* ------------------------------------------------------------------ */
console.log('\n[3] 开始游戏');

const started = await post(`/api/rooms/${roomId}/start`, { memberId: kpId });
ok('游戏开始', started.status === 'playing', started.error ?? '');
ok('第一位是房主', started.turnMemberId === kpId);
ok('轮次从 1 开始', started.round === 1);

/* ------------------------------------------------------------------ */
console.log('\n[4] 回合权限');

// 小李越权发言：应被拒
const intrude = await post(
  '/api/chat',
  { sessionId: created.session.id, content: '我先说话', intent: 'say', roomId, memberId: p2Id },
  true,
);
ok('不在自己回合发言被拒绝', intrude.status === 409, intrude.data.error);

// KP 正常发言
const kpTurn = await post('/api/chat', {
  sessionId: created.session.id,
  content: '列车启动了。',
  intent: 'say',
  roomId,
  memberId: kpId,
});
ok('KP 发言成功', !!kpTurn.done, kpTurn.error ?? '');

/* ------------------------------------------------------------------ */
console.log('\n[5] 回合推进');

for (let i = 0; i < 6; i++) {
  const room = await j(`/api/rooms/${roomId}`);
  if (room.room.turnMemberId === p2Id) break;
  const r = await post(`/api/rooms/${roomId}/next`, { memberId: kpId });
  void r;
}
const afterNext = await j(`/api/rooms/${roomId}`);
ok('回合能推进到其他人', afterNext.room.turnMemberId === p2Id, afterNext.room.turnMemberId);

const p2Turn = await post('/api/chat', {
  sessionId: created.session.id,
  content: '我看向窗外。',
  intent: 'say',
  roomId,
  memberId: p2Id,
});
ok('轮到小李后可以发言', !!p2Turn.done, p2Turn.error ?? '');

/* ------------------------------------------------------------------ */
console.log('\n[6] 跳过成员');

const skipped = await post(`/api/rooms/${roomId}/skip`, { memberId: kpId, targetId: p2Id, skipped: true });
ok('房主可以跳过某人', skipped.members.find((m) => m.id === p2Id)?.skipped === true);
ok('被跳过的人不再是当前行动者', skipped.turnMemberId !== p2Id, skipped.turnMemberId);

const skippedSpeak = await post(
  '/api/chat',
  { sessionId: created.session.id, content: '我还是要说', intent: 'say', roomId, memberId: p2Id },
  true,
);
ok('被跳过的人不能发言', skippedSpeak.status === 409, skippedSpeak.data.error);

const restored = await post(`/api/rooms/${roomId}/skip`, { memberId: kpId, targetId: p2Id, skipped: false });
ok('可以取消跳过', restored.members.find((m) => m.id === p2Id)?.skipped === false);

/* ------------------------------------------------------------------ */
console.log('\n[7] 非房主不能推进');

const deny = await post(`/api/rooms/${roomId}/next`, { memberId: p2Id }, true);
ok('普通玩家不能强行推进', deny.status === 403, deny.data.error);

/* ------------------------------------------------------------------ */
console.log('\n[8] 离开与解散');

const left = await post(`/api/rooms/${roomId}/leave`, { memberId: p2Id });
ok('成员可以离开', left.members.length === 1);

const gone = await post(`/api/rooms/${roomId}/leave`, { memberId: kpId });
void gone;
const after = await fetch(`${B}/api/rooms/${roomId}`);
ok('最后一人离开后房间解散', after.status === 404);

/* ------------------------------------------------------------------ */
console.log('\n[9] 清理世界线');
await fetch(`${B}/api/sessions/${created.session.id}`, { method: 'DELETE' });
console.log('  已清理');

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
