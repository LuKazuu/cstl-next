/* @cstl-plugin
{
  "id": "cstl-bytes-demo",
  "name": "WASM Bytes Demo (.wbin)",
  "version": "2.0.0",
  "author": "CSTL Example",
  "api_version": 1,
  "matchStrategy": ["extension"],
  "extensions": [".wbin"],
  "wasm": true,
  "description": "Plugin demo WebAssembly: parse format binary sederhana. File parser.wasm dibaca dari asset ZIP via host.readFile."
}
@cstl-plugin */

let _wasm = null;
async function getWasm(host) {
  if (_wasm) return _wasm;
  const bytes = await host.readFile('parser.wasm');
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
