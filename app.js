(() => {
'use strict';

const VERSION = 1;
const INDEX_FILE = '_index.json';
const PLUGINS_FILE = '_plugins.json';
const PLUGIN_PREFIX = 'plugin_';
const PLUGIN_API_VERSION = 1;
const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
const SHORTCUT_STORAGE_KEY = 'cstl.shortcuts.v1';
const DEFAULT_PROMPT = `Translate entire text to Native English. Euphemism prohibited. Onomatopoeia must be English-based. Result must be inside codeblock. Keep line numbering and format (like code in the middle of the text) intact.`;
const DEFAULT_RINGKASAN_PROMPT = `Outside the <translate> and </translate> tags (placed above or below the translated lines), include updated summary of the characters and overall story so far. Any characters and story need to be preserved even though they don't appear again for context.`;
const FIXED_FORMAT_PROMPT = `Format:\n<translate>\ntext\n</translate>`;
const MODAL_CLOSE_MS = 180;
const TOAST_TIMEOUT_MS = 3000;
const SAVED_TIMEOUT_MS = 1800;
const DASHBOARD_PAGE_SIZE = 30;
const SCROLLER_OVERSCAN = 6;
const DECODERS = ['utf-8', 'shift_jis', 'windows-31j', 'cp932'];

const SETTINGS_FIELDS = [
  { id: 'settingsIgnoreNameCheck',    key: 'ignoreName',       type: 'check',  def: false },
  { id: 'settingsPromptCheck',        key: 'promptEnabled',    type: 'check',  def: true  },
  { id: 'settingsJumpToContextCheck', key: 'jumpToContext',    type: 'check',  def: false },
  { id: 'settingsHideToolsCheck',     key: 'hideTools',        type: 'check',  def: false },
  { id: 'settingsIncrementCheck',     key: 'incrementEnabled', type: 'check',  def: false },
  { id: 'settingsIncrementStepInput', key: 'incrementStep',    type: 'number', def: 100 },
  { id: 'settingsPromptInput',        key: 'prompt',           type: 'value', def: DEFAULT_PROMPT },
  { id: 'settingsEpubTagsInput',      key: 'epubTags',         type: 'value', def: 'p' }
];

const PROOFREAD_FIELDS = [
  { id: 'proofreadScope',               key: 'prScope',          type: 'value', def: 'all'   },
  { id: 'proofreadRegexCheck',          key: 'prRegex',          type: 'check', def: false   },
  { id: 'proofreadCaseCheck',           key: 'prCase',           type: 'check', def: false   },
  { id: 'proofreadExactCheck',          key: 'prExact',          type: 'check', def: false   },
  { id: 'proofreadTranslatedOnlyCheck', key: 'prTranslatedOnly', type: 'check', def: false   }
];

const STATE_SCHEMA = [
  { key: 'projectName',        def: '' },
  { key: 'projectType',        def: 'uninitialized',        coerce: true },
  { key: 'pluginId',           def: null,                   coerce: true },
  { key: 'pluginName',         def: null,                   coerce: true },
  { key: 'pluginData',         def: null,                   coerce: true },
  { key: 'epubTags',           def: 'p',                    coerce: true },
  { key: 'epubSourceId',       def: null,                   coerce: true },
  { key: 'prompt',             def: DEFAULT_PROMPT,         coerce: true, store: 'prompt_header' },
  { key: 'ignoreName',         def: false,                  store: 'ignoreNameTranslation' },
  { key: 'promptEnabled',      def: true },
  { key: 'ringkasanEnabled',   def: false },
  { key: 'ringkasanPrompt',    def: DEFAULT_RINGKASAN_PROMPT, coerce: true },
  { key: 'ringkasan',          def: '' },
  { key: 'vndbEnabled',        def: false },
  { key: 'vndbId',             def: '' },
  { key: 'vndbGlossary',       def: [],                     coerce: true },
  { key: 'customEnabled',      def: false },
  { key: 'customRaw',          def: '' },
  { key: 'jumpToContext',      def: false },
  { key: 'hideTools',          def: false },
  { key: 'incrementEnabled',   def: false },
  { key: 'incrementStep',      def: 100,                    coerce: true },
  { key: 'pluginSettings',    def: {},                     coerce: true },
  { key: 'prScope',            def: 'all',                  coerce: true, store: 'proofreadScope' },
  { key: 'prRegex',            def: false,                  store: 'proofreadRegex' },
  { key: 'prCase',             def: false,                  store: 'proofreadCaseSensitive' },
  { key: 'prExact',            def: false,                  store: 'proofreadExactMatch' },
  { key: 'prTranslatedOnly',   def: false,                  store: 'proofreadTranslatedOnly' },
  { key: 'bookmarks',          def: [],                     coerce: true },
  { key: 'images',             def: [],                     coerce: true }
];

const DROPDOWNS = [
  { trigger: 'btnImportMain',   panel: 'importDropdown',    group: 'importGroup'    },
  { trigger: 'btnCopyAllNames', panel: 'copyNamesDropdown', group: 'copyNamesGroup' },
  { trigger: 'btnOpenPlugins',  panel: 'pluginMenu',        group: 'pluginMenuGroup' }
];

const $ = id => document.getElementById(id);
const escapeHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const PANEL_THEME_VARS = ['bg', 'bg-elev', 'surface', 'surface-2', 'surface-3', 'hairline', 'hairline-2', 'hairline-3', 'ink', 'ink-dim', 'ink-muted', 'accent', 'accent-hover', 'accent-soft', 'accent-tint', 'accent-edge', 'success', 'success-hover', 'success-soft', 'danger', 'danger-hover', 'danger-soft', 'r-sm', 'r', 'r-lg', 'r-xl', 'r-2xl', 'r-full', 'font', 'font-mono'];
const themeVarsCss = () => {
  const cs = getComputedStyle(document.documentElement);
  const parts = [];
  for (const name of PANEL_THEME_VARS) {
    const v = cs.getPropertyValue('--' + name).trim();
    if (v) parts.push('--' + name + ':' + v);
  }
  return ':root{' + parts.join(';') + '}';
};
const baseName = p => String(p || '').replace(/\\/g, '/').split('/').pop();
const fileExt = name => { const bn = baseName(name); const i = bn.lastIndexOf('.'); return i > 0 ? bn.slice(i).toLowerCase() : ''; };
const readHead = async (file, n = 512) => new Uint8Array(await file.slice(0, n).arrayBuffer());
const topFileCount = files => (Array.isArray(files) ? files : []).filter(f => !String(f).includes('/')).length;
const isTrans = l => !!l.is_translated;
const makeProjId = () => 'proj_' + Date.now() + '.cstl';
const makeEpubId = () => 'epub_' + Date.now() + '.epub';
const clone = obj => (typeof structuredClone === 'function') ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));
const schemaDefault = f => (f.def && typeof f.def === 'object') ? clone(f.def) : f.def;
const snapshot = () => ({ lines: clone(State.lines), selected: new Set(State.selected) });
const jsZipReady = () => typeof JSZip !== 'undefined';
const yieldToEvent = () => new Promise(r => setTimeout(r, 0));

function normalizeLine(l) {
  if (l._n) return l;
  return {
    line_num: Number(l.line_num),
    file: String(l.file),
    name: l.name == null ? null : String(l.name),
    message: String(l.message || ''),
    trans_name: l.trans_name == null ? null : String(l.trans_name),
    trans_message: l.trans_message == null ? null : String(l.trans_message),
    is_translated: Boolean(l.is_translated),
    _n: 1
  };
}

function decodeBuffer(buf) {
  for (const enc of DECODERS) {
    try { return new TextDecoder(enc, { fatal: true }).decode(buf); } catch {}
  }
  return new TextDecoder('utf-8').decode(buf);
}

const asciiOf = bytes => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s; };
const isZipHead = h => h.length >= 4 && h[0] === 0x50 && h[1] === 0x4b && h[2] === 0x03 && h[3] === 0x04;
const isEpubHead = h => isZipHead(h) && asciiOf(h).includes('application/epub+archive');
const isJsonHead = h => {
  let i = 0;
  if (h.length >= 3 && h[0] === 0xef && h[1] === 0xbb && h[2] === 0xbf) i = 3;
  while (i < h.length && (h[i] === 0x20 || h[i] === 0x09 || h[i] === 0x0a || h[i] === 0x0d)) i++;
  return i < h.length && (h[i] === 0x7b || h[i] === 0x5b);
};

function stripNewlines(v) {
  return v == null ? null : String(v).replace(/\r?\n/g, '\\n').trim();
}

function resolveZipPath(baseDir, rel) {
  if (!rel) return null;
  if (/^(?:[a-z]+:)?\/\//i.test(rel) || /^data:/i.test(rel)) return null;
  rel = rel.split('#')[0].split('?')[0];
  if (!rel) return null;
  const parts = (baseDir + rel).split('/');
  const stack = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') stack.pop();
    else stack.push(p);
  }
  return stack.join('/');
}

function sanitizeName(s) {
  const name = String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().replace(/[.\s]+$/, '');
  return name || 'untitled';
}

function isJapanese(s) {
  return /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/.test(s);
}

function download(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function clipboard(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); return Promise.resolve(); }
  catch (e) { return Promise.reject(e); }
  finally { document.body.removeChild(ta); }
}

function debounce(fn, ms = 200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function withBusyCursor(fn) {
  document.body.style.cursor = 'wait';
  return Promise.resolve(fn()).finally(() => { document.body.style.cursor = 'default'; });
}

async function withProgress(title, initialMsg, fn, failMsg) {
  Progress.show(title, initialMsg || '');
  let err = null;
  let result;
  await withBusyCursor(async () => {
    try { result = await fn(); }
    catch (e) { err = e; }
  });
  Progress.hide();
  if (err) {
    if (els.copyStatus) els.copyStatus.classList.add('empty');
    const msg = failMsg ? failMsg(err) : err.message;
    setTimeout(() => alert(msg), 10);
    return undefined;
  }
  return result;
}

const Storage = {
  root() { return navigator.storage.getDirectory(); },
  async atomicWrite(root, name, content) {
    const tmpName = `.${name}.tmp`;
    const tmpHandle = await root.getFileHandle(tmpName, { create: true });
    const w = await tmpHandle.createWritable();
    await w.write(content);
    await w.close();
    let moved = false;
    if (typeof tmpHandle.move === 'function') {
      try { await tmpHandle.move(name); moved = true; } catch {}
    }
    if (!moved) {
      const finalHandle = await root.getFileHandle(name, { create: true });
      const w2 = await finalHandle.createWritable();
      await w2.write(content);
      await w2.close();
      try { await root.removeEntry(tmpName); } catch {}
    }
  },
  async readIndex() {
    try {
      const root = await Storage.root();
      const f = await (await root.getFileHandle(INDEX_FILE)).getFile();
      return JSON.parse(await f.text());
    } catch { return null; }
  },
  async writeIndex(items) {
    const root = await Storage.root();
    await Storage.atomicWrite(root, INDEX_FILE, JSON.stringify(items));
  },
  async upsertIndex(meta) {
    const items = (await Storage.readIndex()) || [];
    const i = items.findIndex(p => p.id === meta.id);
    if (i >= 0) items[i] = meta; else items.push(meta);
    items.sort((a, b) => b.updatedAt - a.updatedAt);
    await Storage.writeIndex(items);
  },
  async removeIndex(id) {
    const items = (await Storage.readIndex()) || [];
    await Storage.writeIndex(items.filter(p => p.id !== id));
  },
  async saveProject(id, data, counts) {
    data.updatedAt = Date.now();
    const root = await Storage.root();
    await Storage.atomicWrite(root, id, JSON.stringify(data));
    const tc = counts?.translatedCount ?? data.lines?.reduce((n, l) => n + (l.is_translated ? 1 : 0), 0) ?? 0;
    await Storage.upsertIndex({
      id,
      name: data.projectName,
      projectType: data.projectType || 'uninitialized',
      pluginId: data.pluginId || null,
      pluginName: data.pluginName || null,
      updatedAt: data.updatedAt,
      fileCount: counts?.fileCount ?? topFileCount(data.imported_files),
      lineCount: counts?.lineCount ?? data.lines?.length ?? 0,
      translatedCount: tc
    });
  },
  async load(id) {
    const root = await Storage.root();
    const f = await (await root.getFileHandle(id)).getFile();
    return JSON.parse(await f.text());
  },
  async remove(id, epubId) {
    const root = await Storage.root();
    if (epubId) { try { await root.removeEntry(epubId); } catch {} }
    await root.removeEntry(id);
    await Storage.removeIndex(id);
  },
  async list() {
    return Storage.reconcileIndex(await Storage.readIndex());
  },
  indexEntry(id, data, fallbackModified) {
    return {
      id,
      name: data.projectName || id.replace('.cstl', ''),
      projectType: data.projectType || 'uninitialized',
      pluginId: data.pluginId || null,
      pluginName: data.pluginName || null,
      updatedAt: data.updatedAt || fallbackModified,
      fileCount: topFileCount(data.imported_files),
      lineCount: data.lines?.length || 0,
      translatedCount: data.lines?.reduce((n, l) => n + (l.is_translated ? 1 : 0), 0) || 0
    };
  },
  async reconcileIndex(items) {
    const saved = Array.isArray(items) ? items : [];
    const root = await Storage.root();
    const byId = new Map(saved.map(p => [p.id, p]));
    const found = [];
    let changed = false;
    for await (const [name, h] of root.entries()) {
      if (h.kind !== 'file' || !name.endsWith('.cstl')) continue;
      const meta = byId.get(name);
      if (meta) {
        byId.delete(name);
        found.push(meta);
        continue;
      }
      try {
        const f = await h.getFile();
        found.push(Storage.indexEntry(name, JSON.parse(await f.text()), f.lastModified));
        changed = true;
      } catch {}
    }
    if (byId.size) changed = true;
    found.sort((a, b) => b.updatedAt - a.updatedAt);
    if (changed) await Storage.writeIndex(found);
    return found;
  },
  async loadEpubBuffer(epubId) {
    const root = await Storage.root();
    const f = await (await root.getFileHandle(epubId)).getFile();
    return await f.arrayBuffer();
  },
  async saveEpub(epubId, buffer) {
    const root = await Storage.root();
    await Storage.atomicWrite(root, epubId, buffer);
  },
  async readPluginIndex() {
    let text;
    try {
      const root = await Storage.root();
      const f = await (await root.getFileHandle(PLUGINS_FILE)).getFile();
      text = await f.text();
    } catch { return []; }
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  },
  async writePluginIndex(items) {
    const root = await Storage.root();
    await Storage.atomicWrite(root, PLUGINS_FILE, JSON.stringify(items));
  },
  async savePluginZip(id, buffer) {
    const root = await Storage.root();
    await Storage.removePluginFile(id);
    await Storage.atomicWrite(root, PLUGIN_PREFIX + id + '.zip', buffer);
  },
  async loadPluginZip(id) {
    const root = await Storage.root();
    const f = await (await root.getFileHandle(PLUGIN_PREFIX + id + '.zip')).getFile();
    return await f.arrayBuffer();
  },
  async removePluginFile(id) {
    const root = await Storage.root();
    for (const ext of ['.js', '.zip']) {
      try { await root.removeEntry(PLUGIN_PREFIX + id + ext); } catch {}
    }
  },
  async wipe() {
    const root = await navigator.storage.getDirectory();
    for await (const [name] of root.entries()) {
      try { await root.removeEntry(name, { recursive: true }); } catch {}
    }
  }
};

const OpfsExplorer = {
  path: [],
  classify(name, isDir) {
    if (isDir) return 'folder';
    if (name === INDEX_FILE) return 'index';
    if (name === PLUGINS_FILE) return 'plugin';
    if (name.startsWith(PLUGIN_PREFIX) && (name.endsWith('.js') || name.endsWith('.zip'))) return 'plugin';
    if (name.endsWith('.cstl')) return 'project';
    if (name.startsWith('.') && name.endsWith('.tmp')) return 'tmp';
    if (/^epub_/.test(name) || /\.(epub|epub3)$/i.test(name)) return 'epub';
    return 'other';
  },
  kindLabel(kind) {
    return ({
      project: 'Project',
      epub: 'EPUB',
      plugin: 'Plugin',
      folder: 'Folder',
      index: 'Index',
      tmp: 'Tmp',
      other: 'File'
    })[kind] || 'File';
  },
  kindIconSvg(kind, isDir) {
    if (isDir) {
      return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
    }
    if (kind === 'project') {
      return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>';
    }
    if (kind === 'epub') {
      return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
    }
    if (kind === 'plugin') {
      return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5h4.5a2.5 2.5 0 1 1 5 0H19v4.5a2.5 2.5 0 1 1 0 5V19h-4.5a2.5 2.5 0 1 0-5 0H5v-4.5a2.5 2.5 0 1 0 0-5z"/></svg>';
    }
    if (kind === 'index') {
      return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/></svg>';
    }
    if (kind === 'tmp') {
      return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>';
  },
  formatSize(bytes) {
    if (bytes == null || isNaN(bytes)) return '?';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  },
  formatDate(ms) {
    if (!ms) return '';
    try {
      const d = new Date(ms);
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return ''; }
  },
  async dirHandle(path) {
    let dir = await navigator.storage.getDirectory();
    for (const part of path) dir = await dir.getDirectoryHandle(part);
    return dir;
  },
  async listDir() {
    if (!navigator.storage?.getDirectory) return [];
    const dir = await this.dirHandle(this.path);
    const out = [];
    for await (const [name, handle] of dir.entries()) {
      const isDir = handle.kind === 'directory';
      const item = { name, isDir, kind: this.classify(name, isDir), size: null, lastModified: 0, count: null };
      if (isDir) {
        try {
          let n = 0;
          for await (const [, child] of handle.entries()) n++;
          item.count = n;
        } catch {}
      } else {
        try {
          const file = await handle.getFile();
          item.size = file.size;
          item.lastModified = file.lastModified;
        } catch {}
      }
      out.push(item);
    }
    const kindPriority = { project: 0, epub: 1, plugin: 2, other: 3, index: 4, tmp: 5 };
    out.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      if (a.isDir) return a.name.localeCompare(b.name);
      const p = (kindPriority[a.kind] ?? 2) - (kindPriority[b.kind] ?? 2);
      if (p !== 0) return p;
      return a.name.localeCompare(b.name);
    });
    return out;
  },
  _showLoading(show) {
    if (!els.opfsLoading) return;
    els.opfsLoading.hidden = !show;
  },
  _showEmpty(show) {
    if (!els.opfsEmpty) return;
    if (show && els.opfsEmptyText) {
      els.opfsEmptyText.textContent = this.path.length ? 'Folder ini kosong.' : 'Belum ada file di OPFS.';
    }
    els.opfsEmpty.hidden = !show;
  },
  _renderCrumbs() {
    if (!els.opfsCrumbs) return;
    els.opfsCrumbs.hidden = !this.path.length;
    els.opfsCrumbs.innerHTML = '';
    if (!this.path.length) return;
    const frag = document.createDocumentFragment();
    const mkCrumb = (label, depth) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opfs-crumb' + (depth === this.path.length ? ' current' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        this.path = this.path.slice(0, depth);
        this.refresh();
      });
      return b;
    };
    frag.appendChild(mkCrumb('OPFS', 0));
    this.path.forEach((seg, i) => {
      const sep = document.createElement('span');
      sep.className = 'opfs-crumb-sep';
      sep.textContent = '/';
      frag.appendChild(sep);
      frag.appendChild(mkCrumb(seg, i + 1));
    });
    els.opfsCrumbs.appendChild(frag);
  },
  async refresh() {
    if (!els.opfsList) return;
    if (!navigator.storage?.getDirectory) {
      els.opfsList.innerHTML = '';
      this._showEmpty(false);
      this._showLoading(false);
      const notice = document.createElement('div');
      notice.className = 'opfs-empty';
      notice.style.color = 'var(--danger)';
      notice.textContent = 'Browser tidak mendukung OPFS.';
      els.opfsList.appendChild(notice);
      return;
    }
    this._showLoading(true);
    this._showEmpty(false);
    els.opfsList.innerHTML = '';
    try {
      const items = await this.listDir();
      this._showLoading(false);
      this._renderCrumbs();
      if (!items.length) {
        this._showEmpty(true);
        return;
      }
      const frag = document.createDocumentFragment();
      for (const item of items) {
        frag.appendChild(this._renderItem(item));
      }
      els.opfsList.appendChild(frag);
    } catch (e) {
      this._showLoading(false);
      els.opfsList.innerHTML = '';
      const notice = document.createElement('div');
      notice.className = 'opfs-empty';
      notice.style.color = 'var(--danger)';
      notice.textContent = 'Gagal memuat: ' + (e?.message || e);
      els.opfsList.appendChild(notice);
    }
  },
  _renderItem(item) {
    const row = document.createElement('div');
    row.className = 'opfs-item' + (item.isDir ? ' is-dir' : '');
    row.setAttribute('role', 'listitem');
    row.dataset.name = item.name;
    row.dataset.kind = item.kind;
    row.dataset.dir = item.isDir ? '1' : '0';
    const downloadTitle = item.isDir
      ? 'Folder tidak dapat diunduh'
      : item.kind === 'tmp'
        ? 'File tmp mungkin tidak utuh — unduh dengan hati-hati'
        : 'Unduh file';
    const sizeLabel = item.isDir ? (item.count + ' item') : this.formatSize(item.size);
    row.innerHTML = `
      <div class="opfs-item-icon kind-${item.isDir ? 'folder' : item.kind}" aria-hidden="true">${this.kindIconSvg(item.kind, item.isDir)}</div>
      <div class="opfs-item-info"${item.isDir ? ' data-action="open" title="Buka folder"' : ''}>
        <span class="opfs-item-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
        <div class="opfs-item-meta">
          <span class="opfs-tag kind-${item.kind}">${this.kindLabel(item.kind)}</span>
          <span class="opfs-meta-size">${sizeLabel}</span>
          ${item.lastModified ? `<span class="opfs-meta-date" title="Terakhir diubah">${this.formatDate(item.lastModified)}</span>` : ''}
        </div>
      </div>
      <div class="opfs-item-actions">
        <button type="button" class="opfs-item-btn opfs-download" aria-label="Unduh ${escapeHtml(item.name)}" title="${downloadTitle}" data-action="download"${item.isDir ? ' disabled' : ''}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <button type="button" class="opfs-item-btn danger opfs-delete" aria-label="Hapus ${escapeHtml(item.name)}" title="${item.isDir ? 'Hapus folder' : 'Hapus file'}" data-action="delete">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
    `;
    return row;
  },
  async download(name) {
    try {
      const dir = await this.dirHandle(this.path);
      const handle = await dir.getFileHandle(name);
      const file = await handle.getFile();
      const url = URL.createObjectURL(file);
      download(url, name);
    } catch (e) {
      alert('Gagal mengunduh "' + name + '": ' + (e?.message || e));
    }
  },
  async remove(name, isDir) {
    const kind = this.classify(name, isDir);
    const warnings = {
      project: 'Ini adalah file project (.cstl). Project akan hilang dari dashboard setelah dihapus.',
      epub: 'Ini adalah file EPUB yang dipakai project. Project terkait mungkin tidak bisa menampilkan gambar lagi.',
      plugin: 'Ini adalah file paket plugin. Plugin akan dihapus dari daftar plugin.',
      index: 'Ini adalah file index internal. Aplikasi akan membangun ulang index otomatis saat dibuka.',
      tmp: 'Ini adalah file sementara dari operasi tulis yang gagal. Aman untuk dihapus.',
      folder: 'Folder ini dan seluruh isinya akan dihapus.',
      other: 'File ini tidak dikenali. Hapus jika Anda yakin.'
    };
    const warning = name === PLUGINS_FILE
      ? 'Ini adalah daftar plugin terpasang. Semua plugin akan dihapus dari aplikasi saat dibuka kembali.'
      : warnings[kind] || warnings.other;
    if (!confirm(`Hapus "${name}" dari OPFS?\n\n${warning}\n\nTindakan ini tidak dapat dibatalkan.`)) return;
    try {
      const dir = await this.dirHandle(this.path);
      await dir.removeEntry(name, { recursive: !!isDir });
      const row = els.opfsList?.querySelector(`.opfs-item[data-name="${CSS.escape(name)}"]`);
      if (row) row.remove();
      if (els.opfsList && !els.opfsList.children.length) {
        this._showEmpty(true);
      }
      if (kind === 'plugin' && name !== PLUGINS_FILE) await PluginRuntime.sync();
      if (kind === 'plugin' || kind === 'project' || kind === 'index') App.loadDashboard();
    } catch (e) {
      alert('Gagal menghapus "' + name + '": ' + (e?.message || e));
    }
  },
  open(name) {
    this.path.push(name);
    this.refresh();
  },
  handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const row = btn.closest('.opfs-item');
    if (!row) return;
    const name = row.dataset.name;
    if (!name) return;
    const action = btn.dataset.action;
    if (action === 'open') this.open(name);
    else if (action === 'download') this.download(name);
    else if (action === 'delete') this.remove(name, row.dataset.dir === '1');
  }
};

function pluginFrameMain(token) {
  'use strict';
  let plug = null, api = null, settings = {}, pluginId = '', apiVersion = 1, seq = 0, panelMounted = false;
  const PANEL_BASE_CSS = '*{box-sizing:border-box}html,body{margin:0;height:100%}body{font:13px/1.5 -apple-system,system-ui,"Segoe UI",sans-serif;background:var(--surface,#141519);color:var(--ink,#f4f5f7)}';
  const pending = new Map();
  const listeners = new Map();
  const post = m => parent.postMessage(Object.assign({ t: token }, m), '*');
  const callHost = (method, args) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    post({ q: 'api', id, method, args });
  });
  const toWasmSource = source => {
    if (source instanceof Uint8Array) return source;
    if (source instanceof ArrayBuffer) return new Uint8Array(source);
    throw new Error('Sumber WASM harus Uint8Array atau ArrayBuffer (ambil dari api.asset()).');
  };
  const toWasmInput = input => {
    if (input == null) return new Uint8Array(0);
    if (typeof input === 'string') return new TextEncoder().encode(input);
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    throw new Error('Input WASM harus string, Uint8Array, atau ArrayBuffer.');
  };
  const wrapWasm = instance => {
    const ex = instance.exports;
    if (!ex || !(ex.memory instanceof WebAssembly.Memory)) throw new Error('Modul WASM harus mengekspor memory.');
    const wrap = {
      instance,
      exports: ex,
      memory: ex.memory,
      writeBytes(data) {
        const u8 = typeof data === 'string' ? new TextEncoder().encode(data) : toWasmInput(data);
        if (typeof ex.alloc !== 'function') throw new Error('Modul WASM harus mengekspor alloc(size) untuk writeBytes.');
        const ptr = ex.alloc(u8.length);
        new Uint8Array(ex.memory.buffer).set(u8, ptr);
        return { ptr, len: u8.length };
      },
      readBytes(ptr, len) { return new Uint8Array(ex.memory.buffer).slice(ptr, ptr + len); },
      readString(ptr, len) { return new TextDecoder().decode(wrap.readBytes(ptr, len)); },
      free(ptr, len) { if (typeof ex.free === 'function') ex.free(ptr, len); }
    };
    return wrap;
  };
  const decodeBuffer = buf => {
    const b = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
    for (const enc of ['utf-8', 'shift_jis', 'windows-31j', 'cp932']) {
      try { return new TextDecoder(enc, { fatal: true }).decode(b); } catch {}
    }
    return new TextDecoder('utf-8').decode(b);
  };
  const handlers = {
    init(m) {
      if (!m || typeof m.code !== 'string') throw new Error('Payload init plugin tidak valid.');
      pluginId = m.pluginId;
      apiVersion = m.apiVersion;
      settings = (m.settings && typeof m.settings === 'object') ? m.settings : {};
      if (m.jszip) {
        const s = document.createElement('script');
        s.textContent = m.jszip;
        document.documentElement.appendChild(s);
      }
      const factory = new Function('module', 'exports', '"use strict";\n' + m.code + '\n;return module.exports;');
      const mod = { exports: {} };
      const out = factory(mod, mod.exports);
      if (!out || typeof out !== 'object') throw new Error('Plugin tidak mengekspor objek.');
      plug = out;
      api = {
        version: apiVersion,
        pluginId,
        get settings() { return settings; },
        toast: msg => callHost('toast', [msg]),
        copy: text => callHost('copy', [text]),
        copySelection: () => callHost('copySelection', []),
        selectRange: (from, to) => callHost('selectRange', [from, to]),
        clearSelection: () => callHost('clearSelection', []),
        getSelection: () => callHost('getSelection', []),
        getProject: () => callHost('getProject', []),
        getLines: () => callHost('getLines', []),
        on: (event, handler) => {
          if (typeof handler !== 'function') return () => {};
          if (!listeners.has(event)) listeners.set(event, new Set());
          const set = listeners.get(event);
          set.add(handler);
          return () => { try { set.delete(handler); } catch {} };
        },
        listAssets: () => callHost('listAssets', []),
        asset: path => callHost('asset', [path]),
        assetText: path => callHost('assetText', [path]),
        get JSZip() { return window.JSZip || null; },
        wasm: async (source, imports) => {
          const res = await WebAssembly.instantiate(toWasmSource(source), imports || {});
          return wrapWasm(res.instance);
        },
        runWasm: (source, fn, input) => callHost('runWasm', [source, fn, input]),
        pickFile: accept => callHost('pickFile', [accept]),
        download: (data, filename) => callHost('download', [data, filename]),
        decode: decodeBuffer
      };
      const commands = [];
      if (plug.commands && typeof plug.commands === 'object') {
        for (const key of Object.keys(plug.commands)) {
          const cmd = plug.commands[key];
          if (cmd && typeof cmd === 'object' && typeof cmd.run === 'function') commands.push({ key, label: String(cmd.label || key) });
        }
      }
      const safe = v => { try { return JSON.parse(JSON.stringify(v === undefined ? null : v)); } catch { return null; } };
      const pluginSettings = [];
      if (Array.isArray(plug.settings)) for (const it of plug.settings) if (it && typeof it === 'object') pluginSettings.push(safe(it));
      return {
        settings: pluginSettings,
        theme: typeof plug.theme === 'string' ? plug.theme : null,
        commands,
        hooks: { onCopy: typeof plug.onCopy === 'function', onApply: typeof plug.onApply === 'function' },
        extract: typeof plug.extract === 'function',
        pack: typeof plug.pack === 'function',
        panel: typeof plug.panel === 'function'
      };
    },
    activate() {
      if (plug && typeof plug.activate === 'function') return plug.activate(api);
    },
    deactivate() {
      if (plug && typeof plug.deactivate === 'function') return plug.deactivate();
    },
    settings(m) {
      settings = (m.settings && typeof m.settings === 'object') ? m.settings : {};
    },
    hook(m) {
      const fn = plug ? plug[m.name] : null;
      if (typeof fn !== 'function') return null;
      return Promise.resolve(fn(m.text, m.ctx)).then(r => (typeof r === 'string' ? r : null));
    },
    extract(m) {
      if (!plug || typeof plug.extract !== 'function') throw new Error('Plugin tidak mendukung extract.');
      return Promise.resolve(plug.extract({ fileName: m.fileName, buffer: m.buffer, settings, api })).then(out => {
        if (!out || !Array.isArray(out.lines)) throw new Error('Plugin tidak mengembalikan lines array.');
        return out;
      });
    },
    pack(m) {
      if (!plug || typeof plug.pack !== 'function') throw new Error('Plugin tidak mendukung pack.');
      return Promise.resolve(plug.pack({ lines: m.lines, sourceMap: m.sourceMap, projectName: m.projectName, settings, api })).then(out => {
        if (!out || !(out.blob instanceof Blob)) throw new Error('Plugin tidak mengembalikan blob yang valid.');
        return { blob: out.blob, filename: out.filename || null };
      });
    },
    command(m) {
      const cmd = (plug && plug.commands) ? plug.commands[m.key] : null;
      if (cmd && typeof cmd.run === 'function') return cmd.run(api);
    },
    panel(m) {
      if (m && typeof m.theme === 'string' && m.theme) {
        let st = document.getElementById('cstl-theme');
        if (!st) {
          st = document.createElement('style');
          st.id = 'cstl-theme';
          document.head.appendChild(st);
        }
        st.textContent = m.theme + PANEL_BASE_CSS;
      }
      if (m && m.open && !panelMounted && plug && typeof plug.panel === 'function') {
        panelMounted = true;
        return plug.panel(document.body, api);
      }
    },
    emit(m) {
      const set = listeners.get(m.event);
      if (!set) return;
      for (const fn of Array.from(set)) {
        try { fn(m.payload); } catch (e) { console.error('[plugin]', e); }
      }
    }
  };
  addEventListener('message', e => {
    const m = e.data;
    if (!m || m.t !== token) return;
    if (m.q === 'res') {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.val); else p.reject(new Error(m.err || 'RPC gagal.'));
      return;
    }
    if (m.q === 'call') {
      const h = handlers[m.method];
      if (!h) { post({ q: 'res', id: m.id, ok: false, err: 'Perintah tidak dikenal: ' + m.method }); return; }
      Promise.resolve().then(() => h(m.arg)).then(
        val => post({ q: 'res', id: m.id, ok: true, val: val === undefined ? null : val }),
        err => post({ q: 'res', id: m.id, ok: false, err: String((err && err.message) || err) })
      );
    }
  });
  post({ q: 'ready' });
}

const PluginRuntime = {
  _index: [],
  _instances: new Map(),
  _live: new Set(),
  _msgBound: false,
  _jszipSrc: null,
  _lastThemeCss: null,
  _styleEl: null,
  _workerUrl: null,

  async init() {
    const raw = await Storage.readPluginIndex();
    const legacy = (raw || []).filter(p => !Array.isArray(p.files));
    if (legacy.length) console.error(`[plugins] ${legacy.length} plugin format lama (single .js) dihapus — pasang ulang sebagai paket .zip.`);
    PluginRuntime._index = (raw || []).filter(p => Array.isArray(p.files));
    if (raw !== null) {
      await PluginRuntime._sweepOrphanPacks();
      if (legacy.length) await PluginRuntime._persist();
    }
    await PluginRuntime.sync();
    let dirty = false;
    for (const meta of PluginRuntime._index) {
      if (meta.enabled !== true) continue;
      try { await PluginRuntime._activate(meta); }
      catch (e) {
        console.error(`[plugin:${meta.id}] gagal diaktifkan:`, e);
        meta.enabled = false;
        dirty = true;
      }
    }
    if (dirty) await PluginRuntime._persist();
    PluginRuntime.applyTheme();
    Shortcuts.refreshPluginActions();
  },

  async sync() {
    const root = await Storage.root().catch(() => null);
    if (!root) return false;
    const alive = [];
    let changed = false;
    for (const meta of PluginRuntime._index) {
      try {
        await root.getFileHandle(PLUGIN_PREFIX + meta.id + '.zip');
        alive.push(meta);
      } catch {
        PluginRuntime._deactivate(meta.id);
        changed = true;
      }
    }
    if (!changed) return false;
    PluginRuntime._index = alive;
    await PluginRuntime._persist();
    PluginRuntime.applyTheme();
    Shortcuts.refreshPluginActions();
    return true;
  },

  async _sweepOrphanPacks() {
    const root = await Storage.root().catch(() => null);
    if (!root) return;
    const installed = new Set(PluginRuntime._index.map(p => PLUGIN_PREFIX + p.id + '.zip'));
    for await (const [name, h] of root.entries()) {
      if (h.kind !== 'file' || !name.startsWith(PLUGIN_PREFIX)) continue;
      if (installed.has(name)) continue;
      try { await root.removeEntry(name); } catch {}
    }
  },

  listMeta() { return PluginRuntime._index.slice(); },

  getMeta(id) { return PluginRuntime._index.find(p => p.id === id) || null; },

  async _persist() { await Storage.writePluginIndex(PluginRuntime._index); },

  parseManifest(code) {
    const m = String(code || '').match(/\/\*\s*@cstl\s*([\s\S]*?)\*\//);
    if (!m) return null;
    try { return JSON.parse(m[1].trim()); } catch { return null; }
  },

  validateManifest(m) {
    if (!m || typeof m !== 'object') return false;
    if (typeof m.id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(m.id)) return false;
    if (typeof m.name !== 'string' || !m.name.trim()) return false;
    if (typeof m.version !== 'string' || !m.version.trim()) return false;
    if (m.author != null && typeof m.author !== 'string') return false;
    if (m.description != null && typeof m.description !== 'string') return false;
    if (m.api != null && (typeof m.api !== 'number' || m.api > PLUGIN_API_VERSION)) return false;
    if (m.extensions != null) {
      if (!Array.isArray(m.extensions) || !m.extensions.length) return false;
      if (!m.extensions.every(e => typeof e === 'string' && e.trim().startsWith('.'))) return false;
    }
    if (m.magic != null) {
      if (!Array.isArray(m.magic) || !m.magic.length) return false;
      if (!m.magic.every(s => PluginRuntime.validSig(s))) return false;
    }
    if (m.ui != null) {
      if (typeof m.ui !== 'object' || Array.isArray(m.ui)) return false;
      if (m.ui.title != null && (typeof m.ui.title !== 'string' || !m.ui.title.trim())) return false;
      if (m.ui.height != null && (typeof m.ui.height !== 'number' || !Number.isFinite(m.ui.height) || m.ui.height <= 0)) return false;
    }
    return true;
  },

  normalizeUi(ui) {
    if (!ui || typeof ui !== 'object' || Array.isArray(ui)) return null;
    const out = {};
    if (typeof ui.title === 'string' && ui.title.trim()) out.title = ui.title.trim().slice(0, 60);
    if (typeof ui.height === 'number' && Number.isFinite(ui.height)) out.height = Math.min(600, Math.max(120, Math.round(ui.height)));
    return out;
  },

  validSig(s) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
    const hasHex = Object.hasOwn(s, 'hex'), hasText = Object.hasOwn(s, 'text');
    if (hasHex === hasText) return false;
    if (hasHex) {
      if (typeof s.hex !== 'string') return false;
      const h = s.hex.replace(/\s+/g, '');
      if (!h.length || h.length % 2 || !/^[0-9a-f]+$/i.test(h)) return false;
    }
    if (hasText && (typeof s.text !== 'string' || !s.text.length)) return false;
    if (s.offset != null && (!Number.isInteger(s.offset) || s.offset < 0)) return false;
    return true;
  },

  normalizeSig(s) {
    if (!PluginRuntime.validSig(s)) return null;
    const offset = Number.isInteger(s.offset) && s.offset >= 0 ? s.offset : 0;
    if (Object.hasOwn(s, 'hex')) return { hex: s.hex.replace(/\s+/g, '').toLowerCase(), offset };
    return { hex: Array.from(new TextEncoder().encode(s.text), b => b.toString(16).padStart(2, '0')).join(''), offset };
  },

  compileSig(s) {
    const bytes = new Uint8Array(s.hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(s.hex.substr(i * 2, 2), 16);
    return { bytes, offset: s.offset || 0 };
  },

  normalizeSettings(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const s of raw) {
      if (!s || typeof s !== 'object') continue;
      if (typeof s.key !== 'string' || !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(s.key)) continue;
      if (typeof s.label !== 'string' || !s.label.trim()) continue;
      const type = ['string', 'number', 'boolean', 'select', 'textarea'].includes(s.type) ? s.type : 'string';
      const def = type === 'number' ? (Number(s.default) || 0)
        : type === 'boolean' ? !!s.default
        : String(s.default ?? '');
      const entry = { key: s.key, label: s.label, type, default: def };
      if (type === 'select' && Array.isArray(s.options)) {
        entry.options = s.options.map(o => (o && typeof o === 'object')
          ? { value: String(o.value), label: String(o.label) }
          : { value: String(o), label: String(o) });
      }
      if (typeof s.placeholder === 'string') entry.placeholder = s.placeholder;
      if (typeof s.description === 'string') entry.description = s.description;
      out.push(entry);
    }
    return out;
  },

  valuesFor(meta) {
    const vals = (State.projectId && State.pluginSettings && State.pluginSettings[meta.id] && typeof State.pluginSettings[meta.id] === 'object') ? State.pluginSettings[meta.id] : {};
    const out = {};
    for (const s of (meta.settings || [])) out[s.key] = (s.key in vals) ? vals[s.key] : s.default;
    return out;
  },

  setValues(id, values) {
    if (!State.projectId) return;
    const next = { ...State.pluginSettings };
    if (values && typeof values === 'object' && Object.keys(values).length) next[id] = values;
    else delete next[id];
    State.pluginSettings = next;
    PluginRuntime.syncSettings();
    State.queueSave();
  },

  toWasmSource(source) {
    if (source instanceof Uint8Array) return source;
    if (source instanceof ArrayBuffer) return new Uint8Array(source);
    throw new Error('Sumber WASM harus Uint8Array atau ArrayBuffer (ambil dari api.asset()).');
  },

  toWasmInput(input) {
    if (input == null) return new Uint8Array(0);
    if (typeof input === 'string') return new TextEncoder().encode(input);
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    throw new Error('Input WASM harus string, Uint8Array, atau ArrayBuffer.');
  },

  workerUrl() {
    if (!PluginRuntime._workerUrl) {
      const src = '"use strict";self.onmessage=async(e)=>{const{src,fn,input}=e.data;try{const r=await WebAssembly.instantiate(src,{});const ex=r.instance.exports;if(typeof ex[fn]!=="function")throw new Error(\'Export "\'+fn+\'" tidak ditemukan.\');if(typeof ex.alloc!=="function")throw new Error(\'Modul WASM harus mengekspor alloc(size).\');const inPtr=ex.alloc(input.length);new Uint8Array(ex.memory.buffer).set(input,inPtr);const resPtr=ex[fn](inPtr,input.length);const dv=new DataView(ex.memory.buffer);const outLen=dv.getUint32(resPtr,true);const out=new Uint8Array(ex.memory.buffer).slice(resPtr+4,resPtr+4+outLen);if(typeof ex.free==="function"){try{ex.free(inPtr,input.length);ex.free(resPtr,outLen+4);}catch(err){}}self.postMessage({ok:true,output:out});}catch(err){self.postMessage({ok:false,error:String(err&&err.message||err)});}};';
      PluginRuntime._workerUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    }
    return PluginRuntime._workerUrl;
  },

  runWasm(source, fn, input) {
    return new Promise((resolve, reject) => {
      let wasmBytes, inputBytes;
      try {
        wasmBytes = PluginRuntime.toWasmSource(source).slice();
        inputBytes = PluginRuntime.toWasmInput(input).slice();
      } catch (e) { reject(e); return; }
      let worker = null;
      try { worker = new Worker(PluginRuntime.workerUrl()); }
      catch {
        PluginRuntime.runWasmInline(wasmBytes, fn, inputBytes).then(resolve, reject);
        return;
      }
      worker.onmessage = ev => {
        const d = ev.data || {};
        worker.terminate();
        if (d.ok) resolve(d.output);
        else reject(new Error(d.error || 'runWasm gagal.'));
      };
      worker.onerror = ev => {
        worker.terminate();
        reject(new Error(ev.message || 'runWasm gagal.'));
      };
      worker.postMessage({ src: wasmBytes, fn, input: inputBytes }, [wasmBytes.buffer, inputBytes.buffer]);
    });
  },

  async runWasmInline(wasmBytes, fn, inputBytes) {
    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const ex = instance.exports;
    if (typeof ex[fn] !== 'function') throw new Error(`Export "${fn}" tidak ditemukan.`);
    if (typeof ex.alloc !== 'function') throw new Error('Modul WASM harus mengekspor alloc(size).');
    const inPtr = ex.alloc(inputBytes.length);
    new Uint8Array(ex.memory.buffer).set(inputBytes, inPtr);
    const resPtr = ex[fn](inPtr, inputBytes.length);
    const dv = new DataView(ex.memory.buffer);
    const outLen = dv.getUint32(resPtr, true);
    const out = new Uint8Array(ex.memory.buffer).slice(resPtr + 4, resPtr + 4 + outLen);
    if (typeof ex.free === 'function') {
      try { ex.free(inPtr, inputBytes.length); ex.free(resPtr, outLen + 4); } catch {}
    }
    return out;
  },

  pickFile(accept) {
    return new Promise(resolve => {
      const inp = document.createElement('input');
      inp.type = 'file';
      if (accept) inp.accept = String(accept);
      inp.style.display = 'none';
      document.body.appendChild(inp);
      let settled = false;
      const finish = val => {
        if (settled) return;
        settled = true;
        inp.remove();
        resolve(val);
      };
      inp.addEventListener('change', async () => {
        const f = inp.files && inp.files[0];
        if (!f) return finish(null);
        try { finish({ name: f.name, buffer: await f.arrayBuffer() }); }
        catch { finish(null); }
      });
      inp.addEventListener('cancel', () => finish(null));
      inp.click();
    });
  },

  download(data, filename) {
    let blob = data instanceof Blob ? data : null;
    if (!blob) {
      const body = (data instanceof Uint8Array || data instanceof ArrayBuffer) ? data : String(data ?? '');
      blob = new Blob([body], { type: 'application/octet-stream' });
    }
    download(URL.createObjectURL(blob), String(filename || 'download'));
  },

  resolveAssetPath(path) {
    const p = String(path ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    if (!p || p.split('/').some(seg => seg === '..' || seg === '')) {
      throw new Error(`Path asset tidak valid: "${path}"`);
    }
    return p;
  },

  async _readAsset(inst, path, type) {
    const p = PluginRuntime.resolveAssetPath(path);
    const f = inst.pkg.file(p);
    if (!f) throw new Error(`Asset "${p}" tidak ditemukan di paket.`);
    return await f.async(type);
  },

  async _jszipText() {
    if (!PluginRuntime._jszipSrc) {
      const res = await fetch(JSZIP_URL);
      if (!res.ok) throw new Error('Gagal memuat sumber JSZip.');
      PluginRuntime._jszipSrc = await res.text();
    }
    return PluginRuntime._jszipSrc;
  },

  _listen() {
    if (PluginRuntime._msgBound) return;
    PluginRuntime._msgBound = true;
    window.addEventListener('message', async e => {
      let inst = null;
      for (const i of PluginRuntime._live) if (i.win === e.source) { inst = i; break; }
      if (!inst) return;
      const m = e.data;
      if (!m || m.t !== inst.token) return;
      if (m.q === 'res') {
        const p = inst.pending.get(m.id);
        if (!p) return;
        inst.pending.delete(m.id);
        if (m.ok) p.resolve(m.val); else p.reject(new Error(m.err || 'RPC gagal.'));
        return;
      }
      if (m.q === 'ready') { inst.onReady(); return; }
      if (m.q === 'api') {
        const fn = PluginRuntime._apiHandlers(inst)[m.method];
        if (typeof fn !== 'function') { inst.reply(m.id, false, new Error('Metode API tidak dikenal: ' + m.method)); return; }
        try { inst.reply(m.id, true, await fn(...(m.args || []))); }
        catch (err) { inst.reply(m.id, false, err); }
      }
    });
  },

  _apiHandlers(inst) {
    return {
      toast: msg => App.flash(String(msg ?? '')),
      copy: text => clipboard(String(text ?? '')),
      copySelection: () => App.copyForAi(),
      selectRange: (from, to) => { els.rangeFromInput.value = from; els.rangeToInput.value = to; App.selectRange(); },
      clearSelection: () => { State.selected.clear(); App.syncCheckboxes(); },
      getSelection: () => Array.from(State.selected),
      getProject: () => State.projectId ? {
        name: State.projectName,
        type: State.projectType,
        fileCount: State.files.length,
        lineCount: State.lines.length,
        translatedCount: State.translatedCount
      } : null,
      getLines: () => State.lines.map(l => ({
        num: l.line_num,
        name: l.name,
        message: l.message,
        translated: !!l.is_translated,
        fileName: l.file
      })),
      listAssets: () => inst.meta.files.slice(),
      asset: path => PluginRuntime._readAsset(inst, path, 'uint8array'),
      assetText: path => PluginRuntime._readAsset(inst, path, 'string'),
      runWasm: (source, fn, input) => PluginRuntime.runWasm(source, fn, input),
      pickFile: accept => PluginRuntime.pickFile(accept),
      download: (data, filename) => PluginRuntime.download(data, filename)
    };
  },

  async _boot(meta, code, pkg, parentEl) {
    PluginRuntime._listen();
    let onReady = () => {};
    const ready = new Promise(r => { onReady = r; });
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    if (parentEl) {
      frame.className = 'plugin-panel-frame';
      frame.title = (meta.ui && meta.ui.title) || meta.name;
    } else {
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.style.cssText = 'display:none';
    }
    const token = (crypto.randomUUID ? crypto.randomUUID() : 't' + Date.now() + Math.random());
    frame.srcdoc = '<!doctype html><script>(' + pluginFrameMain.toString() + ')(' + JSON.stringify(token) + ');</script>';
    const inst = {
      frame,
      win: null,
      token,
      meta,
      pkg,
      pending: new Map(),
      seq: 0,
      info: null,
      theme: null,
      cmdMeta: [],
      hooks: { onCopy: false, onApply: false },
      hasExtract: false,
      hasPack: false,
      panelCard: parentEl ? parentEl.closest('.plugin-panel-card') : null,
      onReady,
      call(method, arg) {
        return new Promise((resolve, reject) => {
          const id = ++inst.seq;
          inst.pending.set(id, { resolve, reject });
          inst.win.postMessage({ t: inst.token, q: 'call', id, method, arg }, '*');
        });
      },
      reply(id, ok, val) {
        const msg = { t: inst.token, q: 'res', id, ok };
        if (ok) msg.val = val; else msg.err = String((val && val.message) || val);
        try { inst.win.postMessage(msg, '*'); }
        catch {
          try { inst.win.postMessage({ t: inst.token, q: 'res', id, ok: false, err: 'Nilai API tidak dapat dikirim.' }, '*'); } catch {}
        }
      }
    };
    (parentEl || document.body).appendChild(frame);
    inst.win = frame.contentWindow;
    PluginRuntime._live.add(inst);
    let js = null;
    try { js = await PluginRuntime._jszipText(); } catch {}
    try {
      await Promise.race([ready, new Promise((_, rej) => setTimeout(() => rej(new Error('Plugin gagal dimuat.')), 4000))]);
      const info = await inst.call('init', { pluginId: meta.id, apiVersion: PLUGIN_API_VERSION, code, settings: PluginRuntime.valuesFor(meta), jszip: js });
      inst.info = info;
      inst.theme = info.theme;
      inst.cmdMeta = info.commands || [];
      inst.hooks = info.hooks || { onCopy: false, onApply: false };
      inst.hasExtract = !!info.extract;
      inst.hasPack = !!info.pack;
      return inst;
    } catch (e) {
      PluginRuntime._live.delete(inst);
      if (inst.panelCard) { try { inst.panelCard.remove(); } catch {} }
      try { frame.remove(); } catch {}
      throw e;
    }
  },

  _destroy(inst) {
    PluginRuntime._live.delete(inst);
    if (inst.panelCard) { try { inst.panelCard.remove(); } catch {} }
    let killed = false;
    const kill = () => { if (!killed) { killed = true; try { inst.frame.remove(); } catch {} } };
    setTimeout(kill, 300);
    inst.call('deactivate', {}).then(kill, kill);
  },

  syncSettings() {
    for (const inst of PluginRuntime._instances.values()) {
      inst.call('settings', { settings: PluginRuntime.valuesFor(inst.meta) }).catch(() => {});
    }
  },

  async _activate(meta) {
    if (!jsZipReady()) throw new Error('JSZip belum termuat, tunggu sebentar lalu coba lagi.');
    const zipBuffer = await Storage.loadPluginZip(meta.id);
    const pkg = await JSZip.loadAsync(zipBuffer).catch(() => { throw new Error('File paket plugin rusak.'); });
    const entry = pkg.file('plugin.js');
    if (!entry) throw new Error('plugin.js tidak ditemukan di paket plugin.');
    const code = await entry.async('string');
    const host = meta.ui ? PluginRuntime._panelHost(meta) : null;
    const inst = await PluginRuntime._boot(meta, code, pkg, host && host.body);
    PluginRuntime._instances.set(meta.id, inst);
    try { await inst.call('activate', {}); }
    catch (e) {
      PluginRuntime._instances.delete(meta.id);
      PluginRuntime._destroy(inst);
      throw e;
    }
    if (host) PluginRuntime._wirePanel(inst, host);
    PluginRuntime.syncSettings();
  },

  _panelHost(meta) {
    const wrap = document.getElementById('pluginPanels');
    if (!wrap) return null;
    const ui = meta.ui || {};
    const card = document.createElement('div');
    card.className = 'plugin-panel-card open';
    card.innerHTML = `
      <button class="plugin-panel-head" type="button">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
        <span class="plugin-panel-title">${escapeHtml(ui.title || meta.name)}</span>
        <svg class="plugin-panel-chevron" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <div class="plugin-panel-body" style="height:${ui.height || 300}px"></div>`;
    wrap.appendChild(card);
    return { card, body: card.querySelector('.plugin-panel-body') };
  },

  _wirePanel(inst, host) {
    inst.panelCard = host.card;
    host.card.querySelector('.plugin-panel-head').addEventListener('click', () => {
      if (host.card.classList.toggle('open')) PluginRuntime._panelShow(inst);
    });
    PluginRuntime._panelShow(inst);
  },

  _panelShow(inst) {
    inst.call('panel', { open: true, theme: themeVarsCss() }).catch(e => PluginRuntime._fail(inst.meta, e));
  },

  _deactivate(id) {
    const inst = PluginRuntime._instances.get(id);
    if (!inst) return;
    PluginRuntime._instances.delete(id);
    PluginRuntime._destroy(inst);
  },

  async setEnabled(id, enabled) {
    const meta = PluginRuntime.getMeta(id);
    if (!meta) return;
    if (enabled) {
      try { await PluginRuntime._activate(meta); }
      catch (e) {
        App.flash(`Plugin "${meta.name}" gagal diaktifkan: ${e.message}`);
        return;
      }
    } else {
      PluginRuntime._deactivate(id);
    }
    meta.enabled = !!enabled;
    await PluginRuntime._persist();
    PluginRuntime.applyTheme();
    Shortcuts.refreshPluginActions();
  },

  applyTheme() {
    if (!PluginRuntime._styleEl) {
      PluginRuntime._styleEl = document.createElement('style');
      PluginRuntime._styleEl.id = 'pluginTheme';
      document.head.appendChild(PluginRuntime._styleEl);
    }
    const parts = [];
    for (const inst of PluginRuntime._instances.values()) {
      if (inst.theme) parts.push(inst.theme);
    }
    const css = parts.join('\n');
    PluginRuntime._styleEl.textContent = css;
    if (css !== PluginRuntime._lastThemeCss) {
      PluginRuntime._lastThemeCss = css;
      const vars = themeVarsCss();
      for (const inst of PluginRuntime._instances.values()) {
        if (inst.panelCard) inst.call('panel', { theme: vars }).catch(() => {});
      }
    }
  },

  async install(file) {
    const name = String(file.name || '');
    if (!/\.zip$/i.test(name)) throw new Error('Plugin harus berupa paket .zip berisi plugin.js di root.');
    if (!jsZipReady()) throw new Error('JSZip belum termuat, tunggu sebentar lalu coba lagi.');
    const zipBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(zipBuffer).catch(() => { throw new Error('File .zip tidak valid atau rusak.'); });
    const entry = zip.file('plugin.js');
    if (!entry) throw new Error('Paket harus berisi plugin.js di root.');
    const text = await entry.async('string');
    const files = Object.keys(zip.files)
      .filter(n => !zip.files[n].dir && n !== 'plugin.js')
      .map(n => n.replace(/^\.\//, '').replace(/^\/+/, ''))
      .filter(n => n && !n.split('/').some(seg => seg === '..' || seg === ''))
      .sort();
    const manifest = PluginRuntime.parseManifest(text);
    if (!manifest || !PluginRuntime.validateManifest(manifest)) {
      throw new Error('File tidak berisi manifest /* @cstl { ... } */ yang valid.');
    }
    const meta = {
      id: manifest.id,
      name: manifest.name.trim(),
      version: manifest.version.trim(),
      author: (manifest.author || '').trim(),
      description: (manifest.description || '').trim(),
      extensions: Array.isArray(manifest.extensions) ? manifest.extensions.map(e => e.trim().toLowerCase()) : [],
      magic: (Array.isArray(manifest.magic) ? manifest.magic : []).map(s => PluginRuntime.normalizeSig(s)).filter(Boolean),
      ui: PluginRuntime.normalizeUi(manifest.ui),
      settings: [],
      files,
      caps: [],
      enabled: true,
      updatedAt: Date.now()
    };
    const host = meta.ui ? PluginRuntime._panelHost(meta) : null;
    const inst = await PluginRuntime._boot(meta, text, zip, host && host.body);
    const settings = PluginRuntime.normalizeSettings(inst.info.settings);
    const caps = [];
    if (manifest.extensions?.length || manifest.magic?.length) caps.push('parser');
    if (inst.theme && inst.theme.trim()) caps.push('theme');
    if (inst.hooks.onCopy || inst.hooks.onApply) caps.push('hooks');
    if (inst.cmdMeta.length) caps.push('commands');
    if (settings.length) caps.push('settings');
    if (meta.ui && inst.info.panel) caps.push('panel');
    const existing = PluginRuntime.getMeta(manifest.id);
    if (existing && !confirm(`Plugin "${manifest.name}" sudah terpasang (v${existing.version}). Timpa dengan v${manifest.version}?`)) {
      PluginRuntime._destroy(inst);
      return null;
    }
    meta.settings = settings;
    meta.caps = caps;
    meta.enabled = existing ? existing.enabled === true : true;
    await Storage.savePluginZip(manifest.id, zipBuffer);
    const i = PluginRuntime._index.findIndex(p => p.id === meta.id);
    if (i >= 0) PluginRuntime._index[i] = meta; else PluginRuntime._index.push(meta);
    PluginRuntime._deactivate(meta.id);
    if (meta.enabled) {
      try {
        PluginRuntime._instances.set(meta.id, inst);
        await inst.call('activate', {});
        if (host) PluginRuntime._wirePanel(inst, host);
        PluginRuntime.syncSettings();
      } catch (e) {
        PluginRuntime._instances.delete(meta.id);
        PluginRuntime._destroy(inst);
        meta.enabled = false;
        App.flash(`Plugin "${meta.name}" gagal diaktifkan: ${e.message}`);
      }
    } else {
      PluginRuntime._destroy(inst);
    }
    await PluginRuntime._persist();
    PluginRuntime.applyTheme();
    Shortcuts.refreshPluginActions();
    return meta;
  },

  async uninstall(id) {
    const meta = PluginRuntime.getMeta(id);
    if (!meta) throw new Error('Plugin tidak ditemukan.');
    const linked = (await Storage.list()).filter(p => p.projectType === 'plugin' && p.pluginId === id);
    const msg = linked.length
      ? `Plugin "${meta.name}" akan dihapus.\n${linked.length} project terkait tetap tersimpan, tetapi butuh plugin ini agar bisa dibuka kembali.\n\nLanjutkan?`
      : `Plugin "${meta.name}" akan dihapus. Lanjutkan?`;
    if (!confirm(msg)) return false;
    PluginRuntime._deactivate(id);
    for (const p of linked) {
      try {
        const data = await Storage.load(p.id);
        if (!data.pluginName) {
          data.pluginName = meta.name;
          await Storage.saveProject(p.id, data);
        }
      } catch {}
    }
    await Storage.removePluginFile(id);
    PluginRuntime._index = PluginRuntime._index.filter(p => p.id !== id);
    await PluginRuntime._persist();
    PluginRuntime.applyTheme();
    Shortcuts.refreshPluginActions();
    return true;
  },

  resolveByExtension(fileName) {
    const name = String(fileName || '');
    const dot = name.lastIndexOf('.');
    if (dot < 0) return null;
    const ext = name.slice(dot).toLowerCase();
    return PluginRuntime._index.find(p => p.enabled === true && (p.extensions || []).some(e => String(e).toLowerCase() === ext)) || null;
  },

  resolveByMagic(head) {
    if (!(head instanceof Uint8Array) || !head.length) return null;
    return PluginRuntime._index.find(p => p.enabled === true && (p.magic || []).some(raw => {
      const sig = PluginRuntime.compileSig(raw);
      return sig && sig.offset + sig.bytes.length <= head.length && sig.bytes.every((b, i) => head[sig.offset + i] === b);
    })) || null;
  },

  _hookCtx() {
    return {
      projectName: State.projectName || null,
      lineCount: State.lines.length,
      translatedCount: State.translatedCount,
      selectedLines: Array.from(State.selected)
    };
  },

  async runCopyHook(text) {
    let out = text;
    for (const inst of PluginRuntime._instances.values()) {
      if (!inst.hooks.onCopy) continue;
      try {
        const r = await inst.call('hook', { name: 'onCopy', text: out, ctx: PluginRuntime._hookCtx() });
        if (typeof r === 'string') out = r;
      } catch (e) { PluginRuntime._fail(inst.meta, e); }
    }
    return out;
  },

  async runApplyHook(text) {
    let out = text;
    for (const inst of PluginRuntime._instances.values()) {
      if (!inst.hooks.onApply) continue;
      try {
        const r = await inst.call('hook', { name: 'onApply', text: out, ctx: PluginRuntime._hookCtx() });
        if (typeof r === 'string') out = r;
      } catch (e) { PluginRuntime._fail(inst.meta, e); }
    }
    return out;
  },

  emit(event, payload) {
    for (const inst of PluginRuntime._instances.values()) {
      inst.call('emit', { event, payload }).catch(() => {});
    }
  },

  commands() {
    const out = [];
    for (const inst of PluginRuntime._instances.values()) {
      for (const c of inst.cmdMeta) {
        out.push({
          id: `plugin.${inst.meta.id}.${c.key}`,
          label: c.label,
          pluginName: inst.meta.name,
          run: () => inst.call('command', { key: c.key })
        });
      }
    }
    return out;
  },

  async runCommand(id) {
    const cmd = PluginRuntime.commands().find(c => c.id === id);
    if (!cmd) return;
    try { await cmd.run(); }
    catch (e) { PluginRuntime._fail({ id, name: cmd.pluginName }, e); }
  },

  renderMenu() {
    const host = els.pluginMenu;
    if (!host) return;
    const html = [];
    const cmds = PluginRuntime.commands();
    if (cmds.length) {
      let lastPlugin = null;
      for (const c of cmds) {
        if (c.pluginName !== lastPlugin) {
          lastPlugin = c.pluginName;
          html.push(`<div class="dropdown-label">${escapeHtml(c.pluginName)}</div>`);
        }
        const action = Shortcuts.allActions().find(a => a.id === c.id);
        const combo = action ? Shortcuts.bindingFor(action) : '';
        html.push(`<button type="button" class="dropdown-item" data-cmd="${escapeHtml(c.id)}"><span class="menu-label">${escapeHtml(c.label)}</span>${combo ? `<span class="menu-kbd">${comboHtml(combo)}</span>` : ''}</button>`);
      }
    }
    const active = PluginRuntime.listMeta().filter(p => p.enabled === true);
    const settable = active.filter(p => Array.isArray(p.settings) && p.settings.length > 0);
    if (settable.length) {
      if (cmds.length) html.push('<div class="dropdown-sep"></div>');
      html.push('<div class="dropdown-label">Pengaturan</div>');
      const gear = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
      for (const p of settable) {
        html.push(`<button type="button" class="dropdown-item plugin-settings-item" data-plugin-settings="${escapeHtml(p.id)}" title="Buka pengaturan plugin ini"><span class="menu-label">${escapeHtml(p.name)}</span><span class="menu-icon-btn">${gear}</span></button>`);
      }
    }
    if (!cmds.length && !settable.length) {
      html.push(active.length
        ? '<div class="dropdown-hint">Plugin aktif tidak memiliki perintah atau pengaturan.</div>'
        : '<div class="dropdown-hint">Belum ada plugin aktif. Kelola plugin lewat Pengaturan di halaman utama.</div>');
    }
    host.innerHTML = html.join('');
  },

  async callExtract(meta, input) {
    const inst = PluginRuntime._instances.get(meta.id);
    if (!inst) throw new Error(`Plugin "${meta.name}" tidak aktif.`);
    if (!inst.hasExtract) throw new Error(`Plugin "${meta.name}" tidak mendukung extract.`);
    const out = await inst.call('extract', { fileName: input.fileName, buffer: input.buffer, settings: input.settings });
    if (!out || !Array.isArray(out.lines)) throw new Error(`Plugin "${meta.name}" tidak mengembalikan lines array.`);
    return out;
  },

  async callPack(meta, input) {
    const inst = PluginRuntime._instances.get(meta.id);
    if (!inst) throw new Error(`Plugin "${meta.name}" tidak aktif.`);
    if (!inst.hasPack) throw new Error(`Plugin "${meta.name}" tidak mendukung pack.`);
    const out = await inst.call('pack', { lines: input.lines, sourceMap: input.sourceMap, projectName: input.projectName });
    if (!out || !(out.blob instanceof Blob)) throw new Error(`Plugin "${meta.name}" tidak mengembalikan blob yang valid.`);
    return out;
  },

  normalizePluginLines(raw, startNum) {
    const out = [];
    let n = startNum;
    for (const l of (raw || [])) {
      if (!l || typeof l !== 'object') continue;
      const msg = String(l.message ?? '').trim();
      if (!msg) continue;
      out.push({
        line_num: n++,
        file: String(l.file || ''),
        name: l.name == null ? null : stripNewlines(l.name),
        message: msg.replace(/\r?\n/g, '\\n').trim(),
        trans_name: null,
        trans_message: null,
        is_translated: false,
        _n: 1
      });
    }
    return out;
  },

  toPluginLine(l) {
    return {
      line_num: l.line_num,
      file: l.file,
      name: l.name,
      message: l.message,
      trans_name: l.trans_name,
      trans_message: l.trans_message,
      is_translated: !!l.is_translated
    };
  },

  _fail(meta, e) {
    console.error(`[plugin:${meta?.id || '?'}]`, e);
    App.flash(`Plugin "${meta?.name || '?'}" error: ${e?.message || e}`);
  }
};

const Html = {
  containerRoot(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const rootFile = doc.querySelector('rootfile');
    if (!rootFile) throw new Error('EPUB tidak valid.');
    return decodeURIComponent(rootFile.getAttribute('full-path'));
  },
  opfManifest(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const manifest = {};
    const items = Array.from(doc.querySelectorAll('manifest > item'));
    items.forEach(it => {
      manifest[it.getAttribute('id')] = decodeURIComponent(it.getAttribute('href'));
    });
    const spine = Array.from(doc.querySelectorAll('spine > itemref')).map(it => it.getAttribute('idref'));
    let coverId = doc.querySelector('metadata > meta[name="cover"]')?.getAttribute('content') || null;
    if (!coverId) {
      const coverItem = items.find(it => (it.getAttribute('properties') || '').split(/\s+/).includes('cover-image'));
      if (coverItem) coverId = coverItem.getAttribute('id');
    }
    const coverHref = coverId && manifest[coverId] ? manifest[coverId] : null;
    return { manifest, spine, coverHref };
  },
  extractContent(html, isXhtml, tags, baseDir) {
    const doc = new DOMParser().parseFromString(html, isXhtml ? 'application/xhtml+xml' : 'text/html');
    const texts = [];
    const images = [];
    let nodes;
    try { nodes = doc.querySelectorAll(`${tags}, img, image`); }
    catch { nodes = doc.querySelectorAll(tags); }
    nodes.forEach(el => {
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'img' || tag === 'image') {
        const src = el.getAttribute('src') || el.getAttribute('xlink:href') || el.getAttribute('href');
        const zipPath = resolveZipPath(baseDir, src);
        if (zipPath) images.push({ afterIndex: texts.length - 1, zipPath });
      } else {
        const txt = el.textContent.replace(/\r?\n/g, ' ').trim();
        if (txt) texts.push(txt);
      }
    });
    return { texts, images };
  },
  rewriteTags(html, isXhtml, tags, replacements) {
    const doc = new DOMParser().parseFromString(html, isXhtml ? 'application/xhtml+xml' : 'text/html');
    let idx = 0;
    doc.querySelectorAll(tags).forEach(el => {
      if (el.textContent.replace(/\r?\n/g, ' ').trim() === '') return;
      const r = replacements[idx++];
      if (r != null) el.textContent = r;
    });
    return new XMLSerializer().serializeToString(doc);
  }
};

const IMG_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp'
};

const EpubImages = {
  zipCache: null,
  zipLoading: null,
  urlCache: new Map(),
  async getZip(epubId) {
    if (this.zipCache && this.zipCache.epubId === epubId) return this.zipCache.zip;
    if (this.zipLoading && this.zipLoading.epubId === epubId) return this.zipLoading.promise;
    if (!jsZipReady()) return null;
    const promise = (async () => {
      const buffer = await Storage.loadEpubBuffer(epubId);
      const zip = new JSZip();
      await zip.loadAsync(buffer);
      return zip;
    })();
    this.zipLoading = { epubId, promise };
    try {
      const zip = await promise;
      this.zipCache = { epubId, zip };
      return zip;
    } finally {
      if (this.zipLoading && this.zipLoading.epubId === epubId) this.zipLoading = null;
    }
  },
  preload(epubId) {
    if (!epubId) return;
    this.getZip(epubId).then(zip => {
      if (!zip) return;
      const paths = [...new Set((State.images || []).map(im => im.zipPath).filter(Boolean))];
      for (const zipPath of paths) this.getUrl(epubId, zipPath);
    }).catch(() => {});
  },
  peekUrl(epubId, zipPath) {
    if (!epubId || !zipPath) return undefined;
    const key = `${epubId}|${zipPath}`;
    return this.urlCache.has(key) ? this.urlCache.get(key) : undefined;
  },
  async getUrl(epubId, zipPath) {
    if (!epubId || !zipPath) return null;
    const key = `${epubId}|${zipPath}`;
    if (this.urlCache.has(key)) return this.urlCache.get(key);
    try {
      const zip = await this.getZip(epubId);
      const entry = zip?.file(zipPath);
      if (!entry) { this.urlCache.set(key, null); return null; }
      const ext = zipPath.split('.').pop().toLowerCase();
      const bytes = await entry.async('uint8array');
      const blob = new Blob([bytes], { type: IMG_MIME[ext] || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      this.urlCache.set(key, url);
      return url;
    } catch { this.urlCache.set(key, null); return null; }
  },
  clear() {
    for (const url of this.urlCache.values()) { if (url) URL.revokeObjectURL(url); }
    this.urlCache.clear();
    this.zipCache = null;
    this.zipLoading = null;
  }
};

function parseJsonArray(arr, file, start) {
  if (!Array.isArray(arr)) throw new Error(`File ${file} bukan array JSON.`);
  const out = [];
  let n = start;
  for (const e of arr) {
    if (!e || typeof e !== 'object' || !Object.hasOwn(e, 'message')) continue;
    out.push({
      line_num: n++,
      file,
      name: stripNewlines(e.name),
      message: String(e.message || '').replace(/\r?\n/g, '\\n').trim(),
      trans_name: null,
      trans_message: null,
      is_translated: false
    });
  }
  return out;
}

async function parseFilesList(files, existing, start, onProgress, label = 'file') {
  existing = new Set(existing || []);
  const imported = [];
  const skipped = [];
  let cur = start;
  const sorted = files.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i];
    const bn = baseName(f.name);
    if (existing.has(bn)) { skipped.push(bn); continue; }
    const arr = JSON.parse(decodeBuffer(f.buffer));
    const parsed = parseJsonArray(arr, bn, cur);
    if (parsed.length) { existing.add(bn); imported.push(...parsed); cur += parsed.length; }
    onProgress(`${i + 1} / ${sorted.length} ${label}`, ((i + 1) / sorted.length) * 100);
    if (i % 50 === 0) await yieldToEvent();
  }
  return { imported, skipped, nextStart: cur, existing: Array.from(existing) };
}

async function parseZipJson(buffer, existing, start, onProgress) {
  if (!jsZipReady()) throw new Error('JSZip tidak tersedia.');
  const zip = new JSZip();
  await zip.loadAsync(buffer);
  const files = [];
  for (const name of Object.keys(zip.files).filter(n => n.endsWith('.json'))) {
    files.push({ name, buffer: await zip.file(name).async('uint8array') });
  }
  return parseFilesList(files, existing, start, onProgress);
}

async function parseEpub(buffer, tags, existing, start, epubId, onProgress) {
  if (!jsZipReady()) throw new Error('JSZip tidak tersedia.');
  existing = new Set(existing || []);
  await Storage.saveEpub(epubId, buffer);
  const zip = new JSZip();
  await zip.loadAsync(buffer);
  const containerXml = await zip.file('META-INF/container.xml').async('text');
  const opfPath = Html.containerRoot(containerXml);
  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/')) + '/' : '';
  const opfXml = await zip.file(opfPath).async('text');
  const { manifest, spine, coverHref } = Html.opfManifest(opfXml);
  const htmls = spine.map(idref => manifest[idref] ? opfDir + manifest[idref] : null).filter(Boolean);

  const imported = [];
  const skipped = [];
  const images = [];
  if (coverHref) {
    const coverPath = resolveZipPath(opfDir, coverHref);
    if (coverPath && zip.file(coverPath)) {
      images.push({ zipPath: coverPath, file: null, isCover: true, insertAfter: null });
    }
  }
  let cur = start;
  for (let i = 0; i < htmls.length; i++) {
    const path = htmls[i];
    if (existing.has(path)) { skipped.push(path); continue; }
    const entry = zip.file(path);
    if (!entry) continue;
    const html = await entry.async('text');
    const chapterDir = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) + '/' : '';
    const { texts, images: chImages } = Html.extractContent(html, path.endsWith('.xhtml'), tags, chapterDir);
    const startNum = cur;
    for (const txt of texts) {
      imported.push({
        line_num: cur++,
        file: path,
        name: null,
        message: txt,
        trans_name: null,
        trans_message: null,
        is_translated: false
      });
    }
    for (const img of chImages) {
      images.push({
        zipPath: img.zipPath,
        file: path,
        isCover: false,
        insertAfter: img.afterIndex >= 0 ? (startNum + img.afterIndex) : null
      });
    }
    if (texts.length || chImages.length) existing.add(path);
    onProgress(`${i + 1} / ${htmls.length} file`, ((i + 1) / htmls.length) * 100);
    if (i % 20 === 0) await yieldToEvent();
  }
  return { imported, skipped, nextStart: cur, existing: Array.from(existing), images };
}

async function buildExportJson(lines, projectName, onProgress) {
  if (!jsZipReady()) throw new Error('JSZip tidak tersedia.');
  const grouped = new Map();
  for (const l of lines) {
    let arr = grouped.get(l.file);
    if (!arr) { arr = []; grouped.set(l.file, arr); }
    arr.push(l);
  }
  const entries = Array.from(grouped.entries());
  const results = new Array(entries.length);
  for (let i = 0; i < entries.length; i++) {
    const [file, fileLines] = entries[i];
    const out = new Array(fileLines.length);
    for (let j = 0; j < fileLines.length; j++) {
      const l = fileLines[j];
      const isT = !!l.is_translated;
      const obj = {};
      const n = isT ? (l.trans_name || l.name) : l.name;
      const msg = isT ? l.trans_message : l.message;
      if (n != null) obj.name = n.replace(/\\n/g, '\n');
      obj.message = msg != null ? msg.replace(/\\n/g, '\n') : '';
      out[j] = obj;
    }
    results[i] = {
      name: `${file.replace(/\.(xhtml|html|json)$/g, '')}.json`,
      content: JSON.stringify(out, null, 2)
    };
    onProgress(`${i + 1} / ${entries.length} file`, ((i + 1) / entries.length) * 100);
    if (i % 50 === 0) await yieldToEvent();
  }
  if (results.length > 1) {
    onProgress('Mengompres ZIP...', 100);
    const zip = new JSZip();
    for (const r of results) zip.file(r.name, r.content);
    const blob = await zip.generateAsync({
      type: 'blob', mimeType: 'application/octet-stream',
      compression: 'DEFLATE', compressionOptions: { level: 9 }
    });
    return { blob, name: `${sanitizeName(projectName)}_export.zip`, multiple: true };
  }
  const r = results[0];
  const blob = new Blob([r.content], { type: 'application/json' });
  return { blob, name: r.name, multiple: false };
}

async function buildExportEpub(epubId, lines, tags, projectName, onProgress) {
  if (!jsZipReady()) throw new Error('JSZip tidak tersedia.');
  let buffer = epubId ? await Storage.loadEpubBuffer(epubId) : null;
  if (!buffer) throw new Error('EPUB tidak ditemukan.');
  const zip = new JSZip();
  await zip.loadAsync(buffer);
  const byFile = {};
  for (const l of lines) (byFile[l.file] ||= []).push(l);
  const paths = Object.keys(byFile);
  for (let pi = 0; pi < paths.length; pi++) {
    const path = paths[pi];
    const entry = zip.file(path);
    if (!entry) continue;
    const html = await entry.async('text');
    const xmlMatch = html.match(/^<\?xml.*?\?>/i);
    const replacements = byFile[path].map(l => (l.is_translated && l.trans_message) ? l.trans_message : null);
    let out = Html.rewriteTags(html, path.endsWith('.xhtml'), tags, replacements);
    if (xmlMatch && !out.startsWith('<?xml')) out = xmlMatch[0] + '\n' + out;
    zip.file(path, out);
    onProgress(`${pi + 1} / ${paths.length} file`, ((pi + 1) / paths.length) * 100);
    if (pi % 20 === 0) await yieldToEvent();
  }
  if (zip.file('mimetype')) {
    zip.file('mimetype', await zip.file('mimetype').async('text'), { compression: 'STORE' });
  }
  onProgress('Mengompres EPUB...', 100);
  const blob = await zip.generateAsync({
    type: 'blob', mimeType: 'application/epub+zip',
    compression: 'DEFLATE', compressionOptions: { level: 9 }
  });
  return { blob, name: `${sanitizeName(projectName)}_tl.epub` };
}

function buildProjectZipInner(zip, data) {
  const meta = { ...data };
  delete meta.lines;
  delete meta.proofreadScope;
  delete meta.proofreadRegex;
  delete meta.proofreadCaseSensitive;
  delete meta.proofreadExactMatch;
  delete meta.proofreadTranslatedOnly;
  zip.file('metadata.json', JSON.stringify(meta));

  const fileLines = new Map();
  for (const l of (data.lines || [])) {
    let arr = fileLines.get(l.file);
    if (!arr) { arr = []; fileLines.set(l.file, arr); }
    arr.push(l);
  }
  const origParts = [];
  const transParts = [];
  const namesParts = [];
  for (const file of (data.imported_files || [])) {
    origParts.push(`<filename>${file}</filename>\n`);
    transParts.push(`<filename>${file}</filename>\n`);
    namesParts.push(`<filename>${file}</filename>\n`);
    const fl = fileLines.get(file) || [];
    for (const l of fl) {
      origParts.push(l.message || '', '\n');
      transParts.push(l.trans_message || '', '\n');
      const hasName = (l.name || '') || (l.trans_name || '');
      if (hasName) namesParts.push(`<original>${l.name || ''}</original><translate>${l.trans_name || ''}</translate>\n`);
      else namesParts.push('\n');
    }
  }
  zip.file('original.txt', origParts.join(''));
  zip.file('translate.txt', transParts.join(''));
  zip.file('name.txt', namesParts.join(''));
}

async function compressZip(zip, mimeType, level = 9) {
  return await zip.generateAsync({
    type: 'blob', mimeType,
    compression: 'DEFLATE', compressionOptions: { level }
  });
}

async function buildBackup(id, name, onProgress) {
  if (!jsZipReady()) throw new Error('JSZip tidak tersedia.');
  const data = await Storage.load(id);
  let epubBuffer = null;
  if (data.projectType === 'epub' && data.epubSourceId) {
    try { epubBuffer = await Storage.loadEpubBuffer(data.epubSourceId); } catch {}
  }
  const zip = new JSZip();
  buildProjectZipInner(zip, data);
  if (epubBuffer) zip.file(data.epubSourceId, epubBuffer);
  onProgress('Mengompres backup...', 90);
  const blob = await compressZip(zip, 'application/octet-stream');
  return { blob, name: `${sanitizeName(name)}_backup.cstl` };
}

async function backupAll(onProgress) {
  if (!jsZipReady()) throw new Error('JSZip tidak tersedia.');
  const items = await Storage.list();
  if (!items.length) throw new Error('Belum ada Project untuk di-backup.');
  const total = items.length;
  const outer = new JSZip();
  const used = new Set();
  onProgress(`0 / ${total} project`, 0);
  for (let i = 0; i < total; i++) {
    onProgress(`Memproses ${i + 1} / ${total} project`, (i / total) * 95);
    const data = await Storage.load(items[i].id);
    const zip = new JSZip();
    buildProjectZipInner(zip, data);
    if (data.projectType === 'epub' && data.epubSourceId) {
      try { zip.file(data.epubSourceId, await Storage.loadEpubBuffer(data.epubSourceId)); } catch {}
    }
    const blob = await compressZip(zip, '', 9);
    const base = sanitizeName(data.projectName);
    let name = base, k = 2;
    while (used.has(name)) name = `${base}_${k++}`;
    used.add(name);
    outer.file(`${name}_backup.cstl`, blob);
    onProgress(`${i + 1} / ${total} project selesai`, ((i + 1) / total) * 95);
    await yieldToEvent();
  }
  onProgress('Mengompres arsip utama...', 98);
  const blob = await compressZip(outer, 'application/octet-stream');
  return { blob, name: `ProjectBackupAll_${new Date().toISOString().slice(0, 10)}.cstl` };
}

async function restoreOne(zip, fallbackName, onProgress) {
  const metaFile = zip.file('metadata.json');
  const origFile = zip.file('original.txt');
  const transFile = zip.file('translate.txt');
  const nameFile = zip.file('name.txt');
  if (!metaFile || !origFile || !transFile || !nameFile) throw new Error('Format arsip tidak valid.');

  const meta = JSON.parse(await metaFile.async('text'));
  const orig = (await origFile.async('text')).split(/\r?\n/);
  const trans = (await transFile.async('text')).split(/\r?\n/);
  const names = (await nameFile.async('text')).split(/\r?\n/);
  if (orig.length && orig[orig.length - 1] === '') orig.pop();
  if (trans.length && trans[trans.length - 1] === '') trans.pop();
  if (names.length && names[names.length - 1] === '') names.pop();
  if (orig.length !== trans.length || orig.length !== names.length) throw new Error('Baris tidak sinkron.');

  const total = orig.length;
  const lines = new Array(total);
  let file = 'unknown', n = 1;
  for (let i = 0; i < total; i++) {
    const o = orig[i];
    const m = o.match(/^<filename>(.*?)<\/filename>$/);
    if (m) {
      if (trans[i] !== o || names[i] !== o) throw new Error('Header file tidak sinkron.');
      file = m[1];
      lines[i] = null;
    } else {
      let on = null, tn = null;
      const nl = names[i].trim();
      if (nl) {
        const om = nl.match(/<original>(.*?)<\/original>/);
        const tm = nl.match(/<translate>(.*?)<\/translate>/);
        on = om ? om[1] : null;
        tn = tm ? tm[1] : null;
      }
      lines[i] = normalizeLine({
        line_num: n++, file,
        name: on, message: o,
        trans_name: tn,
        trans_message: trans[i] || null,
        is_translated: !!trans[i]?.trim()
      });
    }
    if (onProgress && (i % 5000 === 0)) { onProgress(i, total); await yieldToEvent(); }
  }
  const finalLines = lines.filter(x => x !== null);

  const name = meta.projectName || fallbackName;
  if (meta.projectType === 'epub' && meta.epubSourceId) {
    const entry = zip.file(meta.epubSourceId);
    if (entry) {
      const newId = 'epub_' + Date.now() + '.epub';
      await Storage.saveEpub(newId, await entry.async('arraybuffer'));
      meta.epubSourceId = newId;
    }
  }

  const id = makeProjId();
  await Storage.saveProject(id, {
    version: VERSION,
    projectName: name,
    projectType: meta.projectType || 'uninitialized',
    pluginId: meta.pluginId || null,
    pluginName: meta.pluginName || PluginRuntime.getMeta(meta.pluginId)?.name || null,
    pluginData: (meta.pluginData && typeof meta.pluginData === 'object') ? meta.pluginData : null,
    epubTags: meta.epubTags || 'p',
    epubSourceId: meta.epubSourceId || null,
    imported_files: meta.imported_files || [],
    lines: finalLines,
    prompt_header: meta.prompt_header || DEFAULT_PROMPT,
    ignoreNameTranslation: meta.ignoreNameTranslation ?? false,
    promptEnabled: meta.promptEnabled ?? true,
    ringkasanEnabled: meta.ringkasanEnabled ?? false,
    ringkasanPrompt: meta.ringkasanPrompt || DEFAULT_RINGKASAN_PROMPT,
    ringkasan: meta.ringkasan || '',
    vndbEnabled: meta.vndbEnabled ?? false,
    vndbId: meta.vndbId || '',
    vndbGlossary: meta.vndbGlossary || [],
    customEnabled: meta.customEnabled ?? false,
    customRaw: meta.customRaw || '',
    jumpToContext: meta.jumpToContext ?? false,
    hideTools: meta.hideTools ?? false,
    incrementEnabled: meta.incrementEnabled ?? false,
    incrementStep: meta.incrementStep || 100,
    bookmarks: Array.isArray(meta.bookmarks) ? meta.bookmarks.filter(n => Number.isInteger(n) && n > 0) : [],
    images: Array.isArray(meta.images) ? meta.images : []
  });
  return name;
}

async function parseRestore(buffer, fallbackName, onProgress) {
  if (!jsZipReady()) throw new Error('JSZip tidak tersedia.');
  const zip = new JSZip();
  await zip.loadAsync(buffer);

  if (zip.file('metadata.json')) {
    onProgress('Membaca baris...', 0);
    const name = await restoreOne(zip, fallbackName, (done, total) => {
      onProgress(`${done} / ${total} baris`, total ? (done / total) * 100 : 0);
    });
    onProgress('Menyimpan project...', 100);
    return { single: true, name };
  }

  const entries = Object.values(zip.files).filter(f => !f.dir && f.name.toLowerCase().endsWith('.cstl'));
  if (!entries.length) throw new Error('Format arsip tidak valid.');

  const totalEntries = entries.length;
  let ok = 0, fail = 0;
  for (let i = 0; i < totalEntries; i++) {
    const entry = entries[i];
    try {
      const inner = new JSZip();
      await inner.loadAsync(await entry.async('blob'));
      await restoreOne(inner, entry.name.replace(/\.cstl$/i, ''));
      ok++;
    } catch {
      fail++;
    }
    onProgress(`${i + 1} / ${totalEntries} project`, ((i + 1) / totalEntries) * 100);
    await yieldToEvent();
  }
  return { single: false, ok, fail };
}

function buildRe(query, regex, exact, caseSensitive) {
  if (!query) return null;
  try {
    let p = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (exact) p = `(?<![\\p{L}\\p{N}_])${p}(?![\\p{L}\\p{N}_])`;
    return new RegExp(p, caseSensitive ? 'gu' : 'giu');
  } catch { return null; }
}

function proofreadSearch(lines, query, regex, exact, caseSensitive, scope, translatedOnly) {
  const re = buildRe(query, regex, exact, caseSensitive);
  const matches = [];
  for (const l of lines) {
    if (translatedOnly && !l.is_translated) continue;
    const on = l.name || '';
    const tn = l.is_translated ? (l.trans_name || '').trim() || l.name : null;
    const msg = translatedOnly ? l.trans_message : l.message;
    const name = translatedOnly ? tn : on;
    if (query && re) {
      let found = false;
      re.lastIndex = 0;
      if ((scope === 'all' || scope === 'message') && msg && re.test(msg)) found = true;
      re.lastIndex = 0;
      if (!found && (scope === 'all' || scope === 'name') && name && re.test(name)) found = true;
      if (!found) continue;
    }
    matches.push({
      num: l.line_num,
      file: l.file,
      origName: l.name || '',
      origMsg: l.message,
      transName: l.is_translated ? (l.trans_name || '').trim() || l.name : null,
      transMsg: l.trans_message,
      isTrans: !!l.is_translated
    });
  }
  return matches;
}

function replaceAll(lines, query, replace, regex, exact, caseSensitive, scope, translatedOnly) {
  const re = buildRe(query, regex, exact, caseSensitive);
  if (!re) return { modified: [], count: 0 };
  const modified = [];
  let count = 0;
  for (const l of lines) {
    if (translatedOnly && !l.is_translated) continue;
    let replaced = false;
    const m = { line_num: l.line_num, message: l.message, trans_message: l.trans_message, name: l.name, trans_name: l.trans_name };
    const msgProp = translatedOnly ? 'trans_message' : 'message';
    const nameProp = translatedOnly ? 'trans_name' : 'name';
    if ((scope === 'all' || scope === 'message') && l[msgProp]) {
      const v = l[msgProp].replace(re, replace);
      if (v !== l[msgProp]) { m[msgProp] = v; replaced = true; }
    }
    if ((scope === 'all' || scope === 'name') && l[nameProp]) {
      const v = l[nameProp].replace(re, replace);
      if (v !== l[nameProp]) { m[nameProp] = v; replaced = true; }
    }
    if (replaced) { modified.push(m); count++; }
  }
  return { modified, count };
}

const Vndb = {
  async fetchCharacters(id) {
    const all = [];
    let page = 1, more = true;
    while (more) {
      const res = await fetch('https://api.vndb.org/kana/character', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: ['vn', '=', ['id', '=', id]],
          fields: 'name, original, aliases',
          results: 100,
          page
        })
      });
      if (!res.ok) throw new Error(`Status: ${res.status}`);
      const data = await res.json();
      if (data.results) all.push(...data.results);
      more = data.more || false;
      page++;
    }
    return all;
  },
  buildGlossary(chars) {
    const map = new Map();
    const add = (jp, en) => {
      jp = (jp || '').trim();
      en = (en || '').trim();
      if (jp && en && isJapanese(jp) && !map.has(jp)) map.set(jp, en);
    };
    for (const c of chars) {
      if (!c.name || !c.original) continue;
      add(c.original, c.name);
      if (c.original.includes(' ') && c.name.includes(' ')) {
        const kana = c.original.split(' '), en = c.name.split(' ');
        if (kana.length === en.length) kana.forEach((k, i) => add(k, en[i]));
      }
      const ja = (c.aliases || []).filter(isJapanese);
      const en = (c.aliases || []).filter(a => !isJapanese(a));
      const fallback = c.name.split(' ').pop() || c.name;
      ja.forEach((j, i) => add(j, en[i] || fallback));
    }
    return Array.from(map.entries()).sort((a, b) => b[0].length - a[0].length);
  }
};

const SHORTCUT_ACTIONS = [
  { id: 'dash.new', label: 'Buat Project Baru', scope: 'dashboard', def: '', run: () => els.btnNewProject.click() },
  { id: 'dash.restore', label: 'Pulihkan Project', scope: 'dashboard', def: '', run: () => els.btnRestoreProject.click() },
  { id: 'dash.settings', label: 'Buka Pengaturan Utama', scope: 'dashboard', def: '', run: () => els.btnDashboardSettings.click() },
  { id: 'dash.search', label: 'Fokus Cari Project', scope: 'dashboard', def: '/', run: () => els.projectSearch?.focus() },
  { id: 'work.importFile', label: 'Import File', scope: 'workspace', def: '', run: () => { closeDropdowns(); els.importFileInput.click(); } },
  { id: 'work.importFolder', label: 'Import Folder', scope: 'workspace', def: '', run: () => { closeDropdowns(); els.importFolderInput.click(); } },
  { id: 'work.importZip', label: 'Import ZIP', scope: 'workspace', def: '', run: () => { closeDropdowns(); els.importZipInput.click(); } },
  { id: 'work.export', label: 'Export Project', scope: 'workspace', def: 'Alt+E', run: () => Exporter.run() },
  { id: 'work.proofread', label: 'Buka Cari & Replace', scope: 'workspace', def: 'Alt+R', run: () => els.btnProofread.click() },
  { id: 'work.glossary', label: 'Buka Glossary', scope: 'workspace', def: 'Alt+G', run: () => els.btnGlossary.click() },
  { id: 'work.context', label: 'Buka Context', scope: 'workspace', def: 'Alt+X', run: () => els.btnContext.click() },
  { id: 'work.plugins', label: 'Buka Menu Plugin Project', scope: 'workspace', def: 'Alt+P', run: () => els.btnOpenPlugins.click() },
  { id: 'work.settings', label: 'Buka Pengaturan Project', scope: 'workspace', def: 'Alt+S', run: () => els.btnSettings.click() },
  { id: 'work.toggleToolbar', label: 'Tampil/Sembunyikan Toolbar', scope: 'workspace', def: 'Alt+T', run: () => els.btnToggleHeader.click() },
  { id: 'work.back', label: 'Kembali ke Dashboard', scope: 'workspace', def: 'Alt+B', run: () => App.closeProject() },
  { id: 'work.selectAll', label: 'Pilih Semua Baris', scope: 'workspace', def: 'Alt+A', run: () => els.btnSelectAll.click() },
  { id: 'work.clearSelection', label: 'Hapus Pilihan', scope: 'workspace', def: 'Alt+Q', run: () => els.btnClearSelection.click() },
  { id: 'work.selectRange', label: 'Pilih Rentang Baris', scope: 'workspace', def: 'Alt+L', run: () => App.selectRange() },
  { id: 'work.copy', label: 'Copy untuk AI', scope: 'workspace', def: 'Alt+C', run: () => App.copyForAi() },
  { id: 'work.paste', label: 'Fokus Kolom Hasil AI', scope: 'workspace', def: 'Alt+V', inInputs: true, run: () => els.pasteArea.focus() },
  { id: 'work.apply', label: 'Terapkan Terjemahan', scope: 'workspace', def: 'Ctrl+Enter', inInputs: true, run: () => App.applyTranslation() },
  { id: 'work.undo', label: 'Undo', scope: 'workspace', def: 'Alt+Z', run: () => App.undo() },
  { id: 'work.redo', label: 'Redo', scope: 'workspace', def: 'Alt+Y', run: () => App.redo() },
  { id: 'work.bookmarks', label: 'Buka Panel Bookmark', scope: 'workspace', def: 'Alt+M', run: () => App.toggleBookmarkPanel(!els.bookmarkPanel.classList.contains('show')) }
];

const IGNORED_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead', 'Unidentified', 'ContextMenu', 'Fn', 'FnLock', 'NumLock', 'ScrollLock', 'Hyper', 'Super', 'Compose', 'Process']);

const CODE_MAP = {
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Escape: 'Escape', Backspace: 'Backspace',
  Delete: 'Delete', Tab: 'Tab', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert',
  Slash: '/', Period: '.', Comma: ',', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`',
  NumpadDivide: '/', NumpadMultiply: '*', NumpadSubtract: '-', NumpadAdd: '+', NumpadDecimal: '.'
};

function normalizeKey(e) {
  if (IGNORED_KEYS.has(e.key)) return null;
  const code = e.code || '';
  const m = code.match(/^(?:Key([A-Z])|Digit(\d))$/);
  if (m) return m[1] || m[2];
  if (CODE_MAP[code]) return CODE_MAP[code];
  if (/^F\d{1,2}$/.test(code)) return code;
  const k = e.key || '';
  if (k.length === 1) return k.toUpperCase();
  return null;
}

function comboFromEvent(e) {
  const key = normalizeKey(e);
  if (!key) return null;
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

function comboHtml(combo) {
  return combo.split('+').map(p => `<kbd>${escapeHtml(p)}</kbd>`).join('<span class="kbd-plus">+</span>');
}

function isEditableTarget(t) {
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

const Shortcuts = {
  _actions: [],
  _pluginActions: [],
  _map: new Map(),
  _recording: null,

  init() {
    Shortcuts._actions = SHORTCUT_ACTIONS.slice();
    document.addEventListener('keydown', e => Shortcuts._onKey(e));
    Shortcuts.rebuild();
  },

  allActions() { return Shortcuts._actions.concat(Shortcuts._pluginActions); },

  loadBindings() {
    try { return JSON.parse(localStorage.getItem(SHORTCUT_STORAGE_KEY)) || {}; }
    catch { return {}; }
  },

  saveBindings(b) {
    try { localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(b)); } catch {}
  },

  bindingFor(action) {
    const b = Shortcuts.loadBindings();
    return action.id in b ? b[action.id] : (action.def || '');
  },

  rebuild() {
    Shortcuts._map = new Map();
    const b = Shortcuts.loadBindings();
    for (const a of Shortcuts.allActions()) {
      const combo = a.id in b ? b[a.id] : (a.def || '');
      if (combo && !Shortcuts._map.has(combo)) Shortcuts._map.set(combo, a.id);
    }
  },

  refreshPluginActions() {
    Shortcuts._pluginActions = PluginRuntime.commands().map(c => ({
      id: c.id,
      label: `${c.pluginName}: ${c.label}`,
      scope: 'always',
      def: '',
      run: () => PluginRuntime.runCommand(c.id)
    }));
    Shortcuts.rebuild();
    if (els?.shortcutModal?.classList.contains('open')) App.renderShortcutList();
  },

  _onKey(e) {
    if (e.isComposing || e.keyCode === 229) return;
    if (Shortcuts._recording) return;
    if (anyModalOpen()) return;
    if (els.busyOverlay?.classList.contains('open')) return;
    const combo = comboFromEvent(e);
    if (!combo) return;
    const actionId = Shortcuts._map.get(combo);
    if (!actionId) return;
    const action = Shortcuts.allActions().find(a => a.id === actionId);
    if (!action) return;
    if (isEditableTarget(e.target) && !action.inInputs) return;
    const dashOpen = els.dashboardView.classList.contains('open');
    if (action.scope === 'dashboard' && !dashOpen) return;
    if (action.scope === 'workspace' && dashOpen) return;
    e.preventDefault();
    try { action.run(); } catch (err) { console.error('[shortcut]', actionId, err); }
  },

  startRecording(action, btn) {
    if (Shortcuts._recording) Shortcuts.stopRecording();
    Shortcuts._recording = { action, btn };
    btn.classList.add('recording');
    btn.textContent = 'Tekan tombol…';
    document.addEventListener('keydown', Shortcuts._handleRecordKey, true);
  },

  stopRecording() {
    if (!Shortcuts._recording) return;
    document.removeEventListener('keydown', Shortcuts._handleRecordKey, true);
    Shortcuts._recording = null;
    App.renderShortcutList();
  },

  _handleRecordKey(e) {
    e.preventDefault();
    e.stopPropagation();
    const rec = Shortcuts._recording;
    if (!rec) return;
    if (e.key === 'Escape') { Shortcuts.stopRecording(); return; }
    if (e.key === 'Backspace') { Shortcuts.applyBinding(rec.action, ''); return; }
    const combo = comboFromEvent(e);
    if (!combo) return;
    Shortcuts.applyBinding(rec.action, combo);
  },

  applyBinding(action, combo) {
    Shortcuts.stopRecording();
    if (combo) {
      const owner = Shortcuts.allActions().find(a => a.id !== action.id && Shortcuts.bindingFor(a) === combo);
      if (owner) {
        Shortcuts.showStatus(`"${combo.replace(/\+/g, ' + ')}" sudah dipakai: ${owner.label}`, true);
        return;
      }
    }
    const b = Shortcuts.loadBindings();
    if (combo) b[action.id] = combo; else delete b[action.id];
    Shortcuts.saveBindings(b);
    Shortcuts.rebuild();
    App.renderShortcutList();
    Shortcuts.showStatus(combo ? `Pengikatan disimpan: ${combo.replace(/\+/g, ' + ')}.` : 'Pengikatan dihapus.');
  },

  showStatus(msg, isError = false) {
    const el = els.shortcutStatus;
    if (!el) return;
    clearTimeout(Shortcuts._statusTimer);
    el.textContent = msg;
    el.hidden = false;
    el.classList.toggle('error', isError);
    Shortcuts._statusTimer = setTimeout(() => {
      el.hidden = true;
      el.classList.remove('error');
    }, 3000);
  }
};

const els = {};

function cacheEls() {
  const ids = [
    'dashboardView', 'workspaceView', 'projectList',
    'projectCount', 'projectSearch', 'projectSearchClear', 'projectSort',
    'btnNewProject', 'btnRestoreProject', 'btnDashboardSettings', 'btnDashboardSettingsClose',
    'btnBackupAll', 'btnWipeAllData',
    'btnBackToDashboard', 'projectNameDisplay', 'dynamicToolbarWrap',
    'workspaceToolbar', 'btnToggleHeader', 'btnShowHeader',
    'btnImportMain', 'importDropdown', 'importGroup',
    'btnImportFile', 'btnImportFolder', 'btnImportZip',
    'importFileInput', 'importFolderInput', 'importZipInput', 'restoreProjectInput',
    'btnExport', 'btnProofread', 'btnGlossary', 'btnContext', 'btnSettings',
    'previewViewport', 'previewContainer', 'stickyFileBar', 'stickyFileName', 'stickyFileRange', 'stickyFileCheckbox',
    'progressText',
    'rangeFromInput', 'rangeToInput', 'btnSelectRange', 'btnClearSelection', 'btnSelectAll', 'btnCopyForAi',
    'copyStatus', 'pasteArea', 'btnUndo', 'btnApply', 'btnRedo',
    'nameTotalCount', 'nameTableBody',
    'btnCopyAllNames', 'copyNamesDropdown', 'copyNamesGroup',
    'btnCopyNamesPlain', 'btnCopyNamesWithGlossary', 'btnCopyNamesMissingGlossary',
    'settingsModal', 'btnSettingsDasarReset', 'settingsIgnoreNameCheck', 'settingsPromptCheck',
    'settingsJumpToContextCheck', 'settingsHideToolsCheck',
    'btnSettingsIncrementReset', 'settingsIncrementCheck', 'incrementStepWrap', 'settingsIncrementStepInput',
    'btnSettingsPromptReset', 'settingsPromptInput', 'btnSettingsEpubReset', 'settingsEpubTagsInput',
    'btnSettingsCancel', 'btnSettingsSave',
    'glossaryModal', 'btnGlossaryVndbReset', 'glossaryVndbCheck', 'glossaryVndbWrap',
    'glossaryVndbIdInput', 'btnGlossaryVndbFetch', 'glossaryVndbStatus', 'glossaryVndbPreviewArea',
    'btnGlossaryCustomReset', 'glossaryCustomCheck', 'glossaryCustomWrap', 'glossaryCustomInput',
    'btnGlossaryCancel', 'btnGlossarySave',
    'contextModal', 'btnRingkasanReset', 'ringkasanEnabledCheck', 'ringkasanWrap',
    'ringkasanPromptInput', 'ringkasanStoredInput', 'btnRingkasanPromptReset', 'btnRingkasanStoredReset', 'btnContextCancel', 'btnContextSave',
    'lineEditorModal', 'lineEditorTitle', 'lineOriginalView', 'lineNameWrap',
    'lineNameInput', 'lineMessageInput', 'lineTranslatedCheck', 'btnLineCancel', 'btnLineSave',
    'proofreadModal', 'proofreadSearchInput', 'proofreadScope', 'proofreadRegexCheck',
    'proofreadCaseCheck', 'proofreadExactCheck', 'proofreadTranslatedOnlyCheck',
    'btnProofreadReset', 'proofreadReplaceInput', 'btnProofreadReplaceAll',
    'proofreadStatus', 'proofreadContainer', 'btnProofreadClose',
    'dashboardSettingsModal', 'shortcutModal', 'shortcutStatus', 'shortcutList', 'btnShortcutsOpen', 'btnShortcutsClose', 'btnShortcutsResetAll',
    'btnPluginManagerOpen',
    'pluginManagerModal', 'btnPluginManagerClose', 'btnPluginRefresh',
    'pluginList', 'btnInstallPlugin', 'pluginFileInput', 'btnOpenPlugins', 'pluginMenu',
    'opfsExplorerModal', 'btnOpfsExplorerOpen', 'btnOpfsExplorerClose',
    'opfsExplorer', 'opfsList', 'opfsEmpty', 'opfsEmptyText', 'opfsCrumbs', 'opfsLoading', 'btnOpfsRefresh',
    'busyOverlay', 'busyTitle', 'busyMsg', 'busyBarFill',
    'bookmarkDock', 'btnBookmarks', 'bookmarkPanel',
    'bookmarkPanelCount', 'bookmarkList', 'btnBookmarkClear'
  ];
  for (const id of ids) els[id] = $(id);
}

const Progress = {
  show(title, msg = '') {
    els.busyTitle.textContent = title;
    els.busyMsg.textContent = msg;
    els.busyBarFill.classList.remove('determinate');
    els.busyBarFill.style.width = '';
    els.busyOverlay.classList.add('open');
  },
  determinate(title, msg = '') {
    els.busyTitle.textContent = title;
    els.busyMsg.textContent = msg;
    els.busyBarFill.classList.add('determinate');
    els.busyBarFill.style.width = '0%';
    els.busyOverlay.classList.add('open');
  },
  update(msg, pct) {
    if (msg !== undefined && typeof msg === 'string') els.busyMsg.textContent = msg;
    if (pct !== undefined && els.busyBarFill.classList.contains('determinate')) {
      els.busyBarFill.style.width = Math.min(100, Math.max(0, pct)) + '%';
    }
  },
  hide() { els.busyOverlay.classList.remove('open'); }
};

const State = {
  projectId: null,
  files: [],
  lines: [],
  rows: [],
  byNum: new Map(),
  fileLines: new Map(),
  headerIdx: [],
  selected: new Set(),
  undo: null,
  redo: null,
  saveTimer: null,
  translatedCount: 0,
  namesDirty: true
};

for (const f of STATE_SCHEMA) State[f.key] = f.def;

State.toData = () => {
  const data = {
    version: VERSION,
    imported_files: State.files,
    lines: State.lines
  };
  for (const f of STATE_SCHEMA) {
    data[f.store || f.key] = State[f.key];
  }
  return data;
};

State.loadFromData = (data) => {
  State.files = data.imported_files || [];
  State.lines = (data.lines || []).map(normalizeLine);
  for (const f of STATE_SCHEMA) {
    const v = data[f.store || f.key];
    const d = schemaDefault(f);
    State[f.key] = f.coerce ? (v || d) : (v ?? d);
  }
  if (!State.projectName) State.projectName = 'Unknown';
};

State.resetTransient = () => {
  State.projectId = null;
  State.files = [];
  State.lines = [];
  State.rows = [];
  State.headerIdx = [];
  State.byNum.clear();
  State.fileLines.clear();
  State.selected.clear();
  State.undo = State.redo = null;
  State.translatedCount = 0;
  State.namesDirty = true;
  for (const f of STATE_SCHEMA) State[f.key] = schemaDefault(f);
};

State.updateCount = () => {
  State.translatedCount = 0;
  const lines = State.lines;
  for (let i = 0, n = lines.length; i < n; i++) if (lines[i].is_translated) State.translatedCount++;
};

State.rebuild = () => {
  State.byNum.clear();
  State.fileLines.clear();
  State.rows = [];
  State.headerIdx = [];
  const files = State.files;
  const grouped = new Array(files.length);
  const fileIdx = new Map();
  for (let i = 0; i < files.length; i++) {
    fileIdx.set(files[i], i);
    grouped[i] = [];
  }
  const lines = State.lines;
  for (let i = 0, n = lines.length; i < n; i++) {
    const l = lines[i];
    State.byNum.set(l.line_num, l);
    const gi = fileIdx.get(l.file);
    if (gi !== undefined) grouped[gi].push(l);
  }

  const coverImages = [];
  const imagesByFile = new Map();
  for (const im of (State.images || [])) {
    if (im.isCover) { coverImages.push(im); continue; }
    let arr = imagesByFile.get(im.file);
    if (!arr) { arr = []; imagesByFile.set(im.file, arr); }
    arr.push(im);
  }
  for (const arr of imagesByFile.values()) {
    arr.sort((a, b) => (a.insertAfter ?? -1) - (b.insertAfter ?? -1));
  }

  for (const im of coverImages) State.rows.push({ type: 'image', img: im });

  for (let i = 0; i < files.length; i++) {
    const fileLines = grouped[i];
    const fileImages = imagesByFile.get(files[i]) || [];
    if (!fileLines.length && !fileImages.length) continue;
    State.fileLines.set(files[i], fileLines);
    State.headerIdx.push(State.rows.length);
    State.rows.push({ type: 'header', file: files[i] });
    let imgPtr = 0;
    while (imgPtr < fileImages.length && fileImages[imgPtr].insertAfter == null) {
      State.rows.push({ type: 'image', img: fileImages[imgPtr] });
      imgPtr++;
    }
    for (let j = 0, m = fileLines.length; j < m; j++) {
      State.rows.push({ type: 'line', line: fileLines[j] });
      while (imgPtr < fileImages.length && fileImages[imgPtr].insertAfter === fileLines[j].line_num) {
        State.rows.push({ type: 'image', img: fileImages[imgPtr] });
        imgPtr++;
      }
    }
    while (imgPtr < fileImages.length) {
      State.rows.push({ type: 'image', img: fileImages[imgPtr] });
      imgPtr++;
    }
  }
  if (State.bookmarks.length) {
    State.bookmarks = State.bookmarks.filter(n => State.byNum.has(n));
  }
};

State.queueSave = () => {
  if (!State.projectId) return;
  clearTimeout(State.saveTimer);
  State.saveTimer = setTimeout(() => {
    const idle = window.requestIdleCallback || (fn => setTimeout(fn, 0));
    idle(async () => {
      try {
        await Storage.saveProject(State.projectId, State.toData(), {
          fileCount: topFileCount(State.files),
          lineCount: State.lines.length,
          translatedCount: State.translatedCount
        });
        App.flashSaved();
      } catch {}
    });
  }, 500);
};

class Scroller {
  constructor(viewport, container, create, update, keyOf) {
    this.vp = viewport;
    this.container = container;
    this.create = create;
    this.update = update;
    this.keyOf = keyOf || ((item, i) => i);
    this.items = [];
    this.keys = [];
    this.heights = [];
    this.pos = [];
    this.els = [];
    this.indices = [];
    this.heightCache = new Map();
    this.defaultH = 80;
    this.gap = 8;
    this.topPad = 8;
    this.botPad = 12;
    this.overscan = SCROLLER_OVERSCAN;
    this.scrollTop = 0;
    this.totalH = 0;
    this.scheduled = false;

    viewport.addEventListener('scroll', () => {
      this.scrollTop = viewport.scrollTop;
      this.schedule();
    }, { passive: true });

    if (window.ResizeObserver) {
      this.lastVpWidth = viewport.clientWidth;
      new ResizeObserver(() => {
        const w = viewport.clientWidth;
        if (w !== this.lastVpWidth) {
          this.lastVpWidth = w;
          this.invalidate();
        }
        this.schedule();
      }).observe(viewport);
    }
  }

  schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => { this.scheduled = false; this.render(); });
  }

  setItems(items, keep = false) {
    const prevScroll = keep ? this.vp.scrollTop : 0;
    this.items = items;
    this.keys = items.map((it, i) => this.keyOf(it, i));
    this.heights = items.map((it, i) => {
      if (!keep) return it?.type === 'header' ? 32 : this.defaultH;
      const cached = this.heightCache.get(this.keys[i]);
      return cached !== undefined ? cached : (it?.type === 'header' ? 32 : this.defaultH);
    });
    if (!keep) this.heightCache.clear();
    this.pos = new Array(items.length);
    this.updatePos();
    this.vp.scrollTop = keep ? Math.min(prevScroll, Math.max(0, this.totalH - this.vp.clientHeight)) : 0;
    this.scrollTop = this.vp.scrollTop;
    this.invalidate();
    this.render();
  }

  invalidate() { this.indices.fill(-1); }

  updatePos() {
    let cur = this.topPad;
    for (let i = 0; i < this.items.length; i++) {
      this.pos[i] = cur;
      cur += this.heights[i];
    }
    this.totalH = cur + this.botPad;
    this.container.style.height = `${this.totalH}px`;
  }

  findStart(scrollTop) {
    const n = this.items.length;
    if (n === 0) return 0;
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.pos[mid] + this.heights[mid] <= scrollTop) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  findEnd(start, vh) {
    let i = start, acc = 0;
    while (i < this.items.length && acc < vh) { acc += this.heights[i]; i++; }
    return i;
  }

  render() {
    let more = true, passes = 0;
    while (more && passes < 5) {
      more = this._renderPass();
      passes++;
    }
    if (more) this.schedule();
  }

  _renderPass() {
    if (!this.items.length) {
      for (let i = 0; i < this.els.length; i++) {
        this.els[i].style.transform = 'translateY(-9999px)';
        this.indices[i] = -1;
      }
      this.container.style.height = '0px';
      this.totalH = 0;
      return false;
    }

    const vh = this.vp.clientHeight || 800;
    const scrollTop = this.scrollTop;
    const vStart = this.findStart(scrollTop);
    const vEnd = this.findEnd(vStart, vh);
    const rStart = Math.max(0, vStart - this.overscan);
    const rEnd = Math.min(this.items.length, vEnd + this.overscan);
    const need = rEnd - rStart;

    while (this.els.length < need) {
      const el = this.create();
      el.style.transform = 'translateY(-9999px)';
      this.els.push(el);
      this.indices.push(-1);
      this.container.appendChild(el);
    }

    const toMeasure = [];
    for (let i = 0; i < need; i++) {
      const di = rStart + i;
      if (this.indices[i] !== di) {
        this.update(this.els[i], this.items[di], di);
        this.indices[i] = di;
        toMeasure.push(i);
      }
    }

    for (let i = 0; i < need; i++) {
      this.els[i].style.transform = `translateY(${this.pos[rStart + i]}px)`;
    }

    for (let i = need; i < this.els.length; i++) {
      if (this.indices[i] !== -1) {
        this.els[i].style.transform = 'translateY(-9999px)';
        this.indices[i] = -1;
      }
    }

    let heightsChanged = false;
    let adjust = 0;
    for (const i of toMeasure) {
      const di = rStart + i;
      const h = this.els[i].offsetHeight;
      if (h === 0) continue;
      const total = this.items[di]?.type === 'header' ? h : h + this.gap;
      if (Math.abs(total - this.heights[di]) > 1) {
        if (this.pos[di] < scrollTop) adjust += total - this.heights[di];
        this.heights[di] = total;
        this.heightCache.set(this.keys[di], total);
        heightsChanged = true;
      }
    }

    if (heightsChanged) {
      this.updatePos();
      if (adjust) { this.vp.scrollTop += adjust; this.scrollTop = this.vp.scrollTop; }
      for (let i = 0; i < need; i++) {
        this.els[i].style.transform = `translateY(${this.pos[rStart + i]}px)`;
      }
      const vBot = this.scrollTop + vh;
      const lastBot = rEnd < this.items.length
        ? this.pos[rEnd - 1] + this.heights[rEnd - 1]
        : this.totalH;
      if (lastBot < vBot) return true;
    }
    return false;
  }

  scrollToIndex(idx) {
    if (idx < 0 || idx >= this.items.length) return;
    const vh = this.vp.clientHeight || 800;
    const center = (i) => Math.max(0, (this.pos[i] || 0) - (vh / 2) + (this.heights[i] / 2));
    const apply = () => {
      this.vp.scrollTop = center(idx);
      this.scrollTop = this.vp.scrollTop;
      this.render();
    };
    apply();
    requestAnimationFrame(apply);
  }

  forceUpdate() { this.invalidate(); this.render(); }
}

function positionDropdown(panelId) {
  const triggerMap = { importDropdown: 'btnImportMain', copyNamesDropdown: 'btnCopyAllNames', pluginMenu: 'btnOpenPlugins' };
  const trigger = els[triggerMap[panelId]];
  const dropdown = els[panelId];
  if (!trigger || !dropdown) return;
  const r = trigger.getBoundingClientRect();
  if (dropdown.classList.contains('dropdown-right')) {
    dropdown.style.left = '';
    dropdown.style.right = `${Math.round(window.innerWidth - r.right)}px`;
  } else {
    dropdown.style.right = '';
    dropdown.style.left = `${Math.round(r.left)}px`;
  }
  dropdown.style.top = `${Math.round(r.bottom + 4)}px`;
}

function closeDropdowns() {
  for (const { panel } of DROPDOWNS) els[panel]?.classList.remove('show');
}

function toggleModal(el, show) {
  if (show) { el.classList.remove('closing'); el.classList.add('open'); }
  else {
    el.classList.add('closing');
    el.classList.remove('open');
    setTimeout(() => el.classList.remove('closing'), MODAL_CLOSE_MS);
  }
}

function anyModalOpen() {
  return document.querySelectorAll('.backdrop.open').length > 0;
}

function topModal() {
  const arr = Array.from(document.querySelectorAll('.backdrop.open'));
  if (!arr.length) return null;
  return arr.sort((a, b) =>
    (parseInt(getComputedStyle(b).zIndex) || 0) - (parseInt(getComputedStyle(a).zIndex) || 0)
  )[0];
}

const Importer = {
  assertProjectType(expected) {
    if (State.projectType !== 'uninitialized' && State.projectType !== expected) {
      alert(`Project ini sudah diatur sebagai project ${State.projectType.toUpperCase()}. Tidak bisa mencampur file ${expected.toUpperCase()}.`);
      return false;
    }
    if (State.projectType === 'uninitialized') State.projectType = expected;
    return true;
  },

  assertPluginProjectType(pluginMeta) {
    if (State.projectType !== 'uninitialized' && State.projectType !== 'plugin') {
      alert(`Project ini sudah diatur sebagai project ${State.projectType.toUpperCase()}. Tidak bisa mencampur dengan plugin.`);
      return false;
    }
    if (State.projectType === 'plugin' && State.pluginId && State.pluginId !== pluginMeta.id) {
      alert(`Project ini sudah memakai plugin lain. Tidak bisa mencampur plugin.`);
      return false;
    }
    if (State.projectType === 'uninitialized') {
      State.projectType = 'plugin';
      State.pluginId = pluginMeta.id;
      State.pluginName = pluginMeta.name;
    }
    return true;
  },

  async processPlugin(files) {
    const sorted = files.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    const first = sorted[0];
    const meta = PluginRuntime.resolveByExtension(first.name) || PluginRuntime.resolveByMagic(await readHead(first));
    if (!meta) throw new Error(`Tidak ada plugin aktif yang menangani file "${first.name}".`);
    if (!Importer.assertPluginProjectType(meta)) return null;
    const settings = PluginRuntime.valuesFor(meta);
    const startNum = State.lines.length ? State.lines.reduce((m, l) => Math.max(m, l.line_num), 0) + 1 : 1;
    const existing = new Set(State.files);
    const imported = [];
    const images = [];
    let cur = startNum;
    const pluginData = State.pluginData && typeof State.pluginData === 'object' ? { ...State.pluginData } : {};
    Progress.determinate('Plugin: Mengimpor', `0 / ${sorted.length} file`);
    for (let i = 0; i < sorted.length; i++) {
      const f = sorted[i];
      const bn = baseName(f.name);
      if (existing.has(bn)) continue;
      const buffer = new Uint8Array(await f.arrayBuffer());
      let out;
      try {
        out = await PluginRuntime.callExtract(meta, { fileName: f.name, buffer, settings });
      } catch (e) {
        throw new Error(`Plugin "${meta.name}" gagal parse ${bn}: ${e.message}`);
      }
      const lines = PluginRuntime.normalizePluginLines(out.lines, cur);
      for (const l of lines) l.file = l.file || bn;
      if (lines.length) {
        existing.add(bn);
        for (const l of lines) existing.add(l.file);
        imported.push(...lines);
        cur += lines.length;
      }
      if (out.sourceMap) pluginData[bn] = out.sourceMap;
      if (Array.isArray(out.images)) {
        for (const im of out.images) {
          if (!im) continue;
          images.push({
            zipPath: im.zipPath || im.fileName || bn,
            file: im.file || bn,
            isCover: !!im.isCover,
            insertAfter: im.insertAfter == null ? (lines.length ? lines[lines.length - 1].line_num : null) : im.insertAfter,
            blob: im.blob || null,
            kind: im.kind || 'plugin'
          });
        }
      }
      Progress.update(`${i + 1} / ${sorted.length} file`, ((i + 1) / sorted.length) * 100);
      if (i % 10 === 0) await yieldToEvent();
    }
    State.pluginData = pluginData;
    return { imported, skipped: [], existing: Array.from(existing), images };
  },

  async process(input, isZip = false) {
    await withProgress('Memproses file...', 'Mempersiapkan...', async () => {
      const startNum = State.lines.length ? State.lines.reduce((m, l) => Math.max(m, l.line_num), 0) + 1 : 1;
      const existing = new Set(State.files);
      let result;

      if (isZip && input instanceof File) {
        if (!Importer.assertProjectType('json')) { els.copyStatus.classList.add('empty'); return; }
        Progress.determinate('Mengimpor ZIP', `0 file`);
        result = await parseZipJson(await input.arrayBuffer(), Array.from(existing), startNum, Progress.update);
      } else {
        const files = Array.from(input).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        let hasJson = false, pluginMatch = null, epubFile = null, zipFile = null, unknown = null;
        for (const f of files) {
          const n = f.name.toLowerCase();
          if (n.endsWith('.epub')) { epubFile = epubFile || f; continue; }
          if (n.endsWith('.json')) { hasJson = true; continue; }
          const byExt = PluginRuntime.resolveByExtension(f.name);
          if (byExt) { pluginMatch = pluginMatch || byExt; continue; }
          const head = await readHead(f);
          const byMagic = PluginRuntime.resolveByMagic(head);
          if (byMagic) { pluginMatch = pluginMatch || byMagic; continue; }
          if (!fileExt(f.name)) {
            if (isEpubHead(head)) { epubFile = epubFile || f; continue; }
            if (isZipHead(head)) { zipFile = zipFile || f; continue; }
            if (isJsonHead(head)) { hasJson = true; continue; }
            unknown = unknown || f.name;
          }
        }

        if (pluginMatch && (epubFile || hasJson || zipFile)) {
          Progress.hide();
          alert('Tidak bisa mencampur file bawaan (JSON/EPUB) dengan file plugin dalam satu import.');
          return;
        }
        if (epubFile && (hasJson || zipFile)) {
          Progress.hide();
          alert('Tidak bisa mencampur EPUB dan JSON dalam satu import.');
          return;
        }

        if (pluginMatch) {
          result = await Importer.processPlugin(files);
          if (!result) return;
        } else if (epubFile) {
          if (!Importer.assertProjectType('epub')) return;
          if (State.projectType === 'epub' && State.epubSourceId) {
            Progress.hide();
            alert('Project ini sudah memuat EPUB.');
            return;
          }
          if (!State.epubSourceId) {
            State.projectType = 'epub';
            State.epubSourceId = makeEpubId();
          }
          Progress.determinate('Mengimpor EPUB', `0 file`);
          result = await parseEpub(await epubFile.arrayBuffer(), State.epubTags || 'p', Array.from(existing), startNum, State.epubSourceId, Progress.update);
        } else if (zipFile) {
          if (!Importer.assertProjectType('json')) { els.copyStatus.classList.add('empty'); return; }
          Progress.determinate('Mengimpor ZIP', `0 file`);
          result = await parseZipJson(await zipFile.arrayBuffer(), Array.from(existing), startNum, Progress.update);
        } else if (unknown) {
          Progress.hide();
          alert(`Tipe file "${unknown}" tidak dapat dideteksi. File tanpa ekstensi memerlukan format JSON/EPUB/ZIP atau plugin dengan magic signature.`);
          return;
        } else {
          if (!Importer.assertProjectType('json')) return;
          const fileInputs = [];
          for (const f of files) fileInputs.push({ name: f.name, buffer: await f.arrayBuffer() });
          Progress.determinate('Mengimpor file', `0 / ${fileInputs.length} file`);
          result = await parseFilesList(fileInputs, Array.from(existing), startNum, Progress.update);
        }
      }

      if (result.imported.length || (result.images && result.images.length)) {
        State.lines.push(...result.imported);
        State.files = Array.from(result.existing || existing);
        if (result.images && result.images.length) {
          const known = new Set(State.images.map(im => `${im.zipPath}|${im.isCover ? 1 : 0}`));
          for (const im of result.images) {
            const key = `${im.zipPath}|${im.isCover ? 1 : 0}`;
            if (!known.has(key)) { known.add(key); State.images.push(im); }
          }
        }
        State.namesDirty = true;
        App.refresh(true);
        State.queueSave();
        App.flash(`Berhasil impor ${result.imported.length} baris.${result.skipped.length ? ` (${result.skipped.length} file duplikat diabaikan)` : ''}`);
        PluginRuntime.emit('import', { lineCount: result.imported.length, fileCount: (result.existing || existing).length });
      } else if (result.skipped.length) {
        els.copyStatus.classList.add('empty');
        setTimeout(() => alert(`Gagal impor: File duplikat.\n- ${result.skipped.slice(0, 5).join('\n- ')}`), 10);
      } else {
        App.flash('Tidak ada data valid.', false);
      }
    }, e => `Error:\n${e.message}`);
  }
};

const Exporter = {
  async runEpub() {
    await withProgress('Membuat EPUB...', 'Memuat arsip...', async () => {
      Progress.determinate('Membuat EPUB', `0 file`);
      const result = await buildExportEpub(State.epubSourceId, State.lines, State.epubTags || 'p', State.projectName, Progress.update);
      download(URL.createObjectURL(result.blob), result.name);
      App.flash('Ekspor EPUB berhasil!');
      PluginRuntime.emit('export', { filename: result.name });
    }, e => 'Ekspor EPUB gagal: ' + e.message);
  },

  async runJson() {
    await withProgress('Membuat JSON...', 'Mengelompokkan baris...', async () => {
      Progress.determinate('Membuat JSON', `0 file`);
      const result = await buildExportJson(State.lines, State.projectName, Progress.update);
      download(URL.createObjectURL(result.blob), result.name);
      App.flash('Ekspor JSON berhasil!');
      PluginRuntime.emit('export', { filename: result.name });
    }, e => 'Ekspor JSON gagal: ' + e.message);
  },

  async runPlugin() {
    await withProgress('Membuat file via plugin...', 'Memuat plugin...', async () => {
      const meta = PluginRuntime.getMeta(State.pluginId);
      if (!meta) throw new Error('Plugin untuk project ini tidak lagi terpasang. Project tidak bisa diekspor.');
      if (!meta.enabled) throw new Error('Plugin ini dinonaktifkan. Aktifkan di Plugin Manager terlebih dahulu.');
      const lines = State.lines.map(PluginRuntime.toPluginLine);
      const pluginData = (State.pluginData && typeof State.pluginData === 'object') ? State.pluginData : {};
      const settings = PluginRuntime.valuesFor(meta);
      Progress.determinate('Plugin: Membuat output', `0 file`);
      const out = await PluginRuntime.callPack(meta, {
        lines,
        sourceMap: pluginData,
        projectName: State.projectName || 'untitled',
        settings
      });
      const filename = out.filename || (sanitizeName(State.projectName) + '_tl' + (meta.extensions[0] || '.bin'));
      download(URL.createObjectURL(out.blob), filename);
      App.flash('Ekspor plugin berhasil!');
      PluginRuntime.emit('export', { filename });
    }, e => 'Ekspor plugin gagal: ' + e.message);
  },

  async run() {
    if (!State.lines.length) return;
    if (State.projectType === 'epub' && State.epubSourceId) await Exporter.runEpub();
    else if (State.projectType === 'plugin' && State.pluginId) await Exporter.runPlugin();
    else await Exporter.runJson();
  }
};

const App = {
  main: null,
  pr: null,
  activeLine: null,
  highlightRe: null,
  lastQuery: '',
  lastFile: null,
  fileCache: null,
  toastToken: 0,
  savedTimer: 0,
  tmpVndb: [],
  dashboardItems: [],
  dashboardRendered: 0,
  dashboardObserver: null,
  dashboardSentinel: null,

  flash(msg, keep = false) {
    const el = els.copyStatus;
    el.textContent = msg;
    el.classList.remove('empty');
    const t = ++App.toastToken;
    if (!keep) setTimeout(() => { if (App.toastToken === t) el.classList.add('empty'); }, TOAST_TIMEOUT_MS);
  },

  flashRow(n, delay = 50) {
    setTimeout(() => {
      const cb = els.previewContainer.querySelector(`input[data-num="${n}"]`);
      const row = cb?.closest('.preview-row');
      if (row) { row.classList.add('row-flash'); setTimeout(() => row.classList.remove('row-flash'), 800); }
    }, delay);
  },

  flashSaved() {
    const bar = els.progressText;
    if (!bar || !State.projectId) return;
    bar.classList.remove('saved');
    void bar.offsetWidth;
    bar.classList.add('saved');
    clearTimeout(App.savedTimer);
    App.savedTimer = setTimeout(() => bar.classList.remove('saved'), SAVED_TIMEOUT_MS);
  },

  async init() {
    cacheEls();

    if (!navigator.storage?.getDirectory) {
      els.projectList.innerHTML = `<p class="hint" style="grid-column:1/-1;color:var(--danger);">Browser tidak mendukung OPFS.</p>`;
      return;
    }

    if (navigator.storage?.persist) {
      try {
        const already = await navigator.storage.persisted?.();
        if (!already) await navigator.storage.persist();
      } catch {}
    }

    App.main = new Scroller(
      els.previewViewport, els.previewContainer, App.createMainRow, App.updateMainRow,
      (item) => item.type === 'header' ? `h:${item.file}` : item.type === 'image' ? `i:${item.img.file || ''}:${item.img.zipPath}:${item.img.insertAfter ?? 'c'}` : `l:${item.line.line_num}`
    );
    App.pr = new Scroller(
      els.proofreadContainer.closest('.proofread-results-wrap'),
      els.proofreadContainer,
      App.createPrRow,
      App.updatePrRow,
      (item) => `p:${item.num}`
    );

    App.bind();
    Shortcuts.init();
    await PluginRuntime.init();
    App.renderPluginList();
    await App.loadDashboard();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  },

  bind() {
    App.bindToolbar();
    App.bindDropdowns();
    App.bindImportExport();
    App.bindSelection();
    App.bindGlossary();
    App.bindSettings();
    App.bindContext();
    App.bindLineEditor();
    App.bindProofread();
    App.bindPreview();
    App.bindNames();
    App.bindBookmarks();
  },

  bindToolbar() {
    els.btnNewProject.addEventListener('click', App.createProject);
    els.btnBackToDashboard.addEventListener('click', App.closeProject);
    els.btnToggleHeader.addEventListener('click', () => {
      els.workspaceToolbar.classList.add('hidden');
      els.btnShowHeader.classList.add('visible');
    });
    els.btnShowHeader.addEventListener('click', () => {
      els.workspaceToolbar.classList.remove('hidden');
      els.btnShowHeader.classList.remove('visible');
    });
    els.btnRestoreProject.addEventListener('click', () => els.restoreProjectInput.click());
    els.restoreProjectInput.addEventListener('change', App.restoreProject);

    if (els.projectSearch) {
      let searchTimer = null;
      els.projectSearch.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => App.renderDashboardItems(), 180);
      });
    }
    if (els.projectSearchClear) {
      els.projectSearchClear.addEventListener('click', () => {
        if (els.projectSearch) {
          els.projectSearch.value = '';
          els.projectSearch.focus();
        }
        App.renderDashboardItems();
      });
    }

    App.bindSortDropdown();

    els.btnDashboardSettings.addEventListener('click', () => {
      toggleModal(els.dashboardSettingsModal, true);
    });
    els.btnDashboardSettingsClose.addEventListener('click', () => toggleModal(els.dashboardSettingsModal, false));
    els.btnShortcutsOpen?.addEventListener('click', () => {
      App.renderShortcutList();
      toggleModal(els.shortcutModal, true);
    });
    els.btnShortcutsClose?.addEventListener('click', () => toggleModal(els.shortcutModal, false));
    els.btnShortcutsResetAll?.addEventListener('click', () => {
      if (!confirm('Reset semua shortcut ke default?')) return;
      try { localStorage.removeItem(SHORTCUT_STORAGE_KEY); } catch {}
      Shortcuts.rebuild();
      App.renderShortcutList();
    });
    els.btnBackupAll.addEventListener('click', App.backupAll);
    els.btnWipeAllData.addEventListener('click', App.wipeAllData);

    els.btnOpfsExplorerOpen?.addEventListener('click', () => {
      toggleModal(els.opfsExplorerModal, true);
      OpfsExplorer.path = [];
      OpfsExplorer.refresh();
    });
    els.btnOpfsExplorerClose?.addEventListener('click', () => {
      toggleModal(els.opfsExplorerModal, false);
      App.loadDashboard();
    });
    els.btnOpfsRefresh?.addEventListener('click', () => OpfsExplorer.refresh());
    els.opfsList?.addEventListener('click', e => OpfsExplorer.handleClick(e));

    els.btnPluginManagerOpen?.addEventListener('click', () => {
      App.openPluginManager();
    });
    els.btnPluginManagerClose?.addEventListener('click', () => {
      toggleModal(els.pluginManagerModal, false);
      App.loadDashboard();
    });
    els.btnPluginRefresh?.addEventListener('click', async () => {
      await PluginRuntime.sync();
      App.renderPluginList();
    });

    els.btnOpenPlugins?.addEventListener('click', () => {
      PluginRuntime.renderMenu();
    });

    els.pluginMenu?.addEventListener('click', e => {
      const setBtn = e.target.closest('[data-plugin-settings]');
      if (setBtn) {
        closeDropdowns();
        const meta = PluginRuntime.getMeta(setBtn.dataset.pluginSettings);
        if (meta) App.openPluginSettings(meta);
        return;
      }
      const btn = e.target.closest('[data-cmd]');
      if (!btn) return;
      closeDropdowns();
      PluginRuntime.runCommand(btn.dataset.cmd);
    });

    if (els.btnInstallPlugin) {
      els.btnInstallPlugin.addEventListener('click', () => els.pluginFileInput?.click());
    }
    if (els.pluginFileInput) {
      els.pluginFileInput.addEventListener('change', async e => {
        if (!e.target.files.length) { e.target.value = ''; return; }
        await App.installPlugin(e.target.files[0]);
        e.target.value = '';
      });
    }
    const pluginListEl = document.getElementById('pluginList');
    if (pluginListEl) {
      pluginListEl.addEventListener('dragover', (e) => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          pluginListEl.classList.add('dragover');
        }
      });
      pluginListEl.addEventListener('dragleave', (e) => {
        if (e.target === pluginListEl) pluginListEl.classList.remove('dragover');
      });
      pluginListEl.addEventListener('drop', async (e) => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        pluginListEl.classList.remove('dragover');
        for (const f of Array.from(e.dataTransfer.files)) {
          const n = f.name.toLowerCase();
          if (n.endsWith('.zip')) {
            await App.installPlugin(f);
            break;
          }
        }
      });
    }
  },

  bindSortDropdown() {
    const box = document.getElementById('projectSortBox');
    const trigger = document.getElementById('projectSortTrigger');
    const menu = document.getElementById('projectSortMenu');
    const label = document.getElementById('projectSortLabel');
    const hidden = document.getElementById('projectSort');
    if (!box || !trigger || !menu || !label || !hidden) return;

    const labelMap = {};
    menu.querySelectorAll('.sort-menu-item').forEach(item => {
      labelMap[item.dataset.value] = item.querySelector('.sort-menu-text')?.textContent || item.dataset.value;
    });

    const closeMenu = () => {
      box.classList.remove('open');
      menu.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    };
    const openMenu = () => {
      box.classList.add('open');
      menu.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      const active = menu.querySelector('.sort-menu-item.active');
      if (active) setTimeout(() => active.focus(), 30);
    };
    const toggleMenu = () => {
      if (box.classList.contains('open')) closeMenu();
      else openMenu();
    };
    const selectValue = (value) => {
      if (!value || !labelMap[value]) return;
      hidden.value = value;
      label.textContent = labelMap[value];
      menu.querySelectorAll('.sort-menu-item').forEach(item => {
        const isActive = item.dataset.value === value;
        item.classList.toggle('active', isActive);
        item.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      App.renderDashboardItems();
      closeMenu();
    };

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu();
    });

    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        toggleMenu();
      } else if (e.key === 'Escape' && box.classList.contains('open')) {
        e.preventDefault();
        closeMenu();
        trigger.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!box.classList.contains('open')) openMenu();
        else {
          const active = menu.querySelector('.sort-menu-item.active');
          const next = active ? active.nextElementSibling : menu.querySelector('.sort-menu-item');
          if (next) next.focus();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!box.classList.contains('open')) openMenu();
        else {
          const active = menu.querySelector('.sort-menu-item.active');
          const prev = active ? active.previousElementSibling : null;
          if (prev) prev.focus();
        }
      }
    });

    menu.querySelectorAll('.sort-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        selectValue(item.dataset.value);
      });
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          selectValue(e.currentTarget.dataset.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeMenu();
          trigger.focus();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          const next = e.currentTarget.nextElementSibling;
          if (next) next.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prev = e.currentTarget.previousElementSibling;
          if (prev) prev.focus();
        }
      });
    });

    document.addEventListener('click', (e) => {
      if (!box.contains(e.target) && box.classList.contains('open')) {
        closeMenu();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && box.classList.contains('open')) {
        closeMenu();
        trigger.focus();
      }
    });

    const reposition = () => {
      if (!box.classList.contains('open')) return;
      const r = menu.getBoundingClientRect();
      if (r.right > window.innerWidth - 8) {
        menu.style.left = 'auto';
        menu.style.right = '0';
      }
      if (r.left < 8) {
        menu.style.right = 'auto';
        menu.style.left = '0';
      }
    };
    trigger.addEventListener('click', () => setTimeout(reposition, 50));
    window.addEventListener('resize', reposition);
  },

  bindDropdowns() {
    document.addEventListener('click', e => {
      for (const { trigger, panel } of DROPDOWNS) {
        if (e.target.closest(`#${trigger}`)) {
          e.preventDefault();
          const willShow = !els[panel].classList.contains('show');
          closeDropdowns();
          if (willShow) { positionDropdown(panel); els[panel].classList.add('show'); }
          return;
        }
      }
      if (!DROPDOWNS.some(({ group }) => e.target.closest(`#${group}`))) closeDropdowns();
      const bd = e.target.closest('.backdrop.open');
      if (bd && e.target === bd) toggleModal(bd, false);
    });

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (anyModalOpen()) { const m = topModal(); if (m) toggleModal(m, false); }
      else closeDropdowns();
    });

    els.dynamicToolbarWrap.addEventListener('scroll', closeDropdowns, { passive: true });
    window.addEventListener('scroll', closeDropdowns, true);
    window.addEventListener('resize', closeDropdowns);
  },

  bindImportExport() {
    const importInputs = [els.importFileInput, els.importFolderInput, els.importZipInput];
    ['btnImportFile', 'btnImportFolder', 'btnImportZip'].forEach((id, i) => {
      const input = importInputs[i];
      els[id].addEventListener('click', () => { closeDropdowns(); input.click(); });
      input.addEventListener('change', async e => {
        if (!e.target.files.length) return;
        await Importer.process(id === 'btnImportZip' ? e.target.files[0] : e.target.files, id === 'btnImportZip');
        e.target.value = '';
      });
    });

    els.btnExport.addEventListener('click', () => Exporter.run());
    els.btnCopyForAi.addEventListener('click', App.copyForAi);
    els.btnApply.addEventListener('click', App.applyTranslation);
    els.btnUndo.addEventListener('click', App.undo);
    els.btnRedo.addEventListener('click', App.redo);
    els.btnProofread.addEventListener('click', App.openProofread);
  },

  bindSelection() {
    els.btnSelectAll.addEventListener('click', () => {
      State.lines.forEach(l => { if (!isTrans(l)) State.selected.add(l.line_num); });
      App.syncCheckboxes();
    });
    els.btnClearSelection.addEventListener('click', () => { State.selected.clear(); App.syncCheckboxes(); });
    els.btnSelectRange.addEventListener('click', App.selectRange);
  },

  bindGlossary() {
    els.btnGlossary.addEventListener('click', () => {
      els.glossaryVndbCheck.checked = State.vndbEnabled;
      els.glossaryVndbIdInput.value = State.vndbId || '';
      App.tmpVndb = [...State.vndbGlossary];
      els.glossaryVndbPreviewArea.value = App.tmpVndb.map(g => `${g[0]}: ${g[1]}`).join('\n');
      els.glossaryVndbWrap.classList.toggle('section-disabled', !State.vndbEnabled);
      els.glossaryVndbIdInput.disabled = els.btnGlossaryVndbFetch.disabled = App.tmpVndb.length > 0;
      els.glossaryCustomCheck.checked = State.customEnabled;
      els.glossaryCustomInput.value = State.customRaw || '';
      els.glossaryCustomWrap.classList.toggle('section-disabled', !State.customEnabled);
      toggleModal(els.glossaryModal, true);
    });
    els.glossaryVndbCheck.addEventListener('change', e => {
      els.glossaryVndbWrap.classList.toggle('section-disabled', !e.target.checked);
    });
    els.btnGlossaryVndbFetch.addEventListener('click', async () => {
      let id = els.glossaryVndbIdInput.value.trim();
      if (!id) return;
      if (!id.startsWith('v')) id = 'v' + id;
      const status = els.glossaryVndbStatus;
      try {
        els.btnGlossaryVndbFetch.disabled = els.glossaryVndbIdInput.disabled = true;
        status.textContent = 'Mengambil data...';
        status.className = 'toast info';
        const chars = await Vndb.fetchCharacters(id);
        if (!chars.length) throw new Error('Karakter tidak ditemukan.');
        App.tmpVndb = Vndb.buildGlossary(chars);
        els.glossaryVndbPreviewArea.value = App.tmpVndb.map(g => `${g[0]}: ${g[1]}`).join('\n');
        status.textContent = `Ditemukan ${App.tmpVndb.length} entri.`;
        status.className = 'toast success';
      } catch (e) {
        status.textContent = e.message;
        status.className = 'toast error';
        els.btnGlossaryVndbFetch.disabled = els.glossaryVndbIdInput.disabled = false;
      }
    });
    els.btnGlossaryVndbReset.addEventListener('click', () => {
      els.glossaryVndbCheck.checked = false;
      els.glossaryVndbIdInput.value = '';
      els.glossaryVndbPreviewArea.value = '';
      App.tmpVndb = [];
      els.glossaryVndbStatus.className = 'toast empty mb-2';
      els.glossaryVndbIdInput.disabled = els.btnGlossaryVndbFetch.disabled = false;
      els.glossaryVndbWrap.classList.add('section-disabled');
    });
    els.glossaryCustomCheck.addEventListener('change', e => {
      els.glossaryCustomWrap.classList.toggle('section-disabled', !e.target.checked);
    });
    els.btnGlossaryCustomReset.addEventListener('click', () => {
      els.glossaryCustomCheck.checked = false;
      els.glossaryCustomInput.value = '';
      els.glossaryCustomWrap.classList.add('section-disabled');
    });
    els.btnGlossaryCancel.addEventListener('click', () => toggleModal(els.glossaryModal, false));
    els.btnGlossarySave.addEventListener('click', () => {
      State.vndbEnabled = els.glossaryVndbCheck.checked;
      State.vndbId = els.glossaryVndbIdInput.value.trim();
      State.vndbGlossary = App.tmpVndb;
      State.customEnabled = els.glossaryCustomCheck.checked;
      State.customRaw = els.glossaryCustomInput.value.trim();
      toggleModal(els.glossaryModal, false);
      State.queueSave();
    });
  },

  bindSettings() {
    els.btnSettings.addEventListener('click', () => {
      App.syncSettingsModal();
      toggleModal(els.settingsModal, true);
    });
    els.btnSettingsDasarReset.addEventListener('click', () => App.resetSettingsModal('dasar'));
    els.btnSettingsPromptReset.addEventListener('click', () => { els.settingsPromptInput.value = DEFAULT_PROMPT; });
    els.btnSettingsEpubReset.addEventListener('click', () => { els.settingsEpubTagsInput.value = 'p'; });
    els.btnSettingsIncrementReset?.addEventListener('click', () => {
      els.settingsIncrementCheck.checked = false;
      els.settingsIncrementStepInput.value = 100;
      els.incrementStepWrap.classList.add('section-disabled');
    });
    els.settingsIncrementCheck.addEventListener('change', e => {
      els.incrementStepWrap.classList.toggle('section-disabled', !e.target.checked);
    });
    els.btnSettingsCancel.addEventListener('click', () => toggleModal(els.settingsModal, false));
    els.btnSettingsSave.addEventListener('click', () => {
      SETTINGS_FIELDS.forEach(({ id, key, type, def }) => {
        if (type === 'check') State[key] = els[id].checked;
        else if (type === 'number') State[key] = Math.max(1, Math.floor(Number(els[id].value) || def));
        else State[key] = els[id].value.trim() || def;
      });
      App.applyHideTools();
      toggleModal(els.settingsModal, false);
      if (State.incrementEnabled && State.projectId && State.lines.length) {
        const from = parseInt(els.rangeFromInput.value, 10);
        const to = parseInt(els.rangeToInput.value, 10);
        if (!(from >= 1 && to >= from)) App.prefillIncrement();
      }
      State.queueSave();
    });
  },

  bindContext() {
    els.btnContext.addEventListener('click', () => {
      els.ringkasanEnabledCheck.checked = State.ringkasanEnabled;
      els.ringkasanPromptInput.value = State.ringkasanPrompt || DEFAULT_RINGKASAN_PROMPT;
      els.ringkasanStoredInput.value = State.ringkasan || '';
      els.ringkasanWrap.classList.toggle('section-disabled', !State.ringkasanEnabled);
      toggleModal(els.contextModal, true);
    });
    els.ringkasanEnabledCheck.addEventListener('change', e => {
      els.ringkasanWrap.classList.toggle('section-disabled', !e.target.checked);
    });
    els.btnRingkasanReset.addEventListener('click', () => {
      els.ringkasanEnabledCheck.checked = false;
      els.ringkasanPromptInput.value = DEFAULT_RINGKASAN_PROMPT;
      els.ringkasanStoredInput.value = '';
      els.ringkasanWrap.classList.add('section-disabled');
    });
    els.btnRingkasanPromptReset.addEventListener('click', () => {
      els.ringkasanPromptInput.value = DEFAULT_RINGKASAN_PROMPT;
    });
    els.btnRingkasanStoredReset.addEventListener('click', () => {
      els.ringkasanStoredInput.value = '';
    });
    els.btnContextCancel.addEventListener('click', () => toggleModal(els.contextModal, false));
    els.btnContextSave.addEventListener('click', () => {
      State.ringkasanEnabled = els.ringkasanEnabledCheck.checked;
      State.ringkasanPrompt = els.ringkasanPromptInput.value.trim() || DEFAULT_RINGKASAN_PROMPT;
      State.ringkasan = els.ringkasanStoredInput.value.trim();
      toggleModal(els.contextModal, false);
      State.queueSave();
    });
  },

  bindLineEditor() {
    els.btnLineCancel.addEventListener('click', () => toggleModal(els.lineEditorModal, false));
    els.btnLineSave.addEventListener('click', App.saveLineEditor);
  },

  bindProofread() {
    els.btnProofreadClose.addEventListener('click', () => toggleModal(els.proofreadModal, false));
    els.btnProofreadReset.addEventListener('click', () => {
      els.proofreadSearchInput.value = '';
      els.proofreadReplaceInput.value = '';
      PROOFREAD_FIELDS.forEach(({ id, def, type }) => {
        const el = els[id];
        if (type === 'check') el.checked = def; else el.value = def;
      });
      App.syncProofread();
      App.renderProofread();
    });
    els.btnProofreadReplaceAll.addEventListener('click', App.replaceAll);

    const delayedRender = debounce(App.renderProofread, 200);
    els.proofreadSearchInput.addEventListener('input', delayedRender);
    PROOFREAD_FIELDS.forEach(({ id }) => {
      els[id].addEventListener('change', () => { App.syncProofread(); App.renderProofread(); });
    });
  },

  bindPreview() {
    els.previewContainer.addEventListener('change', e => {
      if (e.target.closest('.checkbox-cell') && e.target.type === 'checkbox') {
        const n = Number(e.target.dataset.num);
        if (e.target.checked) State.selected.add(n); else State.selected.delete(n);
        App.syncCheckboxes();
      } else if (e.target.matches('.file-header-inner input[type="checkbox"][data-file]')) {
        App.toggleFileSelection(e.target);
      }
    });
    els.stickyFileCheckbox.addEventListener('change', e => {
      if (e.target.dataset.file) App.toggleFileSelection(e.target);
    });
    els.previewContainer.addEventListener('click', e => {
      if (e.target.matches('input[type="checkbox"]')) return;
      const bmBtn = e.target.closest('.row-bookmark-btn');
      if (bmBtn) {
        e.stopPropagation();
        e.preventDefault();
        const n = Number(bmBtn.dataset.num);
        if (n) App.toggleBookmark(n);
        return;
      }
      const wrap = e.target.closest('.text-content');
      if (!wrap) return;
      const row = wrap.closest('.preview-row');
      if (!row || row.classList.contains('file-header')) return;
      const cb = row.querySelector('input[type="checkbox"]');
      if (cb?.dataset.num) App.openLineEditor(Number(cb.dataset.num));
    });

    let raf = 0;
    els.previewViewport.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; App.updateFileBadge(); });
    }, { passive: true });

    els.proofreadContainer.addEventListener('click', e => {
      const wrap = e.target.closest('.text-content');
      if (!wrap?.dataset.num) return;
      const n = Number(wrap.dataset.num);
      if (State.jumpToContext) {
        toggleModal(els.proofreadModal, false);
        const idx = State.rows.findIndex(r => r.type === 'line' && r.line.line_num === n);
        if (idx !== -1) { App.main.scrollToIndex(idx); App.flashRow(n, 60); }
      } else {
        App.openLineEditor(n);
      }
    });
  },

  bindNames() {
    els.nameTableBody.addEventListener('click', async e => {
      if (e.target.tagName !== 'TD') return;
      try { await clipboard(e.target.textContent); App.flash('Nama disalin!'); }
      catch { alert('Gagal disalin.'); }
    });
    els.btnCopyNamesPlain.addEventListener('click', () => App.copyAllNames('plain'));
    els.btnCopyNamesWithGlossary.addEventListener('click', () => App.copyAllNames('glossary'));
    els.btnCopyNamesMissingGlossary.addEventListener('click', () => App.copyAllNames('missing'));
  },

  bindBookmarks() {
    els.btnBookmarks.addEventListener('click', () => {
      const panel = els.bookmarkPanel;
      const willShow = !panel.classList.contains('show');
      App.toggleBookmarkPanel(willShow);
    });

    els.bookmarkList.addEventListener('click', e => {
      const del = e.target.closest('.bookmark-item-del');
      if (del) {
        e.stopPropagation();
        const item = del.closest('.bookmark-item');
        const n = Number(item?.dataset.num);
        if (n) App.toggleBookmark(n, false);
        return;
      }
      const item = e.target.closest('.bookmark-item');
      if (!item) return;
      const n = Number(item.dataset.num);
      if (!n) return;
      App.scrollToBookmark(n);
      App.toggleBookmarkPanel(false);
    });

    els.btnBookmarkClear.addEventListener('click', () => {
      if (!State.bookmarks.length) return;
      if (!confirm('Hapus semua bookmark?')) return;
      State.bookmarks = [];
      App.syncBookmarkUI();
      App.renderBookmarkList();
      State.queueSave();
    });

    document.addEventListener('click', e => {
      if (!els.bookmarkPanel.classList.contains('show')) return;
      if (e.target.closest('.bookmark-dock')) return;
      App.toggleBookmarkPanel(false);
    });

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (els.bookmarkPanel.classList.contains('show')) {
        App.toggleBookmarkPanel(false);
      }
    });

    window.addEventListener('blur', () => App.toggleBookmarkPanel(false), { once: true });
  },

  toggleBookmarkPanel(show) {
    els.bookmarkPanel.classList.toggle('show', show);
    els.btnBookmarks.classList.toggle('active', show);
    els.btnBookmarks.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) App.renderBookmarkList();
  },

  toggleBookmark(num, force) {
    if (!num) return;
    const idx = State.bookmarks.indexOf(num);
    const has = idx !== -1;
    const next = force === undefined ? !has : force;
    if (next && !has) State.bookmarks.push(num);
    else if (!next && has) State.bookmarks.splice(idx, 1);
    else return;
    App.syncBookmarkUI();
    if (els.bookmarkPanel.classList.contains('show')) App.renderBookmarkList();
    State.queueSave();
  },

  syncBookmarkUI() {
    const count = State.bookmarks.length;
    if (els.bookmarkPanelCount) {
      els.bookmarkPanelCount.textContent = `(${count})`;
    }
    if (els.btnBookmarks) {
      els.btnBookmarks.disabled = !State.lines.length;
    }
    if (els.btnBookmarkClear) {
      els.btnBookmarkClear.disabled = count === 0;
    }
    if (App.main) App.main.forceUpdate();
  },

  renderBookmarkList() {
    const list = els.bookmarkList;
    if (!list) return;
    list.replaceChildren();
    const nums = [...State.bookmarks].sort((a, b) => a - b);
    if (!nums.length) return;
    const frag = document.createDocumentFragment();
    for (const num of nums) {
      const l = State.byNum.get(num);
      if (!l) continue;
      const item = document.createElement('div');
      item.className = 'bookmark-item';
      item.dataset.num = num;

      const numEl = document.createElement('span');
      numEl.className = 'bookmark-item-num';
      numEl.textContent = num;

      const meta = document.createElement('div');
      meta.className = 'bookmark-item-meta';
      const fileEl = document.createElement('span');
      fileEl.className = 'bookmark-item-file';
      fileEl.textContent = baseName(l.file);
      fileEl.title = l.file;
      const textEl = document.createElement('span');
      textEl.className = 'bookmark-item-text';
      const preview = l.message || (l.name ? `${l.name}: ` : '');
      textEl.textContent = preview || '(kosong)';
      textEl.title = preview;
      meta.append(fileEl, textEl);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'bookmark-item-del';
      del.setAttribute('aria-label', `Hapus bookmark baris ${num}`);
      del.tabIndex = -1;
      del.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

      item.append(numEl, meta, del);
      frag.appendChild(item);
    }
    list.appendChild(frag);
  },

  scrollToBookmark(num) {
    const idx = State.rows.findIndex(r => r.type === 'line' && r.line.line_num === num);
    if (idx === -1) return;
    App.main.scrollToIndex(idx);
    App.flashRow(num, 60);
  },

  syncSettingsModal() {
    SETTINGS_FIELDS.forEach(({ id, key, type, def }) => {
      const v = State[key] ?? def;
      if (type === 'check') els[id].checked = v; else els[id].value = v;
    });
    els.incrementStepWrap.classList.toggle('section-disabled', !State.incrementEnabled);
  },

  resetSettingsModal(group) {
    const filter = group === 'dasar' ? f => f.type === 'check' : null;
    if (!filter) return;
    SETTINGS_FIELDS.filter(filter).forEach(({ id, def }) => { els[id].checked = def; });
  },

  async createProject() {
    const name = prompt('Nama project baru:')?.trim();
    if (!name) return;
    const id = makeProjId();
    State.resetTransient();
    State.projectId = id;
    State.projectName = name;
    try {
      await Storage.saveProject(id, State.toData());
      App.open(id, State.toData());
    } catch (e) {
      alert('Gagal membuat project: ' + e.message);
    }
  },

  open(id, data) {
    EpubImages.clear();
    State.loadFromData(data);
    State.projectId = id;
    State.selected.clear();
    State.undo = State.redo = null;
    State.namesDirty = true;
    els.rangeFromInput.value = '';
    els.rangeToInput.value = '';

    if (data.projectType === 'epub' && data.epubSourceId) EpubImages.preload(data.epubSourceId);

    if (App.dashboardObserver) { App.dashboardObserver.disconnect(); App.dashboardObserver = null; }

    els.projectNameDisplay.textContent = State.projectName;
    els.dashboardView.classList.remove('open');
    els.workspaceView.style.display = 'flex';
    PluginRuntime.applyTheme();
    Shortcuts.refreshPluginActions();
    App.syncImportAccept(PluginRuntime.listMeta().filter(p => p.enabled === true));
    App.applyHideTools();
    App.refresh(false);
    App.syncBookmarkUI();
    App.toggleBookmarkPanel(false);
    PluginRuntime.syncSettings();
    PluginRuntime.emit('projectOpen', {
      name: State.projectName,
      type: State.projectType,
      lineCount: State.lines.length,
      translatedCount: State.translatedCount
    });
  },

  closeProject() {
    if (State.saveTimer) {
      clearTimeout(State.saveTimer);
      State.saveTimer = null;
      const id = State.projectId;
      const data = State.toData();
      Storage.saveProject(id, data)
        .then(App.finishClose)
        .catch(e => {
          alert('Gagal menyimpan perubahan terakhir: ' + e.message);
          App.finishClose();
        });
    } else App.finishClose();
  },

  finishClose() {
    PluginRuntime.emit('projectClose', {
      name: State.projectName,
      lineCount: State.lines.length,
      translatedCount: State.translatedCount
    });
    EpubImages.clear();
    State.resetTransient();
    PluginRuntime.applyTheme();
    PluginRuntime.syncSettings();
    Shortcuts.refreshPluginActions();
    App.syncImportAccept(PluginRuntime.listMeta());
    App.main?.setItems([], false);
    App.pr?.setItems([], false);
    els.nameTableBody.replaceChildren();
    els.pasteArea.value = '';
    els.rangeFromInput.value = '';
    els.rangeToInput.value = '';
    els.copyStatus.classList.add('empty');
    els.progressText.textContent = '0/0 (0%)';
    els.progressText.classList.remove('saved');
    els.stickyFileName.textContent = '';
    els.stickyFileName.title = '';
    els.stickyFileRange.textContent = '';
    els.stickyFileBar.classList.remove('show', 'swap');
    els.stickyFileCheckbox.checked = false;
    els.stickyFileCheckbox.disabled = true;
    delete els.stickyFileCheckbox.dataset.file;
    App.lastFile = null;
    App.fileCache = null;
    App.toggleBookmarkPanel(false);
    if (els.bookmarkList) els.bookmarkList.replaceChildren();
    App.syncBookmarkUI();
    els.workspaceView.style.display = 'none';
    const split = document.querySelector('.split');
    if (split) split.classList.remove('hide-tools');
    els.workspaceToolbar.classList.remove('hidden');
    els.btnShowHeader.classList.remove('visible');
    els.dashboardView.classList.add('open');
    App.loadDashboard();
  },

  applyHideTools() {
    const split = document.querySelector('.split');
    if (!split) return;
    split.classList.toggle('hide-tools', State.hideTools);
    if (App.main) requestAnimationFrame(() => { App.main.invalidate(); App.main.render(); });
  },

  syncImportAccept(plugins) {
    const exts = new Set(['.json', '.epub']);
    let magic = false;
    for (const p of plugins || []) {
      for (const e of (p.extensions || [])) {
        const v = String(e).trim().toLowerCase();
        if (v.startsWith('.')) exts.add(v);
      }
      if (Array.isArray(p.magic) && p.magic.length) magic = true;
    }
    const accept = magic ? '' : Array.from(exts).join(',');
    if (els.importFileInput) els.importFileInput.accept = accept;
    if (els.importFolderInput) els.importFolderInput.accept = accept;
  },

  renderShortcutList() {
    const wrap = els.shortcutList;
    if (!wrap) return;
    const bindings = Shortcuts.loadBindings();
    wrap.replaceChildren();
    const groups = [
      { label: 'Dashboard', actions: Shortcuts._actions.filter(a => a.scope === 'dashboard') },
      { label: 'Workspace', actions: Shortcuts._actions.filter(a => a.scope === 'workspace') },
      { label: 'Plugin', actions: Shortcuts._pluginActions }
    ];
    for (const g of groups) {
      if (!g.actions.length) continue;
      const head = document.createElement('div');
      head.className = 'shortcut-group';
      head.textContent = g.label;
      wrap.appendChild(head);
      for (const a of g.actions) wrap.appendChild(App.buildShortcutRow(a, bindings));
    }
  },

  buildShortcutRow(action, bindings) {
    const row = document.createElement('div');
    row.className = 'shortcut-row';
    const label = document.createElement('span');
    label.className = 'shortcut-label';
    label.textContent = action.label;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shortcut-key';
    const cur = action.id in bindings ? bindings[action.id] : (action.def || '');
    btn.innerHTML = cur ? comboHtml(cur) : '<span class="shortcut-none">Tidak diatur</span>';
    btn.title = 'Klik lalu tekan kombinasi tombol (Backspace menghapus, Escape batal)';
    btn.addEventListener('click', () => Shortcuts.startRecording(action, btn));
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'shortcut-reset';
    reset.title = 'Reset ke default';
    reset.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v5h-5"/></svg>';
    const isCustom = (action.id in bindings) && bindings[action.id] !== (action.def || '');
    reset.hidden = !isCustom;
    reset.addEventListener('click', () => {
      const b = Shortcuts.loadBindings();
      delete b[action.id];
      Shortcuts.saveBindings(b);
      Shortcuts.rebuild();
      App.renderShortcutList();
    });
    row.append(label, btn, reset);
    return row;
  },

  async openPluginManager() {
    await PluginRuntime.sync();
    toggleModal(els.pluginManagerModal, true);
    App.renderPluginList();
  },

  renderPluginList() {
    const container = els.pluginList;
    if (!container) return;
    const plugins = PluginRuntime.listMeta();
    App.syncImportAccept(plugins);
    container.replaceChildren();
    if (!plugins.length) {
      container.innerHTML = `
          <div class="plugin-empty">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5h4.5a2.5 2.5 0 1 1 5 0H19v4.5a2.5 2.5 0 1 1 0 5V19h-4.5a2.5 2.5 0 1 0-5 0H5v-4.5a2.5 2.5 0 1 0 0-5z"/></svg>
            <span>Belum ada plugin terpasang.</span>
          </div>`;
      return;
    }
    const frag = document.createDocumentFragment();
    for (const p of plugins) frag.appendChild(App.buildPluginCard(p));
    container.appendChild(frag);
  },

  buildPluginCard(p) {
    const row = document.createElement('div');
    row.className = 'plugin-row' + (p.enabled ? ' is-enabled' : '');
    const caps = Array.isArray(p.caps) ? p.caps : [];
    const badges = [];
    if (caps.includes('parser') && ((p.extensions || []).length || (p.magic || []).length)) {
      const label = [(p.extensions || []).join(' '), (p.magic || []).length ? '+magic' : ''].filter(Boolean).join(' ');
      badges.push(`<span class="plugin-badge plugin-badge-parser" title="Menangani import/export format khusus">Parser ${escapeHtml(label)}</span>`);
    }
    if (caps.includes('theme')) badges.push('<span class="plugin-badge plugin-badge-theme" title="Mengubah tampilan CSTL">Theme</span>');
    if (caps.includes('hooks')) badges.push('<span class="plugin-badge plugin-badge-hooks" title="Mengubah alur copy/paste">Hooks</span>');
    if (caps.includes('commands')) badges.push('<span class="plugin-badge plugin-badge-commands" title="Menyediakan aksi yang bisa di-bind ke shortcut">Commands</span>');
    if (caps.includes('settings')) badges.push('<span class="plugin-badge plugin-badge-settings" title="Punya pengaturan">Settings</span>');
    if (caps.includes('panel')) badges.push('<span class="plugin-badge plugin-badge-panel" title="Menyediakan panel UI di sidebar alat">Panel</span>');
    if (p.files.length) {
      badges.push(`<span class="plugin-badge plugin-badge-package" title="${escapeHtml(p.files.join('\n'))}">Assets · ${p.files.length}</span>`);
    }
    row.innerHTML = `
      <div class="plugin-head">
        <div class="plugin-head-main">
          <span class="plugin-name">${escapeHtml(p.name)}</span>
          <span class="plugin-version">v${escapeHtml(p.version)}</span>
        </div>
        <label class="switch" title="${p.enabled ? 'Nonaktifkan' : 'Aktifkan'} plugin">
          <input type="checkbox" class="plugin-toggle" ${p.enabled ? 'checked' : ''} />
          <span class="switch-track"></span>
        </label>
      </div>
      ${badges.length ? `<div class="plugin-badges">${badges.join('')}</div>` : ''}
      ${p.author || p.description ? `
      <div class="plugin-meta">
        ${p.author ? `<span class="plugin-author">by ${escapeHtml(p.author)}</span>` : ''}
        ${p.description ? `<span class="plugin-desc-inline">${escapeHtml(p.description)}</span>` : ''}
      </div>` : ''}
      <div class="plugin-actions">
        <button class="btn btn-ghost btn-xs btn-uninstall-plugin" title="Hapus plugin">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1.4 14.1A2 2 0 0 1 15.6 22H8.4a2 2 0 0 1-2-1.9L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
          Hapus
        </button>
      </div>
    `;
    row.querySelector('.plugin-toggle').addEventListener('change', async e => {
      await PluginRuntime.setEnabled(p.id, e.target.checked);
      App.renderPluginList();
    });
    row.querySelector('.btn-uninstall-plugin').addEventListener('click', async () => {
      try {
        const ok = await PluginRuntime.uninstall(p.id);
        if (ok) {
          App.renderPluginList();
          await App.loadDashboard();
          if (els.shortcutModal.classList.contains('open')) App.renderShortcutList();
          App.flash(`Plugin "${p.name}" dihapus.`);
        }
      } catch (e) {
        alert('Gagal menghapus plugin: ' + e.message);
      }
    });
    return row;
  },

  openPluginSettings(pluginMeta) {
    if (!Array.isArray(pluginMeta.settings) || !pluginMeta.settings.length) {
      alert('Plugin ini tidak memiliki pengaturan.');
      return;
    }
    const merged = PluginRuntime.valuesFor(pluginMeta);
    const form = document.createElement('div');
    form.className = 'plugin-settings-form';
    for (const s of pluginMeta.settings) {
      const row = document.createElement('div');
      row.className = 'plugin-settings-row';
      const id = `pluginSetting_${pluginMeta.id}_${s.key}`;
      const cur = merged[s.key];
      const type = s.type;
      let inputHtml;
      if (type === 'boolean') {
        inputHtml = `<label class="check-line"><input id="${id}" type="checkbox" ${cur ? 'checked' : ''}/> ${escapeHtml(s.label)}</label>`;
      } else if (type === 'select') {
        const opts = (s.options || []).map(o => `<option value="${escapeHtml(o.value)}" ${String(cur) === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
        inputHtml = `<select id="${id}" class="input w-full">${opts}</select>`;
      } else if (type === 'textarea') {
        inputHtml = `<textarea id="${id}" class="textarea w-full" rows="4" placeholder="${escapeHtml(s.placeholder || '')}">${escapeHtml(String(cur ?? ''))}</textarea>`;
      } else if (type === 'number') {
        inputHtml = `<input id="${id}" class="input w-full" type="number" value="${escapeHtml(String(cur ?? ''))}" ${s.min != null ? `min="${s.min}"` : ''} ${s.max != null ? `max="${s.max}"` : ''} ${s.step != null ? `step="${s.step}"` : ''}/>`;
      } else {
        inputHtml = `<input id="${id}" class="input w-full" type="text" value="${escapeHtml(String(cur ?? ''))}" placeholder="${escapeHtml(s.placeholder || '')}"/>`;
      }
      const labelHtml = type === 'boolean' ? '' : `<label for="${id}" class="plugin-settings-label">${escapeHtml(s.label)}${s.description ? `<span class="plugin-settings-desc">${escapeHtml(s.description)}</span>` : ''}</label>`;
      row.innerHTML = `<div class="plugin-settings-cell">${labelHtml}${inputHtml}</div>`;
      form.appendChild(row);
    }

    const overlay = document.createElement('div');
    overlay.className = 'backdrop backdrop-top';
    overlay.innerHTML = `
      <div class="modal modal-wide" role="dialog" aria-modal="true">
        <div class="modal-head"><h3>Pengaturan Plugin: ${escapeHtml(pluginMeta.name)}</h3></div>
        <div class="modal-body"></div>
        <div class="modal-actions">
          <button class="btn btn-ghost btn-plugin-settings-reset">Reset Default</button>
          <span class="grow"></span>
          <button class="btn btn-ghost btn-plugin-settings-cancel">Batal</button>
          <button class="btn btn-primary btn-plugin-settings-save">Simpan</button>
        </div>
      </div>`;
    const body = overlay.querySelector('.modal-body');
    const scopeHint = document.createElement('p');
    scopeHint.className = 'hint m-0 mt-1 mb-2';
    scopeHint.textContent = `Nilai hanya berlaku untuk project "${State.projectName || 'ini'}"; project lain memakai nilai default.`;
    body.append(scopeHint, form);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => overlay.classList.add('open'));
    const close = () => {
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), MODAL_CLOSE_MS);
    };
    overlay.querySelector('.btn-plugin-settings-cancel').addEventListener('click', close);
    overlay.querySelector('.btn-plugin-settings-save').addEventListener('click', async () => {
      const out = {};
      for (const s of pluginMeta.settings) {
        const el = document.getElementById(`pluginSetting_${pluginMeta.id}_${s.key}`);
        if (!el) continue;
        if (s.type === 'boolean') out[s.key] = !!el.checked;
        else if (s.type === 'number') out[s.key] = el.value === '' ? null : Number(el.value);
        else out[s.key] = el.value;
      }
      await PluginRuntime.setValues(pluginMeta.id, out);
      close();
      App.renderPluginList();
      App.flash(`Pengaturan plugin "${pluginMeta.name}" untuk project ini disimpan.`);
    });
    overlay.querySelector('.btn-plugin-settings-reset').addEventListener('click', async () => {
      if (!confirm('Reset pengaturan plugin di project ini ke nilai default?')) return;
      PluginRuntime.setValues(pluginMeta.id, {});
      close();
      App.renderPluginList();
      App.openPluginSettings(PluginRuntime.getMeta(pluginMeta.id) || pluginMeta);
    });

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  },

  async installPlugin(file) {
    await withProgress('Memasang plugin...', 'Membaca file...', async () => {
      try {
        const meta = await PluginRuntime.install(file);
        if (!meta) { Progress.hide(); return; }
        Progress.update('Memuat ulang daftar plugin...', 100);
        App.renderPluginList();
        if (els.shortcutModal.classList.contains('open')) App.renderShortcutList();
        App.flash(`Plugin "${meta.name}" v${meta.version} ${meta.enabled ? 'aktif' : 'terpasang (nonaktif)'}.`);
      } catch (e) {
        Progress.hide();
        setTimeout(() => alert('Gagal memasang plugin: ' + e.message), 10);
      }
    }, () => {});
  },

  async wipeAllData() {
    if (!confirm('Semua project dan data akan dihapus permanen. Lanjutkan?')) return;
    try { await Storage.wipe(); } catch {}
    try {
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch {}
    try {
      if (navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    } catch {}
    location.reload();
  },

  async loadDashboard() {
    const list = els.projectList;
    const content = list.parentElement;
    const countBadge = els.projectCount || document.getElementById('projectCount');

    if (App.dashboardObserver) { App.dashboardObserver.disconnect(); App.dashboardObserver = null; }
    App.dashboardSentinel = null;
    App.dashboardItems = [];
    App.dashboardAllItems = [];
    App.dashboardRendered = 0;
    list.innerHTML = '';

    try {
      const items = await Storage.list();
      App.dashboardAllItems = items;

      if (countBadge) {
        countBadge.textContent = items.length;
        countBadge.hidden = false;
      }
      const heroActions = document.querySelector('.hero .actions');
      if (heroActions) {
        heroActions.style.display = items.length ? '' : 'none';
      }
      if (!items.length) {
        content.classList.add('is-empty');
        list.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
            </div>
            <h3 class="empty-state-title">Belum ada project</h3>
            <p class="empty-state-desc">Mulai dengan membuat project baru, atau pulihkan dari file backup yang sudah ada.</p>
            <div class="empty-state-actions">
              <button type="button" class="btn btn-primary btn-sm" data-action="new">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                Buat Project
              </button>
              <button type="button" class="btn btn-ghost btn-sm" data-action="restore">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v5h-5"/></svg>
                Pulihkan Project
              </button>
            </div>
          </div>
        `;
        const newBtn = list.querySelector('.empty-state [data-action="new"]');
        const restoreBtn = list.querySelector('.empty-state [data-action="restore"]');
        if (newBtn) newBtn.addEventListener('click', () => document.getElementById('btnNewProject')?.click());
        if (restoreBtn) restoreBtn.addEventListener('click', () => document.getElementById('btnRestoreProject')?.click());
        return;
      }
      content.classList.remove('is-empty');
      App.renderDashboardItems();
    } catch {
      list.innerHTML = `<p class="hint" style="color:var(--danger);">Gagal akses storage.</p>`;
    }
  },

  renderDashboardItems() {
    const list = els.projectList;
    if (!list) return;
    if (App.dashboardObserver) { App.dashboardObserver.disconnect(); App.dashboardObserver = null; }
    App.dashboardSentinel = null;
    App.dashboardRendered = 0;
    list.innerHTML = '';

    const searchInput = els.projectSearch;
    const sortSelect = els.projectSort;
    const clearBtn = els.projectSearchClear;

    const query = (searchInput?.value || '').trim().toLowerCase();
    const sortMode = sortSelect?.value || 'newest';
    if (clearBtn) clearBtn.hidden = !query;

    let items = (App.dashboardAllItems || []).slice();

    if (query) {
      items = items.filter(p => (p.name || '').toLowerCase().includes(query));
    }

    items.sort((a, b) => {
      switch (sortMode) {
        case 'oldest':
          return (a.updatedAt || 0) - (b.updatedAt || 0);
        case 'name-asc':
          return (a.name || '').localeCompare(b.name || '', 'id');
        case 'name-desc':
          return (b.name || '').localeCompare(a.name || '', 'id');
        case 'progress-desc': {
          const pa = a.lineCount ? a.translatedCount / a.lineCount : 0;
          const pb = b.lineCount ? b.translatedCount / b.lineCount : 0;
          return pb - pa || (b.updatedAt || 0) - (a.updatedAt || 0);
        }
        case 'progress-asc': {
          const pa = a.lineCount ? a.translatedCount / a.lineCount : 0;
          const pb = b.lineCount ? b.translatedCount / b.lineCount : 0;
          return pa - pb || (b.updatedAt || 0) - (a.updatedAt || 0);
        }
        case 'newest':
        default:
          return (b.updatedAt || 0) - (a.updatedAt || 0);
      }
    });

    App.dashboardItems = items;

    if (!items.length) {
      list.innerHTML = `
        <div class="no-results">
          <div class="no-results-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          </div>
          <h3 class="no-results-title">Tidak ada project yang cocok</h3>
          <p class="no-results-desc">${query ? `Tidak ditemukan project dengan kata kunci "<strong>${escapeHtml(query)}</strong>". Coba kata kunci lain atau hapus filter pencarian.` : 'Tidak ada project untuk ditampilkan.'}</p>
        </div>
      `;
      return;
    }

    const sentinel = document.createElement('div');
    sentinel.className = 'dashboard-sentinel';
    list.appendChild(sentinel);
    App.dashboardSentinel = sentinel;

    App.dashboardObserver = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && App.dashboardRendered < App.dashboardItems.length) {
        App.renderDashboardPage();
      }
    }, { rootMargin: '300px' });
    App.dashboardObserver.observe(sentinel);

    App.renderDashboardPage();
  },

  renderDashboardPage() {
    const list = els.projectList;
    const sentinel = App.dashboardSentinel;
    if (!list || !sentinel) return;

    const start = App.dashboardRendered;
    const end = Math.min(start + DASHBOARD_PAGE_SIZE, App.dashboardItems.length);
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      frag.appendChild(App.buildProjectCard(App.dashboardItems[i]));
    }
    App.dashboardRendered = end;
    list.insertBefore(frag, sentinel);

    if (App.dashboardRendered >= App.dashboardItems.length) {
      App.dashboardObserver?.disconnect();
      App.dashboardObserver = null;
      sentinel.remove();
      App.dashboardSentinel = null;
    }
  },

  buildProjectCard(p) {
    const card = document.createElement('div');
    card.className = 'project-card';

    const hasData = p.fileCount || p.lineCount;
    let badge = '';
    let typeClass = '';
    if (hasData) {
      if (p.projectType === 'epub') {
        badge = '<span class="badge badge-epub">EPUB</span>';
        typeClass = 'is-epub';
      } else if (p.projectType === 'json') {
        badge = '<span class="badge badge-json">JSON-VNTP</span>';
        typeClass = 'is-json';
      } else if (p.projectType === 'plugin') {
        const pluginMissing = p.pluginId && !PluginRuntime.getMeta(p.pluginId);
        badge = pluginMissing
          ? `<span class="badge badge-plugin is-missing" title="Plugin ${escapeHtml(p.pluginName || p.pluginId)} tidak terpasang">BUTUH PLUGIN</span>`
          : '<span class="badge badge-plugin">PLUGIN</span>';
        typeClass = 'is-plugin';
      }
    }
    if (typeClass) card.classList.add(typeClass);

    const pct = p.lineCount ? Math.min(100, Math.floor(p.translatedCount / p.lineCount * 100)) : 0;
    const isComplete = pct >= 100 && p.lineCount > 0;
    const fillClass = isComplete ? 'project-progress-fill is-complete' : 'project-progress-fill';
    const updatedStr = new Date(p.updatedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    const updatedTime = new Date(p.updatedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

    card.innerHTML = `
      <div class="project-card-main">
        <div class="project-card-head">
          <h3>${escapeHtml(p.name)}</h3>
          ${badge}
        </div>
        ${p.lineCount > 0 ? `
        <div class="project-progress">
          <div class="project-progress-bar">
            <div class="${fillClass}" style="width:${pct}%"></div>
          </div>
          <div class="project-progress-text">
            <span>${p.translatedCount}/${p.lineCount} baris</span>
            <span class="pct">${pct}%</span>
          </div>
        </div>
        ` : ''}
        <div class="project-meta">
          <div class="project-meta-item">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>${updatedStr} · ${updatedTime}</span>
          </div>
          <div class="project-meta-item">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span>${p.fileCount} file</span>
          </div>
        </div>
      </div>
      <div class="project-actions">
        <button class="btn btn-primary btn-sm btn-open">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
          Buka Project
        </button>
        <div class="project-actions-row">
          <button class="btn btn-ghost btn-rename" title="Ubah Nama">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Ubah
          </button>
          <button class="btn btn-ghost btn-backup" title="Backup">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Backup
          </button>
          <button class="btn btn-ghost btn-delete" title="Hapus">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1.4 14.1A2 2 0 0 1 15.6 22H8.4a2 2 0 0 1-2-1.9L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
            Hapus
          </button>
        </div>
      </div>
    `;
    card.querySelector('.btn-open').addEventListener('click', async () => {
      try {
        const data = await Storage.load(p.id);
        if (data.projectType === 'plugin' && data.pluginId && !PluginRuntime.getMeta(data.pluginId)) {
          alert(`Project ini butuh plugin "${data.pluginName || data.pluginId}" agar bisa dibuka.\nPasang dulu plugin tersebut lewat Pengaturan → Buka Plugin Manager, lalu buka project ini lagi.`);
          return;
        }
        App.open(p.id, data);
      } catch (e) { alert('Gagal membuka project: ' + e.message); }
    });
    card.querySelector('.btn-rename').addEventListener('click', async () => {
      const name = prompt('Nama baru:', p.name);
      if (!name?.trim() || name === p.name) return;
      try {
        const data = await Storage.load(p.id);
        data.projectName = name.trim();
        await Storage.saveProject(p.id, data);
        App.loadDashboard();
      } catch (e) { alert('Gagal mengubah nama: ' + e.message); }
    });
    card.querySelector('.btn-backup').addEventListener('click', async () => {
      App.backup({ id: p.id, name: p.name });
    });
    card.querySelector('.btn-delete').addEventListener('click', async () => {
      if (!confirm('Hapus permanen?')) return;
      try {
        const data = await Storage.load(p.id);
        await Storage.remove(p.id, data.epubSourceId);
        App.loadDashboard();
      } catch (e) { alert('Gagal menghapus: ' + e.message); }
    });
    return card;
  },

  async backup(p) {
    await withProgress('Mem-backup project...', 'Membaca data...', async () => {
      Progress.determinate('Mem-backup project', 'Memproses...');
      const result = await buildBackup(p.id, p.name, Progress.update);
      download(URL.createObjectURL(result.blob), result.name);
    }, e => 'Gagal backup: ' + e.message);
  },

  async backupAll() {
    await withProgress('Mem-backup semua project...', 'Menghitung project...', async () => {
      Progress.determinate('Mem-backup semua project', 'Memulai...');
      const result = await backupAll(Progress.update);
      download(URL.createObjectURL(result.blob), result.name);
    }, e => e.message === 'Belum ada Project untuk di-backup.' ? e.message : 'Gagal backup semua project: ' + e.message);
  },

  async restoreProject(e) {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;
    const result = await withProgress('Memulihkan project...', 'Memuat arsip...', async () => {
      Progress.determinate('Memulihkan project', 'Membaca arsip...');
      const r = await parseRestore(await uploadedFile.arrayBuffer(), uploadedFile.name.replace(/\.cstl$/i, ''), Progress.update);
      await App.loadDashboard();
      return r;
    }, e => 'File korup: ' + e.message);
    if (result) {
      if (result.single) alert(`Project "${result.name}" dipulihkan!`);
      else alert(`${result.ok} project berhasil dipulihkan${result.fail ? `, ${result.fail} gagal` : ''}.`);
    }
    e.target.value = '';
  },

  refresh(keep = true) {
    State.updateCount();
    State.rebuild();
    App.main.setItems(State.rows, keep);
    App.updateFileBadge();
    App.updateButtons();
    App.syncBookmarkUI();
    if (State.namesDirty) { App.renderNames(); State.namesDirty = false; }
    App.updateStatusBar();
    els.btnUndo.disabled = !State.undo;
    els.btnRedo.disabled = !State.redo;
  },

  updateButtons() {
    const has = State.lines.length > 0;
    const sel = State.selected.size > 0;
    els.btnExport.disabled = !has;
    els.btnProofread.disabled = !has;
    els.btnSelectAll.disabled = !has;
    els.pasteArea.disabled = !has;
    els.btnApply.disabled = !has;
    els.rangeFromInput.disabled = !has;
    els.rangeToInput.disabled = !has;
    els.btnSelectRange.disabled = !has;
    els.btnClearSelection.disabled = !sel;
    els.btnCopyForAi.disabled = !sel;
    const n = State.selected.size;
    els.btnCopyForAi.textContent = n > 0 ? `Copy ${n} Baris` : 'Copy';
  },

  updateStatusBar() {
    const total = State.lines.length;
    const tl = State.translatedCount;
    const pct = total ? Math.floor((tl / total) * 100) : 0;
    els.progressText.textContent = `${tl}/${total} (${pct}%)`;
  },

  updateFileBadge() {
    const bar = els.stickyFileBar;
    const nameEl = els.stickyFileName;
    const rangeEl = els.stickyFileRange;
    const cb = els.stickyFileCheckbox;
    if (!bar || !nameEl || !App.main) return;

    const scrollTop = els.previewViewport.scrollTop;
    const headers = State.headerIdx;

    if (!headers.length) {
      bar.classList.remove('show');
      nameEl.textContent = '';
      rangeEl.textContent = '';
      cb.disabled = true;
      cb.checked = false;
      cb.indeterminate = false;
      delete cb.dataset.file;
      App.lastFile = null;
      App.fileCache = null;
      return;
    }

    let activeHeaderIdx = -1;
    let lo = 0, hi = headers.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const idx = headers[mid];
      const p = App.main.pos[idx];
      const h = App.main.heights[idx];
      if (p + h <= scrollTop) { activeHeaderIdx = idx; lo = mid + 1; }
      else hi = mid - 1;
    }
    const activeFile = activeHeaderIdx >= 0 ? State.rows[activeHeaderIdx].file : null;

    if (activeFile !== App.lastFile) {
      if (activeFile) {
        if (App.lastFile !== null) {
          bar.classList.add('swap');
          setTimeout(() => {
            App._applyFileBadgeContent(activeFile, nameEl, rangeEl, cb);
            bar.classList.remove('swap');
          }, 100);
        } else {
          App._applyFileBadgeContent(activeFile, nameEl, rangeEl, cb);
          bar.classList.add('show');
        }
      } else {
        nameEl.textContent = '';
        rangeEl.textContent = '';
        cb.disabled = true;
        cb.checked = false;
        cb.indeterminate = false;
        delete cb.dataset.file;
        bar.classList.remove('show');
      }
      App.lastFile = activeFile;
      App.fileCache = null;
    }

    if (activeFile) {
      const key = `${activeFile}:${State.selected.size}:${State.translatedCount}`;
      if (!App.fileCache || App.fileCache.key !== key) {
        App.fileCache = { key, ...App.computeFileCbState(activeFile) };
      }
      cb.disabled = App.fileCache.disabled;
      cb.checked = App.fileCache.checked;
      cb.indeterminate = App.fileCache.indeterminate;
    }
  },

  _applyFileBadgeContent(file, nameEl, rangeEl, cb) {
    nameEl.textContent = baseName(file);
    nameEl.title = file;
    const lines = State.fileLines.get(file) || [];
    rangeEl.textContent = lines.length ? `${lines[0].line_num}-${lines[lines.length - 1].line_num}` : '';
    cb.dataset.file = file;
  },

  toggleFileSelection(cb) {
    const file = cb.dataset.file;
    if (!file) return;
    const lines = State.fileLines.get(file) || [];
    lines.forEach(l => {
      if (isTrans(l)) return;
      if (cb.checked) State.selected.add(l.line_num);
      else State.selected.delete(l.line_num);
    });
    App.syncCheckboxes();
  },

  computeFileCbState(file) {
    const lines = State.fileLines.get(file) || [];
    let sel = 0, un = 0;
    lines.forEach(l => { if (!isTrans(l)) { un++; if (State.selected.has(l.line_num)) sel++; } });
    return {
      disabled: un === 0,
      checked: un > 0 && sel === un,
      indeterminate: sel > 0 && sel < un
    };
  },

  createMainRow() {
    const row = document.createElement('div');
    row.className = 'preview-row';
    const cell = document.createElement('div');
    cell.className = 'checkbox-cell';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    const content = document.createElement('div');
    content.className = 'text-content';
    const orig = document.createElement('div');
    orig.className = 'original';
    const trans = document.createElement('div');
    trans.className = 'translated';
    content.append(orig, trans);
    cell.append(cb, content);
    const hdr = document.createElement('div');
    hdr.className = 'file-header-inner';
    const hCb = document.createElement('input');
    hCb.type = 'checkbox';
    const hName = document.createElement('span');
    hName.className = 'file-name';
    const hRange = document.createElement('span');
    hRange.className = 'file-range';
    hdr.append(hCb, hName, hRange);
    const bm = document.createElement('button');
    bm.type = 'button';
    bm.className = 'row-bookmark-btn';
    bm.setAttribute('aria-label', 'Toggle bookmark');
    bm.tabIndex = -1;
    bm.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>';
    const imgBox = document.createElement('div');
    imgBox.className = 'row-image-box';
    const imgSpinner = document.createElement('div');
    imgSpinner.className = 'row-image-spinner';
    const imgEl = document.createElement('img');
    imgEl.className = 'row-image-el';
    imgEl.alt = '';
    const imgLabel = document.createElement('span');
    imgLabel.className = 'row-image-label';
    imgBox.append(imgSpinner, imgEl, imgLabel);
    imgEl.addEventListener('error', () => imgBox.classList.add('img-error'));
    row.append(cell, hdr, bm, imgBox);
    row._cell = cell; row._cb = cb; row._orig = orig; row._trans = trans;
    row._hdr = hdr; row._hCb = hCb; row._hName = hName; row._hRange = hRange;
    row._bm = bm;
    row._imgBox = imgBox; row._imgEl = imgEl; row._imgLabel = imgLabel; row._imgToken = 0;
    return row;
  },

  updateMainRow(row, data) {
    if (data.type === 'image') {
      row.className = 'preview-row row-image';
      row._cell.style.display = 'none';
      row._hdr.style.display = 'none';
      row._bm.style.display = 'none';
      row._imgBox.style.display = 'flex';
      row._imgBox.classList.remove('img-error');
      const entry = data.img;
      row._imgLabel.textContent = entry.isCover ? 'Sampul EPUB' : 'Gambar';
      row._imgEl.removeAttribute('src');
      row._imgEl.alt = entry.isCover ? 'Sampul EPUB' : 'Gambar dalam chapter';
      const token = ++row._imgToken;
      const cached = EpubImages.peekUrl(State.epubSourceId, entry.zipPath);
      if (cached !== undefined) {
        row._imgBox.classList.remove('img-loading');
        if (cached) row._imgEl.src = cached;
        else row._imgBox.classList.add('img-error');
      } else {
        row._imgBox.classList.add('img-loading');
        EpubImages.getUrl(State.epubSourceId, entry.zipPath).then(url => {
          if (row._imgToken !== token) return;
          row._imgBox.classList.remove('img-loading');
          if (url) row._imgEl.src = url;
          else row._imgBox.classList.add('img-error');
        });
      }
      return;
    }
    row._imgBox.style.display = 'none';
    if (data.type === 'header') {
      row.className = 'preview-row file-header';
      row._cell.style.display = 'none';
      row._hdr.style.display = 'flex';
      row._hName.textContent = baseName(data.file);
      row._hName.title = data.file;
      const lines = State.fileLines.get(data.file) || [];
      row._hRange.textContent = lines.length ? `${lines[0].line_num}-${lines[lines.length - 1].line_num}` : '';
      row._hCb.dataset.file = data.file;
      const st = App.computeFileCbState(data.file);
      row._hCb.disabled = st.disabled;
      row._hCb.checked = st.checked;
      row._hCb.indeterminate = st.indeterminate;
      row._bm.style.display = 'none';
    } else {
      const l = data.line;
      let cls = 'preview-row';
      if (isTrans(l)) cls += ' row-translated';
      if (State.selected.has(l.line_num)) cls += ' row-selected';
      if (State.bookmarks.includes(l.line_num)) cls += ' row-bookmarked';
      row.className = cls;
      row._cell.style.display = 'flex';
      row._hdr.style.display = 'none';
      row._cb.dataset.num = l.line_num;
      row._cb.checked = State.selected.has(l.line_num);
      row._cb.disabled = isTrans(l);
      row._orig.textContent = l.name ? `${l.line_num}. ${l.name}: ${l.message}` : `${l.line_num}. ${l.message}`;
      if (isTrans(l)) {
        row._trans.classList.remove('cell-muted');
        const n = l.trans_name || l.name;
        row._trans.textContent = n ? `${l.line_num}. ${n}: ${l.trans_message}` : `${l.line_num}. ${l.trans_message}`;
      } else {
        row._trans.classList.add('cell-muted');
        row._trans.textContent = '——';
      }
      row._bm.style.display = 'inline-flex';
      row._bm.dataset.num = l.line_num;
      const isBm = State.bookmarks.includes(l.line_num);
      row._bm.setAttribute('aria-pressed', isBm ? 'true' : 'false');
      row._bm.title = isBm ? 'Hapus bookmark' : 'Tambah bookmark';
    }
  },

  syncCheckboxes() {
    App.main.forceUpdate();
    App.updateFileBadge();
    App.updateButtons();
  },

  renderNames() {
    const set = new Set();
    for (const l of State.lines) if (l.name) set.add(l.name);
    const arr = Array.from(set).sort();
    els.nameTotalCount.textContent = arr.length;

    const hasNames = arr.length > 0;
    const gloss = App.buildGlossaryMap();
    const hasGloss = hasNames && arr.some(n => gloss.has(n));
    const hasMissing = hasNames && arr.some(n => !gloss.has(n));
    els.btnCopyAllNames.disabled = !hasNames;
    els.btnCopyNamesPlain.disabled = !hasNames;
    els.btnCopyNamesWithGlossary.disabled = !hasGloss;
    els.btnCopyNamesMissingGlossary.disabled = !hasMissing;

    const body = els.nameTableBody;
    body.replaceChildren();
    const frag = document.createDocumentFragment();
    for (const name of arr) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.className = 'mono';
      td.textContent = name;
      td.title = 'Klik untuk copy';
      tr.appendChild(td);
      frag.appendChild(tr);
    }
    body.appendChild(frag);
  },

  async copyAllNames(mode) {
    closeDropdowns();
    const names = new Set();
    for (const l of State.lines) if (l.name) names.add(l.name);
    const arr = Array.from(names).sort();
    if (!arr.length) return;
    const gloss = App.buildGlossaryMap();
    let lines, label;
    if (mode === 'plain') {
      lines = arr;
      label = `${arr.length} nama disalin!`;
    } else if (mode === 'glossary') {
      lines = arr.map(n => `${n}: ${gloss.get(n) || ''}`);
      label = `${arr.length} nama + glossary disalin!`;
    } else {
      const missing = arr.filter(n => !gloss.has(n));
      lines = missing.map(n => `${n}: `);
      label = `${missing.length} nama (belum di glossary) disalin!`;
    }
    if (!lines.length) { App.flash('Tidak ada nama yang cocok.'); return; }
    try { await clipboard(lines.join('\n')); App.flash(label); }
    catch { alert('Clipboard diblokir.'); }
  },

  selectRange() {
    const from = parseInt(els.rangeFromInput.value);
    const to = parseInt(els.rangeToInput.value);
    const max = State.lines.length ? State.lines.reduce((m, l) => Math.max(m, l.line_num), 0) : 0;
    if (isNaN(from) || isNaN(to) || from > to || from < 1 || from > max || to > max) return alert('Range tidak valid.');

    State.selected.clear();
    for (let n = from; n <= to; n++) {
      const l = State.byNum.get(n);
      if (l && !isTrans(l)) State.selected.add(n);
    }
    App.syncCheckboxes();

    const idx = State.rows.findIndex(r => r.type === 'line' && r.line.line_num === from);
    if (idx !== -1) { App.main.scrollToIndex(idx); App.flashRow(from, 50); }
  },

  buildGlossaryMap() {
    const map = new Map();
    if (State.vndbEnabled && State.vndbGlossary?.length) {
      State.vndbGlossary.forEach(e => map.set(e[0], e[1]));
    }
    return map;
  },

  formatLine(l) {
    return l.name ? `${l.line_num}. ${l.name}: ${l.message}` : `${l.line_num}. ${l.message}`;
  },

  async copyForAi() {
    const sel = State.lines.filter(l => State.selected.has(l.line_num));
    const parts = [];
    if (State.promptEnabled && State.prompt.trim()) parts.push(State.prompt.trim());
    parts.push(FIXED_FORMAT_PROMPT);

    const gloss = App.buildGlossaryMap();
    if (gloss.size > 0) {
      const lines = [];
      gloss.forEach((v, k) => lines.push(`${k}: ${v}`));
      parts.push(`VNDB Glossary:\n${lines.join('\n')}`);
    }
    if (State.customEnabled && State.customRaw.trim()) parts.push(`Custom Glossary:\n${State.customRaw.trim()}`);
    if (State.ringkasanEnabled) {
      if (State.ringkasan && State.ringkasan.trim()) parts.push(`Ringkasan Sebelumnya:\n${State.ringkasan.trim()}`);
      if (State.ringkasanPrompt && State.ringkasanPrompt.trim()) parts.push(State.ringkasanPrompt.trim());
    }
    parts.push(sel.map(App.formatLine).join('\n'));
    const text = await PluginRuntime.runCopyHook(parts.join('\n\n'));

    try {
      await clipboard(text);
      App.flash(`Disalin ${sel.length} baris.`);
      PluginRuntime.emit('copy', { count: sel.length, lines: sel.map(l => l.line_num) });
    } catch {
      els.pasteArea.value = text;
      alert("Clipboard diblokir. Teks dipindah ke kolom 'Paste hasil AI'.");
    }
  },

  parseAi(raw, byNum) {
    const fenceLines = raw.split(/\r?\n/).filter(l => /^\s*```\w*\s*$/.test(l));
    if (fenceLines.length !== 0 && fenceLines.length !== 2) {
      return { results: [], errors: ['Harus ada pembuka dan penutup ``` bersamaan, atau tidak ada sama sekali.'], seen: new Set(), ringkasan: null };
    }
    const text = raw.split(/\r?\n/).filter(l => !/^\s*```\w*\s*$/.test(l)).join('\n');
    const tagMatch = text.match(/<translate>([\s\S]*?)<\/translate>/i);
    if (!tagMatch) {
      return { results: [], errors: ['Tidak ditemukan tag <translate>...</translate>.'], seen: new Set(), ringkasan: null };
    }
    if ((text.match(/<translate>/gi) || []).length > 1) {
      return { results: [], errors: ['Ditemukan lebih dari satu tag <translate>...</translate>.'], seen: new Set(), ringkasan: null };
    }
    const before = text.slice(0, tagMatch.index).trim();
    const after = text.slice(tagMatch.index + tagMatch[0].length).trim();
    const ringkasan = [before, after].filter(Boolean).join('\n\n').trim() || null;
    const lines = tagMatch[1].split(/\r?\n/);

    const results = [];
    const errors = [];
    const seen = new Set();
    const re = /^(\d+)\.\s+(.*)$/;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const m = line.match(re);
      if (!m) { errors.push(`Baris ${i + 1}: Format tidak valid (harus "N. ...").`); continue; }
      const num = Number(m[1]);
      const rest = m[2].trim();
      if (!Number.isInteger(num) || num <= 0) { errors.push(`Baris ${i + 1}: ID tidak valid.`); continue; }
      if (seen.has(num)) { errors.push(`Baris ${num}: Duplikat ID.`); continue; }
      seen.add(num);

      const orig = byNum ? byNum.get(num) : null;
      let name = null, msg = rest;
      if (orig && orig.name) {
        const ci = rest.indexOf(': ');
        if (ci > 0) { name = rest.substring(0, ci).trim(); msg = rest.substring(ci + 2).trim(); }
        else if (rest.endsWith(':')) { name = rest.substring(0, rest.length - 1).trim(); msg = ''; }
      }
      results.push({ num, name, msg });
    }
    return { results, errors, seen, ringkasan };
  },

  async applyTranslation() {
    if (!State.lines.length) return;
    const raw = await PluginRuntime.runApplyHook(els.pasteArea.value.trim());
    if (!raw) return alert('Teks kosong.');

    const { results, errors, seen, ringkasan } = App.parseAi(raw, State.byNum);
    if (!results.length) {
      if (errors.length) return alert('DITOLAK:\n' + errors.slice(0, 10).join('\n') + (errors.length > 10 ? `\n+${errors.length - 10} error lainnya` : ''));
      return alert('Tidak ada data valid.');
    }

    if (results.length !== State.selected.size) errors.push(`Jumlah entry (${results.length}) ≠ jumlah centang (${State.selected.size}).`);
    State.selected.forEach(n => { if (!seen.has(n)) errors.push(`Baris ${n}: Dilewati AI.`); });
    seen.forEach(n => { if (!State.selected.has(n)) errors.push(`Baris ${n}: ID tidak dicentang.`); });

    const updates = [];
    results.forEach(r => {
      const l = State.byNum.get(r.num);
      if (!l) { errors.push(`Baris ${r.num}: ID tidak ada.`); return; }
      if (State.ignoreName && l.name) r.name = l.name;
      const hasOn = !!(l.name || '').trim();
      const hasTn = !!(r.name || '').trim();
      const hasMsg = !!(l.message || '').trim();
      if (hasOn && !hasTn) errors.push(`Baris ${r.num}: Nama dihapus AI.`);
      else if (!hasOn && hasTn) errors.push(`Baris ${r.num}: Narasi tapi ada nama.`);
      else if (!r.msg && hasMsg) errors.push(`Baris ${r.num}: Pesan kosong.`);
      else updates.push({ line: l, item: r });
    });

    if (errors.length) return alert('DITOLAK:\n' + errors.slice(0, 10).join('\n') + (errors.length > 10 ? `\n+${errors.length - 10} error lainnya` : ''));

    State.undo = snapshot();
    State.redo = null;
    updates.forEach(({ line, item }) => {
      line.trans_message = item.msg;
      line.is_translated = true;
      if (item.name) line.trans_name = State.ignoreName ? null : item.name;
      State.selected.delete(line.line_num);
    });

    if (State.ringkasanEnabled && ringkasan) State.ringkasan = ringkasan;

    els.pasteArea.value = '';
    State.namesDirty = true;
    App.refresh(true);
    State.queueSave();
    const nums = updates.map(u => u.line.line_num);
    const incMsg = App.applyIncrement(nums);
    App.flash(`${updates.length} baris sukses diterapkan.${incMsg || ''}`);
    PluginRuntime.emit('apply', { count: updates.length, lines: nums });
  },

  prefillIncrement() {
    const step = Math.max(1, Math.floor(Number(State.incrementStep) || 100));
    const max = State.lines.reduce((m, l) => Math.max(m, l.line_num), 0);
    if (!max) return;
    els.rangeFromInput.value = 1;
    els.rangeToInput.value = Math.min(step, max);
    App.selectRange();
  },

  applyIncrement(applied) {
    if (!State.incrementEnabled || !State.lines.length) return null;
    const step = Math.max(1, Math.floor(Number(State.incrementStep) || 100));
    const max = State.lines.reduce((m, l) => Math.max(m, l.line_num), 0);
    const pf = parseInt(els.rangeFromInput.value, 10);
    const pt = parseInt(els.rangeToInput.value, 10);
    const hasRange = Number.isFinite(pf) && Number.isFinite(pt) && pf >= 1 && pt >= pf;
    const base = hasRange ? pt : (applied.length ? Math.max(...applied) : 0);
    const from = base + 1;
    if (from > max) {
      els.rangeFromInput.value = '';
      els.rangeToInput.value = '';
      return ' Semua baris sudah tercakup.';
    }
    const to = Math.min(from + step - 1, max);
    els.rangeFromInput.value = from;
    els.rangeToInput.value = to;
    State.selected.clear();
    for (let n = from; n <= to; n++) {
      const l = State.byNum.get(n);
      if (l && !isTrans(l)) State.selected.add(n);
    }
    App.syncCheckboxes();
    const idx = State.rows.findIndex(r => r.type === 'line' && r.line.line_num === from);
    if (idx !== -1) { App.main.scrollToIndex(idx); App.flashRow(from, 60); }
    return ` Rentang berikutnya ${from}-${to} dipilih.`;
  },

  undo() {
    if (!State.undo) return;
    State.redo = snapshot();
    State.lines = State.undo.lines.map(normalizeLine);
    State.selected = new Set(State.undo.selected);
    State.undo = null;
    State.namesDirty = true;
    App.refresh(true);
    State.queueSave();
  },

  redo() {
    if (!State.redo) return;
    State.undo = snapshot();
    State.lines = State.redo.lines.map(normalizeLine);
    State.selected = new Set(State.redo.selected);
    State.redo = null;
    State.namesDirty = true;
    App.refresh(true);
    State.queueSave();
  },

  openLineEditor(num) {
    const l = State.byNum.get(num);
    if (!l) return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount) sel.removeAllRanges();
    App.activeLine = num;
    els.lineEditorTitle.textContent = `Edit Baris ${num}`;
    els.lineOriginalView.value = l.name ? `${l.name}: ${l.message}` : l.message;
    els.lineNameWrap.style.display = l.name ? 'block' : 'none';
    els.lineNameInput.value = l.name ? (l.trans_name || '') : '';
    if (l.name) els.lineNameInput.placeholder = l.name;
    els.lineMessageInput.value = (l.trans_message || '').trim();
    els.lineTranslatedCheck.checked = isTrans(l);
    toggleModal(els.lineEditorModal, true);
  },

  saveLineEditor() {
    const l = State.byNum.get(App.activeLine);
    if (!l) return;
    const msg = els.lineMessageInput.value.trim().replace(/\r?\n/g, '\\n');
    const hasMsg = !!(l.message || '').trim();
    if (els.lineTranslatedCheck.checked && !msg && hasMsg) return alert('Pesan kosong.');

    State.undo = snapshot();
    l.trans_message = msg || null;
    l.is_translated = els.lineTranslatedCheck.checked && (!!msg || !hasMsg);
    if (l.name) l.trans_name = els.lineNameInput.value.trim().replace(/\r?\n/g, '\\n') || null;

    State.redo = null;
    State.namesDirty = true;
    toggleModal(els.lineEditorModal, false);
    App.refresh(true);
    if (els.proofreadModal.classList.contains('open')) App.renderProofread();
    State.queueSave();
  },

  highlight(text, re) {
    if (!re) return document.createTextNode(text);
    const frag = document.createDocumentFragment();
    let last = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.substring(last, m.index)));
      const mark = document.createElement('mark');
      mark.className = 'highlight';
      mark.textContent = m[0];
      frag.appendChild(mark);
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.substring(last)));
    return frag;
  },

  syncProofread() {
    PROOFREAD_FIELDS.forEach(({ id, key, type }) => {
      State[key] = type === 'check' ? els[id].checked : els[id].value;
    });
    if (State.projectId) State.queueSave();
  },

  openProofread() {
    PROOFREAD_FIELDS.forEach(({ id, key, type }) => {
      const el = els[id];
      if (type === 'check') el.checked = State[key]; else el.value = State[key];
    });
    toggleModal(els.proofreadModal, true);
    setTimeout(() => App.renderProofread(), 340);
  },

  renderProofread() {
    if (!els.proofreadModal.classList.contains('open')) return;
    const q = els.proofreadSearchInput.value;
    const regex = els.proofreadRegexCheck.checked;
    const exact = els.proofreadExactCheck.checked;
    const caseSensitive = els.proofreadCaseCheck.checked;
    const translatedOnly = els.proofreadTranslatedOnlyCheck.checked;
    const scope = els.proofreadScope.value;

    App.highlightRe = q ? buildRe(q, regex, exact, caseSensitive) : null;

    const matches = proofreadSearch(State.lines, q, regex, exact, caseSensitive, scope, translatedOnly);
    els.proofreadStatus.textContent = `Ditemukan ${matches.length} baris.`;
    const changed = q !== App.lastQuery;
    App.lastQuery = q;
    App.pr.setItems(matches, !changed);
  },

  createPrRow() {
    const row = document.createElement('div');
    row.className = 'preview-row';
    const wrap = document.createElement('div');
    wrap.className = 'text-content';
    const meta = document.createElement('div');
    meta.className = 'file-meta';
    const orig = document.createElement('div');
    orig.className = 'original';
    const trans = document.createElement('div');
    trans.className = 'translated';
    wrap.append(meta, orig, trans);
    row.append(wrap);
    row._wrap = wrap; row._meta = meta; row._orig = orig; row._trans = trans;
    return row;
  },

  updatePrRow(row, d) {
    row._wrap.dataset.num = d.num;
    row._meta.textContent = `File: ${d.file} | Baris: ${d.num}`;
    row._orig.replaceChildren();
    row._trans.replaceChildren();

    const onlyTrans = els.proofreadTranslatedOnlyCheck.checked;
    const scope = els.proofreadScope.value;

    const build = (name, msg, hl) => {
      const frag = document.createDocumentFragment();
      if (name) {
        if (hl && (scope === 'all' || scope === 'name')) frag.appendChild(App.highlight(name, App.highlightRe));
        else frag.appendChild(document.createTextNode(name));
        frag.appendChild(document.createTextNode(': '));
      }
      if (hl && (scope === 'all' || scope === 'message')) frag.appendChild(App.highlight(msg, App.highlightRe));
      else frag.appendChild(document.createTextNode(msg));
      return frag;
    };

    row._trans.classList.toggle('cell-muted', !d.isTrans);

    if (onlyTrans) {
      row._orig.textContent = d.origName ? `${d.origName}: ${d.origMsg}` : d.origMsg;
      if (d.isTrans) row._trans.appendChild(build(d.transName, d.transMsg, true));
      else row._trans.textContent = '——';
    } else {
      row._orig.appendChild(build(d.origName, d.origMsg, true));
      if (d.isTrans) row._trans.textContent = d.transName ? `${d.transName}: ${d.transMsg}` : d.transMsg;
      else row._trans.textContent = '——';
    }
  },

  replaceAll() {
    const q = els.proofreadSearchInput.value;
    const repl = els.proofreadReplaceInput.value;
    if (!q) return alert('Pencarian kosong!');

    const regex = els.proofreadRegexCheck.checked;
    const exact = els.proofreadExactCheck.checked;
    const caseSensitive = els.proofreadCaseCheck.checked;
    const translatedOnly = els.proofreadTranslatedOnlyCheck.checked;
    const scope = els.proofreadScope.value;

    const result = replaceAll(State.lines, q, repl, regex, exact, caseSensitive, scope, translatedOnly);

    if (!result.count) return alert('Tidak ada yang cocok.');

    State.undo = snapshot();
    State.redo = null;
    const modMap = new Map(result.modified.map(m => [m.line_num, m]));
    for (const l of State.lines) {
      const m = modMap.get(l.line_num);
      if (m) {
        if (m.message !== undefined) l.message = m.message;
        if (m.trans_message !== undefined) l.trans_message = m.trans_message;
        if (m.name !== undefined) l.name = m.name;
        if (m.trans_name !== undefined) l.trans_name = m.trans_name;
      }
    }
    State.namesDirty = true;
    App.refresh(true);
    App.renderProofread();
    State.queueSave();
    alert(`Berhasil replace ${result.count} baris.`);
  }
};

document.addEventListener('DOMContentLoaded', App.init);

})();
