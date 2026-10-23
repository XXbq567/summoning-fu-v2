'use strict';
const labels = { idle: '未绑定', working: '行符中', waiting: '接令 · 已暂停', completed: '已成待阅', cancelled: '已收符', error: '失误 · 已熄火', unknown: '状态未取得' };
function update(value) { document.querySelector('#status').textContent = (labels[value.state] || '状态未取得') + (value.reducedMotion ? ' · 静态' : ''); }
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => fuHost.action(button.dataset.action)));
fuHost.subscribe(update); fuHost.initial().then(value => value && update(value.snapshot));
