/* ==========================================================================
 * 扫码连 WiFi · 全局配置
 * --------------------------------------------------------------------------
 * 上线前你只需要改这一个文件。改完直接上静态托管即可，无需重新构建。
 * ========================================================================== */
window.WIFI_APP_CONFIG = {
  /* ======================================================================
   * 1. WiFi 信息（可配多个，用二维码里的 ?id=xxx 区分不同门店/热点）
   * ==================================================================== */
  defaultWifiId: 'default',

  wifiList: [
    {
      id: 'default',

      // —— 必填：账号信息 ——
      ssid: 'ChinaNet-3v9I-5G',
      password: '88888888',
      security: 'WPA', // WPA | WEP | nopass（开放式网络填 nopass）
      hidden: false, // 隐藏 SSID 填 true

      // —— 选填：展示文案 ——
      title: '免费 WiFi',
      shopName: '', // 例：三楼咖啡厅。留空则不显示
      notice: '连接后请勿进行网银、支付等敏感操作，本网络不采集任何个人信息。',
    },

    // 复制上面整段即可新增第二个热点，例如：
    // {
    //   id: 'shop2',
    //   ssid: 'Another-WiFi',
    //   password: '12345678',
    //   security: 'WPA',
    //   title: '二楼休息区 WiFi',
    // },
  ],

  /* ======================================================================
   * 2. 广告配置
   * ----------------------------------------------------------------------
   * 用户扫码后先看广告，看完才解锁 WiFi 信息页。
   * 接入任意广告联盟的方式：把联盟后台给你的那段 <script>/<ins> 代码
   * 整段粘贴到下面的 html 字段即可，不需要改任何其它代码。
   *   → 百度联盟（百青藤）、Google AdSense、自有直客广告全部适用
   * ==================================================================== */
  ad: {
    enabled: true,

    // 强制观看秒数（倒计时结束才自动进入 WiFi 页）
    minSeconds: 5,

    // 「跳过」按钮多少秒后可点：
    //   2  = 广告播 2 秒后按钮变成可点的「跳过」（当前设置）
    //   0  = 一进广告页就能跳（那 minSeconds 基本就形同虚设了）
    //   -1 = 不提供跳过，必须看满 minSeconds
    // 说明：填的值 ≥ minSeconds 时视为 -1（等得到的时候已经自动进下一屏了，没意义）。
    // 不做限制的话用户会瞬间跳过，曝光量为零，等于白接广告。
    skipAfterSeconds: 2,

    // 刷新页面是否重新看广告。true = 每次刷新都看（曝光多但体验差）
    showAgainOnReload: false,

    // —— 广告内容 ——
    //
    // 【当前填的是「本地商家直客」模板】
    // 适合：把你的广告位直接卖给周边商家（奶茶店、美甲店、健身房…）
    // 优点：不需要备案、不需要联盟审核，改完立即生效
    //
    // 换成真实商家，只需要改下面 4 个地方（都标了 ★）
    //   ① 商家名  ② 促销文案  ③ 跳转链接  ④ 配色
    //
    // 想接广告联盟（百度联盟等），把 html 清空，粘贴联盟给的代码即可。
    html: `
<!-- ==================== 广告素材开始 ==================== -->
<!--
  现在是「不可点击」的卡片形式（因为还没有真实跳转地址）。
  拿到商家的链接后，把下面的 <div class="ad-card"> 换成 <a href="商家链接" ...>
  写法见文件末尾的注释。

  不要写 href="#" + target="_blank" —— 那样用户点一下会弹出一个空白标签页，
  比不能点还糟糕。
-->
<div class="ad-card"
     style="display:block;width:100%;max-width:420px;margin:0 auto;
            font-family:system-ui,-apple-system,'PingFang SC',sans-serif">

  <div style="background:linear-gradient(140deg,#ff7a45,#ff4d4f);
              border-radius:16px;padding:24px 20px;color:#fff;text-align:center">

    <div style="font-size:12px;opacity:.85;letter-spacing:.14em;margin-bottom:12px">
      ★① 商家名 / 本店推荐
    </div>

    <div style="font-size:27px;font-weight:800;line-height:1.3;margin-bottom:10px">
      ★② 新客首单立减 10 元
    </div>

    <div style="font-size:15px;opacity:.92;line-height:1.65">
      凭此页面到收银台出示<br>
      限堂食 · 每人限用一次
    </div>

    <div style="margin-top:18px;background:#fff;color:#ff4d4f;font-weight:700;
                font-size:15px;padding:12px 0;border-radius:10px">
      ★③ 按钮文案（如「立即领取」）
    </div>

  </div>

  <!-- 《广告法》要求广告可识别，这个标识不要删 -->
  <div style="display:flex;align-items:center;justify-content:center;gap:6px;
              margin-top:12px;font-size:11px;color:#7e8ca6">
    <span>广告</span><span>·</span><span>★① 商家名</span>
  </div>

</div>
<!-- ==================== 广告素材结束 ==================== -->
    `,

    // ── 拿到商家的真实链接后，改成可点击版本 ──────────────────────────
    // 把上面整个 <div class="ad-card"> … </div> 换成：
    //
    //   <a href="https://商家的链接" target="_blank" rel="noopener nofollow"
    //      onclick="parent.postMessage({t:'ad_click'},'*')"
    //      style="display:block;width:100%;max-width:420px;margin:0 auto;text-decoration:none">
    //     ……里面内容不变……
    //   </a>
    //
    // 三个属性都不能少：
    //   target="_blank"        —— 不把顾客带离 WiFi 页
    //   rel="noopener nofollow" —— 安全 + 不给外链传权重
    //   onclick=postMessage    —— 点击统计（iframe 里的点击不会冒泡到主页面）
    //
    // ── 想直接用商家的图片海报 ──────────────────────────────────
    // 图片放 public/assets/ads/ 下，然后：
    //
    //   html: `
    //     <a href="https://商家链接" target="_blank" rel="noopener nofollow"
    //        onclick="parent.postMessage({t:'ad_click'},'*')">
    //       <img src="/assets/ads/poster.jpg" alt="广告"
    //            style="width:100%;max-width:420px;border-radius:14px">
    //     </a>`,
    //
    // 图片路径写 /assets/... 根路径最稳（iframe 里已自动注入 <base>，
    // 但根路径不会因为层级变化而出错）。
    // 建议尺寸：宽 840px，体积 200KB 内（顾客用手机流量加载）。
    // 高度同步改下面的 iframeHeight（图片海报一般要 480～560）。

    // 方式 B：外部广告脚本地址（会自动包成 <script src>）
    scriptUrl: '',

    // 广告执行环境：
    //   'iframe' —— 【推荐】在沙箱 iframe 里跑，广告代码怎么写都搞不坏页面
    //   'inline' —— 在页面里直接跑，联盟要求读页面上下文（referrer / 埋点）时才用
    // 坑：联盟代码普遍用 document.write，页面加载完再调它会清空整个文档，
    //     所以默认用 iframe 隔离，别改成 inline。
    mode: 'iframe',

    // iframe 模式下广告区域的像素高度
    // 当前模板是卡片形式，390 够用；换成大的图片海报时改成 480～560
    iframeHeight: 390,

    // 广告加载失败 / 被 AdBlock 拦时是否直接放行。
    // 强烈建议保持 true：否则广告挂了用户就永远进不去，等于自己丢掉 WiFi 服务。
    unlockOnError: true,

    // 该容器未填内容时，显示一个内部占位倒计时环
    // （现在 html 里已经有内容了，这个只作为你把 html 清空后的兜底）
    placeholder: true,

    // WiFi 信息页底部的横幅广告位（第二份收入，可选）
    banner: {
      enabled: false,
      html: '',
      height: 90,
    },
  },

  /* ======================================================================
   * 3. 数据上报（可选，用于看转化漏斗）
   * ----------------------------------------------------------------------
   * 用 navigator.sendBeacon 以 POST(JSON) 方式上报，页面关闭也不会丢数据。
   * 事件：pageview / ad_start / ad_complete / ad_click / ad_error /
   *       connect_tap / copy_pwd / qr_shown / manual_guide
   * ==================================================================== */
  track: {
    enabled: false,
    url: '', // 例：https://your-api.com/track
  },

  /* ======================================================================
   * 4. 远端配置（可选，进阶）
   * ----------------------------------------------------------------------
   * 填了之后，页面会用远端返回的 JSON 覆盖上面的 wifiList。
   * 好处：WiFi 密码不写死在前端源码里，改密码不用重新发二维码。
   * 返回格式：{ "wifiList": [ { "id": "...", "ssid": "...", ... } ] }
   * ==================================================================== */
  remote: {
    url: '',
    timeoutMs: 3000,
  },

  /* ======================================================================
   * 5. 界面与文案
   * ==================================================================== */
  brand: {
    title: '免费 WiFi',
    subtitle: '扫码连接，无需询问密码',
    themeColor: '#2f6bff',
    // logo: 'assets/logo.png',   // 可选，门店 LOGO
  },

  /*
   * ★ iOS 上要不要显示「打开 WiFi 设置」按钮 —— 默认不显示。
   *
   * 这是有真机证据的决定：在真实 iPhone 上点这个按钮，Safari 弹出
   *    “Safari 浏览器打不开该网页，因为网址无效。”
   * 这是 Safari 在解析 URL 阶段就拒绝了，请求根本没发出去 ——
   * iOS 已经不再把 App-Prefs / prefs 这类私有 scheme 注册给系统。
   * 弹一个让用户以为网站坏了的错误框，比没有按钮更糟。
   *
   * 想自己赌一把就填上：
   *   'App-Prefs:root=WIFI'   —— 网上最常见的写法，实测新版 iOS 已失效
   *   'prefs:root=WIFI'       —— 旧版写法，有反馈说 iOS 18.3.1 仍可用
   * 两种在失效的版本上都会弹上面那个错误框，而且网页端没有 canOpenURL
   * 这类“先问问支不支持”的能力 —— 填了就是碰运气。
   *
   * iPhone 上真正快的路径是方式二：截图 → 相册轻点二维码 → 加入网络。
   */
  iosSettingsScheme: '',

  behavior: {
    // 点击「一键连接」时自动复制密码（多数手机可用）
    autoCopyOnConnect: true,

    // 复制成功后是否额外交弹一个提示条
    // 默认关：弹层顶部已经显示「✅ 密码 xxxx 已复制到剪贴板」了，
    // 再弹一个内容重复的 toast 属于冗余信息，而且它会浮在底部压住操作按钮。
    toastOnCopy: false,

    // 顾客点「已连上，谢谢」之后去哪：
    //   '/'              → 跳站点首页（默认）
    //   'https://...'    → 跳任意地址（商家公众号文章、领券页、点餐小程序…）
    //   ''               → 不跳，留在原页
    //
    // 为什么做成可配置：对门店来说这个位置很值钱 ——
    // 顾客刚连上网、心情正好、注意力在手机上，是引导的黄金时机。
    // 引导到公众号 / 领券页的转化率，通常远高于放一段展示广告。
    afterConnect: '/',

    // 跳转前的停留毫秒数。要留一点时间让顾客看到反馈，
    // 否则刚点完就白屏切换，会让人以为页面崩了。
    afterConnectDelay: 900,

    // 跳转时的提示文案。跟 afterConnect 搭配着改：
    //   跳首页   → “带你看看更多网络知识”
    //   跳领券页 → “正在为你打开优惠券”
    //   跳公众号 → “正在为你打开关注页”
    // 不写就默认 “已连上，正在跳转…”。
    afterConnectTip: '✅ 已连上，正在带你看看更多网络知识…',
  },
};
