/* ==========================================================================
 * 共用模块：读配置、编 scene、调微信接口
 * --------------------------------------------------------------------------
 * gen-mpcode.mjs 和 add-store.mjs 都从这里取，避免两处各写一遍。
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, '..');
export const MP = path.join(ROOT, 'miniprogram');
export const CONFIG_PATH = path.join(MP, 'config.js');

/** 微信 scene 允许的字符集（官方文档给的） */
export const SCENE_ALLOWED = /^[0-9A-Za-z!#$&'()*+,/:;=?@\-._~]+$/;
export const SCENE_MAX = 32;

/** 插入标记：add-store.mjs 靠它定位新门店该写在哪 */
export const INSERT_MARK = '// ===STORE-INSERT===';

/* ---------------------------------------------------------- 读 config.js */
/**
 * 不能用 require：根目录 package.json 是 "type":"module"，
 * 而 miniprogram/ 下没有自己的 package.json，Node 会向上继承这个设定，
 * 把 config.js 当 ES 模块 —— require 回来是空对象，而且不报错。
 */
export function readConfig() {
  const src = fs.readFileSync(CONFIG_PATH, 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', src)(mod, mod.exports, () => ({}));
  return mod.exports;
}

/* ---------------------------------------------------- base64url 编码 */
/** 字母表 A-Z a-z 0-9 - _ 完全落在微信允许的字符集内，所以不需要 `%` */
export const b64url = (s) => Buffer.from(s, 'utf8').toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * 把 WiFi 信息编成 scene。优先明文（不膨胀），放不下再 base64url。
 * 返回 { scene, mode: 'plain' | 'b64' | 'too-long', why? }
 */
export function buildScene(ssid, password) {
  const plain = `${ssid}~${password}`;

  if (plain.length <= SCENE_MAX && SCENE_ALLOWED.test(plain)) {
    return { scene: plain, mode: 'plain' };
  }

  const encoded = b64url(plain);
  if (encoded.length <= SCENE_MAX) {
    return { scene: encoded, mode: 'b64' };
  }

  return {
    scene: encoded,
    mode: 'too-long',
    why: `${Buffer.byteLength(plain, 'utf8')} 字节原始数据，编码后 ${encoded.length} 字符（上限 ${SCENE_MAX}）`,
  };
}

/* ------------------------------------------------------ 凭证管理 */
const SECRETS_PATH = path.join(ROOT, '.secrets.json');

export function loadCredentials() {
  const fromEnv = { appid: process.env.WX_APPID, secret: process.env.WX_SECRET };
  if (fromEnv.appid && fromEnv.secret) return fromEnv;

  try {
    const saved = JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf8'));
    if (saved.appid && saved.secret) return saved;
  } catch { /* 没存过 */ }

  return { appid: fromEnv.appid || '', secret: fromEnv.secret || '' };
}

/** 存一次，以后不用再输。已加 .gitignore */
export function saveCredentials(appid, secret) {
  fs.writeFileSync(SECRETS_PATH, JSON.stringify({ appid, secret }, null, 2) + '\n', 'utf8');
  try { fs.chmodSync(SECRETS_PATH, 0o600); } catch { /* Windows 上可能不支持 */ }
}

export { SECRETS_PATH };

/* ------------------------------------------------------ 微信接口 */
export async function getAccessToken(appid, secret) {
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential`
            + `&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.access_token) throw new Error(explainTokenError(data));
  return data.access_token;
}

function explainTokenError(data) {
  const hints = {
    40001: 'AppSecret 不对（也可能 access_token 过期，重跑一次）',
    40125: 'AppSecret 不对 —— 公众平台 → 开发管理 → 开发设置，重新复制一次',
    40013: 'AppID 不对',
    40164: '本机公网 IP 不在白名单 —— 公众平台 → 开发设置 → IP 白名单，把本机公网 IP 加进去',
    45009: '接口调用超过上限',
  };
  const hint = hints[data.errcode];
  return `拿 access_token 失败：${data.errcode} ${data.errmsg}${hint ? '\n     提示：' + hint : ''}`;
}

/**
 * 生成小程序码。
 * envVersion：release（正式版）/ trial（体验版）/ develop（开发版）
 * 小程序还没发布时用 develop，
 */
export async function genMiniProgramCode(token, scene, {
  page = 'pages/ad/index',
  envVersion = 'release',
  width = 430,
} = {}) {
  const body = {
    scene,
    page,
    check_path: false,     // 允许页面尚未发布，否则开发阶段会报 41030
    env_version: envVersion,
    width,
  };

  const res = await fetch(`https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const buf = Buffer.from(await res.arrayBuffer());

  // 成功返回图片二进制，失败返回 JSON —— 靠内容判断，不能看状态码
  if (buf.slice(0, 20).toString('utf8').trimStart().startsWith('{')) {
    let err;
    try { err = JSON.parse(buf.toString('utf8')); }
    catch { err = { errcode: '?', errmsg: buf.toString('utf8').slice(0, 200) }; }
    throw new Error(explainCodeError(err));
  }

  return buf;
}

function explainCodeError(err) {
  const hints = {
    40001: 'access_token 无效，重跑一次',
    41030: 'page 不存在。开发阶段请用 --env develop；已发布的话检查页面路径',
    45009: '生成数量超限',
    47001: '参数格式错误（通常 scene 里有非法字符）',
  };
  const hint = hints[err.errcode];
  return `${err.errcode} ${err.errmsg}${hint ? '\n     提示：' + hint : ''}`;
}

/* ------------------------------------------------------ 小工具 */
export const pad = (t, n) => String(t).padEnd(n, ' ');

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 从门店数组生成可直接打印的 HTML */
export function posterHtml(cards, title = '门店 WiFi 二维码') {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title>
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
}
