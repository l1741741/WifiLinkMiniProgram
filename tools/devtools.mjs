#!/usr/bin/env node
/* ==========================================================================
 * 微信开发者工具 CLI 封装
 * --------------------------------------------------------------------------
 *   node tools/devtools.mjs check     检查环境（工具、登录、服务端口）
 *   node tools/devtools.mjs open      在 IDE 里打开小程序项目
 *   node tools/devtools.mjs preview   生成真机预览二维码
 *   node tools/devtools.mjs upload    上传体验版
 *
 * 前置条件（只有第一次要）：
 *   1. 用微信扫码登录开发者工具
 *   2. 工具 → 设置 → 安全设置 → 服务端口 → 开启
 *         ↑ 必须手工做。命令行喂 y 不管用，它要的是 IDE 里的交互式确认。
 * ========================================================================== */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PROJECT = path.join(ROOT, 'miniprogram');

const CLI_PATHS = [
  '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
  '/Applications/微信开发者工具.app/Contents/MacOS/cli',
];

const CLI = CLI_PATHS.find((p) => fs.existsSync(p));
if (!CLI) {
  console.error('\n  ✗ 没找到微信开发者工具。');
  console.error('    下载：https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html\n');
  process.exit(2);
}

/**
 * 调 CLI，统一返回 { ok, text }。
 *
 * 之前这里踩过一个坑：allowFail 时返回字符串、否则返回对象，
 * 调用方按对象判断就永远走不到错误分支，把「端口没开」误报成「未登录」。
 * 统一形状之后这类错误不可能再发生。
 */
function run(args, { timeout = 120_000 } = {}) {
  try {
    const out = execFileSync(CLI, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      cwd: PROJECT,
    });
    return { ok: true, text: clean(out) };
  } catch (e) {
    return { ok: false, text: clean((e.stdout || '') + (e.stderr || '') + (e.message || '')) };
  }
}

function clean(s) {
  return String(s || '')
    .split('\n')
    .filter((l) => !/deprecat|trace-deprecation|SecCodeCheckValidity|^- initialize$|^✖ initialize$|^\(node:/i.test(l))
    .join('\n')
    .trim();
}

const isPortError = (r) => !r.ok && /service port disabled|服务端口已关闭/i.test(r.text);
const isNotLogin = (r) => !r.ok && /not logged in|未登录|请先登录/i.test(r.text);

const HELP_PORT = [
  '',
  '  \x1b[33m✗ 服务端口没开，命令行用不了。\x1b[0m',
  '',
  '  在开发者工具里点：',
  '    \x1b[1m设置 → 安全设置 → 服务端口 → 开启\x1b[0m',
  '',
  '  （这一项必须手工开。命令行喂 y 没用 —— 它要的是 IDE 里的交互式确认。）',
  '',
  '  开完再跑一次本命令。',
  '',
].join('\n');

const HELP_LOGIN = [
  '',
  '  \x1b[33m✗ 还没登录开发者工具。\x1b[0m',
  '',
  '  在开发者工具窗口里用\x1b[1m微信扫码登录\x1b[0m，然后重跑本命令。',
  '',
].join('\n');

/* --------------------------------------------------------------------- 项目信息 */
function projectInfo() {
  try {
    const pc = JSON.parse(fs.readFileSync(path.join(PROJECT, 'project.config.json'), 'utf8'));
    return { appid: pc.appid || '', hasRealAppId: !!pc.appid && pc.appid !== 'touristappid' };
  } catch {
    return { appid: '', hasRealAppId: false };
  }
}

/* ------------------------------------------------------------------ check */
if (!process.argv[2] || process.argv[2] === 'check') {
  const { appid, hasRealAppId } = projectInfo();

  console.log('\n  微信开发者工具环境检查\n');
  console.log(`  CLI   ${CLI}`);
  console.log(`  项目  ${path.relative(ROOT, PROJECT)}`);
  console.log(`  入口  pages/ad/index → pages/wifi/index`);

  if (hasRealAppId) {
    console.log(`  AppID ${appid}`);
  } else {
    console.log('\n  \x1b[33m! AppID 还是占位值（touristappid）\x1b[0m');
    console.log('    工具能以测试号模式打开界面，但真机预览和上传都要真实 AppID。');
    console.log('    换法：微信公众平台 → 开发管理 → 开发设置 → AppID');
  }

  const st = run(['islogin']);
  console.log('');
  if (isPortError(st)) { console.log(HELP_PORT); process.exit(1); }
  if (isNotLogin(st) || !st.ok) { console.log(HELP_LOGIN); process.exit(1); }

  console.log('  \x1b[32m✓ 已登录，服务端口已开启\x1b[0m');
  console.log('    可以跑：node tools/devtools.mjs open\n');
  process.exit(0);
}

/* ------------------------------------------------------- open / preview / upload */
const cmd = process.argv[2];

function gate(fn) {
  const r = fn();
  if (isPortError(r)) { console.log(HELP_PORT); process.exit(1); }
  if (isNotLogin(r)) { console.log(HELP_LOGIN); process.exit(1); }
  return r;
}

function show(r) {
  if (r.ok) {
    if (r.text) console.log(r.text);
    return true;
  }
  console.log(`\n  \x1b[31m✗ 执行失败\x1b[0m\n  ${r.text.replace(/\n/g, '\n  ')}\n`);
  return false;
}

if (cmd === 'open') {
  console.log('\n  在 IDE 里打开项目...\n');
  const r = gate(() => run(['-o', PROJECT]));
  if (show(r)) console.log('  \x1b[32m✓ 已发送打开指令，去看开发者工具窗口\x1b[0m\n');
  process.exit(r.ok ? 0 : 1);
}

if (cmd === 'preview') {
  const { hasRealAppId } = projectInfo();
  if (!hasRealAppId) {
    console.error('\n  ✗ 真机预览需要真实 AppID，当前还是 touristappid。');
    console.error('    改 project.config.json 的 appid 后重试。\n');
    process.exit(2);
  }
  console.log('\n  生成真机预览二维码（手机微信扫码即在真机上运行）...\n');
  const r = gate(() => run(['preview', '--project', PROJECT, '--qr-format', 'terminal']));
  show(r);
  process.exit(r.ok ? 0 : 1);
}

if (cmd === 'upload') {
  const { hasRealAppId } = projectInfo();
  if (!hasRealAppId) {
    console.error('\n  ✗ 上传需要真实 AppID。\n');
    process.exit(2);
  }
  console.log('\n  上传体验版...\n');
  const r = gate(() => run(['upload', '--project', PROJECT, '-v', '1.0.0', '-d', '首个版本']));
  show(r);
  process.exit(r.ok ? 0 : 1);
}

console.log(`
  用法：
    node tools/devtools.mjs check     检查环境
    node tools/devtools.mjs open      打开项目
    node tools/devtools.mjs preview   真机预览二维码
    node tools/devtools.mjs upload    上传体验版
`);
