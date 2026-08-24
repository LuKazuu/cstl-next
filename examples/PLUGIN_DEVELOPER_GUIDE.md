# CSTL Plugin System v1

CSTL mendukung **plugin** untuk menangani format visual novel yang bukan JSON/EPUB. Plugin dikemas sebagai **file .zip** (berisi `plugin.js` + asset), ditulis dalam JavaScript murni, dipasang lewat menu **Pengaturan → Plugin → Buka Plugin Manager → Import Plugin**.

## Apa yang baru di v1 (API version 1)

| Fitur | Status | Catatan |
|---|---|---|
| **Web Worker isolation** | ✅ Default on | Plugin berjalan di thread terpisah, UI tidak freeze. Worker wajib — browser tanpa Worker tidak bisa jalan plugin. |
| **WASM module entry** | ✅ Didukung | Akses `host.WebAssembly` dan `host.instantiateWasm(bytes, imports)` dari worker. |
| **Per-plugin settings UI** | ✅ Didukung | Manifest bisa deklarasi `settings: [...]`, UI form otomatis dibuat di Plugin Manager. |
| **Plugin console forward** | ✅ Didukung | `console.log/warn/error` di plugin otomatis di-forward ke devtools main thread. |
| **Plugin progress emit** | ✅ Didukung | Plugin panggil `host.progressHook((val, label) => {...})` — progress forward ke UI. |
| Signature verification | ❌ Skip | Sesuai request user: "keamanan longgar, tergantung user masing-masing". |
| Marketplace | ❌ Belum | Distribusi tetap via import file manual. |

## Spec singkat

| Komponen | Nilai |
|---|---|
| API version | `1` (manifest `api_version: 1`) |
| File extension | `.zip` (berisi `plugin.js` + asset) |
| Storage | OPFS (`plugin_<id>.js` + `plugin_<id>_assets/`) + index `_plugins.json` + settings `_plugin_settings.json` |
| Isolation | **Web Worker** per plugin (1 worker per plugin id, lazy spin-up, keep-alive). Worker wajib. |
| Concurrency | Worker sendiri async. Plugin boleh `await` bebas. |
| WASM | Bundle `.wasm` di ZIP, baca via `host.readFile(name)` + `host.instantiateWasm(bytes, importObject)`. |
| Trust model | Manual install, own risk. Tidak ada signature check. User bertanggung jawab atas plugin yang dipasang. |

## Format plugin (.zip)

Plugin adalah **ZIP package**. Entry wajib bernama `plugin.js` di root ZIP, berisi manifest di block comment paling atas + CommonJS export. File lain di dalam ZIP otomatis jadi **asset** yang bisa dibaca plugin via `host.readFile(name)`:

```
my-engine.zip
├── plugin.js          (wajib — entry + manifest)
├── parser.wasm        (opsional — asset bebas)
└── data/
    └── table.bin      (opsional — nested path didukung)
```

`plugin.js`:

```js
/* @cstl-plugin
{
  "id": "unique-id",
  "name": "Display Name",
  "version": "1.0.0",
  "author": "your name",
  "api_version": 1,
  "matchStrategy": ["extension"],
  "extensions": [".rpy", ".rpym"],
  "description": "Optional, shown in UI",
  "wants_js_zip": false,
  "wasm": false,
  "settings": [
    {
      "key": "encodingFallback",
      "label": "Encoding Fallback",
      "type": "select",
      "default": "auto",
      "options": [
        {"value": "auto", "label": "Auto (UTF-8 → SJIS)"},
        {"value": "sjis", "label": "Force Shift_JIS"},
        {"value": "utf8", "label": "Force UTF-8"}
      ],
      "description": "Encoding yang dipakai untuk membaca file."
    },
    {
      "key": "skipComments",
      "label": "Skip comment lines",
      "type": "boolean",
      "default": true,
      "description": "Lewati baris yang dimulai dengan #"
    }
  ]
}
@cstl-plugin */

module.exports = {
  async extract(input) { ... },
  async pack(input) { ... }
};
```

### Field manifest

| Field | Wajib | Aturan |
|---|---|---|
| `id` | ✅ | `^[a-z0-9][a-z0-9_-]*$` (case-insensitive). Harus unik. |
| `name` | ✅ | string, non-empty |
| `version` | ✅ | string (semver bebas) |
| `matchStrategy` | ✅ | string atau array. Pilihan: `'extension'`, `'magic'`, `'filename'`, `'any'`. Tentukan cara CSTL mencocokkan file dengan plugin saat import. Tidak ada default — wajib eksplisit. |
| `extensions` | wajib jika `matchStrategy` mengandung `'extension'` | array of strings, masing-masing dimulai dengan `.` (e.g. `.rpy`). Boleh kosong untuk strategi non-extension. |
| `magic` | wajib jika `matchStrategy` mengandung `'magic'` | array of `{ offset: number, hex: string }`. CSTL baca 64 byte pertama file, bandingkan tiap pattern. |
| `filenameRegex` | wajib jika `matchStrategy` mengandung `'filename'` | string regex JS. Match terhadap nama file (case-insensitive). |
| `api_version` | ❌ | integer, default 1. Kalau > `PLUGIN_API_VERSION` host, install ditolak. |
| `author` | ❌ | string |
| `description` | ❌ | string, ditampilkan di daftar plugin |
| `wants_js_zip` | ❌ | boolean, default false. Kalau `true`, worker preload JSZip dari CDN saat init. |
| `wasm` | ❌ | boolean, default false. Info-only — plugin tetap harus akses `host.WebAssembly` / `host.instantiateWasm` sendiri. Ditampilkan sebagai badge ⬛ WASM di UI. |
| `settings` | ❌ | array of setting specs (lihat bawah). Kalau diisi, UI form otomatis dibuat. |

### Strategi pencocokan file (`matchStrategy`)

**Wajib** diisi. Tidak ada default. CSTL otomatis mendispatch file ke plugin saat import berdasarkan strategi yang dipilih:

- `'extension'` — bandingkan extension file dengan `extensions[]`. Cocok untuk format dengan extension standar (`.rpy`, `.ks`, `.scn`).
- `'magic'` — cek magic bytes di 64 byte pertama file. Cocok untuk binary format dengan signature tetap (XP3 archive, KiriKiri `ks` tanpa ext, NScripter).
- `'filename'` — match regex terhadap nama file (case-insensitive). Cocok untuk file tanpa extension dengan pattern nama (`^scene_`, `^bgm_`, dll).
- `'any'` — match file apa pun. Tidak bisa dikombinasikan dengan strategi lain. Cocok untuk plugin "fallback".

Strategi bisa **dikombinasikan** sebagai array, evaluasi berurutan:

```json
{
  "matchStrategy": ["extension", "magic"],
  "extensions": [".ks"],
  "magic": [{"offset": 0, "hex": "4b5353434849"}]
}
```

Alur dispatch saat user import:

1. CSTL baca 64 byte pertama file pertama
2. Untuk tiap plugin terdaftar (urutan install), cek tiap strategi di `matchStrategy`
3. Plugin pertama yang cocok menang
4. Kalau tidak ada yang cocok → error "tidak ada plugin terpasang yang cocok"

Contoh plugin KiriKiri dengan file `.scn` ATAU file tanpa extension yang dimulai dengan `scene_`:

```js
/* @cstl-plugin
{
  "id": "krkr-scn",
  "name": "KiriKiri .scn",
  "version": "1.0.0",
  "author": "your name",
  "matchStrategy": ["extension", "filename"],
  "extensions": [".scn"],
  "filenameRegex": "^scene_\\w+"
}
@cstl-plugin */
```

Contoh plugin fallback "any" (jarang dipakai — hanya 1 per install):

```json
{
  "matchStrategy": "any"
}
```

### Setting spec

Setiap entry di `settings`:

| Field | Wajib | Aturan |
|---|---|---|
| `key` | ✅ | `^[a-zA-Z_$][a-zA-Z0-9_$]*$` — dipakai sebagai field di `options` yang dikirim ke plugin |
| `label` | ✅ | string, label form |
| `type` | ❌ | salah satu: `string` (default), `number`, `boolean`, `select`, `color`, `textarea` |
| `default` | ❌ | nilai default. Untuk `select` harus salah satu dari `options[].value`. |
| `options` | wajib untuk `select` | array of `{value, label}` atau array of primitives |
| `description` | ❌ | string, hint kecil di bawah label |
| `placeholder` | ❌ | untuk `string`/`textarea` |
| `min`, `max`, `step` | ❌ | untuk `number` |

## Plugin API contract

### `async extract(input)` → `ExtractOutput`

Dipanggil ketika user mengimpor file dengan extension yang cocok.

**Input**:
```ts
{
  fileName: string,           // nama file asli (bisa path)
  buffer: Uint8Array,          // raw bytes
  options: object,             // per-plugin settings dari manifest (sudah di-merge dengan default)
  host: {                      // helper API dari CSTL
    decode(buf: Uint8Array): string,   // utf-8 → sjis → cp932 fallback
    basename(path: string): string,
    JSZip: typeof JSZip | null,        // global JSZip (kalau preloadJsZip atau sudah ada)
    loadJsZip(): Promise<typeof JSZip | null>, // async variant — pastikan loaded
    escapeRegex(s: string): string,
    textEncoder(): TextEncoder,
    textDecoder(enc: string, fatal?: boolean): TextDecoder,
    stripNewlines(v: string|null): string|null,  // escape \n → "\\n"
    sanitizeName(s: string): string,
    progressHook(cb: (val: number, label: string) => void): void,
    readFile(name: string): Promise<Uint8Array>,        // baca asset dari ZIP plugin (OPFS lokal)
    readFileText(name: string): Promise<string>,       // baca asset sebagai teks
    fileExists(name: string): Promise<boolean>,
    listFiles(): Promise<string[]>,                    // daftar semua asset (nested path termasuk)
    WebAssembly: typeof WebAssembly | null,  // akses WebAssembly global
    instantiateWasm(bytes: Uint8Array, importObject?: object): Promise<WebAssembly.Instance>,
    isWorker: boolean,
    threadName: string  // 'plugin-worker' atau 'main'
  }
}
```

**Output**:
```ts
{
  lines: Array<{                // wajib
    file: string,                // source filename (basename) — host akan isi default kalau kosong
    name: string | null,        // speaker label, boleh null
    message: string              // teks asli (Wajib, non-empty). Host akan escape newline.
  }>,
  sourceMap?: any,              // opsional, JSON-serializable, di-share ke pack()
  images?: Array<{              // opsional, untuk VN dengan asset gambar embedded
    fileName?: string,
    zipPath?: string,
    file?: string,
    isCover?: boolean,
    insertAfter?: number | null, // line_num anchor
    blob?: Blob,
    kind?: string
  }>
}
```

Host akan assign otomatis: `line_num`, `trans_name`, `trans_message`, `is_translated = false`. Plugin tidak perlu set field itu.

### `async pack(input)` → `PackOutput`

Dipanggil ketika user klik **Export** untuk project yang berasal dari plugin.

**Input**:
```ts
{
  lines: Array<{                // state internal CSTL, sudah final
    line_num: number,
    file: string,
    name: string | null,
    message: string,
    trans_name: string | null,
    trans_message: string | null,
    is_translated: boolean
  }>,
  sourceMap: object,            // apa pun yang di-return extract() sebelumnya (per-file key)
  projectName: string,
  options: object,              // per-plugin settings (sama seperti extract)
  host: { ... }                 // sama dengan extract
}
```

**Output**:
```ts
{
  blob: Blob,                   // file hasil pack
  filename: string              // nama file saat diunduh
}
```

## Lifecycle

1. User buka **Pengaturan → Plugin → Import Plugin**, pilih file `.zip`.
2. CSTL unzip, baca `plugin.js` di root, parse manifest. Kalau `id` sudah terpasang, minta konfirmasi timpa.
3. `plugin.js` disimpan ke OPFS sebagai `plugin_<id>.js`. Semua file lain disimpan ke folder `plugin_<id>_assets/`. Entry ditambah ke `_plugins.json`.
4. **Worker spin-up lazy** — saat pertama kali plugin dipanggil, satu worker dibuat untuk plugin id tersebut. Worker ini persist (keep-alive) sampai plugin di-uninstall atau tab ditutup.
5. Saat user import file biasa dengan extension yang cocok → CSTL cari plugin → muat via worker → panggil `extract()`.
6. Saat export → panggil `pack()` via worker → download blob.
7. Hapus plugin → konfirmasi → **cascade delete**: semua project dengan `projectType === 'plugin'` && `pluginId === <id>` ikut dihapus permanen. Worker di-terminate, folder asset dihapus.

## WASM usage

Plugin dapat pakai WASM sebagai native parser. Bundle file `.wasm` di ZIP plugin, lalu baca via `host.readFile()` — sepenuhnya lokal, tanpa CDN:

```js
/* @cstl-plugin
{
  "id": "my-engine",
  "name": "My Engine Parser",
  "version": "1.0.0",
  "api_version": 1,
  "matchStrategy": ["extension"],
  "extensions": [".dat"],
  "wasm": true
}
@cstl-plugin */

let _wasmInstance = null;
async function getWasm(host) {
  if (_wasmInstance) return _wasmInstance;
  const bytes = await host.readFile('parser.wasm');
  _wasmInstance = await host.instantiateWasm(bytes, {
    env: {
      memory: new WebAssembly.Memory({ initial: 1 }),
      log: (ptr, len) => console.log('[wasm] log', ptr, len)
    }
  });
  return _wasmInstance;
}

module.exports = {
  async extract({ fileName, buffer, options, host }) {
    const wasm = await getWasm(host);
    const mem = wasm.exports.memory;
    const ptr = wasm.exports.alloc(buffer.length);
    new Uint8Array(mem.buffer).set(buffer, ptr);
    const resultPtr = wasm.exports.parse(ptr, buffer.length);
    const text = host.decode(new Uint8Array(mem.buffer, resultPtr, 4096));
    return { lines: text.split('\n').map(m => ({ file: fileName, name: null, message: m })) };
  },
  async pack({ lines, projectName, host }) {
    const out = lines.map(l => l.is_translated ? (l.trans_message || l.message) : l.message).join('\n');
    return { blob: new Blob([out], { type: 'text/plain' }), filename: host.sanitizeName(projectName) + '_tl.dat' };
  }
};
```

**Catatan**:
- `WebAssembly` global tersedia di worker (default on). Jadi `host.WebAssembly` non-null.
- File `.wasm` ukuran berapapun aman — disimpan di OPFS, di-read lazy saat pertama dipakai.
- WASM module bisa punya import object sendiri (memory, fd_write, dll).
- Cek asset lain: `await host.listFiles()` untuk melihat semua file yang di-bundle.

## Built-in helper `require`

Plugin dapat `require('jszip')` untuk akses JSZip global (kalau sudah diload oleh host). Selain itu throw error. Tidak ada module resolver lain.

`require('webassembly')` juga di-allow sebagai shortcut.

## Contoh

Lihat folder `examples/plugins/`. File `.zip` siap install, file `.js` adalah source:
- `cstl-text-plugin.zip` — plugin `.txt` minimal, dengan heuristic "Speaker: message"
- `cstl-csv-plugin.zip` — plugin `.csv` dengan parse/quote manual, auto-detect header
- `cstl-magic-demo-plugin.zip` — plugin dengan `matchStrategy` magic bytes + filename regex (file tanpa extension)
- `cstl-wasm-demo-plugin.zip` — plugin `.wbin` dengan WASM parser dari asset `parser.wasm`

## Yang belum didukung (roadmap berikutnya)

- **Per-project plugin options snapshot** — saat ini settings global per plugin. Kalau user ubah settings di tengah project, project lama pakai settings baru saat export. Bisa diatasi dengan snapshot di import time.
- **Plugin marketplace** — distribusi & discovery via registry online.
- **Signature verification** — optional, kalau user request.
- **Plugin API v2** — kalau ada breaking change (misal streaming RPC, transferable buffer otomatis).

Untuk menambahkan, patch `PluginManager` di `app.js` dan bump `PLUGIN_API_VERSION`.
