# 扫码连 WiFi · 小程序 + H5

给线下门店用的"扫码连 WiFi"工具。**主交付物是微信小程序**（`miniprogram/`）。

```
到店顾客扫店里的二维码
        │
        ▼
   广告闸门（可选，未开通流量主时自动跳过）
        │
        ▼
   WiFi 信息页（网络名 / 密码 / 当前门店）
        │
        ▼
   点「一键连接」——按平台走两条完全不同的路
        │
        ├─ iOS   → wx.connectWifi 真·直连
        └─ 安卓  → 跳系统设置页（微信文档：不传 maunal 时
                    连上的 WiFi 只有小程序自己能上网）
```

## 三个部分

| 目录 | 是什么 | 状态 |
|---|---|---|
| **`miniprogram/`** | **微信小程序**——主交付物 | 开发完成，待主体变更 + 认证 + 备案 |
| `public/scan/` | H5 扫码落地页（同一套逻辑的网页版） | 可用，但受浏览器限制做不到一键连 |
| `content/` + 站点生成 | 内容站，18 篇文章 | 早期为过百度联盟审核而建，现已不需要 |

**为什么最终选小程序**：浏览器无法调用系统 WiFi 接口，这是操作系统的安全边界。
小程序能调 `wx.connectWifi`，是目前唯一能"代码直连"的合规路径。

**小程序的上线步骤见 [`miniprogram/上线清单.md`](miniprogram/上线清单.md)** ——
从主体变更到备案，按顺序列全了。

## 快速开始

```bash
npm test                    # 全量检查：站点 + 二维码 + 小程序静态检查 + 43 项逻辑测试
node tools/devtools.mjs check   # 检查微信开发者工具环境
```

小程序部分单独看 [`miniprogram/README.md`](miniprogram/README.md)。

## ⚠️ 一个必须知道的构建约定

`public/` 是**混装目录**——既有人写的文件，也有构建产物：

| 类型 | 文件 | 说明 |
|---|---|---|
| **手写** | `public/scan/`、`public/assets/` | 工具页和它的脚本样式，**源头就在这里** |
| **生成** | `public/index.html`、`public/posts/`、`public/category/`、`public/*.html`、`sitemap.xml`、`robots.txt`、`rss.xml` | 由 `content/` + `site.config.mjs` 构建出来 |

**所以：改了 `content/` 或 `site.config.mjs` 之后，必须跑一次 `npm run build`，并把 `public/` 一起提交。**

不提交的话，别人 clone 下来看到的还是旧内容；只提交产出不跑构建的话，产出会和源文件对不上。

```bash
npm run build     # 重新生成 public/ 里那些页面
npm test          # 构建 + 死链检查 + 二维码校验 + 小程序检查与逻辑测试
```

---

## 目录结构

```
site.config.mjs             ★ 站点配置：域名、备案号、栏目、邮件
content/
├── posts/*.md              文章（加文件即发布，构建时自动进首页/栏目/sitemap）
└── pages/*.md              单页：关于我们 / 隐私政策 / 免责声明

tools/
├── build-site.mjs          静态站生成器（零依赖）
├── md.mjs                  Markdown 渲染器
├── check-links.mjs         死链 / sitemap / 结构完整性检查
├── serve.mjs               本地预览服务器
├── gen-qr.mjs              生成张贴二维码 + A4 海报
├── qr-lib.mjs              二维码渲染（SVG / PNG，纯 JS 无原生依赖）
├── verify-qr.mjs           二维码自检
├── decode-qr.py            OpenCV 独立解码器（仅校验用）
└── baidu-push.mjs          百度主动推送（加速收录）

public/                     ← 部署时上传这个目录的全部内容
├── index.html              首页（生成）
├── posts/ category/        文章页、栏目页（生成）
├── about.html privacy.html disclaimer.html   （生成）
├── sitemap.xml robots.txt rss.xml            （生成）
├── scan/index.html         ★ 扫码工具页（手写，构建不会覆盖）
└── assets/
    ├── config.js           ★ 工具页配置：WiFi、广告
    ├── app.js  style.css   工具页逻辑与样式
    ├── site.css            内容站样式
    ├── site-info.js        构建生成，工具页复用的站点信息
    └── vendor/qrcode.js    二维码编码器（MIT，内联，不依赖 CDN）

dist/                       二维码与海报产物
```

---

## 写文章

在 `content/posts/` 丢一个 `.md` 文件，跑一次 `npm run build` 就上线了。

```markdown
---
slug: my-article           # URL 里的名字，英文，改了会变 URL
title: 文章标题
category: shop-wifi        # 必须是 site.config.mjs 里 categories 的 slug
date: 2026-09-16
summary: 一句话摘要，显示在列表页和搜索引擎结果里
---

正文用 Markdown。支持标题、粗体、列表、引用、代码块、表格、链接、图片。
```

构建脚本会校验：`title` / `category` / `date` 缺一个就报错并退出，避免发出半成品页面。
`category` 填了配置里不存在的值也会报错。

分类只有四个，都在 `site.config.mjs` 里：`shop-wifi`（门店 WiFi）、`connect`（顾客连接）、`security`（上网安全）、`faq`（故障排查）。

---

## 上线前必须改的两处

编辑 `site.config.mjs`：

```js
url: 'https://你的真实域名.com',   // 不改的话 sitemap 全是示例域名，百度会拒收
icp: '京ICP备2026000000号-1',     // 备案下来后填这里
```

`icp` 填上之后，**所有页面的页脚**（包括手写的 `/scan/`）都会自动出现备案号并链接到工信部——
构建脚本会把备案信息写进 `/scan/index.html` 的静态 HTML 里，不是靠 JS 运行时填充，
因为爬虫和审核方看的是服务端返回的原始 HTML。

没填 `icp` 时页脚会显示「ICP 备案办理中」，不会假装有备案号，检查脚本也会提醒你。

---

## 临时暴露到公网（真机测试 / 发给别人看）

```bash
node tools/tunnel.mjs          # 一条命令：起本地服务 + 建隧道，直接输出公网地址
node tools/tunnel.mjs --stop   # 全部停掉
node tools/tunnel.mjs --lt     # 改用 localtunnel（不推荐，见下）
```

### ⚠️ 这是临时隧道，不是部署

它把你**本机的端口**映射到公网。电脑一关机、进程一停，地址立刻失效。
用它做真机测试和演示很合适，**不能当正式上线用**。

### 为什么默认用 cloudflared 而不是 localtunnel

两条隧道都实测过，差别很大：

| | cloudflared | localtunnel（免费版） |
|---|---|---|
| 访问者看到的 | **直接就是你的页面** | 先看到一个「Tunnel website ahead!」拦截页 |
| 额外操作 | 无 | **必须输入你的公网 IP 当密码** |
| 域名 | 每次重启随机（`xxx.trycloudflare.com`） | 可固定子域名 |
| 适合 | 真机测试、发演示 | 自己在电脑上调试 |

localtunnel 那个拦截页对到店顾客是致命的 —— 顾客扫完码看到"请输入密码"就直接走了。
所以默认走 cloudflared。

### 想要固定域名

两条路：

1. **Cloudflare 账号 + 自己的域名**（免费）
   `cloudflared tunnel login` → 创建 named tunnel → 绑定到你的域名。
   这是目前唯一能**免费 + 无拦截页 + 固定域名**的组合。
2. **真正部署到静态托管**，见下方“部署”章节。

---

## 部署

`public/` 是纯静态资源，上传即可。**必须用 HTTPS**（剪贴板 API 只在安全上下文可用）。

```bash
# Vercel / Netlify / Cloudflare Pages：输出目录填 public，零配置
# 对象存储 + CDN：上传 public/ 全部内容，默认首页设为 index.html
# 自建 Nginx：
#   root /var/www/wifi/public;
#   location / { try_files $uri $uri/ =404; }
```

**站点必须部署在域名根目录**，不能放在子目录 `/wifi/` 下——所有内部链接都是根路径绝对引用
（`/assets/site.css`），放子目录会全部失效。

`/scan/` 依赖服务器对目录索引的支持（`/scan/` → `/scan/index.html`）。
Vercel、Nginx、OSS、CDN 默认都支持。本地预览服务器也做了相同处理，所以本地和线上行为一致。

---

## WiFi 连接的真相：先想清楚你要哪个

这是整个项目最重要的设计决策，比任何技术实现都关键。

**浏览器无法调用系统 WiFi 接口**——这是操作系统的安全边界，不是代码写得好不好的问题。
所以“点一下就自动连上”在 H5 里永远做不到。各平台的实际能力：

| 环境 | 能否代码直连 | 说明 |
|---|---|---|
| 浏览器 / 微信 H5 | ❌ 不可能 | 沙箱里没有网络配置接口 |
| 微信小程序 | ⚠️ 曾有 `wx.connectWifi` | 微信官方文档已标注**该系列接口已下架**，个人主体无权调用 |
| 原生 App / uni-app | ✅ 能 | iOS 用 `NEHotspotConfigurationManager`，Android 11+ 用 `ACTION_WIFI_ADD_NETWORKS` |

原生 App 确实能做到真·一键，但**为了省 3 次点击让顾客下载一个 App，转化率上不成立**。
所以这个项目走 H5 路线，并把所有可行路径摊给顾客。

### 三种连接路径的实际步数

| 路径 | 步数 | 限制 |
|---|---|---|
| **系统直连码**（`WIFI:` 格式，相机扫） | **2 步** | iOS 11+ / Android 10+ |
| 工具页扫码（看广告 → 引导粘贴） | 4～5 步 | 无限制，所有手机 |
| 系统直连码失败时的截图识别 | 3～4 步 | iOS 17+ / 新 Android 相册 |

**所以“贴哪个码”等于“要不要变现”，两者不可兼得。** 详见下方的双码海报方案。

工具页里还做了两件容易被忽略的事：

**一、“打开 WiFi 设置”按钮：Android 给，iPhone 不给**

| 平台 | scheme | 结论 |
|---|---|---|
| Android | `intent://#Intent;action=android.settings.WIFI_SETTINGS;end` | ✅ 基本可靠 |
| iOS | （默认禁用） | ❌ **真机实测已失效，见下** |

**iOS 为什么禁用了**（这是有真机证据的，不是推断）：

在真实 iPhone 上点那个按钮，Safari 弹出：

> Safari 浏览器打不开该网页，因为网址无效。

这是 Safari **在解析 URL 阶段就拒绝**，请求根本没发出去 ——
iOS 已经不再将 `App-Prefs` / `prefs` 这类私有 scheme 注册给系统。

关键点：**网页端没有 `canOpenURL` 这类“先问问支不支持”的能力**，
只能直接跳，跳不了就弹框。所以给 iOS 放这个按钮不是碰运气，是确定地破坏体验。

想自己赌一把的版本，在 `config.js` 里：

```js
iosSettingsScheme: 'prefs:root=WIFI',   // 默认 '' = 不显示按钮
```

**iPhone 上真正快的路径是方式二**：截图 → 打开「照片」→ 轻点二维码气泡 → 加入网络。
iOS 17+ 实测比走设置页少一步，而且全程不离开当前页面。

Android 那边有两个必须做对的细节：用**隐式 intent**（不指定 package/component）——
硬编码 Activity 类名在 MIUI / EMUI 等定制 ROM 上会抛 `ActivityNotFoundException`；
以及必须是**真实的 `<a>` 标签**，不能用 JS 造 a 再 `click()` ——
Chrome 要求用户手势才启动外部应用，`element.click()` 不产生 user activation，必然被拦。

**二、Android 跳转失败会明确告知，不假装成功**

靠“页面是否还在前台”判断：跳转成功会触发 `visibilitychange`，页面还在就是没跳过去，
1.5 秒后弹提示告诉用户手动路径。
一个点了没反应又不说的按钮，比没有按钮更伤信任。

---

### 顾客连上之后去哪

连接成功、顾客点「已连上，谢谢」后，可以把人引导到任意页面：

```js
behavior: {
  afterConnect: '/',            // '/' = 站点首页；填 URL = 跳该地址；'' = 不跳
  afterConnectDelay: 900,       // 跳转前停留毫秒数
}
```

**为什么给默认值设为跳首页**：顾客刚连上网、心情正好、注意力在手机上，
这个时刻的引导价值很高。跳到站点首页能把这些真实访问变成内容流量，
让站点看起来更像一个真有人在用的网站。

对门店来说，这个位置还有两种更值钱的用法 —— 直接把 `afterConnect` 改成：

| 目标 | 适合 |
|---|---|
| 商家的领券页 / 点餐页 | 直接带动销售 |
| 公众号文章 / 加企微引导 | 沉淀私域，长期可反复触达 |
| 美团 / 大众点评店铺页 | 引导评价，提升排名 |

不需要备案、不需要审核，改一行就生效。

`afterConnectDelay` 不能设得太短：刚点完就切页会让用户以为页面崩了。
默认 900ms 让 toast 先完整的出现一下。

---

## 生成张贴二维码（双码海报）

```bash
# 默认：双码海报（推荐）
node tools/gen-qr.mjs --url https://你的域名.com/scan/

# 只要单个码
node tools/gen-qr.mjs --url https://你的域名.com/scan/ --single
node tools/gen-qr.mjs --wifi
```

### 双码海报的设计逻辑

```
┌──────────────────────────────┐
│        免费 WiFi              │
│     ┌──────────────┐         │
│     │              │         │  ← 大码：WIFI: 系统直连码
│     │   大二维码    │         │     相机扫 → 点「加入网络」→ 连上（2 步）
│     │              │         │
│     └──────────────┘         │
│      WiFi：ChinaNet-3v9I-5G   │
│   ① 打开相机 ② 对准 ③ 点加入  │
│  ─────────────────────────   │
│  ┌────┐  扫上面的码没反应？    │  ← 小码：工具页 URL
│  │小码│  用微信扫一扫扫这个    │     兜底旧设备 + 广告入口
│  └────┘  页面里会给密码和步骤  │
└──────────────────────────────┘
```

**为什么大码是直连码而不是广告入口**：顾客进店的真实目的是“赶紧上网”。
把 2 步的路径藏起来、逼所有人走 5 步的广告路径，短期多几毛钱，
长期是把回头客推给隔壁。大码保证体验，小码承接广告。

### 海报上为什么不印文字密码

默认**不印**。印了之后所有人都能直接手输，两条扫码路径全部失效，广告收入归零。
而 `WIFI:` 码本身已经是 2 步连上，比手输更快，不需要印。

确实需要无障碍兜底（常有老年顾客）时加 `--show-password`。

### 产物

- `wifi-<SSID>.svg` / `.png` — 系统直连码
- `entry-qr.svg` / `.png` — 工具页入口码（印刷用 SVG，微信传图用 PNG）
- `poster.html` — A4 双码海报，浏览器打开后 ⌘P / Ctrl+P 直接打印

误把 `--url` 写成首页时脚本会拦下来提醒——那会把到店顾客丢进文章列表里。
印刷品建议加 `--ec H` 提高纠错等级（更抗磨损和折痕）。

---

## 广告位怎么用

`public/assets/config.js` 里的 `ad.html` **接受任意 HTML**。当前填的是一个已排好版的
「本地商家直客」模板，下面两种模式随你选。

### 模式一：卖给周边商家（当前默认，推荐）

不需要备案、不需要审核、改完立即生效。模板里用 `★①` 到 `★④` 标出了要改的地方：

```
★① 商家名      ★② 促销文案      ★③ 跳转链接      ★④ 配色
```

换成商家的图片海报：把图片放到 `public/assets/ads/` 下，
然后把 `html` 换成：

```js
html: `
  <a href="https://商家链接" target="_blank" rel="noopener nofollow"
     onclick="parent.postMessage({t:'ad_click'},'*')">
    <img src="/assets/ads/poster.jpg" alt="广告" style="width:100%;max-width:420px;border-radius:14px">
  </a>`,
```

图片建议宽 840px、体积 200KB 以内（顾客用手机流量加载）。

**为什么这个模式更值得做**：日均扫码 200 次的门店，接百度联盟大约 1～2 元/天；
而同一个位置卖给周边商家包月，常见 200～500 元。单价差两个数量级。

### 模式二：接广告联盟

需要 ICP 备案 + 一个看起来像网站的站点（内容站已经建好了）。拿到代码后清空 `html`，
整段粘贴联盟给的代码即可。

```js
ad: {
  enabled: true,
  minSeconds: 5,           // 强制观看秒数，到点自动进 WiFi 页
  skipAfterSeconds: 2,     // 2 = 播 2 秒后「跳过」可点；0 = 立刻可跳；-1 = 不给跳过
  mode: 'iframe',          // 默认隔离，见下方
  html: `<!-- 联盟后台给的代码 -->`,
}
```

### 两个已经踩过的坑

**一、`document.write`**

广告联盟的代码片段普遍使用 `document.write()`。把它塞进已经加载完的页面，
浏览器会先执行 `document.open()`——**整个页面被清空，用户看到白屏**。
所以默认 `mode: 'iframe'`，广告跑在同源沙箱 iframe 里。

如果联盟明确要求页面上下文，改成 `mode: 'inline'`；那条路径也加了 `document.write`
重定向守卫。两条路都实测过。

**二、iframe 里的相对路径图片**

`srcdoc` 文档的 URL 是 `about:srcdoc`，不补 `<base>` 的话广告素材里写
`img src="assets/ads/x.jpg"` 会解析到错误地址，图直接加载不出来——
而代码看着完全正常，只是白框。工具页已经自动注入 `<base href="站点根">`，
但**建议还是写 `/assets/...` 这种根路径**，最不容易出错。

### 点击统计

广告跑在 iframe 里，点击不会冒泡到主页面。需要统计点击时，在广告 HTML 上加：

```html
onclick="parent.postMessage({t:'ad_click'},'*')"
```

收不到也不影响展示，只是少一个统计数字。

### 接入前需要准备什么

| 需要的东西 | 说明 |
|---|---|
| **ICP 备案** | 硬性。必须大陆服务器，**境外/香港主机通过率极低且无申诉通道** |
| **备案主体 = 联盟账号实名** | 个人备案就得用个人账号，不能混 |
| **网站验证** | 百度联盟后台下载验证文件或 HTML 标签，放到站点根目录 |
| **财务实名** | 身份证 + 银行卡（个人可收款，满 100 元月结） |
| **域名历史干净** | 做过灰产的域名建议直接换 |

百度联盟常见拒绝理由：域名或财务信息重复注册、未备案、备案主体与实名不一致、
**内容非原创**、首页无法公开访问、**大量 404**。

后两条正是 `check-links.mjs` 在自动防的。

### 收录加速

```bash
BAIDU_TOKEN=你的准入密钥 node tools/baidu-push.mjs
```

token 从百度搜索资源平台 → 站点管理 → 普通收录 → API 提交获取。
推送只是提速，不代表立刻收录；新站通常要几天到几周。

---

## 测试

```bash
npm test
```

三部分：

**① 站点完整性**（`check-links.mjs`，扫描 27 个 HTML）
- 所有站内链接都能落到真实文件（防 404，这是拒审理由之一）
- 锚点链接的目标 id 真实存在
- sitemap 里的 URL 与磁盘文件一一对应（双向检查）
- 每个页面都有 `<h1>`、`meta description`、`lang="zh-CN"`
- 备案号与 `site.config.mjs` 一致，或明确标注"办理中"
- 有没有孤儿页（存在但没有任何页面链向它）

**② 二维码校验**（`verify-qr.mjs`）
- SVG 回环：把我生成的 SVG 路径反解回矩阵，逐格比对 + 静区检查
- **OpenCV 独立解码**：用完全不同的实现解码，确认真的扫得出来
- `WIFI:` 协议对 `\ ; , : "` 的转义符合规范
- **dist/ 交付物逐个解码**：海报上用的那两个 PNG 也直接验一遍

**③ 内容校验**（`build-site.mjs` 内置）
- 每篇文章的 front-matter 完整性
- category 是否在配置的栏目列表里

当前状态：

```
✓ 站点完整性   27 个页面，无死链、无缺失、sitemap 一一对应
✓ 二维码校验   4/4 SVG 回环 · 3/3 OpenCV 独立解码（含中文 SSID）· 4/4 协议转义 · 2/2 dist 交付物
✓ 内容校验     18 篇文章 + 3 个单页
```

---

## 常见问题

**Q：内容站的文章必须自己写吗？**

必须。百度联盟的审核标准明确包含"原创度"，采集或 AI 批量生成的泛泛内容
是拒审的高频原因。现有 18 篇是按"垂直、有具体数字、有真实取舍"的标准写的，
后续补充建议保持同样的密度——宁可篇数少，也不要凑数。

**Q：为什么顾客扫码后不能一键连上？**

因为浏览器无法调用系统 WiFi 接口，这是操作系统的安全边界。
完整说明写在文章《为什么微信里不能一键连 WiFi》里，工具页也把三条可行路径都给了顾客。
如果你需要真正的代码级直连，只有微信小程序（官方文档已标注 WiFi 接口下架）或原生 App 两条路。

**Q：广告收益能有多少？**

按 5 元 eCPM 估，日均扫码 200 次大约 1～2 元/天。测算过程写在文章
《免费 WiFi 的成本该由谁承担》里。**建议认真读一下那篇再决定要不要花力气做广告**——
同一个展示位用来发券或引导关注，价值往往高一个数量级。

**Q：改 WiFi 密码要重新印发二维码吗？**

不用。二维码里存的是工具页地址，不是密码。改 `public/assets/config.js` 里
`wifiList` 的密码即可，二维码原样能用。

**Q：密码明文写在前端，安全吗？**

不安全，但这是这类工具的固有性质——密码最终必须进到顾客手机里才能连网，所以无法保密。
详见 `/privacy.html`。想让密码不出现在前端源码里，用 `config.js` 里的 `remote` 配置走接口下发。

---

## 合规提醒

- **ICP 备案**：国内访问 + 微信内打开 + 百度联盟，三件事都要求备案，绕不过去
- **页脚必须展示备案号并链接到工信部**，所有页面都要——包括工具页，已自动处理
- **本项目本身不采集任何用户信息**，`/privacy.html` 如实描述了工具页的实际行为（含 `sessionStorage` 和可选埋点）
- **别做诱导点击**：展示位上放"点击继续""点击领取"这类假按钮会被联盟封号
- **广告代码是第三方代码**，跑在你的域名下，选正规平台，来路不明的代码不要贴
- **不要用工具页展示你没有权限分享的网络**——`/disclaimer.html` 里已写明

---

## 第三方组件

| 组件 | 版本 | 许可 | 用途 |
|---|---|---|---|
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | 2.0.4 | MIT | 二维码编码 |
| [OpenCV](https://opencv.org/) | — | Apache 2.0 | **仅开发期**独立解码校验，不参与线上运行 |

详见 `THIRD_PARTY_LICENSES.md`。运行时零依赖、零构建，断网和内网环境都能正常工作。
