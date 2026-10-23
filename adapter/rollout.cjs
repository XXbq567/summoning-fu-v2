'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { metadataFor, idOK } = require('./envelope.cjs');
const { SUPPORTED_CLI_VERSIONS } = require('./entrance-event.cjs');
const SUPPORTED_VERSION = '0.163.0-alpha.10.2';
const ACTIVITY = new Set(['AgentMessage', 'Reasoning', 'McpToolCall', 'CommandExecution', 'FileChange', 'ImageView', 'SubAgentActivity']);
// This is a version-pinned, read-only transcript adapter, NOT a supported Codex plugin API.
class RolloutAdapter {
  constructor({ file, sessionId, expectedVersion = SUPPORTED_VERSION, supportedVersions, onEnvelope = () => {}, onDiagnostic = () => {},
    aliases = {}, pollMs = 750, staleMs = 90000, now = Date.now } = {}) {
    if (!path.isAbsolute(file || '') || path.extname(file).toLowerCase() !== '.jsonl' || !idOK(sessionId)) throw new TypeError('An explicit absolute .jsonl file and sessionId are required.');
    this.file = file; this.sessionId = sessionId; this.expectedVersion = expectedVersion; this.onEnvelope = onEnvelope;
    this.supportedVersions = new Set(Array.isArray(supportedVersions) ? supportedVersions : [expectedVersion]);
    this.onDiagnostic = onDiagnostic; this.aliases = aliases; this.pollMs = Math.max(100, pollMs); this.staleMs = Math.max(1000, staleMs); this.now = now;
    this.offset = 0; this.lineOffset = 0; this.pendingBytes = Buffer.alloc(0); this.startedWatermark = -Infinity;
    this.startsAtWatermark = new Set();
    this.closed = new Set(); this.seenItems = new Set(); this.active = null; this.pending = null; this.validated = false;
    this.halted = false; this.suspended = false; this.running = false; this.busy = null; this.localEvent = 0;
    this.generation = 0; this.workingFloor = 0;
    this.lastSemanticAt = -Infinity; this.lastPollAt = null;
  }
  diagnostic(code, message) { try { this.onDiagnostic({ code, message }); } catch {} }
  async start() {
    if (this.running) return;
    this.running = true; this.scanning = true;
    const generation = ++this.generation;
    try {
      const stat = await fs.stat(this.file);
      if (!this.validOperation(generation)) return;
      if (!stat.isFile() || stat.size > 64 * 1024 * 1024) return this.halt('source-limit', '选定记录超过安全读取上限或不是普通文件。');
      this.identity = `${stat.dev}:${stat.ino}`;
      const target = stat.size;
      while (this.offset < target && !this.halted && this.validOperation(generation)) await this.poll();
    } catch { if (this.validOperation(generation)) this.halt('source-unavailable', '选定会话记录暂不可读。'); }
    finally { this.scanning = false; }
    if (!this.validOperation(generation)) return;
    if (this.active) {
      if (this.active.state === 'working' && this.now() - this.lastSemanticAt > this.staleMs) this.active.state = 'unknown';
      this.deliver(this.active.sequence);
    }
    this.ensureTimer();
  }
  ensureTimer() {
    if (!this.timer && this.running && !this.halted && !this.suspended) {
      this.timer = setInterval(() => { void this.poll(); }, this.pollMs); this.timer.unref?.();
    }
  }
  stop() { this.running = false; this.generation++; clearInterval(this.timer); this.timer = null; }
  suspend() { this.generation++; this.suspended = true; this.setState('unknown'); this.diagnostic('suspended', '系统暂停；恢复后等待新的任务语义事件。'); }
  async resume() {
    if (!this.running || this.halted) return;
    const generation = ++this.generation;
    this.suspended = true; this.lastSemanticAt = -Infinity;
    this.setState('unknown');
    // Freeze the SOURCE byte waterline, not a batch count or receive time. This also excludes
    // a partial pre-resume line completed after resume and arbitrarily many queued batches.
    if (this.busy) await this.busy;
    if (!this.running || generation !== this.generation) return;
    try {
      const stat = await fs.stat(this.file);
      if (!this.running || generation !== this.generation) return;
      if (this.identity == null) {
        // Sleep interrupted the very first stat, before a source identity was established.
        this.workingFloor = stat.size; this.suspended = false; this.running = false;
        return this.start();
      }
      if (`${stat.dev}:${stat.ino}` !== this.identity || stat.size < this.offset) return this.halt('source-replaced', '会话文件被替换或截断；请重新绑定。');
      this.workingFloor = Math.max(this.workingFloor, stat.size);
    } catch {
      if (this.running && generation === this.generation) this.halt('source-unavailable', '恢复时会话记录不可读。');
      return;
    }
    this.suspended = false; this.lastPollAt = this.now();
    await this.poll();
    if (this.validOperation(generation)) this.ensureTimer();
  }
  validOperation(generation) { return this.running && !this.suspended && generation === this.generation; }
  canWork(sequence) { return this.running && !this.suspended && Number.isSafeInteger(sequence) && sequence >= this.workingFloor; }
  halt(code, message) { this.halted = true; this.generation++; clearInterval(this.timer); this.timer = null; this.setState('unknown'); this.diagnostic(code, message); }
  async poll() {
    if (this.busy) return this.busy;
    if (!this.running || this.halted || this.suspended) return;
    this.busy = this.readAvailable();
    try { await this.busy; } finally { this.busy = null; }
  }
  async readAvailable() {
    const generation = this.generation;
    try {
      const stat = await fs.stat(this.file);
      if (!this.validOperation(generation)) return;
      if (!stat.isFile() || `${stat.dev}:${stat.ino}` !== this.identity || stat.size < this.offset) return this.halt('source-replaced', '会话文件被替换或截断；请重新明确绑定会话。');
      const now = this.now();
      if (this.lastPollAt != null && now - this.lastPollAt > Math.max(15000, this.pollMs * 3)) {
        this.workingFloor = Math.max(this.workingFloor, stat.size);
        this.lastSemanticAt = -Infinity; this.setState('unknown');
      }
      this.lastPollAt = now;
      const size = Math.min(stat.size - this.offset, 1024 * 1024);
      if (size > 0) {
        const handle = await fs.open(this.file, 'r');
        let buffer = Buffer.alloc(size), bytesRead;
        try {
          if (!this.validOperation(generation)) return;
          ({ bytesRead } = await handle.read(buffer, 0, size, this.offset));
        } finally { await handle.close(); }
        if (!this.validOperation(generation)) return;
        buffer = buffer.subarray(0, bytesRead); this.offset += bytesRead;
        this.pendingBytes = Buffer.concat([this.pendingBytes, buffer]);
        let at;
        while ((at = this.pendingBytes.indexOf(10)) !== -1) {
          if (!this.validOperation(generation)) return;
          const line = this.pendingBytes.subarray(0, at); const sequence = this.lineOffset;
          this.pendingBytes = this.pendingBytes.subarray(at + 1); this.lineOffset += at + 1;
          if (line.length > 1024 * 1024) return this.halt('record-limit', '单条记录过长，已停止读取。');
          try { this.consume(JSON.parse(line.toString('utf8')), sequence); }
          catch { return this.halt('invalid-record', '记录格式变化或损坏，状态停止在未知。'); }
          if (this.halted) return;
        }
        if (this.pendingBytes.length > 1024 * 1024) return this.halt('record-limit', '未完成记录超过上限。');
      }
      if (this.active?.state === 'working' && now - this.lastSemanticAt > this.staleMs) {
        this.setState('unknown'); this.diagnostic('stale', '长时间没有可信任务语义活动；已停止消耗，不能据此推断完成。');
      }
    } catch {
      if (!this.validOperation(generation)) return;
      if (this.scanning) this.halt('source-unavailable', '选定会话记录暂不可读。');
      else { this.setState('unknown'); this.diagnostic('source-unavailable', '选定会话记录暂不可读。'); }
    }
  }
  consume(record, sequence) {
    const p = record?.payload;
    if (!p || typeof p !== 'object') return;
    if (record.type === 'session_meta') {
      if (this.validated || (p.id !== this.sessionId && p.session_id !== this.sessionId) || (p.id && p.id !== this.sessionId) || (p.session_id && p.session_id !== this.sessionId)) return this.halt('session-mismatch', '记录与锁定会话不匹配。');
      if (!SUPPORTED_CLI_VERSIONS.includes(p.cli_version) || !this.supportedVersions.has(p.cli_version)) return this.halt('unsupported-version', '此记录版本尚未验证；不推测新版本事件含义。');
      if (p.source && typeof p.source === 'object' && p.source.subagent) return this.halt('subagent-source', '请选择主会话记录，不能把子代理当主任务。');
      this.validated = true; this.harness = p.originator === 'Codex Desktop' ? 'Codex Desktop' : 'Codex'; return;
    }
    if (!this.validated || (p.thread_id && p.thread_id !== this.sessionId) || (p.session_id && p.session_id !== this.sessionId)) return;
    if (record.type === 'event_msg' && p.type === 'error' && this.active && !this.closed.has(this.active.runId)) {
      // Legacy ErrorEvent has no turn_id. Within the locked source, conservatively suppress success.
      if ((!p.turn_id || p.turn_id === this.active.runId) && (!p.root_turn_id || p.root_turn_id === this.rootTurnId)) this.turnError = true;
      return;
    }
    const turn = p.turn_id;
    if (!idOK(turn)) return;
    if (record.type === 'event_msg' && p.type === 'task_started') {
      if (p.root_turn_id && p.root_turn_id !== turn) return;
      if (p.turn_attribution?.parent_turn_id || p.turn_attribution?.initiating_agent_path) return;
      if (this.closed.has(turn) || this.active?.runId === turn || this.pending?.runId === turn) return;
      // Source's start timestamp is a stale-start guard, never an arrival timestamp or replacement for byte order.
      if (!Number.isFinite(p.started_at) || p.started_at < this.startedWatermark) return;
      if (p.started_at > this.startedWatermark) this.startsAtWatermark.clear();
      if (this.startsAtWatermark.has(turn)) return;
      if (this.startsAtWatermark.size >= 1024) return this.halt('start-history-limit', '同一源时间的回合数超过保护上限。');
      this.startsAtWatermark.add(turn);
      this.startedWatermark = p.started_at;
      if (this.active) { this.close(this.active.runId); this.setState('unknown', sequence); }
      if (this.pending) this.close(this.pending.runId);
      this.pending = { runId: turn, rootTurnId: p.root_turn_id || turn, qualifiedRoot: p.root_turn_id === turn,
        startedAt: p.started_at, startedOffset: sequence, context: null, prompt: null };
      return;
    }
    if (this.closed.has(turn)) return;
    const expectedRoot = this.pending?.runId === turn ? this.pending.rootTurnId : this.rootTurnId;
    if (p.root_turn_id && p.root_turn_id !== expectedRoot) return;
    if (record.type === 'turn_context' && this.pending?.runId === turn && !this.pending.context) {
      this.pending.context = { model: p.model, effort: p.effort, cwd: p.cwd }; this.tryStart(sequence, record.timestamp); return;
    }
    if (record.type !== 'event_msg') return;
    if (p.type === 'item_completed' && p.item?.type === 'UserMessage') {
      if (this.pending?.runId !== turn || this.pending.prompt != null) return;
      this.pending.prompt = Array.isArray(p.item.content) ? p.item.content.filter(c => c?.type === 'text' && typeof c.text === 'string').map(c => c.text).join('\n') : '';
      this.tryStart(sequence, record.timestamp); return;
    }
    if (this.active?.runId !== turn) return;
    if (p.type === 'task_complete') {
      // Official protocol maps task_complete -> TurnComplete, and the app-server projects
      // terminal error -> Failed, otherwise Completed. See docs/ADAPTER.md for pinned evidence.
      // Require the actual main-root identity and timing fields observed on this local version.
      const qualified = this.qualifiedRoot && p.root_turn_id === turn && p.started_at === this.startedAt &&
        Number.isFinite(p.completed_at) && p.completed_at >= p.started_at;
      this.close(turn);
      this.setState(qualified ? (p.error != null || this.turnError ? 'error' : 'completed') : 'unknown', sequence);
      if (!qualified) this.diagnostic('completion-candidate', '完成事件缺少已验证的主回合身份/时间字段；不展示成功。');
      return;
    }
    if (p.type === 'turn_aborted') { this.close(turn); this.setState('cancelled', sequence); return; }
    if (p.type === 'item_completed' && ACTIVITY.has(p.item?.type) && typeof p.item.id === 'string') {
      if (this.seenItems.has(p.item.id)) return;
      this.seenItems.add(p.item.id); if (this.seenItems.size > 1024) this.seenItems.delete(this.seenItems.values().next().value);
      this.lastSemanticAt = this.semanticTime(record.timestamp);
      this.setState(!this.canWork(sequence) || this.now() - this.lastSemanticAt > this.staleMs ? 'unknown' : 'working', sequence, true);
    }
  }
  semanticTime(timestamp) { const value = Date.parse(timestamp); return Number.isFinite(value) ? Math.min(value, this.now()) : -Infinity; }
  tryStart(sequence, timestamp) {
    const p = this.pending;
    if (!p?.context || p.prompt == null) return;
    const data = metadataFor({ ...p.context, prompt: p.prompt, harness: this.harness, aliases: this.aliases });
    this.lastSemanticAt = this.semanticTime(timestamp);
    this.active = { schemaVersion: 1, sessionId: this.sessionId, runId: p.runId, source: 'codex-rollout',
      state: !this.canWork(sequence) || p.startedOffset < this.workingFloor || this.now() - this.lastSemanticAt > this.staleMs ? 'unknown' : 'working', ...data, sequence };
    this.rootTurnId = p.rootTurnId; this.qualifiedRoot = p.qualifiedRoot; this.startedAt = p.startedAt;
    this.turnError = false; this.pending = null; this.deliver(sequence);
  }
  close(turn) { this.closed.add(turn); if (this.closed.size > 256) this.closed.delete(this.closed.values().next().value); }
  setState(state, sequence, force = false) {
    if (!this.running) return;
    if (state === 'working' && !this.canWork(sequence)) state = 'unknown';
    if (!this.active || (!force && this.active.state === state && sequence == null)) return;
    this.active.state = state; this.deliver(sequence);
  }
  deliver(sequence) {
    if (!this.active || !this.running) return;
    if (this.suspended && this.active.state === 'working') this.active.state = 'unknown';
    if (sequence != null) this.active.sequence = sequence;
    if (this.scanning) return;
    const e = { ...this.active, observedAt: new Date(this.now()).toISOString(),
      eventId: sequence == null ? `local:${++this.localEvent}` : `rollout:${sequence}` };
    if (sequence == null) delete e.sequence;
    try { this.onEnvelope(structuredClone(e)); } catch { this.diagnostic('consumer-error', '显示层未接受状态更新。'); }
  }
}
module.exports = { RolloutAdapter, SUPPORTED_VERSION };
