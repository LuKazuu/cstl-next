# CSTL-NEXT
Original by Atho64

Fork by Me

Link:
https://lukazuu.github.io/cstl-next

## CSTL-NEXT — Plugin System

CSTL NEXT menambahkan sistem plugin untuk menangani format visual novel lain (selain JSON/EPUB). Plugin dikemas sebagai **file .zip** (berisi `plugin.js` + asset), ditulis dalam JavaScript murni, dijalankan di **Web Worker** terisolasi, dengan dukungan **WebAssembly** opsional dan **per-plugin settings** berbasis manifest.

### Quick start untuk user

1. Buka **Pengaturan → Plugin → Buka Plugin Manager → Import Plugin**, pilih file `.zip` plugin.
2. Plugin disimpan permanen di OPFS browser (termasuk asset seperti `.wasm`). Setelah dipasang, file dengan extension yang cocok otomatis dispatch ke plugin saat import.
3. Saat uninstall, **cascade delete** otomatis menghapus semua project yang memakai plugin tersebut.

### Struktur plugin (.zip)

```
my-engine.zip
├── plugin.js          (wajib — entry + manifest)
├── parser.wasm        (opsional — dibaca via host.readFile)
└── data/              (opsional — nested path didukung)
```

```js
/* @cstl-plugin
{
  "id": "my-engine",
  "name": "My VN Engine",
  "version": "1.0.0",
  "author": "Your Name",
  "api_version": 1,
  "matchStrategy": ["extension"],
  "extensions": [".dat"],
  "wants_js_zip": false,
  "wasm": false,
  "settings": [
    {"key":"enc","label":"Encoding","type":"select","default":"auto","options":[...]}
  ]
}
@cstl-plugin */

module.exports = {
  async extract(input) { ... },
  async pack(input) { ... }
};
```

### Contoh plugin

Ada di `examples/plugins/` (`.zip` siap install, `.js` adalah source):
- `cstl-text-plugin.zip` — plugin `.txt` minimal dengan settings
- `cstl-csv-plugin.zip` — plugin `.csv` dengan auto-detect header & quote escape
- `cstl-magic-demo-plugin.zip` — plugin dengan magic bytes + filename regex (file tanpa extension)
- `cstl-wasm-demo-plugin.zip` — plugin `.wbin` demo WebAssembly dengan asset `parser.wasm`

### Dokumentasi lengkap

Lihat `examples/PLUGIN_DEVELOPER_GUIDE.md` untuk spec API, schema manifest, lifecycle, dan panduan WebAssembly.

### Trust model

- **Keamanan longgar** — tergantung user masing-masing, own risk.
- Tidak ada signature verification, tidak ada capability consent dialog.
- Plugin dipasang manual via import file.
- Worker isolation tetap aktif: plugin crash tidak freeze UI main thread.

### File struktur

```
cstl-next/
├── index.html
├── app.js
├── plugin-worker.js
├── styles.css
├── sw.js
├── manifest.json
├── icon.svg
├── README.md
└── examples/
    ├── PLUGIN_DEVELOPER_GUIDE.md
    └── plugins/
        ├── cstl-text-plugin.js / .zip
        ├── cstl-csv-plugin.js / .zip
        ├── cstl-magic-demo-plugin.js / .zip
        ├── cstl-wasm-demo-plugin.js / .zip
        └── cstl-wasm-demo.wasm
```
