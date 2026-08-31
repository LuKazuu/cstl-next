(() => {
'use strict';

const VERSION = 1;
const INDEX_FILE = '_index.json';
const PLUGIN_INDEX_FILE = '_plugin_index.json';
const PLUGIN_PREFIX = 'plugin_';
const BLOBS_DIR = '_blobs';
const JSZIP_URL = './jszip.min.js';
const PLUGIN_SETTINGS_FILE = '_plugin_settings.json';
const SHORTCUTS_FILE = '_shortcuts.json';
const DEFAULT_PROMPT = `Translate entire text to Native English. Euphemism prohibited. Onomatopoeia must be English-based. Result must be inside codeblock. Keep line numbering and format (like code in the middle of the text) intact.`;
const DEFAULT_RINGKASAN_PROMPT = `Outside the <translate> and </translate> tags (placed above or below the translated lines), include updated summary of the characters and overall story so far. Any characters and story need to be preserved even though they don't appear again for context.`;
const FIXED_FORMAT_PROMPT = `Format:\n<translate>\ntext\n</translate>`;
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
const { escapeHtml, humanBytes, validBlobKey, sanitizeName, stripNewlines } = CSTL.util;
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
const countFiles = files => (Array.isArray(files) ? files : []).length;
const isTrans = l => !!l.is_translated;
const makeProjId = () => 'proj_' + Date.now() + '.cstl';
const makeEpubId = () => 'epub_' + Date.now() + '.epub';
const schemaDefault = f => (f.def && typeof f.def === 'object') ? structuredClone(f.def) : f.def;
const snapshot = () => ({ lines: structuredClone(State.lines), selected: new Set(State.selected) });
const jsZipReady = () => typeof JSZip !== 'undefined';
const assertJsZip = () => { if (!jsZipReady()) throw new Error('JSZip tidak tersedia.'); };
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
    els.copyStatus.classList.add('empty');
    const msg = err?.storage ? err.message : (failMsg ? failMsg(err) : err.message);
    setTimeout(() => alert(msg), 10);
    if (err?.storage) App.loadDashboard();
    return undefined;
  }
  return result;
}

function isStorageError(e) {
  const n = e?.name;
  return n === 'NotFoundError' || n === 'SecurityError' || n === 'NotReadableError' ||
    n === 'InvalidStateError' || n === 'InvalidModificationError' ||
    n === 'NoModificationAllowedError' || n === 'DataError';
}

function storageFailure(e, noun) {
  const err = new Error();
  err.storage = true;
  const n = e?.name;
  if (n === 'NotFoundError') {
    err.message = (noun ? 'File ' + noun : 'Data') + ' tidak ditemukan di penyimpanan — mungkin sudah dihapus atau data situs dibersihkan. Daftar akan dimuat ulang.';
  } else if (n === 'NoModificationAllowedError') {
    err.message = 'File sedang dipakai proses lain — tunggu sebentar lalu coba lagi.';
  } else {
    err.message = 'Penyimpanan tidak dapat diakses saat ini. Tutup lalu buka kembali aplikasi, lalu coba lagi.';
  }
  return err;
}

function friendlyError(e, prefix) {
  if (e?.storage) return e.message;
  if (isStorageError(e)) return storageFailure(e).message;
  return prefix + (e?.message || e);
}

const Storage = {
  _rootPromise: null,
  root() {
    if (!this._rootPromise) {
      this._rootPromise = Promise.resolve().then(() => navigator.storage.getDirectory());
      this._rootPromise.catch(() => { Storage._rootPromise = null; });
    }
    return this._rootPromise;
  },
  invalidateRoot() {
    const p = Storage._rootPromise;
    Storage._rootPromise = null;
    if (p) p.catch(() => {});
  },
  async _withRootRetry(fn, noun) {
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) Storage.invalidateRoot();
      let root;
      try { root = await Storage.root(); }
      catch (e) {
        lastErr = e;
        if (!isStorageError(e)) throw e;
        continue;
      }
      try { return await fn(root); }
      catch (e) {
        lastErr = e;
        if (!isStorageError(e)) throw e;
      }
    }
    throw storageFailure(lastErr, noun);
  },
  async probe() {
    try {
      const root = await Storage.root();
      await root.entries().next();
      return true;
    } catch {
      Storage.invalidateRoot();
      return false;
    }
  },
  _queue: Promise.resolve(),
  _queued(fn) {
    const run = Storage._queue.then(fn, fn);
    Storage._queue = run.then(() => {}, () => {});
    return run;
  },
  async _writeFile(root, name, content) {
    const rand = Math.random().toString(36).slice(2, 8);
    const tmpName = '.' + String(name).slice(0, 240) + '.' + rand + '.tmp';
    let tmpHandle = null;
    let w = null;
    try {
      tmpHandle = await root.getFileHandle(tmpName, { create: true });
      w = await tmpHandle.createWritable();
      await w.write(content);
      await w.close();
      w = null;
      let moved = false;
      if (typeof tmpHandle.move === 'function') {
        try { await tmpHandle.move(name); moved = true; } catch {}
      }
      if (!moved) {
        const finalHandle = await root.getFileHandle(name, { create: true });
        const w2 = await finalHandle.createWritable();
        try {
          await w2.write(content);
          await w2.close();
        } catch (e) {
          try { await w2.abort(); } catch {}
          throw e;
        }
      }
      App.ensureSW();
    } catch (e) {
      if (w) { try { await w.abort(); } catch {} }
      if (e && /quota/i.test(String(e.name || e.message || ''))) {
        throw new Error('Penyimpanan browser penuh saat menyimpan file — bersihkan file yang tidak perlu lalu coba lagi.');
      }
      throw e;
    } finally {
      if (tmpHandle) { try { await root.removeEntry(tmpName); } catch {} }
    }
  },
  atomicWrite(name, content) {
    return Storage._queued(() => Storage._withRootRetry(root => Storage._writeFile(root, name, content)));
  },
  async _readIndexFrom(root) {
    try {
      const f = await (await root.getFileHandle(INDEX_FILE)).getFile();
      return JSON.parse(await f.text());
    } catch { return null; }
  },
  readIndex() {
    return Storage._withRootRetry(root => Storage._readIndexFrom(root));
  },
  upsertIndex(meta) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const items = (await Storage._readIndexFrom(root)) || [];
      const i = items.findIndex(p => p.id === meta.id);
      if (i >= 0) items[i] = meta; else items.push(meta);
      items.sort((a, b) => b.updatedAt - a.updatedAt);
      await Storage._writeFile(root, INDEX_FILE, JSON.stringify(items));
    }));
  },
  async saveProject(id, data, counts) {
    if (!data.updatedAt) data.updatedAt = Date.now();
    await Storage.atomicWrite(id, JSON.stringify(data));
    const meta = Storage.indexEntry(id, data);
    if (counts) Object.assign(meta, {
      fileCount: counts.fileCount ?? meta.fileCount,
      lineCount: counts.lineCount ?? meta.lineCount,
      translatedCount: counts.translatedCount ?? meta.translatedCount
    });
    await Storage.upsertIndex(meta);
  },
  async _readFileJson(root, name) {
    const f = await (await root.getFileHandle(name)).getFile();
    return JSON.parse(await f.text());
  },
  async load(id) {
    try {
      return await Storage._withRootRetry(root => Storage._readFileJson(root, id), 'project');
    } catch (e) {
      if (e instanceof SyntaxError) throw new Error('File project rusak atau tidak valid — tidak bisa dibuka.');
      throw e;
    }
  },
  async remove(id, epubId) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      if (epubId) {
        try { await root.removeEntry(epubId); }
        catch (e) { if (e?.name !== 'NotFoundError') throw e; }
      }
      await Storage._removeBlobs(root, id);
      try { await root.removeEntry(id); }
      catch (e) { if (e?.name !== 'NotFoundError') throw e; }
      const items = (await Storage._readIndexFrom(root)) || [];
      await Storage._writeFile(root, INDEX_FILE, JSON.stringify(items.filter(p => p.id !== id)));
    }));
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
      fileCount: countFiles(data.imported_files),
      lineCount: data.lines?.length || 0,
      translatedCount: data.lines?.reduce((n, l) => n + (l.is_translated ? 1 : 0), 0) || 0
    };
  },
  reconcileIndex(items) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const saved = Array.isArray(items) ? items : [];
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
      if (changed) await Storage._writeFile(root, INDEX_FILE, JSON.stringify(found));
      return found;
    }));
  },
  async _readFileBuffer(root, name) {
    const f = await (await root.getFileHandle(name)).getFile();
    return await f.arrayBuffer();
  },
  async loadEpubBuffer(epubId) {
    return Storage._withRootRetry(root => Storage._readFileBuffer(root, epubId), 'EPUB');
  },
  async saveEpub(epubId, buffer) {
    await Storage.atomicWrite(epubId, buffer);
  },
  async _blobProjectDir(root, projectId, create) {
    const top = await root.getDirectoryHandle(BLOBS_DIR, { create });
    return await top.getDirectoryHandle(projectId, { create });
  },
  async saveBlob(projectId, pluginId, key, data) {
    if (!validBlobKey(key)) throw new Error('Key blob tidak valid.');
    let blob;
    if (data instanceof Blob) blob = data;
    else if (data instanceof ArrayBuffer || data instanceof Uint8Array) blob = new Blob([data], { type: 'application/octet-stream' });
    else if (typeof data === 'string') blob = new Blob([data], { type: 'text/plain' });
    else throw new Error('Data blob tidak valid (harus Blob / ArrayBuffer / Uint8Array / string).');
    await Storage._queued(() => Storage._withRootRetry(async root => {
      const projDir = await Storage._blobProjectDir(root, projectId, true);
      const pluginDir = await projDir.getDirectoryHandle(pluginId, { create: true });
      await Storage._writeFile(pluginDir, key, blob);
    }));
  },
  async loadBlob(projectId, pluginId, key) {
    if (!validBlobKey(key)) return null;
    try {
      return await Storage._withRootRetry(async root => {
        const projDir = await Storage._blobProjectDir(root, projectId, false);
        const pluginDir = await projDir.getDirectoryHandle(pluginId);
        const fh = await pluginDir.getFileHandle(key);
        return await fh.getFile();
      });
    } catch { return null; }
  },
  async deleteBlob(projectId, pluginId, key) {
    if (!validBlobKey(key)) return;
    await Storage._queued(async () => {
      try {
        await Storage._withRootRetry(async root => {
          const projDir = await Storage._blobProjectDir(root, projectId, false);
          const pluginDir = await projDir.getDirectoryHandle(pluginId);
          await pluginDir.removeEntry(key);
        });
      } catch {}
    });
  },
  async listBlobs(projectId, pluginId) {
    try {
      return await Storage._withRootRetry(async root => {
        const projDir = await Storage._blobProjectDir(root, projectId, false);
        const pluginDir = await projDir.getDirectoryHandle(pluginId);
        const keys = [];
        for await (const [name, h] of pluginDir.entries()) {
          if (h.kind !== 'file') continue;
          if (name.startsWith('.') && name.endsWith('.tmp')) continue;
          keys.push(name);
        }
        return keys;
      });
    } catch { return []; }
  },
  async listAllBlobs(projectId) {
    try {
      return await Storage._withRootRetry(async root => {
        const projDir = await Storage._blobProjectDir(root, projectId, false);
        const out = [];
        for await (const [pid, ph] of projDir.entries()) {
          if (ph.kind !== 'directory') continue;
          for await (const [name, fh] of ph.entries()) {
            if (fh.kind !== 'file') continue;
            if (name.startsWith('.') && name.endsWith('.tmp')) continue;
            out.push({ pluginId: pid, key: name, handle: fh });
          }
        }
        return out;
      });
    } catch { return []; }
  },
  async blobExists(projectId, pluginId, key) {
    if (!validBlobKey(key)) return false;
    try {
      await Storage._withRootRetry(async root => {
        const projDir = await Storage._blobProjectDir(root, projectId, false);
        const pluginDir = await projDir.getDirectoryHandle(pluginId);
        await pluginDir.getFileHandle(key);
      });
      return true;
    } catch { return false; }
  },
  async _removeBlobs(root, projectId) {
    try {
      const top = await root.getDirectoryHandle(BLOBS_DIR);
      await top.removeEntry(projectId, { recursive: true });
    } catch {}
  },
  async readPluginIndex() {
    let text;
    try {
      text = await Storage._withRootRetry(async root => {
        const f = await (await root.getFileHandle(PLUGIN_INDEX_FILE)).getFile();
        return await f.text();
      });
    } catch { return []; }
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  },
  async writePluginIndex(items) {
    await Storage.atomicWrite(PLUGIN_INDEX_FILE, JSON.stringify(items));
  },
  async readJsonFile(name) {
    try {
      return await Storage._withRootRetry(root => Storage._readFileJson(root, name));
    } catch { return null; }
  },
  writeJsonFile(name, value) {
    return Storage._queued(() => Storage._withRootRetry(root => Storage._writeFile(root, name, JSON.stringify(value))));
  },
  removeFile(name) {
    return Storage._queued(async () => {
      try {
        await Storage._withRootRetry(async root => { await root.removeEntry(name); });
      } catch {}
    });
  },
  async savePluginZipStream(id, blob) {
    const name = PLUGIN_PREFIX + id + '.zip';
    const est = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => null) : null;
    if (est && est.quota && blob.size > est.quota - (est.usage || 0)) {
      const free = est.quota - (est.usage || 0);
      const mb = n => (n / (1024 * 1024)).toFixed(0) + ' MB';
      throw new Error(`Penyimpanan browser tidak cukup (sisa ${mb(free)}, paket ${mb(blob.size)}). Bersihkan file yang tidak perlu lalu coba lagi.`);
    }
    await Storage.atomicWrite(name, blob);
  },
  async pluginZipFile(id) {
    return Storage._withRootRetry(async root => await (await root.getFileHandle(PLUGIN_PREFIX + id + '.zip')).getFile(), 'paket plugin');
  },
  async pluginZipExists(id) {
    try {
      await Storage._withRootRetry(async root => { await root.getFileHandle(PLUGIN_PREFIX + id + '.zip'); });
      return true;
    } catch { return false; }
  },
  async listPluginFiles() {
    try {
      return await Storage._withRootRetry(async root => {
        const out = [];
        for await (const [name, h] of root.entries()) {
          if (h.kind !== 'file' || !name.startsWith(PLUGIN_PREFIX) || !name.endsWith('.zip')) continue;
          out.push({ id: name.slice(PLUGIN_PREFIX.length, -4), name });
        }
        return out;
      });
    } catch { return []; }
  },
  removePluginFile(id) {
    return Storage._queued(async () => {
      try {
        await Storage._withRootRetry(async root => {
          try { await root.removeEntry(PLUGIN_PREFIX + id + '.zip'); }
          catch (e) { if (e?.name !== 'NotFoundError') throw e; }
        });
      } catch {}
    });
  },
  async wipe(onProgress) {
    await Storage._queued(() => Storage._withRootRetry(async root => {
      const names = [];
      for await (const [name] of root.entries()) names.push(name);
      let done = 0;
      for (const name of names) {
        try { await root.removeEntry(name, { recursive: true }); } catch {}
        done++;
        if (onProgress) { try { onProgress(done, names.length); } catch {} }
      }
    }));
  },
  async sweepTemp() {
    const stale = Date.now() - 3600000;
    const sweepDir = async dir => {
      const staleNames = [];
      for await (const [name, h] of dir.entries()) {
        if (h.kind !== 'file' || !name.startsWith('.') || !name.endsWith('.tmp')) continue;
        try {
          const f = await h.getFile();
          if (f.lastModified < stale) staleNames.push(name);
        } catch {}
      }
      for (const name of staleNames) {
        try { await dir.removeEntry(name); } catch {}
      }
    };
    const sweepTree = async dir => {
      await sweepDir(dir);
      for await (const [name, h] of dir.entries()) {
        if (h.kind !== 'directory') continue;
        await sweepTree(h);
      }
    };
    try { await Storage._withRootRetry(root => sweepTree(root)); } catch {}
  }
};

const OpfsExplorer = {
  path: [],
  classify(name, isDir) {
    if (isDir) return 'folder';
    if (name === INDEX_FILE || name === PLUGIN_INDEX_FILE) return 'index';
    if (name === PLUGIN_SETTINGS_FILE || name === SHORTCUTS_FILE) return 'data';
    if (name.startsWith(PLUGIN_PREFIX) && name.endsWith('.zip')) return 'plugin';
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
      data: 'Data',
      tmp: 'Tmp',
      other: 'File'
    })[kind] || 'File';
  },
  kindIconSvg(kind, isDir) {
    const SVG = (path) => '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>';
    const M = {
      folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
      project: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/>',
      epub: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
      plugin: '<path d="M5 5h4.5a2.5 2.5 0 1 1 5 0H19v4.5a2.5 2.5 0 1 1 0 5V19h-4.5a2.5 2.5 0 1 0-5 0H5v-4.5a2.5 2.5 0 1 0 0-5z"/>',
      index: '<path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>',
      data: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
      tmp: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
      other: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>'
    };
    return SVG(M[isDir ? 'folder' : kind] || M.other);
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
    els.opfsLoading.hidden = !show;
  },
  _showEmpty(show) {
    if (show) {
      els.opfsEmptyText.textContent = this.path.length ? 'Folder ini kosong.' : 'Belum ada file di OPFS.';
    }
    els.opfsEmpty.hidden = !show;
  },
  _renderCrumbs() {
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
      if (e?.name === 'NotFoundError') {
        this.path = [];
        els.opfsCrumbs.hidden = true;
      }
      const notice = document.createElement('div');
      notice.className = 'opfs-error';
      notice.style.color = 'var(--danger)';
      const msg = document.createElement('div');
      msg.textContent = e?.name === 'NotFoundError'
        ? 'Folder tidak ditemukan — mungkin sudah dihapus. Kembali ke OPFS root.'
        : friendlyError(e, 'Gagal memuat daftar file: ');
      notice.appendChild(msg);
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'btn btn-ghost btn-xs';
      retryBtn.style.marginTop = '8px';
      retryBtn.textContent = 'Coba Lagi';
      retryBtn.addEventListener('click', () => OpfsExplorer.refresh());
      notice.appendChild(retryBtn);
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
    const sizeLabel = item.isDir ? (item.count + ' item') : humanBytes(item.size);
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
      alert(friendlyError(e, 'Gagal mengunduh "' + name + '": '));
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
    const warning = name === PLUGIN_INDEX_FILE
      ? 'Ini adalah daftar plugin terpasang. Semua plugin akan dihapus dari aplikasi saat dibuka kembali.'
      : warnings[kind] || warnings.other;
    if (!confirm(`Hapus "${name}" dari OPFS?\n\n${warning}\n\nTindakan ini tidak dapat dibatalkan.`)) return;
    try {
      const dir = await this.dirHandle(this.path);
      await dir.removeEntry(name, { recursive: !!isDir });
      const row = els.opfsList.querySelector(`.opfs-item[data-name="${CSS.escape(name)}"]`);
      if (row) row.remove();
      if (!els.opfsList.children.length) {
        this._showEmpty(true);
      }
      if (kind === 'plugin' && name !== PLUGIN_INDEX_FILE) await CSTL.plugins.sync();
      if (kind === 'plugin' || kind === 'project' || kind === 'index') App.loadDashboard();
    } catch (e) {
      alert(friendlyError(e, 'Gagal menghapus "' + name + '": '));
      if (e?.storage) this.refresh();
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
  let skipped = 0;
  let n = start;
  for (const e of arr) {
    if (!e || typeof e !== 'object' || !Object.hasOwn(e, 'message')) { skipped++; continue; }
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
  return { lines: out, skipped };
}

async function parseFilesList(files, existing, start, onProgress, label = 'file') {
  existing = new Set(existing || []);
  const imported = [];
  const skipped = [];
  let invalidEntries = 0;
  let cur = start;
  const sorted = files.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i];
    const bn = baseName(f.name);
    if (existing.has(bn)) { skipped.push(bn); continue; }
    const arr = JSON.parse(decodeBuffer(f.buffer));
    const parsed = parseJsonArray(arr, bn, cur);
    if (parsed.lines.length) { existing.add(bn); imported.push(...parsed.lines); cur += parsed.lines.length; }
    invalidEntries += parsed.skipped;
    onProgress(`${i + 1} / ${sorted.length} ${label}`, ((i + 1) / sorted.length) * 100);
    if (i % 50 === 0) await yieldToEvent();
  }
  return { imported, skipped, invalidEntries, nextStart: cur, existing: Array.from(existing) };
}

async function parseZipJson(buffer, existing, start, onProgress) {
  assertJsZip();
  const zip = new JSZip();
  await zip.loadAsync(buffer);
  const files = [];
  for (const name of Object.keys(zip.files).filter(n => n.endsWith('.json'))) {
    files.push({ name, buffer: await zip.file(name).async('uint8array') });
  }
  return parseFilesList(files, existing, start, onProgress);
}

async function parseEpub(buffer, tags, existing, start, epubId, onProgress) {
  assertJsZip();
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
  assertJsZip();
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
  assertJsZip();
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
  assertJsZip();
  const data = await Storage.load(id);
  let epubBuffer = null;
  let epubMissing = false;
  if (data.projectType === 'epub' && data.epubSourceId) {
    try { epubBuffer = await Storage.loadEpubBuffer(data.epubSourceId); }
    catch { epubMissing = true; }
  }
  const zip = new JSZip();
  buildProjectZipInner(zip, data);
  if (epubBuffer) zip.file(data.epubSourceId, epubBuffer);
  const blobs = await Storage.listAllBlobs(id);
  let blobsMissing = 0;
  for (const b of blobs) {
    try { zip.file(`${BLOBS_DIR}/${b.pluginId}/${b.key}`, await b.handle.getFile()); }
    catch { blobsMissing++; }
  }
  onProgress('Mengompres backup...', 90);
  const blob = await compressZip(zip, 'application/octet-stream');
  const warnings = [];
  if (epubMissing) warnings.push('EPUB sumber tidak ikut di-backup (mungkin sudah hilang).');
  if (blobsMissing) warnings.push(`${blobsMissing} blob plugin gagal dibaca dan tidak ikut.`);
  return { blob, name: `${sanitizeName(name)}_backup.cstl`, warnings };
}

async function backupAll(onProgress) {
  assertJsZip();
  const items = await Storage.list();
  if (!items.length) throw new Error('Belum ada Project untuk di-backup.');
  const total = items.length;
  const outer = new JSZip();
  const used = new Set();
  const warnings = [];
  onProgress(`0 / ${total} project`, 0);
  for (let i = 0; i < total; i++) {
    onProgress(`Memproses ${i + 1} / ${total} project`, (i / total) * 95);
    const data = await Storage.load(items[i].id);
    const zip = new JSZip();
    buildProjectZipInner(zip, data);
    if (data.projectType === 'epub' && data.epubSourceId) {
      try { zip.file(data.epubSourceId, await Storage.loadEpubBuffer(data.epubSourceId)); }
      catch { warnings.push(`${data.projectName}: EPUB sumber tidak ikut.`); }
    }
    const blobs = await Storage.listAllBlobs(items[i].id);
    for (const b of blobs) {
      try { zip.file(`${BLOBS_DIR}/${b.pluginId}/${b.key}`, await b.handle.getFile()); }
      catch { warnings.push(`${data.projectName}: blob ${b.pluginId}/${b.key} tidak ikut.`); }
    }
    const blob = await compressZip(zip, '', 9);
    const base = sanitizeName(data.projectName);
    let nm = base, k = 2;
    while (used.has(nm)) nm = `${base}_${k++}`;
    used.add(nm);
    outer.file(`${nm}_backup.cstl`, blob);
    onProgress(`${i + 1} / ${total} project selesai`, ((i + 1) / total) * 95);
    await yieldToEvent();
  }
  onProgress('Mengompres arsip utama...', 98);
  const blob = await compressZip(outer, 'application/octet-stream');
  return { blob, name: `ProjectBackupAll_${new Date().toISOString().slice(0, 10)}.cstl`, warnings };
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
      const newId = makeEpubId();
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
    pluginName: meta.pluginName || CSTL.plugins.getMeta(meta.pluginId)?.name || null,
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
    images: Array.isArray(meta.images) ? meta.images : [],
    updatedAt: meta.updatedAt || null
  });
  await restoreBlobsFromZip(zip, id);
  return name;
}

async function restoreBlobsFromZip(zip, projectId) {
  const prefix = BLOBS_DIR + '/';
  let restored = 0, failed = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !entry.name.startsWith(prefix)) continue;
    const path = entry.name.slice(prefix.length);
    const slash = path.indexOf('/');
    if (slash < 0) continue;
    const pluginId = path.slice(0, slash);
    const key = path.slice(slash + 1);
    if (!pluginId || /[\\\/]/.test(pluginId) || !validBlobKey(key)) continue;
    try { await Storage.saveBlob(projectId, pluginId, key, await entry.async('blob')); restored++; }
    catch { failed++; }
  }
  return { restored, failed };
}

async function parseRestore(buffer, fallbackName, onProgress) {
  assertJsZip();
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
  const errors = [];
  let ok = 0;
  for (let i = 0; i < totalEntries; i++) {
    const entry = entries[i];
    try {
      const inner = new JSZip();
      await inner.loadAsync(await entry.async('blob'));
      await restoreOne(inner, entry.name.replace(/\.cstl$/i, ''));
      ok++;
    } catch (e) {
      errors.push({ name: entry.name, message: e?.message || String(e) });
    }
    onProgress(`${i + 1} / ${totalEntries} project`, ((i + 1) / totalEntries) * 100);
    await yieldToEvent();
  }
  return { single: false, ok, fail: errors.length, errors };
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
  { id: 'dash.search', label: 'Fokus Cari Project', scope: 'dashboard', def: '/', run: () => els.projectSearch.focus() },
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
  _bindings: {},

  async init() {
    Shortcuts._actions = SHORTCUT_ACTIONS.slice();
    document.addEventListener('keydown', e => Shortcuts._onKey(e));
    const raw = await Storage.readJsonFile(SHORTCUTS_FILE);
    const b = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    for (const k of Object.keys(b)) {
      if (typeof b[k] === 'string' && b[k]) Shortcuts._bindings[k] = b[k];
    }
    Shortcuts.rebuild();
  },

  allActions() { return Shortcuts._actions.concat(Shortcuts._pluginActions); },

  loadBindings() { return Shortcuts._bindings; },

  saveBindings(b) {
    Shortcuts._bindings = (b && typeof b === 'object' && !Array.isArray(b)) ? b : {};
    if (Object.keys(Shortcuts._bindings).length) {
      Storage.writeJsonFile(SHORTCUTS_FILE, Shortcuts._bindings).catch(() => {});
    } else {
      Storage.removeFile(SHORTCUTS_FILE).catch(() => {});
    }
  },

  resetBindings() {
    Shortcuts._bindings = {};
    Storage.removeFile(SHORTCUTS_FILE).catch(() => {});
    Shortcuts.rebuild();
  },

  bindingFor(action) {
    const b = Shortcuts._bindings;
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
    Shortcuts._pluginActions = CSTL.plugins.commands().map(c => ({
      id: c.id,
      label: `${c.pluginName}: ${c.label}`,
      scope: 'always',
      def: '',
      run: () => CSTL.plugins.runCommand(c.id)
    }));
    Shortcuts.rebuild();
    if (els.shortcutModal.classList.contains('open')) App.renderShortcutList();
  },

  _onKey(e) {
    if (e.isComposing || e.keyCode === 229) return;
    if (Shortcuts._recording) return;
    if (anyModalOpen()) return;
    if (els.busyOverlay.classList.contains('open')) return;
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
    'projectCount', 'projectSearch', 'projectSearchClear', 'projectSort', 'projectSortBox', 'projectSortTrigger', 'projectSortMenu', 'projectSortLabel',
    'btnNewProject', 'btnRestoreProject', 'btnDashboardSettings', 'btnDashboardSettingsClose',
    'btnBackupAll', 'btnWipeAllData',
    'btnBackToDashboard', 'projectNameDisplay', 'dynamicToolbarWrap',
    'workspaceToolbar', 'btnToggleHeader', 'btnShowHeader',
    'btnImportMain', 'importDropdown',
    'btnImportFile', 'btnImportFolder', 'btnImportZip',
    'importFileInput', 'importFolderInput', 'importZipInput', 'restoreProjectInput',
    'btnExport', 'btnProofread', 'btnGlossary', 'btnContext', 'btnSettings',
    'previewViewport', 'previewContainer', 'stickyFileBar', 'stickyFileName', 'stickyFileRange', 'stickyFileCheckbox',
    'progressText',
    'rangeFromInput', 'rangeToInput', 'btnSelectRange', 'btnClearSelection', 'btnSelectAll', 'btnCopyForAi',
    'copyStatus', 'pasteArea', 'btnUndo', 'btnApply', 'btnRedo',
    'nameTotalCount', 'nameTableBody',
    'btnCopyAllNames', 'copyNamesDropdown',
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
    'btnOpenPlugins', 'pluginMenu',
    'opfsExplorerModal', 'btnOpfsExplorerOpen', 'btnOpfsExplorerClose',
    'opfsList', 'opfsEmpty', 'opfsEmptyText', 'opfsCrumbs', 'opfsLoading', 'btnOpfsRefresh',
    'busyOverlay', 'busyTitle', 'busyMsg', 'busyBarFill',
    'btnBookmarks', 'bookmarkPanel',
    'bookmarkPanelCount', 'bookmarkList', 'btnBookmarkClear'
  ];
  for (const id of ids) els[id] = $(id);
  els.split = document.querySelector('.split');
  els.heroActions = document.querySelector('.hero .actions');
}

const Progress = {
  _open(title, msg, determinate) {
    els.busyTitle.textContent = title;
    els.busyMsg.textContent = msg;
    els.busyBarFill.classList.toggle('determinate', determinate);
    els.busyBarFill.style.width = determinate ? '0%' : '';
    els.busyOverlay.classList.add('open');
  },
  show(title, msg = '') { Progress._open(title, msg, false); },
  determinate(title, msg = '') { Progress._open(title, msg, true); },
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
  bookmarkSet: new Set(),
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

State.maxLineNum = () => State.lines.reduce((m, l) => Math.max(m, l.line_num), 0);
State.nextLineNum = () => State.lines.length ? State.maxLineNum() + 1 : 1;
State.indexOfLine = num => State.rows.findIndex(r => r.type === 'line' && r.line.line_num === num);

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
  State.bookmarkSet = new Set(State.bookmarks);
};

State.queueSave = () => {
  if (!State.projectId) return;
  clearTimeout(State.saveTimer);
  State.saveTimer = setTimeout(() => {
    const idle = window.requestIdleCallback || (fn => setTimeout(fn, 0));
    idle(async () => {
      if (!State.projectId) return;
      try {
        await Storage.saveProject(State.projectId, State.toData(), {
          fileCount: countFiles(State.files),
          lineCount: State.lines.length,
          translatedCount: State.translatedCount
        });
        App.flashSaved();
      } catch (e) {
        if (e?.storage) { App.flash('Gagal menyimpan: ' + e.message, true); }
        else { console.error('[autosave]', e); }
      }
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
  const trigger = els[DROPDOWNS.find(d => d.panel === panelId).trigger];
  const dropdown = els[panelId];
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
  for (const { panel } of DROPDOWNS) els[panel].classList.remove('show');
}

function toggleModal(el, show) {
  el.classList.toggle('open', !!show);
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
    const meta = CSTL.plugins.resolveByExtension(first.name) || CSTL.plugins.resolveByMagic(await readHead(first));
    if (!meta) throw new Error(`Tidak ada plugin aktif yang menangani file "${first.name}".`);
    if (!Importer.assertPluginProjectType(meta)) return null;
    const settings = CSTL.plugins.valuesFor(meta);
    const startNum = State.nextLineNum();
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
        out = await CSTL.plugins.callExtract(meta, { fileName: f.name, buffer, settings });
      } catch (e) {
        throw new Error(`Plugin "${meta.name}" gagal parse ${bn}: ${e.message}`);
      }
      const lines = CSTL.plugins.normalizePluginLines(out.lines, cur);
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
      const startNum = State.nextLineNum();
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
          const byExt = CSTL.plugins.resolveByExtension(f.name);
          if (byExt) { pluginMatch = pluginMatch || byExt; continue; }
          const head = await readHead(f);
          const byMagic = CSTL.plugins.resolveByMagic(head);
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
        const invalidNote = result.invalidEntries ? ` (${result.invalidEntries} entri tanpa \`message\` diabaikan)` : '';
        const skipNote = result.skipped.length ? ` (${result.skipped.length} file duplikat diabaikan)` : '';
        App.flash(`Berhasil impor ${result.imported.length} baris.${skipNote}${invalidNote}`);
        CSTL.plugins.emit('import', { lineCount: result.imported.length, fileCount: (result.existing || existing).length });
      } else if (result.skipped.length) {
        els.copyStatus.classList.add('empty');
        setTimeout(() => alert(`Gagal impor: File duplikat.\n- ${result.skipped.slice(0, 5).join('\n- ')}`), 10);
      } else if (result.invalidEntries) {
        els.copyStatus.classList.add('empty');
        setTimeout(() => alert(`Tidak ada baris valid yang dapat diimpor. ${result.invalidEntries} entri tidak memiliki field "message".`), 10);
      } else {
        App.flash('Tidak ada data valid.', false);
      }
    }, e => e?.storage ? e.message : `Error:\n${e?.message || e}`);
  }
};

const Exporter = {
  async runEpub() {
    await withProgress('Membuat EPUB...', 'Memuat arsip...', async () => {
      Progress.determinate('Membuat EPUB', `0 file`);
      const result = await buildExportEpub(State.epubSourceId, State.lines, State.epubTags || 'p', State.projectName, Progress.update);
      download(URL.createObjectURL(result.blob), result.name);
      App.flash('Ekspor EPUB berhasil!');
      CSTL.plugins.emit('export', { filename: result.name });
    }, e => 'Ekspor EPUB gagal: ' + e.message);
  },

  async runJson() {
    await withProgress('Membuat JSON...', 'Mengelompokkan baris...', async () => {
      Progress.determinate('Membuat JSON', `0 file`);
      const result = await buildExportJson(State.lines, State.projectName, Progress.update);
      download(URL.createObjectURL(result.blob), result.name);
      App.flash('Ekspor JSON berhasil!');
      CSTL.plugins.emit('export', { filename: result.name });
    }, e => 'Ekspor JSON gagal: ' + e.message);
  },

  async runPlugin() {
    await withProgress('Membuat file via plugin...', 'Memuat plugin...', async () => {
      const meta = CSTL.plugins.getMeta(State.pluginId);
      if (!meta) throw new Error('Plugin untuk project ini tidak lagi terpasang. Project tidak bisa diekspor.');
      if (!meta.enabled) throw new Error('Plugin ini dinonaktifkan. Aktifkan di Plugin Manager terlebih dahulu.');
      const lines = State.lines.map(CSTL.plugins.toPluginLine);
      const pluginData = (State.pluginData && typeof State.pluginData === 'object') ? State.pluginData : {};
      const settings = CSTL.plugins.valuesFor(meta);
      Progress.determinate('Plugin: Membuat output', `0 file`);
      const out = await CSTL.plugins.callPack(meta, {
        lines,
        sourceMap: pluginData,
        projectName: State.projectName || 'untitled',
        settings
      });
      const filename = out.filename || (sanitizeName(State.projectName) + '_tl' + (meta.extensions[0] || '.bin'));
      download(URL.createObjectURL(out.blob), filename);
      App.flash('Ekspor plugin berhasil!');
      CSTL.plugins.emit('export', { filename });
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
  dashboardAllItems: [],
  dashboardRendered: 0,
  dashboardObserver: null,
  dashboardSentinel: null,
  dashboardFailed: false,
  swRegistered: false,
  storageCheckBusy: false,
  storageWatchTimer: null,
  healScheduled: false,
  _storageCheckCount: 0,
  _storageCriticalShown: false,

  flash(msg, keep = false) {
    const el = els.copyStatus;
    el.textContent = msg;
    el.classList.remove('empty');
    const t = ++App.toastToken;
    if (!keep) setTimeout(() => { if (App.toastToken === t) el.classList.add('empty'); }, TOAST_TIMEOUT_MS);
  },

  flashSaved() {
    const bar = els.progressText;
    if (!bar || !State.projectId) return;
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

    window.addEventListener('error', e => {
      console.error('[global error]', e.error || e.message);
    });
    window.addEventListener('unhandledrejection', e => {
      const reason = e.reason;
      const msg = reason?.storage ? reason.message : (reason?.message || String(reason));
      console.error('[unhandled rejection]', reason);
      if (reason?.storage) App.flash('Gagal: ' + msg, true);
    });

    Storage.sweepTemp();
    await App.ensurePersisted();

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
    await Shortcuts.init();
    CSTL.plugins.attach(PluginHost);
    await CSTL.plugins.init();
    App.syncImportAccept();
    await App.loadDashboard();
    App.startStorageWatch();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') App.checkStorageAlive();
    });
    window.addEventListener('focus', () => App.checkStorageAlive());
    window.addEventListener('pageshow', e => {
      if (e.persisted) App.checkStorageAlive();
    });
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

    let searchTimer = null;
    els.projectSearch.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => App.renderDashboardItems(), 180);
    });
    els.projectSearchClear.addEventListener('click', () => {
      els.projectSearch.value = '';
      els.projectSearch.focus();
      App.renderDashboardItems();
    });

    App.bindSortDropdown();

    els.btnDashboardSettings.addEventListener('click', () => {
      toggleModal(els.dashboardSettingsModal, true);
    });
    els.btnDashboardSettingsClose.addEventListener('click', () => toggleModal(els.dashboardSettingsModal, false));
    els.btnShortcutsOpen.addEventListener('click', () => {
      App.renderShortcutList();
      toggleModal(els.shortcutModal, true);
    });
    els.btnShortcutsClose.addEventListener('click', () => toggleModal(els.shortcutModal, false));
    els.btnShortcutsResetAll.addEventListener('click', () => {
      if (!confirm('Reset semua shortcut ke default?')) return;
      Shortcuts.resetBindings();
      App.renderShortcutList();
    });
    els.btnBackupAll.addEventListener('click', App.backupAll);
    els.btnWipeAllData.addEventListener('click', App.wipeAllData);

    els.btnOpfsExplorerOpen.addEventListener('click', () => {
      toggleModal(els.opfsExplorerModal, true);
      OpfsExplorer.path = [];
      OpfsExplorer.refresh();
    });
    els.btnOpfsExplorerClose.addEventListener('click', () => {
      toggleModal(els.opfsExplorerModal, false);
      App.loadDashboard();
    });
    els.btnOpfsRefresh.addEventListener('click', () => OpfsExplorer.refresh());
    els.opfsList.addEventListener('click', e => OpfsExplorer.handleClick(e));

  },

  bindSortDropdown() {
    const box = els.projectSortBox;
    const trigger = els.projectSortTrigger;
    const menu = els.projectSortMenu;
    const label = els.projectSortLabel;
    const hidden = els.projectSort;

    const labelMap = {};
    menu.querySelectorAll('.sort-menu-item').forEach(item => {
      labelMap[item.dataset.value] = item.querySelector('.sort-menu-text').textContent;
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
    els.btnSettingsIncrementReset.addEventListener('click', () => {
      els.settingsIncrementCheck.checked = false;
      els.settingsIncrementStepInput.value = 100;
      els.incrementStepWrap.classList.add('section-disabled');
    });
    els.settingsIncrementCheck.addEventListener('change', e => {
      els.incrementStepWrap.classList.toggle('section-disabled', !e.target.checked);
    });
    els.btnSettingsCancel.addEventListener('click', () => toggleModal(els.settingsModal, false));
    els.btnSettingsSave.addEventListener('click', () => {
      const prevIncrementEnabled = State.incrementEnabled;
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
        const hasRange = from >= 1 && to >= from;
        const justEnabled = !prevIncrementEnabled && State.incrementEnabled;
        if (!hasRange || justEnabled) App.prefillIncrement();
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
        App.scrollToLine(n);
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
      App.scrollToLine(n);
      App.toggleBookmarkPanel(false);
    });

    els.btnBookmarkClear.addEventListener('click', () => {
      if (!State.bookmarks.length) return;
      if (!confirm('Hapus semua bookmark?')) return;
      State.bookmarks = [];
      State.bookmarkSet = new Set();
      App.syncBookmarkUI();
      App.main.forceUpdate();
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

    window.addEventListener('blur', () => App.toggleBookmarkPanel(false));
  },

  toggleBookmarkPanel(show) {
    els.bookmarkPanel.classList.toggle('show', show);
    els.btnBookmarks.classList.toggle('active', show);
    els.btnBookmarks.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) App.renderBookmarkList();
  },

  toggleBookmark(num, force) {
    if (!num) return;
    const has = State.bookmarkSet.has(num);
    const next = force === undefined ? !has : force;
    if (next && !has) { State.bookmarks.push(num); State.bookmarkSet.add(num); }
    else if (!next && has) {
      const idx = State.bookmarks.indexOf(num);
      State.bookmarks.splice(idx, 1);
      State.bookmarkSet.delete(num);
    }
    else return;
    App.syncBookmarkUI();
    App.main.forceUpdate();
    if (els.bookmarkPanel.classList.contains('show')) App.renderBookmarkList();
    State.queueSave();
  },

  syncBookmarkUI() {
    const count = State.bookmarks.length;
    els.bookmarkPanelCount.textContent = `(${count})`;
    els.btnBookmarks.disabled = !State.lines.length;
    els.btnBookmarkClear.disabled = count === 0;
  },

  renderBookmarkList() {
    const list = els.bookmarkList;
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

  scrollToLine(num) {
    const idx = State.indexOfLine(num);
    if (idx !== -1) App.main.scrollToIndex(idx);
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
      const data = State.toData();
      await Storage.saveProject(id, data);
      App.open(id, data);
    } catch (e) {
      alert(friendlyError(e, 'Gagal membuat project: '));
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

    Storage.upsertIndex(Storage.indexEntry(id, data, Date.now())).catch(() => {});
    if (data.projectType === 'epub' && data.epubSourceId) EpubImages.preload(data.epubSourceId);

    if (App.dashboardObserver) { App.dashboardObserver.disconnect(); App.dashboardObserver = null; }
    App.stopStorageWatch();

    els.projectNameDisplay.textContent = State.projectName;
    els.dashboardView.classList.remove('open');
    els.workspaceView.hidden = false;
    CSTL.plugins.onProjectOpened();
    App.applyHideTools();
    App.refresh(false);
    App.syncBookmarkUI();
    App.toggleBookmarkPanel(false);
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
          alert(friendlyError(e, 'Gagal menyimpan perubahan terakhir: '));
          App.finishClose();
        });
    } else App.finishClose();
  },

  finishClose() {
    CSTL.plugins.onProjectClosed();
    EpubImages.clear();
    State.resetTransient();
    App.syncImportAccept();
    App.main.setItems([], false);
    App.pr.setItems([], false);
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
    els.stickyFileBar.classList.remove('show');
    els.stickyFileCheckbox.checked = false;
    els.stickyFileCheckbox.disabled = true;
    delete els.stickyFileCheckbox.dataset.file;
    App.lastFile = null;
    App.fileCache = null;
    App.toggleBookmarkPanel(false);
    els.bookmarkList.replaceChildren();
    App.syncBookmarkUI();
    els.workspaceView.hidden = true;
    els.split.classList.remove('hide-tools');
    els.workspaceToolbar.classList.remove('hidden');
    els.btnShowHeader.classList.remove('visible');
    els.dashboardView.classList.add('open');
    App.startStorageWatch();
    App.loadDashboard();
  },

  applyHideTools() {
    els.split.classList.toggle('hide-tools', State.hideTools);
    requestAnimationFrame(() => App.main.forceUpdate());
  },

  syncImportAccept() {
    const info = CSTL.plugins.activeParserInfo();
    const accept = info.magic ? '' : Array.from(info.extensions).join(',');
    els.importFileInput.accept = accept;
    els.importFolderInput.accept = accept;
  },

  renderShortcutList() {
    const wrap = els.shortcutList;
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

  async wipeAllData() {
    if (!confirm('Semua project dan data akan dihapus permanen. Lanjutkan?')) return;
    if (State.saveTimer) {
      clearTimeout(State.saveTimer);
      State.saveTimer = null;
    }
    State.projectId = null;
    Progress.determinate('Menghapus semua data...', 'Menyiapkan...');
    try {
      await Storage.wipe((done, total) => {
        Progress.update(total ? `Menghapus item ${done}/${total}...` : 'Menghapus...', total ? Math.round(done / total * 100) : 100);
      });
    } catch {}
    try { if (window.caches) for (const k of await caches.keys()) await caches.delete(k); } catch {}
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.();
      for (const r of regs || []) await r.unregister();
    } catch {}
    Progress.hide();
    location.reload();
  },

  ensureSW() {
    if (App.swRegistered || !('serviceWorker' in navigator)) return;
    App.swRegistered = true;
    navigator.serviceWorker.register('./sw.js').catch(() => { App.swRegistered = false; });
  },

  checkStorageAlive() {
    if (!els.dashboardView.classList.contains('open')) return;
    if (App.storageCheckBusy) return;
    App.storageCheckBusy = true;
    const done = () => { App.storageCheckBusy = false; };
    if (App.dashboardFailed) {
      Promise.resolve(App.loadDashboard()).then(done, done);
      return;
    }
    Storage.probe()
      .then(ok => { if (!ok) return App.loadDashboard(); })
      .catch(() => {})
      .then(() => App.maybePersistAndCheckQuota())
      .then(done, done);
  },

  async maybePersistAndCheckQuota() {
    await App.ensurePersisted();
    App._storageCheckCount++;
    if (App._storageCheckCount % 8 !== 0) return;
    if (!navigator.storage?.estimate) return;
    let est;
    try { est = await navigator.storage.estimate(); } catch { return; }
    if (!est || !est.quota) return;
    const free = (est.quota || 0) - (est.usage || 0);
    const freeMb = free / (1024 * 1024);
    if (freeMb < 10 && !App._storageCriticalShown) {
      App._storageCriticalShown = true;
      App.flash(`Penyimpanan kritis (${freeMb.toFixed(0)} MB bebas). Sebagian tulisan mungkin gagal tersimpan — ekspor project sebagai cadangan.`);
    } else if (freeMb > 80) {
      App._storageCriticalShown = false;
    }
  },

  ensurePersisted() {
    if (!navigator.storage?.persist) return Promise.resolve();
    return navigator.storage.persisted?.().then(already => already ? null : navigator.storage.persist().catch(() => {})).catch(() => {});
  },

  startStorageWatch() {
    App.stopStorageWatch();
    App.storageWatchTimer = setInterval(() => {
      if (document.hidden) return;
      App.checkStorageAlive();
    }, 4000);
  },

  stopStorageWatch() {
    clearInterval(App.storageWatchTimer);
    App.storageWatchTimer = null;
  },

  scheduleStorageHeal() {
    if (App.healScheduled) return;
    App.healScheduled = true;
    Storage.probe().then(ok => {
      if (ok) return;
      if (/[?&]heal=1/.test(location.search)) return;
      history.replaceState(null, '', location.pathname + (location.search || '') + (location.search ? '&' : '?') + 'heal=1');
      setTimeout(() => location.reload(), 800);
    }).catch(() => {});
  },

  async loadDashboard() {
    const list = els.projectList;
    const content = list.parentElement;
    const countBadge = els.projectCount;

    if (App.dashboardObserver) { App.dashboardObserver.disconnect(); App.dashboardObserver = null; }
    App.dashboardSentinel = null;
    App.dashboardItems = [];
    App.dashboardAllItems = [];
    App.dashboardRendered = 0;
    list.innerHTML = '';

    try {
      const items = await Storage.list();
      App.dashboardFailed = false;
      App.healScheduled = false;
      if (location.search) history.replaceState(null, '', location.pathname);
      App.dashboardAllItems = items;

      countBadge.textContent = items.length;
      countBadge.hidden = false;
      els.heroActions.style.display = items.length ? '' : 'none';
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
        list.querySelector('.empty-state [data-action="new"]').addEventListener('click', () => els.btnNewProject.click());
        list.querySelector('.empty-state [data-action="restore"]').addEventListener('click', () => els.btnRestoreProject.click());
        return;
      }
      content.classList.remove('is-empty');
      App.renderDashboardItems();
    } catch {
      App.dashboardFailed = true;
      Storage.invalidateRoot();
      App.scheduleStorageHeal();
      countBadge.hidden = true;
      content.classList.remove('is-empty');
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="var(--danger)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <h3 class="empty-state-title">Gagal mengakses storage</h3>
          <p class="empty-state-desc">Browser menolak akses penyimpanan, biasanya karena data situs baru saja dibersihkan. Daftar akan dicoba muat ulang otomatis; jika tetap gagal, tutup lalu buka kembali aplikasinya.</p>
        </div>
      `;
    }
  },

  renderDashboardItems() {
    const list = els.projectList;
    if (App.dashboardObserver) { App.dashboardObserver.disconnect(); App.dashboardObserver = null; }
    App.dashboardSentinel = null;
    App.dashboardRendered = 0;
    list.innerHTML = '';

    const searchInput = els.projectSearch;
    const sortSelect = els.projectSort;
    const clearBtn = els.projectSearchClear;

    const query = (searchInput.value || '').trim().toLowerCase();
    const sortMode = sortSelect.value || 'newest';
    clearBtn.hidden = !query;

    let items = App.dashboardAllItems.slice();

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
    if (!sentinel) return;

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
        const pluginMissing = p.pluginId && !CSTL.plugins.getMeta(p.pluginId);
        badge = pluginMissing
          ? `<span class="badge badge-plugin is-missing" title="Plugin ${escapeHtml(p.pluginName || p.pluginId)} tidak terpasang">BUTUH PLUGIN</span>`
          : '<span class="badge badge-plugin">PLUGIN</span>';
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
        if (data.projectType === 'plugin' && data.pluginId && !CSTL.plugins.getMeta(data.pluginId)) {
          alert(`Project ini butuh plugin "${data.pluginName || data.pluginId}" agar bisa dibuka.\nPasang dulu plugin tersebut lewat Pengaturan → Buka Plugin Manager, lalu buka project ini lagi.`);
          return;
        }
        App.open(p.id, data);
      } catch (e) {
        alert(friendlyError(e, 'Gagal membuka project: '));
        if (e?.storage) App.loadDashboard();
      }
    });
    card.querySelector('.btn-rename').addEventListener('click', async () => {
      const name = prompt('Nama baru:', p.name);
      if (!name?.trim() || name === p.name) return;
      try {
        const data = await Storage.load(p.id);
        data.projectName = name.trim();
        await Storage.saveProject(p.id, data);
        App.loadDashboard();
      } catch (e) {
        alert(friendlyError(e, 'Gagal mengubah nama: '));
        if (e?.storage) App.loadDashboard();
      }
    });
    card.querySelector('.btn-backup').addEventListener('click', async () => {
      App.backup({ id: p.id, name: p.name });
    });
    card.querySelector('.btn-delete').addEventListener('click', async () => {
      if (!confirm('Hapus permanen?')) return;
      let epubId = null;
      try { epubId = (await Storage.load(p.id)).epubSourceId || null; } catch {}
      try {
        await Storage.remove(p.id, epubId);
        App.loadDashboard();
      } catch (e) {
        alert(friendlyError(e, 'Gagal menghapus: '));
        if (e?.storage) App.loadDashboard();
      }
    });
    return card;
  },

  async backup(p) {
    const result = await withProgress('Mem-backup project...', 'Membaca data...', async () => {
      Progress.determinate('Mem-backup project', 'Memproses...');
      const r = await buildBackup(p.id, p.name, Progress.update);
      download(URL.createObjectURL(r.blob), r.name);
      return r;
    }, e => friendlyError(e, 'Gagal backup: '));
    if (result?.warnings?.length) {
      setTimeout(() => alert('Backup selesai dengan catatan:\n- ' + result.warnings.join('\n- ')), 50);
    }
  },

  async backupAll() {
    const result = await withProgress('Mem-backup semua project...', 'Menghitung project...', async () => {
      Progress.determinate('Mem-backup semua project', 'Memulai...');
      const r = await backupAll(Progress.update);
      download(URL.createObjectURL(r.blob), r.name);
      return r;
    }, e => e.message === 'Belum ada Project untuk di-backup.' ? e.message : friendlyError(e, 'Gagal backup semua project: '));
    if (result?.warnings?.length) {
      setTimeout(() => alert('Backup selesai dengan catatan:\n- ' + result.warnings.join('\n- ')), 50);
    }
  },

  async restoreProject(e) {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;
    const result = await withProgress('Memulihkan project...', 'Memuat arsip...', async () => {
      Progress.determinate('Memulihkan project', 'Membaca arsip...');
      const r = await parseRestore(await uploadedFile.arrayBuffer(), uploadedFile.name.replace(/\.cstl$/i, ''), Progress.update);
      await App.loadDashboard();
      return r;
    }, e => friendlyError(e, 'File korup: '));
    if (result) {
      if (result.single) alert(`Project "${result.name}" dipulihkan!`);
      else {
        const failMsg = result.fail
          ? `, ${result.fail} gagal:\n- ${result.errors.slice(0, 5).map(e => `${e.name}: ${e.message}`).join('\n- ')}`
          : '';
        alert(`${result.ok} project berhasil dipulihkan${failMsg}.`);
      }
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
    [els.btnExport, els.btnProofread, els.btnSelectAll, els.pasteArea, els.btnApply, els.rangeFromInput, els.rangeToInput, els.btnSelectRange].forEach(b => { b.disabled = !has; });
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
        App._applyFileBadgeContent(activeFile, nameEl, rangeEl, cb);
        bar.classList.add('show');
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
      if (State.bookmarkSet.has(l.line_num)) cls += ' row-bookmarked';
      row.className = cls;
      row._cell.style.display = 'flex';
      row._hdr.style.display = 'none';
      row._cb.dataset.num = l.line_num;
      row._cb.checked = State.selected.has(l.line_num);
      row._cb.disabled = isTrans(l);
      row._orig.textContent = App.formatLine(l);
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
      const isBm = State.bookmarkSet.has(l.line_num);
      row._bm.setAttribute('aria-pressed', isBm ? 'true' : 'false');
      row._bm.title = isBm ? 'Hapus bookmark' : 'Tambah bookmark';
    }
  },

  syncCheckboxes() {
    App.main.forceUpdate();
    App.updateFileBadge();
    App.updateButtons();
  },

  uniqueNames() {
    const set = new Set();
    for (const l of State.lines) if (l.name) set.add(l.name);
    return Array.from(set).sort();
  },

  renderNames() {
    const arr = App.uniqueNames();
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
    const arr = App.uniqueNames();
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
    const max = State.lines.length ? State.maxLineNum() : 0;
    if (isNaN(from) || isNaN(to) || from > to || from < 1 || from > max || to > max) return alert('Range tidak valid.');

    State.selected.clear();
    for (let n = from; n <= to; n++) {
      const l = State.byNum.get(n);
      if (l && !isTrans(l)) State.selected.add(n);
    }
    App.syncCheckboxes();
    App.scrollToLine(from);
  },

  buildGlossaryMap() {
    const map = new Map();
    if (State.vndbEnabled && State.vndbGlossary?.length) {
      State.vndbGlossary.forEach(e => map.set(e[0], e[1]));
    }
    return map;
  },

  formatLine(l) {
    const name = (!State.ignoreName && l.name) ? `${l.name}: ` : '';
    return `${l.line_num}. ${name}${l.message}`;
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
    const text = await CSTL.plugins.runCopyHook(parts.join('\n\n'));

    try {
      await clipboard(text);
      App.flash(`Disalin ${sel.length} baris.`);
      CSTL.plugins.emit('copy', { count: sel.length, lines: sel.map(l => l.line_num) });
    } catch {
      els.pasteArea.value = text;
      alert(`Clipboard diblokir. Teks dipindah ke kolom 'Paste hasil AI'.`);
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
    const raw = await CSTL.plugins.runApplyHook(els.pasteArea.value.trim());
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
      if (State.ignoreName) r.name = null;
      const hasOn = !!(l.name || '').trim();
      const hasTn = !!(r.name || '').trim();
      const hasMsg = !!(l.message || '').trim();
      if (!State.ignoreName && hasOn && !hasTn) errors.push(`Baris ${r.num}: Nama dihapus AI.`);
      else if (!State.ignoreName && !hasOn && hasTn) errors.push(`Baris ${r.num}: Narasi tapi ada nama.`);
      else if (!r.msg && hasMsg) errors.push(`Baris ${r.num}: Pesan kosong.`);
      else updates.push({ line: l, item: r });
    });

    if (errors.length) return alert('DITOLAK:\n' + errors.slice(0, 10).join('\n') + (errors.length > 10 ? `\n+${errors.length - 10} error lainnya` : ''));

    State.undo = snapshot();
    State.redo = null;
    updates.forEach(({ line, item }) => {
      line.trans_message = item.msg;
      line.is_translated = true;
      line.trans_name = State.ignoreName ? null : (item.name || line.trans_name || null);
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
    CSTL.plugins.emit('apply', { count: updates.length, lines: nums });
  },

  lastTranslatedNum() {
    let last = 0;
    for (const l of State.lines) if (isTrans(l) && l.line_num > last) last = l.line_num;
    return last;
  },

  nextUntranslatedAfter(num) {
    let next = null;
    for (const l of State.lines) {
      if (!isTrans(l) && l.line_num > num && (next === null || l.line_num < next)) next = l.line_num;
    }
    return next;
  },

  prefillIncrement() {
    const step = Math.max(1, Math.floor(Number(State.incrementStep) || 100));
    const max = State.maxLineNum();
    if (!max) return;
    const from = App.nextUntranslatedAfter(App.lastTranslatedNum());
    if (from === null) {
      els.rangeFromInput.value = '';
      els.rangeToInput.value = '';
      State.selected.clear();
      App.syncCheckboxes();
      return;
    }
    els.rangeFromInput.value = from;
    els.rangeToInput.value = Math.min(from + step - 1, max);
    App.selectRange();
  },

  applyIncrement(applied) {
    if (!State.incrementEnabled || !State.lines.length) return null;
    const step = Math.max(1, Math.floor(Number(State.incrementStep) || 100));
    const max = State.maxLineNum();
    const pf = parseInt(els.rangeFromInput.value, 10);
    const pt = parseInt(els.rangeToInput.value, 10);
    const hasRange = Number.isFinite(pf) && Number.isFinite(pt) && pf >= 1 && pt >= pf;
    let base = 0;
    if (applied.length) base = Math.max(...applied);
    if (hasRange && pt > base) base = pt;
    if (!base) base = App.lastTranslatedNum();
    const from = App.nextUntranslatedAfter(base);
    if (from === null) {
      els.rangeFromInput.value = '';
      els.rangeToInput.value = '';
      State.selected.clear();
      App.syncCheckboxes();
      return ' Semua baris sudah tercakup.';
    }
    els.rangeFromInput.value = from;
    els.rangeToInput.value = Math.min(from + step - 1, max);
    App.selectRange();
    return ` Rentang berikutnya ${from}-${Math.min(from + step - 1, max)} dipilih.`;
  },

  _swapHistory(dir) {
    const from = State[dir];
    if (!from) return;
    const opp = dir === 'undo' ? 'redo' : 'undo';
    State[opp] = snapshot();
    State.lines = from.lines.map(normalizeLine);
    State.selected = new Set(from.selected);
    State[dir] = null;
    State.namesDirty = true;
    App.refresh(true);
    State.queueSave();
  },
  undo() { App._swapHistory('undo'); },
  redo() { App._swapHistory('redo'); },

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
    requestAnimationFrame(() => App.renderProofread());
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

const PluginHost = {
  jszipUrl: JSZIP_URL,

  storage: {
    readPluginIndex: () => Storage.readPluginIndex(),
    writePluginIndex: items => Storage.writePluginIndex(items),
    readPluginSettings: () => Storage.readJsonFile(PLUGIN_SETTINGS_FILE),
    writePluginSettings: value => Storage.writeJsonFile(PLUGIN_SETTINGS_FILE, value),
    savePluginZipStream: (id, blob) => Storage.savePluginZipStream(id, blob),
    pluginZipFile: id => Storage.pluginZipFile(id),
    pluginZipExists: id => Storage.pluginZipExists(id),
    listPluginFiles: () => Storage.listPluginFiles(),
    removePluginFile: id => Storage.removePluginFile(id),
    saveBlob: (pluginId, key, data) => Storage.saveBlob(State.projectId, pluginId, key, data),
    loadBlob: (pluginId, key) => Storage.loadBlob(State.projectId, pluginId, key),
    deleteBlob: (pluginId, key) => Storage.deleteBlob(State.projectId, pluginId, key),
    listBlobs: pluginId => Storage.listBlobs(State.projectId, pluginId),
    blobExists: (pluginId, key) => Storage.blobExists(State.projectId, pluginId, key),
    listProjects: () => Storage.list(),
    loadProject: id => Storage.load(id),
    saveProject: (id, data) => Storage.saveProject(id, data)
  },

  state: {
    projectId: () => State.projectId,
    projectName: () => State.projectName,
    pluginSettings: () => State.pluginSettings,
    setPluginSettings: v => { State.pluginSettings = v; },
    queueSave: () => State.queueSave(),
    projectInfo: () => State.projectId ? {
      name: State.projectName,
      type: State.projectType,
      fileCount: State.files.length,
      lineCount: State.lines.length,
      translatedCount: State.translatedCount
    } : null,
    lines: () => State.lines,
    selection: () => Array.from(State.selected),
    clearSelection: () => { State.selected.clear(); App.syncCheckboxes(); },
    selectRangeUI: (from, to) => { els.rangeFromInput.value = from; els.rangeToInput.value = to; App.selectRange(); },
    copyForAi: () => App.copyForAi()
  },

  ui: {
    flash: msg => App.flash(msg),
    comboHtml,
    themeVarsCss,
    shortcutComboFor: id => {
      const action = Shortcuts.allActions().find(a => a.id === id);
      return action ? Shortcuts.bindingFor(action) : '';
    },
    onPluginsChanged: () => {
      Shortcuts.refreshPluginActions();
      App.syncImportAccept();
    },
    onShortcutListMaybeRender: () => {
      if (els.shortcutModal.classList.contains('open')) App.renderShortcutList();
    },
    loadDashboard: () => App.loadDashboard(),
    closeDropdowns: () => closeDropdowns()
  },

  util: {
    clipboard,
    progress: Progress
  }
};

document.addEventListener('DOMContentLoaded', App.init);

})();
