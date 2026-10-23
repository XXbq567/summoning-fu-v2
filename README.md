# 召唤符 · Summoning Fu

把一次 Codex 新轮次的发送，呈现为角落里的一张符。此仓库保存 **0.4.1 阶段源码**：Codex UserPromptSubmit hook 插件负责交接事件，独立 Electron 透明窗口负责显示。它不是官方 Pet API、内置桌宠或背景替换功能。

原创代码维持 **UNLICENSED**：公开可读不等于授予开源许可证。本次存档没有改为 MIT，也没有新增许可授权。第三方字体和组件保留各自许可证，见 [第三方声明](THIRD-PARTY-NOTICES.md)。

## 它会做什么

在受支持的本地 Codex 环境发送消息，产生新的根 turn 后约 5 秒显示。仅打开或切换聊天不会触发；同一活跃 turn 的追加输入不保证重新显示。

显示过程为纸底显现 650ms、字序显现 2100ms、定形 250ms、完整停留 10 秒、统一轻缩淡出 1 秒，共约 14 秒。0.4.1 正常入口及独立预览均播放完整动效，不跟随系统减少动态；**不修改 Windows 设置**。隐藏停绘制、睡眠收起。动效时长不表示任务完成、模型进度、token 或费用。

标题来自同一 session 的本地标题索引；模型来自当次 hook；推理强度只采用通过核验的当次 turn context。缺失值保持未知或显示明确的装饰题辞，不把 prompt 当标题，也不调用模型补内容。

## 构建与启动

需要 Windows x64、Node.js 22 或更新版本，以及 npm。自动入口另需支持本项目 hook 合同的 Codex，当前精确兼容 `0.163.0-alpha.10.2` 和 `0.163.0-alpha.11`；未知版本保守拒绝。其他系统未验证。

在仓库根目录运行：

```powershell
npm ci
npm test
npm run build
npm start
```

`npm ci` 安装锁定的开发依赖，可能访问 npm 及 Electron 发行下载源。`build` 生成离线 `SUMMONING-FU-PREVIEW.html`，用于符体演示，不连接真实会话。`npm start` 启动伴随程序；未安装及信任插件时，不会自动接收 Codex 发送事件。

完整入口动效可独立预览：

```powershell
npm start -- --motion-preview
```

也可双击 `PREVIEW-MOTION.cmd`。启动器优先采用最新已构建桌面包；修改源码后请重建包，避免仍运行旧版本。

构建本地插件市场：

```powershell
npm run package:desktop
npm run package:plugin
```

输出分别在 `dist/releases/` 与 `dist/plugins/`。插件包内包含 Electron 运行时，但 hook 仍需要本机 Node.js 22+。安装、单项 Trust、停用及卸载步骤见 [插件说明](docs/PLUGIN.md)。

## 验证与限制

此前实现阶段执行了 97 项自动检查及构建，并在 Windows 实机验证普通路径、drive namespace、等价应用目录 alias 三种本地 hook 夹具交接：系统减少动态为 true、有效策略为 false，正常窗口完整播放 14 秒、不抢焦点、隐藏停止绘制。这是实际窗口的夹具集成验证，**不是最新自然用户提交的完整客户端验收**。

最新自然用户根 turn、多屏、全屏、实际睡眠恢复及其他操作系统仍未完成本阶段验收。发布过程会重新执行检查，最终数量可能因导出检查增加；以对应发布记录为准。详见 [验证范围](docs/VERIFICATION.md)。

- [桌面使用](docs/DESKTOP.md)
- [完整动效预览](docs/MOTION-PREVIEW.md)
- [来源与适配边界](docs/ADAPTER.md)
- [公开存档说明](docs/PUBLICATION-NOTES.md)

此公开源码目录不附个人配置、原始参考图、任务图片、真实会话记录或内部截图日志。
