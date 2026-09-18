/* ==========================================================================
 * 小程序全局逻辑
 * ========================================================================== */
const config = require('./config.js');

App({
  globalData: {
    config,
    platform: 'unknown',   // 'ios' | 'android' | 'devtools' | 'other'
    adDone: false,         // 广告是否已完成，避免返回时重复看

    /*
     * 进入小程序时的原始参数，原封不动存一份。
     *
     * 为什么不用 URL 参数在页面间传：扫普通链接二维码进来时
     * options.q 是一整条 URL（已经编码过一次），再拼到 navigateTo 的
     * query 里会变成双重编码，还得依赖框架解一次——很容易搞乱。
     * 放这里页面直接读，不经过任何编解码。
     */
    entry: null,
  },

  onLaunch() {
    this.globalData.platform = this.detectPlatform();
    console.log('[WiFi] 运行平台:', this.globalData.platform);
  },

  /**
   * 从进入参数里解析门店。支持三种入码方式，互相不冲突，按优先级：
   *
   *   ① 普通链接二维码（门店用草料等工具自助生成，推荐）
   *        二维码内容： https://你的域名/w/?ssid=咖啡厅WiFi&pwd=abc123&name=悦荟城店
   *      微信扫到后，链接以参数 `q` 传进来（官方文档）。
   *      好处：门店完全自助 —— 不改代码、不发版、不找你；
   *            参数几乎无长度限制，**支持中文**。
   *      前提：小程序后台配好「扫普通链接二维码打开小程序」规则
   *            （需企业主体 + 已备案域名 + 上传校验文件）。
   *
   *   ② 小程序码 + scene 内联（当前已能用）
   *        scene = ChinaNet-3v9I-5G~88888888
   *      好处：不需要域名。
   *      限制：scene 上限 32 字符、不支持中文。
   *
   *   ③ 小程序码 + 门店 id
   *        scene = shop2，WiFi 信息在 config.js
   *      好处：中文和长信息都行。代价：改密码要重新发版。
   *
   * 三种可以同时开着，互不干扰。
   */
  resolveStore(options) {
    const cfg = this.globalData.config || {};
    const list = cfg.stores || [];
    const opt = options || {};

    // ① 扫普通链接二维码进来
    const viaLink = this.parseQrLink(opt.q);
    if (viaLink) return viaLink;

    /*
     * 取原始参数。
     * scene 官方不支持 `%`，所以本来就不存在 URL 编码；
     * decodeURIComponent 在这里其实是空操作，但保留它能兼容
     * 自己手动传参、或以后微信放宽限制的情况。编码坏了就退回原值。
     */
    let raw = '';
    if (opt.id) {
      raw = String(opt.id);
    } else if (opt.scene) {
      try {
        raw = decodeURIComponent(String(opt.scene));
      } catch (e) {
        raw = String(opt.scene);
      }
    }
    raw = raw.trim();

    // ② 内联模式：scene 里直接带了 SSID~密码
    const inline = this.parseInlineWifi(raw);
    if (inline) return inline;

    // ③ 门店 id 模式：按 id 查配置
    if (!list.length) return null;
    return list.find((s) => s.id === raw)
        || list.find((s) => s.id === cfg.defaultStoreId)
        || list[0];
  },

  /**
   * 解析「扫普通链接二维码」带进来的完整链接。
   *
   * 官方文档：二维码链接内容会以参数 `q` 的形式带给页面，
   * 需自行 decodeURIComponent **一次**。
   *
   * 支持的门店链接形式（参数名做了兼容）：
   *   https://域名/w/?ssid=XXX&pwd=YYY
   *   https://域名/w/?ssid=XXX&password=YYY&name=店名
   *   https://域名/w/?s=XXX&p=YYY
   *
   * 返回 null 表示这不是一条门店链接（可能是别的规则、或参数不全）。
   */
  parseQrLink(q) {
    if (!q) return null;

    // ① 官方要求：自行 decodeURIComponent 一次
    let full = String(q);
    try {
      full = decodeURIComponent(full);
    } catch (e) {
      // 编码坏了就用原值，可能依然能解析出参数
    }

    const qi = full.indexOf('?');
    if (qi < 0) return null;

    const params = {};
    for (const pair of full.slice(qi + 1).split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const key = (eq < 0 ? pair : pair.slice(0, eq)).trim().toLowerCase();
      let val = eq < 0 ? '' : pair.slice(eq + 1);
      // 值可能再次被编码过（比如中文 SSID），能解就解，解不了用原值
      try {
        val = decodeURIComponent(val.replace(/\+/g, ' '));
      } catch (e) {
        val = val.replace(/\+/g, ' ');
      }
      if (key) params[key] = val;
    }

    // 参数名做兼容：怎么拼都能用
    const ssid = params.ssid || params.s || '';
    const password = params.pwd || params.password || params.p || '';

    // 没有 SSID 就不算门店链接 —— 宁可回退到默认店，
    // 也不能拿一条半截的参数去骗顾客连一个不存在的网络
    if (!ssid) return null;

    return {
      id: '',
      name: params.name || params.n || '',
      ssid,
      password,
      inline: true,
      via: 'qrlink',
    };
  },

  /**
   * 把 `SSID~PASSWORD` 解成门店对象。不是这个格式就返回 null。
   *
   * 校验从紧：SSID 为空、或场景长度超过 32 都当作不是内联模式，
   * 交给 id 查询去处理 —— 总比解析出一个半截的 WiFi 名让顾客连不上强。
   */
  parseInlineWifi(raw) {
    if (!raw || raw.length > 32) return null;

    const sep = raw.indexOf('~');
    // sep <= 0 涵盖两种情况：没有 `~`，或者 `~` 开头（SSID 为空）
    if (sep <= 0) return null;

    const ssid = raw.slice(0, sep).trim();
    // 只按第一个 `~` 切，所以密码里带 `~` 也能完整拿到
    const password = raw.slice(sep + 1);

    if (!ssid) return null;

    return {
      id: '',
      name: '',        // 内联模式带不了中文店名，页面只显示 SSID
      ssid,
      password,
      inline: true,
    };
  },

  /**
   * 平台判定。
   *
   * 这个值直接决定「一键连接」用哪条路径：
   *   iOS     → connectWifi 真直连
   *   Android → connectWifi + maunal:true 跳系统设置页
   *
   * 优先用 wx.getDeviceInfo（新接口），拿不到再退回 getSystemInfoSync ——
   * 老接口虽然还能用但已标注废弃，新老都兼容才不会在某天突然坏掉。
   */
  detectPlatform() {
    let raw = '';
    try {
      if (typeof wx.getDeviceInfo === 'function') {
        raw = wx.getDeviceInfo().platform || '';
      } else {
        raw = wx.getSystemInfoSync().platform || '';
      }
    } catch (e) {
      console.warn('[WiFi] 平台检测失败，按 unknown 处理', e);
    }

    const p = String(raw).toLowerCase();
    if (p === 'ios') return 'ios';
    if (p === 'android') return 'android';
    if (p === 'devtools') return 'devtools';
    return 'other';
  },
});
