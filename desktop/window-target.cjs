'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
function validateRecordedBounds(value, areas) {
  if (!value || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]))) return null;
  if (Math.abs(value.x) > 131072 || Math.abs(value.y) > 131072 || value.width < 100 || value.height < 100 || value.width > 32768 || value.height > 32768) return null;
  let area = null, overlap = 0;
  for (const candidate of areas) {
    const amount = Math.max(0, Math.min(value.x + value.width, candidate.x + candidate.width) - Math.max(value.x, candidate.x)) * Math.max(0, Math.min(value.y + value.height, candidate.y + candidate.height) - Math.max(value.y, candidate.y));
    if (amount > overlap) { overlap = amount; area = candidate; }
  }
  if (!area) return null;
  const center = value.isMaximized === true ? { x: area.x + area.width / 2, y: area.y + area.height / 2 } : { x: Math.max(area.x, Math.min(area.x + area.width, value.x + value.width / 2)), y: Math.max(area.y, Math.min(area.y + area.height, value.y + value.height / 2)) };
  return { source: 'codex-last-recorded-window', center, area: { ...area }, isMaximized: value.isMaximized === true };
}
async function readLastRecordedTarget(areas) {
  let handle;
  try {
    const file = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), '.codex-global-state.json');
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) return null;
    handle = await fs.open(file, 'r'); const opened = await handle.stat();
    if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size > 4 * 1024 * 1024) return null;
    const data = Buffer.alloc(opened.size), { bytesRead } = await handle.read(data, 0, data.length, 0);
    // Only this public persisted window-bounds key is selected; no other state is returned.
    return validateRecordedBounds(JSON.parse(data.subarray(0, bytesRead).toString('utf8'))['electron-main-window-bounds'], areas);
  } catch { return null; }
  finally { await handle?.close().catch(() => {}); }
}
module.exports = { validateRecordedBounds, readLastRecordedTarget };
