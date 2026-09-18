# 依赖与许可

## 运行时依赖：无

线上跑起来的只有 `public/` 目录里的静态文件，没有任何 npm 包、没有构建步骤、
没有后端服务、不请求任何第三方网络。

## 内置的第三方组件

### qrcode-generator 2.0.4

- 主页：https://github.com/kazuhikoarase/qrcode-generator
- 许可：MIT
- 用途：把 WiFi 配置串 / 页面地址编码成二维码
- 位置：`public/assets/vendor/qrcode.js`（内联了一份，含 UTF-8 支持）

之所以内联而不是走 CDN：二维码是这个产品的核心链路，弱网、被墙、内网环境
都不能让它挂掉。Node 端的 `tools/qr-lib.mjs` 复用的也是同一份文件，
保证「海报上的码」和「页面里的码」出自同一个编码器，不会出现一个能扫一个不能扫。

刷新这份内联副本：

```bash
npm i --no-save qrcode-generator@2.0.4
cp node_modules/qrcode-generator/dist/qrcode.js public/assets/vendor/qrcode.js
node tools/verify-qr.mjs      # 必须仍然是 ✓ 全绿
```

### OpenCV（仅开发期校验用）

- 许可：Apache 2.0
- 用途：`tools/decode-qr.py` 用它与编码器完全不同的实现来独立解码，
  确认生成的二维码真的扫得出来
- **不参与线上运行**，只是自检工具。没装 OpenCV 时 `verify-qr.mjs` 的第 ② 步会失败，
  第 ① ③ 步仍可正常运行。

```bash
pip install opencv-python-headless
```
