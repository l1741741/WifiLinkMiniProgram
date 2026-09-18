const config = require('../../config.js');
const app = getApp();

/* ==========================================================================
 * WiFi 信息页
 * --------------------------------------------------------------------------
 * 两个平台走的路完全不一样，这是整个小程序最关键的一段逻辑：
 *
 *   iOS      → wx.connectWifi 真·直连（iOS 没有安卓那个「只对本小程序生效」的限制）
 *
 *   Android  → 微信 7.0.22+ 在 Android 10 及以上，
 *              connectWifi 连上的 WiFi 只有小程序自己能用，其他 App 上不了网。
 *              想系统级生效只能 maunal:true 跳系统设置页 —— 原生跳转不会被拦，
 *              但用户仍需手动点网络、手动粘贴密码。
 *
 *   兜底     → 复制密码 + 给步骤。任何机型都有这条路。
 *
 * 注意几个坑（都有官方文档依据）：
 *   · 参数名就是拼错的 `maunal`（不是 manual），别“纠正”它，改了会静默失效
 *   · iOS 底层不提供「密码错误导致连接失败」的事件，只能靠 onWifiConnected
 *     或 getConnectedWifi 超时判断
 *   · 系统已连上目标 WiFi 时再次连接，永远返回成功且不触发 onWifiConnected
 *     —— 所以不能只靠事件，必须补一次 getConnectedWifi 实际核对
 * ========================================================================== */
Page({
  data: {
    ssid: '',
    password: '',
    pwdShown: false,
    title: '免费 WiFi',
    notice: '',
    storeName: '',
    showStoreName: false,
    autoCopyHint: '',

    platform: 'unknown',
    isIOS: false,
    isAndroid: false,

    status: 'idle',        // idle | working | connected | failed
    statusText: '',
    btnText: '一键连接 WiFi',
    canRetry: false,
  },

  onLoad(options) {
    /*
     * 合并两个来源的进入参数：
     *   app.globalData.entry —— 进入小程序时的原始参数（扫普通链接二维码的 q、
     *                          扫小程序码的 scene）
     *   options              —— 本页自己的参数（从广告页跳过来时带的）
     * URL 参数优先级更高，因为它离用户更近。
     */
    const entry = Object.assign(
      {},
      (app && app.globalData && app.globalData.entry) || {},
      options || {}
    );

    const store = (app.resolveStore && app.resolveStore(entry)) || null;

    if (!store) {
      wx.showModal({
        title: '配置有误',
        content: 'config.js 里的 stores 是空的，至少配一家门店',
        showCancel: false,
      });
      return;
    }

    this.store = store;

    const platform = (app && app.globalData && app.globalData.platform) || 'unknown';
    this.setData({
      ssid: store.ssid || '',
      password: store.password || '',
      // 门店链接可以带标题/提示语，带了就用码里的 —— 改文案也不用发版
      title: store.title || config.title || '免费 WiFi',
      notice: store.notice || config.notice || '',
      // 显示当前是哪家店：多门店场景下必须让顾客知道自己连的是哪家
      storeName: store.name || '',
      showStoreName: !!(store.name && store.name !== '本店'),
      platform,
      isIOS: platform === 'ios',
      isAndroid: platform === 'android',
      btnText: platform === 'android' ? '复制密码并打开设置' : '一键连接 WiFi',
    });

    this.connected = false;
    this.pollTimer = null;

    // 小程序被切到后台再回来（安卓跳设置页就属于这种情况）时重新核对
    this.onShowHandler = () => this.verifyConnected().then((ok) => {
      if (ok && !this.connected) this.markConnected();
    });

    /*
     * 不在页面加载时自动复制密码。
     *
     * 两个原因：
     * 1. 冗余 —— 点「一键连接」时本来就会复制（见 onConnect），
     *    页面加载时再复制一次是白做。
     * 2. 更关键：wx.setClipboardData 属于微信的**隐私接口**，
     *    未同步隐私协议时会触发隐私授权弹窗。
     *    在页面刚打开、用户还没做任何操作时弹“申请使用你的剪贴板”，
     *    时机很突然，容易被直接拒掉 —— 而拒绝了后续 10 秒内的调用都会直接失败。
     *    改到用户主动点按钮时再触发，弹窗就有上下文了。
     */
    this.setData({
      autoCopyHint: (config.connect && config.connect.autoCopy) ? '点下方按钮会自动复制密码' : '',
    });
  },

  onShow() {
    if (this.onShowHandler) this.onShowHandler();
  },

  onUnload() {
    this.stopPolling();
  },

  /* -------------------------------------------------------- 密码显示 */
  togglePwd() {
    this.setData({ pwdShown: !this.data.pwdShown });
  },

  /*
   * 复制密码。
   *
   * 注意 wx.setClipboardData 自己会弹一个系统提示（“内容已复制”），
   * 所以这里不要再补一层 toast —— 两次提示叠在一起很难看。
   *
   * 另外：这个函数一定不能带参数。
   * WXML 里 bindtap="copyPassword" 会把事件对象当第一个参数传进来，
   * 如果签名是 copyPassword(silent)，它就永远拿到一个真值，分支会静默走错。
   */
  copyPassword() {
    const pwd = this.data.password;
    if (!pwd) return;
    wx.setClipboardData({ data: pwd });
  },

  /* ============================================================ 连接 */
  onConnect() {
    if (this.data.status === 'working') return;

    this.setData({ status: 'working', canRetry: false });

    /*
     * 先把密码放进剪贴板：
     *   安卓跳设置页后用户要粘贴，iOS 失败时也能手动连
     *
     * 放在用户主动点按钮之后，而不是页面加载时 ——
     * wx.setClipboardData 是隐私接口，会触发隐私授权弹窗，
     * 在用户还没做任何操作时就弹“申请使用你的剪贴板”时机太突然，容易被拒；
     * 拒了之后 10 秒内再调都直接失败。
     */
    if (!config.connect || config.connect.autoCopy !== false) {
      this.copyPassword();
    }

    if (!this.data.isIOS && !this.data.isAndroid) {
      // 开发者工具或未知平台：没法调 WiFi 接口，直接给手动路径
      this.failManual('当前环境无法自动连接，请到系统 WiFi 设置里手动连接');
      return;
    }

    this.startWifi()
      .then(() => this.ensureLocationPermission())
      .then(() => this.doConnect())
      .catch((err) => {
        console.warn('[WiFi] 连接流程中断', err);
        this.failManual(this.explainError(err));
      });
  },

  /* 初始化 WiFi 模块 */
  startWifi() {
    return new Promise((resolve, reject) => {
      wx.startWifi({
        success: () => resolve(),
        fail: (err) => reject(err),
      });
    });
  },

  /* 安卓 6.0+ 把「扫描/连接 WiFi」归为位置信息，必须先拿位置权限 */
  ensureLocationPermission() {
    if (!this.data.isAndroid) return Promise.resolve();

    return new Promise((resolve) => {
      wx.getSetting({
        success: (res) => {
          const granted = res.authSetting && res.authSetting['scope.userLocation'];
          if (granted) return resolve();

          wx.authorize({
            scope: 'scope.userLocation',
            success: () => resolve(),
            // 用户拒绝也放行 —— 让 connectWifi 自己去报错，
            // 这样错误信息比你在这里编的更准确
            fail: () => resolve(),
          });
        },
        fail: () => resolve(),
      });
    });
  },

  /* 真正的连接调用 */
  doConnect() {
    const { ssid, password, isAndroid } = this.data;

    return new Promise((resolve, reject) => {
      wx.connectWifi({
        SSID: ssid,
        password,
        // ★ 参数名就是拼错的 maunal，不是 manual
        //   安卓上让系统设置页出马（小程序连的只对自己有效，必须跳出去）
        //   iOS 上不传这个参数，走真直连
        maunal: isAndroid ? true : false,

        success: () => {
          if (isAndroid) {
            // 安卓跳了设置页，连接结果只能等用户回来后再核对
            this.setData({
              status: 'working',
              statusText: '已打开系统设置页，找到本店 WiFi 粘贴密码即可',
              btnText: '我连好了，检查一下',
              canRetry: true,
            });
            return resolve({ pending: true });
          }

          // iOS：success 只代表「请求被接受」，不代表真连上了
          this.setData({ statusText: '正在连接…' });
          this.watchForConnect().then(resolve);
        },

        fail: (err) => {
          console.warn('[WiFi] connectWifi fail', err);
          reject(err);
        },
      });
    });
  },

  /**
   * iOS 的结果判定。
   *
   * 文档说得很清楚：iOS 不提供「密码错误导致连接失败」的事件，
   * 所以只能等 onWifiConnected，超时就认为没连上。
   * 但还有一条：系统已经连着目标 WiFi 时再次连接，永远成功且不发事件 ——
   * 所以超时后不能直接判失败，必须再用 getConnectedWifi 实际核对一次。
   */
  watchForConnect(timeoutMs = 12000) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (result) => {
        if (settled) return;
        settled = true;
        wx.offWifiConnected && this.onWifiCb && wx.offWifiConnected(this.onWifiCb);
        clearTimeout(timer);
        resolve(result);
      };

      this.onWifiCb = () => {
        this.markConnected();
        done({ ok: true });
      };
      wx.onWifiConnected(this.onWifiCb);

      const timer = setTimeout(() => {
        // 超时 → 用实际状态兜底核对
        this.verifyConnected().then((ok) => {
          if (ok) {
            this.markConnected();
            done({ ok: true });
          } else {
            // 提示里一定要带上网络名 —— 顾客在设置页里要找的就是这个名字，
            // 只说“没连上”等于没说
            this.failManual('没连上「' + this.data.ssid + '」。可能是密码不对，或手机不在信号范围内');
            done({ ok: false });
          }
        });
      }, timeoutMs);
    });
  },

  /*
   * 打开服务说明页。
   * 审核方会看小程序里有没有说清自己是干什么的，
   * 所以入口放在显眼但不打扰的位置（WiFi 页底部）。
   */
  openAbout() {
    wx.navigateTo({
      url: '/pages/about/index',
      fail: (e) => console.error('[WiFi] 打开服务说明失败', e),
    });
  },

  /* 当前到底连着哪个 WiFi */
  verifyConnected() {
    return new Promise((resolve) => {
      const target = String(this.data.ssid || '').replace(/^"|"$/g, '');
      if (!target) return resolve(false);

      wx.getConnectedWifi({
        success: (res) => {
          const cur = String((res.wifi && res.wifi.SSID) || '').replace(/^"|"$/g, '');
          resolve(cur === target);
        },
        fail: () => resolve(false),
      });
    });
  },

  /* 顾客点了「我连好了，检查一下」 */
  checkAgain() {
    this.setData({ status: 'working', statusText: '正在检查…' });
    this.verifyConnected().then((ok) => {
      if (ok) {
        this.markConnected();
      } else {
        this.failManual('还没检测到已连接。请在系统设置里找到「' + this.data.ssid + '」并粘贴密码');
      }
    });
  },

  /* ------------------------------------------------------------ 结果 */
  markConnected() {
    this.connected = true;
    this.setData({
      status: 'connected',
      statusText: '已连上 ' + this.data.ssid,
      btnText: '已连接 ✓',
      canRetry: false,
      pwdShown: false,
    });
    wx.showToast({ title: '连接成功', icon: 'success' });

    // 给顾客一秒看提示，再走「连上后」的动作
    setTimeout(() => this.afterConnect(), 900);
  },

  failManual(msg) {
    this.setData({
      status: 'failed',
      statusText: msg,
      canRetry: true,
    });
  },

  /* 把错误码翻译成人话 —— 原始 errMsg 顾客根本看不懂 */
  explainError(err) {
    const code = err && (err.errCode || err.errno);
    const map = {
      12000: 'WiFi 模块没初始化成功，请重试一次',
      12001: '这台手机的系统不支持，请到 WiFi 设置里手动连接',
      12002: '密码不对，请到收银台确认一下',
      12003: '连接超时了，可能是信号太弱或密码不对',
      12004: '正在连接中，请稍等一下',
      12005: '手机 WiFi 开关没打开，请先打开 WiFi',
      12006: '需要打开「定位」开关（安卓系统要求）',
      12007: '你拒绝了授权，请允许后重试',
      12008: 'WiFi 名称无效，请到收银台确认',
      12009: '手机的运营商配置拒绝了连接，请到设置里手动连',
      12011: '小程序在后台无法配置 WiFi，请回到小程序页面重试',
      12013: '系统里保存的旧 WiFi 记录过期了，请先「忘记」再重连',
      12014: '密码格式不对，请到收银台确认',
    };
    return map[code] || '连接没成功，请到系统 WiFi 设置里手动连接';
  },

  /* ==================================================== 连上之后的动作 */
  afterConnect() {
    const cfg = config.afterConnect || {};

    if (cfg.webviewUrl) {
      wx.navigateTo({ url: '/pages/webview/index?url=' + encodeURIComponent(cfg.webviewUrl) });
      return;
    }

    if (cfg.miniProgram && cfg.miniProgram.appId) {
      wx.navigateToMiniProgram({
        appId: cfg.miniProgram.appId,
        path: cfg.miniProgram.path || '',
        fail: () => wx.showToast({ title: cfg.tip || '已连接', icon: 'none' }),
      });
      return;
    }

    if (cfg.customerService) {
      wx.showToast({ title: '已连上，点下方按钮联系我们', icon: 'none' });
      return;
    }

    wx.showToast({ title: cfg.tip || '已连上 WiFi', icon: 'none', duration: 2200 });
  },

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  },
});
