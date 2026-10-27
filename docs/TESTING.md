# 测试、真实发送与验收

运行环境和构建顺序以 [SETUP](SETUP.md) 为准，产品安装和回滚以 [INSTALL](../INSTALL.md) 为准。所有命令先按 [AGENTS](../AGENTS.md) 取得适用范围的授权；`npm test` 的授权不包含额外 GUI、进程观察、截图、真实发送或安装操作。

## 分层看结果

| 层级 | 证据 | 能证明什么 |
|---|---|---|
| 快速纯逻辑 | Node 测试、合成对象、受控时钟 | 字段、来源、几何和生命周期约束 |
| 文件/子进程集成 | 临时目录、合成 SQLite、Node 子进程、Windows PowerShell 声明编译 | 文件身份、只读查询、静默 Hook、启动计划；不是 GUI 或模型请求 |
| 隔离 GUI 预览 | 本程序单独 profile、合成内容、窗口与 GPU 证据 | 当前渲染器在此机器的准备、连续播放、清空和取消 |
| 真实 Hook warm | 程序已运行，用户发送新的工作聊天根轮次 | 安装副本到现有正常实例的真实交接 |
| 真实 Hook cold | 无本产品正常实例，用户有效发送 | 安装副本自动启动、自然播放及指定观察期内留存 |
| 人工验收 | 用户看完自然连续播放并报告 | 可见观感、完整阅读和交互体验；分阶段截图不替代它 |

“没有报错”“Hook 收到”“预览通过”“同版本包已安装”分别是不同证据。动画不证明任务成功或模型工作状态。

## npm test 的实际范围

`package.json` 的入口为 `node --test tests/*.test.cjs`。在已准备的源码根目录，获准后执行：

```powershell
npm.cmd test
```

它不需要模型、API key、联网服务或真实用户数据，也不发送 Codex 消息、不点击 Trust。大部分用例是纯逻辑；文件用例在临时目录写入合成 JSONL/SQLite/伪运行时并清理。Hook CLI 用例会启动受控 Node 子进程并覆盖测试用 APPDATA；QA runner 测试使用 dry-run 或注入替身，不启动正常 GUI。Windows 的 `send-observer.test.cjs` 会用系统 PowerShell 解析/编译实际 helper 中的声明，加载 UIAutomation 程序集并运行合成状态检查，不启动实际 UIA 观察器或发送输入。因此不能笼统称整个集合为“无子进程纯单元”。

下面路径均相对 `tests/`；分组为维护定位，不是新的测试脚本或执行顺序。

| 风险 | 对应测试文件 | 主要断言 |
|---|---|---|
| 字段/输出安全与旧状态语义 | `contract.test.cjs`、`adapter.test.cjs`、`writing.test.cjs` | 来源映射、XML 编码、恶意字体 URL、缺失信息、事件顺序、终止不复活；旧 30 秒燃纸分支不代表当前正式发送动效 |
| Hook 入口和目录 | `plugin.test.cjs`、`hook-coldstart.test.cjs`、`hook-directory.test.cjs`、`entrance-ownership.test.cjs` | prompt 丢弃、有界静默、失败不阻塞、附着参数、去重、TTL、真实目录身份/链接拒绝；coldstart 文件名不代表真实冷启动已验收 |
| 根轮次与配置证据 | `paginated-state.test.cjs`、`configured-reasoning.test.cjs`、`main-verification.test.cjs` | 合成 SQLite 的只读固定列/精确版本/同源两读；typed anchor 区分 ordinal 与 byte offset；configured 不冒充 reported |
| 正常主进程接线 | `host.test.cjs`、`send-integration.test.cjs`、`reader-status.test.cjs` | 注入 Electron 替身的主进程、来源重验、ready 后开始、冻结当前内容、观察器状态与 Hook 诊断分开 |
| 开展/阅读与取消 | `entrance.test.cjs`、`motion-preview.test.cjs`、`roll-preview.test.cjs` | 显字后完整静止两秒、时钟单调、隐藏/新内容/失败阻断旧 generation、晚到 ready 不复活 |
| 卷纸/背面/共享运行库 | `folded-paper.test.cjs`、`roll-motion.test.cjs`、`paper-backface.test.cjs`、`paperlab.test.cjs`、`paperlab-fire.test.cjs` | 底部向上卷、UV/轴/原点、弱透墨默认 0.2、资源释放、锁定 Paperlab 实际几何；fire 为保留分支 |
| 飞行/吸收与坐标 | `delivery-motion.test.cjs`、`delivery-host.test.cjs`、`send-geometry.test.cjs`、`mesh-clip-bounds.test.cjs`、`native-window-geometry.test.cjs` | 90°旋转、短弧、逐段裁切、真实三角形边界、目标/几何失效；仅认可有本次转换证明的原生圆整 |
| 提供方和品牌 | `provider-identity.test.cjs`、`provider-assets.test.cjs`、`provider-handoff-regression.test.cjs`、`provider-seal-host.test.cjs`、`provider-seal-motion.test.cjs`、`provider-seal-view.test.cjs` | 精确可信目录、未知通用印、当前事件内容冻结、Logo 静止与外圈旋转、结束全部清空 |
| GUI QA 合同本身 | `qa-delivery-contract.test.cjs`、`qa-delivery-runner.test.cjs`、`qa-paper-backface.test.cjs`、`qa-paperlab-contract.test.cjs`、`qa-paperlab-paused.test.cjs`、`qa-paperlab-runner.test.cjs`、`qa-provider-seal.test.cjs`、`qa-roll-preview.test.cjs` | 合成样本能拒绝伪造/缺失/倒退证据，dry-run 计划只控制本身 profile；不等于运行了 GUI |
| 原生探针合同本身 | `probe-delivery-host.test.cjs`、`probe-provider-seal-host.test.cjs` | 隔离合成目标、终态停止/清空、首个失败不被退出覆盖；不启动真实窗口 |
| UIA 协议和系统编译 | `send-observer.test.cjs`、`ui-send-observation.test.cjs`、`send-diagnostic.test.cjs` | 有界协议、超时/有限重试、身份/代次、固定诊断；Windows 编译和 arm fixture 不查询应用树 |
| 启动与打包 | `desktop-launch.test.cjs`、`plugin-package-current.test.cjs` | SOURCE-MANIFEST 哈希选择、版本一致、运行时白名单、拒绝个人配置；不会创建完整产品包 |

辅助文件 `helpers/rolled-delivery-samples.cjs` 是合成几何样本，`fixtures/send-arm-state.ps1` 只编译声明并测试状态，不运行 UIA。Windows 条件检查在非 Windows 可跳过，不能据此宣称跨平台通过。

内部维护树另有四组、不分发到公开源码的测试：`companion-startup-probe.test.cjs`（固定本机探针函数及合成查询错误）、`probe-codex-public-state.test.cjs`（私有探针计划/替身）、`qa-paperlab-licenses.test.cjs`（依赖内部固定许可归档）、`publication.test.cjs`（公开/私有导出边界与临时合成树）。公开包仍保留所需许可证；公开用户不需要补造这些私人输入来凑测试数。

针对获准修改，可用 Node test runner 指定相关现有测试文件进行快速定位；最终仍运行适用树的完整 `npm.cmd test` 并保留实际退出码。测试失败先定位输入、结构或合同变化，不放宽安全校验、不删除测试、不升级依赖来掩盖失败。

## 隔离 GUI 检查

安装验证通常不需要跑所有 GUI/探针。只有涉及渲染、生命周期或显示兼容的获准变更才选择对应项，先审阅脚本计划和准确参数，再分别说明窗口、输出目录、截图和停止范围。

| 入口 | 作用与限制 |
|---|---|
| `scripts/start-paperlab-preview.cjs` | 人工本地示例预览；先构建，隔离 profile，不读真实会话 |
| `scripts/qa-provider-seal.cjs` / `qa-delivery-preview.cjs` | 当前印记/交付动效的隔离自然遥测及另一次暂停截图；只退出自己 profile |
| `scripts/qa-roll-preview.cjs` / `qa-paper-backface.cjs` | 独立卷纸与背面材质矩阵，操控本程序示例窗口及读取本窗口像素 |
| `scripts/probe-paperlab-host.cjs` / `probe-delivery-host.cjs` / `probe-provider-seal-host.cjs` | 单独 profile 的透明窗口/GPU合成 fixture；可显示、隐藏、捕获自己的窗口；不使用真实 Hook 或官方 Pet |
| `scripts/qa-paperlab-preview.cjs` / `qa-paperlab-paused.cjs` / `qa-motion-preview.cjs` | 保留的 Paperlab/旧火焰分支 QA；其中五秒 hold 合同不替代当前正式两秒阅读合同 |
| `scripts/probe-native-window-geometry.cjs` | 本产品窗口坐标转换诊断；需独立审阅执行方式 |

部分入口支持 `--dry-run`（例如 start-paperlab-preview、qa-provider-seal、qa-delivery-preview 与原生 host probes），只输出计划。不要给不支持该选项的脚本随意加上它；尤其不要把一次计划成功写为 GUI PASS。实际模式需核对脚本要求的 `--development` 或 workspace `--executable`，不复制历史作者路径。

`qa-plugin-entrance.cjs` 的旧 GUI CLI 已主动拒绝启动，不能移除阻断后拿它代替用户发送。内部 `probe-companion-startup.ps1` 会观察本产品进程；`probe-codex-public-state.cjs --run` 会启动独立受限代理；`check:plugin-hooks` 会在隔离 HOME 安装测试市场并起 app-server。它们不是公开安装检查，必须单独审阅和授权，也不能据此证明正在使用的桌面会话已接通。

自然播放阶段不能掺入暂停、seek、截图读回或重播后再声称一条连续证据。暂停图、自然遥测、隐藏零 alpha、绘制计数停止和人工观感分别报告。截图仅限获准的本产品窗口；不抓全屏、全局输入或聊天树。

## 真实 Hook warm / cold

先完成 INSTALL 中的完整市场安装、enabled 核对和用户单项 Trust，记录测试所用安装副本版本、来源市场和运行时位置（公开报告使用相对布局并脱敏）。仅启动新源码或新便携包不等于替换安装副本。

1. **Warm**：确认同版本本产品正常实例已运行。用户在 Codex 工作聊天正常发送自己的消息，形成新根轮次；代理不得代发。核对 Hook 接收/源重验/播放三个阶段，并由用户确认自然完整播放。
2. **Cold**：由用户退出已确认的本产品正常实例，保留官方客户端和 Hook 启用/信任。确认起点无正常实例，再由用户真实发送新根轮次。记录是否自动拉起、是否自然完整播放，以及所说明观察时长内是否留存。
3. **重复与失效**：同轮追加、重放旧事件、过期/错误会话事件、仅切换聊天不应当作新根轮次触发。隐藏、取消、新轮次、几何失效后旧动画不能复活。需要主动制造失效或观察进程时另行授权。

不要求固定测试口令，不承诺固定秒数出现。未取得进程退出码时只报告“未留存/原因未确认”，不能声称偶发退出已根治。cold 是 Hook 自动拉起，不是 Windows 开机自启或重启官方运行时。

## 人工可见验收

用户在一次自然连续播放中核对：白纸取出展开、显字完成、完整阅读 **2 秒**、底部向上卷纸、背面弱透墨（默认 0.2）、屏幕平面旋转 90°、短弧线飞行、逐段吸收；提供方 Logo 静止、外圈单独缓转，最后纸和印记全部清空。显示不抢焦点、不挡输入；结束或隐藏后停止逐帧绘制，旧内容不得闪回。

模型应来自当次事件，标题来自同会话验证名称，不拿 prompt 补字。配置努力显示“配置·高”等并解释未确认当次生效；unknown 保持未知。未知或冲突来源的提供方显示通用印。此临时印记属于本程序，不要求官方 Pet，也不以动画推断任务完成。

每项结果用 PASS / FAIL / NOT_TESTED 并附证据类型。未看见亚秒阶段每一帧时不要用遥测夸大逐帧视觉覆盖。

## 历史与本次证据

| 日期/对象 | 实际结果 | 边界 |
|---|---|---|
| 2026-10-26 / 0.6.4 发布内部基线 | 390/390，无跳过 | 历史作者环境；不是当前源码测试数 |
| 2026-10-26 / 公开源码候选 | 367/367，无跳过；构建/源码完整性检查通过 | 使用已有锁定本地依赖；未做 fresh clone `npm ci` |
| 2026-10-26 / 真实播放 | 作者机器 warm 多次、cold 一次，用户确认 | 桌面/后端/单屏125%限定，详见 PUBLIC-VERIFICATION；不是他人机器验收 |
| 2026-10-27 / 本次交接内部维护树 | `npm.cmd test` 退出 0；394/394，fail/skip/cancel 均 0 | Node 22.20.0 / npm 10.9.3；包含文档随源码/桌面/插件包保留路径的新增回归检查；仅命令测试，不是新 GUI 验收 |
| 2026-10-27 / 本次公开交接候选 | `npm.cmd test` 退出 0；367/367，fail/skip/cancel 均 0；`verify:source` 的 239 个清单条目核验通过，实际文件 240 个（含不自列哈希的 INTEGRITY 自身） | 使用当前项目已有依赖，未做 fresh clone `npm ci`；14 项批准内容差异的暂存检查通过；237 个相对链接无断链，公开内容检查无个人绝对 home 路径或已检查 Token 模式命中；模式扫描是防御措施，不是敏感信息绝对不存在的证明 |

新增文档发布回归检查先得到预期失败（393 pass / 1 fail，仅缺失交接白名单），补齐文档接线后完整集合为上述 394 pass。公开候选的 367 项是本轮在更新后的公开 checkout 独立执行所得；其测试集不包含私有发布回归检查。本次未重新运行 `npm ci`、build、桌面/插件打包、GUI、真实 warm/cold、安装/升级/回滚。文档或发布接线后若再有代码变化，应记录最后一次测试的对象和时点；随后对本页实测证据的回写属于文档与相应完整性清单刷新，不能写成又做了一次运行时或实机验收。

其他 OS、混合 DPI、多屏、全屏、睡眠、长期冷启动和普通 ChatGPT 完整链路仍 NOT_TESTED；早先无退出码的未留存问题仍未确认。当前不宣称所有 Pet 或全部客户端版本支持。

## 交付记录最小字段

记录源码对象/版本、日期、Node/npm、桌面与后端版本、获准命令和退出码、测试数/fail/skip/cancel、构建与实际运行入口、环境变化、证据层级、回滚位置和未测项。真实发送由用户确认，原始诊断不进入公开交付。下一位代理从 [HANDOVER](HANDOVER.md) 查当前状态，不能把本页的历史表当作新一轮验收。
