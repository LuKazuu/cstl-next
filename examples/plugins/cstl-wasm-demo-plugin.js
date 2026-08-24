/* @cstl-plugin
{
  "id": "cstl-bytes-demo",
  "name": "WASM Bytes Demo (.wbin)",
  "version": "1.0.0",
  "author": "CSTL Example",
  "api_version": 1,
  "extensions": [".wbin"],
  "wasm": true,
  "description": "Plugin demo WebAssembly: parse format binary sederhana dengan magic bytes. Setiap record = 4-byte big-endian length + UTF-8 string."
}
@cstl-plugin */

const WASM_B64 = "AGFzbQEAAAABCwJgAX8Bf2ACf38AAwQDAAABBQMBAAEHLwQGbWVtb3J5AgAFYWxsb2MAAAtyZWFkX3UzMl9iZQABDHdyaXRlX3UzMl9iZQACClQDBABBAAsiACAALQAAQRh0IAAtAAFBEHRqIAAtAAJBCHRqIAAtAANqCyoAIAAgAUEYdjoAACAAIAFBEHY6AAEgACABQQh2OgACIAAgAUEAdjoAAws=";

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

let _wasm = null;
async function getWasm(host) {
  if (_wasm) return _wasm;
  if (!host.WebAssembly && !host.instantiateWasm) {
    throw new Error('WebAssembly tidak tersedia di environment ini.');
  }
  const bytes = base64ToBytes(WASM_B64);
  const instance = await host.instantiateWasm(bytes, {});
  _wasm = instance.exports;
  return _wasm;
}

module.exports = {
  async extract({ fileName, buffer, host }) {
    const wasm = await getWasm(host);
    const lines = [];
    let i = 0;
    while (i + 4 <= buffer.length) {
      const mem = new Uint8Array(wasm.memory.buffer);
      mem.set(buffer.subarray(i, i + 4), 0);
      const len = wasm.read_u32_be(0) >>> 0;
      i += 4;
      if (len === 0 || i + len > buffer.length) break;
      const slice = buffer.subarray(i, i + len);
      lines.push({ file: fileName, name: null, message: host.decode(slice) });
      i += len;
    }
    return { lines, sourceMap: { format: 'wbin-v1', wasmUsed: true } };
  },

  async pack({ lines, projectName, host }) {
    const enc = host.textEncoder();
    const chunks = [];
    for (const l of lines) {
      const msg = l.is_translated && l.trans_message ? l.trans_message : l.message;
      const bytes = enc.encode(msg);
      const hdr = new Uint8Array(4);
      const n = bytes.length >>> 0;
      hdr[0] = (n >>> 24) & 0xFF;
      hdr[1] = (n >>> 16) & 0xFF;
      hdr[2] = (n >>> 8) & 0xFF;
      hdr[3] = n & 0xFF;
      chunks.push(hdr, bytes);
    }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return {
      blob: new Blob([out], { type: 'application/octet-stream' }),
      filename: host.sanitizeName(projectName) + '_tl.wbin'
    };
  }
};
