// Spreadsheet import, page side. Reading and writing .xlsx files happens in
// a Web Worker (spreadsheet.worker.js), so a file with thousands of rows never
// freezes the page. Shared pure helpers live in spreadsheetCore.js.

import { MAX_FILE_BYTES } from './spreadsheetCore';

export { MAX_IMPORT_ROWS, MAX_FILE_BYTES, normalizeHeader } from './spreadsheetCore';

// ---- Worker client -----------------------------------------------------------

// Runs one job in a fresh worker and ends the worker afterwards, so its
// memory (a large workbook) is released as soon as the job is done.
function runWorker(type, payload) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('./spreadsheet.worker.js', import.meta.url), { type: 'module' });
    } catch {
      reject(new Error('Your browser could not start the spreadsheet reader. Please use a current version of Chrome, Edge or Firefox.'));
      return;
    }
    worker.onmessage = (e) => {
      worker.terminate();
      if (e.data?.ok) resolve(e.data.result);
      else reject(new Error(e.data?.error || 'The file could not be processed.'));
    };
    worker.onerror = (e) => {
      e.preventDefault?.();
      worker.terminate();
      reject(new Error('The file could not be processed. Check that it opens in Excel, then try again.'));
    };
    worker.postMessage({ type, payload });
  });
}

// Reads and maps a spreadsheet in the worker. Resolves to the result of
// mapSheetRows; rejects with an Error whose message can be shown as is.
export async function parseSpreadsheetFile(file, columns) {
  const name = (file?.name || '').toLowerCase();
  if (name.endsWith('.xls')) {
    throw new Error('This is an older Excel (.xls) file. Open it in Excel, choose File > Save As > Excel Workbook (.xlsx), then import the new file.');
  }
  if (!name.endsWith('.xlsx') && !name.endsWith('.csv')) {
    throw new Error('Choose an Excel workbook (.xlsx) or a CSV file.');
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`This file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Files up to ${MAX_FILE_BYTES / 1024 / 1024} MB can be imported; split it into smaller files.`);
  }
  return runWorker('parse', { file, columns, isCSV: name.endsWith('.csv') });
}

const downloadBlob = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Downloads an empty template: a data sheet with the headings, and a second
// sheet explaining each column. Only the first sheet is read on import.
export async function downloadImportTemplate({ columns, sheetName, fileName, intro }) {
  const blob = await runWorker('template', { columns, sheetName, intro });
  downloadBlob(blob, fileName);
}

// Downloads rows that were not imported, with their values and the reason,
// so they can be fixed and imported again.
export async function downloadProblemRows({ columns, rows, sheetName, fileName }) {
  const blob = await runWorker('problems', { columns, rows, sheetName });
  downloadBlob(blob, fileName);
}

// A random key identifying one import attempt (see handlers/import.go). Uses
// getRandomValues, which unlike randomUUID also works on plain-HTTP pages.
export function newIdempotencyKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
