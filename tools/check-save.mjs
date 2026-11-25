await import('./_auth-patch.mjs');
const B = process.env.WT_BASE ?? 'http://127.0.0.1:5174';
const post = async (p, b) =>
  (await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();

const s = await post('/api/worlds/harry-potter-1/sessions', { playerName: '哈利' });
const sid = s.session.id;
const ch = s.messages[0].meta.choices[0];
const t = await post('/api/chat', { sessionId: sid, content: '', intent: 'choice', choiceId: ch.id });
console.log('loreHits:', t.done.message.meta.loreHits);
console.log('choices:', (t.done.message.meta.choices || []).map((c) => c.text));

const t2 = await post('/api/chat', {
  sessionId: sid,
  content: '我拿出魔杖，问海格关于魔法石和三头犬的事',
  intent: 'say',
});
console.log('\nloreHits(自由输入):', t2.done.message.meta.loreHits);

const exp = await fetch(B + '/api/sessions/' + sid + '/export');
const save = await exp.json();
console.log('\n=== 存档导出 ===');
console.log('status:', exp.status);
console.log('disposition:', exp.headers.get('content-disposition'));
console.log('format:', save.format, '| version:', save.version);
console.log('world:', save.world.title, '| session:', save.session.title);
console.log('messages:', save.messages.length);
console.log('state.nodeId:', save.session.state.nodeId, '| flags:', save.session.state.flags);

const bad = await post('/api/sessions/import', { payload: save, worldId: 'last-train' });
console.log('\n=== 导入到错误世界（应报错）===');
console.log('result:', bad.error ?? 'OK(不该成功)');

const good = await post('/api/sessions/import', { payload: save });
console.log('\n=== 导入回原世界 ===');
if (good.error) {
  console.log('ERROR:', good.error);
} else {
  console.log('new session:', good.session.id, '| title:', good.session.title);
  console.log('copied messages:', good.messages.length);
  console.log('nodeId preserved:', good.session.state.nodeId);
  console.log('flags preserved:', good.session.state.flags);
  console.log('msg order:', good.messages.map((m) => m.role).join(','));
  await fetch(B + '/api/sessions/' + good.session.id, { method: 'DELETE' });
}

await fetch(B + '/api/sessions/' + sid, { method: 'DELETE' });
console.log('\ncleaned up');
