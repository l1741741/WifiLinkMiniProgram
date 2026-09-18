/* ==========================================================================
 * 小程序全局逻辑
 * ========================================================================== */
const config = require('./config.js');

/* ==========================================================================
 * base64url 与 UTF-8 解码
 * --------------------------------------------------------------------------
 * 为什么要自己写：小程序里没有 Buffer，也不能指望有 atob
 * （不同基础库/端上不一定提供）。用到的字符集是 base64url
 * （A-Z a-z 0-9 - _），它完全落在微信 scene 允许的字符集内。
 *
 * 不依赖 padding：拼码端可能带 `=` 也可能不带，两种都要能解。
 * ========================================================================== */
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url → Uint8Array。非法输入返回 null */
function b64urlDecode(str) {
  const s = String(str).replace(/=+$/, '');
  if (!s) return new Uint8Array(0);

  const out = [];
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < s.length; i++) {
    const v = B64_CHARS.indexOf(s[i]);
    if (v < 0) return null;              // 出现字母表外的字符
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** UTF-8 字节 → 字符串。非法 UTF-8 返回 null（这正是我们识别乱码的手段） */
function utf8Decode(bytes) {
  let out = '';
  let i = 0;

  while (i < bytes.length) {
    const b = bytes[i];
    let cp;
    let len;

    if (b < 0x80) { cp = b; len = 1; }
    else if ((b & 0xe0) === 0xc0) { cp = b & 0x1f; len = 2; }
    else if ((b & 0xf0) === 0xe0) { cp = b & 0x0f; len = 3; }
    else if ((b & 0xf8) === 0xf0) { cp = b & 0x07; len = 4; }
    else return null;

    if (i + len > bytes.length) return null;

    for (let k = 1; k < len; k++) {
      const c = bytes[i + k];
      if ((c & 0xc0) !== 0x80) return null;   // 续字节格式不对
      cp = (cp << 6) | (c & 0x3f);
    }

    // 过长编码和代理区都是非法 UTF-8
    if (len === 2 && cp < 0x80) return null;
    if (len === 3 && cp < 0x800) return null;
    if (len === 4 && cp < 0x10000) return null;
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;

    out += String.fromCodePoint(cp);
    i += len;
  }

  return out;
}

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

    // ② 内联明文：scene 里有 `~`
    // ③ base64url 编码的 scene（中文 SSID）
    //    注意顺序：先查配置再试解码 ——
    //    门店 id 也是 [A-Za-z0-9_-]，跟 base64url 字符集重叠，
    //    先查配置能最大程度避免把门店 id 当成 base64 解出一堆乱码
    const inline = this.parseInlineWifi(raw);
    if (inline && inline.via === 'scene') return inline;

    if (list.length) {
      const hit = list.find((s) => s.id === raw);
      if (hit) return hit;
    }

    if (inline && inline.via === 'scene-b64') return inline;

    // ④ 门店 id 没命中 → 回退
    if (!list.length) return null;
    return list.find((s) => s.id === cfg.defaultStoreId) || list[0];
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
      // 展示文案也允许随链接传入 ——
      // 这样连“改标题”都不用发版（scene 模式没空间带这些，只有链接模式能）
      title: params.title || '',
      notice: params.notice || '',
      inline: true,
      via: 'qrlink',
    };
  },

  /**
   * 把 scene 解成门店对象。不是 WiFi 格式就返回 null。
   *
   * 两种形式：
   *
   *   ① 明文
   *        ChinaNet-3v9I-5G~88888888
   *      条件：SSID 和密码都是 ASCII，且总长 ≤ 32
   *
   *   ② base64url 编码（用于中文 SSID）
   *        5ZKW5ZWh5Y6FV2lGaX5hYmMxMjM0NQ
   *      为什么可以用：微信 scene 允许的字符集里已经包含 A-Z a-z 0-9 - _，
   *      而这正好是 base64url 的字母表 —— 所以编码后**不需要 `%`**，完全合规。
   *
   *      代价：base64 会膨胀 33%，所以只能装得下约 23 字节原始数据
   *      （中文 3 字节/字 → 大约 4~5 个中文字 + 8 位密码）。
   *
   * 怎么区分明文和编码：**看有没有 `~`**。
   * base64url 字母表不含 `~`，所以编码后的串里一定没有它。
   * 为了万无一失，调用方会先试门店 id 查询，查不到才走解码（见 resolveStore）。
   */
  parseInlineWifi(raw) {
    if (!raw || raw.length > 32) return null;

    // ① 明文形式：有 `~`
    const sep = raw.indexOf('~');
    if (sep > 0) {
      const ssid = raw.slice(0, sep).trim();
      // 只按第一个 `~` 切，所以密码里带 `~` 也能完整拿到
      const password = raw.slice(sep + 1);
      if (!ssid) return null;
      return { id: '', name: '', ssid, password, inline: true, via: 'scene' };
    }

    // ② base64url 形式
    return this.parseBase64Wifi(raw);
  },

  /**
   * 解 base64url 编码的 scene。
   *
   * 校验从紧：编码后的随机字节很容易碰巧解出垃圾，而垃圾会让顾客
   * 去连一个不存在的网络。所以必须同时满足三个条件才算数：
   *   1. 是合法的 base64（长度、字符集）
   *   2. 能成功 UTF-8 解码
   *   3. 解出来的内容里确实有一个 `~`，且前面的 SSID 不为空、没有控制字符
   */
  parseBase64Wifi(raw) {
    // base64 长度必须是 4 的倍数（或去掉 padding 后余 2/3）
    const noPad = raw.replace(/=+$/, '');
    if (noPad.length % 4 === 1) return null;
    if (!/^[A-Za-z0-9_-]+$/.test(noPad)) return null;

    const bytes = b64urlDecode(noPad);
    if (!bytes || !bytes.length) return null;

    const text = utf8Decode(bytes);
    if (text === null) return null;

    const sep = text.indexOf('~');
    if (sep <= 0) return null;

    const ssid = text.slice(0, sep).trim();
    const password = text.slice(sep + 1);
    if (!ssid) return null;

    // 控制字符（含 0x00-0x1F）说明这就是一段乱码，不是真的 WiFi 名
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(ssid)) return null;

    return { id: '', name: '', ssid, password, inline: true, via: 'scene-b64' };
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
