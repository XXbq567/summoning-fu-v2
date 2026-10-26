# 安装、升级与排错 · 0.6.4

本指南的正式目标是 **Windows x64 的 Codex 工作聊天**。请先读 [README](README.md) 的验证范围；未知版本、普通 ChatGPT 聊天或其他操作系统不能据此宣称已支持。

## 安装前

需要：

- Windows x64；本版实测单屏 125% 缩放。
- 本地 Node.js 22+，且桌面应用的 Hook 环境能通过 PATH 找到 `node`。开发验证使用 Node.js 22.20.0。插件包含 Electron 运行时，Hook 本身仍依赖外部 Node。
- 已安装并登录可使用本地插件与 Hooks 的 Codex。无需提供 API key 给本项目。
- 能使用官方 `codex plugin` 命令的 CLI。记录**桌面应用版本与 CLI 版本各自的值**；终端 PATH 的 CLI 不一定是桌面正在使用的后端。

先检查版本和命令帮助。这些是只读检查；若由 Codex 代办，应先展示命令并取得相应授权。

```powershell
node --version
npm.cmd --version
codex --version
codex plugin --help
codex plugin marketplace --help
codex plugin marketplace list --json
```

本版真实环境是桌面 `26.1021.3705.0` / 后端 CLI `0.164.0-alpha.11.1`。分页入口还检查精确数据库结构、根轮次身份及线程创建版本；目前仅核验 `0.163.0-alpha.10.2`、`0.163.0-alpha.11`、`0.164.0-alpha.11.1` 创建的线程。更老导入聊天或未来结构可能被拒绝，应报告限制，不关闭校验。

## 安装 Release 插件包

1. 打开 [v0.6.4 Release](https://github.com/XXbq567/summoning-fu-v2/releases/tag/v0.6.4)，下载 `Summoning-Fu-plugin-v0.6.4-win32-x64.zip`。它与仅供手动启动的桌面便携包用途不同。需要校验下载时，可把 `Get-FileHash -Algorithm SHA256` 的结果与同一 Release 的校验清单对照。
2. 使用保留全部文件的解压工具，解压到自己拥有权限、以后不会随手删除的本地目录。保留整个目录，包括隐藏的 `.agents`、`.codex-plugin` 以及完整 Electron 文件。不要只取 EXE，不要把 `.agents` 当作系统缓存删掉。
3. 找到包含下列结构的**市场根目录**。如果解压工具多套了一层文件夹，进入真正包含 `.agents` 和 `plugins` 的那一层。

```text
市场根目录/
  .agents/plugins/marketplace.json
  INTEGRITY.json
  plugins/summoning-fu/
    .codex-plugin/plugin.json
    hooks/hooks.json
    scripts/user-prompt-submit.cjs
    adapter/
    runtime/Summoning-Fu.exe
    runtime/resources/app.asar
```

4. 用官方 CLI 添加该本地市场并安装。下面路径是**需要替换的示例**，不是可直接假定存在的目录；应替换为上一步的实际市场根目录。

```powershell
$market = (Resolve-Path -LiteralPath 'D:\Apps\Summoning-Fu-plugin-v0.6.4-win32-x64').Path
codex plugin marketplace add "$market" --json
codex plugin add summoning-fu@summoning-fu-local --json
codex plugin list --marketplace summoning-fu-local --json
```

这些命令会修改本机 Codex 的插件/市场记录，只操作本项目。不要因为名字冲突去清空所有插件、改认证文件或手工覆盖缓存。若已存在 `summoning-fu-local`，先按下方升级流程处理。CLI 不支持这些命令时先停止，核对该 CLI 与桌面版本，不能安装来历不明的兼容脚本。

5. 在 Codex 桌面打开 **Settings → Hooks**，必要时点 **Reload hooks**。找到来源为 **Plugin / 召唤符（summoning-fu）** 的 **UserPromptSubmit**，审阅其命令仅从本插件 `PLUGIN_ROOT` 加载 `scripts/user-prompt-submit.cjs`，然后由用户对**这一项**点击 **Trust**。不要 Trust all；没有对应条目时先排错，不能信任一个相似名字来替代。

安装、启用与信任是三个检查项。官方要求用户审阅当前 Hook 定义；修改定义后可能再次要求 Trust。本项目不写入信任记录，也不使用绕过信任的启动参数。[官方 Hooks 说明](https://learn.chatgpt.com/docs/hooks)

6. 打开一个新的 **Codex 工作聊天**，正常发送一句自己的消息，让宿主创建新的根轮次。无需测试口令、让 AI 执行命令或调用本插件 skill。新安装的插件在新聊天中检查最清楚；仅切换聊天不会触发。[官方插件说明](https://learn.chatgpt.com/docs/plugins)

成功现象是：本地伴随窗口自动出现，白纸展开、字序显现，完整停留 **2 秒**，收卷、转成竖卷、沿短弧线飞入临时提供方印记，然后全部清空。程序可留在托盘；不抢焦点，主画面鼠标穿透。官方 Pet 设置开关独立，保持关闭也能使用。

没有固定“等 5 秒必出符”的承诺：入口需核验当次根轮次并准备本地纸面。重复事件、同轮追加输入、过期或来源不匹配的事件会被忽略。动画不证明模型仍在工作或任务已完成。

## 本机预览、退出与再次打开

在正常程序的托盘菜单或展开读符页选择“预览完整动效”，打开隔离的本地示例。预览不发送消息、不使用真实聊天，也不验证 Hook。

如果另下载完整桌面便携包，可双击其中 `PREVIEW.cmd` 查看预览；`NORMAL.cmd` 启动正常伴随程序并打开读符页，它会先请求本产品旧正常实例退出。**便携包不会升级已安装插件**，未来 Hook 冷启动用的仍是已安装插件内的运行时。

插件运行后通过托盘打开读符、隐藏或退出。插件包中的 `plugins\summoning-fu\runtime\Summoning-Fu.exe --read` 也可用于手动检查同版本读符界面；先退出旧版正常实例以免单实例交接落到旧程序。主画面结束后消失、任务栏没有符窗都不等于程序退出。

临时退出后，只要已信任 Hook 仍启用，下一次有效发送可自动拉起。需要长期停止时，先在 Codex 插件设置停用召唤符，或禁用它的 UserPromptSubmit，再从托盘退出。项目不注册系统启动项、服务或计划任务。

## 升级与回滚

1. 保留原解压市场目录，记录旧版本、原市场路径和当前启用状态；先解压新包并检查完整结构。不要覆盖原目录。可先用以下只读命令查看市场记录与本插件状态，记录 `summoning-fu-local` 的原路径；不要公开粘贴其他市场或个人路径。未知旧路径时不能凭缓存路径猜原市场路径。

```powershell
codex plugin marketplace list --json
codex plugin list --marketplace summoning-fu-local --json
```
2. 从托盘正常退出召唤符。只移除本项目的市场引用，再添加新的市场根目录、安装同名插件：

```powershell
codex plugin marketplace remove summoning-fu-local --json
codex plugin marketplace add "$market" --json
codex plugin add summoning-fu@summoning-fu-local --json
codex plugin list --marketplace summoning-fu-local --json
```

`$market` 必须先设置为新解压目录。该流程在本机使用官方 CLI 实测；不删除原解压目录，不涉及其他市场。升级后确认返回版本为 0.6.4，在 Hooks 刷新并按客户端实际状态重新审阅该单项。不能由程序代点 Trust。

3. 回滚时退出伴随程序，用同样的 marketplace remove/add 与 plugin add 流程重新指向**保留的旧市场目录**，再审阅客户端要求的信任。不要整份恢复旧 Codex 配置覆盖其他插件和后续设置。旧版有其已记录限制，回滚不保证修复当前问题。

若只需卸载本插件：

```powershell
codex plugin remove summoning-fu@summoning-fu-local --json
```

不再使用本市场时，另行执行 `codex plugin marketplace remove summoning-fu-local --json`。退出伴随程序后可删除自己保存的解压目录。不要删除整个 `.codex`、官方客户端、认证记录或其他插件目录。本项目的本地设置可保留以便重新安装；清理用户应用数据应另行确认精确产品目录，不能递归删除用户数据根目录。

## 没有动画时

按顺序定位，不要反复重装或重发历史事件：

| 检查 | 判断与下一步 |
|---|---|
| 预览能否完整播放 | 只证明本地视觉；不能证明真实发送 Hook 已接通 |
| 安装记录是否为 0.6.4、enabled | 先排除旧市场、旧缓存与旧正常实例；仅启动新便携包不算升级 |
| Hooks 是否能看到召唤符且已 Trust | 缺失时核对隐藏目录、市场根和 `node` 的 PATH；不自动改信任或添加根 `plugin.json` |
| 是否是新的工作聊天根轮次发送 | 单纯切换聊天、普通 ChatGPT 或同一活跃轮次的追加并非本版已验收触发 |
| 托盘/读符中的 Hook 接收、核验和播放状态 | “收到”与“已播放”是不同阶段；计数或无报错不能代替用户实际看见完整动画 |
| 版本/来源/结构被拒绝 | 记录桌面与后端版本及固定错误类别，保留 fail-closed；不从别的会话补上相同 turn ID |
| 读符显示“配置·低/高” | 这是配置快照的正常标签，不能把它改写成实际本轮努力；unknown 也不能随机补值 |
| 模型正确但提供方是通用印 | 检查精确目录和 reported 来源；未收录别名或公司冲突时通用印符合边界，不是强制 OpenAI 的理由 |
| 首次显示取消或窗口尺寸变化 | 0.6.4 修复了本机 125% 合法圆整的误取消；其他显示器条件仍需实测，不能任意加坐标容差 |
| 冷启动后程序不留存 | 记录是否从无正常实例开始、实际看到什么及是否获得退出码；本版一次通过不代表所有偶发退出已根治 |

请求帮助时只提供版本、固定状态类别、是否出现完整动画及经过脱敏的最小证据。不要上传真实聊天标题、任务正文、完整数据库、Hook 原始 stdin、认证文件、Token 或全屏截图。不要把窗口标题、PID/HWND 或固定屏幕位置当成会话/官方 Pet 身份证明。

## 从源码构建

在 Windows x64 的源码根目录执行以下步骤。`npm ci` 依据锁文件安装，可能访问 npm 和 Electron 的官方发行来源；应获得用户允许后进行，不全局安装，不升级锁定依赖。

公开源码先提供离线完整性检查：

```powershell
npm.cmd run verify:source
```

该命令用随源码提供的 INTEGRITY 清单核对 SHA256；也可在安装依赖或构建后运行，允许 `.git`、`node_modules`、`dist`、本地诊断目录与生成的预览 HTML 存在。它不访问网络，不是数字签名；源码和清单一起被替换时不能仅凭自带清单证明发布者身份，应同时核对可信 Release 来源。

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run package:desktop
npm.cmd run package:plugin
```

- `build` 生成本地 Paperlab 运行包与预览 HTML。
- `package:desktop` 输出 `dist/releases/<时间戳>/Summoning-Fu-win32-x64/`。
- `package:plugin` 检查版本与源码一致，输出 `dist/plugins/summoning-fu-0.6.4-win32-x64-<时间戳>/`，这是安装步骤需要的市场根目录。
- 打包不自动安装、不更改信任，也不启动官方会话。源码、插件 manifest、锁文件版本必须一致，修改后应重新依次构建，不能用旧桌面包塞入新插件。

公开源码候选实际完成构建与 367/367 测试，无跳过；作者内部基线为 390/390。公开版本不带私人探测、许可采集和归档资料，因此相应四组检查不进入公开测试集；分发所需的第三方许可仍随源码与包保留。作者使用已有锁定本地依赖验证公开候选，没有替读者完成新机器的 `npm ci` 或实机验收。

仅开发启动可用 `npm.cmd start -- --development`；隔离源码预览使用 `node scripts/start-paperlab-preview.cjs`，或双击源码目录的 `PREVIEW-MOTION.cmd`。该预览先构建本地资源，使用独立示例用户目录，不启动真实会话观察。正常源码启动或预览都不能代替已安装插件的真实冷启动验收。不要运行会控制共享正式实例的旧 QA 脚本来冒充用户发送。

当前复用锁定的 Electron 44.9.3、Paperlab 0.8.1、Three.js 0.186.0、GSAP 3.15.0 与相关依赖。许可见 [第三方声明](THIRD-PARTY-NOTICES.md)；GSAP 不应笼统标成 MIT，OpenAI 标志也不是开源插画许可。
