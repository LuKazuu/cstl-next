/* @cstl-plugin
{
  "id": "cstl-text",
  "name": "Plain Text (.txt)",
  "version": "1.0.0",
  "author": "CSTL Example",
  "api_version": 1,
  "extensions": [".txt"],
  "description": "Plugin referensi: baca teks per baris, ekspor sebagai .txt dengan baris terjemahan. Mendukung pengaturan delimiter speaker dan skip baris kosong.",
  "settings": [
    {
      "key": "speakerDelimiter",
      "label": "Delimiter Speaker",
      "type": "string",
      "default": ":",
      "placeholder": " Default: :",
      "description": "Pisahkan speaker dari pesan. Baris \"Alice: Hello!\" → name=Alice, message=\"Hello!\". Kosongkan untuk menonaktifkan."
    },
    {
      "key": "skipEmpty",
      "label": "Lewati baris kosong",
      "type": "boolean",
      "default": true,
      "description": "Jangan simpan baris yang hanya berisi whitespace."
    },
    {
      "key": "encoding",
      "label": "Encoding",
      "type": "select",
      "default": "auto",
      "options": [
        {"value": "auto", "label": "Auto (UTF-8 → SJIS)"},
        {"value": "utf8", "label": "Force UTF-8"},
        {"value": "sjis", "label": "Force Shift_JIS"}
      ],
      "description": "Encoding untuk membaca file. Auto berarti coba UTF-8 dulu, fallback Shift_JIS."
    }
  ]
}
@cstl-plugin */


module.exports = {
  async extract({ fileName, buffer, options, host }) {
    const text = host.decode(buffer);
    const lines = [];
    const delimiter = (options.speakerDelimiter || ':').trim();
    const skipEmpty = options.skipEmpty !== false;
    let n = 0;
    for (const raw of text.split(/\r?\n/)) {
      const line = skipEmpty ? raw.trim() : raw;
      if (!line && skipEmpty) continue;
      if (!delimiter) {
        lines.push({ file: fileName, name: null, message: line });
      } else {

        const idx = line.indexOf(delimiter);
        if (idx > 0 && idx <= 30) {
          const name = line.slice(0, idx).trim();
          const message = line.slice(idx + 1).trim();
          if (name && message) {
            lines.push({ file: fileName, name, message });
          } else {
            lines.push({ file: fileName, name: null, message: line });
          }
        } else {
          lines.push({ file: fileName, name: null, message: line });
        }
      }
      n++;
    }
    return { lines, sourceMap: { lineCount: n, encoding: options.encoding || 'auto', delimiter } };
  },

  async pack({ lines, sourceMap, projectName, options, host }) {
    const delimiter = (options.speakerDelimiter ?? sourceMap?.delimiter ?? ':').trim();
    const out = lines
      .map(l => {
        const msg = l.is_translated && l.trans_message ? l.trans_message : l.message;
        const name = l.is_translated && l.trans_name ? l.trans_name : l.name;
        return name && delimiter ? `${name}${delimiter} ${msg}` : msg;
      })
      .join('\n');
    const blob = new Blob([out], { type: 'text/plain;charset=utf-8' });
    return { blob, filename: host.sanitizeName(projectName) + '_tl.txt' };
  }
};
