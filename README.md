# 召唤符 · Summoning Fu

把一次 Codex 工作聊天的发送，化作一张承载模型、聊天标题与来源信息的召唤符。白纸舒展、文字显现，完整阅读 **2 秒**后从底部收卷，旋转 90°，飞入短暂出现的提供方印记；纸与印记最后完全消失。

这是 **Codex 插件＋Windows 透明伴随窗口**，使用 UserPromptSubmit Hook 自动交接。默认不需要 skill、MCP 端口、模型工具调用或官方 Pet 开关。动画表达“交付敕令”，不表示任务成功、完成、进度、费用或百分比。

## 快速开始

### 路线一：安装已发布插件

适合直接使用。前提是 Windows x64、Hook 环境能在 PATH 找到 Node.js 22+，以及符合已核验合同的 Codex。

1. 从 [v0.6.4 Release](https://github.com/XXbq567/summoning-fu-v2/releases/tag/v0.6.4) 下载 **Summoning-Fu-plugin-v0.6.4-win32-x64.zip**，核对发布来源与校验清单并完整解压。
2. 按 [INSTALL.md](INSTALL.md) 核对版本、添加市场及安装；由用户在 Settings → Hooks 审阅召唤符的 UserPromptSubmit 并单项 Trust。
3. 在新的 Codex 工作聊天中正常发送消息，验证自然完整播放。仅切换聊天不触发，预览不能代替真实发送。

由 Agent 协助时可说：“先读 AGENTS.md 与 INSTALL.md，列出检查和安装命令及影响，等我确认；Trust 由我完成。”安装、升级、退出、回滚和排错以 INSTALL 为唯一操作入口。源码仓库不是已构建的插件市场，便携包也不会升级已安装插件。

### 路线二：从源码开发与构建

适合维护或自行打包。使用 [公开 GitHub 仓库](https://github.com/XXbq567/summoning-fu-v2) 的正常 clone，先读 [SETUP.md](docs/SETUP.md)。公开源码提供离线完整性检查：

```powershell
npm.cmd run verify:source
```

该命令对照随源码提供的 INTEGRITY 清单，不是发布者签名或独立来源证明；作者私有维护目录的脚本集合与公开导出不同。完整构建顺序、产物位置和启动方式只在 SETUP 维护。**执行 `npm.cmd ci` 前先说明并取得联网安装授权**；使用锁定依赖，不顺手升级。构建完成后，按 INSTALL 安装输出的完整市场目录。

## 内容与来源

模型来自当次 UserPromptSubmit；聊天标题只用同会话已验证的名称，缺失时用题辞，不拿 prompt 正文填符纸。标题、模型与 cwd 末级名也可能私人，公开材料须脱敏。

提供方印记依据 [精确核验目录](config/provider-catalog.json) 和可信来源选择。中转站、产品图标、模型前缀及任意别名不能证明公司；未知或冲突时显示原创通用印，不默认 OpenAI。Logo 静止，外围原创朱砂环单独转动；印记由本程序临时生成，不依赖用户现有 Pet。标志条件见 [素材声明](assets/providers/USAGE.md)。

推理强度严格区分 **reported 当次证据**与 **configured 同会话配置**。“配置·高/中/低”等表示配置快照，**未确认当次生效**；缺失、不合法或两读不一致为 unknown。字段映射、来源验证及生命周期见 [ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 验证范围

运行版本 **0.6.4**。历史实测仅覆盖 Windows x64、Codex 桌面 `26.1021.3705.0`、桌面运行后端 CLI `0.164.0-alpha.11.1`、单屏 125% 缩放；用户确认运行中真实发送和一次无正常实例时的 Hook 自动冷启动自然完整播放。

[2026-10-26 公开验证摘要](docs/PUBLIC-VERIFICATION.md) 记录内部 390/390、公开候选 367/367 的历史检查结果及差异。它们不是新机器或本轮修改的测试结果；当前验证方法与本轮结果见 [TESTING.md](docs/TESTING.md)。预览、自动检查及安装记录不能代替真实 Hook 验收。

未知线程创建版本/结构保守拒绝；其他系统、多屏、混合 DPI、全屏、睡眠、长期冷启动及普通 ChatGPT 完整链路未完成本版验收。早先一次进程未留存未取得退出码，原因仍未确认。详细边界见 [KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md)。

## 维护入口

新接手的 Agent 从 [HANDOVER.md](docs/HANDOVER.md) 开始；权限以 [AGENTS.md](AGENTS.md) 为准，Claude 使用同一份规则，见 [CLAUDE.md](CLAUDE.md)。

| 文档 | 唯一职责 |
|---|---|
| [SETUP](docs/SETUP.md) | 开发环境、依赖、构建与启动 |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | 数据流、模块、来源合同与生命周期 |
| [TESTING](docs/TESTING.md) | 检查范围、执行方式与人工验收 |
| [DECISIONS](docs/DECISIONS.md) | 关键取舍及不可随意放宽的原因 |
| [KNOWN_ISSUES](docs/KNOWN_ISSUES.md) | 已知问题、限制与未测范围 |
| [HANDOVER](docs/HANDOVER.md) | 当前状态、证据、改动入口与接手顺序 |

## 许可与隐私

原创代码保持 **UNLICENSED**；公开可读不等于授予开源使用许可，没有改为 MIT。第三方依赖、毛笔字体和品牌标志保留各自条件，见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) 与 [第三方许可目录](licenses/third-party/README.md)。

公开源码和发布包排除个人配置、真实聊天、内部原参考图、内部截图及原始诊断记录。正常动画在本地处理，不额外调用模型、不上传任务内容、不将显示文本注入开发者上下文。
