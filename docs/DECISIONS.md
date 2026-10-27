# 设计决策交接 · 0.6.4

审计日期：2026-10-27。以下是从现有实现与公开验证范围重建的决策记录，不表示本轮重新选型或开发了这些能力。实际环境证据只引用 [PUBLIC-VERIFICATION.md](PUBLIC-VERIFICATION.md)；模块和数据流见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## D01 · 用短时Hook把本机元数据交给独立伴随进程

**采用：** 注册官方UserPromptSubmit命令Hook，从 `PLUGIN_ROOT`加载固定脚本；stdin有界，prompt丢弃，事件先写本产品目录，再以 `--entrance-file=<file>`启动/唤醒单实例。Hook静默、异步、约1.45秒自行截止，宿主超时2秒，失败退出0。

**未采用：** 让模型调用skill/工具驱动视觉、把显示文本写stdout成为开发者上下文、持续占用Hook、注入官方应用或绕过Trust。结果是视觉不新增模型调用，错误不阻断宿主；代价是入口文件/外部Node/单实例交接也必须维护。Hook成功交接不等于实际画面完整播放。Trust必须由用户在客户端单项审阅。

**证据：** [hooks.json](../plugin/hooks/hooks.json)、[user-prompt-submit.cjs](../plugin/scripts/user-prompt-submit.cjs)、[hook-coldstart.test.cjs](../tests/hook-coldstart.test.cjs)、[main.cjs](../desktop/main.cjs)。

## D02 · 将分页SQLite限定为本机精确结构兼容层

**采用：** Node内置 `node:sqlite`，只读连接、禁止扩展、固定表列、参数化ID、100ms忙等待、前后文件身份和两读一致核验。只放行实测线程创建版本与结构；同session、主根、最新root、source及开始时间均需证明。无可信证据时拒绝显示。

**未采用：** 将分页数据库称为官方稳定API、读取消息表/任意JSON、用配置模型补当次模型、按当前CLI版本放行所有旧线程、未来版本自动兼容，或另启app-server冒充正在运行的桌面会话。结果减少错误归属与隐私读取；代价是宿主升级、导入旧聊天或结构变化可导致功能停用，需要重新研究和明确验收。

旧真实JSONL分支保留独立版本合同，分页适用但不通过时不能退回旧路径绕过拒绝。Hook仅创建入口时不加载SQLite，避免短时Hook额外加载实验模块和警告。

**证据：** [paginated-state.cjs](../adapter/paginated-state.cjs)、[entrance-event.cjs](../adapter/entrance-event.cjs)、[paginated-state.test.cjs](../tests/paginated-state.test.cjs)。

## D03 · 用源时间、typed anchor和generation管理事件所有权

**采用：** 同session内按真实root来源核验，跨session用root开始时间水位；同时间但不同事件无法排序则拒绝。文件ID去重、准备token和展示代分别控制并发；首帧前再次核验不可变源锚点。分页锚点包含sourceRevision，JSONL锚点包含真实byte offset，二者有明确类型。

**未采用：** Hook到达时间、mtime、文件名排序、接收序号、把分页ordinal冒充日志offset，或旧异步任务完成后无条件绘制。结果是晚到旧事件和纹理准备不会复活旧纸；代价是部分顺序不明事件宁可不播，代码需要多层所有权检查。显示失败不应通过放宽来源约束“修复”。

**证据：** [EntranceScheduler/verifyEntranceUntil](../desktop/host-state.cjs)、[samePreparedVerification/rendererReady](../desktop/main.cjs)、[paperlab-session.js](../renderer/paperlab-session.js)、[main-verification.test.cjs](../tests/main-verification.test.cjs)、[roll-motion.test.cjs](../tests/roll-motion.test.cjs)。

## D04 · 将任务状态与发送展示时间线分开

**采用：** 保留旧 `Session`/`HostClock` 的30秒working周期、waiting/unknown暂停和可信终态；当前入口独立一次性播放，全文完整阅读2秒后收卷退场。动画自然结束只改变展示可见性，不派发completed，也不证明任务状态。

**未采用：** 用动画时长显示模型进度、按Stop认定成功、把烧纸/卷纸周期当token或费用。结果语义诚实，预览也能复用；代价是旧源码名和schema仍需清楚标为兼容合同。`timings.totalMs`是时序常量，实际全程按布局交付计划的hideAtMs计算。

**证据：** [ritual-timeline.js](../renderer/ritual-timeline.js)、[entrance-timeline.js](../renderer/entrance-timeline.js)、[host-state.cjs](../desktop/host-state.cjs)、[entrance.test.cjs](../tests/entrance.test.cjs)。

## D05 · 字段不足时保留unknown，努力配置单独标注

**采用：** model取当次Hook；标题取核验同session名称，缺失显示明确题辞。reported努力只认当前同turn、同model且位置正确的JSONL context；分页线程配置两读一致时标configured，纸面写“配置·高”等，读符说明“未确认本次任务实际生效”。

**未采用：** prompt冒充聊天标题、全球默认或线程配置冒充当次实际努力、随机补字、从别的会话借字段。结果可能显示“未取得”或装饰题辞；这是信息边界，不是必须填满的视觉缺陷。本轮字体、纹理、字段和提供方冻结，后续名称/配置变化只影响新一轮。

**证据：** [applyVerifiedReasoning](../adapter/entrance-event.cjs)、[readChatTitle](../adapter/chat-title.cjs)、[ritual-core.js](../renderer/ritual-core.js)、[reader.js](../desktop/reader.js)、[configured-reasoning.test.cjs](../tests/configured-reasoning.test.cjs)。

## D06 · 品牌依赖精确审阅目录，未知用通用印

**采用：** 运行时目录逐项记录精确模型ID、公司、asset、evidence及审阅日期；仅reported来源（明确预览允许demo）可选择品牌，矛盾公司/来源降为通用印。素材层再次核对完整目录证据，资源是固定离线矢量。

**未采用：** `gpt`前缀、任意别名、产品图标、中转商名称或公司标签单独推断提供方。结果是未收录模型也能显示名称，但可能显示通用印；新增品牌需要证据与许可审阅。`config/provider-catalog.json`不是运行时自动加载的配置，不能只改它而不改 `provider-identity.js`。

**证据：** [provider-identity.js](../renderer/provider-identity.js)、[provider-assets.js](../renderer/provider-assets.js)、[provider-catalog.json](../config/provider-catalog.json)、[provider-handoff-regression.test.cjs](../tests/provider-handoff-regression.test.cjs)、[素材条件](../assets/providers/USAGE.md)。

## D07 · 退场送往自有临时印记，不假定官方Pet位置

**采用：** `prepareLocalSealLayout`为本轮创建带run/generation/layoutVersion的自有印记，纸进入固定接收平面后逐段裁切；Logo不旋转，原创外圈单独缓转，纸结束后印记轻应、淡出。

**未采用：** 固定屏幕坐标当官方Pet位置、以settings.petPosition或预览可拖目标证明真实Pet、注入/DLL/内部管道控制宿主。结果不依赖用户Pet类型或开关；代价是当前没有官方Pet联动。保留的 `DeliveryTargetBridge`只接受未来受支持的Node宿主适配器，渲染器无IPC可以声明该来源。

**证据：** [prepareLocalSealLayout/DeliveryTargetBridge](../desktop/host-state.cjs)、[delivery-motion.js](../renderer/delivery-motion.js)、[provider-seal-view.js](../renderer/provider-seal-view.js)、[provider-seal-motion.test.cjs](../tests/provider-seal-motion.test.cjs)。

## D08 · 统一SVG显字与Paperlab实际纸张，共用受控时钟

**采用：** 锁定Paperlab/Three.js/GSAP；真实PaperMesh负责取纸与收卷几何，显字和阅读保留原始SVG锐利字形；完整纹理只准备一次，连续网格保持原UV，以实测卷轴枢轴旋转90°、短弧飞行和接收平面裁切。背面以线性光墨色差默认0.2合成，保持纸alpha和材质真实朝向。

**未采用：** 默认三段折纸、重新绘制廉价替身、整体SVG拉伸替代真实卷曲、透明整图背贴、opacity当逐段吸收、额外自主GSAP计时器或远程CDN。结果是预览与正常入口使用同一表现实现；代价是GPU/字体/着色器需要隐藏预热，准备失败就不播放，不回退成另一套未验效果。

React Three Fiber使用 `frameloop: never`；GSAP暂停seek后sleep ticker。结束/隐藏停止RAF并清空，换代/dispose释放所属资源。旧fire/damage和三段fold模块保留供兼容/检查，当前主入口不导入火焰效果。

**证据：** [burn-view.js](../renderer/burn-view.js)、[paperlab-entry.jsx](../renderer/paperlab-entry.jsx)、[roll-preview-engine.jsx](../renderer/roll-preview-engine.jsx)、[paper-backface.js](../renderer/paper-backface.js)、[build-paperlab.cjs](../scripts/build-paperlab.cjs)。

## D09 · 接受有证明的一次原生DPI圆整，后续严格失效

**采用：** 逻辑布局保持DIP；只认可本程序setBounds立即采样、与原请求DIP→屏幕px→DIP结果相同、位置不变、右/下最多扩1DIP的原生圆整收据。后续move/resize必须与该收据精确匹配，显示器变化取消本轮。

**未采用：** 为减少取消加入通用1像素容差、反复将已经圆整的原生尺寸作为设计输入，或直接混用UIA物理像素与overlay局部DIP。结果解决了已验证单屏125%条件下的误取消路径；混合DPI、多屏仍需实测，不能推断全显示环境支持。

**证据：** [native-window-geometry.cjs](../desktop/native-window-geometry.cjs)、[main.cjs](../desktop/main.cjs)、[native-window-geometry.test.cjs](../tests/native-window-geometry.test.cjs)、[公开验证](PUBLIC-VERIFICATION.md)。

## D10 · UIA只作独立辅助通道，不能替代Hook身份

**采用：** 正常主程序内启动固定系统PowerShell辅助进程，只读核验应用包身份、安装目录、进程、唯一窗口、前台、明确模式选择和同编辑区发送控件；订阅Invoke事件而不点击，输出有限几何及固定阶段/HRESULT。包装器有字节上限、心跳、最多3次重试，只结束自己创建的子进程。Work准入始终拒绝UIA身份替代。

**未采用：** 全局键鼠监听、聊天树/正文采集、窗口标题充当会话标识、猜测按钮点击或观察器失败连带取消Hook。结果这条路径的故障可独立诊断；普通Chat完整链路仍未验收，不因代码存在而变为正式支持。

**证据：** [send-observer.cjs](../desktop/send-observer.cjs)、[windows-send-observer.ps1](../desktop/windows-send-observer.ps1)、[SendAdmissionGate](../desktop/host-state.cjs)、[entrance-contract.cjs](../desktop/entrance-contract.cjs)、[send-observer.test.cjs](../tests/send-observer.test.cjs)。

## D11 · 预览隔离分两种，不能一概承诺没有真实字段

**采用：** 正常托盘完整预览冻结打开时的当前符；没有当前符才用合成示例。源码独立预览/便携包PREVIEW使用专门profile和合成示例，拒绝session/entrance参数，不绑定真实会话、不启动观察器。卷纸检查器是另一独立入口，只用合成纸。

**未采用：** 用当前正常实例的旧QA重放入口冒充用户真实发送、用预览替代Trust/真实warm/cold验收、公开未脱敏的冻结当前符截图。结果可复用生产视觉而减少宿主操作；代价是须记录预览类别，正常托盘预览的标题/model/环境末级名仍是私人内容。

**证据：** [showMotionPreview/runtimeProfile](../desktop/main.cjs)、[previewQaProfile](../desktop/host-state.cjs)、[start-paperlab-preview.cjs](../scripts/start-paperlab-preview.cjs)、[roll-preview-main.cjs](../desktop/roll-preview-main.cjs)。

## D12 · 本地资源、最小浏览器能力与可审阅分发

**采用：** 页面禁Node集成、启contextIsolation和sandbox、拒绝权限及外网、受限preload/IPC；文本XML编码，品牌资源不可由输入注入URL。锁定依赖本地构建，生成bundle不手改，桌面/插件/项目版本与内含源码需一致。公开材料排除个人配置、真实任务、内部原参考图和原QA。

**未采用：** 自动升级依赖、管理员操作、修改官方应用/认证/信任、自启动/服务/计划任务、孤立EXE安装、手工改缓存绕过检测。原创UNLICENSED保持，第三方许可、OFL字体和品牌条件随包；INTEGRITY只验证清单一致，不宣传为签名。未来发布仍需独立审阅和明确授权。

**证据：** [secureWindow/IPC](../desktop/main.cjs)、[preload.cjs](../desktop/preload.cjs)、[pet.html](../desktop/pet.html)、[package-desktop.cjs](../scripts/package-desktop.cjs)、[package-plugin.cjs](../scripts/package-plugin.cjs)、[THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md)、[AGENTS.md](../AGENTS.md)。
