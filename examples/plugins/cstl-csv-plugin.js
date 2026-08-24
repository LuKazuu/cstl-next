/* @cstl-plugin
{
  "id": "cstl-csv",
  "name": "CSV (.csv)",
  "version": "1.0.0",
  "author": "CSTL Example",
  "api_version": 1,
  "extensions": [".csv"],
  "description": "Plugin referensi: CSV dengan kolom name,message. Round-trip name,message via CSV quoting. Auto-detect header.",
  "settings": [
    {
      "key": "delimiter",
      "label": "Delimiter",
      "type": "select",
      "default": ",",
      "options": [
        {"value": ",", "label": "Comma (,)"},
        {"value": ";", "label": "Semicolon (;)"},
        {"value": "\t", "label": "Tab (\\t)"}
      ],
      "description": "Pemisah kolom CSV."
    },
    {
      "key": "headerRow",
      "label": "Pakai header row",
      "type": "boolean",
      "default": true,
      "description": "Baris pertama dianggap header (name,message)."
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
      ]
    }
  ]
}
@cstl-plugin */

module.exports = {
  parseCsv(text, delim) {
    const rows = [];
    let i = 0, field = '', row = [], inQuote = false;
    const d = delim || ',';
    while (i < text.length) {
      const ch = text[i];
      if (inQuote) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; }
          else { inQuote = false; i++; }
        } else { field += ch; i++; }
      } else {
        if (ch === '"') { inQuote = true; i++; }
        else if (ch === d) { row.push(field); field = ''; i++; }
        else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
        else if (ch === '\r') { i++; }
        else { field += ch; i++; }
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  },

  csvField(s, delim) {
    const d = delim || ',';
    const v = s == null ? '' : String(s);
    if (new RegExp('["' + d + '\\n\\r]').test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  },

  async extract({ fileName, buffer, options, host }) {
    const text = host.decode(buffer);
    const delim = options.delimiter || ',';
    const rows = this.parseCsv(text, delim);
    if (!rows.length) return { lines: [], sourceMap: {} };
    const first = rows[0];
    let nameIdx = -1, msgIdx = -1, startRow = 0;
    if (first.length >= 2) {
      const lc = first.map(c => String(c || '').toLowerCase().trim());
      nameIdx = lc.findIndex(c => c === 'name' || c === 'speaker');
      msgIdx = lc.findIndex(c => c === 'message' || c === 'text' || c === 'line' || c === 'dialogue');
    }
    if (nameIdx < 0) nameIdx = 0;
    if (msgIdx < 0) msgIdx = first.length > 1 ? 1 : 0;
    if (nameIdx === msgIdx) msgIdx = (msgIdx + 1) % Math.max(first.length, 1);
    if (options.headerRow !== false && firstHasHeader(first, nameIdx, msgIdx)) startRow = 1;
    const lines = [];
    for (let r = startRow; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;
      const name = row[nameIdx] != null ? String(row[nameIdx]).trim() : null;
      const message = row[msgIdx] != null ? String(row[msgIdx]).trim() : '';
      if (!message && !name) continue;
      lines.push({ file: fileName, name: name || null, message });
    }
    return { lines, sourceMap: { nameIdx, msgIdx, headerRow: startRow, delimiter: delim } };
  },

  async pack({ lines, sourceMap, projectName, options, host }) {
    const delim = options.delimiter ?? sourceMap?.delimiter ?? ',';
    const nameIdx = sourceMap?.nameIdx ?? 0;
    const msgIdx = sourceMap?.msgIdx ?? 1;
    const hasHeader = (options.headerRow !== false) && !!(sourceMap?.headerRow);
    const maxCol = Math.max(nameIdx, msgIdx) + 1;
    const out = [];
    if (hasHeader) {
      const h = new Array(maxCol).fill('');
      h[nameIdx] = 'name';
      h[msgIdx] = 'message';
      out.push(h.map(c => this.csvField(c, delim)).join(delim));
    }
    for (const l of lines) {
      const row = new Array(maxCol).fill('');
      const name = l.is_translated && l.trans_name ? l.trans_name : l.name;
      const msg = l.is_translated && l.trans_message ? l.trans_message : l.message;
      row[nameIdx] = name || '';
      row[msgIdx] = msg || '';
      out.push(row.map(c => this.csvField(c, delim)).join(delim));
    }
    const blob = new Blob([out.join('\n')], { type: 'text/csv;charset=utf-8' });
    return { blob, filename: host.sanitizeName(projectName) + '_tl.csv' };
  }
};

function firstHasHeader(first, nameIdx, msgIdx) {
  const a = String(first[nameIdx] || '').toLowerCase().trim();
  const b = String(first[msgIdx] || '').toLowerCase().trim();
  if (a === 'name' || a === 'speaker') return true;
  if (b === 'message' || b === 'text' || b === 'line' || b === 'dialogue') return true;
  return false;
}
