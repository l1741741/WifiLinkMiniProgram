#!/usr/bin/env node
/* ==========================================================================
 * 生成门店二维码（普通链接二维码 —— 草料那种）
 * --------------------------------------------------------------------------
 *   node tools/gen-store-qr.mjs --domain https://wifi.example.com/w/
 *   node tools/gen-store-qr.mjs --domain https://wifi.example.com/w/ --urls-only
 *
 * 二维码内容形如：
 *   https://wifi.example.com/w/?ssid=咖啡厅WiFi&pwd=abc123&name=悦荟城店
 *
 * 顾客用微信一扫 → 命中后台配好的「二维码规则」→ 直接打开你的小程序。
 *
 * ⚠️ 用之前必须在后台把这三件事做好（缺一不可）：
 *   1. 小程序主体是**企业/媒体/政府及其他组织**（个人主体不支持这个能力）
 *   2. 配一条二维码规则，**域名已通过 ICP 备案验证**
 *   3. 把微信给的校验文件传到规则 URL 的最后一级子目录下
 *   并**发布**规则（规则要先发布，且小程序代码要先发布）
 *
 * 配好之后，门店自己用草料生成同样的链接也能用 ——
 * 这个脚本只是帮你一次性批量出码、并顺手把链接列出来。
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMatrix, toSVG, toPNG } from './qr-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');

const argv = process.argv.slice(2);
const opt = (n, d = '') => {
  const i = argv.indexOf('--' + n);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const has = (n) => argv.includes('--' + n);

const domain = opt('domain', '').trim();
if (!domain) {
  console.error(`
  缺少 --domain。这个域名必须和小程序后台配的「二维码规则」完全一致。

    node tools/gen-store-qr.mjs --domain https://wifi.example.com/w/

  规则要满足：
    · 协议、域名与二维码里的链接一致
    · 以 / 结尾才能匹配子路径（配 https://域名/w/ 可以匹配 https://域名/w/?ssid=x）
    · 域名须通过 ICP 备案验证

  查你的规则：小程序后台 → 开发管理 → 开发设置 → 扫普通链接二维码打开小程序
`);
  process.exit(2);
}

if (!/^https?:\/\//i.test(domain)) {
  console.error(`\n  ✗ --domain 要以 http:// 或 https:// 开头，你给的是「${domain}」\n`);
  process.exit(2);
}

const outDir = path.resolve(ROOT, opt('out', 'dist/store-qr'));
const urlsOnly = has('urls-only');

/* ---------------------------------------------------------- 读门店配置 */
const src = fs.readFileSync(path.join(MP, 'config.js'), 'utf8');
const mod = { exports: {} };
// 不能用 require：根目录 package.json 是 "type":"module"
new Function('module', 'exports', 'require', src)(mod, mod.exports, () => ({}));
const stores = (mod.exports.stores || []).filter((s) => s.ssid);

if (!stores.length) {
  console.error('\n  ✗ config.js 里的 stores 是空的（或都没填 ssid）\n');
  process.exit(2);
}

/* ------------------------------------------------------ 拼链接 */
/**
 * 这个方式和「小程序码 scene」最大的区别：**没有长度限制，而且支持中文**。
 * URL 编码会把中文转成 %XX，微信扫到后原样还原给我们。
 */
function buildUrl(s) {
  const qs = [
    'ssid=' + encodeURIComponent(s.ssid),
    'pwd=' + encodeURIComponent(s.password || ''),
  ];
  // 店名可选；有就带上，页面会显示出来
  if (s.name && s.name !== '本店') qs.push('name=' + encodeURIComponent(s.name));
  return domain.replace(/\/?$/, '/') + '?' + qs.join('&');
}

const items = stores.map((s) => ({
  name: s.name || s.id || s.ssid,
  ssid: s.ssid,
  password: s.password || '',
  url: buildUrl(s),
}));

/* ------------------------------------------------------ 输出 */
console.log(`\n  域名规则  ${domain}`);
console.log(`  门店数量  ${items.length}\n`);
console.log('  各门店链接（可直接贴到草料二维码）：\n');
for (const it of items) {
  console.log(`  ${it.name}`);
  console.log(`    ${it.url}\n`);
}

fs.mkdirSync(outDir, { recursive: true });

// 链接清单：方便复制粘贴，也方便和门店对账
fs.writeFileSync(
  path.join(outDir, 'urls.txt'),
  items.map((it) => `${it.name}\t${it.ssid}\t${it.url}`).join('\n') + '\n',
  'utf8'
);
console.log(`  ✓ 链接清单  ${path.relative(ROOT, path.join(outDir, 'urls.txt'))}`);

if (urlsOnly) {
  console.log('\n  （--urls-only：只出链接，没有生成图片）\n');
  process.exit(0);
}

/* ------------------------------------------------------ 生成二维码 */
const F = 'M';   // 纠错等级：印刷品建议 Q 或 H，这里 M 已经够，尺寸也不至于太大
const cards = [];

for (const it of items) {
  const matrix = makeMatrix(it.url, F);
  const base = (it.ssid || it.name).replace(/[^\w.-]+/g, '_');
  const png = toPNG(matrix, { margin: 4, cellSize: 16 });

  fs.writeFileSync(path.join(outDir, base + '.png'), png);
  fs.writeFileSync(path.join(outDir, base + '.svg'), toSVG(matrix, { margin: 4 }), 'utf8');

  cards.push({ ...it, b64: png.toString('base64') });
  console.log(`  ✓ ${it.name}  →  ${base}.png / .svg   (${matrix.n}×${matrix.n})`);
}

/* ------------------------------------------------------ 打印页 */
if (!has('no-poster')) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>门店 WiFi 二维码</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { margin:0; font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
         background:#eef1f6; padding:16px; }
  .wrap { display:flex; flex-wrap:wrap; gap:16px; justify-content:center; }
  .card { width:150mm; padding:12mm 10mm; background:#fff; border-radius:4mm;
          text-align:center; box-shadow:0 2px 14px rgba(20,30,50,.12); }
  .card__t { font-size:24px; font-weight:700; margin-bottom:6mm; }
  .card img { width:78mm; height:78mm; display:block; margin:0 auto; }
  .card__w { margin-top:6mm; font-size:17px; font-weight:600;
             background:#eef4ff; border-radius:3mm; padding:4mm; }
  .card__s { margin-top:3mm; font-size:14px; color:#7a8697; }
  @media print { body { background:#fff; padding:0; } .card { box-shadow:none; page-break-after:always; } }
</style></head><body><div class="wrap">
${cards.map((c) => `
  <div class="card">
    <div class="card__t">${esc(c.name)}</div>
    <img src="data:image/png;base64,${c.b64}" alt="${esc(c.name)}">
    <div class="card__w">WIFI：${esc(c.ssid)}</div>
    <div class="card__s">微信扫码 → 按提示连接</div>
  </div>`).join('')}
</div></body></html>
`;
  fs.writeFileSync(path.join(outDir, 'print.html'), html, 'utf8');
  console.log(`  ✓ 打印页  ${path.relative(ROOT, path.join(outDir, 'print.html'))}`);
}

console.log(`
  ⚠️ 生成之后还需要做的：

    1. 小程序后台 → 开发管理 → 开发设置 → 扫普通链接二维码打开小程序
       配规则 ${domain}并上传微信给的校验文件，然后**发布规则**
       （规则不发布的话，扫码只会打开网页，不会进小程序）

    2. 规则发布**要求小程序代码已经发布** —— 所以顺序是
       备案 → 发布小程序 → 配并发布二维码规则 → 贴码

  ✅ 规则发布后，门店自己用草料生成同样的链接也能扫开小程序，
     不需要再找你 —— 这就是这套方案的价值。
`);
