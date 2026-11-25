/**
 * 极轻量的 Markdown 渲染。
 *
 * 规则书的 `instructions` / `effectText` 是 Markdown，但百科页只需要
 * 「标题 / 列表 / 粗体 / 行内代码 / 代码块 / 分隔线」这几种。
 * 为此装 marked + DOMPurify 不值当（还要处理 XSS），所以手写一个。
 *
 * 安全策略：**先转义 HTML，再解析 Markdown**。
 * 这样无论规则书里写了什么标签，都不会真的变成 DOM ——
 * 规则书可能是第三方插件，不能信任。
 */

/** HTML 转义：一切渲染的起点 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 渲染行内语法：`code`、**bold**、*italic*、[text](url)。
 *
 * 输入必须是**已转义**的文本。
 * 链接只放行 http/https，避免 `javascript:` 这类协议。
 */
function renderInline(escaped: string): string {
  let out = escaped;

  // 行内代码先做，避免里面的 ** 被当成粗体
  const codes: string[] = [];
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(code);
    return `\u0000CODE${codes.length - 1}\u0000`;
  });

  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');

  // 链接：url 已在转义阶段处理过引号，这里再拦一次协议。
  // url 允许成对括号（javascript:alert(1) 这种写法才会被完整吞掉，
  // 否则会残留一个 ')' 在正文里）；协议白名单仍然只有 http/https。
  out = out.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (_m, text: string, url: string) => {
    const safe = /^https?:\/\//i.test(url) ? url : '#';
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  out = out.replace(/\u0000CODE(\d+)\u0000/g, (_m, i: string) => `<code>${codes[Number(i)]}</code>`);
  return out;
}

/**
 * 渲染 Markdown 为 HTML 字符串。
 *
 * 支持的块级语法：
 *   # / ## / ###   标题
 *   - / * / 1.     列表（含缩进）
 *   ```            代码块
 *   ---            分隔线
 *   空行           段落分隔
 */
export function renderMarkdown(src: string | undefined | null): string {
  if (!src) return '';

  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];

  let inCode = false;
  let codeBuf: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let paraBuf: string[] = [];

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

  const openList = (type: 'ul' | 'ol') => {
    if (listType === type) return;
    closeList();
    html.push(`<${type}>`);
    listType = type;
  };

  for (const raw of lines) {
    // 代码块
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

    // 空行
    if (!raw.trim()) {
      flushPara();
      closeList();
      continue;
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) {
      flushPara();
      closeList();
      html.push('<hr />');
      continue;
    }

    // 标题
    const h = /^(#{1,4})\s+(.*)$/.exec(raw);
    if (h) {
      flushPara();
      closeList();
      const level = h[1].length;
      html.push(`<h${level}>${renderInline(escapeHtml(h[2].trim()))}</h${level}>`);
      continue;
    }

    // 引用
    const quote = /^\s*>\s?(.*)$/.exec(raw);
    if (quote) {
      flushPara();
      closeList();
      html.push(`<blockquote>${renderInline(escapeHtml(quote[1]))}</blockquote>`);
      continue;
    }

    // 无序列表
    const ul = /^\s*[-*+]\s+(.*)$/.exec(raw);
    if (ul) {
      flushPara();
      openList('ul');
      html.push(`<li>${renderInline(escapeHtml(ul[1]))}</li>`);
      continue;
    }

    // 有序列表
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(raw);
    if (ol) {
      flushPara();
      openList('ol');
      html.push(`<li>${renderInline(escapeHtml(ol[1]))}</li>`);
      continue;
    }

    // 普通段落
    closeList();
    paraBuf.push(raw.trim());
  }

  if (inCode && codeBuf.length) {
    html.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
  }
  flushPara();
  closeList();

  return html.join('\n');
}

/** 取 Markdown 的第一段纯文本，用于摘要展示 */
export function firstParagraph(src: string | undefined | null, maxLen = 120): string {
  if (!src) return '';
  const text = src
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^(#{1,4}\s|```|-{3,})/.test(l))
    .join(' ')
    .replace(/[*_`>]/g, '');
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}
