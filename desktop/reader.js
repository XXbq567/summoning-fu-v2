'use strict';
const labels = { idle: '未绑定会话', working: '行符中', waiting: '等待接令 · 消耗已冻结', completed: '已成待阅', cancelled: '已取消 · 收符', error: '发生错误 · 已熄火', unknown: '状态未取得 · 静止' };
const presentationLabels = { paper: '纸张显现', writing: '正在制符', seal: '落敕', hold: '完整展示', leaving: '收符', hidden: '已收起' };
const fields = { relay: '符头 · 服务', company: '公司小章', model: '奉请名号', harness: '捆仙绳', environment: '侧文 · 环境', task: '所请事项', reasoning: '符胆' };
const sources = { reported: '当次来源明确报告', configured: '配置值，未证明当次生效', manual: '手工指定', demo: '演示', unknown: '未取得' };
let key = '', coverage = {};
function update(value) {
  document.querySelector('#state').textContent = value.pendingEntrance ? '已接发送事件 · 等待约 5 秒' : presentationLabels[value.phase] || '等待入口事件';
  document.querySelector('#diagnostic').textContent = value.diagnostic || '';
  document.querySelector('#motion-status').textContent = '正常入口播放完整动效：纸先显现，字序写入；完整展示 10 秒，再原地轻收符淡出。Windows 动画设置保持不变。';
  document.querySelector('#binding').textContent = value.binding ? `锁定会话：${value.binding.sessionId}\n文件：${value.binding.fileName}` : '尚未锁定会话。';
  document.querySelector('#adapter').textContent = `${value.adapterLabel}。标题来源：${value.titleSource === 'codex-session-index' ? '本机 Codex session_index' : '标题待定'}。`;
  document.querySelector('#acknowledge').hidden = true;
  const next = `${value.sessionId}/${value.runId}`; if (next === key) return; key = next;
  const meta = value.metadata || {}, normalized = RitualCore.normalizeMetadata(meta);
  const parsed = new DOMParser().parseFromString(RitualCore.buildTalismanSVG(meta, { idPrefix: 'reader' }), 'image/svg+xml');
  document.querySelector('#full-talisman').replaceChildren(document.importNode(parsed.documentElement, true));
  const list = document.querySelector('#fields'); list.replaceChildren();
  for (const [field, label] of Object.entries(fields)) {
    const dt = document.createElement('dt'), dd = document.createElement('dd'), provenance = document.createElement('small');
    dt.textContent = field === 'task' ? '此行 · 聊天标题' : label; dd.textContent = field === 'task' ? normalized.task : meta[field] || '未取得'; provenance.textContent = sources[meta.sources?.[field]] || sources.unknown;
    dd.append(provenance); list.append(dt, dd);
  }
  document.querySelector('#full-task').textContent = normalized.fullTask;
  document.querySelector('#truncated').textContent = normalized.presentation?.titlePending ? '新聊天尚未取得标题，暂显“新启一程”；不使用提示词冒充聊天名。' : '入口符只使用该会话标题，不包含提示词正文。展示结束不表示任务完成。';
  const report = RitualFontCoverage.report(Object.values(normalized).filter(v => typeof v === 'string').join(''), coverage);
  document.querySelector('#font-warning').textContent = !report.checked ? '字体覆盖表不可用；使用本机字体回退，字形覆盖未验证。' : report.missingFromBrush?.length ? `毛笔字体未覆盖：${report.missingFromBrush.map(item => item.character + ' (' + item.codePoint + ')').join(' ')}。这些字符使用本机系统字体回退；未证明所有 Unicode 均有可用字形。` : '当前显示文字已检查毛笔字体覆盖；缺失时使用本机系统回退。';
}
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => fuHost.action(button.dataset.action)));
fuHost.subscribe(update); fuHost.initial().then(value => { if (value) { coverage = value.coverage; key = ''; update(value.snapshot); } });
