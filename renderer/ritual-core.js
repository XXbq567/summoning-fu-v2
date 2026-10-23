/* Summoning Fu v2. Original, deterministic semantic SVG renderer.
 * This module does not observe Codex, calculate token usage, or install a pet.
 * It renders caller-supplied data; adapters must supply truthful provenance.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RitualCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FIELDS = Object.freeze(['model', 'company', 'relay', 'harness', 'environment', 'task', 'reasoning']);
  const SOURCES = new Set(['reported', 'configured', 'manual', 'unknown', 'demo']);
  const LIMITS = Object.freeze({ model: 40, company: 24, relay: 28, harness: 24, environment: 32, task: 120, reasoning: 24 });
  const PAPER_BOUNDS = Object.freeze({ x: 48, y: 20, width: 264, height: 710 });
  const FONT = "'FuBrush', 'Ma Shan Zheng', 'Microsoft YaHei', 'SimSun', 'Segoe UI', 'Segoe UI Emoji', 'Noto Sans CJK SC', sans-serif";
  // Timings are seconds within the first 2.4 s. A fresh sheet is blank.
  const WRITING_WINDOWS = Object.freeze([[0.12, .30], [.30, .65], [.65, 1], [1, 1.30], [1.30, 1.65], [1.65, 2.15], [2.15, 2.4]]);
  function writingProgress(progress, order) {
    const window = WRITING_WINDOWS[order] || WRITING_WINDOWS[6];
    return Math.max(0, Math.min(1, (progress * 2.4 - window[0]) / (window[1] - window[0])));
  }

  function chars(value) { return Array.from(value); }
  function clean(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    return String(value).replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function clip(value, count) {
    const parts = chars(value);
    return parts.length > count ? parts.slice(0, count - 1).join('') + '…' : value;
  }
  function graphemes(value) {
    return typeof Intl.Segmenter === 'function'
      ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value), item => item.segment) : chars(value);
  }
  function clipGraphemes(value, count) {
    const parts = graphemes(value);
    return parts.length > count ? parts.slice(0, count - 1).join('') + '…' : value;
  }
  function escapeXML(value) {
    return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
  }
  function normalizeMetadata(input) {
    const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const result = {};
    const sources = {};
    for (const key of FIELDS) {
      const raw = value[key] && typeof value[key] === 'object' && !Array.isArray(value[key]) ? value[key].value : value[key];
      const text = clean(raw);
      const from = value[key] && typeof value[key] === 'object' ? value[key].source : value.sources && value.sources[key];
      result[key] = text ? clip(text, LIMITS[key]) : '未取得';
      sources[key] = text && text !== '未取得' ? (SOURCES.has(from) ? from : 'manual') : 'unknown';
    }
    const taskRaw = typeof value.fullTask === 'string' ? clean(value.fullTask) : clean(value.task && typeof value.task === 'object' ? value.task.value : value.task);
    result.fullTask = taskRaw ? clip(taskRaw, 8192) : '未取得';
    result.fullTaskTruncated = chars(taskRaw).length > 8192 || value.fullTaskTruncated === true;
    if (value.presentation && value.presentation.mode === 'entrance') {
      const presentation = value.presentation;
      const titleValue = presentation.chatTitle;
      const title = clean(titleValue && typeof titleValue === 'object' ? titleValue.value : titleValue);
      const source = titleValue && typeof titleValue === 'object' ? titleValue.source : 'manual';
      const titlePending = !title;
      result.task = titlePending ? '新启一程' : clipGraphemes(title, 40);
      result.fullTask = titlePending ? '新启一程' : clipGraphemes(title, 8192);
      result.fullTaskTruncated = graphemes(title).length > 8192 || presentation.titleTruncated === true;
      sources.task = titlePending ? 'unknown' : SOURCES.has(source) ? source : 'manual';
      result.presentation = {
        mode: 'entrance', sessionId: clip(clean(presentation.sessionId), 256), titlePending,
        chatTitle: { value: titlePending ? null : result.fullTask, source: sources.task },
        titleTruncated: result.fullTaskTruncated,
      };
    }
    result.sources = sources;
    return result;
  }
  function hash(text) {
    let n = 2166136261;
    for (const ch of String(text)) { n ^= ch.codePointAt(0); n = Math.imul(n, 16777619); }
    return n >>> 0;
  }
  function rng(seed) {
    let state = seed >>> 0 || 1;
    return function () { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  }
  function visualUnits(text) { return chars(text).reduce((n, ch) => n + (/^[\x20-\x7e]$/.test(ch) ? 0.57 : 1), 0); }
  function fittedFont(text, maxSize, width) { return Math.max(9, Math.min(maxSize, width / Math.max(1, visualUnits(text)))); }
  function textNode(text, x, y, size, attrs) {
    return `<text x="${x}" y="${y}" font-size="${size.toFixed ? size.toFixed(2) : size}" text-anchor="middle" ${attrs || ''}>${escapeXML(text)}</text>`;
  }
  function splitByUnits(text, maxUnits, maxLines) {
    const lines = [''];
    const tokens = text.match(/[A-Za-z0-9_.:/-]+|\s+|./gu) || [];
    const pieces = tokens.flatMap(token => visualUnits(token) > maxUnits ? chars(token) : [token]);
    for (const ch of pieces) {
      const last = lines.length - 1;
      if (lines[last] && visualUnits(lines[last] + ch) > maxUnits) {
        if (lines.length === maxLines) {
          let tail = chars(lines[last].trimEnd());
          while (tail.length && visualUnits(tail.join('') + '…') > maxUnits) tail.pop();
          lines[last] = tail.join('') + '…'; break;
        }
        lines.push(ch.trimStart());
      } else lines[last] += ch;
    }
    return lines;
  }

  function buildTalismanSVG(input, options) {
    const meta = normalizeMetadata(input);
    const opts = options && typeof options === 'object' ? options : {};
    const prefixRaw = typeof opts.idPrefix === 'string' ? opts.idPrefix : 'fu';
    const prefix = (prefixRaw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) || 'fu').replace(/^([^A-Za-z_])/, '_$1');
    const id = suffix => `${prefix}-${suffix}`;
    const seed = Number.isFinite(opts.seed) ? opts.seed >>> 0 : hash(FIELDS.map(field => meta[field]).join('|'));
    const random = rng(seed);
    const ink = '#9e281d';
    const fine = '#9f3525';
    const entrance = meta.presentation && meta.presentation.mode === 'entrance';
    const decorativeRelay = !!entrance && meta.sources.relay === 'unknown';
    const decorativeCompany = !!entrance && meta.sources.company === 'unknown';
    const decorationSeed = hash(entrance ? meta.presentation.sessionId || 'new-chat' : '');
    const relayMottos = ['诸事顺遂', '灵思成章', '万象有序', '所愿成文'];
    const sealMottos = ['如律', '启思', '成章'];
    const relayText = decorativeRelay ? relayMottos[decorationSeed % relayMottos.length] : clip(meta.relay, 22);
    const companyText = decorativeCompany ? sealMottos[decorationSeed % sealMottos.length] : clip(meta.company, 20);
    const tilt = ((random() - 0.5) * 1.3).toFixed(3);
    const title = `召唤符 · ${meta.model} · ${meta.task}`;
    const decorationDescription = (decorativeRelay || decorativeCompany || (entrance && meta.presentation.titlePending))
      ? `缺失来源处使用原创题辞装饰，不代表中转站或模型公司。${entrance && meta.presentation.titlePending ? '会话标题尚未取得，所请事项为装饰题辞“新启一程”。' : ''}` : '';
    const description = `符头中转站：${meta.relay}。模型所属公司：${meta.company}。奉请模型：${meta.model}。执事框架：${meta.harness}。工作环境：${meta.environment}。${entrance ? '会话标题' : '所请事项'}：${meta.fullTask}。推理强度：${meta.reasoning}。${decorationDescription}${entrance ? '这是会话入场展示，展示结束不代表任务完成。' : '这是输入字段的符式排版，燃烧时长不代表 token 数量或任务完成百分比。'}`;
    const fontData = typeof opts.fontDataURL === 'string' && /^data:(?:font\/(?:ttf|otf|woff|woff2)|application\/(?:x-font-ttf|font-woff));base64,[A-Za-z0-9+/=]+$/.test(opts.fontDataURL) ? opts.fontDataURL : '';
    const fontStyle = fontData ? `<style>@font-face{font-family:'FuBrush';src:url('${fontData}')}text{font-family:${FONT}}</style>` : '';

    // Small fibers are deterministic. They are paper texture, never pseudo-text.
    const fibers = Array.from({ length: 44 }, () => {
      const x = 60 + random() * 233, y = 28 + random() * 690, len = 1 + random() * 5;
      return `<path d="M${x.toFixed(2)} ${y.toFixed(2)}l${len.toFixed(2)} ${((random() - 0.5) * 1.2).toFixed(2)}"/>`;
    }).join('');
    const paper = opts.paper === false ? '' : `<g id="${id('paper-base')}">
      <path d="M59 22 L95 23 L135 21 L178 23 L218 21 L262 23 L302 22 L305 64 L303 121 L306 177 L303 235 L305 291 L303 346 L306 401 L304 454 L306 509 L303 561 L305 614 L303 670 L302 727 L260 725 L219 728 L177 725 L136 728 L95 726 L56 727 L54 684 L56 632 L53 578 L55 522 L52 471 L55 412 L53 359 L55 308 L53 251 L56 194 L54 141 L56 81 Z" fill="url(#${id('paper-tone')})" stroke="#d3ac60" stroke-width="1"/>
      <path d="M178 24 C175 210 181 490 177 725" stroke="#9d612c" stroke-opacity=".052" stroke-width="2.5" fill="none"/>
      <path d="M59 239 C132 243 226 237 302 241 M55 473 C129 469 227 476 305 472" stroke="#ab7335" stroke-opacity=".045" fill="none"/>
      <g stroke="#97672c" stroke-width=".7" opacity=".12">${fibers}</g>
    </g>`;

    const modelLines = splitByUnits(meta.model, 16, 2);
    const modelSVG = modelLines.map((line, i) => textNode(line, 180, modelLines.length === 1 ? 183 : 173 + i * 24, fittedFont(line, 24, 222), `font-weight="600"`)).join('');
    const harnessText = clip(meta.harness, 22);
    const environmentText = clip(meta.environment, 23);
    const taskCJK = /[\u3400-\u9fff\uf900-\ufaff]/.test(meta.task) && !/[A-Za-z0-9]/.test(meta.task);
    let taskSVG = '';
    let shownTask = '';
    if (taskCJK) {
      shownTask = entrance ? clipGraphemes(meta.task, 32) : clip(meta.task, 27);
      const taskChars = entrance ? graphemes(shownTask) : chars(shownTask);
      const rows = entrance ? 8 : 9;
      const count = Math.ceil(taskChars.length / rows);
      for (let i = 0; i < taskChars.length; i++) {
        const col = Math.floor(i / rows), row = i % rows;
        const x = 180 + (count - 1) * 17 - col * 34;
        const delta = (random() - 0.5) * 0.8;
        const char = taskChars[i];
        const size = /^[\x20-\x7e]$/.test(char) ? 17 : 19;
        taskSVG += textNode(char, x, 427 + row * 21.4, size, `transform="rotate(${delta.toFixed(3)} ${x} ${427 + row * 21.4})"`);
      }
    } else {
      const lines = splitByUnits(meta.task, 13.4, 7);
      shownTask = lines.join(' ');
      taskSVG = lines.map((line, i) => textNode(line, 180, 438 + i * 22, fittedFont(line, 15, 167))).join('');
    }

    const top = `<g id="${id('head')}" data-writing-order="0" data-writing-name="符头" fill="${ink}">
      <path d="M128 37 C121 38 119 48 127 53 C135 51 136 44 137 38 C133 44 130 45 128 37Z M177 33 C169 36 170 49 179 52 C186 47 188 40 187 33 C183 41 180 42 177 33Z M227 38 C220 42 221 50 228 53 C235 49 237 42 237 35 C232 43 229 45 227 38Z"/>
      <path d="M111 66 C152 63 211 66 249 60 L245 65 C204 69 150 68 111 70Z M125 80 C164 76 211 80 237 76 L236 80 C197 84 151 82 125 84Z M177 56 C174 63 177 75 173 89 L180 88 C180 73 182 64 181 55Z"/>
    </g>`;
    const gateway = `<g id="${id('gateway')}" data-writing-order="1" data-writing-name="中转站与法源">
      ${textNode(relayText, 180, 107, fittedFont(relayText, 15, 229), decorativeRelay ? 'data-decorative="true"' : '')}
      <path d="M111 118 L249 117 L250 142 L111 143Z M115 122 L245 121 L246 138 L115 139Z" fill="none" stroke="${fine}" stroke-width=".75" opacity=".75"/>
      ${textNode(companyText, 180, 134, fittedFont(companyText, 12, 126), `letter-spacing=".3"${decorativeCompany ? ' data-decorative="true"' : ''}`)}
    </g>`;
    const invocation = `<g id="${id('invocation')}" data-writing-order="2" data-writing-name="所请模型">
      ${textNode('奉 请', 180, 157, 10, 'letter-spacing="3" opacity=".8"')}
      ${modelSVG}
      <path d="M91 196 C126 199 141 197 160 198 M200 198 C224 196 245 199 270 195" fill="none" stroke="${ink}" stroke-width="1.6"/>
    </g>`;
    const edict = `<g id="${id('edict')}" data-writing-order="3" data-writing-name="敕令" transform="rotate(${tilt} 180 244)">
      ${textNode('敕', 180, 241, 46, 'font-weight="600"')}
      ${textNode('令', 181, 282, 47, 'font-weight="600"')}
      <path d="M141 214 C131 245 140 267 151 282 L144 278 C129 259 129 235 134 217Z M218 208 C226 234 221 267 207 283 L217 275 C230 254 233 231 223 210Z" fill="${ink}" opacity=".65"/>
    </g>`;
    const harness = `<g id="${id('harness')}" data-writing-order="4" data-writing-name="捆仙绳与工作环境">
      <g fill="none" stroke="${ink}" stroke-linecap="round">
        <path d="M101 297 C136 284 224 319 257 296 M104 305 C148 289 216 326 254 305 M105 351 C146 369 218 334 257 354 M108 362 C142 375 225 342 252 363" stroke-width="2.3" opacity=".86"/>
        <path d="M112 293 C99 324 99 349 117 366 M246 294 C262 321 264 346 249 366 M120 303 L238 354 M122 354 L240 304" stroke-width="1.2" opacity=".32"/>
      </g>
      <rect x="114" y="311" width="132" height="39" fill="#fffaf0" fill-opacity=".8"/>
      ${textNode(harnessText, 180, 334, fittedFont(harnessText, 19, 150), 'font-weight="600"')}
      ${textNode(environmentText, 180, 380, fittedFont(environmentText, 12, 200), 'opacity=".92"')}
    </g>`;
    const pillars = `<g id="${id('pillars')}" fill="none" stroke="${ink}" opacity=".83">
      <path d="M80 195 C74 272 79 358 75 438 C73 518 78 600 73 673 L84 695" stroke-width="2.8"/>
      <path d="M280 195 C288 272 281 354 285 438 C288 518 280 601 287 673 L276 695" stroke-width="2.8"/>
      <path d="M86 390 L91 392 L88 624 M274 391 L269 393 L272 625" stroke-width=".8"/>
      <path d="M90 433 C107 421 107 450 91 447 C77 446 81 425 95 432 M270 433 C253 421 253 450 269 447 C284 445 281 425 265 432 M91 585 C107 573 107 601 91 599 C76 597 81 577 96 584 M270 585 C253 573 253 602 270 599 C285 597 281 577 265 584" stroke-width="2"/>
    </g>`;
    const task = `<g id="${id('task')}" data-writing-order="5" data-writing-name="所请事项">
      ${pillars}
      ${textNode('所 请 事 项', 180, 408, 10, 'letter-spacing="2" opacity=".75"')}
      <g id="${id('task-text')}" aria-label="${escapeXML(shownTask)}"${entrance && meta.presentation.titlePending ? ' data-decorative="true"' : ''}>${taskSVG}</g>
      <path d="M126 613 C161 609 205 617 235 610" fill="none" stroke="${ink}" stroke-width="1.7"/>
    </g>`;
    const reasoning = `<g id="${id('heart')}" data-writing-order="6" data-writing-name="符胆与推理强度">
      <path d="M125 631 L235 633 L234 696 L123 694Z M129 637 L229 638 L229 689 L129 690Z" fill="${ink}" fill-opacity=".035" stroke="${ink}" stroke-width="1.5"/>
      ${textNode('推 理 强 度', 180, 651, 10, 'letter-spacing="1.4"')}
      ${textNode(clip(meta.reasoning, 18), 180, 679, fittedFont(clip(meta.reasoning, 18), 25, 92), 'font-weight="600"')}
      <path d="M135 700 C158 706 209 701 228 702 L223 707 C193 705 159 711 133 704Z M110 685 C108 698 98 711 87 717 L103 713 C114 705 117 696 116 686Z M251 685 C254 699 263 710 274 717 L259 713 C248 705 244 697 246 686Z" fill="${ink}"/>
    </g>`;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="760" viewBox="0 0 360 760" role="img" aria-labelledby="${id('title')} ${id('desc')}">
      <title id="${id('title')}">${escapeXML(title)}</title><desc id="${id('desc')}">${escapeXML(description)}</desc>
      <defs><linearGradient id="${id('paper-tone')}" x1="0" y1="0" x2="1" y2=".75"><stop stop-color="#fffdf6"/><stop offset=".48" stop-color="#fffaf0"/><stop offset="1" stop-color="#eee6d6"/></linearGradient>${fontStyle}</defs>
      <g id="${id('paper-content')}" font-family="${escapeXML(FONT)}" fill="${ink}" text-rendering="geometricPrecision">
        ${paper}${top}${gateway}${invocation}${edict}${harness}${task}${reasoning}
      </g>
    </svg>`;
  }

  return Object.freeze({ version: '2.1.0', fields: FIELDS, paperBounds: PAPER_BOUNDS, fontStack: FONT, writingProgress, normalizeMetadata, buildTalismanSVG, escapeXML });
});
