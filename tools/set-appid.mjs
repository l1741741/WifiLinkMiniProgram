#!/usr/bin/env node
/* ==========================================================================
 * 把 AppID 写进项目配置
 * --------------------------------------------------------------------------
 *   node tools/set-appid.mjs wx1234567890abcdef
 *   node tools/set-appid.mjs --show        只看当前填的是什么
 *   node tools/set-appid.mjs --reset       退回测试号（touristappid）
 *
 * 为什么单独做个脚本：手改 project.config.json 时很容易把 JSON 改坏
 * （多个逗号、中文引号），一坏开发者工具就打不开项目，而且报错很难懂。
 * 这里做格式校验 + 原子写入。
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CFG = path.join(ROOT, 'miniprogram', 'project.config.json');

/** AppID 格式：wx + 16 位十六进制，共 18 位 */
const APPID_RE = /^wx[0-9a-f]{16}$/i;

function read() {
  try {
    return JSON.parse(fs.readFileSync(CFG, 'utf8'));
  } catch (e) {
    console.error(`\n  ✗ 读不了 ${path.relative(ROOT, CFG)}：${e.message}\n`);
    process.exit(2);
  }
}

function write(cfg) {
  // 先写临时文件再改名：中途出错不会留下半个坏文件
  const tmp = CFG + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, CFG);
}

const arg = process.argv[2];

/* ------------------------------------------------------------------- show */
if (!arg || arg === '--show') {
  const cfg = read();
  const id = cfg.appid || '';
  console.log('\n  当前 AppID：' + (id || '(空)'));
  if (id === 'touristappid') {
    console.log('  状态：\x1b[33m测试号占位值\x1b[0m');
    console.log('        能开界面，但真机预览、上传、以及多数需要账号权限的接口都用不了。');
  } else if (APPID_RE.test(id)) {
    console.log('  状态：\x1b[32m真实 AppID\x1b[0m');
  } else {
    console.log('  状态：\x1b[33m格式可疑（不是 wx + 16 位十六进制）\x1b[0m');
  }
  console.log('\n  有 AppID 后跑：node tools/set-appid.mjs wxXXXXXXXXXXXXXXXX\n');
  process.exit(0);
}

/* ------------------------------------------------------------------ reset */
if (arg === '--reset') {
  const cfg = read();
  cfg.appid = 'touristappid';
  write(cfg);
  console.log('\n  \x1b[32m✓ 已退回测试号（touristappid）\x1b[0m\n');
  process.exit(0);
}

/* -------------------------------------------------------------------- set */
const appid = arg.trim();

// 常见误操作：复制的时候带上了前后缀或空格
if (/^wx/i.test(appid) === false) {
  console.error(`\n  ✗ AppID 应该以 wx 开头，你给的是「${appid}」`);
  console.error('    正确形式：wx1234567890abcdef（wx + 16 位十六进制）\n');
  process.exit(1);
}

if (!APPID_RE.test(appid)) {
  console.error(`\n  ✗ AppID 格式不对：「${appid}」`);
  console.error(`    长度 ${appid.length}，正确应为 18 位（wx + 16 位十六进制）`);
  console.error('    去微信公众平台 → 开发管理 → 开发设置 → AppID 复制一次\n');
  process.exit(1);
}

const cfg = read();
const old = cfg.appid || '';
cfg.appid = appid;
write(cfg);

console.log('');
console.log(`  \x1b[32m✓ 已写入 AppID\x1b[0m`);
console.log(`    旧：${old}`);
console.log(`    新：${appid}`);
console.log('');
console.log('  接下来在开发者工具里：');
console.log('    项目 → 重新打开项目（或关掉重开），工具会读取新的 AppID');
console.log('');
console.log('  然后跑：node tools/devtools.mjs check');
console.log('');
