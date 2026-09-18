#!/usr/bin/env node
/* ==========================================================================
 * 静态站生成器（零依赖）
 * --------------------------------------------------------------------------
 *   node tools/build-site.mjs
 *
 * 读 content/posts/*.md 和 content/pages/*.md，生成到 public/：
 *   首页 · 文章详情 · 栏目页 · 单页(关于/隐私/免责) · sitemap.xml · robots.txt · rss.xml
 *
 * public/scan/ 是手写的扫码工具页，本脚本不碰它。
 *
 * 为什么不用现成的 SSG：这是个要长期跑、随时可能要改的小站。
 * 引入 Hexo/VitePress 之后，一年后想改个页脚都得先回忆构建链。
 * 这点需求自己写 300 行更可控，而且改一行立刻看到结果。
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import site from '../site.config.mjs';
import { renderMarkdown, plainText, readingTime } from './md.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const CONTENT = path.join(ROOT, 'content');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const problems = [];
const warn = (msg) => problems.push(msg);

/* ============================================================ front-matter */
function parseFrontMatter(raw, file) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw.replace(/\r\n?/g, '\n'));
  if (!m) {
    warn(`${file}: 缺少 front-matter（文件开头需要 --- 包起来的元信息）`);
    return { data: {}, body: raw };
  }
  const data = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) { warn(`${file}: front-matter 里这行看不懂 → ${line}`); continue; }
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    data[kv[1]] = v;
  }
  return { data, body: m[2] };
}

/* ================================================================ 读取文章 */
function loadDir(dir, kind) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .map((f) => {
      const full = path.join(dir, f);
      const { data, body } = parseFrontMatter(fs.readFileSync(full, 'utf8'), path.relative(ROOT, full));
      const base = f.replace(/\.md$/, '');
      const slug = data.slug || base;

      if (kind === 'post') {
        if (!data.title) warn(`${f}: 缺 title`);
        if (!data.category) warn(`${f}: 缺 category`);
        else if (!site.categories.some((c) => c.slug === data.category)) {
          warn(`${f}: category "${data.category}" 不在 site.config.mjs 的 categories 里`);
        }
        if (!data.date) warn(`${f}: 缺 date`);
      }
      if (!data.title) warn(`${f}: 缺 title`);

      const rt = readingTime(body);
      const summary = data.summary || plainText(body).slice(0, 110) + '…';

      return {
        kind, slug, file: f,
        ...data,
        summary,
        bodyHtml: renderMarkdown(body),
        minutes: rt.minutes,
        words: rt.cjk + rt.words,
        dateText: data.date || '',
      };
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

const posts = loadDir(path.join(CONTENT, 'posts'), 'post');
const pages = loadDir(path.join(CONTENT, 'pages'), 'page');

/* ============================================================== 布局模板 */
const abs = (p) => site.url.replace(/\/$/, '') + p;

function layout({ title, description, canonical, body, activeNav = '' }) {
  const pageTitle = title ? `${title} · ${site.name}` : `${site.name} — ${site.slogan}`;
  const desc = description || site.description;

  const nav = site.nav.map((n) =>
    `<a href="${n.href}"${n.href === activeNav ? ' class="is-active" aria-current="page"' : ''}>${esc(n.label)}</a>`
  ).join('');

  // 备案号必须展示在页脚并可点回工信部，这是硬性要求；没备案就老实说没备案
  const icpLine = site.icp
    ? `<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener nofollow">${esc(site.icp)}</a>`
    : '<span class="foot__pending">ICP 备案办理中</span>';
  const policeLine = site.police ? ` · <span>${esc(site.police)}</span>` : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(desc)}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(pageTitle)}">
<meta property="og:description" content="${esc(desc)}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/site.css">
</head>
<body>
<a class="skip" href="#main">跳到正文</a>

<header class="hd">
  <div class="hd__in">
    <a class="hd__brand" href="/">
      <span class="hd__mark" aria-hidden="true">◍</span>
      <span class="hd__name">${esc(site.name)}</span>
    </a>
    <nav class="hd__nav" aria-label="主导航">${nav}</nav>
  </div>
</header>

<main id="main" class="main">
${body}
</main>

<footer class="ft">
  <div class="ft__in">
    <div class="ft__col">
      <p class="ft__name">${esc(site.name)}</p>
      <p class="ft__desc">${esc(site.footerNote)}</p>
      <p class="ft__contact">联系：<a href="mailto:${esc(site.email)}">${esc(site.email)}</a></p>
    </div>
    <div class="ft__col">
      <p class="ft__t">栏目</p>
      ${site.categories.map((c) => `<a href="/category/${c.slug}.html">${esc(c.name)}</a>`).join('')}
    </div>
    <div class="ft__col">
      <p class="ft__t">站点</p>
      <a href="/about.html">关于我们</a>
      <a href="/privacy.html">隐私政策</a>
      <a href="/disclaimer.html">免责声明</a>
      <a href="${esc(site.scanPath)}">扫码连 WiFi 工具</a>
    </div>
  </div>
  <div class="ft__bar">
    <span>© ${new Date().getFullYear()} ${esc(site.name)}</span>
    <span>${icpLine}${policeLine}</span>
  </div>
</footer>
</body>
</html>
`;
}

/* ================================================================ 组件 */
const catName = (slug) => (site.categories.find((c) => c.slug === slug) || {}).name || slug;

function postCard(p) {
  return `    <li class="card">
      <a class="card__link" href="/posts/${p.slug}.html">
        <h3 class="card__t">${esc(p.title)}</h3>
        <p class="card__s">${esc(p.summary)}</p>
        <p class="card__m"><span class="tag">${esc(catName(p.category))}</span> ${esc(p.dateText)} · 约 ${p.minutes} 分钟</p>
      </a>
    </li>`;
}

const listHtml = (items) => `<ul class="cards">\n${items.map(postCard).join('\n')}\n</ul>`;

/* ================================================================= 写盘 */
function write(relPath, content) {
  const full = path.join(PUBLIC, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

const written = [];

/* ------------------------------------------------------------- 首页 */
{
  const recent = posts.slice(0, 6);
  const body = `
<section class="hero">
  <h1 class="hero__t">${esc(site.slogan)}</h1>
  <p class="hero__s">${esc(site.description)}</p>
</section>

<section class="sec">
  <h2 class="sec__t">最新文章</h2>
  ${listHtml(recent)}
</section>

<section class="sec">
  <h2 class="sec__t">按栏目浏览</h2>
  <ul class="cats">
    ${site.categories.map((c) => {
      const n = posts.filter((p) => p.category === c.slug).length;
      return `<li class="cats__i">
      <a href="/category/${c.slug}.html">
        <h3>${esc(c.name)} <span class="cats__n">${n} 篇</span></h3>
        <p>${esc(c.desc)}</p>
      </a>
    </li>`;
    }).join('')}
  </ul>
</section>

<section class="sec sec--tool">
  <h2 class="sec__t">店内扫码连 WiFi 工具</h2>
  <p>给顾客扫的二维码落地页：自动复制密码、按机型给出连接步骤，可自定义门店信息。</p>
  <a class="btn" href="${esc(site.scanPath)}">打开工具页</a>
</section>
`;
  written.push(write('index.html', layout({
    title: '',
    canonical: abs('/'),
    body,
    activeNav: '/',
  })));
}

/* --------------------------------------------------------- 文章详情页 */
for (const p of posts) {
  const related = posts
    .filter((x) => x.slug !== p.slug && x.category === p.category)
    .slice(0, 4);

  const body = `
<nav class="crumb" aria-label="面包屑">
  <a href="/">首页</a> <span>›</span>
  <a href="/category/${p.category}.html">${esc(catName(p.category))}</a> <span>›</span>
  <span class="crumb__now">${esc(p.title)}</span>
</nav>

<article class="post">
  <header class="post__hd">
    <h1 class="post__t">${esc(p.title)}</h1>
    <p class="post__m">
      <a class="tag" href="/category/${p.category}.html">${esc(catName(p.category))}</a>
      <time datetime="${esc(p.dateText)}">${esc(p.dateText)}</time>
      <span>约 ${p.minutes} 分钟</span>
    </p>
  </header>
  <div class="prose">
${p.bodyHtml}
  </div>
</article>

${related.length ? `<section class="sec">
  <h2 class="sec__t">同栏目文章</h2>
  ${listHtml(related)}
</section>` : ''}
`;
  written.push(write(`posts/${p.slug}.html`, layout({
    title: p.title,
    description: p.summary,
    canonical: abs(`/posts/${p.slug}.html`),
    body,
    activeNav: `/category/${p.category}.html`,
  })));
}

/* ------------------------------------------------------------- 栏目页 */
for (const c of site.categories) {
  const list = posts.filter((p) => p.category === c.slug);
  const body = `
<nav class="crumb" aria-label="面包屑">
  <a href="/">首页</a> <span>›</span>
  <span class="crumb__now">${esc(c.name)}</span>
</nav>

<section class="sec">
  <h1 class="sec__t">${esc(c.name)}</h1>
  <p class="sec__lead">${esc(c.desc)}</p>
  ${list.length ? listHtml(list) : '<p class="empty">这个栏目还在写。</p>'}
</section>
`;
  written.push(write(`category/${c.slug}.html`, layout({
    title: c.name,
    description: c.desc,
    canonical: abs(`/category/${c.slug}.html`),
    body,
    activeNav: `/category/${c.slug}.html`,
  })));
}

/* ------------------------------------------------------------- 单页面 */
for (const pg of pages) {
  const body = `
<nav class="crumb" aria-label="面包屑">
  <a href="/">首页</a> <span>›</span>
  <span class="crumb__now">${esc(pg.title)}</span>
</nav>

<article class="post">
  <header class="post__hd"><h1 class="post__t">${esc(pg.title)}</h1>
  ${pg.dateText ? `<p class="post__m"><time datetime="${esc(pg.dateText)}">${esc(pg.dateText)}</time></p>` : ''}
  </header>
  <div class="prose">
${pg.bodyHtml}
  </div>
</article>
`;
  written.push(write(`${pg.slug}.html`, layout({
    title: pg.title,
    description: pg.summary,
    canonical: abs(`/${pg.slug}.html`),
    body,
  })));
}

/* ------------------------------------------- 站点信息（供工具页复用）
 * /scan/ 是手写页面，但它也在同一个站点下，页脚同样要展示备案号。
 * 与其两处各维护一份，不如由构建脚本从 site.config.mjs 生成这个文件。
 * 以后改备案号只需改 site.config.mjs 一处。 */
written.push(write('assets/site-info.js', `/* 由 tools/build-site.mjs 自动生成，请勿手改 */
window.SITE_INFO = ${JSON.stringify({
  name: site.name,
  url: site.url,
  icp: site.icp,
  police: site.police,
  email: site.email,
  homePath: '/',
}, null, 2)};
`));

/* ------------------------------------------------- 给工具页注入备案信息
 * /scan/ 是手写页面，但它同样属于本站，页脚也要展示备案号。
 * 关键：必须写成**静态 HTML**，不能靠 JS 运行时填充 ——
 * 爬虫和审核方看的是服务端返回的原始 HTML，JS 注入的内容它们可能看不到。
 * 备案信息是硬性合规要求，不能建立在“爬虫会执行 JS”这个假设上。
 * 幂等：重复构建不会重复追写。 */
{
  const scanFile = path.join(PUBLIC, 'scan', 'index.html');
  if (fs.existsSync(scanFile)) {
    const html = fs.readFileSync(scanFile, 'utf8');
    const icpHtml = site.icp
      ? `<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener nofollow">${esc(site.icp)}</a>`
        + (site.police ? ` · ${esc(site.police)}` : '')
      : '<span class="site-ft__pending">ICP 备案办理中</span>';

    if (!/<!--ICP:START-->[\s\S]*?<!--ICP:END-->/.test(html)) {
      warn('public/scan/index.html 里找不到 <!--ICP:START--> / <!--ICP:END--> 标记，无法注入备案信息');
    } else {
      const next = html.replace(/(<!--ICP:START-->)[\s\S]*?(<!--ICP:END-->)/, `$1${icpHtml}$2`);
      if (next !== html) {
        fs.writeFileSync(scanFile, next, 'utf8');
        written.push(scanFile);
      }
    }
  }
}

/* ----------------------------------------------------- sitemap / robots */
{
  const urls = [
    { loc: abs('/'), pri: '1.0', freq: 'daily' },
    ...site.categories.map((c) => ({ loc: abs(`/category/${c.slug}.html`), pri: '0.7', freq: 'weekly' })),
    ...pages.map((p) => ({ loc: abs(`/${p.slug}.html`), pri: '0.3', freq: 'yearly' })),
    ...posts.map((p) => ({ loc: abs(`/posts/${p.slug}.html`), pri: '0.8', freq: 'monthly', last: p.dateText })),
  ];
  // 注意：/scan/ 工具页故意不进 sitemap ——
  // 它标了 noindex（那是给到店顾客用的落地页，不该被搜索引擎当内容收录），
  // 把 noindex 页面放进 sitemap 是自相矛盾的信号。
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${esc(u.loc)}</loc>${u.last ? `\n    <lastmod>${esc(u.last)}</lastmod>` : ''}
    <changefreq>${u.freq}</changefreq>
    <priority>${u.pri}</priority>
  </url>`).join('\n')}
</urlset>
`;
  written.push(write('sitemap.xml', xml));

  written.push(write('robots.txt', `User-agent: *
Allow: /

Sitemap: ${abs('/sitemap.xml')}
`));
}

/* ------------------------------------------------------------------ RSS */
{
  const items = posts.slice(0, 20).map((p) => `    <item>
      <title>${esc(p.title)}</title>
      <link>${esc(abs(`/posts/${p.slug}.html`))}</link>
      <guid isPermaLink="true">${esc(abs(`/posts/${p.slug}.html`))}</guid>
      <pubDate>${p.dateText ? new Date(p.dateText + 'T00:00:00+08:00').toUTCString() : ''}</pubDate>
      <description>${esc(p.summary)}</description>
    </item>`).join('\n');

  written.push(write('rss.xml', `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${esc(site.name)}</title>
    <link>${esc(abs('/'))}</link>
    <description>${esc(site.description)}</description>
    <language>zh-CN</language>
${items}
  </channel>
</rss>
`));
}

/* ================================================================ 报告 */
console.log(`\n  站点已生成 → public/\n`);
console.log(`  首页        1 个`);
console.log(`  文章        ${posts.length} 篇`);
console.log(`  栏目        ${site.categories.length} 个`);
console.log(`  单页        ${pages.length} 个（${pages.map((p) => p.title).join('、') || '无'}）`);
console.log(`  sitemap / robots / rss  各 1 份`);
console.log(`\n  合计写入 ${written.length} 个文件`);

if (!site.icp) {
  console.log(`\n  \x1b[33m! 页脚目前显示「ICP 备案办理中」——site.config.mjs 里填上备案号才会显示真实备案信息。\x1b[0m`);
}
if (site.url.includes('example.com')) {
  console.log(`  \x1b[33m! site.config.mjs 里的 url 还是示例域名，生成 sitemap 前记得改成真实域名。\x1b[0m`);
}

if (problems.length) {
  console.log(`\n  \x1b[31m✗ 还有 ${problems.length} 处问题要修：\x1b[0m`);
  problems.forEach((p) => console.log('    - ' + p));
  process.exit(1);
}
console.log(`\n  \x1b[32m✓ 内容校验通过\x1b[0m\n`);
