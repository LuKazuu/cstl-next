window.CSTL = window.CSTL || {};
(() => {
'use strict';

const PLUGIN_API_VERSION = 1;
const MANIFEST_FILE = 'manifest.json';
const ENTRY_FILE = 'plugin.js';
const MANIFEST_VERSION = 1;
const INDEX_SCHEMA = 1;
const SETTING_SCOPES = ['global', 'project', 'shared'];

const ZIP_TAIL_BYTES = 65557;
const ZIP_CHUNK_BYTES = 4 * 1024 * 1024;
const ZIP_BOMB_FLOOR_BYTES = 64 * 1024 * 1024;
const ZIP_BOMB_RATIO = 100;

const BOOT_TIMEOUT_MS = 8000;
const CALL_TIMEOUT_DEFAULT_MS = 30000;
const WASM_TIMEOUT_DEFAULT = 10000;
const WASM_TIMEOUT_MIN = 1000;
const WASM_TIMEOUT_MAX = 60000;
const WASM_MODULE_CACHE_MAX = 8;

const RATE_DOWNLOAD_PER_MIN = 20;
const RATE_TOAST_PER_MIN = 30;
const RATE_FETCH_PER_MIN = 60;
const NET_TIMEOUT_DEFAULT_MS = 30000;
const NET_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

const BUILTIN_EXTENSIONS = new Set(['.json', '.epub']);

const FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data: blob:",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const clampInt = (v, min, max, dflt) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
};

function validBlobKey(key) {
  if (typeof key !== 'string' || !key || key.length > 255) return false;
  if (key.includes('/') || key.includes('\\') || key === '.' || key === '..') return false;
  return !/[\x00-\x1f]/.test(key);
}

function sanitizeFilename(name) {
  const n = String(name || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().slice(0, 200);
  return n || 'download';
}

function stripNewlines(v) {
  return v == null ? null : String(v).replace(/\r?\n/g, '\\n').trim();
}

function fnv1a(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function humanBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return '0 B';
  if (v < 1024) return v + ' B';
  if (v < 1048576) return (v / 1024).toFixed(1) + ' KB';
  if (v < 1073741824) return (v / 1048576).toFixed(2) + ' MB';
  return (v / 1073741824).toFixed(2) + ' GB';
}

const Sha256 = (() => {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;
  const create = () => {
    const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const buf = new Uint8Array(64);
    const w = new Uint32Array(64);
    let bufLen = 0;
    let lenHi = 0;
    let lenLo = 0;
    const process = () => {
      for (let i = 0; i < 16; i++) {
        const o = i * 4;
        w[i] = ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0;
      }
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (k + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        k = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + k) >>> 0;
    };
    const update = bytes => {
      const sum = lenLo + bytes.length;
      lenLo = sum >>> 0;
      lenHi = (lenHi + Math.floor(sum / 0x100000000)) >>> 0;
      let pos = 0;
      if (bufLen) {
        const take = Math.min(64 - bufLen, bytes.length);
        buf.set(bytes.subarray(0, take), bufLen);
        bufLen += take;
        pos = take;
        if (bufLen === 64) { process(); bufLen = 0; }
      }
      while (pos + 64 <= bytes.length) {
        buf.set(bytes.subarray(pos, pos + 64));
        process();
        pos += 64;
      }
      if (pos < bytes.length) {
        buf.set(bytes.subarray(pos), bufLen);
        bufLen = bytes.length - pos;
      }
    };
    return {
      update,
      hex() {
        const bitHi = (lenHi * 8 + Math.floor(lenLo / 0x20000000)) >>> 0;
        const bitLo = (lenLo << 3) >>> 0;
        const padLen = bufLen < 56 ? 56 - bufLen : 120 - bufLen;
        const pad = new Uint8Array(padLen + 8);
        pad[0] = 0x80;
        const dv = new DataView(pad.buffer);
        dv.setUint32(padLen, bitHi, false);
        dv.setUint32(padLen + 4, bitLo, false);
        update(pad);
        let out = '';
        for (let i = 0; i < 8; i++) out += h[i].toString(16).padStart(8, '0');
        return out;
      }
    };
  };
  return { create };
})();

async function sha256HexOfBlob(blob) {
  const s = Sha256.create();
  for (let off = 0; off < blob.size; off += ZIP_CHUNK_BYTES) {
    s.update(new Uint8Array(await blob.slice(off, off + ZIP_CHUNK_BYTES).arrayBuffer()));
  }
  return s.hex();
}

const ZipReader = {
  async open(blob) {
    if (!blob || typeof blob.slice !== 'function' || !Number.isFinite(blob.size)) throw new Error('Sumber paket tidak valid.');
    const size = blob.size;
    if (size < 22) throw new Error('File .zip tidak valid atau rusak.');
    const tailLen = Math.min(size, ZIP_TAIL_BYTES);
    const tail = new Uint8Array(await blob.slice(size - tailLen).arrayBuffer());
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('File .zip tidak valid atau rusak.');
    const eocdDv = new DataView(tail.buffer, tail.byteOffset + eocd, 22);
    let count = eocdDv.getUint16(8, true);
    let cdSize = eocdDv.getUint32(12, true);
    let cdOffset = eocdDv.getUint32(16, true);
    const locOff = eocd - 20;
    if (locOff >= 0 && tail[locOff] === 0x50 && tail[locOff + 1] === 0x4b && tail[locOff + 2] === 0x06 && tail[locOff + 3] === 0x07) {
      const locDv = new DataView(tail.buffer, tail.byteOffset + locOff, 20);
      const z64Offset = Number(locDv.getBigUint64(8, true));
      if (Number.isFinite(z64Offset) && z64Offset >= 0 && z64Offset + 56 <= size) {
        const z64 = new Uint8Array(await blob.slice(z64Offset, z64Offset + 56).arrayBuffer());
        if (z64[0] === 0x50 && z64[1] === 0x4b && z64[2] === 0x06 && z64[3] === 0x06) {
          const z64Dv = new DataView(z64.buffer);
          count = Number(z64Dv.getBigUint64(32, true));
          cdSize = Number(z64Dv.getBigUint64(40, true));
          cdOffset = Number(z64Dv.getBigUint64(48, true));
        }
      }
    }
    if (!Number.isFinite(count) || !Number.isFinite(cdSize) || !Number.isFinite(cdOffset) ||
      cdOffset < 0 || cdSize < 0 || cdOffset + cdSize > size) {
      throw new Error('File .zip tidak valid atau rusak.');
    }
    const cd = cdSize === 0 ? new Uint8Array(0) : new Uint8Array(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
    const dv = new DataView(cd.buffer);
    const decoder = new TextDecoder();
    const entries = new Map();
    let pos = 0;
    let seen = 0;
    while (pos + 46 <= cd.length && seen < count) {
      if (dv.getUint32(pos, true) !== 0x02014b50) break;
      const method = dv.getUint16(pos + 10, true);
      let compSize = dv.getUint32(pos + 20, true);
      let uncompSize = dv.getUint32(pos + 24, true);
      const nameLen = dv.getUint16(pos + 28, true);
      const extraLen = dv.getUint16(pos + 30, true);
      const commentLen = dv.getUint16(pos + 32, true);
      let localOffset = dv.getUint32(pos + 42, true);
      const extAttrs = dv.getUint32(pos + 38, true);
      const nameRaw = cd.subarray(pos + 46, pos + 46 + nameLen);
      if (nameRaw.length < nameLen) break;
      let extraPos = pos + 46 + nameLen;
      const extraEnd = Math.min(extraPos + extraLen, cd.length);
      while (extraPos + 4 <= extraEnd) {
        const xid = dv.getUint16(extraPos, true);
        const xsz = dv.getUint16(extraPos + 2, true);
        if (xsz < 4) break;
        if (xid === 0x0001 && extraPos + 4 + xsz <= extraEnd) {
          let xp = extraPos + 4;
          const xe = extraPos + 4 + xsz;
          if (uncompSize === 0xFFFFFFFF && xp + 8 <= xe) { uncompSize = Number(dv.getBigUint64(xp, true)); xp += 8; }
          if (compSize === 0xFFFFFFFF && xp + 8 <= xe) { compSize = Number(dv.getBigUint64(xp, true)); xp += 8; }
          if (localOffset === 0xFFFFFFFF && xp + 8 <= xe) { localOffset = Number(dv.getBigUint64(xp, true)); xp += 8; }
        }
        extraPos += 4 + xsz;
      }
      const name = decoder.decode(nameRaw).replace(/^\.+\//, '').replace(/^\/+/, '');
      const mode = extAttrs >>> 16;
      const isDir = !name || name.endsWith('/') || (mode !== 0 && (mode & 0xf000) === 0x4000) || (mode === 0 && (extAttrs & 0x10) !== 0);
      if (!isDir && name && !name.split('/').some(seg => seg === '..' || seg === '')) {
        entries.set(name, { name, method, compSize, uncompSize, localOffset });
      }
      pos += 46 + nameLen + extraLen + commentLen;
      seen++;
    }
    return {
      names() { return Array.from(entries.keys()); },
      has(n) { return entries.has(String(n)); },
      readBytes(n) { return ZipReader._read(blob, entries.get(String(n))); },
      readText(n) { return ZipReader._read(blob, entries.get(String(n))).then(b => new TextDecoder().decode(b)); }
    };
  },

  async _read(blob, e) {
    if (!e) throw new Error('File tidak ditemukan di paket plugin.');
    if (e.method !== 0 && e.method !== 8) throw new Error(`Metode kompresi ${e.method} tidak didukung untuk "${e.name}".`);
    const head = new Uint8Array(await blob.slice(e.localOffset, e.localOffset + 30).arrayBuffer());
    if (head.length < 30 || head[0] !== 0x50 || head[1] !== 0x4b || head[2] !== 0x03 || head[3] !== 0x04) {
      throw new Error(`Paket rusak: header lokal "${e.name}" tidak valid.`);
    }
    const nameLen = head[26] | (head[27] << 8);
    const extraLen = head[28] | (head[29] << 8);
    const dataStart = e.localOffset + 30 + nameLen + extraLen;
    if (dataStart < 0 || e.compSize < 0 || dataStart + e.compSize > blob.size) {
      throw new Error(`Paket rusak: data "${e.name}" di luar batas file.`);
    }
    if (e.method === 0) {
      const out = new Uint8Array(await blob.slice(dataStart, dataStart + e.compSize).arrayBuffer());
      if (e.uncompSize && out.length !== e.uncompSize) throw new Error(`Paket rusak: ukuran "${e.name}" tidak cocok.`);
      return out;
    }
    const budget = Math.max(ZIP_BOMB_FLOOR_BYTES, e.compSize * ZIP_BOMB_RATIO);
    const stream = blob.slice(dataStart, dataStart + e.compSize).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > budget) throw new Error(`"${e.name}" melebihi batas dekompresi aman (${humanBytes(budget)}) — paket kemungkinan rusak.`);
        chunks.push(value);
      }
    } catch (err) {
      try { reader.cancel(); } catch {}
      throw err;
    }
    if (e.uncompSize && total !== e.uncompSize) throw new Error(`Paket rusak: ukuran "${e.name}" tidak cocok.`);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }
};

function sanitizeThemeCss(css) {
  if (typeof css !== 'string' || !css) return '';
  const n = css.length;
  let out = '';
  let i = 0;
  const isIdentStart = c => /[A-Za-z_\u0080-\uffff-]/.test(c);
  const isIdentChar = c => /[A-Za-z0-9_\u0080-\uffff-]/.test(c);
  const readIdent = start => {
    let j = start;
    let decoded = '';
    while (j < n) {
      const c = css[j];
      if (c === '\\') {
        const m = /^\\([0-9a-fA-F]{1,6})[ \t\r\n\f]?/.exec(css.slice(j, j + 8));
        if (m) {
          const cp = parseInt(m[1], 16);
          decoded += (cp === 0 || cp > 0x10ffff) ? '\ufffd' : String.fromCodePoint(cp);
          j += m[0].length;
        } else if (j + 1 < n) {
          decoded += css[j + 1];
          j += 2;
        } else {
          j++;
        }
        continue;
      }
      if ((j === start && !isIdentStart(c)) || (j > start && !isIdentChar(c))) break;
      decoded += c;
      j++;
    }
    return { text: decoded, end: j };
  };
  const decodeCssString = raw => {
    let decoded = '';
    for (let p = 0; p < raw.length; p++) {
      const c = raw[p];
      if (c !== '\\') { decoded += c; continue; }
      const m = /^([0-9a-fA-F]{1,6})[ \t\r\n\f]?/.exec(raw.slice(p + 1, p + 8));
      if (m) {
        const cp = parseInt(m[1], 16);
        decoded += (cp === 0 || cp > 0x10ffff) ? '\ufffd' : String.fromCodePoint(cp);
        p += m[0].length;
      } else if (p + 1 < raw.length) {
        decoded += raw[p + 1];
        p++;
      }
    }
    return decoded;
  };
  const skipString = start => {
    const q = css[start];
    let j = start + 1;
    while (j < n) {
      if (css[j] === '\\') { j += 2; continue; }
      if (css[j] === q) return j + 1;
      j++;
    }
    return n;
  };
  const urlAllowed = url => {
    const t = url.trim();
    if (!t) return true;
    if (/^data:/i.test(t)) return true;
    if (t.startsWith('#')) return true;
    return false;
  };

  while (i < n) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      out += ' ';
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = skipString(i);
      out += css.slice(i, end);
      i = end;
      continue;
    }
    if (c === '@') {
      const ident = readIdent(i + 1);
      if (ident.text.toLowerCase() === 'import') {
        let j = ident.end;
        while (j < n) {
          const cj = css[j];
          if (cj === '"' || cj === "'") { j = skipString(j); continue; }
          if (cj === '/' && css[j + 1] === '*') {
            const e = css.indexOf('*/', j + 2);
            j = e < 0 ? n : e + 2;
            continue;
          }
          if (cj === ';') { j++; break; }
          if (cj === '{') {
            let d = 1;
            j++;
            while (j < n && d > 0) {
              const cb = css[j];
              if (cb === '"' || cb === "'") { j = skipString(j); continue; }
              if (cb === '/' && css[j + 1] === '*') {
                const e = css.indexOf('*/', j + 2);
                j = e < 0 ? n : e + 2;
                continue;
              }
              if (cb === '{') d++;
              else if (cb === '}') d--;
              j++;
            }
            break;
          }
          j++;
        }
        out += ' ';
        i = j;
        continue;
      }
      out += css.slice(i, ident.end);
      i = ident.end;
      continue;
    }
    if (isIdentStart(c) || c === '\\') {
      const ident = readIdent(i);
      let k = ident.end;
      while (k < n && /[ \t\r\n\f]/.test(css[k])) k++;
      if (ident.text.toLowerCase() === 'url' && css[k] === '(') {
        const close = css.indexOf(')', k + 1);
        if (close < 0) { i = n; continue; }
        const arg = css.slice(k + 1, close).trim();
        let decoded = arg;
        if (arg.length >= 2 && ((arg[0] === '"' && arg.endsWith('"')) || (arg[0] === "'" && arg.endsWith("'")))) {
          decoded = decodeCssString(arg.slice(1, -1));
        }
        if (urlAllowed(decoded)) out += css.slice(i, close + 1);
        else out += 'url("data:,")';
        i = close + 1;
        continue;
      }
      out += css.slice(i, ident.end);
      i = ident.end;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const PERMISSIONS = {
  project: {
    label: 'Baca project',
    desc: 'Baris teks dan terjemahan project.',
    icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>'
  },
  workspace: {
    label: 'Ubah seleksi',
    desc: 'Memilih baris dan memicu copy.',
    icon: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'
  },
  clipboard: {
    label: 'Clipboard',
    desc: 'Menyalin teks ke clipboard.',
    icon: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'
  },
  files: {
    label: 'Pilih file',
    desc: 'Membaca file yang kamu pilih.',
    icon: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'
  },
  downloads: {
    label: 'Unduhan',
    desc: 'Menyimpan file ke perangkat.',
    icon: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'
  },
  storage: {
    label: 'Penyimpanan',
    desc: 'Menyimpan data plugin per project.',
    icon: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>'
  },
  wasm: {
    label: 'WebAssembly',
    desc: 'Menjalankan modul WASM dari paket.',
    icon: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'
  },
  jszip: {
    label: 'JSZip',
    desc: 'Memuat pustaka ZIP di sandbox.',
    icon: '<path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>'
  },
  theme: {
    label: 'Tema',
    desc: 'CSS tema tampilan (offline, tanpa jaringan).',
    icon: '<circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="10.5" r="2.5"/><circle cx="8.5" cy="7.5" r="2.5"/><circle cx="6.5" cy="12.5" r="2.5"/><path d="M12 2a10 10 0 1 0 10 10c0-1-1-2-2-2h-2a2 2 0 0 1-2-2c0-.5.2-1 .5-1.5A10 10 0 0 0 12 2z"/>'
  },
  net: {
    label: 'Akses Internet',
    desc: 'Mengirim permintaan HTTP/HTTPS ke server mana pun.',
    icon: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'
  },
  hooks: {
    label: 'Copy/paste',
    desc: 'Membaca dan mengubah teks copy/paste.',
    icon: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>'
  }
};
const PERMISSION_IDS = Object.keys(PERMISSIONS);

const permSvg = (perm, size) => {
  const p = PERMISSIONS[perm];
  if (!p) return '';
  return `<svg viewBox="0 0 24 24" width="${size || 14}" height="${size || 14}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p.icon}</svg>`;
};

const Manifest = {

  parse(text) {
    let raw;
    try { raw = JSON.parse(text); }
    catch (e) {
      const msg = String(e?.message || e);
      return { ok: false, errors: [`manifest.json bukan JSON yang valid: ${msg}`] };
    }
    if (!isPlainObject(raw)) {
      return { ok: false, errors: ['manifest.json harus berisi objek JSON ( { ... } ).'] };
    }
    return { ok: true, data: raw };
  },

  validate(m) {
    const errors = [];
    if (!isPlainObject(m)) return ['manifest harus objek.'];

    if (m.manifestVersion === undefined) errors.push('"manifestVersion" wajib diisi (gunakan 1).');
    else if (m.manifestVersion !== MANIFEST_VERSION) errors.push(`"manifestVersion" harus ${MANIFEST_VERSION} (ditemukan ${JSON.stringify(m.manifestVersion)}).`);

    if (typeof m.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(m.id)) {
      errors.push('"id" wajib: huruf kecil/angka/garisbawah/tanda hubung, 1-64 karakter, diawali alfanumerik (contoh: "my-plugin").');
    }
    if (typeof m.name !== 'string' || !m.name.trim() || m.name.trim().length > 80) {
      errors.push('"name" wajib diisi, 1-80 karakter.');
    }
    if (typeof m.version !== 'string' || !m.version.trim() || m.version.trim().length > 32) {
      errors.push('"version" wajib diisi, 1-32 karakter (disarankan semver, contoh: "1.0.0").');
    }
    if (m.author != null && (typeof m.author !== 'string' || m.author.length > 80)) {
      errors.push('"author" opsional, string maks 80 karakter.');
    }
    if (m.description != null && (typeof m.description !== 'string' || m.description.length > 300)) {
      errors.push('"description" opsional, string maks 300 karakter.');
    }

    if (m.api !== undefined && m.api !== PLUGIN_API_VERSION) {
      errors.push(`"api" harus ${PLUGIN_API_VERSION} — satu-satunya versi API yang didukung versi aplikasi ini.`);
    }

    if (m.permissions !== undefined) {
      if (!Array.isArray(m.permissions)) {
        errors.push('"permissions" harus array string.');
      } else {
        const known = new Set(PERMISSION_IDS);
        for (const p of m.permissions) {
          if (typeof p !== 'string' || !known.has(p)) {
            errors.push(`Izin tidak dikenal: ${JSON.stringify(p)}. Izin yang valid: ${PERMISSION_IDS.join(', ')}.`);
          }
        }
      }
    }

    if (m.extensions !== undefined) {
      if (!Array.isArray(m.extensions) || !m.extensions.length) {
        errors.push('"extensions" harus array tidak kosong (contoh: [".ks"]).');
      } else if (m.extensions.length > 16) {
        errors.push('"extensions" maksimal 16 entri.');
      } else {
        for (const e of m.extensions) {
          if (typeof e !== 'string' || !/^\.[a-z0-9]{1,16}$/i.test(e)) {
            errors.push(`Ekstensi tidak valid: ${JSON.stringify(e)} — harus diawali titik lalu 1-16 karakter alfanumerik (contoh: ".ks").`);
          }
        }
        const lower = m.extensions.map(e => String(e).toLowerCase());
        for (const b of BUILTIN_EXTENSIONS) {
          if (lower.includes(b)) errors.push(`Ekstensi ${b} adalah format bawaan CSTL dan tidak boleh diklaim plugin.`);
        }
      }
    }

    if (m.magic !== undefined) {
      if (!Array.isArray(m.magic) || !m.magic.length) {
        errors.push('"magic" harus array tidak kosong.');
      } else if (m.magic.length > 16) {
        errors.push('"magic" maksimal 16 entri.');
      } else {
        m.magic.forEach((s, i) => {
          const res = Manifest.validateSig(s);
          if (!res.ok) errors.push(`magic[${i}]: ${res.error}`);
        });
      }
    }

    if (m.ui !== undefined && m.ui !== null) {
      if (!isPlainObject(m.ui)) {
        errors.push('"ui" harus objek { title?, height? }.');
      } else {
        if (m.ui.title != null && (typeof m.ui.title !== 'string' || !m.ui.title.trim() || m.ui.title.length > 60)) {
          errors.push('ui.title harus string 1-60 karakter.');
        }
        if (m.ui.height != null && (typeof m.ui.height !== 'number' || !Number.isFinite(m.ui.height) || m.ui.height < 120 || m.ui.height > 600)) {
          errors.push('ui.height harus angka 120-600 (piksel).');
        }
      }
    }

    if (m.settings !== undefined) {
      const res = Manifest.validateSettings(m.settings);
      for (const e of res) errors.push(e);
    }

    return errors;
  },

  validateSig(s) {
    if (!isPlainObject(s)) return { ok: false, error: 'harus objek { hex } atau { text }, plus offset opsional.' };
    const hasHex = Object.hasOwn(s, 'hex'), hasText = Object.hasOwn(s, 'text');
    if (hasHex === hasText) return { ok: false, error: 'harus punya hex ATAU text (tidak keduanya).' };
    if (hasHex) {
      if (typeof s.hex !== 'string') return { ok: false, error: 'hex harus string.' };
      const h = s.hex.replace(/\s+/g, '');
      if (!h.length || h.length % 2 || h.length > 128 || !/^[0-9a-f]+$/i.test(h)) return { ok: false, error: 'hex harus heksadesimal genap, maks 64 byte (contoh: "504b0304").' };
    }
    if (hasText) {
      if (typeof s.text !== 'string' || !s.text.length) return { ok: false, error: 'text harus string tidak kosong.' };
      if (new TextEncoder().encode(s.text).length > 64) return { ok: false, error: 'text maks 64 byte.' };
    }
    if (s.offset != null && (!Number.isInteger(s.offset) || s.offset < 0 || s.offset > 4096)) {
      return { ok: false, error: 'offset harus bilangan bulat 0-4096.' };
    }
    return { ok: true };
  },

  validateSettings(raw) {
    if (!isPlainObject(raw)) return ['"settings" harus objek { global?, project?, shared? }.'];
    const errors = [];
    for (const k of Object.keys(raw)) {
      if (!SETTING_SCOPES.includes(k)) errors.push(`Kunci "settings.${k}" tidak dikenal — hanya "global", "project", dan "shared".`);
    }
    let total = 0;
    const keysByScope = new Map();
    for (const scope of SETTING_SCOPES) {
      const arr = raw[scope];
      if (arr === undefined) continue;
      if (!Array.isArray(arr)) { errors.push(`"settings.${scope}" harus array.`); continue; }
      if (arr.length > 32) errors.push(`"settings.${scope}" maksimal 32 entri.`);
      total += arr.length;
      errors.push(...Manifest.validateSettingList(arr, `settings.${scope}`));
      if (Array.isArray(arr)) {
        for (const s of arr) {
          if (!isPlainObject(s) || typeof s.key !== 'string') continue;
          if (keysByScope.has(s.key)) errors.push(`Kunci "${s.key}" dipakai di lebih dari satu scope ("${keysByScope.get(s.key)}" dan "${scope}").`);
          else keysByScope.set(s.key, scope);
        }
      }
    }
    if (total > 64) errors.push('Total entri settings maksimal 64.');
    return errors;
  },

  validateSettingList(raw, at) {
    const errors = [];
    const seen = new Set();
    const types = ['string', 'number', 'boolean', 'select', 'textarea'];
    raw.forEach((s, i) => {
      const a = `${at}[${i}]`;
      if (!isPlainObject(s)) { errors.push(`${a}: harus objek.`); return; }
      if (typeof s.key !== 'string' || !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(s.key)) {
        errors.push(`${a}.key: harus nama variabel valid (contoh: "maxDepth").`); return;
      }
      if (seen.has(s.key)) { errors.push(`${a}.key: kunci "${s.key}" duplikat.`); return; }
      seen.add(s.key);
      if (typeof s.label !== 'string' || !s.label.trim() || s.label.length > 80) errors.push(`${a}.label: wajib, 1-80 karakter.`);
      const type = s.type ?? 'string';
      if (!types.includes(type)) errors.push(`${a}.type: harus salah satu dari ${types.join(', ')}.`);
      if (s.description != null && (typeof s.description !== 'string' || s.description.length > 200)) errors.push(`${a}.description: maks 200 karakter.`);
      if (s.placeholder != null && (typeof s.placeholder !== 'string' || s.placeholder.length > 200)) errors.push(`${a}.placeholder: maks 200 karakter.`);
      if (type === 'select') {
        if (!Array.isArray(s.options) || !s.options.length) {
          errors.push(`${a}.options: wajib untuk tipe select (minimal 1 pilihan).`);
        } else if (s.options.length > 50) {
          errors.push(`${a}.options: maksimal 50 pilihan.`);
        } else {
          for (const o of s.options) {
            const val = isPlainObject(o) ? o.value : o;
            if (typeof val !== 'string' || !val.length || val.length > 100) {
              errors.push(`${a}.options: setiap pilihan harus string ≤ 100 karakter (atau { value, label }).`); break;
            }
          }
        }
      }
      if (type === 'number') {
        for (const k of ['min', 'max', 'step']) {
          if (s[k] != null && typeof s[k] !== 'number') errors.push(`${a}.${k}: harus angka.`);
        }
      }
    });
    return errors;
  },

  normalize(m, files, extra) {
    const permissions = PERMISSION_IDS.filter(p => (m.permissions || []).includes(p));
    const settings = Manifest.normalizeSettings(m.settings);
    const magic = (m.magic || []).map(s => Manifest.normalizeSig(s)).filter(Boolean);
    const ui = isPlainObject(m.ui) ? {
      ...(typeof m.ui.title === 'string' && m.ui.title.trim() ? { title: m.ui.title.trim().slice(0, 60) } : {}),
      ...(typeof m.ui.height === 'number' && Number.isFinite(m.ui.height) ? { height: clampInt(m.ui.height, 120, 600, 300) } : {})
    } : null;
    return Object.assign({
      schema: INDEX_SCHEMA,
      id: m.id,
      name: m.name.trim(),
      version: m.version.trim(),
      author: (m.author || '').trim(),
      description: (m.description || '').trim(),
      api: PLUGIN_API_VERSION,
      permissions,
      extensions: (m.extensions || []).map(e => String(e).toLowerCase()),
      magic,
      ui: ui && Object.keys(ui).length ? ui : null,
      settings,
      files,
      enabled: true
    }, extra || {});
  },

  normalizeSig(s) {
    if (!Manifest.validateSig(s).ok) return null;
    const offset = Number.isInteger(s.offset) && s.offset >= 0 ? s.offset : 0;
    if (Object.hasOwn(s, 'hex')) {
      return { hex: s.hex.replace(/\s+/g, '').toLowerCase(), offset };
    }
    return { hex: Array.from(new TextEncoder().encode(s.text), b => b.toString(16).padStart(2, '0')).join(''), offset };
  },

  normalizeSettings(raw) {
    const out = { global: [], project: [], shared: [] };
    if (!isPlainObject(raw)) return out;
    for (const scope of SETTING_SCOPES) {
      if (Array.isArray(raw[scope])) out[scope] = Manifest.normalizeSettingList(raw[scope]);
    }
    return out;
  },

  normalizeSettingList(raw) {
    const out = [];
    for (const s of raw) {
      if (!isPlainObject(s)) continue;
      if (typeof s.key !== 'string' || !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(s.key)) continue;
      if (typeof s.label !== 'string' || !s.label.trim()) continue;
      const type = ['string', 'number', 'boolean', 'select', 'textarea'].includes(s.type) ? s.type : 'string';
      const def = type === 'number' ? (Number(s.default) || 0)
        : type === 'boolean' ? !!s.default
        : String(s.default ?? '');
      const entry = { key: s.key, label: s.label.trim().slice(0, 80), type, default: def };
      if (type === 'select' && Array.isArray(s.options)) {
        entry.options = s.options.slice(0, 50).map(o => isPlainObject(o)
          ? { value: String(o.value).slice(0, 100), label: String(o.label ?? o.value).slice(0, 100) }
          : { value: String(o).slice(0, 100), label: String(o).slice(0, 100) });
      }
      if (type === 'number') {
        if (typeof s.min === 'number') entry.min = s.min;
        if (typeof s.max === 'number') entry.max = s.max;
        if (typeof s.step === 'number') entry.step = s.step;
      }
      if (typeof s.placeholder === 'string') entry.placeholder = s.placeholder.slice(0, 200);
      if (typeof s.description === 'string') entry.description = s.description.slice(0, 200);
      out.push(entry);
    }
    return out;
  }
};

const Dialogs = {
  _active: null,

  _create({ title, bodyHtml, confirmLabel, cancelLabel, danger, wide, hideCancel }) {
    return new Promise(resolve => {
      if (Dialogs._active) { resolve(null); return; }
      const overlay = document.createElement('div');
      overlay.className = 'backdrop cstl-dialog';
      overlay.innerHTML = `
        <div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">
          <div class="modal-head"><h3>${esc(title)}</h3></div>
          <div class="modal-body cstl-dialog-body">${bodyHtml}</div>
          <div class="modal-actions">
            ${hideCancel ? '' : `<button type="button" class="btn btn-ghost cstl-dialog-cancel">${esc(cancelLabel || 'Batal')}</button>`}
            <span class="grow"></span>
            <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'} cstl-dialog-ok">${esc(confirmLabel || 'OK')}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      Dialogs._active = overlay;

      let settled = false;
      const finish = val => {
        if (settled) return;
        settled = true;
        Dialogs._active = null;
        observer.disconnect();
        overlay.classList.remove('open');
        overlay.remove();
        resolve(val);
      };
      const observer = new MutationObserver(() => {
        if (!overlay.classList.contains('open')) finish(null);
      });
      observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });

      overlay.querySelector('.cstl-dialog-cancel')?.addEventListener('click', () => finish(null));
      overlay.querySelector('.cstl-dialog-ok').addEventListener('click', () => finish(true));
      overlay.querySelector('.consent-fp-value')?.addEventListener('click', async e => {
        try {
          await navigator.clipboard.writeText(e.currentTarget.textContent.trim());
          const prev = e.currentTarget.title;
          e.currentTarget.title = 'Tersalin!';
          host.ui.flash('Sidik jari disalin.');
          setTimeout(() => { e.currentTarget.title = prev; }, 1500);
        } catch {}
      });
      requestAnimationFrame(() => {
        overlay.classList.add('open');
        const focusEl = danger && !hideCancel
          ? overlay.querySelector('.cstl-dialog-cancel')
          : overlay.querySelector('.cstl-dialog-ok');
        focusEl?.focus({ preventScroll: true });
      });
    });
  },

  confirm(opts) {
    return Dialogs._create({ ...opts, danger: !!opts.danger });
  },

  info(title, bodyHtml) {
    return Dialogs._create({
      title,
      bodyHtml,
      confirmLabel: 'Tutup',
      danger: false,
      hideCancel: true
    });
  },

  consent(meta, opts) {
    const existing = opts?.existing || null;
    const newPerms = Array.isArray(opts?.newPerms) ? opts.newPerms : [];
    const review = !!opts?.review;
    const isNew = p => !!existing && newPerms.includes(p);
    const permList = meta.permissions.length
      ? meta.permissions.map(p => {
          const info = PERMISSIONS[p];
          return `<div class="consent-perm">
            <span class="consent-perm-icon">${permSvg(p, 15)}</span>
            <span class="consent-perm-text">
              <strong>${esc(info.label)}</strong>${isNew(p) ? '<span class="consent-perm-new">BARU</span>' : ''}
              <span>${esc(info.desc)}</span>
            </span>
          </div>`;
        }).join('')
      : '<div class="consent-noperm">Plugin ini tidak meminta izin khusus.</div>';

    const caps = [];
    if (meta.extensions?.length || meta.magic?.length) {
      const label = [meta.extensions.join(' '), meta.magic.length ? ' + signature biner' : ''].filter(Boolean).join('');
      caps.push(`<span class="cap-chip">Parser ${esc(label)}</span>`);
    }
    if (meta.ui) caps.push('<span class="cap-chip">Panel UI</span>');
    if (meta.settings.global.length) caps.push(`<span class="cap-chip">${meta.settings.global.length} setelan global</span>`);
    if (meta.settings.project.length) caps.push(`<span class="cap-chip">${meta.settings.project.length} setelan project</span>`);
    if (meta.settings.shared.length) caps.push(`<span class="cap-chip">${meta.settings.shared.length} setelan bersama</span>`);
    if (meta.files.length) caps.push(`<span class="cap-chip">${meta.files.length} asset</span>`);
    if (meta.permissions.includes('wasm')) caps.push('<span class="cap-chip">WASM</span>');

    const upgradeNote = existing
      ? `<div class="consent-upgrade">Memperbarui plugin terpasang: v${esc(existing.version)} &rarr; v${esc(meta.version)}${existing.enabled === false ? ' (saat ini nonaktif)' : ''}${newPerms.length ? ' — <strong>meminta izin baru</strong>' : ''}</div>`
      : '';

    const fingerprint = meta.fingerprint
      ? `<div class="consent-fp">
          <span class="consent-fp-label">SHA-256 paket</span>
          <code class="consent-fp-value" title="Klik untuk menyalin">${esc(meta.fingerprint)}</code>
        </div>`
      : '';

    const newPermNote = newPerms.length
      ? `<div class="consent-newnote">Versi ini meminta izin yang belum pernah kamu setujui. Tinjau sebelum melanjutkan.</div>`
      : '';

    const hasNet = meta.permissions.includes('net');
    const noticeHtml = hasNet
      ? `<div class="consent-notice" style="border-color:rgba(248,113,113,0.4);background:rgba(248,113,113,0.08);color:#fca5a5">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
          <span>Plugin ini <strong>dapat mengakses internet</strong> dan mengirim permintaan ke server mana pun. Hanya pasang jika kamu memercayai sumbernya.</span>
        </div>`
      : `<div class="consent-notice">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          <span>Plugin berjalan di sandbox <strong>tanpa akses jaringan</strong> dan hanya bisa melakukan hal di atas. Batalkan jika tidak memercayai sumbernya.</span>
        </div>`;

    const body = `
      <div class="consent-identity">
        <div class="consent-pkg-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5h4.5a2.5 2.5 0 1 1 5 0H19v4.5a2.5 2.5 0 1 1 0 5V19h-4.5a2.5 2.5 0 1 0-5 0H5v-4.5a2.5 2.5 0 1 0 0-5z"/></svg>
        </div>
        <div class="consent-id-text">
          <div class="consent-name-row"><strong class="consent-name">${esc(meta.name)}</strong><span class="consent-version">v${esc(meta.version)}</span></div>
          ${meta.author ? `<div class="consent-author">oleh ${esc(meta.author)}</div>` : ''}
        </div>
      </div>
      ${meta.description ? `<p class="consent-desc">${esc(meta.description)}</p>` : ''}
      ${upgradeNote}
      ${newPermNote}
      <div class="consent-section-label">Meminta akses</div>
      <div class="consent-perms">${permList}</div>
      ${caps.length ? `<div class="consent-section-label">Kapabilitas</div><div class="consent-caps">${caps.join('')}</div>` : ''}
      ${fingerprint}
      ${noticeHtml}`;

    return Dialogs._create({
      title: review ? 'Setujui izin baru?' : 'Pasang plugin ini?',
      bodyHtml: body,
      confirmLabel: review ? 'Setujui' : (existing ? 'Perbarui' : 'Pasang Plugin'),
      cancelLabel: 'Batal',
      wide: true
    });
  }
};

function pluginFrameMain(token) {
  'use strict';
  let plug = null, api = null, settings = {}, globalSettings = {}, sharedSettings = {}, pluginId = '', seq = 0, panelMounted = false;
  const perms = new Set();
  const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const PANEL_BASE_CSS = '*{box-sizing:border-box}html,body{margin:0;height:100%}body{font:13px/1.5 -apple-system,system-ui,"Segoe UI",sans-serif;background:var(--surface,#141519);color:var(--ink,#f4f5f7)}';
  const pending = new Map();
  const listeners = new Map();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const post = m => parent.postMessage(Object.assign({ v: 1, t: token }, m), '*');
  const callHost = (method, args) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    post({ q: 'api', id, method, args: args || [] });
  });
  const needPerm = p => {
    if (!perms.has(p)) throw new Error('Izin "' + p + '" tidak diminta plugin ini di manifest.json — API terkait tidak tersedia.');
  };
  const gated = (perm, method) => (...args) => { needPerm(perm); return callHost(method, args); };

  const toWasmSource = source => {
    if (source instanceof Uint8Array) return source;
    if (source instanceof ArrayBuffer) return new Uint8Array(source);
    throw new Error('Sumber WASM harus Uint8Array atau ArrayBuffer (ambil dari api.asset()).');
  };
  const toWasmInput = input => {
    if (input == null) return new Uint8Array(0);
    if (typeof input === 'string') return encoder.encode(input);
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    throw new Error('Input WASM harus string, Uint8Array, atau ArrayBuffer.');
  };

  const wrapWasm = (mod, instance, imports) => {
    const ex = instance.exports;
    if (!ex || !(ex.memory instanceof WebAssembly.Memory)) throw new Error('Modul WASM harus mengekspor memory.');
    const allocFn = (typeof ex.alloc === 'function') ? ex.alloc
      : (typeof ex.malloc === 'function') ? ex.malloc : null;
    const marshal = v => {
      if (typeof v === 'number' || typeof v === 'bigint') return v;
      if (typeof v === 'string') return wrap.writeString(v).ptr;
      if (v instanceof Uint8Array) return wrap.writeBytes(v).ptr;
      if (v instanceof ArrayBuffer) return wrap.writeBytes(new Uint8Array(v)).ptr;
      if (v && typeof v === 'object' && Number.isInteger(v.ptr)) return v.ptr;
      if (v && typeof v === 'object' && typeof v.str === 'string') return wrap.writeString(v.str).ptr;
      throw new Error('Argumen WASM tidak didukung (number | bigint | string | Uint8Array | ArrayBuffer | {ptr} | {str}).');
    };
    const wrap = {
      instance, module: mod, exports: ex,
      get memory() { return ex.memory; },
      alloc(size) {
        if (!allocFn) throw new Error('Modul WASM harus mengekspor alloc(size) atau malloc(size).');
        return allocFn(size >>> 0);
      },
      free(ptr, size) { if (typeof ex.free === 'function') { try { ex.free(ptr, size); } catch {} } },
      writeBytes(data, ptr) {
        const b = toWasmInput(data);
        const p = Number.isInteger(ptr) ? ptr : wrap.alloc(b.length);
        new Uint8Array(ex.memory.buffer).set(b, p);
        return { ptr: p, len: b.length };
      },
      readBytes(ptr, len) {
        if (!Number.isInteger(ptr) || ptr < 0 || !Number.isInteger(len) || len < 0) throw new Error('ptr/len tidak valid.');
        if (ptr + len > ex.memory.buffer.byteLength) throw new Error('Pembacaan di luar batas memori WASM.');
        return new Uint8Array(ex.memory.buffer).slice(ptr, ptr + len);
      },
      readString(ptr, len) {
        if (!Number.isInteger(ptr) || ptr < 0) throw new Error('ptr tidak valid.');
        if (len == null) {
          const buf = new Uint8Array(ex.memory.buffer);
          if (ptr >= buf.length) throw new Error('ptr di luar memori WASM.');
          let end = ptr;
          while (end < buf.length && buf[end] !== 0) end++;
          return decoder.decode(buf.subarray(ptr, end));
        }
        return decoder.decode(wrap.readBytes(ptr, len));
      },
      writeString(str, ptr) {
        const b = encoder.encode(String(str ?? ''));
        const p = Number.isInteger(ptr) ? ptr : wrap.alloc(b.length + 1);
        const view = new Uint8Array(ex.memory.buffer);
        if (p + b.length + 1 > view.length) throw new Error('Ruang memori WASM tidak cukup untuk writeString.');
        view.set(b, p);
        view[p + b.length] = 0;
        return { ptr: p, len: b.length };
      },
      call(fn) {
        const f = ex[fn];
        if (typeof f !== 'function') throw new Error('Export "' + fn + '" tidak ditemukan di modul WASM.');
        return f.apply(null, Array.prototype.slice.call(arguments, 1).map(marshal));
      },
      callString(fn) {
        const ptr = Number(wrap.call.apply(wrap, arguments));
        return wrap.readString(ptr);
      },
      async reinstance(newImports) {
        const imp = newImports || imports || {};
        const inst = await WebAssembly.instantiate(mod, imp);
        return wrapWasm(mod, inst, imp);
      }
    };
    return wrap;
  };

  const decodeBuffer = (buf, encodings) => {
    const b = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
    const list = Array.isArray(encodings) && encodings.length ? encodings : ['utf-8', 'shift_jis', 'windows-31j', 'cp932'];
    for (const enc of list) {
      try { return new TextDecoder(enc, { fatal: true }).decode(b); } catch {}
    }
    return new TextDecoder('utf-8').decode(b);
  };

  const handlers = {
    init(m) {
      if (!m || typeof m.code !== 'string') throw new Error('Payload init plugin tidak valid.');
      pluginId = m.pluginId || '';
      settings = isPlainObject(m.settings) ? m.settings : {};
      globalSettings = isPlainObject(m.globalSettings) ? m.globalSettings : {};
      sharedSettings = isPlainObject(m.sharedSettings) ? m.sharedSettings : {};
      perms.clear();
      if (Array.isArray(m.permissions)) for (const p of m.permissions) perms.add(p);
      if (m.jszip) {
        const s = document.createElement('script');
        s.textContent = m.jszip;
        document.documentElement.appendChild(s);
      }
      const factory = new Function('module', 'exports', '"use strict";\n' + m.code + '\n;return module.exports;');
      const mod = { exports: {} };
      const out = factory(mod, mod.exports);
      if (!out || typeof out !== 'object') throw new Error('Plugin tidak mengekspor objek (module.exports).');
      plug = out;

      api = {
        version: 1,
        pluginId,
        get settings() { return settings; },
        get globalSettings() { return globalSettings; },
        get sharedSettings() { return sharedSettings; },
        toast: msg => callHost('toast', [msg]),
        copy: gated('clipboard', 'copy'),
        copySelection: gated('workspace', 'copySelection'),
        selectRange: gated('workspace', 'selectRange'),
        clearSelection: gated('workspace', 'clearSelection'),
        getSelection: gated('workspace', 'getSelection'),
        getProject: gated('project', 'getProject'),
        getLines: gated('project', 'getLines'),
        listAssets: () => callHost('listAssets', []),
        asset: path => callHost('asset', [path]),
        assetText: path => callHost('assetText', [path]),
        get JSZip() { return perms.has('jszip') ? (window.JSZip || null) : null; },
        wasm: async (source, imports) => {
          needPerm('wasm');
          const bytes = toWasmSource(source);
          const imp = imports && typeof imports === 'object' ? imports : {};
          const res = await WebAssembly.instantiate(bytes, imp);
          return wrapWasm(res.module, res.instance, imp);
        },
        runWasm: gated('wasm', 'runWasm'),
        pickFile: gated('files', 'pickFile'),
        download: gated('downloads', 'download'),
        decode: decodeBuffer,
        saveBlob: gated('storage', 'saveBlob'),
        loadBlob: gated('storage', 'loadBlob'),
        deleteBlob: gated('storage', 'deleteBlob'),
        listBlobs: gated('storage', 'listBlobs'),
        blobExists: gated('storage', 'blobExists'),
        fetch: (url, opts) => { needPerm('net'); return callHost('fetch', [url, opts && typeof opts === 'object' ? opts : {}]); },
        on: (event, handler) => {
          if (typeof handler !== 'function') return () => {};
          if ((event === 'copy' || event === 'apply') && !perms.has('hooks')) return () => {};
          if (!listeners.has(event)) listeners.set(event, new Set());
          const set = listeners.get(event);
          set.add(handler);
          return () => { try { set.delete(handler); } catch {} };
        }
      };

      const commands = [];
      if (plug.commands && typeof plug.commands === 'object') {
        for (const key of Object.keys(plug.commands)) {
          const cmd = plug.commands[key];
          if (cmd && typeof cmd === 'object' && typeof cmd.run === 'function') {
            commands.push({ key, label: String(cmd.label || key).slice(0, 80) });
          }
        }
      }
      return {
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
      settings = isPlainObject(m.settings) ? m.settings : {};
      globalSettings = isPlainObject(m.globalSettings) ? m.globalSettings : {};
      sharedSettings = isPlainObject(m.sharedSettings) ? m.sharedSettings : {};
    },
    hook(m) {
      const fn = plug ? plug[m.name] : null;
      if (typeof fn !== 'function') return null;
      return Promise.resolve(fn(m.text, m.ctx)).then(r => (typeof r === 'string' ? r : null));
    },
    extract(m) {
      if (!plug || typeof plug.extract !== 'function') throw new Error('Plugin tidak mendukung extract.');
      return Promise.resolve(plug.extract({ fileName: m.fileName, buffer: m.buffer, settings, globalSettings, sharedSettings, api })).then(out => {
        if (!out || !Array.isArray(out.lines)) throw new Error('Plugin tidak mengembalikan lines array.');
        return out;
      });
    },
    pack(m) {
      if (!plug || typeof plug.pack !== 'function') throw new Error('Plugin tidak mendukung pack.');
      return Promise.resolve(plug.pack({ lines: m.lines, sourceMap: m.sourceMap, projectName: m.projectName, settings, globalSettings, sharedSettings, api })).then(out => {
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
    if (e.source !== parent) return;
    const m = e.data;
    if (!m || typeof m !== 'object' || m.t !== token || m.v !== 1) return;
    if (m.q === 'res') {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.ok) p.resolve(m.val); else p.reject(new Error(m.err || 'RPC gagal.'));
      return;
    }
    if (m.q === 'call') {
      if (typeof m.method !== 'string' || typeof m.id !== 'number') return;
      const h = handlers[m.method];
      if (!h) { post({ q: 'res', id: m.id, ok: false, err: 'Perintah tidak dikenal: ' + m.method }); return; }
      Promise.resolve().then(() => h(m.arg || {})).then(
        val => post({ q: 'res', id: m.id, ok: true, val: val === undefined ? null : val }),
        err => post({ q: 'res', id: m.id, ok: false, err: String((err && err.message) || err) })
      );
    }
  });

  post({ q: 'ready' });
}

let host = null;

const Sandbox = {
  _bound: false,

  listen() {
    if (Sandbox._bound) return;
    Sandbox._bound = true;
    window.addEventListener('message', async e => {
      let inst = null;
      for (const i of Runtime._live) if (i.win === e.source) { inst = i; break; }
      if (!inst) return;
      const m = e.data;
      if (!m || typeof m !== 'object' || m.t !== inst.token || m.v !== 1) return;
      if (m.q === 'res') {
        if (typeof m.id !== 'number') return;
        const p = inst.pending.get(m.id);
        if (!p) return;
        inst.pending.delete(m.id);
        if (m.ok) p.resolve(m.val); else p.reject(new Error(m.err || 'RPC gagal.'));
        return;
      }
      if (m.q === 'ready') { inst.onReady(); return; }
      if (m.q === 'api') {
        if (typeof m.method !== 'string' || !Array.isArray(m.args) || typeof m.id !== 'number') return;
        const fn = Runtime._apiHandlers(inst)[m.method];
        if (typeof fn !== 'function') {
          inst.reply(m.id, false, new Error('Metode API tidak dikenal: ' + m.method));
          return;
        }
        try { inst.reply(m.id, true, await fn(...m.args)); }
        catch (err) { inst.reply(m.id, false, err); }
      }
    });
  },

  async boot(meta, code, zip, parentEl, jszipSrc) {
    Sandbox.listen();
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
    frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8">'
      + '<meta http-equiv="Content-Security-Policy" content="' + FRAME_CSP.replace(/"/g, '&quot;') + '">'
      + '</head><body><script>(' + pluginFrameMain.toString() + ')(' + JSON.stringify(token) + ');<\/script></body></html>';

    const inst = {
      frame,
      win: null,
      token,
      meta,
      zip,
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
      call(method, arg, timeoutMs) {
        return new Promise((resolve, reject) => {
          const id = ++inst.seq;
          const t = setTimeout(() => {
            inst.pending.delete(id);
            reject(new Error(`Plugin timeout: ${method} tidak merespons dalam ${Math.round((timeoutMs ?? CALL_TIMEOUT_DEFAULT_MS) / 1000)}s.`));
          }, timeoutMs ?? CALL_TIMEOUT_DEFAULT_MS);
          inst.pending.set(id, {
            resolve: v => { clearTimeout(t); resolve(v); },
            reject: e => { clearTimeout(t); reject(e); }
          });
          try { inst.win.postMessage({ v: 1, t: inst.token, q: 'call', id, method, arg }, '*'); }
          catch (err) { clearTimeout(t); inst.pending.delete(id); reject(err); }
        });
      },
      reply(id, ok, val) {
        const msg = { v: 1, t: inst.token, q: 'res', id, ok };
        if (ok) msg.val = val; else msg.err = String((val && val.message) || val);
        try { inst.win.postMessage(msg, '*'); }
        catch {
          try { inst.win.postMessage({ v: 1, t: inst.token, q: 'res', id, ok: false, err: 'Nilai API tidak dapat dikirim.' }, '*'); } catch {}
        }
      }
    };
    (parentEl || document.body).appendChild(frame);
    inst.win = frame.contentWindow;
    Runtime._live.add(inst);
    try {
      await Promise.race([
        ready,
        new Promise((_, rej) => setTimeout(() => rej(new Error('Plugin gagal dimuat (timeout boot).')), BOOT_TIMEOUT_MS))
      ]);
      const info = await inst.call('init', {
        pluginId: meta.id,
        apiVersion: PLUGIN_API_VERSION,
        code,
        settings: Runtime.valuesFor(meta),
        globalSettings: Runtime.globalValuesFor(meta),
        sharedSettings: Runtime.sharedValuesFor(meta),
        permissions: meta.permissions,
        jszip: meta.permissions.includes('jszip') ? jszipSrc : null
      }, BOOT_TIMEOUT_MS);
      inst.info = info;
      inst.theme = info.theme;
      inst.cmdMeta = info.commands || [];
      inst.hooks = info.hooks || { onCopy: false, onApply: false };
      inst.hasExtract = !!info.extract;
      inst.hasPack = !!info.pack;
      return inst;
    } catch (e) {
      Runtime._live.delete(inst);
      if (inst.panelCard) { try { inst.panelCard.remove(); } catch {} }
      try { frame.remove(); } catch {}
      throw e;
    }
  },

  destroy(inst) {
    Runtime._live.delete(inst);
    if (inst.panelCard) { try { inst.panelCard.remove(); } catch {} }
    let killed = false;
    const kill = () => { if (!killed) { killed = true; try { inst.frame.remove(); } catch {} } };
    setTimeout(kill, 300);
    inst.call('deactivate', {}).then(kill, kill);
  }
};

const Downloads = {
  _el: null,
  _hostEl: null,
  _bytesEl: null,
  _fillEl: null,
  _timer: null,
  _active: false,

  _ensure() {
    if (Downloads._el) return;
    const el = document.createElement('div');
    el.className = 'net-progress';
    el.innerHTML = '<div class="np-row"><div class="np-spin"></div><div class="np-text"><div class="np-host"></div><div class="np-bytes"></div></div></div><div class="np-bar"><div class="np-fill"></div></div>';
    document.body.appendChild(el);
    Downloads._el = el;
    Downloads._hostEl = el.querySelector('.np-host');
    Downloads._bytesEl = el.querySelector('.np-bytes');
    Downloads._fillEl = el.querySelector('.np-fill');
  },

  _fmt(n) { return humanBytes(n); },

  start(host, total) {
    Downloads._ensure();
    if (Downloads._timer) clearTimeout(Downloads._timer);
    Downloads._timer = setTimeout(() => {
      Downloads._timer = null;
      Downloads._active = true;
      Downloads._hostEl.textContent = host || 'mengunduh';
      Downloads._bytesEl.textContent = total ? '0 / ' + Downloads._fmt(total) : '0 B';
      Downloads._fillEl.style.width = total ? '0%' : '35%';
      Downloads._fillEl.classList.toggle('determinate', !!total);
      Downloads._el.classList.add('open');
    }, 350);
  },

  progress(received, total) {
    if (!Downloads._active) return;
    if (total) {
      Downloads._bytesEl.textContent = Downloads._fmt(received) + ' / ' + Downloads._fmt(total);
      Downloads._fillEl.style.width = Math.min(100, (received / total) * 100) + '%';
    } else {
      Downloads._bytesEl.textContent = Downloads._fmt(received);
    }
  },

  end() {
    if (Downloads._timer) { clearTimeout(Downloads._timer); Downloads._timer = null; return; }
    if (!Downloads._active) return;
    Downloads._active = false;
    if (Downloads._el) Downloads._el.classList.remove('open');
  }
};

const NetRunner = {
  _isPrivateHost(h) {
    if (!h) return true;
    const s = h.toLowerCase().replace(/^\[|\]$/g, '');
    if (s === 'localhost' || s.endsWith('.localhost')) return true;
    if (s === '0.0.0.0' || s === '::' || s === '::1' || s === '0000:0000:0000:0000:0000:0000:0000:0001') return true;
    let m = s.match(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) return NetRunner._isPrivateHost(`${m[1]}.${m[2]}.${m[3]}.${m[4]}`);
    if (/^::ffff:/.test(s) || /^::ffff:0:/.test(s)) return true;
    m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) {
      const a = +m[1], b = +m[2];
      if (a === 0 || a === 10 || a === 127 || a >= 240) return true;
      if (a === 169 && b === 254) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 100 && b >= 64 && b <= 127) return true;
      return false;
    }
    if (/^fe[89ab][0-9a-f]:/.test(s)) return true;
    if (/^fd[0-9a-f]{2}:/.test(s)) return true;
    if (/^64:ff9b:1?:/.test(s)) return true;
    return false;
  },

  _validateUrl(raw) {
    if (typeof raw !== 'string' || !raw) throw new Error('URL tidak valid.');
    let u;
    try { u = new URL(raw); } catch { throw new Error('URL tidak valid.'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Hanya http/https diperbolehkan.');
    if (NetRunner._isPrivateHost(u.hostname)) throw new Error('Host lokal/private tidak diperbolehkan.');
    return u;
  },

  _normalizeHeaders(raw) {
    const out = {};
    if (!isPlainObject(raw)) return out;
    for (const [k, v] of Object.entries(raw)) {
      if (typeof k !== 'string' || !k) continue;
      const lk = k.toLowerCase();
      if (lk === 'host' || lk === 'content-length' || lk === 'connection' || lk === 'cookie' || lk === 'set-cookie' || lk === 'upgrade' || lk === 'te' || lk === 'trailer' || lk === 'transfer-encoding') continue;
      out[k] = String(v).slice(0, 8192);
    }
    return out;
  },

  _normalizeBody(raw) {
    if (raw == null) return null;
    if (typeof raw === 'string') return raw;
    if (raw instanceof Uint8Array) return raw;
    if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
    if (isPlainObject(raw)) return JSON.stringify(raw);
    throw new Error('Body harus string, Uint8Array, ArrayBuffer, atau objek.');
  },

  _timeout(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 1000) return NET_TIMEOUT_DEFAULT_MS;
    return Math.round(n);
  },

  _rangeHeader(range) {
    if (range == null) return null;
    if (typeof range === 'string') {
      const s = range.trim();
      if (!s) return null;
      return s.startsWith('bytes=') ? s : 'bytes=' + s;
    }
    if (Array.isArray(range)) {
      const a = Number(range[0]);
      const b = Number(range[1]);
      if (!Number.isFinite(a) || a < 0) throw new Error('Range tidak valid.');
      if (range.length < 2 || !Number.isFinite(b)) return 'bytes=' + Math.round(a) + '-';
      if (b < a) throw new Error('Range tidak valid.');
      return 'bytes=' + Math.round(a) + '-' + Math.round(b);
    }
    throw new Error('Range tidak valid.');
  },

  async fetch(rawUrl, opts) {
    const o = isPlainObject(opts) ? opts : {};
    const u = NetRunner._validateUrl(rawUrl);
    const method = (typeof o.method === 'string' ? o.method : 'GET').toUpperCase();
    if (!NET_METHODS.has(method)) throw new Error('Metode tidak didukung.');
    const headers = NetRunner._normalizeHeaders(o.headers);
    const rangeH = NetRunner._rangeHeader(o.range);
    if (rangeH) headers.Range = rangeH;
    const body = NetRunner._normalizeBody(o.body);
    const as = o.as === 'bytes' ? 'bytes' : 'text';
    const silent = !!o.silent;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), NetRunner._timeout(o.timeoutMs));
    let res;
    try {
      res = await fetch(u.href, { method, headers, body, signal: ctrl.signal, redirect: 'follow', credentials: 'omit', cache: 'no-store', referrer: '', referrerPolicy: 'no-referrer' });
    } catch (err) {
      clearTimeout(timer);
      throw new Error('Permintaan gagal: ' + (err?.name === 'AbortError' ? 'timeout' : (err?.message || String(err))));
    }
    clearTimeout(timer);
    NetRunner._validateUrl(res.url);
    const headersOut = {};
    res.headers.forEach((v, k) => { headersOut[k] = v; });
    const total = Number(res.headers.get('content-length') || 0) || null;
    const showProgress = !silent && (total == null || total >= 100 * 1024);
    if (showProgress) Downloads.start(u.hostname, total);
    let received = 0;
    let buf;
    try {
      const reader = res.body?.getReader();
      if (reader) {
        const chunks = [];
        while (true) {
          const r = await reader.read();
          if (r.done) break;
          if (r.value) {
            chunks.push(r.value);
            received += r.value.length;
            if (showProgress) Downloads.progress(received, total);
          }
        }
        buf = new Uint8Array(received);
        let off = 0;
        for (const c of chunks) { buf.set(c, off); off += c.length; }
      } else {
        buf = new Uint8Array(await res.arrayBuffer());
      }
    } catch (err) {
      ctrl.abort();
      if (showProgress) Downloads.end();
      throw new Error('Stream terputus: ' + (err?.message || String(err)));
    }
    if (showProgress) Downloads.end();
    if (as === 'bytes') {
      return { ok: res.ok, status: res.status, statusText: res.statusText, url: res.url, headers: headersOut, body: buf };
    }
    return { ok: res.ok, status: res.status, statusText: res.statusText, url: res.url, headers: headersOut, body: new TextDecoder('utf-8').decode(buf) };
  }
};

const WasmRunner = {
  _workerUrl: null,
  _moduleCache: new Map(),

  workerUrl() {
    if (!WasmRunner._workerUrl) {
      const src = '"use strict";'
        + 'self.onmessage=async(e)=>{'
        + 'const d=e.data||{};'
        + 'const done=(m)=>{try{self.postMessage(m);}catch(_){}};'
        + 'try{'
        + 'let instance;'
        + 'if(d.module instanceof WebAssembly.Module){instance=await WebAssembly.instantiate(d.module,{});}'
        + 'else{const r=await WebAssembly.instantiate(d.src,{});instance=r.instance;}'
        + 'const ex=instance.exports;'
        + 'if(!ex||!(ex.memory instanceof WebAssembly.Memory))throw new Error("Modul WASM harus mengekspor memory.");'
        + 'const alloc=(typeof ex.alloc==="function")?ex.alloc:(typeof ex.malloc==="function")?ex.malloc:null;'
        + 'if(!alloc)throw new Error("Modul WASM harus mengekspor alloc(size) atau malloc(size).");'
        + 'if(typeof ex[d.fn]!=="function")throw new Error(\'Export "\'+d.fn+\'" tidak ditemukan.\');'
        + 'const input=d.input||new Uint8Array(0);'
        + 'const inPtr=alloc(input.length);'
        + 'new Uint8Array(ex.memory.buffer).set(input,inPtr);'
        + 'const resPtr=ex[d.fn](inPtr,input.length);'
        + 'if(!Number.isInteger(resPtr)||resPtr<0)throw new Error("Hasil fungsi WASM tidak valid.");'
        + 'const dv=new DataView(ex.memory.buffer);'
        + 'if(resPtr+4>ex.memory.buffer.byteLength)throw new Error("Pointer hasil di luar memori WASM.");'
        + 'const outLen=dv.getUint32(resPtr,true);'
        + 'if(resPtr+4+outLen>ex.memory.buffer.byteLength)throw new Error("Panjang hasil WASM di luar memori.");'
        + 'const out=new Uint8Array(ex.memory.buffer).slice(resPtr+4,resPtr+4+outLen);'
        + 'if(typeof ex.free==="function"){try{ex.free(inPtr,input.length);}catch(_){try{ex.free(inPtr);}catch(__){}}'
        + 'try{ex.free(resPtr,outLen+4);}catch(_){try{ex.free(resPtr);}catch(__){}}}'
        + 'done({ok:true,output:out});'
        + '}catch(err){done({ok:false,error:String(err&&err.message||err)});}};';
      WasmRunner._workerUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    }
    return WasmRunner._workerUrl;
  },

  async moduleFor(bytes) {
    const key = fnv1a(bytes) + ':' + bytes.length;
    const cached = WasmRunner._moduleCache.get(key);
    if (cached) {
      WasmRunner._moduleCache.delete(key);
      WasmRunner._moduleCache.set(key, cached);
      return cached;
    }
    let mod;
    try { mod = await WebAssembly.compile(bytes); }
    catch (e) { throw new Error('Kompilasi modul WASM gagal: ' + (e?.message || e)); }
    WasmRunner._moduleCache.set(key, mod);
    while (WasmRunner._moduleCache.size > WASM_MODULE_CACHE_MAX) {
      const oldest = WasmRunner._moduleCache.keys().next().value;
      WasmRunner._moduleCache.delete(oldest);
    }
    return mod;
  },

  async run(source, fn, input, opts) {
    const bytes = source instanceof Uint8Array ? source
      : source instanceof ArrayBuffer ? new Uint8Array(source)
      : null;
    if (!bytes) throw new Error('Sumber WASM harus Uint8Array atau ArrayBuffer (ambil dari api.asset()).');
    if (typeof fn !== 'string' || !fn) throw new Error('Nama fungsi WASM tidak valid.');
    let inputBytes;
    if (input == null) inputBytes = new Uint8Array(0);
    else if (typeof input === 'string') inputBytes = new TextEncoder().encode(input);
    else if (input instanceof Uint8Array) inputBytes = input;
    else if (input instanceof ArrayBuffer) inputBytes = new Uint8Array(input);
    else throw new Error('Input WASM harus string, Uint8Array, atau ArrayBuffer.');

    const timeoutMs = clampInt(opts?.timeoutMs, WASM_TIMEOUT_MIN, WASM_TIMEOUT_MAX, WASM_TIMEOUT_DEFAULT);
    const mod = await WasmRunner.moduleFor(bytes);

    return new Promise((resolve, reject) => {
      let worker;
      try { worker = new Worker(WasmRunner.workerUrl()); }
      catch (err) {
        reject(new Error('Worker WASM tidak dapat dibuat: ' + String((err && err.message) || err)));
        return;
      }
      let timer = setTimeout(() => {
        worker.terminate();
        reject(new Error(`runWasm melebihi batas waktu ${timeoutMs} ms — eksekusi dibatalkan.`));
      }, timeoutMs);
      worker.onmessage = ev => {
        clearTimeout(timer);
        worker.terminate();
        const d = ev.data || {};
        if (d.ok) resolve(d.output);
        else reject(new Error(d.error || 'runWasm gagal.'));
      };
      worker.onerror = ev => {
        clearTimeout(timer);
        worker.terminate();
        reject(new Error(ev.message || 'runWasm gagal.'));
      };
      try {
        worker.postMessage({ module: mod, fn, input: inputBytes }, [inputBytes.buffer]);
      } catch (err) {
        clearTimeout(timer);
        worker.terminate();
        reject(err);
      }
    });
  }
};

const Runtime = {
  _index: [],
  _instances: new Map(),
  _rateStore: new Map(),
  _live: new Set(),
  _jszipSrc: null,
  _styleEl: null,
  _lastThemeCss: null,
  _sigCache: new WeakMap(),

  listMeta() { return Runtime._index.slice(); },
  getMeta(id) { return Runtime._index.find(p => p.id === id) || null; },

  async _persist() { await host.storage.writePluginIndex(Runtime._index); },

  async _loadStore() {
    const raw = await host.storage.readPluginSettings();
    const store = isPlainObject(raw) ? raw : {};
    for (const k of Object.keys(store)) {
      const e = store[k];
      if (!isPlainObject(e)) { delete store[k]; continue; }
      for (const sc of ['global', 'shared']) {
        if (e[sc] !== undefined && !isPlainObject(e[sc])) delete e[sc];
      }
    }
    Runtime._store = store;
  },

  async _saveStore() {
    try { await host.storage.writePluginSettings(Runtime._store); }
    catch (e) { console.error('[plugins] gagal menyimpan setelan:', e); }
  },

  async init() {
    await Runtime._loadStore();
    const raw = await host.storage.readPluginIndex();
    const list = Array.isArray(raw) ? raw : [];
    const valid = list.filter(p => p && p.schema === INDEX_SCHEMA && typeof p.id === 'string' && Array.isArray(p.files));
    for (const meta of valid) {
      meta.granted = Array.isArray(meta.granted) ? meta.granted.filter(p => PERMISSION_IDS.includes(p)) : [];
    }
    const dropped = list.length - valid.length;
    if (dropped > 0) {
      console.warn(`[plugins] ${dropped} entri format lama dihapus. Pasang ulang paket .zip baru.`);
    }
    Runtime._index = valid;
    await Runtime._sweepOrphanPacks();
    if (dropped > 0) await Runtime._persist();
    await Runtime.sync();
    let dirty = false;
    for (const meta of Runtime._index) {
      if (meta.enabled !== true) continue;
      try { await Runtime._activate(meta); }
      catch (e) {
        console.error(`[plugin:${meta.id}] gagal diaktifkan:`, e);
        meta.enabled = false;
        dirty = true;
      }
    }
    if (dirty) await Runtime._persist();
    Runtime.applyTheme();
    host.ui.onPluginsChanged();
  },

  async sync() {
    let changed = false;
    const alive = [];
    for (const meta of Runtime._index) {
      try {
        const exists = await host.storage.pluginZipExists(meta.id);
        if (exists) alive.push(meta);
        else { Runtime._deactivate(meta.id); changed = true; }
      } catch {
        Runtime._deactivate(meta.id);
        changed = true;
      }
    }
    if (!changed) return false;
    Runtime._index = alive;
    await Runtime._persist();
    Runtime.applyTheme();
    host.ui.onPluginsChanged();
    return true;
  },

  async _sweepOrphanPacks() {
    try {
      const names = await host.storage.listPluginFiles();
      const installed = new Set(Runtime._index.map(p => p.id));
      for (const { id, name } of names) {
        if (installed.has(id)) continue;
        try { await host.storage.removePluginFile(id); } catch {}
      }
    } catch {}
  },

  valuesFor(meta) {
    const vals = host.state.pluginSettings();
    const v = (vals && typeof vals[meta.id] === 'object' && vals[meta.id]) ? vals[meta.id] : {};
    const out = {};
    for (const s of (meta.settings?.project || [])) out[s.key] = (s.key in v) ? v[s.key] : s.default;
    return out;
  },

  globalValuesFor(meta) {
    const entry = isPlainObject(Runtime._store[meta.id]) ? Runtime._store[meta.id] : {};
    const v = isPlainObject(entry.global) ? entry.global : {};
    const out = {};
    for (const s of (meta.settings?.global || [])) out[s.key] = (s.key in v) ? v[s.key] : s.default;
    return out;
  },

  sharedValuesFor(meta) {
    const entry = isPlainObject(Runtime._store[meta.id]) ? Runtime._store[meta.id] : {};
    const v = isPlainObject(entry.shared) ? entry.shared : {};
    const out = {};
    for (const s of (meta.settings?.shared || [])) out[s.key] = (s.key in v) ? v[s.key] : s.default;
    return out;
  },

  _setValues(id, values) {
    const next = { ...(host.state.pluginSettings() || {}) };
    if (values && typeof values === 'object' && Object.keys(values).length) next[id] = values;
    else delete next[id];
    host.state.setPluginSettings(next);
    host.state.queueSave();
    Runtime.syncSettings();
  },

  _setScopeValues(id, scope, values) {
    const entry = isPlainObject(Runtime._store[id]) ? { ...Runtime._store[id] } : {};
    if (values && typeof values === 'object' && Object.keys(values).length) entry[scope] = values;
    else delete entry[scope];
    if (Object.keys(entry).length) Runtime._store[id] = entry;
    else delete Runtime._store[id];
    Runtime._saveStore();
    Runtime.syncSettings();
  },

  _setGlobalValues(id, values) { Runtime._setScopeValues(id, 'global', values); },

  _setSharedValues(id, values) { Runtime._setScopeValues(id, 'shared', values); },

  syncSettings() {
    for (const inst of Runtime._instances.values()) {
      inst.call('settings', {
        settings: Runtime.valuesFor(inst.meta),
        globalSettings: Runtime.globalValuesFor(inst.meta),
        sharedSettings: Runtime.sharedValuesFor(inst.meta)
      }).catch(() => {});
    }
  },

  _assertGranted(meta) {
    const granted = new Set(Array.isArray(meta.granted) ? meta.granted : []);
    const missing = meta.permissions.filter(p => !granted.has(p));
    if (missing.length) {
      throw new Error(`Izin belum disetujui (${missing.map(p => PERMISSIONS[p]?.label || p).join(', ')}) — buka Plugin Manager lalu "Setujui Izin".`);
    }
  },

  async _activate(meta) {
    Runtime._assertGranted(meta);
    const zipFile = await host.storage.pluginZipFile(meta.id);
    const zip = await ZipReader.open(zipFile);
    const code = await zip.readText(ENTRY_FILE);

    let jszipSrc = null;
    if (meta.permissions.includes('jszip')) {
      jszipSrc = await Runtime._jszipText();
    }
    const panelHostEl = meta.ui ? PluginUI.panelHost(meta) : null;
    const inst = await Sandbox.boot(meta, code, zip, panelHostEl && panelHostEl.body, jszipSrc);
    Runtime._instances.set(meta.id, inst);
    try {
      await inst.call('activate', {});
    } catch (e) {
      Runtime._instances.delete(meta.id);
      Sandbox.destroy(inst);
      throw e;
    }
    if (panelHostEl) PluginUI.wirePanel(inst, panelHostEl);
    Runtime.syncSettings();
  },

  async _jszipText() {
    if (!Runtime._jszipSrc) {
      const res = await fetch(host.jszipUrl);
      if (!res.ok) throw new Error('Gagal memuat sumber JSZip.');
      Runtime._jszipSrc = await res.text();
    }
    return Runtime._jszipSrc;
  },

  _deactivate(id) {
    const inst = Runtime._instances.get(id);
    if (!inst) return;
    Runtime._instances.delete(id);
    Sandbox.destroy(inst);
  },

  async setEnabled(id, enabled) {
    const meta = Runtime.getMeta(id);
    if (!meta) return false;
    if (enabled) {
      try { await Runtime._activate(meta); }
      catch (e) {
        await Dialogs.info('Gagal mengaktifkan plugin', `<p class="hint m-0">${esc(`Plugin "${meta.name}" gagal diaktifkan.`)}</p><p class="mono cstl-err-detail">${esc(e?.message || String(e))}</p>`);
        PluginUI.renderList();
        return false;
      }
    } else {
      Runtime._deactivate(id);
    }
    meta.enabled = !!enabled;
    await Runtime._persist();
    Runtime.applyTheme();
    host.ui.onPluginsChanged();
    return true;
  },

  applyTheme() {
    if (!Runtime._styleEl) {
      Runtime._styleEl = document.createElement('style');
      Runtime._styleEl.id = 'pluginTheme';
      document.head.appendChild(Runtime._styleEl);
    }
    const parts = [];
    for (const inst of Runtime._instances.values()) {
      if (inst.theme && inst.theme.trim() && inst.meta.permissions.includes('theme')) parts.push(sanitizeThemeCss(inst.theme));
    }
    const css = parts.join('\n');
    Runtime._styleEl.textContent = css;
    if (css !== Runtime._lastThemeCss) {
      Runtime._lastThemeCss = css;
      const vars = host.ui.themeVarsCss();
      for (const inst of Runtime._instances.values()) {
        if (inst.panelCard) inst.call('panel', { theme: vars }).catch(() => {});
      }
    }
  },

  async install(file) {
    if (!file || typeof file.slice !== 'function' || typeof file.stream !== 'function' || typeof file.arrayBuffer !== 'function') throw new Error('File plugin tidak valid.');
    const name = String(file.name || '');
    if (!/\.zip$/i.test(name)) throw new Error('Plugin harus berupa paket .zip yang berisi manifest.json dan plugin.js di root.');

    host.util.progress.show('Memeriksa paket plugin...', 'Membaca manifest.json...');

    let meta, zip;
    try {
      zip = await ZipReader.open(file).catch(() => { throw new Error('File .zip tidak valid atau rusak.'); });
      if (!zip.has(MANIFEST_FILE)) {
        throw new Error(`${MANIFEST_FILE} tidak ditemukan di root paket. Struktur standar: paket .zip berisi ${MANIFEST_FILE} + ${ENTRY_FILE} (lihat PLUGIN.md).`);
      }
      const manifestText = await zip.readText(MANIFEST_FILE);

      const parsed = Manifest.parse(manifestText);
      if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
      const errors = Manifest.validate(parsed.data);
      if (errors.length) throw new Error('Manifest tidak valid:\n- ' + errors.join('\n- '));

      if (!zip.has(ENTRY_FILE)) throw new Error(`${ENTRY_FILE} tidak ditemukan di root paket — wajib sebagai entry point.`);

      const files = zip.names().filter(nm => nm !== MANIFEST_FILE && nm !== ENTRY_FILE).sort();

      const fingerprint = await sha256HexOfBlob(file);
      meta = Manifest.normalize(parsed.data, files, {
        fingerprint,
        size: file.size,
        updatedAt: Date.now()
      });
    } finally {
      host.util.progress.hide();
    }

    const existing = Runtime.getMeta(meta.id);
    const prevGranted = Array.isArray(existing?.granted) ? existing.granted : [];
    const newPerms = meta.permissions.filter(p => !prevGranted.includes(p));

    if (!existing || newPerms.length) {
      const approved = await Dialogs.consent(meta, { existing, newPerms });
      if (!approved) return null;
      meta.granted = meta.permissions.slice();
    } else {
      meta.granted = existing.granted.slice();
    }

    host.util.progress.show('Memasang plugin...', 'Menyimpan paket...');
    try {
      await host.storage.savePluginZipStream(meta.id, file);
      meta.enabled = existing ? existing.enabled === true : true;
      const i = Runtime._index.findIndex(p => p.id === meta.id);
      if (i >= 0) Runtime._index[i] = meta; else Runtime._index.push(meta);

      Runtime._deactivate(meta.id);
      if (meta.enabled) {
        try {
          await Runtime._activate(meta);
        } catch (e) {
          Runtime._instances.delete(meta.id);
          meta.enabled = false;
          host.ui.flash(`Plugin "${meta.name}" gagal diaktifkan: ${e?.message || e}`);
        }
      }
      await Runtime._persist();
      Runtime.applyTheme();
      host.ui.onPluginsChanged();
      if (existing && !newPerms.length) host.ui.flash(`Plugin "${meta.name}" diperbarui ke v${meta.version}.`);
      return meta;
    } finally {
      host.util.progress.hide();
    }
  },

  async uninstall(id) {
    const meta = Runtime.getMeta(id);
    if (!meta) throw new Error('Plugin tidak ditemukan.');
    const linked = (await host.storage.listProjects()).filter(p => p.projectType === 'plugin' && p.pluginId === id);
    const linkedNote = linked.length
      ? `<p>${linked.length} project terkait tetap tersimpan beserta datanya — cukup pasang ulang plugin ini untuk membukanya kembali. Datanya baru dihapus kalau project-nya dihapus.</p>`
      : '';
    const ok = await Dialogs.confirm({
      title: 'Hapus plugin?',
      danger: true,
      confirmLabel: 'Hapus',
      bodyHtml: `<p>Plugin <strong>${esc(meta.name)}</strong> v${esc(meta.version)} akan dihapus.</p>${linkedNote}`
    });
    if (!ok) return false;

    Runtime._deactivate(id);
    for (const p of linked) {
      try {
        const data = await host.storage.loadProject(p.id);
        if (data && !data.pluginName) {
          data.pluginName = meta.name;
          await host.storage.saveProject(p.id, data);
        }
      } catch {}
    }
    await host.storage.removePluginFile(id);
    Runtime._rateStore.delete(id);
    delete Runtime._store[id];
    await Runtime._saveStore();
    Runtime._index = Runtime._index.filter(p => p.id !== id);
    await Runtime._persist();
    Runtime.applyTheme();
    host.ui.onPluginsChanged();
    return true;
  },

  _rateOk(id, key, max) {
    const now = Date.now();
    let bucket = Runtime._rateStore.get(id);
    if (!bucket) {
      bucket = {};
      Runtime._rateStore.set(id, bucket);
    }
    const arr = (bucket[key] ||= []).filter(t => now - t < 60000);
    bucket[key] = arr;
    if (arr.length >= max) return false;
    arr.push(now);
    return true;
  },

  _apiHandlers(inst) {
    const perms = new Set(inst.meta.permissions || []);
    const gate = (perm, fn) => (...args) => {
      if (!perms.has(perm)) {
        throw new Error(`Akses ditolak: plugin tidak mengklaim izin "${perm}" di manifest.json.`);
      }
      return fn(...args);
    };

    return {
      toast: msg => {
        if (!Runtime._rateOk(inst.meta.id, 'toast', RATE_TOAST_PER_MIN)) throw new Error('Terlalu banyak notifikasi — coba lagi sebentar lagi.');
        host.ui.flash(String(msg ?? ''));
      },
      copy: gate('clipboard', text => host.util.clipboard(String(text ?? ''))),
      copySelection: gate('workspace', () => host.state.copyForAi()),
      selectRange: gate('workspace', (from, to) => {
        const f = Number(from), t = Number(to);
        if (!Number.isInteger(f) || !Number.isInteger(t) || f < 1 || t < f || t - f > 1000000) throw new Error('Rentang baris tidak valid.');
        host.state.selectRangeUI(f, t);
      }),
      clearSelection: gate('workspace', () => host.state.clearSelection()),
      getSelection: gate('workspace', () => host.state.selection()),
      getProject: gate('project', () => host.state.projectInfo()),
      getLines: gate('project', () => host.state.lines().map(Runtime.toPluginLine)),
      listAssets: () => inst.meta.files.slice(),
      asset: async path => Runtime._readAsset(inst, path, 'uint8array'),
      assetText: async path => Runtime._readAsset(inst, path, 'string'),

      runWasm: gate('wasm', (source, fn, input, opts) => {
        return WasmRunner.run(source, fn, input, opts && typeof opts === 'object' ? opts : {});
      }),
      pickFile: gate('files', accept => Runtime.pickFile(accept)),
      download: gate('downloads', (data, filename) => {
        if (!Runtime._rateOk(inst.meta.id, 'download', RATE_DOWNLOAD_PER_MIN)) throw new Error('Terlalu banyak unduhan — coba lagi sebentar lagi.');
        return Runtime.download(data, filename);
      }),
      saveBlob: gate('storage', (key, data) => {
        if (!validBlobKey(key)) throw new Error('Key blob tidak valid.');
        if (!host.state.projectId()) throw new Error('Tidak ada project aktif untuk menyimpan blob.');
        return host.storage.saveBlob(inst.meta.id, key, data);
      }),
      loadBlob: gate('storage', key => {
        if (!validBlobKey(key)) return null;
        if (!host.state.projectId()) return null;
        return host.storage.loadBlob(inst.meta.id, key);
      }),
      deleteBlob: gate('storage', key => {
        if (!validBlobKey(key)) return;
        if (!host.state.projectId()) return;
        return host.storage.deleteBlob(inst.meta.id, key);
      }),
      listBlobs: gate('storage', () => {
        if (!host.state.projectId()) return [];
        return host.storage.listBlobs(inst.meta.id);
      }),
      blobExists: gate('storage', key => {
        if (!validBlobKey(key)) return false;
        if (!host.state.projectId()) return false;
        return host.storage.blobExists(inst.meta.id, key);
      }),
      fetch: gate('net', (url, opts) => {
        if (!Runtime._rateOk(inst.meta.id, 'fetch', RATE_FETCH_PER_MIN)) throw new Error('Terlalu banyak permintaan jaringan — coba lagi sebentar lagi.');
        return NetRunner.fetch(url, opts);
      })
    };
  },

  async _readAsset(inst, path, type) {
    const p = String(path ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    if (!p || p.split('/').some(seg => seg === '..' || seg === '')) throw new Error(`Path asset tidak valid: "${path}"`);
    if (!inst.zip.has(p)) throw new Error(`Asset "${p}" tidak ditemukan di paket.`);
    if (type === 'uint8array') return inst.zip.readBytes(p);
    return inst.zip.readText(p);
  },

  pickFile(accept) {
    return new Promise(resolve => {
      const inp = document.createElement('input');
      inp.type = 'file';
      if (accept && typeof accept === 'string') inp.accept = accept.slice(0, 200);
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
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sanitizeFilename(filename);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },

  resolveByExtension(fileName) {
    const name = String(fileName || '');
    const dot = name.lastIndexOf('.');
    if (dot < 0) return null;
    const ext = name.slice(dot).toLowerCase();
    return Runtime._index.find(p => p.enabled === true && (p.extensions || []).some(e => String(e).toLowerCase() === ext)) || null;
  },

  resolveByMagic(head) {
    if (!(head instanceof Uint8Array) || !head.length) return null;
    for (const p of Runtime._index) {
      if (p.enabled !== true || !(p.magic || []).length) continue;
      let sigs = Runtime._sigCache.get(p);
      if (!sigs) {
        sigs = p.magic.map(raw => {
          const bytes = new Uint8Array(raw.hex.length / 2);
          for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(raw.hex.substr(i * 2, 2), 16);
          return { bytes, offset: raw.offset || 0 };
        });
        Runtime._sigCache.set(p, sigs);
      }
      for (const sig of sigs) {
        if (sig.offset + sig.bytes.length <= head.length && sig.bytes.every((b, i) => head[sig.offset + i] === b)) return p;
      }
    }
    return null;
  },

  activeParserInfo() {
    const exts = new Set(['.json', '.epub']);
    let magic = false;
    for (const p of Runtime._index) {
      if (p.enabled !== true) continue;
      for (const e of (p.extensions || [])) exts.add(String(e).toLowerCase());
      if ((p.magic || []).length) magic = true;
    }
    return { extensions: exts, magic };
  },

  _hookCtx() {
    const info = host.state.projectInfo();
    return {
      projectName: info?.name || null,
      lineCount: info?.lineCount || 0,
      translatedCount: info?.translatedCount || 0,
      selectedLines: host.state.selection()
    };
  },

  async runCopyHook(text) {
    let out = text;
    for (const inst of Runtime._instances.values()) {
      if (!inst.hooks.onCopy) continue;
      if (!inst.meta.permissions.includes('hooks')) continue;
      try {
        const r = await inst.call('hook', { name: 'onCopy', text: out, ctx: Runtime._hookCtx() });
        if (typeof r === 'string') out = r;
      } catch (e) { Runtime._fail(inst.meta, e); }
    }
    return out;
  },

  async runApplyHook(text) {
    let out = text;
    for (const inst of Runtime._instances.values()) {
      if (!inst.hooks.onApply) continue;
      if (!inst.meta.permissions.includes('hooks')) continue;
      try {
        const r = await inst.call('hook', { name: 'onApply', text: out, ctx: Runtime._hookCtx() });
        if (typeof r === 'string') out = r;
      } catch (e) { Runtime._fail(inst.meta, e); }
    }
    return out;
  },

  emit(event, payload) {
    for (const inst of Runtime._instances.values()) {
      inst.call('emit', { event, payload }).catch(() => {});
    }
  },

  commands() {
    const out = [];
    for (const inst of Runtime._instances.values()) {
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
    const cmd = Runtime.commands().find(c => c.id === id);
    if (!cmd) return;
    try { await cmd.run(); }
    catch (e) { Runtime._fail({ id, name: cmd.pluginName }, e); }
  },

  async callExtract(meta, input) {
    const inst = Runtime._instances.get(meta.id);
    if (!inst) throw new Error(`Plugin "${meta.name}" tidak aktif.`);
    if (!inst.hasExtract) throw new Error(`Plugin "${meta.name}" tidak mendukung extract.`);
    const out = await inst.call('extract', { fileName: input.fileName, buffer: input.buffer }, 120000);
    if (!out || !Array.isArray(out.lines)) throw new Error(`Plugin "${meta.name}" tidak mengembalikan lines array.`);
    return out;
  },

  async callPack(meta, input) {
    const inst = Runtime._instances.get(meta.id);
    if (!inst) throw new Error(`Plugin "${meta.name}" tidak aktif.`);
    if (!inst.hasPack) throw new Error(`Plugin "${meta.name}" tidak mendukung pack.`);
    const out = await inst.call('pack', { lines: input.lines, sourceMap: input.sourceMap, projectName: input.projectName }, 120000);
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

  onProjectOpened() {
    Runtime.applyTheme();
    Runtime.syncSettings();
    host.ui.onPluginsChanged();
    const info = host.state.projectInfo();
    Runtime.emit('projectOpen', info ? {
      name: info.name, type: info.type, lineCount: info.lineCount, translatedCount: info.translatedCount
    } : null);
  },

  onProjectClosed() {
    Runtime.emit('projectClose', null);
    Runtime.applyTheme();
    Runtime.syncSettings();
    host.ui.onPluginsChanged();
  },

  _fail(meta, e) {
    console.error(`[plugin:${meta?.id || '?'}]`, e);
    host.ui.flash(`Plugin "${meta?.name || '?'}" error: ${e?.message || e}`);
  }
};

let ui = null;

const PluginUI = {

  bind() {
    ui.btnPluginManagerOpen.addEventListener('click', PluginUI.openManager);
    ui.btnPluginManagerClose.addEventListener('click', PluginUI.closeManager);
    ui.btnPluginRefresh.addEventListener('click', async () => {
      await Runtime.sync();
      PluginUI.renderList();
      host.ui.flash('Daftar plugin dimuat ulang.');
    });
    ui.btnInstallPlugin.addEventListener('click', () => ui.pluginFileInput.click());
    ui.pluginFileInput.addEventListener('change', async e => {
      if (!e.target.files.length) { e.target.value = ''; return; }
      await PluginUI.installFlow(e.target.files[0]);
      e.target.value = '';
    });

    const list = ui.pluginList;
    if (list) {
      list.addEventListener('dragover', e => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          list.classList.add('dragover');
        }
      });
      list.addEventListener('dragleave', e => {
        if (e.target === list) list.classList.remove('dragover');
      });
      list.addEventListener('drop', async e => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        list.classList.remove('dragover');
        for (const f of Array.from(e.dataTransfer.files)) {
          if (/\.zip$/i.test(f.name)) {
            await PluginUI.installFlow(f);
            break;
          }
        }
      });
    }

    ui.btnOpenPlugins.addEventListener('click', () => PluginUI.renderMenu());
    ui.pluginMenu.addEventListener('click', e => {
      const setBtn = e.target.closest('[data-plugin-settings]');
      if (setBtn) {
        host.ui.closeDropdowns();
        const meta = Runtime.getMeta(setBtn.dataset.pluginSettings);
        if (meta) PluginUI.openSettings(meta, 'project');
        return;
      }
      const btn = e.target.closest('[data-cmd]');
      if (!btn) return;
      host.ui.closeDropdowns();
      Runtime.runCommand(btn.dataset.cmd);
    });
  },

  async openManager() {
    await Runtime.sync();
    ui.pluginManagerModal.classList.add('open');
    PluginUI.renderList();
  },

  closeManager() {
    ui.pluginManagerModal.classList.remove('open');
    host.ui.loadDashboard();
  },

  async installFlow(file) {
    try {
      const meta = await Runtime.install(file);
      if (!meta) return;
      PluginUI.renderList();
      host.ui.onShortcutListMaybeRender();
      host.ui.flash(`Plugin "${meta.name}" v${meta.version} ${meta.enabled ? 'aktif' : 'terpasang (nonaktif)'}.`);
    } catch (e) {
      await Dialogs.info('Gagal memasang plugin',
        `<p class="hint m-0">${esc(e?.message || String(e))}</p>`);
    }
  },

  renderList() {
    const container = ui.pluginList;
    if (!container) return;
    const plugins = Runtime.listMeta();
    container.replaceChildren();
    if (!plugins.length) {
      container.innerHTML = `
        <div class="plugin-empty">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5h4.5a2.5 2.5 0 1 1 5 0H19v4.5a2.5 2.5 0 1 1 0 5V19h-4.5a2.5 2.5 0 1 0-5 0H5v-4.5a2.5 2.5 0 1 0 0-5z"/></svg>
          <span>Belum ada plugin terpasang.</span>
          <span class="plugin-empty-sub">Impor .zip atau seret paket ke sini.</span>
        </div>`;
      return;
    }
    const frag = document.createDocumentFragment();
    for (const p of plugins) frag.appendChild(PluginUI.buildCard(p));
    container.appendChild(frag);
  },

  buildCard(p) {
    const row = document.createElement('div');
    row.className = 'plugin-row' + (p.enabled ? ' is-enabled' : '');

    const unapproved = (p.permissions || []).filter(x => !(p.granted || []).includes(x));
    const lockConsent = unapproved.length > 0;
    const consentBadge = lockConsent
      ? `<span class="plugin-badge plugin-badge-warn" title="${esc('Izin belum disetujui: ' + unapproved.map(x => PERMISSIONS[x].label).join(', '))}">${permSvg('theme', 11)} Izin baru · ${unapproved.length}</span>`
      : '';

    const permBadges = (p.permissions || []).map(perm => {
      const info = PERMISSIONS[perm];
      return `<span class="plugin-badge plugin-badge-perm" title="${esc(info.desc)}">${permSvg(perm, 11)} ${esc(perm === 'project' ? 'Baca project' : perm === 'workspace' ? 'Seleksi' : perm === 'clipboard' ? 'Clipboard' : perm === 'files' ? 'Pilih file' : perm === 'downloads' ? 'Unduhan' : perm === 'storage' ? 'Penyimpanan' : perm === 'wasm' ? 'WASM' : perm === 'jszip' ? 'JSZip' : perm === 'theme' ? 'Tema' : 'Hooks')}<span class="plugin-badge-x">·</span></span>`;
    }).join('');

    const parserBadge = (p.extensions?.length || p.magic?.length)
      ? `<span class="plugin-badge plugin-badge-parser" title="Menangani import/export format khusus">Parser ${esc(p.extensions.join(' '))}${p.magic?.length ? ' +magic' : ''}</span>`
      : '';
    const panelBadge = p.ui ? '<span class="plugin-badge plugin-badge-panel" title="Menyediakan panel UI di panel Alat">Panel</span>' : '';
    const settingsBadges = [
      p.settings?.global?.length ? `<span class="plugin-badge plugin-badge-settings" title="Pengaturan global (semua project)">Setelan Global · ${p.settings.global.length}</span>` : '',
      p.settings?.project?.length ? `<span class="plugin-badge plugin-badge-settings" title="Pengaturan per project">Setelan Project · ${p.settings.project.length}</span>` : '',
      p.settings?.shared?.length ? `<span class="plugin-badge plugin-badge-settings" title="Pengaturan bersama (global & semua project)">Setelan Bersama · ${p.settings.shared.length}</span>` : ''
    ].filter(Boolean).join('');
    const assetsBadge = p.files.length
      ? `<span class="plugin-badge plugin-badge-package" title="${esc(p.files.join('\n'))}">Asset · ${p.files.length}</span>`
      : '';

    const detail = `
      <div class="plugin-detail">
        <div class="plugin-detail-grid">
          <div>
            <div class="plugin-detail-label">Izin diberikan</div>
            ${(p.permissions || []).length
              ? p.permissions.map(perm => `
                  <div class="plugin-detail-perm">
                    <span class="plugin-detail-perm-icon">${permSvg(perm, 13)}</span>
                    <span><strong>${esc(PERMISSIONS[perm].label)}</strong><span>${esc(PERMISSIONS[perm].desc)}</span></span>
                  </div>`).join('')
              : '<div class="plugin-detail-none">Tidak ada izin khusus.</div>'}
          </div>
          <div>
            <div class="plugin-detail-label">Informasi paket</div>
            <div class="plugin-detail-kv"><span>API</span><span>v${esc(String(p.api))}</span></div>
            <div class="plugin-detail-kv"><span>Ukuran</span><span>${esc(humanBytes(p.size))}</span></div>
            <div class="plugin-detail-kv"><span>Dipasang</span><span>${esc(new Date(p.updatedAt || Date.now()).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span></div>
            ${p.fingerprint ? `<div class="plugin-detail-kv"><span>SHA-256</span></div><code class="plugin-detail-fp" title="Klik untuk menyalin">${esc(p.fingerprint)}</code>` : ''}
            ${p.files.length ? `<div class="plugin-detail-label" style="margin-top:10px;">File paket (${p.files.length})</div><div class="plugin-detail-files">${p.files.map(f => `<span>${esc(f)}</span>`).join('')}</div>` : ''}
          </div>
        </div>
      </div>`;

    row.innerHTML = `
      <div class="plugin-head">
        <div class="plugin-head-main">
          <span class="plugin-name">${esc(p.name)}</span>
          <span class="plugin-version">v${esc(p.version)}</span>
        </div>
        <label class="switch" title="${lockConsent ? 'Setujui izin baru dulu' : (p.enabled ? 'Nonaktifkan' : 'Aktifkan') + ' plugin'}">
          <input type="checkbox" class="plugin-toggle" ${p.enabled ? 'checked' : ''} ${lockConsent ? 'disabled' : ''} />
          <span class="switch-track"></span>
        </label>
      </div>
      ${p.author || p.description ? `
      <div class="plugin-meta">
        ${p.author ? `<span class="plugin-author">by ${esc(p.author)}</span>` : ''}
        ${p.description ? `<span class="plugin-desc-inline">${esc(p.description)}</span>` : ''}
      </div>` : ''}
      ${lockConsent ? `<div class="plugin-consent-note">Versi baru meminta izin yang belum disetujui — plugin nonaktif sampai kamu menyetujuinya.</div>` : ''}
      ${permBadges || parserBadge || panelBadge || settingsBadges || assetsBadge ? `<div class="plugin-badges">${[consentBadge, parserBadge, panelBadge, settingsBadges, assetsBadge, permBadges].filter(Boolean).join('')}</div>` : ''}
      <div class="plugin-actions">
        <button type="button" class="btn btn-ghost btn-xs btn-plugin-details" aria-expanded="false">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          Detail &amp; Izin
        </button>
        <span class="grow"></span>
        ${lockConsent ? `<button type="button" class="btn btn-primary btn-xs btn-plugin-consent" title="Tinjau izin baru">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Setujui Izin
        </button>` : ''}
        ${(p.settings?.global?.length || p.settings?.shared?.length) ? `<button type="button" class="btn btn-ghost btn-xs btn-plugin-settings2" title="Pengaturan global plugin">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          Setelan Global
        </button>` : ''}
        <button type="button" class="btn btn-ghost btn-xs btn-uninstall-plugin" title="Hapus plugin">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1.4 14.1A2 2 0 0 1 15.6 22H8.4a2 2 0 0 1-2-1.9L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
          Hapus
        </button>
      </div>
      ${detail}`;

    row.querySelector('.plugin-toggle').addEventListener('change', async e => {
      const ok = await Runtime.setEnabled(p.id, e.target.checked);
      if (ok) PluginUI.renderList();
      else e.target.checked = !e.target.checked;
    });

    row.querySelector('.btn-plugin-details').addEventListener('click', e => {
      const btn = e.currentTarget;
      const expanded = row.classList.toggle('show-detail');
      btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });

    row.querySelector('.btn-plugin-consent')?.addEventListener('click', () => {
      PluginUI.reviewConsent(p);
    });

    row.querySelector('.btn-plugin-settings2')?.addEventListener('click', () => {
      PluginUI.openSettings(p, 'global');
    });

    row.querySelector('.btn-uninstall-plugin').addEventListener('click', async () => {
      try {
        const ok = await Runtime.uninstall(p.id);
        if (ok) {
          PluginUI.renderList();
          host.ui.loadDashboard();
          host.ui.onShortcutListMaybeRender();
          host.ui.flash(`Plugin "${p.name}" dihapus.`);
        }
      } catch (e) {
        await Dialogs.info('Gagal menghapus plugin', `<p class="hint m-0">${esc(e?.message || String(e))}</p>`);
      }
    });

    row.querySelector('.plugin-detail-fp')?.addEventListener('click', async e => {
      try { await navigator.clipboard.writeText(p.fingerprint || ''); host.ui.flash('Sidik jari disalin.'); } catch {}
    });

    return row;
  },

  async reviewConsent(meta) {
    const newPerms = (meta.permissions || []).filter(x => !(meta.granted || []).includes(x));
    if (!newPerms.length) return;
    const ok = await Dialogs.consent(meta, { existing: meta, newPerms, review: true });
    if (!ok) {
      host.ui.flash('Izin baru belum disetujui — plugin tetap nonaktif.');
      return;
    }
    meta.granted = meta.permissions.slice();
    await Runtime._persist();
    const enabled = await Runtime.setEnabled(meta.id, true);
    PluginUI.renderList();
    if (enabled) host.ui.flash(`Izin "${meta.name}" disetujui — plugin aktif.`);
  },

  panelHost(meta) {
    const wrap = ui.pluginPanels;
    if (!wrap) return null;
    const cfg = meta.ui || {};
    const card = document.createElement('div');
    card.className = 'plugin-panel-card open';
    card.innerHTML = `
      <button class="plugin-panel-head" type="button">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
        <span class="plugin-panel-title">${esc(cfg.title || meta.name)}</span>
        <svg class="plugin-panel-chevron" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <div class="plugin-panel-body" style="height:${cfg.height || 300}px"></div>`;
    wrap.appendChild(card);
    return { card, body: card.querySelector('.plugin-panel-body') };
  },

  wirePanel(inst, hostEl) {
    inst.panelCard = hostEl.card;
    hostEl.card.querySelector('.plugin-panel-head').addEventListener('click', () => {
      if (hostEl.card.classList.toggle('open')) PluginUI.panelShow(inst);
    });
    if (!inst.info?.panel) {
      inst.frame.style.display = 'none';
      const note = document.createElement('div');
      note.className = 'plugin-panel-empty';
      note.textContent = 'Plugin ini tidak mengimplementasikan panel().';
      hostEl.body.appendChild(note);
      return;
    }
    PluginUI.panelShow(inst);
  },

  panelShow(inst) {
    inst.call('panel', { open: true, theme: host.ui.themeVarsCss() }).catch(e => Runtime._fail(inst.meta, e));
  },

  renderMenu() {
    const menuEl = ui.pluginMenu;
    if (!menuEl) return;
    const html = [];
    const cmds = Runtime.commands();
    if (cmds.length) {
      let lastPlugin = null;
      for (const c of cmds) {
        if (c.pluginName !== lastPlugin) {
          lastPlugin = c.pluginName;
          html.push(`<div class="dropdown-label">${esc(c.pluginName)}</div>`);
        }
        const combo = host.ui.shortcutComboFor(c.id);
        html.push(`<button type="button" class="dropdown-item" data-cmd="${esc(c.id)}"><span class="menu-label">${esc(c.label)}</span>${combo ? `<span class="menu-kbd">${host.ui.comboHtml(combo)}</span>` : ''}</button>`);
      }
    }
    const active = Runtime.listMeta().filter(p => p.enabled === true);
    const settable = active.filter(p =>
      (Array.isArray(p.settings?.project) && p.settings.project.length > 0) ||
      (Array.isArray(p.settings?.shared) && p.settings.shared.length > 0)
    );
    if (settable.length) {
      if (cmds.length) html.push('<div class="dropdown-sep"></div>');
      html.push('<div class="dropdown-label">Setelan Project</div>');
      const gear = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
      for (const p of settable) {
        html.push(`<button type="button" class="dropdown-item plugin-settings-item" data-plugin-settings="${esc(p.id)}" title="Setelan project untuk plugin ini"><span class="menu-label">${esc(p.name)}</span><span class="menu-icon-btn">${gear}</span></button>`);
      }
    }
    if (!cmds.length && !settable.length) {
      html.push(active.length
        ? '<div class="dropdown-hint">Plugin aktif tidak punya perintah atau setelan project.</div>'
        : '<div class="dropdown-hint">Belum ada plugin aktif. Kelola lewat Plugin Manager.</div>');
    }
    menuEl.innerHTML = html.join('');
  },

  _fieldRow(meta, s, values) {
    const row = document.createElement('div');
    row.className = 'plugin-settings-row';
    const id = `pluginSetting_${meta.id}_${s.key}`;
    const cur = values[s.key];
    const type = s.type;
    let inputHtml;
    if (type === 'boolean') {
      inputHtml = `<label class="check-line"><input id="${id}" type="checkbox" ${cur ? 'checked' : ''}/> ${esc(s.label)}</label>`;
    } else if (type === 'select') {
      const opts = (s.options || []).map(o => `<option value="${esc(o.value)}" ${String(cur) === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
      inputHtml = `<select id="${id}" class="input w-full">${opts}</select>`;
    } else if (type === 'textarea') {
      inputHtml = `<textarea id="${id}" class="textarea w-full" rows="4" placeholder="${esc(s.placeholder || '')}">${esc(String(cur ?? ''))}</textarea>`;
    } else if (type === 'number') {
      inputHtml = `<input id="${id}" class="input w-full" type="number" value="${esc(String(cur ?? ''))}" ${s.min != null ? `min="${esc(String(s.min))}"` : ''} ${s.max != null ? `max="${esc(String(s.max))}"` : ''} ${s.step != null ? `step="${esc(String(s.step))}"` : ''}/>`;
    } else {
      inputHtml = `<input id="${id}" class="input w-full" type="text" value="${esc(String(cur ?? ''))}" placeholder="${esc(s.placeholder || '')}"/>`;
    }
    const labelHtml = type === 'boolean' ? '' : `<label for="${id}" class="plugin-settings-label">${esc(s.label)}${s.description ? `<span class="plugin-settings-desc">${esc(s.description)}</span>` : ''}</label>`;
    row.innerHTML = `<div class="plugin-settings-cell">${labelHtml}${inputHtml}</div>`;
    return row;
  },

  _readFields(meta, fields) {
    const out = {};
    for (const s of fields) {
      const el = document.getElementById(`pluginSetting_${meta.id}_${s.key}`);
      if (!el) continue;
      if (s.type === 'boolean') out[s.key] = !!el.checked;
      else if (s.type === 'number') out[s.key] = el.value === '' ? null : Number(el.value);
      else out[s.key] = el.value;
    }
    return out;
  },

  _resetFields(meta, fields) {
    for (const s of fields) {
      const el = document.getElementById(`pluginSetting_${meta.id}_${s.key}`);
      if (!el) continue;
      if (s.type === 'boolean') el.checked = !!s.default;
      else el.value = String(s.default ?? '');
    }
  },

  openSettings(meta, scope) {
    const ownFields = (scope === 'global') ? meta.settings?.global : meta.settings?.project;
    const sharedFields = meta.settings?.shared;
    const hasOwn = Array.isArray(ownFields) && ownFields.length > 0;
    const hasShared = Array.isArray(sharedFields) && sharedFields.length > 0;
    if (!hasOwn && !hasShared) {
      host.ui.flash(scope === 'global' ? 'Plugin ini tidak punya setelan global.' : 'Plugin ini tidak punya setelan project.');
      return;
    }
    if (scope === 'project' && !host.state.projectId()) {
      host.ui.flash('Buka project dulu untuk mengubah setelan project.');
      return;
    }
    const ownMerged = scope === 'global' ? Runtime.globalValuesFor(meta) : Runtime.valuesFor(meta);
    const sharedMerged = Runtime.sharedValuesFor(meta);
    const scopeLabel = scope === 'global' ? 'Global' : 'Project';
    const form = document.createElement('div');
    form.className = 'plugin-settings-form';
    if (hasOwn) {
      const ownWrap = document.createElement('div');
      ownWrap.className = 'plugin-settings-own';
      for (const s of ownFields) ownWrap.appendChild(PluginUI._fieldRow(meta, s, ownMerged));
      form.appendChild(ownWrap);
    }
    if (hasShared) {
      const group = document.createElement('div');
      group.className = 'plugin-settings-group';
      const head = document.createElement('div');
      head.className = 'plugin-settings-group-head';
      head.innerHTML = `<span class="plugin-settings-group-title">Setelan Bersama</span><span class="plugin-settings-group-hint">Satu nilai untuk semua project dan workspace.</span>`;
      group.appendChild(head);
      for (const s of sharedFields) group.appendChild(PluginUI._fieldRow(meta, s, sharedMerged));
      form.appendChild(group);
    }

    const overlay = document.createElement('div');
    overlay.className = 'backdrop backdrop-top';
    overlay.innerHTML = `
      <div class="modal modal-wide" role="dialog" aria-modal="true">
        <div class="modal-head"><h3>Setelan ${scopeLabel}: ${esc(meta.name)}</h3></div>
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
    if (!hasOwn) {
      scopeHint.textContent = 'Setelan bersama — dipakai di semua project dan workspace.';
    } else if (scope === 'global') {
      scopeHint.textContent = hasShared ? 'Global berlaku untuk semua project; bagian bersama dipakai di mana saja.' : 'Berlaku untuk semua project.';
    } else {
      const pn = host.state.projectName() || 'ini';
      scopeHint.textContent = hasShared ? `Setelan project hanya untuk "${pn}"; bagian bersama berlaku di mana saja.` : `Hanya berlaku untuk project "${pn}".`;
    }
    body.append(scopeHint, form);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    let settled = false;
    const close = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      overlay.classList.remove('open');
      overlay.remove();
    };
    const observer = new MutationObserver(() => {
      if (!overlay.classList.contains('open')) close();
    });
    observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });

    overlay.querySelector('.btn-plugin-settings-cancel').addEventListener('click', close);
    overlay.querySelector('.btn-plugin-settings-reset').addEventListener('click', () => {
      if (hasOwn) PluginUI._resetFields(meta, ownFields);
      if (hasShared) PluginUI._resetFields(meta, sharedFields);
    });
    overlay.querySelector('.btn-plugin-settings-save').addEventListener('click', () => {
      if (hasOwn) {
        if (scope === 'global') Runtime._setGlobalValues(meta.id, PluginUI._readFields(meta, ownFields));
        else Runtime._setValues(meta.id, PluginUI._readFields(meta, ownFields));
      }
      if (hasShared) Runtime._setSharedValues(meta.id, PluginUI._readFields(meta, sharedFields));
      close();
      host.ui.flash(`Setelan ${scopeLabel.toLowerCase()} "${meta.name}" disimpan.`);
    });
  }
};

CSTL.plugins = {
  attach(bridge) {
    host = bridge;
    const g = id => document.getElementById(id);
    ui = {
      pluginManagerModal: g('pluginManagerModal'),
      btnPluginManagerOpen: g('btnPluginManagerOpen'),
      btnPluginManagerClose: g('btnPluginManagerClose'),
      btnPluginRefresh: g('btnPluginRefresh'),
      btnInstallPlugin: g('btnInstallPlugin'),
      pluginFileInput: g('pluginFileInput'),
      pluginList: g('pluginList'),
      btnOpenPlugins: g('btnOpenPlugins'),
      pluginMenu: g('pluginMenu'),
      pluginPanels: g('pluginPanels')
    };
    Sandbox.listen();
    PluginUI.bind();
  },

  async init() { return Runtime.init(); },
  async sync() { return Runtime.sync(); },
  listMeta() { return Runtime.listMeta(); },
  getMeta(id) { return Runtime.getMeta(id); },
  valuesFor(meta) { return Runtime.valuesFor(meta); },
  globalValuesFor(meta) { return Runtime.globalValuesFor(meta); },
  sharedValuesFor(meta) { return Runtime.sharedValuesFor(meta); },
  activeParserInfo() { return Runtime.activeParserInfo(); },
  resolveByExtension(name) { return Runtime.resolveByExtension(name); },
  resolveByMagic(head) { return Runtime.resolveByMagic(head); },
  async callExtract(meta, input) { return Runtime.callExtract(meta, input); },
  async callPack(meta, input) { return Runtime.callPack(meta, input); },
  normalizePluginLines(raw, startNum) { return Runtime.normalizePluginLines(raw, startNum); },
  toPluginLine(l) { return Runtime.toPluginLine(l); },
  async runCopyHook(text) { return Runtime.runCopyHook(text); },
  async runApplyHook(text) { return Runtime.runApplyHook(text); },
  emit(event, payload) { return Runtime.emit(event, payload); },
  commands() { return Runtime.commands(); },
  async runCommand(id) { return Runtime.runCommand(id); },
  onProjectOpened() { return Runtime.onProjectOpened(); },
  onProjectClosed() { return Runtime.onProjectClosed(); },

  openSettings(meta, scope) { return PluginUI.openSettings(meta, scope); },
  openManager() { return PluginUI.openManager(); },
  renderMenu() { return PluginUI.renderMenu(); },
  renderList() { return PluginUI.renderList(); }
};

})();
