召唤符 v2 · 语义排版核心
========================

目的
把本次任务的真实、显式字段编排成一张召唤符。不是随机生成装饰线条，
不是 token 计量器，不负责观察 Codex 或创建、安装、选择原生 Pet。

文件与接口
  ritual-core.js：无运行时依赖的 UMD 模块。
  浏览器：window.RitualCore
  Node：const RitualCore = require('./renderer/ritual-core.js')

  RitualCore.normalizeMetadata(input)
  RitualCore.buildTalismanSVG(metadata, options)
  RitualCore.paperBounds = { x:48, y:20, width:264, height:710 }
  RitualCore.fields = ['model','company','relay','harness','environment','task','reasoning']

最小输入示例（这些是显式示例，不能冒充已观测到的客户端信息）
  {
    model: '示例模型',
    company: '示例公司',
    relay: '示例中转站',
    harness: 'Codex',
    environment: 'Windows · 示例',
    task: '把当前任务写成召唤符并实现燃烧动画',
    reasoning: '高 · 示例',
    sources: {
      model:'demo', company:'demo', relay:'demo', harness:'demo',
      environment:'demo', task:'demo', reasoning:'demo'
    }
  }

输入规则
  每个字段可以是字符串，也可以是 {value:'...',source:'reported'}。
  允许来源：reported / configured / manual / unknown / demo。
  有值但未明确来源时归为 manual；从不自动标为 reported。
  空值、不合类型或缺失值显示“未取得”，来源为 unknown。
  七个主字段只用做显示；绝不执行其中的指令、HTML 或脚本。
  XML 特殊字符经过转义；控制字符与双向文本控制符会清理。
  返回 fullTask 保留清洗后的完整任务，最多 8192 个 Unicode 码点；
  超过时 fullTaskTruncated=true。任务主字段最多 120 个码点。
  纸面纯中文任务最多 27 个码点，按右→左、上→下排三列，超出有省略号。
  英文及中英混排任务采用横排，优先按英文词换行，过长词允许分行。
  UI 应提供 fullTask 展开入口，不把截断当作摘要生成。
  除截断与空白清理外，渲染器不改写模型名、公司名或提示词。

buildTalismanSVG 选项
  idPrefix：默认 'fu'；多张内联 SVG 同时出现时必须使用不同 prefix。
  paper：默认 true；false 只去掉纸张底色与纸纤维，保留朱砂内容。
  seed：可选数字，控制稳定的微倾与纤维；不传时从字段内容确定。
  fontDataURL：可选完整 data:font/ttf;base64,... 或 otf/woff/woff2。
    传入后内嵌 @font-face，family 为 FuBrush；导出 SVG 可离线栅格化。
    不传时依次尝试 FuBrush、Ma Shan Zheng、Microsoft YaHei、SimSun、
    Segoe UI、Segoe UI Emoji、Noto Sans CJK SC、sans-serif。
    宿主须加载随包 MaShanZheng-Regular.ttf；系统回退字形随设备变化。

输出约定
  根 SVG 为 360×760，透明外缘；纸面与所有画面内容包含于
  <g id="fu-paper-content">（idPrefix='fu' 时）。
  用该 group 应用整体燃烧 mask，避免只烧纸底而文字仍浮在空中。
  纸底 group 为 fu-paper-base。
  [data-writing-order] 顺序为：
    0 符头笔势
    1 中转站与公司章
    2 奉请模型
    3 敕令
    4 捆仙绳、Harness 与工作环境
    5 所请事项与左右天柱
    6 符胆与推理强度
  BurnView 的制符从暖白空纸开始。0–2.4 秒分七组：0.12–0.30 符头；
  0.30–0.65 中转站/公司；0.65–1.00 模型；1.00–1.30 敕令；
  1.30–1.65 Harness；1.65–2.15 事项；2.15–2.40 符胆。
  原创辅助路径按子路径 getTotalLength() 的实际长度揭示；中文/英文保持
  字体准确字形，按 grapheme 字序显现。字体字形本身没有汉字笔顺数据，
  不能将该效果称作任意中文逐笔书写。全部路径/文字仍在整体燃烧 mask 内。
  标题与 desc 含可访问性说明；task-text 的 aria-label 是纸面可见摘录。

调用示例
  const normalized = RitualCore.normalizeMetadata(input);
  const svg = RitualCore.buildTalismanSVG(normalized, {
    idPrefix: 'fu',
    fontDataURL: optionalEmbeddedFontDataURL
  });

  // root 层负责 RunState、写字显现、30 秒周期、燃烧 mask、换符与交互。

集成注意
  字体与用户任务元数据是不同资源；换任务只重新编排文字，不需要图像生成。
  本模块的确定性手写微差仅用于纸纹、字的微倾和原创辅助笔势。
  如要更真实的毛笔压力，可用 perfect-freehand 绘制已有手写中心线；
  它不提供任意中文文本到正确汉字字形/笔顺的转换。
  原生 Pet 的实际 atlas 格式、刷新方式与播放时序须由本机能力实验确认。
  360×760 母版可读，不代表 192×208 Pet 缩图能够读完七个字段。

字体覆盖报告
  node scripts/build-font-coverage.cjs 从随包 TTF cmap format 4/12 生成
  assets/fonts/coverage.json，记录 SHA-256、7015 个有码点的 glyph 与范围。
  不修改/分发另一个字体，不更改 OFL 许可；此范围只验证毛笔字体本身。
  浏览器先加载 renderer/font-coverage.js，再将覆盖表对象传给：
    new RitualBurn.BurnView(container, metadata, { fontCoverage: coverage })
  view.fontReport.checked 表示是否真正取得覆盖表；missingFromBrush 为
  {character, codePoint} 去重列表。缺字 span 强制走 Windows 系统字体链，
  不是声称所有 Unicode 都有字形；无法显示的字符仍可在展开处用 U+编号定位。
  无覆盖表时 checked=false，浏览器自动字体回退仍有效，但不声称检查通过。
