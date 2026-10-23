# 第三方材料与许可

本项目原创代码当前为 UNLICENSED，未授予公开开源许可。

- Ma Shan Zheng / 马善政毛笔楷书 2.003：SIL OFL 1.1。原文件未修改；见 assets/fonts/OFL.txt、NOTICE.txt、SOURCE.json。coverage.json 为该字体 cmap 的覆盖索引。
- Electron 44.9.3：MIT；桌面包附带 Electron LICENSE 与 LICENSES.chromium.html，涵盖 Chromium 与相关第三方组件。运行时从官方 electron/electron GitHub release 取得，按 npm electron 包内 checksums.json 校验。
- @electron/packager 20.3.0：BSD-2-Clause，开发期打包工具。依赖精确解析见 package-lock.json；工具源码及许可位于本地 node_modules，打包程序不包含开发工具。
- Node.js：本机开发验证使用 v22.20.0；免安装桌面包运行使用 Electron 自带 Node，无需另装 Node。

Petex 只参考公开的透明窗口、鼠标交互与托盘行为，没有复制其代码或素材：https://github.com/iebb/petex 。
本机 hatch-pet 只读取合同与动画行用于核验，没有复制其工具代码；未使用 ChatGPT Work Pets MCP 作为桌面接口。
perfect-freehand 未引入；原创路径自行揭示，准确字形来自字体，不声称任意汉字逐笔书写。
reference/original-reference.jpg 是内部参考图，不进入桌面发布包。真实任务文本、rollout日志、用户配置与探测截图不进入包。
# 0.3 升级调研记录

本轮检索并阅读 Motion（MIT，https://github.com/motiondivision/motion）、Petex（Apache-2.0，https://github.com/iebb/petex）、desktop-pet（MIT，https://github.com/yangbuyiya/desktop-pet）及 peon-ping（MIT，https://github.com/PeonPing/peon-ping）。它们提供动画、独立桌宠或hook通知的参考思路；本升级没有复制其代码或音效，也没有新增这些依赖。继续复用本项目SVG渲染器、锁定Electron及内置Chromium动画能力。官方hook行为依据OpenAI文档与本机合同，不以第三方项目的Stop或工具状态映射作为本产品成功状态证据。

# 2026-10-23 Paperlab 材质预览

本轮引入 Paperlab 0.8.1（Apache-2.0，Copyright 2026 Noor Mtir）。固定官方 npm 包中的完整 LICENSE 与 NOTICE 原文均保留在 licenses/third-party/paperlab-0.8.1；NOTICE 按 Apache 2.0 第 4(d) 条随发行保留。

本地适配修改说明：构建时仅在内存中给 Paperlab 0.8.1 的未使用 optional postprocessing lazy 调用添加 PURE 标记，以移除未分发分支；运行时通过材料 API 调整原符透明轮廓、火焰 shader 覆盖混合和局部尺寸/光照。修改由本项目负责，不是上游原始行为；原始 npm 包文件及保留的 LICENSE/NOTICE 未修改。所有第三方原始版权继续保留。

实际浏览器运行包使用 Paperlab、React、Three.js、React Three Fiber、GSAP 及其部分依赖。licenses/third-party/README.md 与 SOURCE.json 列明锁定版本、官方来源、完整原文文件的 SHA-256，以及最终构建的实际分发范围。分发范围按 esbuild 输出中大于零的 bytesInOutput 判断，不能把仅解析的输入当成已分发代码。未使用的 MediaPipe 模型、Draco 解码器和其他未输出依赖资产未加入桌面包；esbuild 及其平台程序仅用于本机构建。

GSAP 3.15.0 使用其自身标准许可，**不是 MIT**。保留发布包 README 中的版权和许可声明，条款以 GreenSock/GSAP 与 Webflow 官方协议为准：https://gsap.com/standard-license/ ，https://webflow.com/legal/product-terms 。这些链接不替代其原始声明。

React Three Fiber 9.7.0 的 npm 包未附完整 LICENSE；另保留同一官方 v9.7.0 标签的原始 MIT 许可（Copyright 2019-2025 Poimandres），来源与校验值记录在 SOURCE.json。原项目代码仍为 UNLICENSED；原始马善政字体未修改，SIL OFL 及字体版权声明继续随 assets/fonts 保留。第三方库的许可不改变本项目代码和字体各自的许可。

