await import('./_auth-patch.mjs');
/**
 * 图片（assets）与角色卡/世界书配图
 *
 * 用法：node tools/check-images.mjs（需先启动后端）
 *
 * 覆盖：
 *   - 上传 PNG 返回 assets/ 路径
 *   - 静态前缀 /media/ 能免鉴权读到图片
 *   - 非图片内容被拒绝
 *   - 角色卡 avatarImage 往返
 *   - 世界书条目 image / imageCaption 往返
 *   - PNG 角色卡导出使用头像底图
 */

const B = process.env.WT_BASE ?? 'http://127.0.0.1:5174';
const j = async (p) => {
  const r = await fetch(B + p);
  return r.json();
};
const post = async (p, b) =>
  (await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
const patch = async (p, b) =>
  (await fetch(B + p, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
const del = async (p) => (await fetch(B + p, { method: 'DELETE' })).json();

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

/* 一张最小的合法 1x1 PNG（base64） */
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/* ------------------------------------------------------------------ */
console.log('\n[1] 上传与读取');
let assetPath = '';
{
  const up = await post('/api/assets', { data: `data:image/png;base64,${TINY_PNG}`, prefix: 'test' });
  assetPath = up.path ?? '';
  ok('上传返回 assets/ 路径', typeof up.path === 'string' && up.path.startsWith('assets/'), up.path);
  ok('返回字节数', up.size > 0, `${up.size} bytes`);

  // 静态前缀免鉴权（<img src> 带不了 token）
  // 注意是 /media/ 而不是 /assets/：Vite 产物占了 dist/assets/
  const pub = await fetch(`${B}/media/${assetPath.replace(/^assets\//, '')}`);
  ok('静态前缀可读', pub.ok, `status ${pub.status}`);
  ok('Content-Type 是 image/png', (pub.headers.get('content-type') ?? '').includes('image/png'), pub.headers.get('content-type'));

  // 回归：打包产物的 /assets/*.js 不能被图片目录抢走（曾导致整页白屏）
  const jsProbe = await fetch(`${B}/assets/__nope__.js`);
  const ct = jsProbe.headers.get('content-type') ?? '';
  ok('打包产物前缀未被图片抢走', !ct.includes('application/json') || jsProbe.status === 404, `status ${jsProbe.status}, ct ${ct}`);

  // 非图片被拒绝
  const bad = await fetch(B + '/api/assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: 'data:image/png;base64,' + Buffer.from('not an image at all').toString('base64') }),
  });
  ok('非图片被拒绝', bad.status === 400, `status ${bad.status}`);
}

/* ------------------------------------------------------------------ */
console.log('\n[2] 角色卡头像图片');
{
  const created = await post('/api/characters', { name: '图片测试角色', avatarImage: assetPath });
  const cid = created.id;
  ok('创建时写入 avatarImage', created.avatarImage === assetPath, String(created.avatarImage));

  const reloaded = await j(`/api/characters/${cid}`);
  ok('读回仍是同一路径', reloaded.avatarImage === assetPath, String(reloaded.avatarImage));

  // 更新为 null（移除图片）
  const cleared = await patch(`/api/characters/${cid}`, { avatarImage: null });
  ok('可以移除图片', cleared.avatarImage === null, String(cleared.avatarImage));

  // 再设回去，供后面 PNG 导出用
  await patch(`/api/characters/${cid}`, { avatarImage: assetPath });

  // PNG 导出仍然可用（内部会用头像当底图）
  const png = await fetch(`${B}/api/characters/${cid}/export-png`);
  ok('PNG 导出成功', png.ok, `status ${png.status}`);
  const buf = Buffer.from(await png.arrayBuffer());
  ok('PNG 魔数正确', buf[0] === 0x89 && buf[1] === 0x50, buf.subarray(0, 4).toString('hex'));

  await del(`/api/characters/${cid}`);
}

/* ------------------------------------------------------------------ */
console.log('\n[3] 世界书条目配图');
{
  const created = await post('/api/worldbooks', { name: '图片测试世界书' });
  const bid = created.id;
  const book = await j(`/api/worldbooks/${bid}`);

  const entries = [
    {
      id: 'entry_img_test',
      comment: '带图的条目',
      keys: ['测试关键词'],
      secondaryKeys: [],
      selective: false,
      selectiveLogic: 'and',
      constant: false,
      caseSensitive: false,
      useRegex: false,
      matchWholeWords: false,
      priority: 50,
      insertionOrder: 0,
      position: 'before_char',
      depth: 0,
      probability: 100,
      useProbability: false,
      group: '',
      cooldown: 0,
      sticky: 0,
      content: '条目正文',
      maxChars: 0,
      enabled: true,
      image: assetPath,
      imageCaption: '这是一张测试图',
    },
  ];
  const saved = await patch(`/api/worldbooks/${bid}`, { entries, name: book.name });
  const e = (saved.entries ?? []).find((x) => x.id === 'entry_img_test');
  ok('条目 image 已保存', e?.image === assetPath, String(e?.image));
  ok('条目 imageCaption 已保存', e?.imageCaption === '这是一张测试图', String(e?.imageCaption));

  const reloaded = await j(`/api/worldbooks/${bid}`);
  const e2 = (reloaded.entries ?? []).find((x) => x.id === 'entry_img_test');
  ok('重新读取仍有 image', e2?.image === assetPath, String(e2?.image));

  // ST 导出应把图片放进 extensions.worldtree（ST 的 entries 是对象，不是数组）
  const st = await j(`/api/worldbooks/${bid}/export`);
  const stList = Array.isArray(st.entries) ? st.entries : Object.values(st.entries ?? {});
  const stEntry = stList.find((x) => x.comment === '带图的条目');
  ok(
    'ST 导出带 worldtree.image',
    stEntry?.extensions?.worldtree?.image === assetPath,
    JSON.stringify(stEntry?.extensions?.worldtree ?? {}),
  );

  await del(`/api/worldbooks/${bid}`);
}

/* ------------------------------------------------------------------ */
console.log('\n[4] 删除与清理');
{
  const rel = assetPath.replace(/^assets\//, '');
  const res = await fetch(`${B}/api/assets/${rel}`, { method: 'DELETE' });

  if (res.ok) {
    ok('管理员可以删除图片', res.status === 200, `status ${res.status}`);
    const gone = await fetch(`${B}/media/${rel}`);
    ok('删除后图片不可读', gone.status === 404, `status ${gone.status}`);
  } else {
    // 测试账号通常是普通用户，删除接口按设计只给 admin ——
    // 这里验证的是**权限边界**，不是删除成功。
    ok('非管理员不能删图（403）', res.status === 403, `status ${res.status}`);

    // 删不掉就自己清磁盘，否则每跑一次都在 content/assets 留一张测试图。
    // 测试脚本和服务在同一台机器上，直接 unlink 比伪造 admin token 干净。
    const { unlink } = await import('node:fs/promises');
    const file = new URL(`../apps/server/content/assets/${rel}`, import.meta.url);
    try {
      await unlink(file);
      ok('测试图片已从磁盘清除', true, rel);
    } catch (err) {
      ok('测试图片已从磁盘清除', false, `${rel}: ${err.message}`);
    }
  }
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
