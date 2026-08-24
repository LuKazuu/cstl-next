

'use strict';

(() => {
  const DECODERS = ['utf-8', 'shift_jis', 'windows-31j', 'cp932'];


  function decodeBuffer(buf) {
    const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    for (const enc of DECODERS) {
      try { return new TextDecoder(enc, { fatal: true }).decode(u); } catch {}
    }
    return new TextDecoder('utf-8').decode(u);
  }

  function stripNewlines(v) {
    return v == null ? null : String(v).replace(/\r?\n/g, '\\n').trim();
  }

  function sanitizeName(s) {
    const name = String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().replace(/[.\s]+$/, '');
    return name || 'untitled';
  }

  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function baseName(p) {
    if (!p) return '';
    const norm = String(p).replace(/\\/g, '/');
    const i = norm.lastIndexOf('/');
    return i < 0 ? norm : norm.slice(i + 1);
  }


  const progressHook = { cb: null };


  async function instantiateWasm(bytes, importObject) {
    const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const { instance } = await WebAssembly.instantiate(buf, importObject || {});
    return instance;
  }


  let _jszip = null;
  async function getJsZip() {
    if (_jszip !== null) return _jszip;
    try {

      importScripts('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
      _jszip = (self.JSZip || null);
    } catch {
      _jszip = false;
    }
    return _jszip;
  }


  function buildHostApi() {
    return {
      decode: decodeBuffer,
      basename: baseName,
      get JSZip() {

        return (typeof self.JSZip !== 'undefined') ? self.JSZip : null;
      },

      loadJsZip: getJsZip,
      escapeRegex,
      textEncoder: () => new TextEncoder(),
      textDecoder: (enc, fatal = false) => new TextDecoder(enc, { fatal }),
      stripNewlines,
      sanitizeName,
      progressHook: (cb) => { progressHook.cb = cb || (() => {}); },

      WebAssembly: (typeof WebAssembly !== 'undefined') ? WebAssembly : null,
      instantiateWasm,

      isWorker: true,
      threadName: 'plugin-worker'
    };
  }

  function sendResult(id, ok, payload) {
    let transfer = undefined;
    if (ok && payload && typeof payload === 'object') {


    }
    self.postMessage({ id, type: 'result', ok, ...payload }, transfer);
  }

  function logForward(level, args) {
    try {
      self.postMessage({ type: 'log', level, args: args.map(a => safeSerialize(a)) });
    } catch {}
  }

  function safeSerialize(v) {
    if (v == null) return v;
    const t = typeof v;
    if (t === 'string' || t === 'number' || t === 'boolean') return v;
    if (t === 'function') return '[fn]';
    if (v instanceof Error) return { __error: true, message: v.message, stack: v.stack, name: v.name };
    if (v instanceof Blob) return { __blob: true, size: v.size, type: v.type };
    if (v instanceof Uint8Array || v instanceof ArrayBuffer) return { __bytes: true, length: v.byteLength };
    try { return JSON.parse(JSON.stringify(v)); } catch { return '[unserializable]'; }
  }


  const origLog = console.log?.bind(console);
  const origWarn = console.warn?.bind(console);
  const origErr  = console.error?.bind(console);
  if (origLog) console.log  = (...a) => { logForward('log', a);   origLog(...a); };
  if (origWarn) console.warn = (...a) => { logForward('warn', a); origWarn(...a); };
  if (origErr)  console.error = (...a) => { logForward('error', a); origErr(...a); };


  function makeProgressEmit() {
    return (value, label) => {
      try {
        self.postMessage({ type: 'progress', value: typeof value === 'number' ? value : 0, label: String(label || '') });
      } catch {}
    };
  }


  let pluginInstance = null;
  let pluginId = null;
  let pluginMeta = null;

  function loadPlugin(code, id) {
    const factory = new Function('module', 'exports', 'require', '"use strict";\n' + code + '\n;return module.exports;');
    const m = { exports: {} };
    const restrictedRequire = (name) => {
      const n = String(name || '').toLowerCase();
      if (n === 'jszip') return (typeof self.JSZip !== 'undefined' ? self.JSZip : null);
      if (n === 'webassembly') return (typeof WebAssembly !== 'undefined' ? WebAssembly : null);
      throw new Error('require() tidak diizinkan untuk: ' + name);
    };
    let plugin;
    try {
      plugin = factory(m, m.exports, restrictedRequire);
    } catch (e) {
      throw new Error('Gagal memuat plugin (worker): ' + e.message);
    }
    if (!plugin || typeof plugin !== 'object') throw new Error('Plugin tidak mengekspor objek yang valid.');
    if (typeof plugin.extract !== 'function') throw new Error('Plugin tidak memiliki fungsi extract(input).');
    if (typeof plugin.pack !== 'function') throw new Error('Plugin tidak memiliki fungsi pack(input).');
    pluginInstance = plugin;
    pluginId = id;
    return plugin;
  }

  async function handleCall(method, args) {
    if (!pluginInstance) throw new Error('Worker belum menerima init plugin.');
    if (method === 'extract' || method === 'pack') {


      const a = Array.isArray(args) ? args[0] : args;
      const input = { ...a, host: buildHostApi() };

      const emit = makeProgressEmit();
      input.host.progressHook = (cb) => {

        const wrapped = (val, label) => {
          emit(val, label);
          if (typeof cb === 'function') cb(val, label);
        };

        input.host.emitProgress = emit;

        progressHook.cb = wrapped;
      };
      return await pluginInstance[method](input);
    }

    if (typeof pluginInstance[method] === 'function') {
      return await pluginInstance[method](Array.isArray(args) ? args[0] : args);
    }
    throw new Error('Method plugin tidak ditemukan: ' + method);
  }

  self.onmessage = async (ev) => {
    const msg = ev.data || {};
    const id = msg.id;
    try {
      if (msg.type === 'ping') {
        self.postMessage({ id, type: 'result', ok: true, value: { pong: true, pluginId, hasPlugin: !!pluginInstance } });
        return;
      }
      if (msg.type === 'init') {
        const code = String(msg.code || '');
        if (!code) throw new Error('init tanpa code.');
        loadPlugin(code, msg.pluginId);

        if (msg.preloadJsZip) {
          await getJsZip();
        }
        self.postMessage({ id, type: 'result', ok: true, value: { id: msg.pluginId, methods: ['extract','pack'] } });
        return;
      }
      if (msg.type === 'call') {
        const out = await handleCall(msg.method, msg.args);
        sendResult(id, true, { value: out });
        return;
      }
      if (msg.type === 'terminate') {
        self.postMessage({ id, type: 'result', ok: true, value: { terminated: true } });
        self.close();
        return;
      }
      throw new Error('Unknown message type: ' + msg.type);
    } catch (e) {
      sendResult(id, false, { error: e.message || String(e), stack: e.stack || '' });
    }
  };


  self.postMessage({ type: 'ready' });
})();
