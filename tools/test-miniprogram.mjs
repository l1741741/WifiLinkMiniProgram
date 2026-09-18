#!/usr/bin/env node
/* ==========================================================================
 * 小程序核心逻辑测试（把 wx.* API 全部 mock 掉，在 Node 里跑）
 * --------------------------------------------------------------------------
 *   node tools/test-miniprogram.mjs
 *
 * 为什么需要这个：小程序没有单元测试环境，而 WiFi 连接那套逻辑
 * 分支多、异步、还依赖「用户去了别的 App 再回来」这种流程，
 * 真机上一遍遍试成本极高。把 wx 全部 mock 掉之后，
 * 两个平台的路径、超时判定、错误码翻译都可以秒级验证。
 *
 * 覆盖的重点：
 *   · iOS 真直连（成功 / 已连过 / 真失败三种结局）
 *   · Android 必须传 maunal:true（否则连了也只有小程序自己能上网）
 *   · 开发者工具等未知平台不能瞎调接口
 *   · 错误码翻译成人话
 *   · 系统给 SSID 加引号时仍能正确比对
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');

/* ============================================================ 断言工具 */
let pass = 0;
const failures = [];

function ok(label, cond, detail) {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else {
    failures.push(label);
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? '\n      → ' + detail : ''}`);
  }
}
function eq(label, actual, expected) {
  ok(label, actual === expected, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}
function section(t) { console.log(`\n\x1b[1m${t}\x1b[0m`); }

/* ============================================================ 假定时器 */
/*
 * 必须用假时钟：连接结果判定要等 12 秒超时，
 * 真等的话每跑一次测试就要十几秒，根本没法反复跑。
 */
function makeClock() {
  let now = 0;
  let seq = 1;
  const timers = new Map();

  return {
    setTimeout(fn, ms = 0) {
      const id = seq++;
      timers.set(id, { fn, at: now + ms, repeat: 0 });
      return id;
    },
    setInterval(fn, ms = 0) {
      const id = seq++;
      timers.set(id, { fn, at: now + ms, every: ms });
      return id;
    },
    clear(id) { timers.delete(id); },
    /** 推进时间，按到期顺序触发回调 */
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) {
          if (t.at <= target && (!next || t.at < next[1].at)) next = [id, t];
        }
        if (!next) break;
        const [id, t] = next;
        now = t.at;
        if (t.every) t.at = now + t.every;
        else timers.delete(id);
        t.fn();
      }
      now = target;
    },
    get now() { return now; },
  };
}

/* ==================================================== 加载被测试的页面 */
/**
 * 读入页面 js，在一个受控沙箱里求值，捕获它传给 Page() 的那个对象。
 *
 * 不能用 require：根目录 package.json 写了 "type":"module"，
 * miniprogram 下没有自己的 package.json，Node 会把页面文件当 ES 模块，
 * require 回来是空对象而且不报错。
 */
function loadPage(pagePath, { platform, app, entry } = {}) {
  const src = fs.readFileSync(pagePath, 'utf8');
  const clock = makeClock();
  const calls = [];                    // 记录所有 wx 调用，供断言
  let pageObj = null;

  // 可被测试用例改写的桩状态
  const state = {
    connectBehavior: 'success',        // success | fail
    connectFailCode: 12002,
    connectedSsid: '',                 // getConnectedWifi 会返回什么
    fireConnectedEvent: false,         // 是否在 connectWifi 成功后触发 onWifiConnected
    authorizeResult: 'success',
    settingGranted: false,
    knownWifiCb: null,
  };

  const cfg = loadConfig();

  const wx = {
    startWifi({ success }) { calls.push(['startWifi']); success && success(); },

    connectWifi(opt) {
      calls.push(['connectWifi', { SSID: opt.SSID, password: opt.password, maunal: opt.maunal }]);
      if (state.connectBehavior === 'fail') {
        clock.setTimeout(() => opt.fail && opt.fail({
          errCode: state.connectFailCode, errMsg: 'connectWifi:fail mock',
        }), 0);
      } else {
        clock.setTimeout(() => {
          opt.success && opt.success({});
          // 模拟系统事件：真实设备上这一步时间不定
          if (state.fireConnectedEvent && state.knownWifiCb) {
            clock.setTimeout(() => state.knownWifiCb({ wifi: { SSID: state.connectedSsid } }), 100);
          }
        }, 0);
      }
    },

    onWifiConnected(cb) { calls.push(['onWifiConnected']); state.knownWifiCb = cb; },
    offWifiConnected(cb) { calls.push(['offWifiConnected']); if (state.knownWifiCb === cb) state.knownWifiCb = null; },

    getConnectedWifi({ success, fail }) {
      calls.push(['getConnectedWifi']);
      clock.setTimeout(() => {
        if (state.connectedSsid) success && success({ wifi: { SSID: state.connectedSsid } });
        else fail && fail({ errCode: 12010, errMsg: 'mock: 没拿到当前 WiFi' });
      }, 0);
    },

    getSetting({ success }) {
      calls.push(['getSetting']);
      clock.setTimeout(() => success && success({
        authSetting: { 'scope.userLocation': state.settingGranted },
      }), 0);
    },

    authorize({ scope, success, fail }) {
      calls.push(['authorize', scope]);
      clock.setTimeout(() => {
        if (state.authorizeResult === 'success') success && success();
        else fail && fail({ errMsg: 'mock: 用户拒绝' });
      }, 0);
    },

    setClipboardData(opt) { calls.push(['setClipboardData', opt.data]); opt.success && opt.success(); },
    showToast(opt) { calls.push(['showToast', opt.title]); },
    showModal(opt) { calls.push(['showModal', opt.title]); },
    navigateTo(opt) { calls.push(['navigateTo', opt.url]); opt.success && opt.success(); },
    navigateToMiniProgram(opt) { calls.push(['navigateToMiniProgram', opt.appId]); },
    redirectTo(opt) { calls.push(['redirectTo', opt.url]); opt.success && opt.success(); },
    getDeviceInfo() { return { platform }; },
    getSystemInfoSync() { return { platform }; },
  };

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    wx,
    // 用真实的 app 实例（从 app.js 加载），不复制一份逻辑 ——
    // 复制的话 app.js 改了测试还是绿的，等于白测。
    // 每个平台各造一份，因为平台判定是在 onLaunch 时定下来的
    getApp: () => app || loadApp(platform),
    Page: (obj) => { pageObj = obj; },
    App: () => {},
    require: (p) => (String(p).includes('config') ? cfg : {}),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clear,
    setInterval: clock.setInterval,
    clearInterval: clock.clear,
    Math, Date, JSON, Object, Array, String, Number, Boolean, Promise, Error,
  };

  const names = Object.keys(sandbox);
  new Function(...names, src)(...names.map((n) => sandbox[n]));

  if (!pageObj) throw new Error('页面没有调用 Page()：' + pagePath);

  // 补上框架会提供的 setData
  pageObj.setData = function (patch) {
    Object.assign(this.data, patch);
    if (this.__setDataLog) this.__setDataLog.push(patch);
  };

  return { page: pageObj, clock, calls, state, cfg, entry: entry || {} };
}

/** 加载真实的 app.js，拿到 globalData 和 resolveStore（每个平台一份） */
function loadApp(platform = 'ios') {
  const src = fs.readFileSync(path.join(MP, 'app.js'), 'utf8');
  let appObj = null;
  const cfg = loadConfig();

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    wx: { getDeviceInfo: () => ({ platform }) },
    App: (o) => { appObj = o; },
    require: (p) => (String(p).includes('config') ? cfg : {}),
    Math, Date, JSON, Object, Array, String, Number, Boolean, Promise, Error,
  };
  const names = Object.keys(sandbox);
  new Function(...names, src)(...names.map((n) => sandbox[n]));

  if (!appObj) throw new Error('app.js 没有调用 App()');
  if (typeof appObj.onLaunch === 'function') appObj.onLaunch();
  return appObj;
}

/** 用同样的方式读 config（不能用 require） */
function loadConfig() {
  const src = fs.readFileSync(path.join(MP, 'config.js'), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', src)(mod, mod.exports, () => ({}));
  return mod.exports;
}

/**
 * 跑一次完整的 onConnect 流程。
 *
 * 关键点：假时钟是同步触发回调的，但页面里的 Promise.then() 是微任务，
 * 要等当前同步代码跑完才会执行。所以不能“一口气把时钟推到底” ——
 * 那样时钟推完了，Promise 链还停在第一步。
 * 必须交替：先清微任务 → 再推一小步时钟 → 再清微任务……
 */
async function runConnect(h, { advanceMs = 13000, steps = 24, options } = {}) {
  h.page.onLoad(options || h.entry || {});
  h.page.onConnect();
  for (let i = 0; i < steps; i++) {
    await new Promise((r) => setImmediate(r));
    h.clock.advance(advanceMs / steps);
  }
  await new Promise((r) => setImmediate(r));
  return h;
}

const callNames = (h) => h.calls.map((c) => c[0]);
const callOf = (h, name) => h.calls.find((c) => c[0] === name);

/* ================================================================ 用例 */
const WIFI_PAGE = path.join(MP, 'pages', 'wifi', 'index.js');
const SSID = 'ChinaNet-3v9I-5G';

// 用真实的 app.js，测的是实际会跑的逻辑。
// 不在这里建全局实例 —— 平台判定在 onLaunch 时就定下来了，
// 各用例必须用对应平台的实例，共用一份会出现“测 iOS 实际跑的是安卓分支”。
console.log('\n\x1b[1m小程序核心逻辑测试\x1b[0m');

/* ---------------------------------------------------- iOS 真直连 */
section('① iOS —— 真·直连（onWifiConnected 正常触发）');
{
  const h = loadPage(WIFI_PAGE, { platform: 'ios' });
  h.state.fireConnectedEvent = true;
  h.state.connectedSsid = SSID;
  await runConnect(h);

  eq('连接成功状态', h.page.data.status, 'connected');
  ok('按钮变成已连接', /已连接/.test(h.page.data.btnText), h.page.data.btnText);

  const c = callOf(h, 'connectWifi');
  ok('调用了 connectWifi', !!c);
  if (c) {
    eq('传的是正确 SSID', c[1].SSID, SSID);
    eq('iOS 不传 maunal', c[1].maunal, false);
  }
}

section('② iOS —— 系统本来就连着这个 WiFi（不发事件，靠兜底核对）');
{
  // 微信文档：已连着目标 WiFi 时再次连接，永远返回成功且不触发 onWifiConnected。
  // 只看事件就会误判成失败，必须补一次 getConnectedWifi。
  const h = loadPage(WIFI_PAGE, { platform: 'ios' });
  h.state.fireConnectedEvent = false;
  h.state.connectedSsid = SSID;
  await runConnect(h);

  ok('仍判定为已连接', h.page.data.status === 'connected', h.page.data.status);
  ok('确实调用了 getConnectedWifi 兜底', callNames(h).includes('getConnectedWifi'));
}

section('③ iOS —— 真失败（超时且核对不上）');
{
  const h = loadPage(WIFI_PAGE, { platform: 'ios' });
  h.state.fireConnectedEvent = false;
  h.state.connectedSsid = 'SomeOtherWiFi';
  await runConnect(h);

  eq('状态为失败', h.page.data.status, 'failed');
  ok('允许重试', h.page.data.canRetry === true);
  ok('提示里带了网络名', h.page.data.statusText.includes(SSID), h.page.data.statusText);
}

section('④ SSID 带引号也要能比对');
{
  // 有些系统返回的 SSID 会带首尾引号，直接 === 会比不上
  const h = loadPage(WIFI_PAGE, { platform: 'ios' });
  h.state.fireConnectedEvent = false;
  h.state.connectedSsid = '"' + SSID + '"';
  await runConnect(h);

  ok('去引号后判定成功', h.page.data.status === 'connected', h.page.data.status);
}

/* ---------------------------------------------------- Android */
section('⑤ Android —— 必须传 maunal:true 跳系统设置页');
{
  const h = loadPage(WIFI_PAGE, { platform: 'android' });
  await runConnect(h);

  const c = callOf(h, 'connectWifi');
  ok('调用了 connectWifi', !!c, callNames(h).join(','));
  // 这条是整段逻辑里最关键的：不传 maunal，连上也只有小程序自己能上网
  eq('maunal 必须为 true', c && c[1].maunal, true);
  ok('先申请了位置权限', callNames(h).includes('authorize'), callNames(h).join(','));
  eq('权限 scope 正确', (callOf(h, 'authorize') || [])[1], 'scope.userLocation');
  ok('提示用户在设置页粘贴', /设置页/.test(h.page.data.statusText), h.page.data.statusText);
}

section('⑥ Android —— 已授权时不再重复弹权限');
{
  const h = loadPage(WIFI_PAGE, { platform: 'android' });
  h.state.settingGranted = true;
  await runConnect(h);

  ok('没有重复调 authorize', !callNames(h).includes('authorize'), callNames(h).join(','));
  ok('仍然完成了连接调用', !!callOf(h, 'connectWifi'));
}

section('⑦ Android —— 用户拒绝授权也不能卡死');
{
  const h = loadPage(WIFI_PAGE, { platform: 'android' });
  h.state.settingGranted = false;
  h.state.authorizeResult = 'fail';
  await runConnect(h);

  // 设计意图：拒绝授权也放行，让 connectWifi 自己报错，
  // 那个错误信息比我们提前编的准确
  ok('仍然调用了 connectWifi', !!callOf(h, 'connectWifi'));
}

/* ---------------------------------------------------- 错误处理 */
section('⑧ 错误码翻译成人话');
{
  const cases = [
    [12002, '密码'],
    [12005, 'WiFi 开关'],
    [12006, '定位'],
    [12013, '忘记'],
  ];
  for (const [code, keyword] of cases) {
    const h = loadPage(WIFI_PAGE, { platform: 'ios' });
    h.state.connectBehavior = 'fail';
    h.state.connectFailCode = code;
    await runConnect(h, { advanceMs: 200 });
    ok(`${code} → 提到「${keyword}」`, h.page.data.statusText.includes(keyword), h.page.data.statusText);
  }
}

/* ---------------------------------------------------- 未知平台 */
section('⑨ 开发者工具等未知平台不能瞎调接口');
{
  const h = loadPage(WIFI_PAGE, { platform: 'devtools' });
  await runConnect(h, { advanceMs: 500 });

  // 开发者工具里没有 WiFi 能力，调了只会报错，
  // 所以应该直接给手动路径
  ok('没有调用 connectWifi', !callOf(h, 'connectWifi'), callNames(h).join(','));
  eq('状态为失败并给出手动路径', h.page.data.status, 'failed');
  ok('提示里说明了无法自动连接', /无法自动连接/.test(h.page.data.statusText), h.page.data.statusText);
  eq('按钮文案是通用版', h.page.data.btnText, '一键连接 WiFi');
}

/* ---------------------------------------------------- 通用行为 */
section('⑩ 通用行为');
{
  const h = loadPage(WIFI_PAGE, { platform: 'ios' });
  h.page.onLoad();
  // 页面加载时不该碰剪贴板：wx.setClipboardData 是隐私接口，
  // 那时弹隐私授权很突然，容易被拒，拒了后续 10 秒内都调不动
  ok('页面加载时不碰剪贴板（避免过早弹隐私授权）', !callOf(h, 'setClipboardData'), callNames(h).join(','));

  await runConnect(h);
  const cp = callOf(h, 'setClipboardData');
  ok('点一键连接时才复制密码', !!cp);
  eq('复制的是配置里的密码', cp && cp[1], (loadConfig().stores || [])[0].password);

  const c = loadPage(WIFI_PAGE, { platform: 'ios' });
  c.page.onLoad();
  eq('默认不显示密码明文', c.page.data.pwdShown, false);
  c.page.togglePwd();
  eq('点眼睛后显示', c.page.data.pwdShown, true);
}

section('⑪ 连上之后的跳转');
{
  const h = loadPage(WIFI_PAGE, { platform: 'ios' });
  h.state.fireConnectedEvent = true;
  h.state.connectedSsid = SSID;
  await runConnect(h, { advanceMs: 15000, steps: 60 });   // 走到 afterConnect 的 900ms 之后
  ok('触发了成功提示', callNames(h).includes('showToast'), callNames(h).join(','));
}

/* ---------------------------------------------------- 多门店 */
section('⑫ 多门店解析（服务商模式的核心）');
{
  // 临时注入两家店，验证分流逻辑
  const cfg = loadConfig();
  const original = JSON.parse(JSON.stringify(cfg.stores));
  cfg.stores = [
    { id: 'main', name: '本店', ssid: 'MAIN-5G', password: 'main1234' },
    { id: 'shop2', name: '悦荟城店', ssid: 'YH-5G', password: 'yh123456' },
  ];
  cfg.defaultStoreId = 'main';

  // 注意：loadApp 每次都重新读 config.js，这里改了 cfg 后要重建 app
  const mk = (platform) => {
    const a = loadApp(platform);
    a.globalData.config = cfg;      // 注入测试用的门店表
    return a;
  };

  // ① 扫 shop2 的小程序码进来
  {
    const app = mk('ios');
    const h = loadPage(WIFI_PAGE, { platform: 'ios', app });
    h.page.onLoad({ scene: 'shop2' });
    eq('scene=shop2 → 拿到正确的 SSID', h.page.data.ssid, 'YH-5G');
    eq('拿到正确的密码', h.page.data.password, 'yh123456');
    eq('拿到正确的店名', h.page.data.storeName, '悦荟城店');
    ok('非默认店会显示店名', h.page.data.showStoreName === true);
  }

  // ② scene 是 URL 编码的（微信真实行为）
  {
    const app = mk('ios');
    const h = loadPage(WIFI_PAGE, { platform: 'ios', app });
    h.page.onLoad({ scene: encodeURIComponent('shop2') });
    // 不解码的话这里会拿不到，是很容易漏的一步
    eq('编码过的 scene 也能解析', h.page.data.ssid, 'YH-5G');
  }

  // ③ 不带任何参数（搜小程序名进来）
  {
    const app = mk('ios');
    const h = loadPage(WIFI_PAGE, { platform: 'ios', app });
    h.page.onLoad({});
    eq('回退到默认店', h.page.data.ssid, 'MAIN-5G');
    ok('默认店不显示店名', h.page.data.showStoreName === false);
  }

  // ④ 参数指向不存在的店（码印错、店关了）
  {
    const app = mk('ios');
    const h = loadPage(WIFI_PAGE, { platform: 'ios', app });
    h.page.onLoad({ scene: 'shop999' });
    // 宁可多给一家店的 WiFi，也不能白屏
    eq('未知门店回退到默认', h.page.data.ssid, 'MAIN-5G');
  }

  // ⑤ 广告页要把门店参数透传到 WiFi 页
  {
    const app = mk('ios');
    const h = loadPage(path.join(MP, 'pages', 'ad', 'index.js'), { platform: 'ios', app });
    h.page.onLoad({ scene: 'shop2' });
    h.page.onReady();
    h.clock.advance(100);

    const r = callOf(h, 'redirectTo');
    ok('广告页确实跳了', !!r);
    ok('跳转 URL 带了 scene', r && /scene=shop2/.test(r[1]), r && r[1]);
  }

  cfg.stores = original;
}

/* ---------------------------------------------------- 内联 scene（WiFi 信息直接写在码里） */
section('⑬ 内联 scene —— scene 直接带 WiFi 名和密码');
{
  const app = loadApp('ios');
  const h = loadPage(WIFI_PAGE, { platform: 'ios', app });

  h.page.onLoad({ scene: 'ChinaNet-3v9I-5G~88888888' });
  eq('SSID 正确解出', h.page.data.ssid, 'ChinaNet-3v9I-5G');
  eq('密码正确解出', h.page.data.password, '88888888');
  // 内联模式没有中文店名，不应该凭空显示一个
  eq('不显示店名', h.page.data.showStoreName, false);
}

{
  // 密码里带 `~`：只按第一个 `~` 切，后面的全都算密码
  const app = loadApp('ios');
  const h = loadPage(WIFI_PAGE, { platform: 'ios', app });
  h.page.onLoad({ scene: 'Shop-Guest~pa~ss~word' });
  eq('SSID 只切到第一个分隔符', h.page.data.ssid, 'Shop-Guest');
  eq('密码里的 ~ 保留下来', h.page.data.password, 'pa~ss~word');
}

{
  // 内联模式应该完全忽略 config.js 里的门店表
  const app = loadApp('ios');
  const h = loadPage(WIFI_PAGE, { platform: 'ios', app });
  h.page.onLoad({ scene: 'Inline-Test-Net~inlinepwd' });
  eq('用的是码里的 SSID，不是配置里的', h.page.data.ssid, 'Inline-Test-Net');
  ok('确实不是默认门店的', h.page.data.ssid !== 'ChinaNet-3v9I-5G');
}

{
  // 各种不合法输入都不能解析成内联，得稳稳回退到 id 模式
  const app = loadApp('ios');
  const cases = [
    ['没有分隔符', 'shop2'],
    ['~ 开头（SSID 为空）', '~88888888'],
    ['超 32 字符', 'A'.repeat(40) + '~pwd'],
    ['空字符串', ''],
  ];
  for (const [label, scene] of cases) {
    const h = loadPage(WIFI_PAGE, { platform: 'ios', app });
    h.page.onLoad({ scene });
    // 都应该走 id 查配置的路，落到默认门店
    ok(`${label} → 回退到默认门店`, h.page.data.ssid === 'ChinaNet-3v9I-5G', h.page.data.ssid);
  }
}

{
  // 边界：刚好 32 字符应该能用（微信的上限）
  const app = loadApp('ios');
  const h = loadPage(WIFI_PAGE, { platform: 'ios', app });
  const scene = 'A'.repeat(20) + '~' + 'B'.repeat(11);   // 20+1+11 = 32
  eq('场景长度刚好是 32', scene.length, 32);
  h.page.onLoad({ scene });
  eq('32 字符仍能解析', h.page.data.password, 'B'.repeat(11));
}

/* ================================================================ 汇总 */
console.log('');
if (failures.length) {
  console.log(`\x1b[31m✗ ${failures.length} 项失败（通过 ${pass} 项）\x1b[0m`);
  failures.forEach((f) => console.log('    · ' + f));
  console.log('');
  process.exit(1);
}
console.log(`\x1b[32m✓ 全部通过（${pass} 项）\x1b[0m\n`);
