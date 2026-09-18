#!/usr/bin/env node
/* ==========================================================================
 * 百度搜索资源平台 · 普通收录主动推送
 * --------------------------------------------------------------------------
 *   BAIDU_TOKEN=你的token node tools/baidu-push.mjs
 *   BAIDU_TOKEN=xxx node tools/baidu-push.mjs --host https://你的域名
 *
 * 作用：把 sitemap 里的 URL 主动推给百度，比等它自然抓取快很多。
 * 新站尤其需要——不推送的话可能几周都不被收录，而联盟审核会看收录情况。
 *
 * token 从哪来：
 *   百度搜索资源平台 (ziyuan.baidu.com) → 用户中心 → 站点管理 → 添加站点
 *   → 普通收录 → API 提交 → 复制准入密钥
 *
 * 注意：推送前 site.config.mjs 里的 url 必须已经改成真实域名，
 * 且域名已通过百度站长平台的验证。
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import site from '../site.config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');

const argv = process.argv.slice(2);
const opt = (name, def = '') => {
  const i = argv.indexOf('--' + name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : def;
};

const token = process.env.BAIDU_TOKEN || opt('token');
const host = (opt('host') || site.url).replace(/\/$/, '');

if (!token) {
  console.error('\n  缺少 token。用法：\n');
  console.error('    BAIDU_TOKEN=你的准入密钥 node tools/baidu-push.mjs\n');
  console.error('  token 获取：百度搜索资源平台 → 站点管理 → 普通收录 → API 提交\n');
  process.exit(2);
}

if (host.includes('example.com')) {
  console.error('\n  ✗ site.config.mjs 里的 url 还是示例域名。');
  console.error('    推送前必须改成已备案并通过百度验证的真实域名。\n');
  process.exit(2);
}

/* 从 sitemap 取 URL 作为推送列表 —— 单一数据源，避免两处列表对不上 */
const smPath = path.join(PUBLIC, 'sitemap.xml');
if (!fs.existsSync(smPath)) {
  console.error('\n  ✗ 找不到 public/sitemap.xml，先跑一次 npm run build\n');
  process.exit(2);
}

const urls = [...fs.readFileSync(smPath, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

if (!urls.length) {
  console.error('\n  ✗ sitemap 里没有 URL\n');
  process.exit(2);
}

// 百度单次最多 2000 条；这里按 2000 切片，稳妥
const CHUNK = 2000;
console.log(`\n  准备推送 ${urls.length} 个 URL 到 ${host}\n`);

let okTotal = 0, failTotal = 0;

for (let i = 0; i < urls.length; i += CHUNK) {
  const batch = urls.slice(i, i + CHUNK);
  const api = `http://data.zz.baidu.com/urls?site=${encodeURIComponent(host)}&token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: batch.join('\n'),
    });
    const text = await res.text();

    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON 就是出错了，下面统一处理 */ }

    if (!json) {
      console.log(`  ✗ 百度返回了非 JSON 内容（HTTP ${res.status}）：${text.slice(0, 300)}`);
      failTotal += batch.length;
      continue;
    }

    // 成功时会返回 success / remain；失败时返回 error / message
    if (json.error) {
      const hints = {
        401: 'token 不对，或站点未通过验证',
        403: '站点验证失败，或该域名不属于当前账号',
        413: '推送内容超过 10MB',
        422: 'URL 格式不合法（检查是不是没带 https:// 前缀）',
        429: '推送配额已用完（普通站点每天额度有限）',
      };
      console.log(`  ✗ 推送被拒：${json.message || ''} (code ${json.error})`);
      if (hints[json.error]) console.log(`    可能原因：${hints[json.error]}`);
      failTotal += batch.length;
      continue;
    }

    console.log(`  ✓ 成功 ${json.success || 0} 条，今日剩余配额 ${json.remain ?? '未知'}`);
    okTotal += json.success || 0;
    if (json.not_same_site?.length) {
      console.log(`    ! ${json.not_same_site.length} 条与验证域名不符，已忽略`);
    }
    if (json.not_valid?.length) {
      console.log(`    ! ${json.not_valid.length} 条格式不合法，已忽略`);
    }
  } catch (e) {
    console.log(`  ✗ 请求失败：${e.message}`);
    failTotal += batch.length;
  }
}

console.log(`\n  合计：成功 ${okTotal} 条，失败 ${failTotal} 条\n`);

if (okTotal) {
  console.log('  提示：推送只是提速，不代表立刻收录。');
  console.log('        百度还需要抓取、评估内容质量，新站通常要几天到几周。\n');
}

process.exit(failTotal && !okTotal ? 1 : 0);
