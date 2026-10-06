// Pure helpers for spreadsheet imports, shared by the page
// (spreadsheetImport.js) and the Web Worker (spreadsheet.worker.js). Nothing
// here touches the DOM, so it runs in either.
//
// A "column" describes one field the import understands:
//   { key, label, required, aliases, text, width, hint, example }
//   - label    the heading written in the template (and matched on import)
//   - aliases  other headings people commonly use for the same thing
//   - required the column must be present
//   - text     kept as text in the template (phone numbers, CNIC), so Excel
//              doesn't drop leading zeros
// Columns are plain data so they can be sent to the worker.

// Same limit as the server (handlers/import.go, maxImportRows).
export const MAX_IMPORT_ROWS = 10000;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

// Heading comparison ignores case, spaces, punctuation and the " *" the
// template adds to required columns: "E-mail", "email" and "EMAIL *" match.
export const normalizeHeader = (s) =>
  String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// Turns one cell from the parsed sheet into trimmed text.
export function cellToText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return '';
    // Excel dates come back as UTC midnight; the date part is what was typed.
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    // BigInt keeps long whole numbers (phone numbers, CNICs typed without
    // dashes) out of exponent notation like 3.0012e+21.
    return Number.isInteger(v) ? BigInt(v).toString() : String(v);
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v).replace(/\r\n?/g, '\n').trim();
}

// RFC 4180 CSV reader (quoted fields, "" escapes, newlines inside quotes).
// Picks ';' or tab as the separator when the heading row uses it, which is
// what Excel writes in some regional settings.
export function parseCSV(text) {
  let src = String(text || '');
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const count = (ch) => firstLine.split(ch).length - 1;
  let delim = ',';
  if (count(';') > count(',')) delim = ';';
  else if (count('\t') > count(',')) delim = '\t';

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row);
      row = []; field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  // Our own CSV exports put an apostrophe in front of values that start
  // with = + - @ (so Excel doesn't run them as formulas). Undo that here.
  return rows.map(r => r.map(c => (/^'[=+\-@]/.test(c) ? c.slice(1) : c)));
}

// Decodes CSV bytes as UTF-8, and refuses anything else rather than guess:
// Excel's plain "CSV" on Windows uses a legacy code page, which would turn
// Urdu text or accented names into garbage without anyone noticing.
export function decodeCSV(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new Error('This CSV file is not saved as UTF-8, so some characters would be imported incorrectly. In Excel choose File > Save As > "CSV UTF-8 (Comma delimited)", or save it as an Excel workbook (.xlsx), then try again.');
  }
}

// Matches the heading row to the known columns and turns every following
// non-empty row into { row, values } where values maps column key to trimmed
// text. `row` is the row number as Excel shows it.
export function mapSheetRows(rawRows, columns) {
  const rows = Array.isArray(rawRows) ? rawRows : [];
  const headerIndex = rows.findIndex(r => (r || []).some(c => cellToText(c) !== ''));
  if (headerIndex === -1) {
    return { error: 'The first sheet of this file is empty.' };
  }

  // A column's own label and key first, then aliases, so a column's own name
  // always wins over another column's alias.
  const lookup = new Map();
  for (const col of columns) {
    for (const n of [col.label, col.key]) {
      const k = normalizeHeader(n);
      if (k && !lookup.has(k)) lookup.set(k, col);
    }
  }
  for (const col of columns) {
    for (const n of col.aliases || []) {
      const k = normalizeHeader(n);
      if (k && !lookup.has(k)) lookup.set(k, col);
    }
  }

  const mapping = [];
  const used = new Set();
  const ignored = [];
  (rows[headerIndex] || []).forEach((cell, i) => {
    const text = cellToText(cell);
    if (!text) return;
    const col = lookup.get(normalizeHeader(text));
    if (col && !used.has(col.key)) {
      mapping[i] = col;
      used.add(col.key);
    } else {
      ignored.push(text);
    }
  });

  if (used.size === 0) {
    return {
      error: "None of the headings in the first row match this list's fields. Download the template to see the expected headings.",
    };
  }

  const records = [];
  for (let r = headerIndex + 1; r < rows.length; r++) {
    const raw = rows[r] || [];
    const values = {};
    let any = false;
    mapping.forEach((col, i) => {
      if (!col) return;
      const text = cellToText(raw[i]);
      values[col.key] = text;
      if (text !== '') any = true;
    });
    if (!any) continue; // blank, or text only in ignored columns
    records.push({ row: r + 1, values });
  }

  return {
    records,
    matchedKeys: columns.filter(c => used.has(c.key)).map(c => c.key),
    missingRequired: columns.filter(c => c.required && !used.has(c.key)).map(c => c.label),
    ignored,
  };
}

