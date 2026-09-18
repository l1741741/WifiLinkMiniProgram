const config = require('../../config.js');

/* ==========================================================================
 * 服务说明页
 * --------------------------------------------------------------------------
 * 为什么专门做这一页：
 *   审核方（微信审核 + 管局备案）会判断「这个小程序是干什么的、谁做的」。
 *   页面里把服务内容、隐私处理、运营主体都写清楚，
 *   比让审核员自己猜要容易过得多。
 *
 *   实测反馈里常见的一条驳回原因是“服务内容不明确”，
 *   有这个页就能直接回应。
 * ========================================================================== */
Page({
  data: {
    operator: '',
    contact: '',
    hasContact: false,
    updatedAt: '',
  },

  onLoad() {
    const op = config.operator || {};

    this.setData({
      operator: op.name || '',
      contact: op.contact || '',
      hasContact: !!(op.contact && op.contact.trim()),
      updatedAt: op.updatedAt || '',
    });
  },

  copyContact() {
    if (!this.data.contact) return;
    wx.setClipboardData({ data: this.data.contact });
  },
});
