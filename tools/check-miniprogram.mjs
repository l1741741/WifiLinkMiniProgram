#!/usr/bin/env node
/* ==========================================================================
 * 小程序代码检查（零依赖）
 * --------------------------------------------------------------------------
 *   node tools/check-miniprogram.mjs
 *
 * 小程序没有编译期检查，很多错误要到真机点下去才发现。
 * 这个脚本把能静态查出来的问题提前抓出来：
 *
 *   1. 所有 .js 语法、所有 .json 合法性
 *   2. app.json 里声明的页面是否四个文件齐全（js/json/wxml/wxss）
 *   3. WXML 里 bindtap/binderror 指向的函数是否真的存在
 *   4. ★ 这些函数是否带了参数 —— 这条是最容易漏的：
 *      bindtap="foo" 会把事件对象当第一个参数传进去，
 *      如果签名是 foo(silent)，它就永远拿到真值，分支静默走错，
 *      而且报错也不报，只是行为不对。
 *   5. WXML 里引用的顶层变量是否在 data 里声明过
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', 'miniprogram');

if (!fs.existsSync(ROOT)) {
  console.error('\n  ✗ 找不到 miniprogram/ 目录\n');
  process.exit(2);
}

const errors = [];
const warns = [];
const walk = (dir, acc = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.name === 'node_modules') continue;
    if (e.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
};

const files = walk(ROOT);
const rel = (f) => path.relative(ROOT, f);

/* -------------------------------------------------------- 1. 语法检查 */
let jsCount = 0;
for (const f of files.filter((f) => f.endsWith('.js'))) {
  jsCount++;
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    errors.push(`${rel(f)}: JS 语法错误\n      ${String(e.stderr || e.message).split('\n').slice(0, 3).join('\n      ')}`);
  }
}

let jsonCount = 0;
for (const f of files.filter((f) => f.endsWith('.json'))) {
  jsonCount++;
  try {
    JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    errors.push(`${rel(f)}: JSON 不合法 — ${e.message}`);
  }
}

/* ------------------------------------- 1b. 文件内容与扩展名是否匹配 */
/*
 * 踩过的坑：把 index.json 的内容写进了 index.wxss，
 * 编译时报的是「unexpected `"` at pos 5」—— 报错信息完全没提“文件类型写错了”，
 * 只能靠真机/编译时才发现。这类错误静态就能查出来，没必要留给编译器。
 */
for (const f of files) {
  const ext = path.extname(f).toLowerCase();
  if (!['.wxss', '.wxml', '.js', '.json'].includes(ext)) continue;

  const raw = fs.readFileSync(f, 'utf8').trim();
  if (!raw) continue;

  // 这一段内容看起来是不是 JSON？
  const looksJson = /^[\[{]/.test(raw) && (() => {
    try { JSON.parse(raw); return true; } catch { return false; }
  })();

  if (ext === '.wxss' && looksJson) {
    errors.push(`${rel(f)}: 这是 .wxss（只能写 CSS），但内容是一段 JSON。编译时会报 unexpected \`"\``);
  }
  if (ext === '.wxml' && looksJson) {
    errors.push(`${rel(f)}: 这是 .wxml，但内容是一段 JSON`);
  }
  if (ext === '.wxml' && !raw.includes('<')) {
    errors.push(`${rel(f)}: .wxml 里没有任何标签`);
  }
  if (ext === '.wxss' && /^\{/.test(raw)) {
    warns.push(`${rel(f)}: .wxss 以 { 开头，确认写的是 CSS 而不是 JSON`);
  }
}

/* --------------------------------------------- 2. 页面文件完整性 */
const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const pages = appJson.pages || [];

for (const p of pages) {
  for (const ext of ['js', 'json', 'wxml']) {
    const target = path.join(ROOT, p + '.' + ext);
    if (!fs.existsSync(target)) errors.push(`app.json 里声明了 ${p}，但缺 ${p}.${ext}`);
  }
  // wxss 可选（没写样式可以不建），但建了就要能被引用
}

if (!pages.length) errors.push('app.json 的 pages 是空的');

/* --------------------------------- app.json 字段合法性与长度限制（踩过坑） */
/*
 * 下面两条都是真机上报错才发现的规定：
 *
 * 1. requiredPrivateInfos 只接受 8 个位置类接口：
 *      Error: app.json: requiredPrivateInfos[0] 字段需为 chooseAddress,chooseLocation,...
 *
 * 2. permission.<scope>.desc 上限 30 字（微信按 UTF-16 长度算，
 *    空格、英文、标点各算 1 个）：
 *      Error: 80058 ... of scope.userLocation exceeds 30, word count: 59
 *    这两类本地静态就能查，没必要等到真机。
 */
const ALLOWED_PRIVATE_INFOS = new Set([
  'chooseAddress', 'chooseLocation', 'choosePoi', 'getFuzzyLocation',
  'getLocation', 'onLocationChange', 'startLocationUpdate', 'startLocationUpdateBackground',
]);

/** permission.<scope>.desc 的最大长度，微信报错码 80058 */
const PERMISSION_DESC_MAX = 30;

if (appJson.requiredPrivateInfos !== undefined) {
  if (!Array.isArray(appJson.requiredPrivateInfos)) {
    errors.push('app.json: requiredPrivateInfos 必须是数组');
  } else {
    for (const v of appJson.requiredPrivateInfos) {
      if (!ALLOWED_PRIVATE_INFOS.has(v)) {
        errors.push(
          `app.json: requiredPrivateInfos 里的「${v}」不是合法值。\n` +
          `      合法值只有：${[...ALLOWED_PRIVATE_INFOS].join(', ')}\n` +
          `      如果没用到这些位置接口，直接把这个字段删掉。`
        );
      }
    }
  }
}

// permission 里的 desc 是给用户看的授权弹窗文案，微信限 30 字
if (appJson.permission && typeof appJson.permission === 'object') {
  for (const [scope, cfg] of Object.entries(appJson.permission)) {
    const desc = (cfg && cfg.desc) || '';
    if (!desc) {
      warns.push(`app.json: permission.${scope}.desc 为空（授权弹窗会没有说明）`);
      continue;
    }
    if (desc.length > PERMISSION_DESC_MAX) {
      errors.push(
        `app.json: permission.${scope}.desc 长 ${desc.length} 字，超出微信上限 ${PERMISSION_DESC_MAX} 字（错误码 80058）。\n` +
        `      超标 ${desc.length - PERMISSION_DESC_MAX} 字。注意微信按 UTF-16 长度算，空格/英文/标点都算 1 个。\n` +
        `      当前：「${desc}」`
      );
    }
  }
}

// 自定义的 __ 开头的“注释键”虽然目前被忽略，但属于赌平台容忍度，提醒一下
for (const k of Object.keys(appJson)) {
  if (k.startsWith('__')) {
    warns.push(`app.json: 「${k}」是自定义键。平台目前忽略它，但建议把注释挪到 README，json 里只留合法字段`);
  }
}

// 用到位置接口却没声明 → 上架后会被打回
for (const f of files.filter((f) => f.endsWith('.js'))) {
  const src = fs.readFileSync(f, 'utf8');
  for (const api of ALLOWED_PRIVATE_INFOS) {
    if (new RegExp(`wx\\.${api}\\s*\\(`).test(src)) {
      const declared = Array.isArray(appJson.requiredPrivateInfos)
        && appJson.requiredPrivateInfos.includes(api);
      if (!declared) {
        errors.push(`${rel(f)}: 调用了 wx.${api}，但 app.json 的 requiredPrivateInfos 里没声明`);
      }
    }
  }
}

/* ----------------------------------------- 3 & 4. WXML 事件绑定检查 */
/** 从页面 js 源码里抽出 Page({...}) 中定义的方法名 → 参数个数 */
function methodsOf(src) {
  const out = new Map();
  // 匹配 `name(args) {` 或 `name: function (args) {`
  const re = /(?:^|\n)\s{2}([A-Za-z_$][\w$]*)\s*(?:\(([^)]*)\)\s*\{|:\s*function\s*\(([^)]*)\))/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    const argsRaw = (m[2] !== undefined ? m[2] : m[3]) || '';
    const argc = argsRaw.trim() ? argsRaw.split(',').length : 0;
    out.set(name, argc);
  }
  return out;
}

/** 抽出 data 里声明的顶层 key */
function dataKeysOf(src) {
  const keys = new Set();
  const m = /data\s*:\s*\{/.exec(src);
  if (!m) return keys;

  // 从 `data: {` 开始做花括号配平
  let i = m.index + m[0].length;
  let depth = 1;
  let body = '';
  for (; i < src.length && depth > 0; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) break; }
    body += c;
  }
  // 只取深度 0 的 key
  let d = 0;
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (d === 0) {
      const kv = /^([A-Za-z_$][\w$]*)\s*:/.exec(trimmed);
      if (kv) keys.add(kv[1]);
    }
    for (const ch of line) {
      if ('{[('.includes(ch)) d++;
      else if ('}])'.includes(ch)) d--;
    }
  }
  return keys;
}

let wxmlCount = 0;
let bindCount = 0;

for (const p of pages) {
  const wxmlPath = path.join(ROOT, p + '.wxml');
  const jsPath = path.join(ROOT, p + '.js');
  if (!fs.existsSync(wxmlPath) || !fs.existsSync(jsPath)) continue;
  wxmlCount++;

  const wxml = fs.readFileSync(wxmlPath, 'utf8');
  const js = fs.readFileSync(jsPath, 'utf8');
  const methods = methodsOf(js);
  const dataKeys = dataKeysOf(js);

  // --- 事件绑定
  const handlers = [...wxml.matchAll(/\bbind(?::?[a-z]+)="([^"]+)"/g)];
  const seen = new Set();
  for (const m of handlers) {
    const h = m[1];
    if (seen.has(h)) continue;
    seen.add(h);
    bindCount++;

    // 事件名，比如 bindtap → tap、binderror → error
    const evName = /bind:?([a-z]+)/.exec(m[0])[1];

    if (!methods.has(h)) {
      errors.push(`${p}.wxml 绑定了 ${h}，但 ${p}.js 里没有这个方法（点下去会报错）`);
      continue;
    }

    /*
     * 带形参的事件处理函数，分两类：
     *
     * 交互事件（tap / longpress）带参数很容易出事 ——
     * 微信会把事件对象当第一个参数传进去。如果签名写的是 foo(silent)，
     * 它就永远拿到真值，分支静默走错，而且不报错。
     * 但 tap 也确实可能合法地用 e.currentTarget.dataset，所以只能是警告。
     *
     * 其他事件（error / load / input …）带参数是**正常且正确**的写法，
     * 事件对象本身就是数据载体（比如 web-view 的 binderror），不报。
     */
    if ((evName === 'tap' || evName === 'longpress') && methods.get(h) > 0) {
      warns.push(
        `${p}.wxml 的 bind${evName}="${h}" 指向的函数带了形参。\n` +
        `      若该参数是当“开关/标志”用（如 foo(silent)），它会永远拿到事件对象（真值），\n` +
        `      分支静默走错；若只是用 e.currentTarget.dataset，那没问题。`
      );
    }
  }

  // --- 顶层变量引用（只查不在局部作用域里的简单名字）
  const locals = new Set(['true', 'false', 'null', 'undefined', 'item', 'index']);
  // wx:for 会产生 item/index；自定义 wx:for-item 也要认
  for (const m of wxml.matchAll(/wx:for-item="([^"]+)"/g)) locals.add(m[1]);
  for (const m of wxml.matchAll(/wx:for-index="([^"]+)"/g)) locals.add(m[1]);

  const refs = new Set();
  for (const m of wxml.matchAll(/\{\{([^}]+)\}\}/g)) {
    /*
     * 先把字符串字面量挖掉再抽标识符。
     * 不挖的话，{{ok ? 'WiFi 已连接' : '失败'}} 会被当成引用了变量 WiFi，
     * 满屏这种假警告比不做检查还烦。
     */
    const expr = m[1].replace(/'[^']*'/g, ' ').replace(/"[^"]*"/g, ' ');

    for (const id of expr.matchAll(/(?:^|[^.\w$"'-])([A-Za-z_$][\w$]*)/g)) {
      refs.add(id[1]);
    }
  }
  for (const r of refs) {
    if (locals.has(r)) continue;
    if (dataKeys.has(r)) continue;
    if (methods.has(r)) continue;
    warns.push(`${p}.wxml 引用了 {{${r}}}，但 ${p}.js 的 data 里没声明（渲染时会是空）`);
  }
}

/* ------------------------------------------------- 5. 配置内容与备案清单 */
/*
 * 读配置不能用 require()。
 *
 * 根目录 package.json 里写了 "type": "module"，而 miniprogram/ 下没有自己的
 * package.json，Node 会向上查找并继承这个设定，把 config.js 当成 ES 模块加载 ——
 * require() 回来是个空对象，而且不报错。
 *
 * 小程序本身不受影响（微信用自己的模块系统，走 CommonJS），
 * 但 Node 侧的工具会静默拿到空配置。所以这里手动求值，并显式给定 CommonJS 环境。
 */
let cfg = null;
let cfgErrs = [];
try {
  const src = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', src)(mod, mod.exports, () => ({}));
  cfg = mod.exports;
} catch (e) {
  cfgErrs.push(`config.js 求值失败：${e.message}`);
}

if (cfg) {
  const keys = Object.keys(cfg);
  if (!keys.length) cfgErrs.push('config.js 导出的是空对象（是不是被当成 ES 模块加载了？）');

  // 门店：多门店是本项目的核心配置，配错会导致扫 A 店的码拿到 B 店的 WiFi
  const stores = cfg.stores || [];
  if (!stores.length) {
    cfgErrs.push('config.js: stores 为空，至少配一家门店');
  } else {
    const ids = new Set();
    for (const s of stores) {
      if (!s.id) cfgErrs.push(`config.js: 有一家门店没填 id（name=${s.name || '未命名'}）`);
      else if (!/^[A-Za-z0-9_-]+$/.test(s.id)) {
        cfgErrs.push(`config.js: 门店 id「${s.id}」含非法字符（只能用字母数字下划线中划线；因为要放进小程序码参数）`);
      } else if (ids.has(s.id)) {
        cfgErrs.push(`config.js: 门店 id 重复：「${s.id}」`);
      } else {
        ids.add(s.id);
      }
      if (!s.ssid) cfgErrs.push(`config.js: 门店「${s.name || s.id}」没填 ssid`);
      if (!s.password) warns.push(`config.js: 门店「${s.name || s.id}」没填 password（开放式网络可忽略）`);
    }
    if (cfg.defaultStoreId && !ids.has(cfg.defaultStoreId)) {
      cfgErrs.push(`config.js: defaultStoreId「${cfg.defaultStoreId}」在 stores 里不存在`);
    }
  }

  // 备案备注：管局限 20～200 字，超一个字就会被打回
  const note = ((cfg.filing || {}).note || '').trim();
  if (!note) {
    warns.push('config.js: filing.note 为空（备案时要填「服务内容说明」）');
  } else if (note.length < 20 || note.length > 200) {
    cfgErrs.push(`config.js: filing.note 长 ${note.length} 字，超出备案要求的 20～200 字`);
  }

  // 运营主体：审核方会看小程序里有没有说清楚谁做的
  const op = cfg.operator || {};
  if (!op.name) cfgErrs.push('config.js: operator.name 为空（服务说明页会显示）');
  if (!op.contact) warns.push('config.js: operator.contact 为空（备案和审核都可能要用）');

  // 广告：配了 adUnitId 才可能真有收益
  const ad = cfg.ad || {};
  if (ad.enabled !== false && !ad.adUnitId && !ad.placeholderWhenNoAd) {
    warns.push('config.js: 未配 adUnitId 且未开 placeholderWhenNoAd → 小程序会直接跳过广告页（流量主未开通时的预期行为）');
  }
  if (ad.unlockOnError === false) {
    warns.push('config.js: ad.unlockOnError 为 false —— 广告加载失败会把顾客卡在广告页，建议改回 true');
  }
}

/* --------------------------------- 隐私接口使用检测（漏声明会直接废掉功能） */
/*
 * 微信规定：只有在《用户隐私保护指引》里声明了对应信息类型，
 * 才能调用相应接口；未声明则接口被直接禁用，报
 *   errMsg: "A:fail api scope is not declared in the privacy agreement", errno: 112
 *   errMsg: "A:fail appid privacy api banned"   ← 接口权限被回收
 *
 * 这个检查不能替你完成后台配置，但能提前告诉你“哪几项必须去声明”。
 * 清单来自官方《小程序用户隐私保护指引内容介绍》。
 */
const PRIVACY_RULES = [
  {
    label: '收集你的位置信息',
    probe: /wx\.authorize\s*\([^)]*scope\s*:\s*['"]scope\.(userLocation|userLocationBackground|userFuzzyLocation)['"]|wx\.(getLocation|startLocationUpdate|startLocationUpdateBackground|getFuzzyLocation)\s*\(/,
  },
  {
    label: '读取你的剪切板',
    probe: /wx\.(setClipboardData|getClipboardData)\s*\(/,
  },
  {
    label: '收集你选中的照片或视频信息',
    probe: /wx\.(chooseImage|chooseMedia|chooseVideo)\s*\(/,
  },
  {
    label: '访问你的摄像头',
    probe: /wx\.(createVKSession)\s*\(|<camera[\s>]/,
  },
  {
    label: '收集你的手机号',
    probe: /open-type="getPhoneNumber"|open-type="getRealtimePhoneNumber"/,
  },
];

const neededPrivacy = [];
for (const f of files.filter((f) => /\.(js|wxml)$/.test(f))) {
  const src = fs.readFileSync(f, 'utf8');
  for (const rule of PRIVACY_RULES) {
    if (rule.probe.test(src) && !neededPrivacy.includes(rule.label)) {
      neededPrivacy.push(rule.label);
    }
  }
}

/* --------------------------- 域名配置需求检测（后台那两个“开始配置”该不该点） */
/*
 * 小程序后台 → 开发管理 → 开发设置 里有两块域名配置：
 *   服务器域名  —— 给 wx.request / uploadFile / downloadFile / connectSocket 用
 *   业务域名    —— 给 <web-view> 用，且域名必须先完成 ICP 备案
 *
 * 本项目是纯前端、零后端，两个都可能用不上。
 * 但“用没用上”得看代码，不能靠印象 —— 这里自动判断并说清楚。
 */
{
  const NET_APIS = ['request', 'uploadFile', 'downloadFile', 'connectSocket',
                    'createTCPSocket', 'createUDPSocket', 'startLocalServiceDiscovery'];
  const netUsage = [];
  for (const f of files.filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(f, 'utf8');
    for (const api of NET_APIS) {
      if (new RegExp(`wx\\.${api}\\s*\\(`).test(src)) netUsage.push(`${rel(f)} → wx.${api}`);
    }
  }

  const webviewFiles = files.filter((f) => f.endsWith('.wxml'))
    .filter((f) => /<web-view[\s>]/.test(fs.readFileSync(f, 'utf8')));

  console.log('\x1b[1m  后台「域名配置」需求：\x1b[0m');

  if (netUsage.length) {
    console.log(`    \x1b[33m服务器域名：需要配置\x1b[0m —— 代码里用了网络接口`);
    netUsage.forEach((u) => console.log(`      · ${u}`));
  } else {
    console.log('    \x1b[32m服务器域名：不用配\x1b[0m —— 代码里没有任何网络请求（纯前端）');
  }

  if (webviewFiles.length) {
    const urls = ((cfg && cfg.afterConnect) || {}).webviewUrl || '';
    if (urls) {
      console.log(`    \x1b[33m业务域名：需要配置\x1b[0m —— afterConnect.webviewUrl 已启用`);
      console.log(`      · 目标域名必须已完成 ICP 备案，并把微信校验文件放到其根目录`);
    } else {
      console.log('    \x1b[32m业务域名：不用配\x1b[0m —— 有 web-view 页，但 afterConnect.webviewUrl 是空的，永远不会跳到那里');
    }
  } else {
    console.log('    \x1b[32m业务域名：不用配\x1b[0m —— 没有 web-view');
  }
  console.log('');
}

/* ------------------------------------------------------------ 输出 */
console.log(`\n\x1b[1m小程序代码检查\x1b[0m`);
console.log(`  文件 ${files.length} 个 · JS ${jsCount} · JSON ${jsonCount} · 页面 ${pages.length} · WXML ${wxmlCount} · 事件绑定 ${bindCount} 处`);
if (cfg) {
  const noteLen = ((cfg.filing || {}).note || '').trim().length;
  const n = (cfg.stores || []).length;
  console.log(`  配置：门店 ${n} 家 · 备案备注 ${noteLen} 字 · 运营主体=${cfg.operator && cfg.operator.name ? '✓' : '✗'}`);
}
console.log('');

if (neededPrivacy.length) {
  console.log('\x1b[1m  代码用到的隐私接口 → 后台必须声明的项：\x1b[0m');
  for (const label of neededPrivacy) {
    console.log(`    \x1b[36m·\x1b[0m ${label}`);
  }
  console.log('');
  console.log('  \x1b[33m去配置：小程序后台 → 设置 → 功能设置 → 用户隐私保护指引\x1b[0m');
  console.log('  漏声明的接口会被直接禁用（errno 112 / privacy api banned）。');
  console.log('  补充声明后 5 分钟才生效。');
  console.log('');
}

if (cfgErrs.length) {
  errors.unshift(...cfgErrs);
}

if (warns.length) {
  console.log(`\x1b[33m  警告 ${warns.length} 条：\x1b[0m`);
  warns.forEach((w) => console.log('    · ' + w));
  console.log('');
}

if (errors.length) {
  console.log(`\x1b[31m  ✗ 错误 ${errors.length} 条：\x1b[0m`);
  errors.forEach((e) => console.log('    · ' + e));
  console.log(`\n\x1b[31m  ✗ 检查未通过\x1b[0m\n`);
  process.exit(1);
}

// 警告不能藏在“✓ 通过”后面 —— 上面那类带形参的问题就是这样被漏掉的
if (warns.length) {
  console.log(`\x1b[33m  ⚠ 通过，但有 ${warns.length} 条警告需要人工确认（见上方）\x1b[0m\n`);
} else {
  console.log(`\x1b[32m  ✓ 语法、JSON、页面完整性、事件绑定全部通过\x1b[0m\n`);
}
