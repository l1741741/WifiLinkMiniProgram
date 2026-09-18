/* ==========================================================================
 * 扫码连 WiFi · 主逻辑
 * --------------------------------------------------------------------------
 * 流程：扫码进入 → 看广告（闸门）→ WiFi 信息页 → 选择连接方式
 * 依赖：assets/vendor/qrcode.js（MIT，本地内置，不依赖任何 CDN）
 * ========================================================================== */
(function () {
  'use strict';

  /* ============================================================ 基础工具 */
  var CFG = window.WIFI_APP_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var htmlEsc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  function param(name) {
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  }

  var UA = navigator.userAgent || '';

  /*
   * 环境判定。这里每个分支都直接决定“显示哪个按钮、用哪个 scheme”，
   * 判错就会给用户一个点了没反应的按钮，所以每个条件都写了原因。
   */
  // 触摸能力比 UA 可靠：iPadOS 13+ 默认请求桌面版网页，UA 是 Macintosh，
  // 只能靠触摸点数区分（Mac 笔记本没有触摸屏，maxTouchPoints 为 0）。
  var isTouch = (navigator.maxTouchPoints || 0) > 1 || 'ontouchend' in document;
  var ipadDesktopMode = /Macintosh/.test(UA) && isTouch;

  // 纯血鸿蒙（HarmonyOS NEXT）不是安卓，UA 里没有 Android 字样，
  // 也不能用 Android 的 intent:// scheme。要跟旧版鸿蒙分开：
  //   HarmonyOS 2/3/4 = 基于安卓，UA 含 Android
  //   HarmonyOS NEXT   = 自研内核，UA 只有 HarmonyOS / ArkWeb
  var harmonyNext = /HarmonyOS|OpenHarmony|ArkWeb/i.test(UA) && !/Android/i.test(UA);

  var ENV = {
    wechat: /MicroMessenger/i.test(UA),
    ios: /iPad|iPhone|iPod/i.test(UA) || ipadDesktopMode,
    android: /Android/i.test(UA),
    harmony: harmonyNext,
  };

  /*
   * ?env=android|ios|wechat —— 强制指定环境，只为预览用。
   * 在电脑上没法直接看到手机端的文案/步骤差异，加这个参数就不用真机来回试。
   * 支持逗号组合，比如 ?env=wechat,ios 可以预览「iPhone 上的微信里」是什么样。
   * 只影响显示哪套文案和 scheme，不影响任何数据。
   */
  var forceEnv = param('env');
  if (forceEnv) {
    forceEnv.split(',').forEach(function (flag) {
      var f = flag.trim();
      if (f === 'android') { ENV.android = true; ENV.ios = false; ENV.harmony = false; }
      else if (f === 'ios') { ENV.ios = true; ENV.android = false; ENV.harmony = false; }
      else if (f === 'harmony') { ENV.harmony = true; ENV.android = false; ENV.ios = false; }
      else if (f === 'wechat') { ENV.wechat = true; }
      else if (f === 'desktop') { ENV.ios = ENV.android = ENV.wechat = ENV.harmony = false; }
    });
  }
  var DEBUG = param('debug') === '1';

  /* ============================================================== 提示条 */
  var toastTimer = null;
  function toast(msg, ms) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, ms || 1900);
  }

  /* ============================================================== 埋点上报 */
  function track(event, extra) {
    if (!CFG.track || !CFG.track.enabled || !CFG.track.url) return;
    var payload = {
      e: event,
      t: Date.now(),
      wifi: state.wifi ? state.wifi.id : '',
      ref: document.referrer || '',
      src: param('c') || param('from') || '',
      ua: UA,
      extra: extra || null,
    };
    var body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(CFG.track.url, new Blob([body], { type: 'application/json' }));
      } else {
        fetch(CFG.track.url, { method: 'POST', body: body, keepalive: true, mode: 'no-cors' });
      }
    } catch (e) { /* 埋点失败绝不影响主流程 */ }
  }

  /* ============================================================ WiFi 数据 */
  var state = { wifi: null };

  function pickWifi() {
    var list = (CFG.wifiList || []).filter(Boolean);
    var wantId = param('id');
    var found = null;
    if (wantId) found = list.filter(function (w) { return String(w.id) === wantId; })[0];
    if (!found && CFG.defaultWifiId) {
      found = list.filter(function (w) { return String(w.id) === String(CFG.defaultWifiId); })[0];
    }
    return found || list[0] || null;
  }

  /** WIFI: 协议要求对 \ ; , : " 做反斜杠转义 */
  function escField(v) {
    return String(v == null ? '' : v).replace(/([\\;,:"])/g, '\\$1');
  }

  /** 生成系统可识别的 WiFi 配置串（iOS 11+ / Android 10+ 相机扫它可直接连） */
  function wifiQrText(w) {
    var type = (w.security || 'WPA').toUpperCase();
    if (type === 'NONE' || type === 'NOPASS' || type === 'OPEN') type = 'nopass';
    var out = 'WIFI:T:' + type + ';S:' + escField(w.ssid) + ';';
    if (type !== 'nopass') out += 'P:' + escField(w.password) + ';';
    if (w.hidden) out += 'H:true;';
    return out + ';';
  }

  /* ========================================================= 二维码渲染 */
  /**
   * 用 canvas 把二维码画成 PNG，再以 <img> 呈现。
   * 用 <img> 而不是 SVG 的原因：手机上「长按图片 → 存储到照片」是通行的保存手势，
   * 存进相册后 iPhone 照片 App / Android 相册都能识别 WiFi 码，等于多一条连接路径。
   */
  function renderQr(target, text, px) {
    if (typeof qrcode !== 'function') {
      target.innerHTML = '<p style="color:#b42318;font-size:13px">二维码库未加载</p>';
      return null;
    }
    // 开启 UTF-8，支持中文 SSID / 中文密码
    if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) {
      qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    }

    var EC = 'M';                       // 纠错等级 M：容错与尺寸的平衡点
    var qr = qrcode(0, EC);             // 0 = 自动选择最小版本
    qr.addData(text, 'Byte');
    qr.make();

    var n = qr.getModuleCount();
    var margin = 4;                     // 静区：标准要求 4 个模块，少于此值扫码率会下降
    var total = n + margin * 2;
    var size = px || 1024;
    var cell = Math.max(2, Math.floor(size / total));   // 整数格子，避免非整数缩放导致边缘发虚
    var dim = cell * total;

    var cv = document.createElement('canvas');
    cv.width = cv.height = dim;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = '#000000';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
        }
      }
    }

    var url = cv.toDataURL('image/png');
    target.innerHTML = '<img alt="WiFi 连接二维码" src="' + url + '">';
    return url;
  }

  /* ================================================================= 广告 */
  var Ad = {
    started: 0,
    total: 15,
    timer: null,
    finished: false,
    lastTick: -1,

    /**
     * 把广告代码放进同源沙箱 iframe 执行。
     *
     * 为什么不用 innerHTML 直接塞进页面？因为广告联盟的代码片段普遍用
     * document.write()，而它在「文档已完成加载」之后再被调用，浏览器会先
     * document.open() —— 结果是整个页面被清空，用户直接看到白屏。
     * 放进 iframe，最坏情况也只影响 iframe 自己。
     *
     * 关于 sandbox：必须加 allow-same-origin，否则 iframe 变成不透明源，
     * 广告脚本读不到 cookie / 域名，很多联盟会直接不填充（打不出广告）。
     * 我们本来就要信任该联盟的代码，所以这个代价是值的。
     */
    mountIframe(container, markup, height) {
      var f = document.createElement('iframe');
      f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms');
      f.setAttribute('scrolling', 'no');
      f.setAttribute('title', '广告');
      f.style.cssText = 'width:100%;height:' + height + 'px;border:0;display:block;background:transparent';
      // srcdoc 文档的 URL 是 about:srcdoc，不补 <base> 的话广告素材里
      // 写 img src="assets/ads/x.jpg" 会解析到 about:srcdoc 上，图直接加载不出来。
      // 这很坑：广告代码看着没错，就是白框。补上 base 后相对/根路径都能用。
      f.srcdoc = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
        '<base href="' + location.origin + '/">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}' +
        'body{display:flex;align-items:center;justify-content:center;min-height:' + height + 'px}' +
        'img,video,canvas,ins,iframe{max-width:100%}</style></head><body>' + markup + '</body></html>';
      container.appendChild(f);
      return f;
    },

    /**
     * inline 模式：在页面里直接执行联盟代码（innerHTML 不会执行 <script>，要手动重建），
     * 同时把 document.write 临时重定向到广告容器。
     * 仅在联盟明确要求页面上下文时用（比如要读页面 referrer / 埋点）。
     */
    injectInline(container, markup) {
      container.innerHTML = markup;

      var doc = document;
      var origWrite = doc.write, origWriteln = doc.writeln;
      var restored = false;

      var restore = function () {
        if (restored) return;
        restored = true;
        doc.write = origWrite;
        doc.writeln = origWriteln;
      };

      var redirect = function (markupStr) {
        try {
          var box = doc.createElement('div');
          box.innerHTML = String(markupStr == null ? '' : markupStr);
          runScripts(box);
          while (box.firstChild) container.appendChild(box.firstChild);
        } catch (e) { /* 联盟给了非法 HTML 也不能崩掉主流程 */ }
      };

      // 重建 <script>：innerHTML 插入的脚本浏览器不会执行
      var runScripts = function (scope) {
        Array.prototype.forEach.call(scope.querySelectorAll('script'), function (old) {
          var s = doc.createElement('script');
          Array.prototype.forEach.call(old.attributes, function (a) { s.setAttribute(a.name, a.value); });
          s.text = old.textContent;
          old.parentNode.replaceChild(s, old);
        });
      };

      doc.write = redirect;
      doc.writeln = function (m) { redirect(m + '\n'); };

      try {
        runScripts(container);
      } catch (e) {
        restore();
        this.onAdError('inline_throw');
        return;
      }

      // 外部脚本是异步的（联盟还常常再动态插脚本），所以不立即恢复；
      // 兜底 10 秒后一定恢复，避免长期占用全局 document.write。
      setTimeout(restore, 10000);
    },

    /* 通用挂载：横幅位等复用同一套隔离逻辑 */
    mount(container, markup, height) {
      try {
        if ((CFG.ad || {}).mode === 'inline') this.injectInline(container, markup);
        else this.mountIframe(container, markup, height || 90);
      } catch (e) { /* 广告挂了不能影响主流程 */ }
    },

    loadAd() {
      var slot = $('ad-slot');
      var a = CFG.ad || {};
      var markup = (a.html || '').trim();
      var scriptUrl = (a.scriptUrl || '').trim();

      // 只填了 scriptUrl 就包成一段 script 标签
      if (!markup && scriptUrl) {
        markup = '<scr' + 'ipt src="' + htmlEsc(scriptUrl) + '"></scr' + 'ipt>';
      }

      // 没有任何广告内容
      if (!markup) {
        if (a.placeholder) {
          // 兜底画面顶着，让流程完整跑通（适合先上线、后接广告）
          $('ad-fallback').hidden = false;
          $('ad-hint').textContent = 'WiFi 服务由广告支持';
          return;
        }
        this.finish('no_ad');   // 没广告也没占位 → 直接放行，别耗着用户
        return;
      }

      try {
        if ((a.mode || 'iframe') === 'inline') {
          this.injectInline(slot, markup);
        } else {
          this.mountIframe(slot, markup, parseInt(a.iframeHeight, 10) || 360);
        }
      } catch (e) {
        this.onAdError('mount_failed');
      }
    },

    onAdError(why) {
      track('ad_error', { why: why });
      if ((CFG.ad || {}).unlockOnError !== false) this.finish('ad_error');
    },

    start(onDone) {
      var a = CFG.ad || {};
      this.onDone = onDone;
      this.total = Math.max(1, parseInt(a.minSeconds, 10) || 15);

      // 跳过时机：>=0 表示多少秒后可点；-1 表示不提供跳过。
      // 填得比总时长还大就没意义了（等到那时候已经自动进下一屏），统一归为 -1。
      var rawSkip = typeof a.skipAfterSeconds === 'number' ? a.skipAfterSeconds : -1;
      this.skipAfter = rawSkip >= 0 && rawSkip < this.total ? rawSkip : -1;

      this.started = Date.now();
      this.finished = false;
      this.lastTick = -1;
      this.lastSkipWait = null;

      $('ad-count-chip').textContent = this.total + 's';
      $('af-count').textContent = String(this.total);
      $('ad-prog').style.width = '0%';
      this.updateSkip(0);

      track('ad_start', { seconds: this.total, skipAfter: this.skipAfter });
      this.loadAd();

      var self = this;
      this.timer = setInterval(function () { self.tick(); }, 200);
      this.tick();
    },

    /*
     * 顶栏只显示一个东西，避免拥挤和歧义：
     *   配置了跳过  → 显示按钮，先「跳过 2s」（置灰不可点），到点变可点的「跳过」
     *   没配置跳过  → 只显示倒计时数字，不放一个永远点不动的死按钮
     */
    updateSkip(elapsed) {
      var btn = $('ad-skip'), chip = $('ad-count-chip');

      if (this.skipAfter < 0) {
        btn.hidden = true;
        chip.hidden = false;
        return;
      }

      chip.hidden = true;
      btn.hidden = false;

      var wait = this.skipAfter - elapsed;
      if (wait > 0) {
        var n = Math.ceil(wait);
        if (n !== this.lastSkipWait) {      // 只在秒数变化时改 DOM
          this.lastSkipWait = n;
          btn.disabled = true;
          btn.innerHTML = '跳过 <b>' + n + '</b>s';
        }
      } else if (this.lastSkipWait !== 0) {
        this.lastSkipWait = 0;
        btn.disabled = false;
        btn.textContent = '跳过';
      }
    },

    tick() {
      if (this.finished) return;
      var elapsed = (Date.now() - this.started) / 1000;
      var left = this.total - elapsed;
      if (left <= 0) { this.finish('completed'); return; }

      // 倒计时只在秒数变化时改 DOM，省电
      var ceil = Math.ceil(left);
      if (ceil !== this.lastTick) {
        this.lastTick = ceil;
        $('ad-count-chip').textContent = ceil + 's';
        $('af-count').textContent = String(ceil);
      }
      this.updateSkip(elapsed);

      var pct = (1 - left / this.total) * 100;
      $('ad-prog').style.width = pct.toFixed(1) + '%';

      // 兜底圆环进度
      var ring = document.querySelector('.adfallback__ring');
      if (ring) ring.style.setProperty('--p', (pct * 3.6).toFixed(0) + 'deg');
    },

    finish(why) {
      if (this.finished) return;
      this.finished = true;
      clearInterval(this.timer);
      track('ad_complete', { why: why });
      try { sessionStorage.setItem('wifi_ad_done', '1'); } catch (e) {}
      if (this.onDone) this.onDone();
    },
  };

  /* ============================================================ 平台引导 */
  function stepsHtml(w) {
    var ssid = '<b>' + htmlEsc(w.ssid) + '</b>';
    if (ENV.ios) {
      return '<li>打开 <b>设置</b> → <b>无线局域网</b>（密码已在剪贴板里）</li>' +
             '<li>等列表刷新，找到 ' + ssid + '</li>' +
             '<li>点击它，<b>长按密码输入框 → 粘贴</b></li>' +
             '<li>点右上角 <b>加入</b>，打勾即连上</li>';
    }
    if (ENV.android) {
      return '<li>打开 <b>设置</b> → <b>WLAN / 无线网络</b>（密码已在剪贴板里）</li>' +
             '<li>确认 WLAN 开关已打开，等列表刷新</li>' +
             '<li>找到 ' + ssid + '，点击它</li>' +
             '<li><b>长按密码输入框 → 粘贴</b> → 点「连接」</li>';
    }
    // 纯血鸿蒙：界面叫「WLAN」，但跳转方式跟安卓不同（没有可用的深链），
    // 所以按钮不显示，步骤文案得单独给
    if (ENV.harmony) {
      return '<li>打开 <b>设置</b> → <b>WLAN</b>（密码已在剪贴板里）</li>' +
             '<li>等列表刷新，找到 ' + ssid + '</li>' +
             '<li>点击它，<b>长按密码输入框 → 粘贴</b></li>' +
             '<li>点「连接」</li>';
    }
    return '<li>打开设备 <b>设置</b> → <b>WiFi / 无线网络</b></li>' +
           '<li>找到 ' + ssid + '，点击进入</li>' +
           '<li>粘贴密码 → 连接</li>';
  }

  /*
   * 二维码这条路只在「旁边有第二台手机」或「截图后系统识别」时才成立——
   * 用户没法用同一台手机的相机去扫自己屏幕上的码。所以文案必须把前提说清楚，
   * 否则用户会举着手机对着自己的屏幕发呆。
   */
  function qrTipHtml() {
    if (ENV.wechat) {
      return '在微信里可以<b>长按上方二维码 → 识别图中二维码</b>；<br>' +
             '或截图后打开「微信扫一扫」→ 右下角「相册」→ 选中刚才的截图。<br>' +
             '都不行就用<b>方式一</b>，方式一 100% 可用。';
    }
    if (ENV.ios) {
      return '截图后打开「照片」App，轻点二维码下方的链接气泡即可「加入网络」（iOS 17+）。<br>' +
             '旁边有第二台手机的话，直接用它的相机扫最省事。';
    }
    if (ENV.android) {
      return '截图后用「Google 相册 / 智慧识屏」识别即可连接；<br>' +
             '旁边有第二台手机的话，直接用它相机扫最快。';
    }
    if (ENV.harmony) {
      return '截图后用「小艺 / 智慧视觉」识别即可连接；<br>' +
             '旁边有第二台手机的话，直接用它相机扫最快。';
    }
    return '用另一台手机的「相机」或「微信扫一扫」对准上方二维码，系统会直接弹出「加入网络」。';
  }

  /*
   * 跳到系统 WiFi 设置页（两个平台都试，成功率不同）。
   *
   * Android —— 基本可靠
   *   用 intent:// + 标准 action android.settings.WIFI_SETTINGS。
   *   必须是**隐式 intent（不指定 package/component）**：硬编码 Activity 类名
   *   在 MIUI / EMUI 等定制 ROM 上会抛 ActivityNotFoundException。
   *   也不能用 JS 造 a 再 click() —— Chrome 官方要求用户手势才启动外部应用，
   *   合成点击不产生 user activation，必然被拦。所以这里写的是真实 <a> 的 href。
   *
   * iOS —— 版本相关，不保证
   *   苹果没有公开 API，只有应用自己的设置页（openSettingsURLString）。
   *   App-Prefs:root=WIFI 是社区常用的私有 scheme：
   *     有反馈 iOS 18 失效、iOS 18.3.1 仍可用、iOS 26 彻底封禁。
   *   证据矛盾，但试一次成本极低 —— 能跳就赚了，不能跳下面有兵底提示。
   *
   * 两边都靠「页面是否还在前台」判断成功与否：跳转成功会触发 visibilitychange，
   * 页面还在就说明没跳过去，弹提示告诉用户手动路径。不假装一定能成。
   */
  /**
   * Android：intent:// + 标准 action，基本可靠。
   * iOS：默认不给 scheme —— 真机实测点击后 Safari 弹“网址无效”，
   *      请求根本没发出去，说明 iOS 已不再注册 App-Prefs 这类私有 scheme。
   *      想碰运气可在 config.js 的 iosSettingsScheme 里填。
   */
  var SCHEME = {
    android: 'intent://#Intent;action=android.settings.WIFI_SETTINGS;end',
    ios: CFG.iosSettingsScheme || '',
  };

  function setupSettingsButton() {
    var a = $('btn-open-settings');
    if (!a) return;

    var scheme = ENV.android ? SCHEME.android
               : ENV.ios ? SCHEME.ios
               : null;

    /*
     * 不显示按钮的四种情况，每一种都有实测依据：
     *   桌面浏览器 —— 没有系统 WiFi 设置页可跳
     *   iPhone    —— scheme 被 iOS 移除，点了只弹错误框（真机验证过）
     *   纯血鸿蒙   —— Android 的 intent:// 在它上面无效
     *   其他未知环境 —— 宁可只给步骤，也不给一个点了没反应的按钮
     */
    if (!scheme) {
      a.hidden = true;
      return;
    }

    a.href = scheme;
    a.hidden = false;

    a.addEventListener('click', function () {
      track('open_settings', { env: ENV.android ? 'android' : 'ios' });

      setTimeout(function () {
        if (document.visibilityState !== 'visible') return;   // 真跳过去了
        // 只有 Android 会走到这里（iOS 默认不显示按钮）
        toast('这台手机没跳过去，请手动打开「设置 → WLAN」', 3400);
      }, 1500);
    });
  }

  /* ============================================================ 复制密码 */
  function copyText(text) {
    return new Promise(function (resolve) {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(function () { resolve(true); }, function () { resolve(legacy()); });
      } else {
        resolve(legacy());
      }
      function legacy() {
        try {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
          document.body.appendChild(ta);
          ta.select();
          ta.setSelectionRange(0, ta.value.length);
          var ok = document.execCommand('copy');
          document.body.removeChild(ta);
          return ok;
        } catch (e) { return false; }
      }
    });
  }

  /* ========================================================== WiFi 信息屏 */
  function paintWifi(w) {
    state.wifi = w;
    var brand = CFG.brand || {};
    document.title = (w.title || brand.title || '免费 WiFi') + ' · 手机扫码连接';

    $('wifi-title').textContent = w.title || brand.title || '免费 WiFi';
    $('wifi-sub').textContent = w.shopName ? w.shopName + ' · ' + (brand.subtitle || '') : (brand.subtitle || '');
    $('wifi-ssid').textContent = w.ssid;
    $('wifi-sec').textContent = (w.security || 'WPA').toUpperCase();
    $('pwd-inline').textContent = w.password;

    var pwdEl = $('wifi-pwd');
    pwdEl.textContent = '••••••••';
    pwdEl.dataset.real = w.password;
    $('btn-eye').classList.remove('is-on');

    var notice = $('wifi-notice');
    notice.textContent = w.notice || '';
    notice.hidden = !w.notice;

    if (brand.logo) {
      $('brand-logo').innerHTML = '<img src="' + htmlEsc(brand.logo) + '" alt="">';
    }

    if (brand.themeColor) {
      document.documentElement.style.setProperty('--brand', brand.themeColor);
    }

    $('steps').innerHTML = stepsHtml(w);
    $('qr-tip').innerHTML = qrTipHtml();
    setupSettingsButton();

    // 横幅广告位
    var b = (CFG.ad || {}).banner || {};
    if (b.enabled && b.html) {
      var bs = $('banner-slot');
      bs.hidden = false;
      Ad.mount(bs, b.html, parseInt(b.height, 10) || 90);
    }
  }

  function showWifi(w) {
    $('screen-ad').hidden = true;
    $('screen-wifi').hidden = false;
    paintWifi(w);
    track('wifi_view');
  }

  /* ============================================================== 弹层 */
  var qrDataUrl = null;

  function openSheet() {
    $('sheet-mask').hidden = false;
    document.body.style.overflow = 'hidden';
    track('connect_tap', { env: ENV.wechat ? 'wechat' : ENV.ios ? 'ios' : ENV.android ? 'android' : 'other' });

    // 进弹层就渲染二维码（element 需要有尺寸，所以在这里做）
    if (!qrDataUrl && state.wifi) {
      qrDataUrl = renderQr($('wifi-qr'), wifiQrText(state.wifi), 1024);
      track('qr_shown');
    }

    if ((CFG.behavior || {}).autoCopyOnConnect !== false && state.wifi) {
      copyText(state.wifi.password).then(function (ok) {
        track('copy_pwd', { auto: true, ok: ok });
        $('sheet-sub').innerHTML = ok
          ? '✅ 密码 <b class="mono">' + htmlEsc(state.wifi.password) + '</b> 已复制到剪贴板'
          : '请点下面的按钮复制密码';
        if (ok && (CFG.behavior || {}).toastOnCopy !== false) {
          toast('密码已复制，去 WiFi 设置里长按粘贴');
        }
      });
    }
  }

  function closeSheet() {
    $('sheet-mask').hidden = true;
    document.body.style.overflow = '';
  }

  /*
   * 广告跑在沙箱 iframe 里，它的点击不会冒泡到我们页面，
   * 所以联盟/商家代码需要主动 postMessage 告诉我们。
   * 需要统计点击时，在广告 HTML 里加：
   *   onclick="parent.postMessage({t:'ad_click'},'*')"
   * 收不到不影响展示，只是少一个统计数字。
   */
  function bindAdMessages() {
    window.addEventListener('message', function (e) {
      // 只认我们自己发的那种消息；不校验来源域名（广告也可能来自联盟的 CDN）
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.t === 'ad_click') track('ad_click', { from: 'iframe' });
    });
  }

  /* ====================================================== 页脚站点信息 */
  /*
   * /scan/ 虽然是个工具页，但它跑在同一个域名下，
   * 页脚同样得展示备案信息（硬性要求），否则整站备案不合规。
   * 数据来自构建脚本生成的 /assets/site-info.js —— 和内容站同源，不会两处对不上。
   */
  function paintSiteFooter() {
    var info = window.SITE_INFO;
    if (!info) return;

    var home = $('site-ft-home');
    if (home && info.homePath) {
      home.href = info.homePath;
      home.hidden = false;
    }

    var el = $('site-ft-icp');
    if (!el) return;

    if (info.icp) {
      el.innerHTML = '<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener nofollow">' +
        htmlEsc(info.icp) + '</a>' + (info.police ? ' · ' + htmlEsc(info.police) : '');
    } else {
      // 没备案号就老实说没备案，不编一个
      el.textContent = "ICP 备案办理中";
    }
  }

  /* ================================================================ 启动 */
  function boot() {
    var w = pickWifi();
    if (!w) {
      document.body.innerHTML = '<p style="padding:40px;text-align:center;color:#475467">' +
        '缺少 WiFi 配置，请检查 <b>assets/config.js</b> 里的 wifiList。</p>';
      return;
    }

    var adCfg = CFG.ad || {};
    var adWanted = adCfg.enabled !== false;
    var already = false;
    try { already = sessionStorage.getItem('wifi_ad_done') === '1'; } catch (e) {}

    var needAd = adWanted && !DEBUG && !(already && adCfg.showAgainOnReload === false);

    if (needAd) {
      Ad.start(function () { showWifi(w); });
      // 广告位点击上报（联盟代码里的 <a> 点击会冒泡上来）
      $('ad-slot').addEventListener('click', function () { track('ad_click'); });
    } else {
      $('screen-ad').hidden = true;
      $('screen-wifi').hidden = false;
      paintWifi(w);
      // wait a tick so the layout is ready before drawing the QR
      setTimeout(function () {}, 0);
    }

    bindEvents();
    bindAdMessages();
    paintSiteFooter();
    track('pageview', { ad: needAd ? 1 : 0 });
  }

  function bindEvents() {
    // 广告：手动跳过 / 看完进入
    $('ad-skip').addEventListener('click', function () {
      if (this.hidden || this.disabled) return;
      Ad.finish('skipped');
    });

    // 密码显示/隐藏
    $('btn-eye').addEventListener('click', function () {
      var el = $('wifi-pwd');
      var on = this.classList.toggle('is-on');
      el.textContent = on ? el.dataset.real : '••••••••';
    });

    $('btn-connect').addEventListener('click', openSheet);
    $('sheet-x').addEventListener('click', closeSheet);
    $('sheet-mask').addEventListener('click', function (e) {
      if (e.target === this) closeSheet();
    });

    // 打开 WiFi 设置（真实 <a>，靠用户手势触发；两个平台都试）
    // href 由 setupSettingsButton() 根据平台设置 ——
    // 旧实现在这里用 JS 造 a 再 click()，那是合成点击，不携带 user activation，
    // Chrome 会直接拦掉，所以必须让 HTML 里那个 <a> 自己跳。

    // 复制密码
    $('btn-copy').addEventListener('click', function () {
      if (!state.wifi) return;
      copyText(state.wifi.password).then(function (ok) {
        track('copy_pwd', { auto: false, ok: ok });
        $('sheet-sub').innerHTML = ok
          ? '✅ 密码 <b class="mono">' + htmlEsc(state.wifi.password) + '</b> 已复制到剪贴板'
          : '请长按下面的密码手动复制';
        toast(ok ? '密码已复制 ✓' : '复制失败，请长按密码手动选择', ok ? 1900 : 2600);
      });
    });

    // 保存二维码
    $('btn-qr-save').addEventListener('click', function () {
      if (!qrDataUrl) return;
      var a = document.createElement('a');
      a.href = qrDataUrl;
      a.download = 'wifi-' + (state.wifi ? state.wifi.ssid : 'qr') + '.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast('已保存。若没反应，请长按二维码图片 → 存储到照片');
    });

    // 反馈
    $('btn-ok').addEventListener('click', function () {
      track('feedback_ok');
      closeSheet();

      var b = CFG.behavior || {};
      var next = (b.afterConnect || '').trim();

      // 没配就不跳，保持原行为（有些店不想把顾客带走）
      if (!next) {
        toast('祝你上网愉快 🎉');
        return;
      }

      var delay = typeof b.afterConnectDelay === 'number' ? b.afterConnectDelay : 900;
      toast(b.afterConnectTip || '✅ 已连上，正在跳转…', delay + 700);

      // 留一点时间让顾客看到反馈再切页，否则刚点完就白屏，
      // 会让人以为页面崩了
      setTimeout(function () {
        track('after_connect_redirect', { to: next });
        location.href = next;
      }, delay);
    });
    $('btn-retry').addEventListener('click', function () {
      track('feedback_fail');
      if (state.wifi && qrDataUrl) {
        qrDataUrl = renderQr($('wifi-qr'), wifiQrText(state.wifi), 1024);
      }
      toast('已刷新二维码，用相机重新扫一次试试');
    });
  }

  /* ==================================================== 可选：远端配置覆盖 */
  function loadRemote() {
    var r = CFG.remote || {};
    if (!r.url) return Promise.resolve();
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(); } }, r.timeoutMs || 3000);
      fetch(r.url, { credentials: 'omit' })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data && Array.isArray(data.wifiList) && data.wifiList.length) {
            CFG.wifiList = data.wifiList;
          }
          if (data && data.ad) {
            CFG.ad = Object.assign({}, CFG.ad, data.ad);
          }
        })
        .catch(function () { /* 远端不可用就用本地配置兜底 */ })
        .then(function () { if (!done) { done = true; clearTimeout(timer); resolve(); } });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { loadRemote().then(boot); });
  } else {
    loadRemote().then(boot);
  }
})();
