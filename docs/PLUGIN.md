# 本地 Codex 插件

本项目使用 UserPromptSubmit hook 加独立 Electron 伴随窗口。需 Windows x64、Node.js 22+、Codex 精确版本 `0.163.0-alpha.10.2` 或 `0.163.0-alpha.11`。它不替换官方 Pet，不监听仅切换聊天，也不发送模型请求。

## 构建与安装

先在源码根目录执行 `npm ci`、`npm test`、`npm run build`，再依次执行：

```powershell
npm run package:desktop
npm run package:plugin
```

保留输出市场目录的完整结构。下面 `EXAMPLE-BUILD` 是**必须替换的示例占位符**，不是仓库附带的包；把它替换为刚生成的目录名。在项目根目录运行：

```powershell
codex plugin marketplace add ".\dist\plugins\summoning-fu-0.4.1-win32-x64-EXAMPLE-BUILD"
codex plugin add summoning-fu@summoning-fu-local
```

这些安装命令会修改本机 Codex 插件配置。源码仓库本身不是已构建市场，不能省略打包步骤直接当可运行插件安装。打包不会自动安装或信任 hook。

在 Codex **Settings → Hooks** 中刷新 **Reload hooks**，找到来源为召唤符插件的 **UserPromptSubmit**，审阅命令确认仅调用本插件的 `scripts/user-prompt-submit.cjs`，再对这一项点击 **Trust**。不要顺带信任其他来源。已信任且定义未变化的项无需重复授权；定义改变时按客户端提示重新审阅。设置名称可能随客户端更新变化，若未出现目标 hook，不要盲目信任其他条目。

在本地执行环境的聊天发送消息并产生新根 turn，约 5 秒后才会展示。打开、切换聊天或仅启动伴随程序不触发自动入场。缺必要事件字段、不支持的版本或来源核验失败时会跳过。

## 升级本地市场

新包是另一个输出目录。退出伴随程序后，可卸载旧插件并移除旧市场引用，再用新目录重复上面的安装步骤：

```powershell
codex plugin remove summoning-fu@summoning-fu-local
codex plugin marketplace remove summoning-fu-local
```

移除本项目市场引用不会替你删除原构建目录。升级后刷新 Hooks，按当前定义的信任状态处理；不要以“安装成功”代替 hook 已启用、已审阅或已实际触发的证据。

## 展示内容与来源

| 内容 | 来源 |
|---|---|
| 模型 | 当次 UserPromptSubmit.model |
| 聊天标题 | session_id 精确匹配的 session_index.jsonl.thread_name |
| 推理强度 | 同一 session、根 turn、模型且 start 之后的 turn_context.effort，允许 none/minimal/low/medium/high/xhigh |
| 工作环境 | 当次 cwd 的末级目录名 |
| 中转站、公司 | 无可信映射时保持 unknown；符面可用装饰代替，装饰不是来源证明 |

标题缺失显示装饰题辞，不回退 prompt。推理上下文缺失或冲突时仍可正常出符，但强度为 unknown，不沿用旧轮次值。标题索引不表示当前 UI 焦点；展示语义为最近有效发送。

hook 不保存 prompt 正文；它将有限元数据交接到本产品本地事件目录。宿主为核验来源会有界读取本机 rollout 文件；其他文本不作为符面内容。标题、模型和环境本身仍可能是私人信息，请勿公开真实运行截图或配置。详见 [适配说明](ADAPTER.md)。

## 退出、停用、卸载

临时退出：在读符窗口或托盘菜单选择“退出召唤符”。也可在源码目录执行 `npm start -- --quit`。若插件 hook 仍启用且受信，下次有效发送可以重新启动伴随程序。

要停止自动入场，先在 Codex 插件设置禁用召唤符，或在 Hooks 禁用它的 UserPromptSubmit，然后退出伴随程序。要卸载，执行上面的 `codex plugin remove`；不再使用此市场时再执行 `marketplace remove`。

确认停用并退出后，可自行清理本项目的构建输出或用户应用数据目录中的 `summoning-fu-handoff` 产品子目录。不要删除整个 Codex 配置目录、凭据、官方安装目录或其他插件数据。Windows 最终文件访问权限由所在用户目录 ACL 决定。
