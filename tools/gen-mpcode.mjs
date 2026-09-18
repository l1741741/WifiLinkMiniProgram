#!/usr/bin/env node
/* ==========================================================================
 * 批量生成门店小程序码（scene 里直接带 WiFi 名和密码）
 * --------------------------------------------------------------------------
 *   WX_APPID=wx... WX_SECRET=... node tools/gen-mpcode.mjs
 *   node tools/gen-mpcode.mjs --appid wx... --secret ... --out dist/mpcode
 *
 * 读 config.js 的 stores，每家店生成一张小程序码：
 *   scene = <ssid>~<password>
 *
 * 顾客扫哪张，就直接拿到那家的 WiFi，**不需要改代码、不需要发版**。
 *
 * ⚠️ 小程序码只能用小程序主体的 access_token 生成 ——
 *    门店自己生成不了，所以这个脚本是你（服务商）替门店出码用的。
 *
 * ⚠️ scene 官方上限 32 个可见字符，且不支持中文。
 *    脚本会逐个校验，放不下的会明确告诉你怎么处理。
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');

/* ------------------------------------------------------------ 参数解析 */
const argv = process.argv.slice(2);
function opt(name, def = '') {
  const i = argv.indexOf('--' + name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
}
const has = (name) => argv.includes('--' + name);

const APPID = process.env.WX_APPID || opt('appid');
const SECRET = process.env.WX_SECRET || opt('secret');
const OUT = path.resolve(ROOT, opt('out', 'dist/mpcode'));
const PAGE = opt('page', 'pages/ad/index');
const WIDTH = parseInt(opt('width', '430'), 10);

// 小程序码指向的版本：release（正式版）/ trial（体验版）/ develop（开发版）
const ENV_VERSION = opt('env', 'release');

if (!APPID || !SECRET) {
  console.error(`
  缺少 AppID 或 AppSecret。

    node tools/gen-mpcode.mjs --appid wx123... --secret abc123...

  或设成环境变量：

    WX_APPID=wx123... WX_SECRET=abc123... node tools/gen-mpcode.mjs

  AppSecret 在：微信公众平台 → 开发管理 → 开发设置 → 小程序代码上传密钥下方
  ⚠️ 这是敏感凭证，别提交进 git，也别贴到聊天里。
`);
  process.exit(2);
}

/* ------------------------------------------------------------ WiFi 规则 */
/** 微信 scene 允许的字符集（官方文档给的） */
const SCENE_ALLOWED = /^[0-9A-Za-z!#$&'()*+,/:;=?@\-._~]+$/;
const SCENE_MAX = 32;

/* ---------------------------------------------------------- 读门店配置 */
const cfgSrc = fs.readFileSync(path.join(MP, 'config.js'), 'utf8');
const mod = { exports: {} };
// 不能用 require：根目录 package.json 是 "type":"module"，会把 config.js 当 ES 模块，
// 拿回来是空对象而且不报错
new Function('module', 'exports', 'require', cfgSrc)(mod, mod.exports, () => ({}));
const cfg = mod.exports;

const stores = cfg.stores || [];
if (!stores.length) {
  console.error('\n  ✗ config.js 里的 stores 是空的，先配门店\n');
  process.exit(2);
}

/* -------------------------------------------------------- 逐个校验并出码 */
console.log('\n  校验门店 → 内联 scene 是否放得下（上限 32 字符，不支持中文）\n');

const ready = [];
const blocked = [];

for (const s of stores) {
  const scene = `${s.ssid || ''}~${s.password || ''}`;
  const name = s.name || s.id || '(未命名)';

  if (!s.ssid) { blocked.push({ name, scene, why: '没填 ssid' }); continue; }

  const badChars = [...new Set([...scene].filter((c) => !/^[0-9A-Za-z!#$&'()*+,/:;=?@\-._~]$/.test(c)))];

  if (badChars.length) {
    blocked.push({ name, scene, why: `含微信不允许的字符：${badChars.join(' ')}（中文 SSID/密码用不了内联模式）` });
  } else if (scene.length > SCENE_MAX) {
    blocked.push({ name, scene, why: `长 ${scene.length} 字符，超出 ${SCENE_MAX}（超标 ${scene.length - SCENE_MAX}）` });
  } else {
    ready.push({ ...s, name, scene });
  }
}

const pad = (t, n) => String(t).padEnd(n, ' ');
for (const r of ready) {
  console.log(`  \x1b[32m✓\x1b[0m ${pad(r.name, 12)} ${pad(r.scene, 34)} ${r.scene.length} 字符`);
}
for (const b of blocked) {
  console.log(`  \x1b[31m✗\x1b[0m ${pad(b.name, 12)} ${pad(b.scene, 34)} ${b.why}`);
}

if (blocked.length) {
  console.log(`
  \x1b[33m放不下的门店怎么办 —— 改用「门店 id 模式」：\x1b[0m

    1. 在 config.js 里保留这家店的配置，给它一个短 id（如 shop2）
    2. 生成码时 scene 填 \x1b[1mshop2\x1b[0m（而不是 SSID~密码），在下方输入框填

  两种模式可以混用：放得下的用内联（改密码不用发版），
  放不下的用 id（代价是改密码要重新发版）。
`);
}

if (!ready.length) {
  console.error('  没有可生成的门店，退出。\n');
  process.exit(1);
}

/* ------------------------------------------------------ 调微信接口生成 */
async function getAccessToken() {
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(APPID)}&secret=${encodeURIComponent(SECRET)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.access_token) {
    const hints = {
      40001: 'AppSecret 不对（也可能 access_token 已过期，重跑一次）',
      40125: 'AppSecret 不对 —— 去公众平台 → 开发管理 → 开发设置 重新复制一次',
      40013: 'AppID 不对',
      40164: '调用来源 IP 不在白名单 —— 去公众平台把本机公网 IP 加进「IP 白名单」',
      45009: '接口调用超过上限',
    };
    throw new Error(`拿 access_token 失败：${data.errcode} ${data.errmsg}${hints[data.errcode] ? '\n     提示：' + hints[data.errcode] : ''}`);
  }
  return data.access_token;
}

async function genCode(token, scene) {
  // env_version 用 release 时，page 必须是已发布版本里存在的页面。
  // 小程序还没发布、或还在开发中，就传 develop/trial。
  const body = {
    scene,
    page: PAGE,
    check_path: false,      // 允许页面尚未发布/不存在，否则开发阶段会报 41030
    env_version: ENV_VERSION,
    width: WIDTH,
  };

  const res = await fetch(`https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const buf = Buffer.from(await res.arrayBuffer());

  // 成功时返回图片二进制，失败时返回 JSON —— 靠内容判断，不能看状态码
  const head = buf.slice(0, 20).toString('utf8');
  if (head.trimStart().startsWith('{')) {
    let err;
    try { err = JSON.parse(buf.toString('utf8')); } catch { err = { errcode: '?', errmsg: buf.toString('utf8').slice(0, 200) }; }
    const hints = {
      40001: 'access_token 无效，重跑一次脚本',
      41030: 'page 不存在。开发阶段请加 --env develop；已发布的话检查页面路径',
      45009: '生成数量超限',
      47001: '参数格式错误（通常 scene 里有非法字符）',
    };
    throw new Error(`${err.errcode} ${err.errmsg}${hints[err.errcode] ? '\n     提示：' + hints[err.errcode] : ''}`);
  }

  return buf;
}

console.log(`\n  开始生成（环境 ${ENV_VERSION}，页面 ${PAGE}）...\n`);

let token;
try {
  token = await getAccessToken();
  console.log('  ✓ 已拿到 access_token\n');
} catch (e) {
  console.error(`  ✗ ${e.message}\n`);
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });

const results = [];
for (const s of ready) {
  const file = path.join(OUT, `${(s.id || s.ssid).replace(/[^\w.-]+/g, '_')}.png`);
  try {
    const png = await genCode(token, s.scene);
    fs.writeFileSync(file, png);
    fs.writeFileSync(path.join(OUT, `${(s.id || s.ssid).replace(/[^\w.-]+/g, '_')}.txt`), s.scene, 'utf8');
    results.push({ ...s, file });
    console.log(`  \x1b[32m✓\x1b[0m ${s.name}  →  ${path.relative(ROOT, file)}`);
  } catch (e) {
    console.log(`  \x1b[31m✗\x1b[0m ${s.name}  →  ${e.message}`);
  }
}

/* ------------------------------------------------------ 出打印页 */
if (results.length && !has('no-poster')) {
  const cards = results.map((r) => {
    const b64 = fs.readFileSync(r.file).toString('base64');
    const ssid = r.ssid;
    const pwd = r.password;
    return `
    <div class="card">
      <div class="card__t">${esc(r.name)}</div>
      <img src="data:image/png;base64,${b64}" alt="${esc(r.name)}">
      <div class="card__w">WIFI：${esc(ssid)}</div>
      <div class="card__s">微信扫码 → 按提示连接</div>
    </div>`;
  }).join('');

  fs.writeFileSync(path.join(OUT, 'print.html'), `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>门店小程序码</title>
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
</style></head><body><div class="wrap">${cards}</div></body></html>
`, 'utf8');
  console.log(`\n  ✓ 打印页  ${path.relative(ROOT, path.join(OUT, 'print.html'))}  （浏览器打开后 ⌘P）`);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

console.log(`\n  共生成 ${results.length} 张${blocked.length ? `，${blocked.length} 家因 scene 限制未生成` : ''}\n`);
process.exit(results.length ? 0 : 1);
