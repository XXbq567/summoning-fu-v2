# 开发环境、启动与打包

本页是维护者的环境与源码操作入口；终端用户的安装、升级、卸载、Trust 和回滚只按 [INSTALL](../INSTALL.md)。执行权限与隐私边界按 [AGENTS](../AGENTS.md)。下列命令是待授权的操作说明，不代表已经执行。

## 先确认手中的目录

| 目录 | 用途 | 不能据此推断 |
|---|---|---|
| 公开 Git checkout / Release source | 编辑源码、安装锁定依赖、测试、构建 | 不是可直接添加的插件市场 |
| 完整桌面便携目录 | 手动启动正常程序或隔离预览 | 不会更新 Codex 已安装的插件 |
| 完整本地市场目录 | 含 `.agents/plugins/marketplace.json` 和 `plugins/summoning-fu/`，供官方 CLI 安装 | 尚未安装、启用或受信任 |
| Codex 插件缓存中的副本 | 实际 Hook 冷启动使用的安装副本 | 修改源码、启动新便携包不会同步更新它 |

公开 checkout 的 `package.json` 经审阅转换：增加 `verify:source`，移除内部的 `check:plugin-hooks`。内部维护树包含额外探针、归档工具与四组测试；不能把内部目录或报告当作公开 clone 的必需依赖。

## 系统和锁定依赖

正式目标为 Windows x64。源码要求 Node.js **22+**；实际开发与本次命令验证使用 Node **22.20.0**、npm **10.9.3**。Hook 在宿主环境通过 PATH 调用外部 `node`；安装包内 Electron 不能替代这项要求。桌面客户端版本、桌面后端 CLI 版本和终端 PATH 中 CLI 版本要分别记录，实机支持范围见 [公开验证摘要](PUBLIC-VERIFICATION.md)。

`package.json` 与 lockfile 根项目均为 **0.6.4 / UNLICENSED**，直接依赖使用精确版本：

| 依赖 | 版本 | 用途 |
|---|---|---|
| Electron | 44.9.3 | 桌面运行时，项目本地安装 |
| Paperlab / Three.js / GSAP | 0.8.1 / 0.186.0 / 3.15.0 | 纸面、几何与动效 |
| React / React DOM / React Three Fiber | 19.2.8 / 19.2.8 / 9.7.0 | 共享渲染实现 |
| esbuild / Electron Packager | 0.25.12 / 20.3.0 | 锁定构建工具；当前桌面打包直接复制本地 Electron 并生成 ASAR |

不需要本项目的 API key、数据库服务、云账户、MCP 端口或模型工具调用。运行时读取本地元数据不等于调用网络模型 API；Codex 自身发送的模型请求是宿主行为。正常窗口的 Web 请求仅允许本地 `file:`、`data:`、`devtools:`，纸面与标志不从远程 CDN 加载。

正常桌面启动还会拉起固定的系统 Windows PowerShell 辅助进程（`%SystemRoot%/System32/WindowsPowerShell/v1.0/powershell.exe`），加载 Windows UI Automation 程序集，尝试受限的发送控件观察。它与正式 Codex Hook 入口并行；普通 ChatGPT 路径仍未完整验收，不是安装前提，也没有用户可配置的通用观察开关。系统策略阻止它时保留不可用诊断，不修改策略或添加绕过参数。隔离 `--paperlab-preview-only` 预览不会启动它。开发测试也有合成 PowerShell 编译检查，见 [TESTING](TESTING.md)。

## 全新公开 clone

在已确认的源码根目录操作。先核对来源与锁文件；不要把解压后的插件市场当作源码。只读版本检查及产品安装命令见 INSTALL。

公开源码可在安装依赖前离线核验：

```powershell
npm.cmd run verify:source
```

它读取 `INTEGRITY.json`，核对每个文件的字节数、SHA256、路径和完整列举；不启动程序或联网，也不需要 `node_modules`。它不是签名或独立来源认证。允许的输出目录是 `.git`、`node_modules`、`dist`、`qa`，另允许根目录生成的 `SUMMONING-FU-PREVIEW.html`；新增未登记的源码或文档会失败。内部维护树没有这个 npm script 和公开 INTEGRITY，不能照搬此命令。

源码构建顺序如下。`npm ci` 会重建本目录 `node_modules`，依据 lockfile 下载依赖，可能访问 npm 和 Electron 官方发行来源并执行依赖安装脚本；须先获准联网安装，不升级 lockfile或全局程序。

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run package:desktop
npm.cmd run package:plugin
```

测试范围与副作用见 TESTING。后四步使用项目本地依赖与资源；打包计划声明无网络下载。缺失依赖时应回到获准的 `npm ci`，不临时下载可执行文件或换用全局 Electron。

## 已有依赖的维护树

已有 `node_modules` 的测试和构建，只证明当前机器上的这组依赖可用。2026-10-26 公开候选曾借用本机已有锁定依赖完成验证，没有验证 fresh clone 的下载与安装。本次交接也没有运行 `npm ci`。不要为文档交接重装、升级或将临时链接写入公开包。

修改了源码或包内文档后，从测试、build、桌面打包到插件打包依次执行获准步骤；不能把旧 `app.asar` 放进新的插件目录。锁文件变化应作为单独依赖变更审阅。

## 启动方式和单实例

以下操作会打开本地窗口并可能写入产品数据或预览目录；代理执行前按 AGENTS 展示具体命令和影响。

| 入口 | 实际行为 |
|---|---|
| `npm.cmd start` | `scripts/start-desktop.cjs` 优先选择版本和 `SOURCE-MANIFEST.json` 全部源文件哈希匹配的便携构建；否则使用项目本地 Electron |
| `npm.cmd start -- --development` | 强制本地 Electron 运行当前源码；仍使用正常产品用户目录、单实例锁与观察器 |
| `START-SUMMONING-FU.cmd` | 源码启动器的 detached 形式；不会先退出已有正常实例 |
| `node scripts/start-paperlab-preview.cjs` / `PREVIEW-MOTION.cmd` | 先构建 Paperlab，再在 `qa/paperlab-preview-local/summoning-fu-preview-local-<随机值>` 建独立示例目录并打开预览；不读取或绑定真实会话 |
| 便携包 `PREVIEW.cmd` | 使用临时目录中的独立示例预览 |
| 便携包 `NORMAL.cmd` / `START.cmd` | 先向同一产品用户目录中的旧正常实例发 `--quit`，等待约两秒，再启动 `--read` |

正常程序的第二实例会将参数交给已运行实例；`--development` 不是隔离用户目录的开关。源码启动器不会自动替换旧实例。测试当前源码前，应由用户退出已确认的本产品正常实例，再启动所选版本；不要停止官方 Codex。正常产品退出后，已受信任且启用的 Hook 可在下一次有效发送重新启动安装副本。

独立 `--paperlab-preview-only` 和离线 HTML 使用本地合成内容。正常程序托盘打开的预览可使用 `frozen-current` 当前真实符内容，标题、模型与目录末级名仍可能私密；预览不发送消息，均不能证明 Hook、会话关联或真实冷启动。真实验收按 TESTING，完整安装步骤按 INSTALL。

## 构建产物

| 操作 | 写入及检查 |
|---|---|
| `build:paperlab` | `renderer/generated/paperlab-runtime.js`；`qa/paperlab/bundle-metafile.json`；嵌入本地字体、声明与锁定运行库 |
| `build` | 上述运行包，加根目录 `SUMMONING-FU-PREVIEW.html`；离线 HTML 复用桌面预览控制器 |
| `package:desktop` | 再构建 Paperlab；写入 `dist/staging-<随机值>/`、`dist/releases/<时间戳>/Summoning-Fu-win32-x64/`，生成 `resources/app.asar`、外置 PowerShell helper、启动器和 `SOURCE-MANIFEST.json` |
| `package:plugin` | 要求 Windows x64；选取最新桌面目录并逐项核对项目/插件/运行时版本、内含源码及文档；写入 `dist/plugins/summoning-fu-0.6.4-win32-x64-<时间戳>/` 和包内 `INTEGRITY.json` |

最后一项输出的目录才是 INSTALL 中应添加的市场根。打包不安装、不改变启用或信任、不创建官方会话；版本相同也不能跳过源码一致性检查。

## 环境变量与配置

本项目没有 `.env` 加载器，不需要创建或读取 `.env`。不要为排错输出整份进程环境。

| 名称 | 来源和作用 |
|---|---|
| `PATH` / `Path` | 操作系统提供；Hook 需找到 Node，用户安装流程需找到官方 CLI |
| `PLUGIN_ROOT` | Codex 执行插件 Hook 时提供；固定加载本插件 `scripts/user-prompt-submit.cjs`，用户无需手工配置 |
| `APPDATA` | Windows 提供；Hook 用于 `%APPDATA%/summoning-fu-handoff` 产品目录，缺失则保守拒绝 |
| `CODEX_HOME` | 可选；已有宿主约定的本地 Codex 元数据根；未设置时用用户目录下 `.codex`。不是凭据来源或建议随意切换的调试开关 |
| `SystemRoot` | 定位系统 Windows PowerShell，缺失时使用固定 Windows 系统目录回退 |
| `ELECTRON_RUN_AS_NODE` | 启动器从子进程环境删除此变量，避免 Electron 被当成 Node；不要设置空字符串来替代删除 |
| `TEMP` / `TMP` | 系统临时目录及便携预览目录；不是持久配置 |
| `NODE_ENV` | 构建时固定为 `production`，不是运行时模型配置 |

安全显示别名是可选 JSON：源码位置 `config/display-aliases.json`；打包后位于运行时 EXE 同目录 `display-aliases.json`，示例只有 `relay: null` 与 `companies: {}`。读取上限 64 KiB，不填 URL、Token 或凭据。别名不能代替精确提供方目录的来源证据；未知或冲突仍用通用印。个人别名不进入公开导出或插件打包。

## 本地数据和外部读取

| 位置 | 数据与生命周期 |
|---|---|
| `%APPDATA%/summoning-fu-handoff/summoning-fu-settings.json` | 产品位置、受限手动绑定等设置；临时文件后原子重命名写回；`petPosition` 属于本程序，不是官方 Pet 坐标 |
| 同目录 `entrance-events/<事件哈希>.json` | Hook 允许字段的短期交接；有 TTL、去重、目录身份与容量限制；清理过期条目，不能当审计归档或重放源 |
| 同目录 `hook-stages.jsonl` / `entrance-status.json` | 有界固定阶段诊断 / 脱敏准入状态，不包含原始 Hook stdin；也不应整目录上传 |
| 同目录 Electron 缓存与锁 | 正常单实例和运行时缓存；不把缓存内容作为来源身份 |
| 源码 `.runtime/hook-spool/` | 保留的 `adapter/hook-handoff.cjs` 默认交接目录；不是正式插件 UserPromptSubmit 的 entrance-events 入口 |
| 源码 `qa/` 或显式获准的 diagnostics/capture 目录 | 构建清单、隔离示例 profile、QA 证据与本产品窗口截图；不公开原始 trace |
| `CODEX_HOME` 或默认 `.codex` | 只读的 `session_index.jsonl` 标题、受约束的 `sessions/rollout-*.jsonl` 事件验证；分页模式固定 `state_5.sqlite` 与 `thread_history_1.sqlite` 元数据列 |

分页 SQLite 使用 Node 内建 `node:sqlite` 只读连接、禁用扩展、参数化固定查询、精确结构/创建版本/同 session-turn-root/来源时间与两读一致性检查；不是官方稳定观察 API。未知结构或版本失败时保留拒绝。配置努力为 `configured`，界面显示“配置·高”等且未确认本次生效；不能写成当次 `reported`。正常分页 Hook 分支丢弃 prompt，不查询消息正文；保留的手动 `RolloutAdapter` 会解析明确选定 JSONL 的 user-message 文本到旧 Envelope，随后入口以已验证标题覆盖纸面任务字段，不能据此声称所有历史路径完全不读正文。

保留的定位研究还可选择读取 `.codex-global-state.json` 的窗口 bounds 字段，手动绑定功能可读取用户明确选定的 JSONL；均不构成官方 Pet 定位。维护时不要为排错打开聊天正文、任意数据库、认证文件或个人配置。更完整的数据合同见 [架构说明](ARCHITECTURE.md)。

本项目没有自己的云数据库或初始化/迁移命令；上述 SQLite 由 Codex 管理，本程序不建立或迁移它。运行中的 adapter、显示别名和已核验当前内容主要保留在进程内存，不能用本产品缓存补造缺失来源。

## 发布和回滚交接

源码、便携、插件市场和已安装缓存分别验收。源码/文档变更需进入公开导出的精确文档白名单；公开 checkout 的 MANIFEST 和 INTEGRITY 应记录批准变更后的真实字节与哈希，并保留可审阅差异，不能为了消除失败改掉检查规则。生成包另有自己的源清单/包完整性清单，不能混用。源码核验成功不证明现有 Release 或安装缓存已更新。

维护者更新公开源码时，清单按以下顺序处理；这属于源码维护，用户单纯安装或验证时不应重写清单：

1. 先审阅并批准明确的增删改文件集合，检查新文档的相对链接、隐私和许可；保留变更前后的差异。发布者使用受审阅的本地导出白名单生成候选；只有公开 clone 的维护者不需要取得私有归档或运行私有导出器。
2. 对最终源文件字节计算长度和 SHA256，准确更新 `MANIFEST.json.files` 的批准集合，以及相应 `publicDocuments`、`transformed`、排除说明和扫描记录。未重新扫描时不能沿用历史 `scan.result: PASS` 冒充本次扫描；应如实记录本次检查范围及未测项，另行取得所需扫描证据。
3. 先完成 MANIFEST 的最终序列化。它的 `files` 不包含 MANIFEST 自身；`INTEGRITY.json.files` 包含同一源文件集合，并另含 MANIFEST 最终字节数和哈希。INTEGRITY 不列自身，不能用一个旧清单去证明另一个新清单。
4. 审阅两份清单的差异，再运行本页的公开 `verify:source`；任何未批准的差异都应先解释或恢复，不能扩大忽略目录、删除检查或重写哈希掩盖来源变化。校验通过只证明当前文件与当前清单一致。

新公开产物只携带审阅过的文档、源文件、许可证、字体与品牌使用条件；不带作者绝对路径、个人别名、真实会话、参考图或原始 QA。原创仍 UNLICENSED，GSAP 许可和品牌条件见 [第三方声明](../THIRD-PARTY-NOTICES.md)。

本页不授权提交、推送、覆盖既有 Release、安装或清理目录。开发回滚保留获准变更的可审阅补丁，恢复对应源码后重新测试/构建；产品回滚保留旧市场目录并按 INSTALL 操作。发布状态与未测项交给 [HANDOVER](HANDOVER.md) 记录，不继承上一台机器的 PASS。
