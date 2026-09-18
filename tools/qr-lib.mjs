/* ==========================================================================
 * 二维码渲染库（Node 端）
 * --------------------------------------------------------------------------
 * 复用 public/assets/vendor/qrcode.js，保证「海报上的码」和「页面里的码」
 * 用的是同一个编码器，不会出现一个能扫一个不能扫的情况。
 * ========================================================================== */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = path.join(__dirname, '..', 'public', 'assets', 'vendor', 'qrcode.js');

/*
 * 这个文件是 UMD 格式，但本项目 package.json 声明了 "type": "module"，
 * 直接 require() 会被 Node 当成 ES 模块加载、拿不到导出。
 * 所以用 new Function 在沙箱里求值，把自己伪造成 CommonJS 环境。
 * 好处：Node 端和浏览器端共用同一份编码器文件，只此一份，不会走样。
 */
const qrcode = (() => {
  const src = fs.readFileSync(VENDOR, 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', 'define', src)(mod, mod.exports, undefined);
  if (typeof mod.exports !== 'function') {
    throw new Error('加载二维码库失败：' + VENDOR);
  }
  return mod.exports;
})();

// 开启 UTF-8 支持（中文 SSID 必需）
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

/** 生成模块矩阵：{ n, dark(r,c) } */
export function makeMatrix(text, ec = 'M') {
  const qr = qrcode(0, ec); // 0 = 自动选最小版本
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return {
    n,
    ec,
    isDark: (r, c) => qr.isDark(r, c),
  };
}

/** 把矩阵转成简单的 0/1 二维数组（方便测试与 PNG 渲染） */
export function toGrid(matrix) {
  const { n } = matrix;
  const g = [];
  for (let r = 0; r < n; r++) {
    const row = [];
    for (let c = 0; c < n; c++) row.push(matrix.isDark(r, c) ? 1 : 0);
    g.push(row);
  }
  return g;
}

/* ------------------------------------------------------------------ SVG */
export function toSVG(matrix, { margin = 4, dark = '#000', light = '#fff' } = {}) {
  const { n } = matrix;
  const size = n + margin * 2;

  // 同一行相邻黑块合并成一条横线，能显著减小文件体积
  const cmds = [];
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!matrix.isDark(r, c)) { c++; continue; }
      let run = 1;
      while (c + run < n && matrix.isDark(r, c + run)) run++;
      cmds.push(`M${c + margin} ${r + margin}h${run}v1h-${run}z`);
      c += run;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR Code">
<rect width="${size}" height="${size}" fill="${light}"/>
<path fill="${dark}" d="${cmds.join('')}"/>
</svg>
`;
}

/* ------------------------------------------------------------------ PNG */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * 纯 JS PNG 编码器（灰度 8bit），不引入任何原生依赖。
 * cellSize 用整数，保证每个模块边界锐利——二维码糊了扫码率会掉。
 */
export function toPNG(matrix, { margin = 4, cellSize = 16 } = {}) {
  const { n } = matrix;
  const size = (n + margin * 2) * cellSize;

  // 每行 1 字节 filter + width 字节灰度值
  const stride = size + 1;
  const raw = Buffer.alloc(stride * size, 0xff);

  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: None
    const r = Math.floor(y / cellSize) - margin;
    if (r < 0 || r >= n) continue;
    for (let x = 0; x < size; x++) {
      const c = Math.floor(x / cellSize) - margin;
      if (c < 0 || c >= n) continue;
      if (matrix.isDark(r, c)) raw[y * stride + 1 + x] = 0x00;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 0;  // color type: grayscale
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** WIFI: 协议转义 */
export function escField(v) {
  return String(v == null ? '' : v).replace(/([\\;,:"])/g, '\\$1');
}

/** 生成 iOS 11+ / Android 10+ 相机可直接识别的 WiFi 配置串 */
export function buildWifiString({ ssid, password, security = 'WPA', hidden = false }) {
  let type = String(security).toUpperCase();
  if (type === 'NONE' || type === 'NOPASS' || type === 'OPEN') type = 'nopass';
  let out = `WIFI:T:${type};S:${escField(ssid)};`;
  if (type !== 'nopass') out += `P:${escField(password)};`;
  if (hidden) out += 'H:true;';
  return out + ';';
}
