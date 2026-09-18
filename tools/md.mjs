/* ==========================================================================
 * 极简 Markdown 渲染器（零依赖）
 * --------------------------------------------------------------------------
 * 支持：标题 / 段落 / 粗体 / 斜体 / 行内代码 / 链接 / 图片 /
 *       有序无序列表 / 引用 / 代码块 / 分割线 / 表格
 *
 * 刻意不支持的：嵌套列表、HTML 块、脚注、参考式链接。
 * 站内文章用不到，少一个特性就少一类渲染 bug。
 * ========================================================================== */

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** 行内标记。输入必须已经是转义过的文本。 */
function inline(text) {
  let out = text;

  // 行内代码先抽走，避免里面的 * _ [ ] 被当成标记处理
  const codes = [];
  out = out.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return '\u0000C' + (codes.length - 1) + '\u0000';
  });

  // 图片要在链接之前处理，否则 ![alt](src) 会被链接规则先吃掉前半截
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (_, alt, src) => `<img src="${src}" alt="${alt}" loading="lazy">`);

  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const external = /^https?:\/\//i.test(href);
    const attrs = external ? ' rel="noopener"' : '';
    return `<a href="${href}"${attrs}>${label}</a>`;
  });

  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  // 还原行内代码
  out = out.replace(/\u0000C(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);

  return out;
}

/** 把表格的一行拆成单元格 */
function splitRow(line) {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

export function renderMarkdown(src) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  const isBlank = (l) => !l || !l.trim();
  const isTableSep = (l) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l) && l.includes('-');

  while (i < lines.length) {
    const line = lines[i];

    /* ---------------------------------------------------- 代码块 ``` */
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1];
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++; // 跳过收尾的 ```
      out.push(`<pre><code${lang ? ` class="lang-${esc(lang)}"` : ''}>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }

    /* --------------------------------------------------------- 标题 */
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      // 页面 <h1> 已经被文章标题占用，所以正文里的 # 和 ## 都落到 <h2>，
      // 其余按原级别。目的是保证 h1 → h2 → h3 逐级不跳级 ——
      // 标题层级跳级（h1 直接到 h3）会被搜索引擎当成结构缺陷。
      const lv = level <= 2 ? 2 : Math.min(6, level);
      out.push(`<h${lv}>${inline(esc(h[2].trim()))}</h${lv}>`);
      i++;
      continue;
    }

    /* ------------------------------------------------------- 分割线 */
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    /* --------------------------------------------------------- 表格 */
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => {
        const left = c.startsWith(':');
        const right = c.endsWith(':');
        if (left && right) return 'center';
        if (right) return 'right';
        return 'left';
      });
      i += 2;

      const body = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) body.push(splitRow(lines[i++]));

      const th = head.map((c, k) =>
        `<th style="text-align:${aligns[k] || 'left'}">${inline(esc(c))}</th>`).join('');
      const trs = body.map((row) =>
        '<tr>' + head.map((_, k) =>
          `<td style="text-align:${aligns[k] || 'left'}">${inline(esc(row[k] || ''))}</td>`).join('') + '</tr>').join('');

      out.push(`<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`);
      continue;
    }

    /* --------------------------------------------------------- 引用 */
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${inline(esc(buf.join(' ').trim()))}</blockquote>`);
      continue;
    }

    /* --------------------------------------------------------- 列表 */
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      const ordered = !!ol;
      const items = [];
      while (i < lines.length) {
        const m = ordered ? /^\s*\d+[.)]\s+(.*)$/.exec(lines[i]) : /^\s*[-*+]\s+(.*)$/.exec(lines[i]);
        if (m) { items.push(m[1]); i++; continue; }
        // 列表项下的续行（缩进 2 空格以上）并入上一项
        if (items.length && /^\s{2,}\S/.test(lines[i])) { items[items.length - 1] += ' ' + lines[i].trim(); i++; continue; }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>` + items.map((t) => `<li>${inline(esc(t))}</li>`).join('') + `</${tag}>`);
      continue;
    }

    /* --------------------------------------------------------- 段落 */
    if (isBlank(line)) { i++; continue; }

    const buf = [line];
    i++;
    while (i < lines.length && !isBlank(lines[i]) &&
           !/^(#{1,6}\s|\s*```|\s*>\s?|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[i]) &&
           !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(esc(buf.join(' ').trim()))}</p>`);
  }

  return out.join('\n');
}

/** 取正文纯文本，用于生成摘要和字数统计 */
export function plainText(src) {
  return String(src)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*`|\-]/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 中文按字计数，英文按词计数，得到一个接近「阅读时长」的估算 */
export function readingTime(src) {
  const text = plainText(src);
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const words = (text.match(/[A-Za-z0-9]+/g) || []).length;
  const minutes = Math.max(1, Math.round((cjk + words * 1.5) / 400));
  return { minutes, cjk, words };
}
