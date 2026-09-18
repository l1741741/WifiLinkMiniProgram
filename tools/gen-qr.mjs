#!/usr/bin/env node
/* ==========================================================================
 * 生成张贴用二维码 / A4 海报
 * --------------------------------------------------------------------------
 *   node tools/gen-qr.mjs --url https://你的域名.com/scan/
 *       → 双码海报（推荐）：大码是系统直连码，小码是工具页兜底码
 *
 *   node tools/gen-qr.mjs --url https://你的域名.com/scan/ --single
 *       → 单码海报，只放工具页入口码（纯变现思路）
 *
 *   node tools/gen-qr.mjs --wifi
 *       → 只生成系统直连码（无广告流程，纯体验思路）
 *
 * 产出到 dist/：每个码一份 svg（印刷用）+ png（微信传图用），外加 poster.html
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMatrix, toSVG, toPNG, buildWifiString } from './qr-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

/* ------------------------------------------------------------ 参数解析 */
const argv = process.argv.slice(2);
function opt(name, def = '') {
  const i = argv.indexOf('--' + name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
}
const has = (name) => argv.includes('--' + name);

/* ------------------------------------------------- 读取 config.js 默认值 */
function readConfig() {
  try {
    const src = fs.readFileSync(path.join(ROOT, 'public', 'assets', 'config.js'), 'utf8');
    const sandbox = {};
    new Function('window', src)(sandbox);
    return sandbox.WIFI_APP_CONFIG || {};
  } catch (e) {
    console.warn('⚠️  读取 config.js 失败，改用命令行参数:', e.message);
    return {};
  }
}

const CFG = readConfig();
const firstWifi = (CFG.wifiList || [])[0] || {};

const ec = opt('ec', 'M').toUpperCase();
const outDir = path.resolve(ROOT, opt('out', 'dist'));
const wifiOnly = has('wifi');
const singleMode = has('single');
const label = opt('label', '免费 WiFi');
const showPassword = has('show-password');   // 默认不印密码，见下方说明

/* --------------------------------------------------------- WiFi 参数 */
const ssid = opt('ssid', firstWifi.ssid || '');
const password = opt('password', firstWifi.password || '');
const security = opt('security', firstWifi.security || 'WPA');

const wifiText = ssid
  ? buildWifiString({ ssid, password, security, hidden: firstWifi.hidden || false })
  : null;

/* --------------------------------------------------------- 入口 URL */
let entryUrl = opt('url', '');
if (!wifiOnly && !entryUrl) {
  console.error('❌ 缺少 --url。例：node tools/gen-qr.mjs --url https://wifi.example.com/scan/');
  console.error('');
  console.error('   注意：这个码要指向扫码工具页 /scan/，不是站点首页。');
  console.error('   指到首页会把到店顾客丢进文章列表里，得先看完文章才能找到 WiFi。');
  process.exit(1);
}

if (entryUrl) {
  try {
    const p = new URL(entryUrl).pathname;
    if (p === '/' || p === '' || p === '/index.html') {
      console.warn('⚠️  这个地址看起来是站点首页。到店顾客应该直接落到工具页，');
      console.warn('    建议改成：' + entryUrl.replace(/\/+$/, '') + '/scan/');
      console.warn('    确认要这样生成就加 --force 跳过提醒。\n');
      if (!has('force')) process.exit(1);
    }
  } catch { /* 不是合法 URL 就交给下面正常处理 */ }
}

if (wifiOnly && !ssid) {
  console.error('❌ 缺少 SSID。请用 --ssid "名称" --password "密码" 指定，或在 config.js 里配好。');
  process.exit(1);
}

/* ================================================================= 生成 */
fs.mkdirSync(outDir, { recursive: true });

/** 生成一个码，写 svg + png，返回渲染信息 */
function build(text, baseName, ecLevel) {
  const matrix = makeMatrix(text, ecLevel);
  const svg = toSVG(matrix, { margin: 4 });
  const png = toPNG(matrix, { margin: 4, cellSize: 16 });
  fs.writeFileSync(path.join(outDir, baseName + '.svg'), svg, 'utf8');
  fs.writeFileSync(path.join(outDir, baseName + '.png'), png);
  return {
    text, matrix, png,
    dataUrl: 'data:image/png;base64,' + png.toString('base64'),
    files: [baseName + '.svg', baseName + '.png'],
  };
}

const made = [];
let wifiQr = null;
let entryQr = null;

if (ssid) {
  wifiQr = build(wifiText, 'wifi-' + ssid.replace(/[^\w.-]+/g, '_'), ec);
  made.push(wifiQr);
  console.log(`  ✓ 系统直连码  ${wifiQr.matrix.n}×${wifiQr.matrix.n} 纠错 ${ec}  → wifi-*.svg / .png`);
  console.log(`    内容: ${wifiText}`);
}

if (!wifiOnly && entryUrl) {
  entryQr = build(entryUrl, 'entry-qr', ec);
  made.push(entryQr);
  console.log(`  ✓ 工具页入口码 ${entryQr.matrix.n}×${entryQr.matrix.n} 纠错 ${ec}  → entry-qr.svg / .png`);
  console.log(`    内容: ${entryUrl}`);
}

console.log(`\n  输出目录: ${path.relative(ROOT, outDir)}/`);

/* ============================================================== 海报 */
function posterHtml() {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const brand = CFG.brand || {};
  const title = label || brand.title || '免费 WiFi';

  // 双码模式：大码直连 + 小码兜底
  const dual = !!(wifiQr && entryQr);
  const mainQr = dual ? wifiQr : (wifiQr || entryQr);
  const subQr = dual ? entryQr : null;

  const mainSteps = wifiQr
    ? `<b>1</b> 打开手机「相机」<b>2</b> 对准上方二维码 <b>3</b> 点灰条上的「加入网络」`
    : `<b>1</b> 打开「相机」或「微信扫一扫」 <b>2</b> 对准上方二维码 <b>3</b> 按页面提示连接`;

  /* 密码要不要印在纸上？
   * 印了 = 所有人都能直接手输，两条扫码路径都失效，广告收入归零；
   * 不印 = 靠 WIFI: 码（2 步连上）已经比手输快，没必要印。
   * 所以默认不印，需要无障碍兜底时用 --show-password 打开。 */
  const pwdLine = showPassword && password
    ? `<div class="pwd">或手动输入密码：<b>${esc(password)}</b></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${esc(title)} · 张贴海报</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  body { margin:0; background:#e9edf3; padding:24px 0;
         font-family:"PingFang SC","Microsoft YaHei",system-ui,-apple-system,sans-serif;
         display:flex; flex-direction:column; align-items:center; gap:18px; }

  .tipbar { font-size:13px; color:#5b6472; background:#fff; border:1px solid #dbe1ea;
            border-radius:8px; padding:9px 16px; }
  .tipbar b { color:#111; }

  .page { width:210mm; min-height:297mm; background:#fff; padding:22mm 20mm 16mm;
          display:flex; flex-direction:column; align-items:center; text-align:center;
          box-shadow:0 2px 20px rgba(20,30,50,.10); }

  h1 { font-size:46px; margin:0 0 6px; color:#0f1524; letter-spacing:.04em; line-height:1.15; }
  .sub { font-size:17px; color:#5b6472; margin:0 0 26px; letter-spacing:.01em; }

  .qrmain { width:118mm; height:118mm; padding:5mm; background:#fff;
            border-radius:5mm; box-shadow:0 0 0 2px #e3e8f0; }
  .qrmain img { width:100%; height:100%; display:block; }

  .ssid { margin-top:22px; font-size:23px; font-weight:700; color:#0f1524;
          background:#eef4ff; border:2px solid #cfdef9; border-radius:4mm;
          padding:11px 26px; letter-spacing:.01em; }
  .ssid small { display:block; font-size:12px; font-weight:400; color:#7a8697;
                letter-spacing:.06em; margin-bottom:3px; }

  .steps { margin-top:22px; font-size:17px; color:#39404e; line-height:2.1; }
  .steps b { display:inline-block; width:22px; height:22px; line-height:22px;
             background:#2f6bff; color:#fff; border-radius:50%; font-size:13px;
             text-align:center; margin-right:5px; }

  .pwd { margin-top:16px; font-size:17px; color:#39404e; }
  .pwd b { font-family:ui-monospace,Menlo,monospace; font-size:21px; color:#0f1524;
           letter-spacing:.06em; }

  /* 小码区：只在双码模式出现，视觉上必须明显弱于主码 */
  .alt { margin-top:auto; padding-top:20px; border-top:1px dashed #d7dde8; width:100%;
         display:flex; align-items:center; gap:7mm; text-align:left; }
  .alt__qr { width:30mm; height:30mm; padding:2mm; background:#fff; flex:none;
             border-radius:3mm; box-shadow:0 0 0 1.5px #e3e8f0; }
  .alt__qr img { width:100%; height:100%; display:block; }
  .alt__t { font-size:15px; color:#39404e; line-height:1.75; }
  .alt__t b { color:#0f1524; }
  /* 单独一行：跟前面的正文挤在一起会读成同一句话 */
  .alt__t span { display:block; margin-top:2px; color:#7a8697; font-size:12.5px; }

  .foot { margin-top:16px; font-size:11.5px; color:#9aa4b2; }

  @media print { body { background:#fff; padding:0; gap:0; }
                 .page { box-shadow:none; }
                 .tipbar { display:none; } }
</style>
</head>
<body>

  <div class="tipbar">本页可直接打印：<b>⌘P</b> / <b>Ctrl+P</b> → 纸张 A4 → 缩放「默认」→ 关掉「页眉页脚」</div>

  <div class="page">
    <h1>${esc(title)}</h1>
    <p class="sub">${wifiQr ? '手机相机扫一下，自动帮你连上，不用问密码' : '扫码获取 WiFi 信息'}</p>

    <div class="qrmain"><img src="${mainQr.dataUrl}" alt="扫码连接 WiFi"></div>

    <div class="ssid">
      <small>WIFI 名称</small>
      ${esc(ssid || '见店内提示')}
    </div>

    <div class="steps">${mainSteps}</div>
    ${pwdLine}

    ${subQr ? `
    <div class="alt">
      <div class="alt__qr"><img src="${subQr.dataUrl}" alt="备选二维码"></div>
      <div class="alt__t">
        <b>扫上面的码没反应？</b><br>
        用「微信扫一扫」扫左边这个，<br>
        页面里会告诉你密码和连接步骤。
        <span>老年机 / 旧系统 / 相机识别不出来时用这个</span>
      </div>
    </div>` : ''}

    <div class="foot">${esc(brand.shopName || '')}</div>
  </div>

</body>
</html>
`;
}

if (!has('no-poster')) {
  const p = path.join(outDir, 'poster.html');
  fs.writeFileSync(p, posterHtml(), 'utf8');
  const mode = (wifiQr && entryQr) ? '双码（大码直连 + 小码兜底）'
             : wifiQr ? '单码（系统直连，无广告流程）'
             : '单码（工具页入口，含广告流程）';
  console.log(`  ✓ poster.html  ${mode}`);
  if (wifiQr && entryQr && !showPassword) {
    console.log(`\n  提示：海报上没有印文字密码 —— 印了的话两条扫码路径都会失效，广告收入归零。`);
    console.log(`        WIFI: 码本身已经是 2 步连上，比手输密码更快，不需要印。`);
    console.log(`        确实需要无障碍兜底时，加 --show-password。`);
  }
}

console.log('');
