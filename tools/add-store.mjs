#!/usr/bin/env node
/* ==========================================================================
 * 加一家门店 + 出码 —— 一条命令搞定，不用手改文件
 * --------------------------------------------------------------------------
 *   node tools/add-store.mjs
 *       全程问答：店名 → WiFi 名 → WiFi 密码，然后就出码了。
 *
 *   node tools/add-store.mjs --name "悦荟城店" --ssid "YH-5G" --password "yh123456"
 *       不想问答就带参数。
 *
 *   node tools/add-store.mjs --list
 *       看已经加了哪些店。
 *
 *   node tools/add-store.mjs --delete shop2
 *       删掉一家店。
 *
 * 它会做的事：
 *   1. 检查你的输入（WiFi 名/密码能不能放进小程序码的 scene）
 *   2. 把门店写进 miniprogram/config.js（自动定位，不会破坏文件）
 *   3. 调微信接口生成小程序码，输出 PNG + 可打印海报
 *
 * 第一次跑会问 AppID / AppSecret，之后存在 .secrets.json（已加 .gitignore）。
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {
  ROOT, CONFIG_PATH, INSERT_MARK, SCENE_MAX,
  readConfig, buildScene, loadCredentials, saveCredentials,
  getAccessToken, genMiniProgramCode, posterHtml, pad, esc,
} from './wx-api.mjs';

/* ------------------------------------------------------------ 命令行参数 */
const argv = process.argv.slice(2);
const opt = (n, d = '') => {
  const i = argv.indexOf('--' + n);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const has = (n) => argv.includes('--' + n);

const C = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  no: (s) => `\x1b[31m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
};

const outDir = path.resolve(ROOT, opt('out', 'dist/mpcode'));
const envVersion = opt('env', 'release');

/* ============================================================ 小工具 */
/**
 * 提问。
 *
 * 非交互环境（stdin 不是终端，比如被管道接了输入、或跑在 CI 里）
 * 必须直接返回默认值 —— 否则 readline 收不到输入，await 永远悬着，
 * Node 会抛 "unsettled top-level await" 然后报一堆看不懂的栈。
 */
function ask(question, { defaultValue = '' } = {}) {
  if (!process.stdin.isTTY) return Promise.resolve(defaultValue);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      // 非 TTY 时 stdout 可能被重定向，问题文本要自己补一次
      resolve(ans.trim() || defaultValue);
    });
  });
}

function confirm(question) {
  return ask(`${question} ${C.dim('(y/N)')} `).then((a) => /^y(es)?$/i.test(a));
}

/* ============================================================ 读取现状 */
const cfg = readConfig();
const stores = (cfg.stores || []).slice();
const nextStoreNum = () => {
  let n = 2;
  const ids = new Set(stores.map((s) => s.id));
  while (ids.has('shop' + n)) n++;
  return 'shop' + n;
};

/* ============================================================ --list */
if (has('list')) {
  console.log(`\n  ${C.b('已配置的门店')}\n`);
  if (!stores.length) {
    console.log('  （一家都没有）\n');
  } else {
    console.log(`  ${pad('id', 12)}${pad('店名', 14)}${pad('WiFi 名', 22)}${pad('scene', 20)}长度`);
    console.log('  ' + '-'.repeat(76));
    for (const s of stores) {
      const r = buildScene(s.ssid || '', s.password || '');
      const mark = r.mode === 'too-long' ? C.no('✗') : (r.mode === 'b64' ? C.dim('编码') : '明文');
      console.log(`  ${pad(s.id, 12)}${pad(s.name || '', 14)}${pad(s.ssid || '', 22)}${pad(r.scene.slice(0, 18), 20)}${r.scene.length} ${mark}`);
    }
  }
  console.log(`\n  配置文件  ${path.relative(ROOT, CONFIG_PATH)}\n`);
  process.exit(0);
}

/* ============================================================ --delete */
if (has('delete')) {
  const id = opt('delete');
  const idx = stores.findIndex((s) => s.id === id);
  if (idx < 0) {
    console.error(`\n  ${C.no('✗')} 找不到 id 为「${id}」的门店\n`);
    process.exit(1);
  }
  const s = stores[idx];
  console.log(`\n  要删除：${C.b(s.name || s.id)}  (WiFi: ${s.ssid})`);
  // 非交互环境下 confirm() 一律返回 false（避免误删），
  // 所以脚本化删除要显式加 --yes
  const yes = has('yes') || await confirm('  确认删除？');
  if (!yes) { console.log('\n  已取消\n'); process.exit(0); }

  const src = fs.readFileSync(CONFIG_PATH, 'utf8');
  const block = new RegExp(
    `\\n\\s*\\{[^}]*?id:\\s*['"]${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"][\\s\\S]*?\\},`,
    'm'
  );
  if (!block.test(src)) {
    console.error(`\n  ${C.no('✗')} 定位不到这条配置，请手动删\n`);
    process.exit(1);
  }
  fs.writeFileSync(CONFIG_PATH, src.replace(block, ''), 'utf8');
  console.log(`\n  ${C.ok('✓')} 已从 config.js 删除`);
  console.log(`    二维码图片如果不需要了，自己删 ${path.relative(ROOT, outDir)} 里对应的文件\n`);
  process.exit(0);
}

/* ============================================================ 收集输入 */
console.log(`\n  ${C.b('加一家门店')}`);
console.log(C.dim('  回车用括号里的默认值；Ctrl+C 退出\n'));

const name = opt('name') || await ask(`  店名（会印在二维码海报上）: `);
if (!name) { console.error(`\n  ${C.no('✗')} 店名不能为空\n`); process.exit(1); }

const ssid = opt('ssid') || await ask(`  WiFi 名称（手机设置里看到的那个，区分大小写）: `);
if (!ssid) { console.error(`\n  ${C.no('✗')} WiFi 名称不能为空\n`); process.exit(1); }

const password = opt('password') || await ask(`  WiFi 密码: `);

/* ---------------------------------------------------- 校验能不能放得下 */
console.log('');
const r = buildScene(ssid, password);

if (r.mode === 'too-long') {
  console.log(`  ${C.no('✗')} WiFi 信息太长，小程序码装不下`);
  console.log(`    ${r.why}`);
  console.log('');
  console.log(`  ${C.warn('两个选择：')}`);
  console.log(`    1. 用「门店 id 模式」：小程序码里只放一个短 id，`);
  console.log(`       WiFi 信息写进 config.js。代价是以后改密码要重新发版。`);
  console.log(`    2. 缩短 WiFi 名或密码重试。`);
  console.log('');
  console.log(`  ${C.dim('当前内容：')} ${ssid}~${password}`);
  console.log(`  ${C.dim('建议：把 WiFi 名改短一点，或密码用纯数字/字母。')}\n`);
  process.exit(1);
}

const modeTag = r.mode === 'b64' ? `${C.dim('base64url 编码')}` : '明文';
console.log(`  ${C.ok('✓')} WiFi 信息能放进小程序码  ${C.dim(`(${modeTag}，${r.scene.length}/${SCENE_MAX} 字符)`)}`);
console.log(`    ${C.dim('scene = ' + r.scene)}`);
console.log('');

/* ---------------------------------------------------- 门店 id（可选） */
const autoId = nextStoreNum();
const id = opt('id') || await ask(`  门店 id（英文，内网用，随便起）: `, { defaultValue: autoId });

if (!/^[A-Za-z0-9_-]+$/.test(id)) {
  console.error(`  ${C.no('✗')} id 只能用字母、数字、下划线、中划线\n`);
  process.exit(1);
}
if (stores.some((s) => s.id === id)) {
  console.error(`  ${C.no('✗')} id「${id}」已存在，换一个\n`);
  process.exit(1);
}

/* ============================================================ 写入配置 */
{
  const src = fs.readFileSync(CONFIG_PATH, 'utf8');
  if (!src.includes(INSERT_MARK)) {
    console.error(`\n  ${C.no('✗')} config.js 里找不到插入标记：`);
    console.error(`    ${INSERT_MARK}`);
    console.error(`    这行是不是被误删了？加回去再跑。\n`);
    process.exit(1);
  }

  // 标记行本身前面已经有 4 个空格，所以插入的内容不能再自带缩进，
  // 否则会变成 8 空格（第一版就是这么错的）
  const line = `{ id: '${id}', name: '${name}', ssid: '${ssid}', password: '${password}' },\n    `;
  fs.writeFileSync(CONFIG_PATH, src.replace(INSERT_MARK, line + INSERT_MARK), 'utf8');
  console.log(`  ${C.ok('✓')} 已写入 config.js`);
}

/* ============================================================ 生成小程序码 */
let cred = loadCredentials();

if (!cred.appid || !cred.secret) {
  console.log('');
  console.log(`  ${C.warn('要生成小程序码，需要 AppID 和 AppSecret')}`);
  console.log(C.dim('  AppSecret 在：公众平台 → 开发管理 → 开发设置'));
  console.log(C.dim('  只会存在本机 .secrets.json（已加 .gitignore），不会提交到仓库\n'));

  if (!cred.appid) {
    cred.appid = opt('appid') || await ask('  AppID: ');
  }
  if (!cred.secret) {
    cred.secret = opt('secret') || await ask('  AppSecret: ');
  }
  if (!cred.appid || !cred.secret) {
    console.log(`\n  ${C.warn('跳过出码（没拿到 AppID / AppSecret）。')}`);
    console.log(`    门店配置已经写入 config.js，二维码还没生成。\n`);
    console.log(`  ${C.b('补上凭证后重新出码：')}`);
    console.log(`    node tools/add-store.mjs --list        ${C.dim('# 先看有哪些店')}`);
    console.log(`    node tools/gen-mpcode.mjs             ${C.dim('# 一次出全部')}\n`);
    console.log(`  或者设成环境变量再跑：`);
    console.log(`    WX_APPID=wx... WX_SECRET=... node tools/add-store.mjs\n`);
    process.exit(0);
  }
  saveCredentials(cred.appid, cred.secret);
  console.log(`  ${C.ok('✓')} 凭证已保存到 .secrets.json（下次不用再输）\n`);
}

console.log(`  ${C.dim('正在生成小程序码...')}`);

let png;
try {
  const token = await getAccessToken(cred.appid, cred.secret);
  png = await genMiniProgramCode(token, r.scene, { envVersion });
} catch (e) {
  console.log(`\n  ${C.no('✗')} 生成失败`);
  console.log(`    ${e.message}\n`);
  console.log(`  ${C.warn('门店配置已经写好了，')}凭证/网络没问题后重跑：`);
  console.log(`    node tools/gen-mpcode.mjs\n`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const safe = name.replace(/[^\w\u4e00-\u9fa5.-]+/g, '_');
const file = path.join(outDir, `${safe}.png`);
fs.writeFileSync(file, png);

// 顺手更新全量海报（把所有门店放一起，方便一次打印）
const allCards = [];
for (const s of stores.concat([{ id, name, ssid, password }])) {
  const f = path.join(outDir, `${(s.name || s.id).replace(/[^\w\u4e00-\u9fa5.-]+/g, '_')}.png`);
  if (fs.existsSync(f)) {
    allCards.push({ name: s.name || s.id, ssid: s.ssid, b64: fs.readFileSync(f).toString('base64') });
  }
}
if (allCards.length) {
  fs.writeFileSync(path.join(outDir, 'print.html'), posterHtml(allCards), 'utf8');
}

/* ============================================================ 完成 */
console.log(`\n  ${C.ok('✓ 这家店搞定了')}\n`);
console.log(`  ${pad('店名', 10)}${name}`);
console.log(`  ${pad('WiFi', 10)}${ssid}`);
console.log(`  ${pad('密码', 10)}${password}`);
console.log(`  ${pad('二维码', 10)}${path.relative(ROOT, file)}`);
if (allCards.length > 1) {
  console.log(`  ${pad('全部海报', 10)}${path.relative(ROOT, path.join(outDir, 'print.html'))}`);
}
console.log('');
console.log(`  ${C.b('接下来：')}`);
console.log(`    1. 把 PNG 发给门店，或打印海报贴在收银台`);
console.log(`    2. 顾客用微信「扫一扫」→ 直接打开小程序 → 点连接`);
console.log('');
console.log(C.dim(`  提示：${envVersion === 'release' ? '当前指向正式版' : `当前指向 ${envVersion} 版`}。`));
if (envVersion !== 'release') {
  console.log(C.dim(`        小程序发布后重新生成一次，把 --env 换成 release。`));
}
console.log('');
