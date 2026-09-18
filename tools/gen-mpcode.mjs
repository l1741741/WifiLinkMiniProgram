#!/usr/bin/env node
/* ==========================================================================
 * 批量生成门店小程序码（scene 里直接带 WiFi 名和密码）
 * --------------------------------------------------------------------------
 *   node tools/gen-mpcode.mjs                      读 .secrets.json 里的凭证
 *   node tools/gen-mpcode.mjs --appid wx... --secret ...
 *   WX_APPID=wx... WX_SECRET=... node tools/gen-mpcode.mjs
 *
 * 读 config.js 的 stores，每家店生成一张小程序码：
 *   scene = <ssid>~<password>      明文（ASCII 且放得下）
 *   scene = base64url(...)         中文自动编码
 *
 * 顾客扫哪张就直接拿到那家的 WiFi，**不需要改代码、不需要发版**。
 *
 * 只加一家店的话用 node tools/add-store.mjs，那个会问你问题、更省事。
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, readConfig, buildScene, loadCredentials,
  getAccessToken, genMiniProgramCode, posterHtml, pad, SCENE_MAX,
} from './wx-api.mjs';

/* ------------------------------------------------------------ 参数解析 */
const argv = process.argv.slice(2);
const opt = (n, d = '') => {
  const i = argv.indexOf('--' + n);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const has = (n) => argv.includes('--' + n);

const saved = loadCredentials();
const APPID = opt('appid', saved.appid);
const SECRET = opt('secret', saved.secret);
const ENV_VERSION = opt('env', 'release');
const PAGE = opt('page', 'pages/ad/index');
const WIDTH = parseInt(opt('width', '430'), 10);
const outDir = path.resolve(ROOT, opt('out', 'dist/mpcode'));

/* ---------------------------------------------------------- 读门店配置 */
const cfg = readConfig();
const stores = cfg.stores || [];

if (!stores.length) {
  console.error('\n  ✗ config.js 里的 stores 是空的。');
  console.error('    加一家店：node tools/add-store.mjs\n');
  process.exit(2);
}

/* -------------------------------------------------------- 逐个校验 */
console.log('\n  校验门店 → scene 是否放得下\n');
console.log('  明文最高 31 字节；中文自动转 base64url（上限约 23 字节）\n');

const ready = [];
const blocked = [];

for (const s of stores) {
  const name = s.name || s.id || '(未命名)';
  if (!s.ssid) { blocked.push({ name, scene: '', why: '没填 ssid' }); continue; }

  const r = buildScene(s.ssid, s.password || '');
  if (r.mode === 'too-long') blocked.push({ name, scene: r.scene, why: r.why });
  else ready.push({ ...s, name, scene: r.scene, mode: r.mode });
}

for (const r of ready) {
  const tag = r.mode === 'b64' ? '\x1b[36m[编码]\x1b[0m' : '[明文]';
  console.log(`  \x1b[32m✓\x1b[0m ${tag} ${pad(r.name, 12)} ${pad(r.scene, 34)} ${r.scene.length} 字符`);
}
for (const b of blocked) {
  console.log(`  \x1b[31m✗\x1b[0m        ${pad(b.name, 12)} ${pad(b.scene, 34)} ${b.why}`);
}

if (blocked.length) {
  console.log(`
  \x1b[33m放不下的门店怎么办 —— 改用「门店 id 模式」：\x1b[0m

    在 config.js 里保留这家店的配置，小程序码的 scene 填它的 id（如 shop2），
    而不是 SSID~密码。代价是以后改密码要重新发版。

    两种模式可以混用：放得下的用内联，放不下的用 id。
`);
}

if (!ready.length) {
  console.error('  没有可生成的门店，退出。\n');
  process.exit(1);
}

/* ------------------------------------------------------ 校验凭证 */
if (!APPID || !SECRET) {
  console.error(`
  缺少 AppID 或 AppSecret。三种给法：

    1. 用交互式工具（会问你，并存到 .secrets.json）
         node tools/add-store.mjs

    2. 命令行传
         node tools/gen-mpcode.mjs --appid wx123... --secret abc123...

    3. 环境变量
         WX_APPID=wx123... WX_SECRET=abc123... node tools/gen-mpcode.mjs

  AppSecret 在：公众平台 → 开发管理 → 开发设置
  ⚠️ 敏感凭证，别提交进 git，也别贴到聊天里。
`);
  process.exit(2);
}

/* ------------------------------------------------------ 生成 */
console.log(`\n  开始生成（环境 ${ENV_VERSION}，页面 ${PAGE}）...\n`);

let token;
try {
  token = await getAccessToken(APPID, SECRET);
  console.log('  ✓ 已拿到 access_token\n');
} catch (e) {
  console.error(`  ✗ ${e.message}\n`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

const results = [];
const cards = [];

for (const s of ready) {
  const base = (s.name || s.id || s.ssid).replace(/[^\w\u4e00-\u9fa5.-]+/g, '_');
  const file = path.join(outDir, `${base}.png`);
  try {
    const png = await genMiniProgramCode(token, s.scene, {
      page: PAGE, envVersion: ENV_VERSION, width: WIDTH,
    });
    fs.writeFileSync(file, png);
    fs.writeFileSync(path.join(outDir, `${base}.txt`), s.scene, 'utf8');
    results.push({ ...s, file });
    cards.push({ name: s.name, ssid: s.ssid, b64: png.toString('base64') });
    console.log(`  \x1b[32m✓\x1b[0m ${s.name}  →  ${path.relative(ROOT, file)}`);
  } catch (e) {
    console.log(`  \x1b[31m✗\x1b[0m ${s.name}  →  ${e.message}`);
  }
}

/* ------------------------------------------------------ 打印页 + 链接清单 */
if (results.length) {
  fs.writeFileSync(
    path.join(outDir, 'scenes.txt'),
    results.map((r) => `${r.name}\t${r.ssid}\t${r.scene}`).join('\n') + '\n',
    'utf8'
  );

  if (!has('no-poster')) {
    fs.writeFileSync(path.join(outDir, 'print.html'), posterHtml(cards), 'utf8');
    console.log(`\n  ✓ 打印页  ${path.relative(ROOT, path.join(outDir, 'print.html'))}  （浏览器打开后 ⌘P）`);
  }
  console.log(`  ✓ scene 清单  ${path.relative(ROOT, path.join(outDir, 'scenes.txt'))}`);
}

console.log(`\n  共生成 ${results.length} 张${blocked.length ? `，${blocked.length} 家因 scene 限制未生成` : ''}\n`);
console.log('  ⚠️ 小程序还没发布时用 --env develop 或 --env trial；发布后重新跑一次用默认的 release。\n');
process.exit(results.length ? 0 : 1);
