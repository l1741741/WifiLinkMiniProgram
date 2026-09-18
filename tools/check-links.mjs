#!/usr/bin/env node
/* ==========================================================================
 * 死链与站点完整性检查
 * --------------------------------------------------------------------------
 *   node tools/check-links.mjs
 *
 * 百度联盟的常见拒绝理由里明确包含「大量 404 / 死链」，
 * 所以这一步必须自动化，不能靠人点。
 *
 * 检查四件事：
 *   1. 每个页面里的站内链接是否都能落到真实文件
 *   2. 锚点链接（#xxx）目标页上是否真有这个 id
 *   3. sitemap.xml 里的 URL 是否都存在
 *   4. 有没有孤儿页（存在但没有任何页面链向它）
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import site from '../site.config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');

/* -------------------------------------------------------- 收集所有页面 */
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const allFiles = walk(PUBLIC);
const htmlFiles = allFiles.filter((f) => f.endsWith('.html'));

/** URL 路径 → 磁盘文件。处理目录形式的 /scan/ → /scan/index.html */
function resolveUrl(urlPath) {
  let p = urlPath.split('?')[0].split('#')[0];
  if (!p.startsWith('/')) p = '/' + p;
  const candidates = [
    path.join(PUBLIC, p),
    path.join(PUBLIC, p.replace(/\/$/, '') + '.html'),
    path.join(PUBLIC, p.replace(/\/$/, ''), 'index.html'),
  ];
  return candidates.find((c) => c.startsWith(PUBLIC) && fs.existsSync(c) && fs.statSync(c).isFile()) || null;
}

const exists = (urlPath) => !!resolveUrl(urlPath);

/* ------------------------------------------- 从 HTML 里抽出 id 和链接 */
function idsOf(html) {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
}

function linksOf(html) {
  const out = [];
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) out.push(m[1]);
  return out;
}

const errors = [];
const warnings = [];

/* ------------------------------------------------------------ 逐页检查 */
for (const file of htmlFiles) {
  const rel = '/' + path.relative(PUBLIC, file).split(path.sep).join('/');
  const html = fs.readFileSync(file, 'utf8');
  const selfIds = idsOf(html);

  for (const raw of linksOf(html)) {
    // 跳过外链、协议链接、数据 URI、邮件
    if (/^(https?:|mailto:|tel:|data:|javascript:|#|blob:)/i.test(raw)) {
      // 纯页内锚点也要验证
      if (raw.startsWith('#') && raw.length > 1 && !selfIds.has(raw.slice(1))) {
        errors.push(`${rel}: 页内锚点 #${raw.slice(1)} 在本页不存在`);
      }
      continue;
    }

    const [pathPart, hashPart] = raw.split('#');
    const target = resolveUrl(pathPart);

    if (!target) {
      errors.push(`${rel}: 死链 → ${raw}`);
      continue;
    }

    if (hashPart) {
      const tHtml = fs.readFileSync(target, 'utf8');
      if (!idsOf(tHtml).has(hashPart)) {
        errors.push(`${rel}: 锚点失效 → ${raw}（目标页没有 id="${hashPart}"）`);
      }
    }
  }
}

/* ------------------------------------------------- 检查 HTML 结构基本项 */
for (const file of htmlFiles) {
  const rel = '/' + path.relative(PUBLIC, file).split(path.sep).join('/');
  const html = fs.readFileSync(file, 'utf8');

  const h1 = (html.match(/<h1[\s>]/g) || []).length;
  if (h1 === 0) errors.push(`${rel}: 没有 <h1>`);
  if (h1 > 1) warnings.push(`${rel}: 有 ${h1} 个 <h1>（建议每页只保留一个）`);

  if (!/<meta name="description" content="[^"]{10,}"/.test(html)) {
    errors.push(`${rel}: 缺少有效的 meta description`);
  }
  if (!/<title>[^<]{6,}<\/title>/.test(html)) {
    errors.push(`${rel}: <title> 太短或缺失`);
  }

  // 备案号必须展示在页脚并可点回工信部，这是硬性要求。
  // 但还没拿到备案号时不该假装有，也不该因此判定失败 —— 条件检查：
  //   配了 icp   → 页脚必须有工信部链接且号码一致（否则错误）
  //   没配 icp   → 只要求页脚明确写「备案办理中」，不能静默省略
  if (site.icp) {
    if (!/beian\.miit\.gov\.cn/.test(html)) {
      errors.push(`${rel}: 页脚缺少工信部备案链接（硬性要求）`);
    }
    if (!html.includes(site.icp)) {
      errors.push(`${rel}: 页脚显示的备案号与 site.config.mjs 不一致`);
    }
  } else if (!/beian\.miit\.gov\.cn/.test(html) && !/备案办理中/.test(html)) {
    errors.push(`${rel}: 既没有备案号也没有「备案办理中」提示`);
  }
  if (!/lang="zh-CN"/.test(html)) warnings.push(`${rel}: <html> 缺少 lang="zh-CN"`);
}

/* --------------------------------------------------- sitemap URL 可达性 */
const smPath = path.join(PUBLIC, 'sitemap.xml');
if (!fs.existsSync(smPath)) {
  errors.push('缺少 sitemap.xml');
} else {
  const sm = fs.readFileSync(smPath, 'utf8');
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const base = site.url.replace(/\/$/, '');

  for (const loc of locs) {
    if (!loc.startsWith(base)) {
      errors.push(`sitemap: ${loc} 与 site.config.mjs 的 url 不一致`);
      continue;
    }
    const rel = loc.slice(base.length) || '/';
    if (!exists(rel)) errors.push(`sitemap: ${loc} 对应的文件不存在`);
  }

  // 反向检查：有没有生成的页面忘了进 sitemap
  // 注意要把两种写法归一化：sitemap 里写 /scan/，磁盘上是 /scan/index.html，
  // 直接比字符串会误报
  const inSitemap = new Set();
  const noindexPages = [];
  for (const loc of locs) {
    const p = loc.slice(base.length) || '/';
    inSitemap.add(p);
    if (p.endsWith('/')) inSitemap.add(p + 'index.html');
  }
  for (const file of htmlFiles) {
    const rel = '/' + path.relative(PUBLIC, file).split(path.sep).join('/');
    if (inSitemap.has(rel)) continue;
    if (rel === '/index.html' && inSitemap.has('/')) continue;
    // 标了 noindex 的页面本就不该进 sitemap
    if (/<meta\s+name="robots"[^>]*noindex/i.test(fs.readFileSync(file, 'utf8'))) { noindexPages.push(rel); continue; }
    warnings.push(`sitemap: 漏了 ${rel}`);
  }
  if (noindexPages.length) console.log(`  已跳过 ${noindexPages.length} 个 noindex 页面：${noindexPages.join(', ')}`);
}

/* --------------------------------------------------------- 孤儿页检查 */
{
  const linked = new Set();
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8');
    for (const raw of linksOf(html)) {
      if (/^(https?:|mailto:|tel:|data:|javascript:|#)/i.test(raw)) continue;
      const target = resolveUrl(raw.split('#')[0]);
      if (target) linked.add(target);
    }
  }
  for (const file of htmlFiles) {
    const rel = '/' + path.relative(PUBLIC, file).split(path.sep).join('/');
    if (rel === '/index.html') continue;
    if (!linked.has(file)) warnings.push(`孤儿页: ${rel} 没有任何页面链向它`);
  }
}

/* --------------------------------------------------------------- 输出 */
const rel = (f) => '/' + path.relative(PUBLIC, f).split(path.sep).join('/');

console.log(`\n\x1b[1m站点完整性检查\x1b[0m`);
console.log(`  扫描 ${htmlFiles.length} 个 HTML 文件\n`);

if (warnings.length) {
  console.log(`\x1b[33m  警告 ${warnings.length} 条：\x1b[0m`);
  warnings.forEach((w) => console.log('    · ' + w));
  console.log('');
}

if (errors.length) {
  console.log(`\x1b[31m  ✗ 错误 ${errors.length} 条：\x1b[0m`);
  errors.forEach((e) => console.log('    · ' + e));
  console.log(`\n\x1b[31m  ✗ 检查未通过\x1b[0m\n`);
  process.exit(1);
}

console.log(`\x1b[32m  ✓ 无死链、无缺失页、sitemap 与文件一一对应\x1b[0m\n`);
