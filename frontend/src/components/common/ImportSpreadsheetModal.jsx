import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X, FileSpreadsheet, Upload, Download, CheckCircle2, AlertTriangle, MinusCircle, Loader2, RotateCcw,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  parseSpreadsheetFile, downloadImportTemplate, downloadProblemRows, newIdempotencyKey, normalizeHeader,
} from '../../utils/spreadsheetImport';

// Import a list (clients, vendors) from an Excel or CSV file.
//
// 1. Pick a file. It is read in a Web Worker, so the page never freezes.
// 2. Check: the rows are sent to the server as a dry run. The server decides
//    what is valid (required values, formats, custom fields, names that
//    already exist or repeat) and nothing is saved.
// 3. Import: one request saves every valid row in a single transaction:
//    all of them or none. It carries an idempotency key, so if the
//    connection drops it is retried safely without importing anything twice.
// 4. Result: rows that were not imported can be downloaded with the reason
//    next to each, fixed, and imported again.
//
// `config` comes from buildClientImportConfig / buildVendorImportConfig.
// `onImported(response)` is called after a successful import.

const ROW_HEIGHT = 36;
const VIEW_HEIGHT = 420;
const OVERSCAN = 8;

// Headings our own "not imported" file adds; not worth listing as ignored
// when that file is imported again.
const OWN_REPORT_HEADERS = new Set(['problem', 'rowinoriginalfile']);

// Network failures and gateway errors are retried with the same key. A
// retry of a request that did go through returns the stored result.
const RETRY_DELAYS_MS = [2000, 5000, 10000];
const RETRYABLE_STATUS = new Set([502, 503, 504]);

const btn = 'inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500';
const btnSecondary = `${btn} border border-slate-300 dark:border-zinc-700 text-slate-700 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-800`;
const btnPrimary = `${btn} bg-indigo-600 hover:bg-indigo-700 text-white`;

const STATUS = {
  ready: { label: 'Ready', cls: 'text-emerald-700 dark:text-emerald-400', Icon: CheckCircle2 },
  created: { label: 'Imported', cls: 'text-emerald-700 dark:text-emerald-400', Icon: CheckCircle2 },
  duplicate: { label: 'Skipped', cls: 'text-amber-700 dark:text-amber-400', Icon: MinusCircle },
  error: { label: 'Needs fixing', cls: 'text-rose-700 dark:text-rose-400', Icon: AlertTriangle },
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fmt = (n) => Number(n || 0).toLocaleString();

// A fixed-height list that only renders the rows in view, so previews of
// 10,000 rows stay smooth.
const VirtualRows = ({ rows, columns, gridTemplate }) => {
  const [scrollTop, setScrollTop] = useState(0);
  const total = rows.length;
  const height = Math.min(VIEW_HEIGHT, total * ROW_HEIGHT + ROW_HEIGHT);
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(total, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);

  return (
    <div
      role="table"
      aria-rowcount={total + 1}
      className="overflow-auto rounded-lg border border-slate-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs"
      style={{ height: total === 0 ? 'auto' : height }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div className="min-w-max">
        <div role="row" className="grid sticky top-0 z-10 bg-slate-100 dark:bg-zinc-950 border-b border-slate-300 dark:border-zinc-800 font-semibold text-slate-600 dark:text-zinc-400"
          style={{ gridTemplateColumns: gridTemplate, height: ROW_HEIGHT }}>
          <div role="columnheader" className="px-2 flex items-center">Row</div>
          <div role="columnheader" className="px-2 flex items-center">Status</div>
          {columns.map(c => <div key={c.key} role="columnheader" className="px-2 flex items-center whitespace-nowrap">{c.label}</div>)}
          <div role="columnheader" className="px-2 flex items-center">Details</div>
        </div>
        {total === 0 ? (
          <p className="p-3 text-center text-slate-500">No rows here.</p>
        ) : (
          <div style={{ height: total * ROW_HEIGHT, position: 'relative' }}>
            {rows.slice(start, end).map((r, i) => {
              const s = STATUS[r.status] || STATUS.error;
              return (
                <div key={r.row} role="row" aria-rowindex={start + i + 2}
                  className="grid absolute left-0 right-0 border-b border-slate-200 dark:border-zinc-800/70 text-slate-800 dark:text-zinc-300"
                  style={{ gridTemplateColumns: gridTemplate, height: ROW_HEIGHT, top: (start + i) * ROW_HEIGHT }}>
                  <div role="cell" className="px-2 flex items-center text-slate-500 tabular-nums">{r.row}</div>
                  <div role="cell" className={`px-2 flex items-center gap-1 font-semibold whitespace-nowrap ${s.cls}`}>
                    <s.Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />{s.label}
                  </div>
                  {columns.map(c => (
                    <div key={c.key} role="cell" className="px-2 flex items-center min-w-0">
                      <span className="truncate" title={r.values[c.key] || ''}>
                        {r.values[c.key] || <span className="text-slate-400">—</span>}
                      </span>
                    </div>
                  ))}
                  <div role="cell" className={`px-2 flex items-center min-w-0 ${r.status === 'created' ? 'text-slate-500 dark:text-zinc-400' : s.cls}`}>
                    <span className="truncate" title={r.message || ''}>{r.status === 'created' ? r.number : r.message}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export const ImportSpreadsheetModal = ({ config, onClose, onImported }) => {
  const { apiFetch } = useApp();
  const fileInputRef = useRef(null);
  // Whether the dialog is still open, so late answers (file read, server
  // check, import) don't update a closed dialog. Set on every mount: in
  // development React's StrictMode mounts, unmounts and remounts once, and
  // only clearing the flag left it false, so every result was ignored and
  // the dialog stayed on "Reading…".
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // pick | reading | checking | preview | saving | done
  const [step, setStep] = useState('pick');
  const [fileName, setFileName] = useState('');
  const [pickError, setPickError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [parsed, setParsed] = useState(null); // { records, matchedKeys, missingRequired, ignored }
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [check, setCheck] = useState(null); // dry-run response
  const [checkError, setCheckError] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [saveError, setSaveError] = useState(null); // { message, canRetry }
  const [saveNote, setSaveNote] = useState('');
  const [final, setFinal] = useState(null); // commit response
  const [elapsed, setElapsed] = useState(0);
  const [filter, setFilter] = useState('all'); // all | ok | problems
  const [downloading, setDownloading] = useState(false);

  const { entityLabel, entityLabelPlural } = config;
  const columnsByKey = useMemo(() => new Map(config.columns.map(c => [c.key, c])), [config.columns]);
  const previewCols = config.previewColumns.map(k => columnsByKey.get(k)).filter(Boolean);
  const gridTemplate = `56px 120px ${previewCols.map(() => 'minmax(130px, 1fr)').join(' ')} minmax(260px, 2fr)`;

  const busy = step === 'reading' || step === 'checking' || step === 'saving';

  // While saving, closing the tab would leave the person unsure whether the
  // import went through, so the browser asks first.
  useEffect(() => {
    if (step !== 'saving') return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => { window.removeEventListener('beforeunload', warn); clearInterval(timer); };
  }, [step]);

  // Escape closes the dialog unless something is in progress.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const requestBody = useCallback((records, extra) => ({
    file_name: fileName,
    allow_duplicates: !!(config.allowDuplicateOverride && includeDuplicates),
    rows: records.map(config.toRequestRow),
    ...extra,
  }), [config, fileName, includeDuplicates]);

  // ---- Step 2: dry run on the server ----
  const runCheck = useCallback(async (records, allowDup, name = fileName) => {
    setStep('checking');
    setCheckError('');
    setSaveError(null);
    try {
      const res = await apiFetch(config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dry_run: true,
          file_name: name,
          allow_duplicates: !!(config.allowDuplicateOverride && allowDup),
          rows: records.map(config.toRequestRow),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!mountedRef.current) return;
      if (!res.ok) {
        setCheckError(data.error || `The file could not be checked (error ${res.status}).`);
      } else if (!Array.isArray(data.results) || data.results.length !== records.length) {
        setCheckError('The server answered unexpectedly. Please try again.');
      } else {
        setCheck(data);
        // A new key for every checked version of the rows: the import the
        // person confirms is exactly the one they previewed.
        setIdempotencyKey(newIdempotencyKey());
      }
    } catch {
      if (mountedRef.current) setCheckError('Could not reach the server. Check your connection and try again.');
    }
    if (mountedRef.current) setStep('preview');
  }, [apiFetch, config, fileName]);

  // ---- Step 1: read the file (in the worker) ----
  const handleFile = async (file) => {
    if (!file || busy) return;
    setPickError('');
    setFileName(file.name);
    setStep('reading');
    try {
      const result = await parseSpreadsheetFile(file, config.columns);
      if (!mountedRef.current) return;
      setParsed(result);
      setCheck(null);
      setFinal(null);
      setFilter('all');
      setIncludeDuplicates(false);
      if (result.missingRequired.length > 0) {
        setStep('preview'); // shows what's missing; nothing to check yet
      } else {
        await runCheck(result.records, false, file.name);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setPickError(err?.message || "This file couldn't be read.");
      setStep('pick');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleDuplicates = (checked) => {
    setIncludeDuplicates(checked);
    if (parsed) runCheck(parsed.records, checked);
  };

  // ---- Step 3: one transactional commit, retried safely ----
  const runImport = async () => {
    if (!parsed || !check || !idempotencyKey) return;
    setStep('saving');
    setElapsed(0);
    setSaveError(null);
    setSaveNote('');
    const body = JSON.stringify(requestBody(parsed.records, { dry_run: false, idempotency_key: idempotencyKey }));

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) {
        setSaveNote(`Connection problem — trying again (attempt ${attempt + 1} of ${RETRY_DELAYS_MS.length + 1})…`);
        await sleep(RETRY_DELAYS_MS[attempt - 1]);
        if (!mountedRef.current) return;
      }
      let res;
      let data;
      try {
        res = await apiFetch(config.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        data = await res.json().catch(() => ({}));
      } catch {
        continue; // network failure: retry with the same key
      }
      if (!mountedRef.current) return;
      if (RETRYABLE_STATUS.has(res.status)) continue;

      if (res.ok && Array.isArray(data.results)) {
        setFinal(data);
        setStep('done');
        setFilter((data.summary?.duplicate || 0) + (data.summary?.error || 0) > 0 ? 'problems' : 'all');
        onImported?.(data);
        return;
      }
      if (res.status === 409) {
        // Nothing was saved; the list changed meanwhile. Check again.
        setSaveError({ message: data.error || 'The list changed while importing, so nothing was saved.', recheck: true });
      } else {
        setSaveError({ message: data.error || `The import failed (error ${res.status}). Nothing was saved.`, canRetry: res.status >= 500 });
      }
      setStep('preview');
      return;
    }
    if (!mountedRef.current) return;
    setSaveError({
      message: "The server couldn't be reached, so it isn't known whether the import was saved. Try again: if it was saved, it won't be saved twice.",
      canRetry: true,
    });
    setStep('preview');
  };

  const handleDownloadTemplate = async () => {
    setDownloading(true);
    try {
      await downloadImportTemplate({
        columns: config.columns, sheetName: config.sheetName,
        fileName: config.templateFileName, intro: config.templateIntro,
      });
    } catch (err) {
      alert(err?.message || "The template couldn't be created. Please try again.");
    } finally {
      if (mountedRef.current) setDownloading(false);
    }
  };

  const reset = () => {
    setParsed(null);
    setCheck(null);
    setFinal(null);
    setFileName('');
    setPickError('');
    setCheckError('');
    setSaveError(null);
    setStep('pick');
  };

  // Rows with their current result (the commit's after importing, otherwise
  // the dry run's).
  const rows = useMemo(() => {
    if (!parsed) return [];
    const results = (final || check)?.results || [];
    return parsed.records.map((rec, i) => ({
      row: rec.row,
      values: rec.values,
      status: results[i]?.status || 'ready',
      message: results[i]?.message || '',
      number: results[i]?.number || '',
    }));
  }, [parsed, check, final]);

  const problemRows = useMemo(() => rows.filter(r => r.status === 'duplicate' || r.status === 'error'), [rows]);
  const okRows = useMemo(() => rows.filter(r => r.status === 'ready' || r.status === 'created'), [rows]);
  const visibleRows = filter === 'ok' ? okRows : filter === 'problems' ? problemRows : rows;
  const summary = (final || check)?.summary;
  const readyCount = check?.summary?.ready || 0;
  const hasDuplicates = (check?.summary?.duplicate || 0) > 0 || includeDuplicates;
  const ignoredHeaders = (parsed?.ignored || []).filter(h => !OWN_REPORT_HEADERS.has(normalizeHeader(h)));
  const matchedLabels = (parsed?.matchedKeys || []).map(k => columnsByKey.get(k)?.label).filter(Boolean);

  const handleDownloadProblems = async () => {
    setDownloading(true);
    try {
      await downloadProblemRows({
        columns: config.columns,
        rows: problemRows.map(r => ({ row: r.row, values: r.values, problem: r.message })),
        sheetName: config.sheetName,
        fileName: config.problemsFileName,
      });
    } catch (err) {
      alert(err?.message || "The file couldn't be created. Please try again.");
    } finally {
      if (mountedRef.current) setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 p-4 overflow-y-auto"
      onClick={() => { if (!busy) onClose(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-dialog-title"
        className="my-auto w-full max-w-5xl max-h-[92vh] flex flex-col rounded-xl bg-slate-100 dark:bg-zinc-950 border border-slate-300 dark:border-zinc-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h3 id="import-dialog-title" className="text-sm font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" aria-hidden="true" />
            Import {entityLabelPlural} from Excel
          </h3>
          <button onClick={onClose} disabled={busy} aria-label="Close"
            className="p-1 rounded text-slate-500 hover:bg-slate-300/60 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pb-5 overflow-y-auto space-y-4">
          {/* Step 1: pick a file */}
          {(step === 'pick' || step === 'reading') && (
            <>
              <p className="text-xs text-slate-600 dark:text-zinc-400 max-w-prose">
                Add many {entityLabelPlural} at once from a spreadsheet: one {entityLabel} per row, with headings in the
                first row. Every row is checked first, and nothing is saved until you confirm.
              </p>

              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3">
                <div className="flex-1 min-w-[220px] text-xs text-slate-700 dark:text-zinc-300">
                  <span className="font-semibold">Start from the template</span>
                  <span className="block text-slate-500 dark:text-zinc-400 mt-0.5">
                    It has the right headings and a second sheet explaining each column. Your own file works too if its headings are similar.
                  </span>
                </div>
                <button type="button" onClick={handleDownloadTemplate} disabled={downloading} className={btnSecondary}>
                  {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  Download template
                </button>
              </div>

              <div
                onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
                className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${dragOver
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30'
                  : 'border-slate-300 dark:border-zinc-700'}`}
              >
                {step === 'reading' ? (
                  <p className="text-xs text-slate-600 dark:text-zinc-400 inline-flex items-center gap-2" aria-live="polite">
                    <Loader2 className="w-4 h-4 animate-spin" /> Reading {fileName}…
                  </p>
                ) : (
                  <>
                    <Upload className="w-6 h-6 mx-auto text-slate-400" aria-hidden="true" />
                    <p className="mt-2 text-xs text-slate-600 dark:text-zinc-400">Drop an .xlsx or .csv file here (up to 10,000 rows), or</p>
                    <button type="button" onClick={() => fileInputRef.current?.click()} className={`${btnPrimary} mt-3`}>
                      Choose file
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                      className="hidden"
                      onChange={(e) => handleFile(e.target.files?.[0])}
                    />
                  </>
                )}
              </div>

              {pickError && (
                <p role="alert" className="text-xs text-rose-700 dark:text-rose-400 flex items-start gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> {pickError}
                </p>
              )}
            </>
          )}

          {/* Steps 2-4 */}
          {parsed && step !== 'pick' && step !== 'reading' && (
            <>
              <div className="text-xs text-slate-600 dark:text-zinc-400 space-y-1">
                <p>
                  <span className="font-semibold text-slate-800 dark:text-zinc-200">{fileName}</span>
                  {' '}has {fmt(parsed.records.length)} {parsed.records.length === 1 ? 'row' : 'rows'}.
                  {' '}Columns used: {matchedLabels.join(', ')}.
                </p>
                {ignoredHeaders.length > 0 && <p>Not recognised, so ignored: {ignoredHeaders.join(', ')}.</p>}
              </div>

              {parsed.missingRequired.length > 0 && (
                <p role="alert" className="text-xs rounded-lg border border-rose-300 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 p-3">
                  This file has no {parsed.missingRequired.join(', ')} column, which every {entityLabel} needs.
                  Add the column (or rename a heading to match) and choose the file again.
                </p>
              )}

              {step === 'checking' && (
                <p className="text-xs text-slate-600 dark:text-zinc-400 inline-flex items-center gap-2" aria-live="polite">
                  <Loader2 className="w-4 h-4 animate-spin" /> Checking {fmt(parsed.records.length)} rows…
                </p>
              )}

              {checkError && (
                <div role="alert" className="text-xs rounded-lg border border-rose-300 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 p-3 flex flex-wrap items-center gap-3">
                  <span className="flex-1">{checkError}</span>
                  <button type="button" onClick={() => runCheck(parsed.records, includeDuplicates)} className={btnSecondary}>
                    <RotateCcw className="w-4 h-4" /> Check again
                  </button>
                </div>
              )}

              {/* Summary */}
              {summary && step === 'preview' && (
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs" aria-live="polite">
                  <span className={STATUS.ready.cls}><b>{fmt(summary.ready)}</b> ready to import</span>
                  {summary.duplicate > 0 && <span className={STATUS.duplicate.cls}><b>{fmt(summary.duplicate)}</b> will be skipped (already exist)</span>}
                  {summary.error > 0 && <span className={STATUS.error.cls}><b>{fmt(summary.error)}</b> need fixing</span>}
                </div>
              )}
              {step === 'saving' && (
                <div className="rounded-lg border border-slate-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 space-y-1" aria-live="polite">
                  <p className="text-xs text-slate-800 dark:text-zinc-200 inline-flex items-center gap-2 font-semibold">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving {fmt(readyCount)} {readyCount === 1 ? entityLabel : entityLabelPlural}… {elapsed > 2 ? `${elapsed}s` : ''}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                    Keep this window open. All rows are saved together: either every one of them or none.
                  </p>
                  {saveNote && <p className="text-[11px] text-amber-700 dark:text-amber-400">{saveNote}</p>}
                </div>
              )}
              {step === 'done' && summary && (
                <div className="rounded-lg border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-3 flex flex-wrap gap-x-5 gap-y-1 text-xs" role="status">
                  <span className={STATUS.created.cls}><b>{fmt(summary.created)}</b> imported</span>
                  {summary.duplicate > 0 && <span className={STATUS.duplicate.cls}><b>{fmt(summary.duplicate)}</b> skipped (already exist)</span>}
                  {summary.error > 0 && <span className={STATUS.error.cls}><b>{fmt(summary.error)}</b> not imported because of errors</span>}
                  {final?.batch_id ? <span className="text-slate-500 dark:text-zinc-400">Import #{final.batch_id}</span> : null}
                </div>
              )}

              {saveError && step === 'preview' && (
                <div role="alert" className="text-xs rounded-lg border border-rose-300 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 p-3 flex flex-wrap items-center gap-3">
                  <span className="flex-1">{saveError.message}</span>
                  {saveError.recheck && (
                    <button type="button" onClick={() => runCheck(parsed.records, includeDuplicates)} className={btnSecondary}>
                      <RotateCcw className="w-4 h-4" /> Check again
                    </button>
                  )}
                </div>
              )}

              {step === 'preview' && config.allowDuplicateOverride && hasDuplicates && (
                <label className="flex items-start gap-2 text-xs text-slate-700 dark:text-zinc-300 cursor-pointer max-w-prose">
                  <input type="checkbox" checked={includeDuplicates} onChange={(e) => toggleDuplicates(e.target.checked)}
                    className="mt-0.5 accent-indigo-600" />
                  <span>
                    Also import rows whose name matches an existing {entityLabel} or another row
                    (for example, separate branches of the same company). Archived matches are still skipped.
                  </span>
                </label>
              )}

              {(check || final) && (
                <>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div role="tablist" aria-label="Show rows" className="inline-flex rounded-lg border border-slate-300 dark:border-zinc-700 overflow-hidden text-xs">
                      {[
                        ['all', `All (${fmt(rows.length)})`],
                        ['ok', `${final ? 'Imported' : 'Ready'} (${fmt(okRows.length)})`],
                        ['problems', `Not imported (${fmt(problemRows.length)})`],
                      ].map(([key, label]) => (
                        <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)}
                          className={`px-3 py-1.5 cursor-pointer ${filter === key
                            ? 'bg-indigo-600 text-white'
                            : 'bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800'}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {problemRows.length > 0 && !busy && (
                      <button type="button" onClick={handleDownloadProblems} disabled={downloading} className={btnSecondary}
                        title="A spreadsheet of these rows with the reason for each, to fix and import again">
                        {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        Download rows not imported
                      </button>
                    )}
                  </div>
                  <VirtualRows rows={visibleRows} columns={previewCols} gridTemplate={gridTemplate} />
                </>
              )}
            </>
          )}
        </div>

        {parsed && step !== 'pick' && step !== 'reading' && (
          <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-3 border-t border-slate-300 dark:border-zinc-800">
            {(step === 'preview' || step === 'checking') && (
              <>
                <button type="button" onClick={reset} disabled={busy} className={btnSecondary}>Choose a different file</button>
                <button type="button" onClick={runImport}
                  disabled={busy || !check || readyCount === 0 || parsed.missingRequired.length > 0}
                  className={btnPrimary}>
                  {saveError?.canRetry ? 'Try again: ' : ''}Import {fmt(readyCount)} {readyCount === 1 ? entityLabel : entityLabelPlural}
                </button>
              </>
            )}
            {step === 'done' && (
              <>
                <button type="button" onClick={reset} className={btnSecondary}>Import another file</button>
                <button type="button" onClick={onClose} className={btnPrimary}>Done</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
