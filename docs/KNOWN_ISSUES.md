# 已知问题、限制与未测项 · 0.6.4

审计日期：2026-10-27。本文区分已观察问题、明确设计限制、未完成验收和未来方向。代码检查不等于客户端实测；历史结论以 [PUBLIC-VERIFICATION.md](PUBLIC-VERIFICATION.md) 为准。本轮没有修复运行时、安装插件或重新做GUI验收。操作排错见 [INSTALL.md](../INSTALL.md)，结构见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 1. 已观察但原因未确认的问题

| 编号 | 状态与实际证据 | 当前处理与关闭条件 |
|---|---|---|
| K01 · 早先一次正常进程未留存 | 原因未确认。历史一次未取得退出码；0.6.4后来真实warm多次播放、一次从无正常实例自动cold均由用户确认，不能据此声称所有偶发退出根治 | 如再次发生，先记录确切版本、是否无正常实例起步、Hook准入阶段与用户实际现象；有明确授权再收最小进程退出证据。关闭需要可重复场景、退出码/原因及针对性连续自然播放证据，不能靠阶段计数或预览替代 |

现有公开证据未建立其他“已经复现、根因明确但尚未修复”的运行时缺陷清单。下面的限制不能为了填满列表编造为bug，也不能因测试通过一概标已解决。

## 2. 明确的功能与兼容限制

| 编号 | 限制/可见表现 | 依据与维护要求 |
|---|---|---|
| L01 · 仅正式声明Windows x64工作聊天 | 其他平台、普通ChatGPT或任意Codex版本不能直接继承本版支持；Hook仍需要桌面环境PATH中的外部Node22+ | [插件脚本](../plugin/scripts/user-prompt-submit.cjs)、[包入口](../scripts/package-plugin.cjs)、[公开验证](PUBLIC-VERIFICATION.md)；先核对桌面与其后端版本，终端PATH版本不足以证明桌面版本 |
| L02 · 分页结构及创建版本精确锁定 | 不在三项创建版本白名单、结构/来源/主键不符、导入旧线程、子代理线程或非最新root会保守拒绝；宿主升级可能停用 | [paginated-state.cjs](../adapter/paginated-state.cjs)；这是非官方兼容层。不能以当前CLI新版本、相同turn ID或另一会话补来源，不能关闭校验求演示 |
| L03 · 仅新根提交触发 | 打开/切换聊天、同一活跃轮次追加、重复Hook、过期入口、跨会话旧源和顺序不明事件可能不播放 | [入口核验](../adapter/entrance-event.cjs)、[EntranceScheduler](../desktop/host-state.cjs)；不新增“切聊天即出符”承诺，不重放私有历史入口冒充真实发送 |
| L04 · 字段可以unknown/pending | 新聊天名称未就绪显示“新启一程”；未取得努力则空缺/未取得。分页配置显示“配置·高”等，不证明本次实际努力 | [Core](../renderer/ritual-core.js)、[applyVerifiedReasoning](../adapter/entrance-event.cjs)、[配置检查](../tests/configured-reasoning.test.cjs)；禁止prompt填标题、默认值冒充reported |
| L05 · 品牌目录有意有限 | 精确目录未收录、来源不可信或公司冲突时显示通用印，即使模型名称看似熟悉 | [provider-identity.js](../renderer/provider-identity.js)、[审阅记录](../config/provider-catalog.json)；增加条目需要精确证据、素材条件和回归核对，不用前缀/中转别名猜公司 |
| L06 · 没有真实官方Pet定位 | 纸送往本程序临时印记；preview-example、settings.petPosition、最后记录窗口外框均不是官方Pet身份或坐标 | [DeliveryTargetBridge](../desktop/host-state.cjs)、[delivery-motion.js](../renderer/delivery-motion.js)、[window-target.cjs](../desktop/window-target.cjs)；保留研究接口不等于联动已实现 |
| L07 · 布局与几何失败就取消 | workArea放不下纸和印记时不播；显示器改变或后续窗口移动/缩放取消当前代；0.6.4仅接受有原请求转换证明的首次原生圆整 | [prepareLocalSealLayout](../desktop/host-state.cjs)、[native-window-geometry.cjs](../desktop/native-window-geometry.cjs)；不能增加通用一像素容差逃避取消 |
| L08 · GPU/字体准备可能失败或超时 | 字体、纹理、WebGL或shader未就绪时不播放；宿主准备上限12秒，其他内部准备也有界；不承诺提交后固定几秒出现 | [rendererReady/applyEntrance](../desktop/main.cjs)、[paperlab-entry.jsx](../renderer/paperlab-entry.jsx)；记录固定错误类别，不能自动换廉价替代效果称已通过 |
| L09 · 系统减弱动效未成为正式宿主策略 | 当前 `entranceMotionPolicy`记录偏好但强制 `effectiveReducedMotion=false`，保留全程动效；纯时间线静态分支存在 | [host-state.cjs](../desktop/host-state.cjs)、[host.test.cjs](../tests/host.test.cjs)；不能宣传系统减弱动效会自动缩减正式动画。未来调整需用户授权且保持阅读/过期/不复活合同 |
| L10 · 字体并不覆盖全部Unicode | 毛笔字体缺字回退本机系统字体；覆盖表不可用时未验证。系统回退字体也不能保证任意字符有字形 | [font-coverage.js](../renderer/font-coverage.js)、[reader.js](../desktop/reader.js)；区分字形回退与数据丢失，不宣传全Unicode支持 |
| L11 · 观察事件不证明服务端或任务状态 | UIA Invoke只证明控件调用；动画、Hook queued/applied计数及自然清空都不能证明模型成功、任务完成或进度 | [SendAdmissionGate](../desktop/host-state.cjs)、[entrance-timeline.js](../renderer/entrance-timeline.js)；当前视觉保持一次性展示语义 |

## 3. 保留兼容路径与文档维护债务

| 编号 | 当前事实 | 接手时的安全边界 |
|---|---|---|
| M01 · 旧30秒状态/信封与当前入口并存 | `Session`、旧HookAdapter、`task-envelope.schema.json`、示例任务和燃烧/折纸模块仍在；当前正式入口是一次性2秒阅读后卷纸退印 | 旧schema不是入口事件schema，旧状态文字/文件名不定义当前行为。先查真实调用链，再决定是否单独提出清理任务；本交接未删除兼容代码 |
| M02 · 手动旧日志适配仍解析正文 | 用户手动绑定的 `RolloutAdapter`解析所选JSONL的UserMessage文本并放入旧Envelope，`applyEntrance`再用同会话标题替换展示内容。旧 `sanitizeHook`也保留有界净化prompt | 当前插件正常入口丢弃prompt、分页查询固定元数据；不能扩展为“整个仓库所有代码从不解析正文”。未经明确授权不使用手动绑定读取真实聊天做排错；见 [rollout.cjs](../adapter/rollout.cjs)、[hook.cjs](../adapter/hook.cjs)、[main.cjs](../desktop/main.cjs) |
| M03 · 托盘预览可含真实字段 | `showMotionPreview`有当前metadata时冻结当前符；否则合成示例。独立隔离preview才明确不绑定真实会话 | 预览不发送消息、不验证Hook，但正常托盘预览截图可能泄露标题/model/项目末级名；公开演示用隔离示例；见 [main.cjs](../desktop/main.cjs)、[start-paperlab-preview.cjs](../scripts/start-paperlab-preview.cjs) |
| M04 · UIA是正常实例并存进程 | 正常main除隔离preview/直接motion-preview启动外会start SendObserver；不是“只有显式开启时才启动”。Hook不依赖UIA且有取消所有权隔离 | 不启动正常程序来做纯说明任务；GUI观察需授权。UIA仅读控件归属/几何和固定名称枚举，不读编辑框值、不主动点击；见 [main.cjs](../desktop/main.cjs)、[windows-send-observer.ps1](../desktop/windows-send-observer.ps1) |
| M05 · 内部历史资料与公开快照不同 | 私有完整树保留额外QA、归档和历史资料；公开源码测试集排除依赖私人资料的四组检查，旧绝对预览/打包路径可能已失效 | 交付只用当前入口与公开摘要；不把私有历史文件作为读者必需依赖，不覆盖已发布包/清单、不恢复已清理旧构建目录来凑证据 |
| M06 · 源码目录与运行时目录审阅记录双份 | `provider-identity.js`执行品牌决策，JSON目录保存对应审阅记录；generated bundle又是构建产物 | 只改JSON不会自动生效，只改generated会丢失来源。未来修改应同步人工源码/审阅记录，再按构建顺序生成并校验同版本包 |

这些事实需要准确文档和独立授权的后续工作，不在本轮偷偷改代码或扩大读取范围。

## 4. 本版未完成实机验收

| 条件/链路 | 状态 | 可用证据与缺口 |
|---|---|---|
| 普通ChatGPT聊天UIA全链路 | NOT_TESTED | 有协议/包装器/有界重试/所有权检查及单元覆盖；没有足以宣称正式可用的用户真实完整链路证据 |
| 其他OS/架构 | NOT_TESTED | Release为Windows x64；不能按Electron跨平台能力推断本产品通过 |
| 混合DPI、多屏、跨屏、全屏 | NOT_TESTED | 公开真实验收仅单屏125%；部分纯几何检查不是这些显示环境的实机验证 |
| 睡眠恢复的完整真实使用链路 | NOT_TESTED | 源码有取消/恢复等待新事件及旧adapter暂停逻辑，缺本版完整用户验收 |
| 长期cold启动压力与所有偶发退出 | NOT_TESTED | 历史一次真实cold通过不证明长时稳定、开机启动或全部退出问题已解决 |
| 真实官方Pet目标/各种Pet类型 | 未实现/NOT_TESTED | 无受支持定位适配器；临时自有印记与示例目标不能充当该验收 |
| 新机器全新依赖安装及完整使用 | 按机器单独验收 | 作者公开候选用既有锁定依赖验证；读者仍需获准安装、版本核对、单项Trust与真实发送 |
| 保留旧版本的实际回滚 | NOT_TESTED（真实操作） | 存在回滚包/完整性核对不等于本机已执行回滚；回滚方法见INSTALL，不能覆盖其他插件或认证配置 |

上表沿用公开验证结论的边界；本轮文档与自动检查不将NOT_TESTED升级为PASS。后续验收应分别记录预览、安装记录、Hook可发现/启用、用户Trust、真实warm、真实cold及自然完整播放，不合并成一个“能用”。

## 5. 未来扩展方向（未承诺、未实施）

| 方向 | 开始前需要的证据/决定 |
|---|---|
| 宿主版本升级适配 | 合法来源的结构/事件合同、合成fixtures、精确版本核验、同session/root/time/anchor回归，最后真实warm/cold；不能直接加未来版本白名单 |
| 普通Chat发送支持 | 经授权的最小控件核验、明确模式/归属、输入不采集、父进程/心跳生命周期以及真实连续播放；不得把UIA改成全局监听 |
| 真实Pet目标联动 | 先取得受支持、可验证的宿主定位通道及坐标/时效/身份合同；未来通过Node边界进入DeliveryTargetBridge，禁止renderer自行声明来源 |
| 更多提供方/模型 | 精确ID官方证据、公司与relay区分、品牌素材来源/使用条件、未知和冲突回退；不引入远程素材URL |
| 可访问性/减弱动效 | 用户明确的产品策略，保持完整可读与自然过期，不复活旧代，不伪造与当前合同一致；独立验收 |
| 隐私与兼容代码收敛 | 先评估旧手动binding/旧Hook使用者及schema依赖，再提出最小方案；不因正常入口已最小化就忽略保留代码的正文处理事实 |
| 长期稳定性与显示矩阵 | 明确获准条件、退出证据和脱敏记录；禁止未经同意启动长期观察或捕获全屏/全局输入 |

开始这些工作需单独范围说明与用户授权。原创许可继续UNLICENSED，不能以“维护”名义替换许可、升级锁定依赖、修改Trust或发布到外部。
