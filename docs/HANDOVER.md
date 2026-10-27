# Agent-to-Agent Handover

更新日期：2026-10-27。本文让没有既有聊天上下文的新 Agent 从公开源码接手维护。运行版本仍为 **0.6.4**；本次工作整理交接文档与文档发布接线，不开发功能、不重构运行逻辑、不更换许可证。

## 从哪里开始

1. 读 [AGENTS](../AGENTS.md)，先确定权限和用户本次授权范围；任何 Terminal 命令都先完整展示并解释，再等待确认。
2. 读 [README](../README.md)，理解产品边界及 Release 与源码两条路线。
3. 读 [SETUP](SETUP.md)，定位实际源码根、Git checkout、锁定依赖与构建入口。安装插件另读 [INSTALL](../INSTALL.md)。
4. 读 [ARCHITECTURE](ARCHITECTURE.md) 与 [DECISIONS](DECISIONS.md)，沿实际源码确认来源验证、轮次冻结和取消边界。
5. 读 [TESTING](TESTING.md)、[KNOWN_ISSUES](KNOWN_ISSUES.md) 和 [公开验证摘要](PUBLIC-VERIFICATION.md)，区分历史证据、当前验证和未测项。
6. 按本页变更入口定位代码；只在已获授权的范围内修改和验证，同步对应文档。

不需要原作者聊天、私有 QA、真实任务或个人配置才能理解公开运行实现。若拿到的是作者维护目录而非标准 clone，先确认实际版本库位置；发现没有 `.git` 时不要执行 `git init`，不要全量 `git add` 把私人资料变成公开候选。GitHub 新 clone 本身就是正常版本库，不要求读者采用作者的临时目录结构。

作者维护树中的旧无日期指南、TXT 与历史计划仅保留作开发记录，不进入公开导出；现行规范以 README、AGENTS、本次六份详细文档及 INSTALL 为入口，冲突时核对当前源码，不能据旧文档取得执行授权。

## 当前产品状态

正常入口是 Codex **UserPromptSubmit 插件 Hook → 本地限量事件文件 → Electron 伴随程序 → 来源核验 → 纸面动画 → 临时提供方印记 → 清空**。短时 Hook 静默、fail-open，丢弃 prompt 正文；无需让模型调用 skill 或工具，不额外调用模型，也不通过 stdout 注入显示文字。

默认动效已收敛为取纸展开、显字、完整阅读 2 秒、底部向上收卷、背面弱透墨 0.2、屏幕平面旋转 90°、短弧线飞行、逐段吸收与退印。Logo 保持静止，外圈缓慢转动。正常入口与预览共享实现，但预览不能证明 Hook、Trust 或冷启动有效；托盘预览可能冻结当前真实符，独立隔离预览才使用示例，详见 SETUP。

当次模型取自事件；标题取自同会话已验证名称；提供方按精确目录与可信来源。未知或冲突用通用印，不能凭模型前缀、网关或产品名猜公司。本机确认过的“配置·高/中/低”等是 configured 同线程配置，未确认本轮实际努力；reported 当次证据是独立分支，缺失为 unknown。

当前退场目标由本程序生成，与官方 Pet 无关。源码保留观察、定位和旧实验模块，不能据此宣称普通 ChatGPT 或官方 Pet 已有可用正式通道。正常主程序中的 UIA SendObserver 与 Hook 是不同路径，手动旧 JSONL 入口也有独立的数据处理范围，详见 ARCHITECTURE；不要为接手工作启动观察来探测用户聊天。

## 可以引用的证据

| 事实 | 证据及适用范围 |
|---|---|
| 运行版本 0.6.4、锁定依赖与入口 | [package.json](../package.json)、[锁文件](../package-lock.json)、[插件 manifest](../plugin/.codex-plugin/plugin.json)；源码事实不能证明当前进程版本 |
| 历史公开发布 | [v0.6.4 Release](https://github.com/XXbq567/summoning-fu-v2/releases/tag/v0.6.4)，2026-10-26；源码、插件、便携包与校验清单是既有发布，本次文档更新不改写其资产 |
| 作者机器 warm/cold 自然播放 | [PUBLIC-VERIFICATION](PUBLIC-VERIFICATION.md)：Windows x64、单屏 125%、桌面 26.1021.3705.0、后端 0.164.0-alpha.11.1；用户确认运行中多次及一次无正常实例时真实 Hook 自动冷启动完整播放 |
| 历史检查基线 | 同一摘要：内部 390/390、公开候选 367/367，无跳过；公开集排除依赖私有资料的四组检查，不能混用数量 |
| 本轮维护检查 | 2026-10-27，Node 22.20.0 / npm 10.9.3，私有维护目录 `npm.cmd test` 394/394 PASS，0 fail/skip/cancel，退出 0；新增文档白名单回归先失败再修复通过。公开集本轮结果见 TESTING，不能继承历史 367 |
| 字段与可视生命周期合同 | [ARCHITECTURE](ARCHITECTURE.md)、[DECISIONS](DECISIONS.md) 及其链接的实际源码与测试 |

本轮未重新运行 `npm ci`、build、GUI、安装、真实发送或回滚；没有本轮证据的实机项目按未运行或 NOT_TESTED 处理。2026-10-26 历史摘要保留原始日期与含义，不为了让数字一致而改成新结果。

源码导出的 `MANIFEST.json`、`INTEGRITY.json` 和 `verify:source` 验证候选文件一致性，不提供独立来源认证。文档更新后的 main 可以晚于 v0.6.4 tag；不要把新 main 的文档当成原 Release 资产已被重打包的证明。

## 剩余风险与优先级

| 优先级 | 事项 | 下一步需要的证据 |
|---|---|---|
| 高 | 维护时误放宽来源/身份/版本/期限/取消检查 | 每次相关改动核对 ARCHITECTURE 与对应负例测试，保留拒绝未知的行为；不能以演示成功作为放宽理由 |
| 高 | 真实数据、认证或内部资料混入公开内容 | 使用最小公开白名单与扫描，审阅准确文件集合；不读取真实凭据、不公开任务和原始 trace |
| 中 | 早先一次进程未留存且未取得退出码 | 经另行授权后收集产品自身最小脱敏退出证据；一次 cold PASS 不能推导根因已修复 |
| 中 | 新桌面/后端或线程创建版本、分页结构 | 先确认版本和精确结构兼容；未知继续拒绝，不读消息正文或任意数据库内容补证据 |
| 中 | 多屏、混合 DPI、全屏、睡眠、长期冷启动 | 明确环境和授权后逐项实测；不能将单屏 125% 的合法圆整规则扩大成通用像素容差 |
| 后续范围 | 普通 ChatGPT 完整链路、官方 Pet 定位或跨平台 | 独立设计与授权，不把保留研究、固定坐标或预览目标当成已支持能力 |

更完整的问题分类和设计限制在 [KNOWN_ISSUES](KNOWN_ISSUES.md)。这里的优先级描述维护风险，不是新增功能承诺。

## 修改入口

| 要修改的行为 | 首先阅读 | 需要同步 |
|---|---|---|
| Hook 输入、事件落盘、冷启动交接 | [插件 Hook](../plugin/scripts/user-prompt-submit.cjs)、[事件适配](../adapter/entrance-event.cjs)、[主程序](../desktop/main.cjs) | ARCHITECTURE、TESTING、INSTALL 中受影响内容 |
| 分页身份、版本、努力证据 | [分页兼容层](../adapter/paginated-state.cjs)、[事件适配](../adapter/entrance-event.cjs) | ARCHITECTURE、DECISIONS、KNOWN_ISSUES；禁止改为读取正文 |
| 标题与信封 | [标题读取](../adapter/chat-title.cjs)、[信封](../adapter/envelope.cjs)、[信封 schema](../config/task-envelope.schema.json) | ARCHITECTURE 的字段来源与测试矩阵 |
| 提供方身份或素材 | [身份选择](../renderer/provider-identity.js)、[精确目录](../config/provider-catalog.json)、[素材声明](../assets/providers/USAGE.md) | 来源证据、许可、DECISIONS 与测试 |
| 接收、冻结、取消与几何 | [主程序](../desktop/main.cjs)、[主机状态](../desktop/host-state.cjs)、[入口合同](../desktop/entrance-contract.cjs)、[窗口转换](../desktop/native-window-geometry.cjs) | ARCHITECTURE、TESTING 与相关生命周期/几何负例 |
| 纸面、收卷、印记和渲染释放 | [入口时间线](../renderer/entrance-timeline.js)、[Paperlab 入口](../renderer/paperlab-entry.jsx)、[卷纸引擎](../renderer/roll-preview-engine.jsx)、[印记视图](../renderer/provider-seal-view.js) | 动效合同、许可与适用自动/人工检查 |
| 构建与插件分发 | [桌面打包](../scripts/package-desktop.cjs)、[插件打包](../scripts/package-plugin.cjs)、[package.json](../package.json) | SETUP、INSTALL、TESTING，保持版本一致 |
| 公开文档和源码完整性 | README、AGENTS、CLAUDE、本页等六份详细文档及 [源码核验器](../scripts/verify-public-source.cjs) | 公开 checkout 的最小文件集合、MANIFEST/INTEGRITY 与离线核验；不全量发布私有目录 |

公开导出工具属于作者维护环境，未必随公开源码分发；普通读者不需要私有导出器即可按 SETUP 开发。不要为了修复公开文档链接而要求读取原作者私人历史报告。

## 安全维护与交付顺序

1. 确认问题、实际目录、版本与授权范围；说明将改哪些文件、原因及影响。先只读理解，保留最小权限。
2. 若要运行 Terminal，完整列出命令和用途后等待明确授权；联网安装、GUI/观察进程、插件记录变更、Git 发布各按实际范围处理，不能由文档步骤推定获准。
3. 用最小补丁完成目标，不改依赖、许可证、认证/Trust、官方应用、系统设置或用户 Pet，不做无关重构。
4. 按 TESTING 选择适用检查，覆盖关键负例；只有获准才运行。自动检查、构建、预览、真实 warm、真实 cold 与用户自然完整播放分别报告。
5. 同步唯一职责文档，审阅公开文件集合和脱敏结果。修改源码后重新生成并核验候选完整性清单，不能手工改清单掩盖不一致；既有 Release 资产保持独立。
6. 发布前让用户审阅具体范围；仅在明确发布授权及命令授权内提交/推送。交付准确入口、版本/提交、改动文件、实际命令与退出结果、环境变化、回滚和未测项。

文档回滚只撤销本次文档及必要文档发布接线的准确差异，不覆盖其他工作；运行版本、插件启用状态及 Hook Trust 不应因本次文档整理发生变化。插件本身回滚以 INSTALL 为准，不能把已保留旧包或校验通过说成实际回滚已验收。
