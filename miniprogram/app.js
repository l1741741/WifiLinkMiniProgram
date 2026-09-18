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
   * 根据进入小程序的参数选出门店。
   *
   * 参数有两个来源，优先级从高到低：
   *   options.id     页面间跳转自己带的（广告页 → WiFi 页）
   *   options.scene  扫小程序码时微信带进来的
   *
   * 坑：scene 是 URL 编码的，必须 decodeURIComponent，
   * 否则带中文或特殊字符的 id 永远匹配不上。
   *
   * 匹配不上就回退到 defaultStoreId，再回退到第一家 ——
   * 宁可多给一家店的 WiFi，也不能因为参数错了就给用户白屏。
   */
  resolveStore(options) {
    const cfg = this.globalData.config || {};
    const list = cfg.stores || [];
    if (!list.length) return null;

    const opt = options || {};
    let wanted = opt.id ? String(opt.id) : '';

    if (!wanted && opt.scene) {
      try {
        wanted = decodeURIComponent(String(opt.scene));
      } catch (e) {
        // 编码坏了就用原始值碰碰运气，总比直接放弃强
        wanted = String(opt.scene);
      }
    }
    wanted = wanted.trim();

    return list.find((s) => s.id === wanted)
        || list.find((s) => s.id === cfg.defaultStoreId)
        || list[0];
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
