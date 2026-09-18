#!/usr/bin/env node
/* ==========================================================================
 * 零依赖本地预览服务器
 * 用法: node tools/serve.mjs [端口]   默认 5173
 * 手机可与电脑同 WiFi 下访问 http://<电脑局域网IP>:5173 实机测试
 * ========================================================================== */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', 'public');
const PORT = Number(process.argv[2]) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }

  if (urlPath === '/') urlPath = '/index.html';

  // 防目录穿越
  const filePath = path.join(ROOT, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  // 目录索引：/scan/ 要映射到 /scan/index.html。
  // 必须做，否则本地访问 /scan/ 是 404，而线上静态托管（Vercel / Nginx / OSS）
  // 会自动补 index.html —— 本地与线上行为不一致，测了等于没测。
  let target = filePath;
  try {
    if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
  } catch { /* 不存在就走下面的 404 */ }

  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + urlPath);
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  const nets = os.networkInterfaces();
  const lan = Object.values(nets).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);

  console.log('\n  扫码连 WiFi · 本地预览已启动\n');
  console.log('  本机     http://localhost:' + PORT);
  for (const ip of lan) console.log('  手机访问 http://' + ip + ':' + PORT + '   ← 用手机连同一个 WiFi 打开');
  console.log('\n  提示：加 ?debug=1 可跳过广告直接看 WiFi 页（方便调试）');
  console.log('  按 Ctrl+C 停止\n');
});
