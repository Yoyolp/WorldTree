const B = 'http://127.0.0.1:5174';
const patch = async (p, b) =>
  (await fetch(B + p, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();

const r = await patch('/api/characters/lin-yan', { name: '林砚', characterBookId: null });
console.log('restored:', r.name, '| book:', r.characterBookId);
