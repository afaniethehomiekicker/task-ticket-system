// Web Worker for spreadsheet imports: reading .xlsx / .csv files and writing
// the template and "rows not imported" workbooks, off the main thread so the
// page stays responsive with files of thousands of rows.
//
// Messages: { type: 'parse' | 'template' | 'problems', payload }
// Replies:  { ok: true, result } or { ok: false, error: <message for the user> }

import { readSheet } from 'read-excel-file/web-worker';
import writeExcelFile from 'write-excel-file/universal';
import { MAX_IMPORT_ROWS, mapSheetRows, parseCSV, decodeCSV } from './spreadsheetCore';

const HEADER_STYLE = { fontWeight: 'bold', backgroundColor: '#E2E8F0' };

const headerCell = (c) => ({ value: c.required ? `${c.label} *` : c.label, ...HEADER_STYLE });

async function parse({ file, columns, isCSV }) {
  let rawRows;
  if (isCSV) {
    rawRows = parseCSV(decodeCSV(await file.arrayBuffer()));
  } else {
    try {
      rawRows = await readSheet(file);
    } catch {
      throw new Error("This file couldn't be read. Check that it opens in Excel and is saved as an Excel workbook (.xlsx).");
    }
  }
  const mapped = mapSheetRows(rawRows, columns);
  if (mapped.error) throw new Error(mapped.error);
  if (mapped.records.length === 0) {
    throw new Error('There are no rows below the heading row.');
  }
  if (mapped.records.length > MAX_IMPORT_ROWS) {
    throw new Error(`This file has ${mapped.records.length.toLocaleString()} rows. Up to ${MAX_IMPORT_ROWS.toLocaleString()} can be imported at once; split the file and import each part.`);
  }
  return mapped;
}

async function template({ columns, sheetName, intro }) {
  // Pre-formatted blank rows, so numbers typed into text columns (phones,
  // CNIC) keep their leading zeros.
  const blankRows = Array.from({ length: 500 }, () =>
    columns.map(c => (c.text ? { value: '', type: String, format: '@' } : null)));
  const guide = [
    [{ value: 'Column', ...HEADER_STYLE }, { value: 'Required', ...HEADER_STYLE },
      { value: 'What to enter', ...HEADER_STYLE }, { value: 'Example', ...HEADER_STYLE }],
    ...columns.map(c => [
      c.label,
      c.required ? 'Yes' : 'No',
      { value: c.hint || '', wrap: true },
      c.example ? { value: c.example, type: String } : '',
    ]),
    [],
    [{ value: intro || '', wrap: true }],
  ];
  return writeExcelFile([
    {
      sheet: sheetName,
      data: [columns.map(headerCell), ...blankRows],
      columns: columns.map(c => ({ width: c.width || 18 })),
      stickyRowsCount: 1,
    },
    {
      sheet: 'How to fill',
      data: guide,
      columns: [{ width: 22 }, { width: 10 }, { width: 60 }, { width: 28 }],
      stickyRowsCount: 1,
    },
  ]).toBlob();
}

async function problems({ columns, rows, sheetName }) {
  const data = [
    [
      ...columns.map(headerCell),
      { value: 'Problem', ...HEADER_STYLE, textColor: '#B91C1C' },
      { value: 'Row in original file', ...HEADER_STYLE },
    ],
    // Every value is written as text: nothing from the file can become a
    // formula, and phone numbers keep their leading zeros.
    ...rows.map(r => [
      ...columns.map(c => ({ value: r.values[c.key] || '', type: String, format: '@' })),
      { value: r.problem || '', type: String, textColor: '#B91C1C' },
      r.row,
    ]),
  ];
  return writeExcelFile(data, {
    sheet: sheetName,
    columns: [...columns.map(c => ({ width: c.width || 18 })), { width: 50 }, { width: 12 }],
    stickyRowsCount: 1,
  }).toBlob();
}

const jobs = { parse, template, problems };

self.onmessage = async (e) => {
  const { type, payload } = e.data || {};
  try {
    const job = jobs[type];
    if (!job) throw new Error(`Unknown job: ${type}`);
    self.postMessage({ ok: true, result: await job(payload) });
  } catch (err) {
    self.postMessage({ ok: false, error: err?.message || 'The file could not be processed.' });
  }
};
