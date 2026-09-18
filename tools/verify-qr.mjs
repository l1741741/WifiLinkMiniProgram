#!/usr/bin/env node
/* ==========================================================================
 * 二维码自检
 * --------------------------------------------------------------------------
 * 三层验证，任何一层挂了都会非零退出：
 *   1. SVG 回环   —— 把我生成的 SVG 路径反解回矩阵，跟原矩阵逐格比对
 *   2. 独立解码   —— 把 PNG 交给 OpenCV（完全不同的实现）看能不能扫出来
 *   3. 协议转义   —— 校验 WIFI: 串对特殊字符的转义符合规范
 *
 * 用法: node tools/verify-qr.mjs
 * ========================================================================== */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeMatrix, toSVG, toPNG, buildWifiString } from './qr-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

let failures = 0;
const ok = (msg) => console.log('  \x1b[32m✓\x1b[0m ' + msg);
const bad = (msg) => { failures++; console.log('  \x1b[31m✗\x1b[0m ' + msg); };

/* =============================================== 1. SVG → 矩阵 回环比对 */
function svgToGrid(svg) {
  const m = /<path[^>]*d="([^"]*)"/.exec(svg);
  if (!m) throw new Error('SVG 里找不到 path');
  const sizeM = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  const size = Number(sizeM[1]);

  const grid = Array.from({ length: size }, () => new Array(size).fill(0));
  const re = /M(\d+) (\d+)h(\d+)v1h-(\d+)z/g;
  let hit, count = 0;
  while ((hit = re.exec(m[1]))) {
    const x = +hit[1], y = +hit[2], w = +hit[3];
    for (let i = 0; i < w; i++) grid[y][x + i] = 1;
    count++;
  }
  if (!count) throw new Error('SVG path 解析出 0 条绘制指令');
  return { grid, size, count };
}

function roundTripTest(label, text, ec) {
  const matrix = makeMatrix(text, ec);
  const svg = toSVG(matrix, { margin: 4 });
  const { grid, size } = svgToGrid(svg);

  const expectedSize = matrix.n + 8;
  if (size !== expectedSize) {
    bad(`${label}: SVG 尺寸应为 ${expectedSize}，实际 ${size}`);
    return;
  }

  let diff = 0;
  for (let r = 0; r < matrix.n; r++) {
    for (let c = 0; c < matrix.n; c++) {
      const want = matrix.isDark(r, c) ? 1 : 0;
      if (grid[r + 4][c + 4] !== want) diff++;
    }
  }

  // 静区必须是纯白
  let quietDirty = 0;
  for (let i = 0; i < size; i++) {
    for (const [r, c] of [[0, i], [1, i], [size - 2, i], [size - 1, i], [i, 0], [i, 1], [i, size - 2], [i, size - 1]]) {
      if (grid[r][c] !== 0) quietDirty++;
    }
  }

  if (diff === 0 && quietDirty === 0) {
    ok(`${label}: SVG 回环一致（${matrix.n}×${matrix.n} 矩阵，静区干净）`);
  } else {
    bad(`${label}: SVG 不一致，${diff} 格错位 / 静区 ${quietDirty} 格被污染`);
  }
  return matrix;
}

/* ==================================================== 2. OpenCV 独立解码 */
function decodeWithOpenCV(pngPath, expected, label) {
  let raw;
  try {
    raw = execFileSync('python3', [path.join(__dirname, 'decode-qr.py'), pngPath, expected], {
      encoding: 'utf8',
    });
  } catch (e) {
    // 解码失败时脚本返回码 1，但 stdout 里仍有 JSON 诊断信息
    raw = e.stdout || '';
    if (!raw) {
      bad(`${label}: 调不动解码器（OpenCV 没装？）`);
      return;
    }
  }
  let res;
  try { res = JSON.parse(raw.trim().split('\n').pop()); }
  catch { bad(`${label}: 解码器输出无法解析: ${raw.slice(0, 200)}`); return; }

  if (res.ok && res.match) {
    ok(`${label}: OpenCV 解码成功且内容一致 → "${res.data}"`);
  } else if (res.ok) {
    bad(`${label}: 能扫出来但内容不符 → 得到 "${res.data}"，期望 "${res.expected}"`);
  } else {
    bad(`${label}: OpenCV 扫不出来（${res.size ? res.size.join('×') : '?'}）`);
  }
}

/* ======================================================== 3. WIFI 协议转义 */
function wifiTests() {
  const cases = [
    {
      in: { ssid: 'ChinaNet-3v9I-5G', password: '88888888', security: 'WPA' },
      want: 'WIFI:T:WPA;S:ChinaNet-3v9I-5G;P:88888888;;',
      label: '基础 WPA',
    },
    {
      in: { ssid: 'My;Wifi,X', password: 'a:b"c\\d', security: 'WPA' },
      want: 'WIFI:T:WPA;S:My\\;Wifi\\,X;P:a\\:b\\"c\\\\d;;',
      label: '特殊字符转义',
    },
    {
      in: { ssid: 'OpenNet', password: '', security: 'nopass' },
      want: 'WIFI:T:nopass;S:OpenNet;;',
      label: '开放网络不带密码字段',
    },
    {
      in: { ssid: 'Hidden', password: '1234', security: 'WEP', hidden: true },
      want: 'WIFI:T:WEP;S:Hidden;P:1234;H:true;;',
      label: '隐藏 SSID',
    },
  ];
  for (const c of cases) {
    const got = buildWifiString(c.in);
    if (got === c.want) ok(`WIFI 协议 · ${c.label}`);
    else bad(`WIFI 协议 · ${c.label}\n      得到: ${got}\n      期望: ${c.want}`);
  }
}

/* ================================================================= 主流程 */
console.log('\n\x1b[1m① SVG 回环比对\x1b[0m');
const WIFI_STR = 'WIFI:T:WPA;S:ChinaNet-3v9I-5G;P:88888888;;';
roundTripTest('系统 WiFi 码', WIFI_STR, 'M');
roundTripTest('入口 URL 码', 'https://wifi.example.com/?c=shop1', 'M');
roundTripTest('中文 SSID', buildWifiString({ ssid: '咖啡厅-免费WiFi', password: '密码1234' }), 'M');
roundTripTest('长 URL 高版本', 'https://wifi.example.com/connect?a=1&c=some-long-channel-name&id=branch-003&v=2', 'Q');

console.log('\n\x1b[1m② OpenCV 独立解码\x1b[0m');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qrverify-'));
const cases = [
  ['系统 WiFi 码', WIFI_STR],
  ['入口 URL 码', 'https://wifi.example.com/?c=shop1'],
  ['中文 SSID', buildWifiString({ ssid: '咖啡厅-免费WiFi', password: '密码1234' })],
];
for (const [label, text] of cases) {
  const matrix = makeMatrix(text, 'M');
  const file = path.join(tmp, label.replace(/[^\w]/g, '_') + '.png');
  fs.writeFileSync(file, toPNG(matrix, { margin: 4, cellSize: 16 }));
  decodeWithOpenCV(file, text, label);
}

console.log('\n\x1b[1m③ WIFI 协议转义\x1b[0m');
wifiTests();

fs.rmSync(tmp, { recursive: true, force: true });

console.log('\n\x1b[1m④ dist/ 交付物解码\x1b[0m');
{
  const distDir = path.join(ROOT, 'dist');
  const pngs = fs.existsSync(distDir)
    ? fs.readdirSync(distDir).filter((f) => f.endsWith('.png'))
    : [];

  if (!pngs.length) {
    console.log('  \x1b[33m·\x1b[0m dist/ 里还没有二维码，跳过（先跑 npm run gen）');
  }
  for (const f of pngs) {
    const file = path.join(distDir, f);
    let raw;
    try {
      raw = execFileSync('python3', [path.join(__dirname, 'decode-qr.py'), file], { encoding: 'utf8' });
    } catch (e) { raw = e.stdout || ''; }
    try {
      const res = JSON.parse(raw.trim().split('\n').pop());
      if (res.ok) ok(`dist/${f} → "${res.data}"`);
      else bad(`dist/${f}: 扫不出来`);
    } catch {
      bad(`dist/${f}: 解码器输出无法解析`);
    }
  }
}

console.log('');
if (failures) {
  console.log(`\x1b[31m✗ 自检未通过：${failures} 项失败\x1b[0m\n`);
  process.exit(1);
}
console.log('\x1b[32m✓ 全部自检通过\x1b[0m\n');
