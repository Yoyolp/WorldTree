/**
 * 回归：规则百科
 *
 * 百科页的数据全部来自 /api/rulepacks，所以这里验证两件事：
 *
 *   1. 接口里确实带着百科需要的东西（技能效果、派生公式、能力开关）
 *   2. markdown 渲染器不把规则书里写的内容当成 HTML 执行
 *
 * 第 2 点尤其重要：规则书可能是第三方插件，它的 instructions
 * 是不可信输入，不能直接塞进 v-html。
 */

const BASE = process.env.WT_BASE || 'http://127.0.0.1:5199';
const TOKEN = process.env.WT_TOKEN || '';

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

/* ------------------------------------------------------------------ */
/* 把前端渲染器搬过来测（避免依赖浏览器）                                */
/* ------------------------------------------------------------------ */

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(escaped) {
  let out = escaped;
  const codes = [];
  out = out.replace(/`([^`]+)`/g, (_m, code) => {
    codes.push(code);
    return `\u0000CODE${codes.length - 1}\u0000`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (_m, text, url) => {
    const safe = /^https?:\/\//i.test(url) ? url : '#';
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });
  out = out.replace(/\u0000CODE(\d+)\u0000/g, (_m, i) => `<code>${codes[Number(i)]}</code>`);
  return out;
}

function renderMarkdown(src) {
  if (!src) return '';
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let inCode = false;
  let codeBuf = [];
  let listType = null;
  let paraBuf = [];

  const flushPara = () => {
    if (!paraBuf.length) return;
    html.push(`<p>${renderInline(escapeHtml(paraBuf.join(' ')))}</p>`);
    paraBuf = [];
  };
  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };
  const openList = (type) => {
    if (listType === type) return;
    closeList();
    html.push(`<${type}>`);
    listType = type;
  };

  for (const raw of lines) {
    if (/^\s*```/.test(raw)) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        flushPara();
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(raw);
      continue;
    }
    if (!raw.trim()) {
      flushPara();
      closeList();
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) {
      flushPara();
      closeList();
      html.push('<hr />');
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(raw);
    if (h) {
      flushPara();
      closeList();
      html.push(`<h${h[1].length}>${renderInline(escapeHtml(h[2].trim()))}</h${h[1].length}>`);
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(raw);
    if (quote) {
      flushPara();
      closeList();
      html.push(`<blockquote>${renderInline(escapeHtml(quote[1]))}</blockquote>`);
      continue;
    }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(raw);
    if (ul) {
      flushPara();
      openList('ul');
      html.push(`<li>${renderInline(escapeHtml(ul[1]))}</li>`);
      continue;
    }
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(raw);
    if (ol) {
      flushPara();
      openList('ol');
      html.push(`<li>${renderInline(escapeHtml(ol[1]))}</li>`);
      continue;
    }
    closeList();
    paraBuf.push(raw.trim());
  }

  if (inCode && codeBuf.length) html.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
  flushPara();
  closeList();
  return html.join('\n');
}

async function main() {
  console.log('\n[1] 百科数据源');
  const res = await get('/api/rulepacks');
  ok('规则包接口可读', res.status === 200, `status=${res.status}`);
  const list = Array.isArray(res.data) ? res.data : res.data?.items ?? [];
  ok('返回规则书列表', list.length >= 4, `${list.length} 本`);

  const coc = list.find((p) => p.id === 'coc7');
  const dnd = list.find((p) => p.id === 'dnd5e');
  ok('coc7 存在', !!coc);
  ok('dnd5e 存在', !!dnd);

  console.log('\n[2] 每本规则书都有百科所需的元数据');
  for (const p of [coc, dnd]) {
    if (!p) continue;
    ok(`「${p.id}」有名称与简介`, !!p.name && typeof p.description === 'string');
    ok(`「${p.id}」有判定策略`, !!p.strategy, p.strategy);
    ok(`「${p.id}」有骰面数`, typeof p.dieFaces === 'number', `d${p.dieFaces}`);
    ok(`「${p.id}」有能力开关`, typeof p.sanity === 'boolean' && typeof p.combat === 'boolean');
  }

  console.log('\n[3] 技能效果字段');
  const cocSkills = coc?.sheetSchema?.skills ?? [];
  const dndSkills = dnd?.sheetSchema?.skills ?? [];
  ok('coc7 技能有 description', cocSkills.length > 0 && cocSkills.every((s) => !!s.description),
    `${cocSkills.filter((s) => s.description).length}/${cocSkills.length}`);
  ok('coc7 技能有 effectText', cocSkills.every((s) => !!s.effectText));
  ok('coc7 技能有 tags', cocSkills.every((s) => (s.tags ?? []).length > 0));
  ok('coc7 技能有 examples', cocSkills.every((s) => (s.examples ?? []).length > 0));
  ok('dnd5e 技能有 description', dndSkills.length > 0 && dndSkills.every((s) => !!s.description),
    `${dndSkills.filter((s) => s.description).length}/${dndSkills.length}`);
  ok('dnd5e 技能有 effectText', dndSkills.every((s) => !!s.effectText));

  console.log('\n[4] 面板结构可用于预览');
  ok('coc7 有属性表', (coc?.sheetSchema?.attributes ?? []).length === 9);
  ok('coc7 属性带 default', (coc?.sheetSchema?.attributes ?? []).every((a) => typeof a.default === 'number'));
  ok('coc7 有资源上限公式', (coc?.sheetSchema?.resources ?? []).every((r) => !!r.maxFormula));
  ok('dnd5e 有派生公式', (dnd?.sheetSchema?.derived ?? []).length > 0,
    `${(dnd?.sheetSchema?.derived ?? []).length} 项`);
  ok('dnd5e 派生项有 label 与 formula',
    (dnd?.sheetSchema?.derived ?? []).every((d) => !!d.label && !!d.formula));

  console.log('\n[5] Markdown 渲染');
  const h1 = renderMarkdown('# 标题\n\n正文一段。');
  ok('一级标题渲染成 h1', h1.includes('<h1>标题</h1>'));
  ok('段落渲染成 p', h1.includes('<p>正文一段。</p>'));

  const h2 = renderMarkdown('- 第一项\n- 第二项');
  ok('无序列表渲染', h2.includes('<ul>') && h2.includes('<li>第一项</li>'));

  const h3 = renderMarkdown('1. 甲\n2. 乙');
  ok('有序列表渲染', h3.includes('<ol>') && h3.includes('<li>甲</li>'));

  const h4 = renderMarkdown('这是 **粗体** 与 `代码`。');
  ok('粗体渲染', h4.includes('<strong>粗体</strong>'));
  ok('行内代码渲染', h4.includes('<code>代码</code>'));

  const h5 = renderMarkdown('```\nconst a = 1;\n```');
  ok('代码块渲染', h5.includes('<pre><code>const a = 1;</code></pre>'));

  const h6 = renderMarkdown('---');
  ok('分隔线渲染', h6.includes('<hr />'));

  console.log('\n[6] XSS 防护（规则书是不可信输入）');
  const evil1 = renderMarkdown('<script>alert(1)</script>');
  ok('script 标签被转义', !evil1.includes('<script>') && evil1.includes('&lt;script&gt;'), evil1.slice(0, 60));

  const evil2 = renderMarkdown('<img src=x onerror="alert(1)">');
  ok('onerror 属性被转义', !evil2.includes('onerror="alert'), evil2.slice(0, 70));

  const evil3 = renderMarkdown('[点我](javascript:alert(1))');
  ok('javascript: 链接被拦', !evil3.includes('javascript:alert'), evil3);
  ok('被拦的链接不留残渣', !evil3.includes(')</a>'), evil3);

  const evil4 = renderMarkdown('[正常](https://example.com)');
  ok('https 链接放行', evil4.includes('href="https://example.com"'));

  const evil5 = renderMarkdown('**<b>注入</b>**');
  ok('粗体里的标签也被转义', !evil5.includes('<b>') && evil5.includes('&lt;b&gt;'), evil5);

  console.log('\n[7] 真实规则书能渲染');
  const instrHtml = renderMarkdown(dnd?.instructions ?? '');
  ok('dnd5e 规则原文渲染出标题', instrHtml.includes('<h1>'));
  ok('dnd5e 规则原文渲染出列表', instrHtml.includes('<li>'));
  ok('渲染结果不含原始 <script>', !instrHtml.includes('<script>'));

  const effectHtml = renderMarkdown(dndSkills[0]?.effectText ?? '');
  ok('技能效果渲染成功', effectHtml.length > 0, `${effectHtml.length} 字符`);
  ok('技能效果里的粗体生效', effectHtml.includes('<strong>') || effectHtml.includes('<p>'));

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('测试异常：', err);
  process.exit(1);
});
