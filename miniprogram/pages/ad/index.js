const config = require('../../config.js');

/* ==========================================================================
 * 广告页
 * --------------------------------------------------------------------------
 * 两种模式：
 *   配了 adUnitId → 拉起微信激励视频广告
 *   没配 / 加载失败 → 倒计时兜底（流程照样跑通，只是暂时没收入）
 *
 * 为什么必须做倒计时兜底：流量主要累计 UV ≥ 1000 才能开通，
 * 开通之前小程序也得能用 —— 否则你连攒 UV 的机会都没有。
 * ========================================================================== */
Page({
  data: {
    left: 0,          // 剩余秒数
    total: 0,         // 总秒数
    canSkip: false,   // 「跳过」是否可点
    realAd: false,    // 是否在放真广告
    adFailed: false,  // 广告加载失败（给个更明确的文案）
  },

  onLoad(options) {
    // 记住进入时的原始参数（扫普通链接二维码会带 q，扫小程序码会带 scene），
    // 存在 globalData 而不是拼进 URL —— 见 app.js 里的说明
    this.entryOptions = options || {};
    const app = getApp();
    if (app && app.globalData) app.globalData.entry = this.entryOptions;

    this.ad = null;
    this.timer = null;
    this.startedAt = 0;
    this.finished = false;

    const ad = config.ad || {};
    this.total = Math.max(1, parseInt(ad.minSeconds, 10) || 5);
    this.skipAfter = typeof ad.skipAfterSeconds === 'number' ? ad.skipAfterSeconds : -1;

    if (this.skipAfter >= this.total) this.skipAfter = -1;

    this.setData({ total: this.total, left: this.total });
  },

  onReady() {
    this.begin();
  },

  onUnload() {
    this.stopTimer();
  },

  /* ------------------------------------------------------------ 开始 */
  begin() {
    const ad = config.ad || {};

    if (ad.enabled === false) {
      this.finish('ad_disabled');
      return;
    }

    // 有真广告位 → 拉激励视频
    if (ad.adUnitId && typeof wx.createRewardedVideoAd === 'function') {
      this.startRealAd(ad.adUnitId);
      return;
    }

    /*
     * 没配广告位（多半是还没开通流量主）。
     *
     * 默认直接放行 —— 没广告还让顾客等几秒，是拿真实转化率
     * 换一个没有任何收益的假动画。
     * 只有 placeholderWhenNoAd 显式打开时才走倒计时。
     */
    if (!ad.placeholderWhenNoAd) {
      this.finish('no_ad_configured');
      return;
    }

    this.startCountdown();
  },

  /* ------------------------------------------ 模式一：微信激励视频广告 */
  startRealAd(adUnitId) {
    const self = this;

    try {
      // 同一个 adUnitId 返回的是单例，重复调用拿到的是同一个对象
      this.ad = wx.createRewardedVideoAd({ adUnitId });

      this.ad.onError((err) => {
        console.warn('[WiFi] 激励视频出错', err);
        self.onAdError();
      });

      this.ad.onClose((res) => {
        // isEnded === true 表示完整看完；false 表示中途关掉
        if (res && res.isEnded) {
          self.finish('ad_watched');
        } else {
          self.onAdSkippedEarly();
        }
      });

      this.setData({ realAd: true });
      this.ad.show().catch(() => {
        // 首次 show 失败通常是还没加载好，load 一次再试
        return self.ad.load().then(() => self.ad.show());
      }).catch(() => {
        self.onAdError();
      });
    } catch (e) {
      console.warn('[WiFi] 创建激励视频失败', e);
      this.onAdError();
    }
  },

  onAdError() {
    this.setData({ realAd: false, adFailed: true });
    if ((config.ad || {}).unlockOnError !== false) {
      // 广告挂了直接放行 —— 不能因为广告把顾客挡在门外
      this.startCountdown();
    }
  },
  onAdSkippedEarly() {
    // 激励视频没看完：继续走倒计时，看满总时长才放行
    this.startCountdown();
  },

  /* ------------------------------------------------ 模式二：倒计时兜底 */
  startCountdown() {
    if (this.timer || this.finished) return;

    this.startedAt = Date.now();
    this.setData({ realAd: false });

    const self = this;
    this.timer = setInterval(() => self.tick(), 200);
    this.tick();
  },

  tick() {
    if (this.finished) return;

    const elapsed = (Date.now() - this.startedAt) / 1000;
    const left = this.total - elapsed;

    if (left <= 0) {
      this.finish('countdown_done');
      return;
    }

    const next = {
      left: Math.ceil(left),
    };

    if (this.skipAfter >= 0 && elapsed >= this.skipAfter) {
      next.canSkip = true;
    }

    this.setData(next);
  },

  stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },

  /* ------------------------------------------------------------ 结束 */
  onSkip() {
    if (!this.data.canSkip) return;
    this.finish('skipped');
  },

  finish(reason) {
    if (this.finished) return;
    this.finished = true;
    this.stopTimer();

    console.log('[WiFi] 广告阶段结束:', reason);

    /*
     * 把门店参数透传到 WiFi 页。
     * 两个来源都要带，缺一个就会出现“扫了 A 店的码却拿到默认店的 WiFi”：
     *   scene —— 扫小程序码进来的原始参数
     *   id    —— 上一层已经解析过的门店 id
     */
    const o = this.entryOptions || {};
    const qs = [];
    if (o.scene) qs.push('scene=' + encodeURIComponent(o.scene));
    if (o.id) qs.push('id=' + encodeURIComponent(o.id));

    // 用 redirectTo 而不是 navigateTo：广告页不应该留在返回栈里，
    // 否则顾客在 WiFi 页按返回会又回到广告页
    wx.redirectTo({
      url: '/pages/wifi/index' + (qs.length ? '?' + qs.join('&') : ''),
      fail: (e) => console.error('[WiFi] 跳转 WiFi 页失败', e),
    });
  },
});
