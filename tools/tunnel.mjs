#!/usr/bin/env node
/* ==========================================================================
 * 把本地站点临时暴露到公网（给手机真机测试 / 发给别人看）
 * --------------------------------------------------------------------------
 *   node tools/tunnel.mjs              # 用 cloudflared（推荐，无拦截页）
 *   node tools/tunnel.mjs --lt         # 用 localtunnel（有拦截页，见下方说明）
 *   node tools/tunnel.mjs --stop       # 停掉所有隧道
 *
 * ⚠️ 这不是"部署" —— 它是把你本机的端口临时映射到公网。
 *    你的电脑一关机、进程一停，域名立刻失效。
 *    真正上线请用静态托管 + 备案域名，见 README。
 *
 * 两条隧道的区别（实测）：
 *
 *   cloudflared  ✅ 访问者直接看到你的页面，无任何中间页
 *                ❌ 每次重启换一个随机域名（xxx.trycloudflare.com）
 *
 *   localtunnel  ✅ 可以固定子域名（记得住）
 *                ❌ 免费版强制插一个「Tunnel website ahead!」页，
 *                   访问者必须输入你的公网 IP 当密码才能进 ——
 *                   对到店顾客完全不可用，只适合自己调试
 * ========================================================================== */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BIN_DIR = path.join(ROOT, '.bin');
const PORT = Number(process.env.PORT || 5173);

const argv = process.argv.slice(2);
const useLT = argv.includes('--lt');
const stopOnly = argv.includes('--stop');

/* --------------------------------------------------------------- 停止 */
function killAll() {
  for (const pat of ['cloudflared tunnel', 'localtunnel', 'tools/serve.mjs']) {
    try {
      execFileSync('pkill', ['-f', pat], { stdio: 'ignore' });
      console.log(`  已停止: ${pat}`);
    } catch { /* 没在跑就算了 */ }
  }
}

if (stopOnly) {
  console.log('\n停止隧道与本地服务...\n');
  killAll();
  console.log('\n完成。\n');
  process.exit(0);
}

/* --------------------------------------------------- 本地服务是否在跑 */
async function ensureServer() {
  try {
    const r = await fetch(`http://localhost:${PORT}/`, { signal: AbortSignal.timeout(2000) });
    if (r.ok) { console.log(`  ✓ 本地服务已在运行  http://localhost:${PORT}`); return; }
  } catch { /* 没跑，下面起一个 */ }

  console.log(`  · 启动本地服务 http://localhost:${PORT}`);
  const child = spawn(process.execPath, [path.join(__dirname, 'serve.mjs'), String(PORT)], {
    cwd: ROOT, detached: true, stdio: 'ignore',
  });
  child.unref();

  // 等它起来再继续
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try {
      const r = await fetch(`http://localhost:${PORT}/`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) { console.log(`  ✓ 本地服务已就绪`); return; }
    } catch { /* 继续等 */ }
  }
  throw new Error('本地服务启动失败，请手动运行：node tools/serve.mjs');
}

/* -------------------------------------------- cloudflared 二进制查找/下载 */

/**
 * 校验下下来的东西真的是可执行文件。
 * 必须做：下载地址写错时 GitHub 会返回一个 9 字节的 “Not Found” 文本，
 * 存下来看着像个二进制，spawn 时才报一个看不懂的 ENOEXEC。
 * 这里用文件头魔术字节判断，宁可失败得早、失败得清楚。
 */
function isRealBinary(p) {
  try {
    if (fs.statSync(p).size < 1_000_000) return false;   // 真实二进制约 40MB
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    const hex = buf.toString('hex');
    // Mach-O（macOS）: feedface / feedfacf / cffaedfe
    // ELF（Linux）   : 7f454c46
    return ['feedface', 'feedfacf', 'cffaedfe', 'cefaedfe', '7f454c46'].includes(hex);
  } catch { return false; }
}

function findCloudflared() {
  // 1. PATH 里有就直接用
  try {
    const p = execFileSync('which', ['cloudflared'], { encoding: 'utf8' }).trim();
    if (p) return p;
  } catch { /* PATH 里没有 */ }

  // 2. 项目内缓存过
  const cached = path.join(BIN_DIR, 'cloudflared');
  if (fs.existsSync(cached) && isRealBinary(cached)) return cached;

  // 3. 下载
  //    注意：macOS 只有 .tgz 包，Linux 才是裸二进制 ——
  //    写错一个后缀就会拿到 “Not Found” 文本。
  const arch = os.arch() === 'arm64' ? 'arm64' : 'amd64';
  const base = 'https://github.com/cloudflare/cloudflared/releases/latest/download';
  fs.mkdirSync(BIN_DIR, { recursive: true });

  console.log(`  · 首次使用，下载 cloudflared（约 20MB）...`);

  if (process.platform === 'darwin') {
    const tgz = path.join(BIN_DIR, 'cloudflared.tgz');
    execFileSync('curl', ['-fsSL', '--max-time', '240', '-o', tgz, `${base}/cloudflared-darwin-${arch}.tgz`], { stdio: 'inherit' });
    execFileSync('tar', ['xzf', tgz, '-C', BIN_DIR], { stdio: 'inherit' });
    fs.rmSync(tgz, { force: true });
  } else {
    execFileSync('curl', ['-fsSL', '--max-time', '240', '-o', cached, `${base}/cloudflared-linux-${arch}`], { stdio: 'inherit' });
  }

  if (!fs.existsSync(cached) || !isRealBinary(cached)) {
    throw new Error(
      `cloudflared 下载失败或文件不是可执行文件（${cached}）。\n` +
      `    手动安装：brew install cloudflared\n` +
      `    或从 ${base} 手动下载对应平台的包。`
    );
  }

  fs.chmodSync(cached, 0o755);
  console.log(`  ✓ 已保存到 ${path.relative(ROOT, cached)}（已加入 .gitignore）`);
  return cached;
}

/* ----------------------------------------------------------- 启动隧道 */
await ensureServer();

console.log('');

if (useLT) {
  /* ------------------------------------------------- localtunnel */
  console.log('  使用 localtunnel（免费版会有拦截页，仅适合自己调试）\n');
  const sub = process.env.LT_SUBDOMAIN || '';
  const args = ['--yes', 'localtunnel', '--port', String(PORT)];
  if (sub) args.push('--subdomain', sub);

  const child = spawn('npx', args, { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    const m = /https:\/\/[a-z0-9-]+\.loca\.lt/.exec(buf);
    if (m) {
      console.log(`  公网地址:  ${m[0]}`);
      printLTWarning(m[0]);
    }
  });
  child.stderr.on('data', (d) => process.stderr.write(d));
  child.unref();
} else {
  /* ---------------------------------------------- cloudflared */
  const bin = findCloudflared();
  console.log('  使用 cloudflared（访问者无中间页）\n');

  const child = spawn(bin, ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'], {
    cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });

  /*
   * 坑：cloudflared 把日志全部写到 stderr，stdout 是空的。
   * 只监听 stdout 的话永远等不到 URL，看起来像“启动成功但没输出地址”。
   * 所以两个流都要接。
   */
  let buf = '';
  let printed = false;
  const watch = (stream) => stream.on('data', (d) => {
    buf += d;
    if (printed) return;
    const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(buf);
    if (m) {
      printed = true;
      console.log(`  公网地址:  ${m[0]}`);
      console.log(`  WiFi 页:   ${m[0]}/scan/`);
      console.log('');
      console.log('  手机直接打开上面第一个地址即可（走流量就行，不用连同一个 WiFi）');
      console.log('');
      console.log('  \x1b[33m注意：这个域名每次重启都会换一个。\x1b[0m');
      console.log('        要固定下来需 Cloudflare 账号 + 自己的域名做 named tunnel。');
      console.log('');
      console.log('  停止：node tools/tunnel.mjs --stop');
      console.log('');
    }
  });
  watch(child.stdout);
  watch(child.stderr);
  child.unref();
}

function printLTWarning(url) {
  console.log('');
  console.log('  \x1b[33m⚠️  localtunnel 免费版会给访问者插一个拦截页，\x1b[0m');
  console.log('     必须输入你的公网 IP 才能进。到店顾客看到这个会直接走掉。');
  try {
    const ip = execFileSync('curl', ['-s', '--max-time', '10', 'https://ipv4.icanhazip.com'], { encoding: 'utf8' }).trim();
    if (ip) console.log(`     当前密码（你的公网 IP）: \x1b[1m${ip}\x1b[0m`);
  } catch { /* 拿不到就算了 */ }
  console.log('');
  console.log('     想要没有拦截页的地址，去掉 --lt 重新运行即可。');
  console.log('');
  console.log('  停止：node tools/tunnel.mjs --stop');
  console.log('');
}

// 保持进程存活，让子进程的 stdout 能持续输出
setTimeout(() => {}, 24 * 60 * 60 * 1000);
