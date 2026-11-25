await import('./_auth-patch.mjs');
/**
 * 开局选角色卡（playerCardMode）验证
 *
 * 用法：node tools/check-playercard.mjs
 *
 * 覆盖：
 *   - 老世界没写 playerCardMode 时按 open 处理
 *   - open：可以用角色库里的卡当主角，卡上的面板会带进世界线
 *   - 没有面板的卡 → 自动生成调查员
 *   - playerCharacterId: null → 不绑定角色卡
 *   - 不传 playerCharacterId → 沿用世界自带主角（老行为）
 *   - fixed：只能用本世界的角色卡，外来卡与 null 都被拒
 *   - 指定不存在的卡 → 400
 */

const B = process.env.WT_BASE ?? 'http://127.0.0.1:5174';

const j = async (p) => {
  const r = await fetch(B + p);
  return r.json();
};
const send = async (method, p, body) => {
  const r = await fetch(B + p, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
};
const post = (p, b) => send('POST', p, b);
const patch = (p, b) => send('PATCH', p, b);
const del = (p) => send('DELETE', p);

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

const tray = { sessions: [], characters: [], worlds: [] };
const cleanup = async () => {
  for (const id of tray.sessions) await del(`/api/sessions/${id}`);
  for (const id of tray.worlds) await del(`/api/worlds/${id}`);
  for (const id of tray.characters) await del(`/api/characters/${id}`);
};

const sheetWith = (skillValue) => ({
  attributes: { STR: 45, CON: 50, SIZ: 55, DEX: 60, APP: 40, INT: 70, POW: 65, EDU: 75, LUCK: 50 },
  skills: [
    { name: '侦查', value: skillValue, category: '探索' },
    { name: '聆听', value: 40, category: '探索' },
    { name: '闪避', value: 35, category: '行动' },
  ],
  hp: 10,
  hpMax: 10,
  mp: 13,
  mpMax: 13,
  san: 65,
  sanMax: 65,
  luck: 50,
  luckMax: 99,
  conditions: [],
  items: ['自带的怀表'],
  backstory: '来自角色库的调查员。',
});

async function mkCard(name, extra = {}) {
  const res = await post('/api/characters', {
    name,
    description: `${name} 的简介`,
    personality: '冷静',
    tags: ['测试'],
    avatarIcon: 'person',
    ...extra,
  });
  if (!res.data?.id) throw new Error(`建卡失败：${JSON.stringify(res.data)}`);
  tray.characters.push(res.data.id);
  return res.data;
}

try {
  /* ---------------------------------------------------------------- */
  console.log('\n[1] 老世界不写 playerCardMode 也按 open 处理');

  {
    const w = await j('/api/worlds/gray-tide');
    ok('gray-tide 没有显式声明', w.playerCardMode === undefined, String(w.playerCardMode));
    ok('语义上等价 open', (w.playerCardMode ?? 'open') === 'open');
  }

  /* ---------------------------------------------------------------- */
  console.log('\n[2] open 世界：用角色库里的卡当主角');

  const mine = await mkCard('测试调查员A', { sheet: sheetWith(77), isPlayer: false });
  {
    const res = await post('/api/worlds/gray-tide/sessions', {
      playerCharacterId: mine.id,
      characterIds: ['han-xu'],
    });
    const s = res.data?.session;
    ok('开局成功', res.status === 200 && !!s, res.data?.error ?? '');
    tray.sessions.push(s.id);

    ok('主角卡就是选的那张', s.playerCharacterId === mine.id, s.playerCharacterId);
    ok('玩家名默认取卡名', s.playerName === '测试调查员A', s.playerName);
    ok('主角卡进了队伍', s.characterIds.includes(mine.id), s.characterIds.join(','));
    ok('点选的同行角色也在', s.characterIds.includes('han-xu'));
    ok('没勾的同行角色没进来', !s.characterIds.includes('gu-ruo'));
    ok('面板来自角色卡', s.state.sheet?.skills?.find((x) => x.name === '侦查')?.value === 77);

    const detail = await j(`/api/sessions/${s.id}`);
    ok('会话详情能取到这张卡（面板用）', detail.characters.some((c) => c.id === mine.id));
    ok('这张卡不会同时当 NPC 再列一遍', detail.characters.filter((c) => c.id === mine.id).length === 1);
  }

  /* ---------------------------------------------------------------- */
  console.log('\n[3] 卡上没有面板 → 自动生成');

  const bare = await mkCard('测试调查员B');
  {
    const res = await post('/api/worlds/gray-tide/sessions', {
      playerCharacterId: bare.id,
      characterIds: ['lin-yan'],
    });
    const s = res.data?.session;
    tray.sessions.push(s.id);
    ok('开局成功', res.status === 200 && !!s, res.data?.error ?? '');
    ok('有生成的面板', !!s.state.sheet);
    ok('面板不是空的', (s.state.sheet?.skills?.length ?? 0) > 0, `${s.state.sheet?.skills?.length} 项技能`);
  }

  /* ---------------------------------------------------------------- */
  console.log('\n[4] playerCharacterId: null = 不绑定角色卡');

  {
    const res = await post('/api/worlds/gray-tide/sessions', {
      playerCharacterId: null,
      playerName: '路人甲',
      characterIds: ['lin-yan'],
    });
    const s = res.data?.session;
    tray.sessions.push(s.id);
    ok('开局成功', res.status === 200 && !!s, res.data?.error ?? '');
    ok('没有绑定任何卡', s.playerCharacterId === null, String(s.playerCharacterId));
    ok('名字用传进来的称呼', s.playerName === '路人甲', s.playerName);
    ok('仍然生成了面板', !!s.state.sheet);
  }

  /* ---------------------------------------------------------------- */
  console.log('\n[5] 不传 playerCharacterId → 沿用世界自带主角（老行为）');

  {
    const res = await post('/api/worlds/gray-tide/sessions', {});
    const s = res.data?.session;
    tray.sessions.push(s.id);
    ok('开局成功', res.status === 200 && !!s, res.data?.error ?? '');
    ok('自动绑到世界自带主角', s.playerCharacterId === 'lin-yan', s.playerCharacterId);
    ok('名字也取了卡名', s.playerName === '林砚', s.playerName);
    ok('面板来自林砚的卡', s.state.sheet?.skills?.find((x) => x.value === 80) !== undefined);
  }

  /* ---------------------------------------------------------------- */
  console.log('\n[6] 同行角色传空 → 回到世界默认阵容');

  {
    const res = await post('/api/worlds/gray-tide/sessions', {
      playerCharacterId: mine.id,
      characterIds: [],
    });
    const s = res.data?.session;
    tray.sessions.push(s.id);
    ok('主角卡仍被补进队伍', s.characterIds.includes(mine.id));
    ok('同时带上了世界默认阵容', ['lin-yan', 'han-xu', 'gu-ruo', 'echo-girl'].every((id) => s.characterIds.includes(id)));
  }

  /* ---------------------------------------------------------------- */
  console.log('\n[7] fixed：只能用本世界的角色卡');

  const fixedPlayer = await mkCard('固定主角', { isPlayer: true });
  const outsider = await mkCard('外来者', { sheet: sheetWith(50) });
  {
    const created = await post('/api/worlds', { title: '主角卡固定测试', mode: 'story' });
    const wid = created.data?.id;
    tray.worlds.push(wid);
    ok('测试世界已建', !!wid, created.data?.error ?? '');

    const patched = await patch(`/api/worlds/${wid}`, {
      playerCardMode: 'fixed',
      characterIds: [fixedPlayer.id],
    });
    ok('世界已设为 fixed', patched.data?.playerCardMode === 'fixed', String(patched.data?.playerCardMode));

    const foreign = await post(`/api/worlds/${wid}/sessions`, {
      playerCharacterId: outsider.id,
      characterIds: [],
    });
    ok('外来卡被拒（400）', foreign.status === 400, `status=${foreign.status}`);
    ok('错误里说明了是主角固定', /主角是固定/.test(foreign.data?.error ?? ''), foreign.data?.error ?? '');

    const none = await post(`/api/worlds/${wid}/sessions`, { playerCharacterId: null });
    ok('「不绑定」也被拒', none.status === 400, `status=${none.status}`);

    const own = await post(`/api/worlds/${wid}/sessions`, {
      playerCharacterId: fixedPlayer.id,
      characterIds: [outsider.id],
    });
    ok('自带卡可以开局', own.status === 200, own.data?.error ?? '');
    tray.sessions.push(own.data?.session?.id);
    ok('外来同行角色被过滤掉', !own.data?.session?.characterIds?.includes(outsider.id));
    ok('主角卡还在队伍里', own.data?.session?.characterIds?.includes(fixedPlayer.id));

    const dflt = await post(`/api/worlds/${wid}/sessions`, {});
    ok('不指定时默认用固定主角', dflt.data?.session?.playerCharacterId === fixedPlayer.id, dflt.data?.session?.playerCharacterId);
    tray.sessions.push(dflt.data?.session?.id);

    // 改回 open 后外来卡应当被接受
    await patch(`/api/worlds/${wid}`, { playerCardMode: 'open' });
    const reopened = await post(`/api/worlds/${wid}/sessions`, { playerCharacterId: outsider.id });
    ok('改回 open 后外来卡可用', reopened.status === 200, reopened.data?.error ?? '');
    tray.sessions.push(reopened.data?.session?.id);
  }

  /* ---------------------------------------------------------------- */
  console.log('\n[8] 指定了不存在的卡 → 400');

  {
    const res = await post('/api/worlds/gray-tide/sessions', { playerCharacterId: 'char_does_not_exist' });
    ok('被拒（400）', res.status === 400, `status=${res.status}`);
    ok('错误信息可读', /角色卡不存在/.test(res.data?.error ?? ''), res.data?.error ?? '');
  }
} finally {
  await cleanup();
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);