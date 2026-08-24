/* @cstl-plugin
{
  "id": "cstl-magic-demo",
  "name": "Magic Bytes Demo",
  "version": "1.0.0",
  "author": "CSTL Example",
  "api_version": 1,
  "matchStrategy": ["magic", "filename"],
  "magic": [
    {"offset": 0, "hex": "4353544c5f4d4147"},
    {"offset": 0, "hex": "4d414731"}
  ],
  "filenameRegex": "^demo_",
  "description": "Plugin demo: cocokkan file tanpa extension via magic bytes atau pattern nama. File tidak punya extension, jadi strategi extension tidak dipakai.",
  "settings": [
    {
      "key": "decodeAs",
      "label": "Decode",
      "type": "select",
      "default": "auto",
      "options": [
        {"value": "auto", "label": "Auto (UTF-8 → SJIS)"},
        {"value": "utf8", "label": "Force UTF-8"},
        {"value": "sjis", "label": "Force Shift_JIS"}
      ]
    }
  ]
}
@cstl-plugin */

module.exports = {
  async extract({ fileName, buffer, options, host }) {
    const text = host.decode(buffer);
    const lines = [];
    let n = 0;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const idx = line.indexOf('|');
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
      n++;
    }
    return { lines, sourceMap: { lineCount: n, decodeAs: options.decodeAs || 'auto' } };
  },

  async pack({ lines, sourceMap, projectName, options, host }) {
    const out = lines
      .map(l => {
        const msg = l.is_translated && l.trans_message ? l.trans_message : l.message;
        const name = l.is_translated && l.trans_name ? l.trans_name : l.name;
        return name ? `${name}| ${msg}` : msg;
      })
      .join('\n');
    const blob = new Blob([out], { type: 'text/plain;charset=utf-8' });
    return { blob, filename: host.sanitizeName(projectName) + '_tl.txt' };
  }
};
