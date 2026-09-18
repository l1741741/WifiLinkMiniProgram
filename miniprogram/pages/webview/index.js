/* ==========================================================================
 * 网页容器页 —— 用于「连上 WiFi 之后跳到哪里」
 * --------------------------------------------------------------------------
 * ⚠️ 用这个页面前必须先做一件事：
 *   微信公众平台 → 开发管理 → 开发设置 → 业务域名 → 添加你要打开的域名
 *   需要把微信给的校验文件放到那个域名的根目录下。
 *   没配置业务域名的话，web-view 会直接报错打不开。
 *
 * 典型用途：连上后跳商家的领券页 / 公众号文章 / 美团店铺页。
 * ========================================================================== */
Page({
  data: {
    url: '',
  },

  onLoad(query) {
    const url = query && query.url ? decodeURIComponent(query.url) : '';

    /*
     * 没配地址就默默退回，不弹错误框。
     *
     * 本页只能由 afterConnect.webviewUrl 主动跳进来，正常情况下不会缺参数；
     * 但万一配了没备案的域名、或者被审核员翻到这个页面，
     * 弹一个“链接配置有误”会让人以为小程序坏了。默默退回去更干净。
     */
    if (!url) {
      wx.navigateBack({ fail: () => {} });
      return;
    }

    if (!/^https:\/\//i.test(url)) {
      // web-view 只接受 https，http 会被静默拒绝 —— 与其白屏不如说清楚
      wx.showModal({
        title: '链接配置有误',
        content: '跳转地址必须是 https 开头，请检查 config.js 里的 afterConnect.webviewUrl',
        showCancel: false,
        success: () => wx.navigateBack(),
      });
      return;
    }

    this.setData({ url });
  },

  onError(e) {
    console.error('[webview] 加载失败，多半是业务域名没配置', e);
    wx.showModal({
      title: '网页打不开',
      content: '请确认该域名已在小程序后台配置为「业务域名」',
      showCancel: false,
    });
  },
});
