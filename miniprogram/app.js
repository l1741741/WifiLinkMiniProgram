/* ==========================================================================
 * 小程序全局逻辑
 * ========================================================================== */
const config = require('./config.js');

App({
  globalData: {
    config,
    platform: 'unknown',   // 'ios' | 'android' | 'devtools' | 'other'
    adDone: false,         // 广告是否已完成，避免返回时重复看
  },

  onLaunch() {
    this.globalData.platform = this.detectPlatform();
    console.log('[WiFi] 运行平台:', this.globalData.platform);
  },

  /**
   * 从进入参数里解析门店。支持两种模式，互相不冲突：
   *
   *   ① 内联模式 —— scene 直接带 WiFi 信息：
   *        scene = ChinaNet-3v9I-5G~88888888
   *      好处：门店自助出码，不用改代码、不用发版。
   *      限制：scene 上限 32 个可见字符，且不支持中文，
   *            所以 SSID+密码 总长必须 ≤ 31，中文 SSID 用不了。
   *
   *   ② 门店 id 模式 —— scene 只带一个短 id，SSID/密码在 config.js 里：
   *        scene = shop2
   *      好处：中文店名随便写，WiFi 信息长一点也没事。
   *      代价：改密码要重新发版。
   *
   * 怎么区分：内联模式里一定有 `~`；store id 的字符集是 [A-Za-z0-9_-]，不含 `~`，
   * 所以两者不会混淆。
   *
   * 分隔符为什么用 `~`：微信 scene 允许的特殊字符是
   *   !#$&'()*+,/:;=?@-._~
   * 其中 `~` 在 SSID 里极少见（`,` `;` `:` 都比它常见）。
   * 而且只按**第一个** `~` 切，所以密码里带 `~` 也没问题。
   */
  resolveStore(options) {
    const cfg = this.globalData.config || {};
    const list = cfg.stores || [];
    const opt = options || {};

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

    // ① 内联模式：scene 里直接带了 SSID~密码
    const inline = this.parseInlineWifi(raw);
    if (inline) return inline;

    // ② 门店 id 模式：按 id 查配置
    if (!list.length) return null;
    return list.find((s) => s.id === raw)
        || list.find((s) => s.id === cfg.defaultStoreId)
        || list[0];
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
