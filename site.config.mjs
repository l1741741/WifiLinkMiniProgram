/* ==========================================================================
 * 站点配置 —— 建站前先把这里改对
 * ========================================================================== */
export default {
  // —— 站点基本信息 ——
  name: '门店网络手册',
  slogan: '给小店老板看的 WiFi 与网络知识',
  description: '写给实体门店经营者的网络实用手册：WiFi 覆盖、密码策略、设备选型、顾客连接体验与上网安全，全部来自实际运维经验。',

  // ★ 上线前改成你的真实域名（结尾不要带 /）
  //   百度联盟和 sitemap 都要求这里的域名与实际部署一致
  url: 'https://wifi.example.com',

  // —— 备案信息（工信部要求必须展示在页脚，且要能点回 beian.miit.gov.cn）——
  //   还没备案就留空，页脚会显示「备案中」提示，而不是假装有备案号
  icp: '',
  //   公安网备（有的省份要求，没有就留空）
  police: '',

  // —— 联系方式：联盟审核会看，建议留一个真实可达的 ——
  email: 'hello@example.com',

  // —— 栏目：slug 用英文（进 URL），name 是显示名 ——
  //   文章 front-matter 里的 category 填 slug
  categories: [
    { slug: 'shop-wifi', name: '门店 WiFi', desc: '覆盖、选型、密码策略——把小店网络做扎实。' },
    { slug: 'connect',   name: '顾客连接', desc: '扫码连网、访客网络、连接体验与转化。' },
    { slug: 'security',  name: '上网安全', desc: '公共网络到底有哪些风险，哪些是被夸大的。' },
    { slug: 'faq',       name: '故障排查', desc: '信号满格上不了网、掉线、卡顿的排查顺序。' },
  ],

  // —— 首页顶部导航（顺序即显示顺序）——
  nav: [
    { href: '/', label: '首页' },
    { href: '/category/shop-wifi.html', label: '门店 WiFi' },
    { href: '/category/connect.html', label: '顾客连接' },
    { href: '/category/security.html', label: '上网安全' },
    { href: '/category/faq.html', label: '故障排查' },
    { href: '/about.html', label: '关于' },
  ],

  // —— 扫码连 WiFi 工具页的地址 ——
  //   店内张贴的二维码就指向它，别指向首页
  scanPath: '/scan/',

  // —— 页脚 ——
  footerNote: '本站内容基于实际门店网络运维经验整理，供同行参考。',
};
