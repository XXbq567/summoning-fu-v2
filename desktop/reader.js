(function () {
'use strict';
const labels = { idle: '未绑定会话', working: '行符中', waiting: '等待接令 · 消耗已冻结', completed: '已成待阅', cancelled: '已取消 · 收符', error: '发生错误 · 已熄火', unknown: '状态未取得 · 静止' };
const presentationLabels = { point: '取纸', travel: '纸卷牵出', unfold: '纸身舒展', writing: '正在落墨', hold: '完整展示 · 2 秒', rolling: '底部收卷', rotating: '纸卷转向', flying: '送往临时印记', staging: '准备交付', intake: '逐段没入印记', 'seal-ack': '临时印记轻应', 'seal-exit': '临时印记淡出', hidden: '已收起' };
const fields = { relay: '符头 · 服务', company: '公司小章', model: '奉请名号', harness: '捆仙绳', environment: '侧文 · 环境', task: '所请事项', reasoning: '符胆' };
const sources = { reported: '当次来源明确报告', configured: '配置值，未证明当次生效', manual: '手工指定', demo: '演示', unknown: '未取得' };
function fieldSourceExplanation(field, source) {
  return field === 'reasoning' && source === 'configured' ? '线程配置快照，未确认本次任务实际生效' : sources[source] || sources.unknown;
}
const observerLabels = Object.freeze({ 'unsupported-platform': '当前系统不支持界面发送观察。', 'host-unavailable': '未找到符合包身份与窗口要求的应用。', 'host-ambiguous': '存在多个候选窗口，已保守暂停。', 'identity-unverified': '应用身份未通过核验。', 'window-unavailable': '应用窗口不可用。', 'window-inactive': '应用窗口当前不在前台，观察暂停。', 'window-minimized': '应用窗口已最小化。', 'mode-unknown': '尚未取得明确的 Chat/Work 选择状态。', 'mode-changed': '模式已改变，旧候选已清理。', 'send-unavailable': '下一次发送控件暂不可订阅。', 'composer-unproven': '尚未证明发送控件的编辑区归属。', 'viewport-unavailable': '尚未取得主聊天区域。', 'geometry-invalid': '按钮或主区域几何未通过核验。', 'geometry-changed': '窗口或区域几何已变化。', 'observer-stopped': '观察器已停止。', 'observer-exited': '观察器进程已退出。', 'observer-timeout': '观察器响应超时。', 'observer-unavailable': '观察器不可用，具体失败阶段尚未取得。', 'buffer-limit': '输出超过安全上限。', 'protocol-invalid': '无效协议消息已拒绝。', 'spawn-failed': '观察器子进程启动失败。', 'retry-exhausted': '观察器已达到重试上限。', observing: '等待真实发送事件。', 'send-invoked': '已观察发送控件调用，不代表服务端确认。', 'work-association-unavailable': 'Codex 工作聊天由独立 Hook 接入，UIA 不代替该身份。' });
const stageLabels = Object.freeze({ 'init-assemblies': '加载系统程序集', 'init-compile': '编译观察器', 'init-package': '核验应用包', 'init-parent': '核验父进程', 'init-dpi': '准备坐标环境', 'init-automation': '创建观察接口', host: '核验宿主窗口', 'element-from-handle': '取得窗口元素', mode: '识别模式', 'main-region': '取得主区域', composer: '核验编辑区归属', send: '核验发送控件', subscribe: '订阅发送事件', drain: '检查已收到事件' });
function readerStatus(value) {
  const duration = Number.isFinite(value.hideAtMs) ? '，全程约 ' + (value.hideAtMs / 1000).toFixed(1) + ' 秒' : '';
  const position = value.presentationMode === 'independent-hook' ? '已核验的 Codex Hook 使用独立伴随窗口' : value.source === 'chatgpt-uia' ? '已核验的 Chat 发送控件使用自有覆盖层' : '独立伴随层与本地预览共用 Paperlab';
  const motion = position + '展开、显字，完整阅读 2 秒后收卷并没入本程序临时印记' + duration + '。印记最后淡出；不控制官方 Pet，不表示任务完成。';
  const counters = value.hookAdmission?.counters;
  const count = name => Number.isSafeInteger(counters?.[name]) && counters[name] >= 0 && counters[name] <= 1000000000 ? counters[name] : 0;
  const reasonLabels = { 'version-mismatch': '版本合同未通过', 'latest-turn-mismatch': '不是当前根轮次', 'source-not-ready': '轮次来源尚未就绪', 'paged-state-unavailable': '分页状态库不可访问或打开失败', 'paged-schema-mismatch': '分页状态库结构未通过核验', 'paged-source-unverified': '分页根任务来源未通过核验', 'source-expired': '来源已过期', 'session-mismatch': '会话身份不匹配', 'source-order': '来源顺序已过时', duplicate: '重复交接已忽略', cancelled: '展示已取消', none: '入口核验通过' };
  let hook = count('received') === 0 ? 'Codex 工作聊天：本次启动后尚未收到 Hook 交接；请单独核验该聊天的 Hook 交接，UIA 状态见下一行。' : 'Codex 工作聊天：本次启动收到 ' + count('received') + ' 次 Hook 交接，已核验并播放 ' + count('applied') + ' 次。';
  if (count('received') && Object.hasOwn(reasonLabels, value.hookAdmission?.reason)) hook += ' 最近状态：' + reasonLabels[value.hookAdmission.reason] + '。';
  let observer = 'UIA（仅 Chat）：' + (Object.hasOwn(observerLabels, value.observerStatus) ? observerLabels[value.observerStatus] : observerLabels['observer-unavailable']);
  const d = value.observerDiagnostic;
  if (d && Object.hasOwn(stageLabels, d.stage) && Number.isInteger(d.hresult) && d.hresult >= -2147483648 && d.hresult <= 2147483647) observer += ' 阶段：' + stageLabels[d.stage] + '；HRESULT 0x' + (d.hresult >>> 0).toString(16).padStart(8, '0') + '。';
  const title = value.titleSource === 'codex-paginated-name' ? 'Codex 当次轮次名称' : value.titleSource === 'codex-session-index' ? '旧版本 session_index（兼容回退）' : '标题待定';
  return { motion, hook, observer, title };
}
if (typeof module === 'object' && module.exports) { module.exports = { readerStatus, fieldSourceExplanation }; return; }
let key = '', coverage = {};
function update(value) {
  document.querySelector('#state').textContent = value.presentationPreparing ? '正在准备本机纸张与字体' : value.pendingEntrance ? '正在核验会话来源' : presentationLabels[value.phase] || '等待入口事件';
  document.querySelector('#diagnostic').textContent = value.diagnostic || '';
  const status = readerStatus(value);
  document.querySelector('#motion-status').textContent = status.motion;
  document.querySelector('#hook-status').textContent = status.hook;
  document.querySelector('#observer-status').textContent = status.observer;
  document.querySelector('#binding').textContent = value.source === 'chatgpt-uia' ? 'Chat 控件观察；未取得服务端会话或轮次身份。' : value.binding ? `锁定会话：${value.binding.sessionId}\n文件：${value.binding.fileName}` : '尚未锁定会话。';
  document.querySelector('#adapter').textContent = `${value.adapterLabel}。标题来源：${status.title}。`;
  document.querySelector('#acknowledge').hidden = true;
  const next = `${value.sessionId}/${value.runId}`; if (next === key) return; key = next;
  const meta = value.metadata || {}, normalized = RitualCore.normalizeMetadata(meta);
  const parsed = new DOMParser().parseFromString(RitualCore.buildTalismanSVG(meta, { idPrefix: 'reader' }), 'image/svg+xml');
  document.querySelector('#full-talisman').replaceChildren(document.importNode(parsed.documentElement, true));
  const list = document.querySelector('#fields'); list.replaceChildren();
  for (const [field, label] of Object.entries(fields)) {
    const dt = document.createElement('dt'), dd = document.createElement('dd'), provenance = document.createElement('small');
    dt.textContent = field === 'task' ? '此行 · 聊天标题' : label; dd.textContent = field === 'task' ? normalized.task : meta[field] || '未取得'; provenance.textContent = fieldSourceExplanation(field, meta.sources?.[field]);
    dd.append(provenance); list.append(dt, dd);
  }
  document.querySelector('#full-task').textContent = normalized.fullTask;
  document.querySelector('#truncated').textContent = normalized.presentation?.titlePending ? '新聊天尚未取得标题，暂显“新启一程”；不使用提示词冒充聊天名。' : '入口符只使用该会话标题，不包含提示词正文。展示结束不表示任务完成。';
  const report = RitualFontCoverage.report(Object.values(normalized).filter(v => typeof v === 'string').join(''), coverage);
  document.querySelector('#font-warning').textContent = !report.checked ? '字体覆盖表不可用；使用本机字体回退，字形覆盖未验证。' : report.missingFromBrush?.length ? `毛笔字体未覆盖：${report.missingFromBrush.map(item => item.character + ' (' + item.codePoint + ')').join(' ')}。这些字符使用本机系统字体回退；未证明所有 Unicode 均有可用字形。` : '当前显示文字已检查毛笔字体覆盖；缺失时使用本机系统回退。';
}
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => fuHost.action(button.dataset.action)));
fuHost.subscribe(update); fuHost.initial().then(value => { if (value) { coverage = value.coverage; key = ''; update(value.snapshot); } });

})();
