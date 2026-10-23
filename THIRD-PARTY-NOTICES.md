# 第三方材料与许可

本项目原创代码为 UNLICENSED；本文件未授予原创代码的开源许可。

- **Ma Shan Zheng / 马善政毛笔楷书 2.003**：未修改字体，SIL Open Font License 1.1。Copyright 2018 The Ma Shan Zheng Project Authors。保留 `assets/fonts/OFL.txt`、`NOTICE.txt`、`SOURCE.json`；`coverage.json` 是字体 cmap 覆盖索引，不表示完整 Unicode 覆盖。无需系统范围安装字体。
- **Electron 44.9.3**：MIT。桌面运行时保留 Electron LICENSE 以及 `LICENSES.chromium.html`，其中列出 Chromium 与相关组件的第三方声明。
- **@electron/packager 20.3.0**：BSD-2-Clause，开发打包工具。它不是本项目原创代码；其许可证随构建过程保留。完整依赖解析见 `package-lock.json`，依赖各自的许可证仍适用。
- **Node.js**：hook 与源码开发需要本机安装 Node.js 22+。桌面运行时随 Electron 提供，但不意味着 hook 所需的系统 Node.js 已经安装。Node.js 及其组件的许可证由相应发行包提供。

打包脚本会从已安装依赖复制 Electron 与 packager 许可到发行内容。字体的完整许可及通知必须随组件保留；离线 HTML 内嵌字体时也保留 OFL 正文。没有以任何第三方作者的名义作背书。
