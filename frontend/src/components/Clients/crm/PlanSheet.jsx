import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pencil, Plus, Save, Undo2, Search, Filter, Download, History, Maximize2, Minimize2,
  Trash2, RotateCcw, Loader2, AlertTriangle, Eye, EyeOff, X, CheckCircle2, Type,
} from 'lucide-react';
import { useAppSelector } from '../../../context/AppContext';
import { ClientTicketPicker } from './ClientTicketPicker';
import { ClientChangeHistory } from './ClientChangeHistory';
import { downloadTableAsExcel } from '../../../utils/spreadsheetImport';
import { usePlanColumnLabels, reloadPlanColumnLabels } from './planColumnLabels';

const REVEAL_MS = 30000; // a revealed password hides itself again after this

// Excel-style sheet for a client's network plans (client CRM steps 3–4).
// Used by the IP Plan now and the Transmission Plan next.
//
//   <PlanSheet clientId={id} clientName="Acme" plan="ip" title="IP Plan"
//              columns={[{ key, label, width, placeholder, mono, multiline, validate }]}
//              recordType="ip_plan" onOpenTicket={fn} />
//
// How it works:
//   - Read-only until "Edit sheet". Then every cell is editable in place:
//     Enter / ↓ next row, Shift+Enter / ↑ previous, ← → at the edge of the
//     text move across, Enter on the last row adds a row. Pasting a block
//     copied from Excel fills the cells (and adds rows as needed).
//   - Changes stay in the browser until Save. Save needs a ticket of this
//     client and sends everything in one go; the server records each change
//     (old → new, who, when, ticket) and refuses the save if someone else
//     changed one of the same rows meanwhile.
//   - Rows are never deleted or overwritten. "Remove" keeps the row, struck
//     through in red (it can be restored). Editing a row keeps the old
//     version struck through and puts the edited version right below it.
//   - The Super Admin can rename the column titles (the header row) with
//     "Rename columns"; the titles apply to every client's sheet.
//   - validate(value, row, allRows) may return a warning; warnings are shown
//     but don't block saving.
//   - A column with type: 'service' links each row to one of the client's
//     services (a dropdown); the IP and BGP plans require it. It travels as
//     service_id, not as a data column, and Save is refused while a new or
//     changed row has no service.
//   - A column with secret: true (Transmission Plan password) is never in
//     the rows the server sends. It shows •••••• with an eye button for
//     people allowed to see passwords (each reveal is audited), is edited as
//     a password field, is left out of search, filters and the Excel export,
//     and is never written to the history.

const META_COLS = [
  { key: '_ticket', label: 'Ticket ID', width: 120 },
  { key: '_when', label: 'Date & Time', width: 150 },
  { key: '_by', label: 'Updated By', width: 140 },
];

let tmpCounter = 0;
const newTmpId = () => `new-${Date.now()}-${++tmpCounter}`;

const fmtDateTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const emptyData = (columns) => Object.fromEntries(columns.filter(c => !c.secret).map(c => [c.key, '']));

export const PlanSheet = ({ clientId, clientName = '', plan, title, columns: baseColumns, recordType, onOpenTicket, fieldLabels, onDirtyChange }) => {
  const { apiFetch, currentUser } = useAppSelector(s => ({ apiFetch: s.apiFetch, currentUser: s.currentUser }));
  const isSuperAdmin = currentUser?.role === 'super_admin';

  // Column titles: built-in, or renamed by the Super Admin.
  const customLabels = usePlanColumnLabels(apiFetch, plan);
  const columns = useMemo(() => baseColumns.map(c => (customLabels[c.key] ? { ...c, label: customLabels[c.key] } : c)), [baseColumns, customLabels]);
  const metaCols = useMemo(() => META_COLS.map(m => (customLabels[m.key] ? { ...m, label: customLabels[m.key] } : m)), [customLabels]);
  const [headerEdit, setHeaderEdit] = useState(null); // null | { key: title }
  const [headerSaving, setHeaderSaving] = useState(false);
  const saveHeader = async () => {
    const all = [...META_COLS, ...baseColumns];
    const labelsOut = {};
    for (const c of all) {
      const typed = (headerEdit[c.key] ?? '').trim();
      // Same as the built-in title → store nothing (back to default).
      const next = typed === c.label ? '' : typed;
      if (next !== (customLabels[c.key] || '')) labelsOut[c.key] = next;
    }
    if (Object.keys(labelsOut).length === 0) { setHeaderEdit(null); return; }
    setHeaderSaving(true);
    try {
      const res = await apiFetch(`/api/plan-column-labels/${plan}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ labels: labelsOut }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setSaveError(d.error || 'Could not rename the columns'); return; }
      reloadPlanColumnLabels();
      setHeaderEdit(null);
    } catch {
      setSaveError('Could not reach the server');
    } finally {
      setHeaderSaving(false);
    }
  };

  // Server state
  const [rows, setRows] = useState([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [canViewSecrets, setCanViewSecrets] = useState(false);
  const [secretsReady, setSecretsReady] = useState(true);
  // row key -> { value } (new password) or { clear: true }; absent = unchanged
  const [secretDrafts, setSecretDrafts] = useState({});
  const [revealed, setRevealed] = useState({});    // row id -> password (briefly)
  const [revealing, setRevealing] = useState({});
  const [showRemoved, setShowRemoved] = useState(true); // struck-out rows (removed / old versions) are shown by default

  // Local edits (until Save)
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState({});        // id -> data (existing rows)
  const [newRows, setNewRows] = useState([]);      // [{ tmpId, data }]
  const [toRemove, setToRemove] = useState({});    // id -> true
  const [toRestore, setToRestore] = useState({});  // id -> true
  const [ticket, setTicket] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [conflicts, setConflicts] = useState({});
  const [flash, setFlash] = useState('');

  // View
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [colFilters, setColFilters] = useState({});
  const [fullscreen, setFullscreen] = useState(false);
  const [history, setHistory] = useState(null);    // null | 'all' | row id
  const [historyKey, setHistoryKey] = useState(0);

  const cellRefs = useRef({});
  const focusAfter = useRef(null);

  const dataColumns = useMemo(() => columns.filter(c => !c.secret), [columns]);
  const secretCol = useMemo(() => columns.find(c => c.secret) || null, [columns]);
  const canSetSecrets = !!secretCol && canViewSecrets && secretsReady;

  const labels = useMemo(() => ({
    service: 'Service',
    ...(fieldLabels || Object.fromEntries(columns.map(c => [c.key, c.label]))),
  }), [fieldLabels, columns]);

  // ---- services (type: 'service' column) ----
  const serviceCol = useMemo(() => columns.find(c => c.type === 'service') || null, [columns]);
  const [services, setServices] = useState([]);
  const loadServices = useCallback(async () => {
    if (!serviceCol) return;
    try {
      const res = await apiFetch(`/api/clients/${clientId}/services`);
      if (res.ok) {
        const d = await res.json().catch(() => ({}));
        setServices(d.services || []);
      }
    } catch { /* the cell shows the id until it loads */ }
  }, [apiFetch, clientId, serviceCol]);
  useEffect(() => { loadServices(); }, [loadServices]);
  const serviceById = useMemo(() => Object.fromEntries(services.map(sv => [String(sv.id), sv])), [services]);
  const serviceLabel = useCallback((id) => {
    if (!id) return '';
    const sv = serviceById[String(id)];
    if (!sv) return `Service #${id}`;
    return [sv.service_number, sv.product, sv.capacity, sv.location].filter(Boolean).join(' · ') + (sv.status === 'closed' ? ' (closed)' : '');
  }, [serviceById]);
  // Text shown / searched / exported for a cell.
  const cellText = useCallback((c, data) => (c.type === 'service' ? serviceLabel(data[c.key]) : (data[c.key] || '')), [serviceLabel]);

  const applyResponse = (data) => {
    // The service link is edited like a column: carry it in data._service.
    setRows((data.rows || []).map(r => (serviceCol
      ? { ...r, data: { ...r.data, [serviceCol.key]: r.service_id ? String(r.service_id) : '' } }
      : r)));
    setCanEdit(!!data.can_edit);
    setTruncated(!!data.truncated);
    setCanViewSecrets(!!data.can_view_secrets);
    setSecretsReady(data.secrets_ready !== false);
    setRevealed({});
  };

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const res = await apiFetch(`/api/clients/${clientId}/plans/${plan}${showRemoved ? '?include_removed=1' : ''}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data.error || `Could not load the ${title}`);
        return;
      }
      applyResponse(data);
    } catch {
      setLoadError('Could not reach the server');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, clientId, plan, showRemoved, title]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // ---- pending changes ----
  const pending = useMemo(() => {
    const added = newRows.filter(r => Object.entries(r.data).some(([k, v]) => k !== serviceCol?.key && String(v).trim() !== '') || secretDrafts[r.tmpId]?.value);
    const changed = new Set(Object.keys(drafts));
    for (const k of Object.keys(secretDrafts)) {
      if (k.startsWith('r')) changed.add(k.slice(1)); // existing rows are keyed "r<id>"
    }
    return {
      added,
      changed: [...changed],
      removed: Object.keys(toRemove),
      restored: Object.keys(toRestore),
    };
  }, [newRows, drafts, secretDrafts, toRemove, toRestore]);
  const pendingCount = pending.added.length + pending.changed.length + pending.removed.length + pending.restored.length;
  const hasLocalWork = pendingCount > 0 || newRows.length > 0;

  // Tell the parent (Client 360) so closing it can ask first.
  useEffect(() => { onDirtyChange?.(hasLocalWork); }, [hasLocalWork, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  // Warn before leaving the page with unsaved changes.
  useEffect(() => {
    if (!hasLocalWork) return undefined;
    const onBefore = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [hasLocalWork]);

  const resetLocal = () => {
    setDrafts({});
    setSecretDrafts({});
    setNewRows([]);
    setToRemove({});
    setToRestore({});
    setTicket(null);
    setSaveError('');
    setConflicts({});
  };

  const startEditing = () => { setEditing(true); setFlash(''); loadServices(); };
  const stopEditing = () => {
    if (hasLocalWork && !window.confirm('Discard your unsaved changes to this sheet?')) return;
    resetLocal();
    setEditing(false);
  };
  const discard = () => {
    if (!window.confirm('Discard all unsaved changes?')) return;
    resetLocal();
  };

  // ---- the rows shown ----
  const byId = useMemo(() => Object.fromEntries(rows.map(r => [r.id, r])), [rows]);

  const display = useMemo(() => {
    const list = rows.map(r => ({
      key: `r${r.id}`,
      id: r.id,
      server: r,
      data: drafts[r.id] || r.data,
      edited: !!drafts[r.id] || !!secretDrafts[`r${r.id}`],
      removed: r.removed,
      pendingRemove: !!toRemove[r.id],
      pendingRestore: !!toRestore[r.id],
    }));
    for (const n of newRows) {
      list.push({ key: n.tmpId, tmpId: n.tmpId, data: n.data, isNew: true });
    }
    return list;
  }, [rows, drafts, secretDrafts, newRows, toRemove, toRestore]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const activeFilters = Object.entries(colFilters).filter(([, v]) => v.trim());
    if (!q && activeFilters.length === 0) return display;
    return display.filter(r => {
      if (r.isNew) return true; // rows being added always stay visible
      const meta = [r.server?.ticket_number, r.server?.updated_by_name];
      if (q) {
        const hay = [...dataColumns.map(c => cellText(c, r.data)), ...meta].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      for (const [k, v] of activeFilters) {
        const col = dataColumns.find(c => c.key === k);
        const val = k === '_ticket' ? r.server?.ticket_number : k === '_by' ? r.server?.updated_by_name : col ? cellText(col, r.data) : r.data[k];
        if (!String(val || '').toLowerCase().includes(v.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [display, search, colFilters, dataColumns, cellText]);

  // Rows whose cells can be typed in (keyboard navigation and paste).
  const editableRows = useMemo(
    () => filtered.filter(r => !r.removed && !r.pendingRemove),
    [filtered],
  );
  const editIndex = useMemo(() => new Map(editableRows.map((r, i) => [r.key, i])), [editableRows]);

  // Warnings (don't block saving).
  const warnings = useMemo(() => {
    const out = {};
    const active = display.filter(r => !r.removed && !r.pendingRemove);
    for (const r of active) {
      for (const c of dataColumns) {
        if (!c.validate) continue;
        const w = c.validate(r.data[c.key] || '', r, active);
        if (w) out[`${r.key}:${c.key}`] = w;
      }
    }
    return out;
  }, [display, dataColumns]);
  const warningCount = Object.keys(warnings).length;

  // ---- editing ----
  const setSecret = (row, value) => {
    setSecretDrafts(m => {
      const copy = { ...m };
      if (value === '') delete copy[row.key]; // emptied the box: leave the password as it was
      else copy[row.key] = { value };
      return copy;
    });
  };
  const clearSecret = (row) => setSecretDrafts(m => ({ ...m, [row.key]: { clear: true } }));
  const undoSecret = (row) => setSecretDrafts(m => { const copy = { ...m }; delete copy[row.key]; return copy; });

  const setCell = (row, key, value) => {
    if (secretCol && key === secretCol.key) {
      if (canSetSecrets) setSecret(row, value);
      return;
    }
    if (row.isNew) {
      setNewRows(list => list.map(n => (n.tmpId === row.tmpId ? { ...n, data: { ...n.data, [key]: value } } : n)));
      return;
    }
    const original = byId[row.id]?.data || {};
    setDrafts(d => {
      const next = { ...(d[row.id] || original), [key]: value };
      const same = dataColumns.every(c => (next[c.key] || '') === (original[c.key] || ''));
      const copy = { ...d };
      if (same) delete copy[row.id];
      else copy[row.id] = next;
      return copy;
    });
  };

  const addRow = (focus = true) => {
    const tmpId = newTmpId();
    setNewRows(list => [...list, { tmpId, data: emptyData(dataColumns) }]);
    if (focus) focusAfter.current = `${tmpId}:0`;
    return tmpId;
  };

  // Focus a cell after the render that created it.
  useEffect(() => {
    if (!focusAfter.current) return;
    const el = cellRefs.current[focusAfter.current];
    if (el) {
      el.focus();
      focusAfter.current = null;
    }
  });

  const toggleRemove = (row) => {
    if (row.isNew) {
      setNewRows(list => list.filter(n => n.tmpId !== row.tmpId));
      undoSecret(row);
      return;
    }
    if (toRemove[row.id]) {
      setToRemove(m => { const copy = { ...m }; delete copy[row.id]; return copy; });
    } else {
      setToRemove(m => ({ ...m, [row.id]: true }));
      // Removing a row drops any edits to it.
      setDrafts(d => { const copy = { ...d }; delete copy[row.id]; return copy; });
      undoSecret(row);
    }
  };

  const toggleRestore = (row) => {
    setToRestore(m => {
      const copy = { ...m };
      if (copy[row.id]) delete copy[row.id];
      else copy[row.id] = true;
      return copy;
    });
  };

  const focusCell = (rowIdx, colIdx) => {
    const row = editableRows[rowIdx];
    if (!row) return false;
    const el = cellRefs.current[`${row.key}:${colIdx}`];
    if (el) { el.focus(); return true; }
    return false;
  };

  const onCellKeyDown = (e, rowIdx, colIdx) => {
    const el = e.target;
    const col = columns[colIdx];
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const atEnd = el.selectionStart === el.value.length;
    if ((e.key === 'Enter' && !e.shiftKey && !col.multiline) || (e.key === 'ArrowDown' && !col.multiline)) {
      e.preventDefault();
      if (!focusCell(rowIdx + 1, colIdx) && e.key === 'Enter') {
        const tmpId = addRow(false);
        focusAfter.current = `${tmpId}:${colIdx}`;
      }
    } else if ((e.key === 'Enter' && e.shiftKey && !col.multiline) || (e.key === 'ArrowUp' && !col.multiline)) {
      e.preventDefault();
      focusCell(rowIdx - 1, colIdx);
    } else if (e.key === 'ArrowRight' && atEnd && colIdx < columns.length - 1) {
      e.preventDefault();
      focusCell(rowIdx, colIdx + 1);
    } else if (e.key === 'ArrowLeft' && atStart && colIdx > 0) {
      e.preventDefault();
      focusCell(rowIdx, colIdx - 1);
    }
  };

  // Paste a block copied from Excel / Google Sheets (tab-separated lines).
  const onCellPaste = (e, rowIdx, colIdx) => {
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!text.includes('\t') && !text.includes('\n')) return; // single value: normal paste
    e.preventDefault();
    const lines = text.replace(/\r/g, '').split('\n');
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    const matrix = lines.map(l => l.split('\t'));
    if (matrix.length > 2000) {
      setSaveError('Paste up to 2000 rows at a time.');
      return;
    }
    const targets = editableRows.slice(rowIdx);
    const extraNew = [];
    matrix.forEach((cells, i) => {
      const target = targets[i];
      const patch = {};
      let secret = null;
      cells.forEach((v, j) => {
        const col = columns[colIdx + j];
        if (!col) return;
        if (col.secret) secret = v; // passwords keep their exact text
        else if (col.type === 'service') {
          // Match a pasted "SVC-000003 …" (or the exact label) to a service.
          const t = v.trim().toLowerCase();
          const hit = services.find(sv => t && (t.startsWith(String(sv.service_number).toLowerCase()) || serviceLabel(sv.id).toLowerCase() === t));
          if (hit) patch[col.key] = String(hit.id);
        } else patch[col.key] = v.trim();
      });
      if (target) {
        Object.entries(patch).forEach(([k, v]) => setCell(target, k, v));
        if (secret && canSetSecrets) setSecret(target, secret);
      } else {
        const tmpId = newTmpId();
        extraNew.push({ tmpId, data: { ...emptyData(dataColumns), ...patch } });
        if (secret && canSetSecrets) setSecretDrafts(m => ({ ...m, [tmpId]: { value: secret } }));
      }
    });
    if (extraNew.length) setNewRows(list => [...list, ...extraNew]);
  };

  // ---- passwords ----
  const revealTimers = useRef({});
  useEffect(() => () => Object.values(revealTimers.current).forEach(clearTimeout), []);
  const reveal = async (rowId) => {
    if (!rowId) return;
    setRevealing(m => ({ ...m, [rowId]: true }));
    setSaveError('');
    try {
      const res = await apiFetch(`/api/clients/${clientId}/plans/${plan}/rows/${rowId}/secret`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFlash('');
        setSaveError(data.error || 'Could not show the password');
        return;
      }
      setRevealed(m => ({ ...m, [rowId]: data.secret || '' }));
      clearTimeout(revealTimers.current[rowId]);
      revealTimers.current[rowId] = setTimeout(() => {
        setRevealed(m => { const copy = { ...m }; delete copy[rowId]; return copy; });
      }, REVEAL_MS);
    } catch {
      setSaveError('Could not reach the server');
    } finally {
      setRevealing(m => { const copy = { ...m }; delete copy[rowId]; return copy; });
    }
  };

  // ---- save ----
  const save = async () => {
    setSaveError('');
    if (!ticket) {
      setSaveError('Choose the ticket that authorizes these changes.');
      return;
    }
    // Service link travels as service_id, not as a data column.
    const split = (data) => {
      if (!serviceCol) return { data };
      const { [serviceCol.key]: svc, ...rest } = data;
      return { data: rest, service_id: svc ? Number(svc) : null };
    };
    if (serviceCol?.required) {
      const missing = [
        ...pending.added.filter(n => !n.data[serviceCol.key]),
        ...pending.changed.filter(id => !(drafts[id] || byId[id].data)[serviceCol.key]),
      ];
      if (missing.length) {
        setSaveError(`${missing.length} row${missing.length === 1 ? '' : 's'} ha${missing.length === 1 ? 's' : 've'} no service. Pick the service each row belongs to (the yellow “Service” cells).`);
        return;
      }
    }
    const body = {
      ticket: ticket.ticketNumber,
      created: pending.added.map(n => {
        const sd = secretDrafts[n.tmpId];
        const item = split(n.data);
        if (sd?.value) item.secret = sd.value;
        return item;
      }),
      updated: pending.changed.map(id => {
        const item = { id: Number(id), version: byId[id].version, ...split(drafts[id] || byId[id].data) };
        const sd = secretDrafts[`r${id}`];
        if (sd) item.secret = sd.clear ? '' : sd.value;
        return item;
      }),
      removed: pending.removed.map(id => ({ id: Number(id), version: byId[id].version })),
      restored: pending.restored.map(id => ({ id: Number(id), version: byId[id].version })),
    };
    setSaving(true);
    try {
      const res = await apiFetch(`/api/clients/${clientId}/plans/${plan}/changes${showRemoved ? '?include_removed=1' : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error || 'Could not save the changes');
        if (res.status === 409 && Array.isArray(data.conflicts)) {
          setConflicts(Object.fromEntries(data.conflicts.map(id => [id, true])));
        }
        return;
      }
      applyResponse(data);
      const s = data.saved || {};
      const parts = [
        s.added && `${s.added} added`, s.changed && `${s.changed} changed (old version kept above)`,
        s.removed && `${s.removed} removed`, s.restored && `${s.restored} restored`,
      ].filter(Boolean);
      resetLocal();
      setHistoryKey(k => k + 1);
      setFlash(parts.length ? `Saved under ${body.ticket}: ${parts.join(', ')}.` : 'Nothing had actually changed.');
    } catch {
      setSaveError('Could not reach the server');
    } finally {
      setSaving(false);
    }
  };

  const reloadAfterConflict = async () => {
    if (hasLocalWork && !window.confirm('Reloading discards your unsaved changes. Continue?')) return;
    resetLocal();
    setLoading(true);
    await load();
  };

  // ---- export ----
  const exportExcel = async () => {
    const cols = [...metaCols.map(m => ({ label: m.label, width: m.width / 7 })), ...dataColumns.map(c => ({ label: c.label, width: (c.width || 160) / 7 }))];
    const data = filtered.filter(r => !r.isNew).map(r => [
      r.server.ticket_number, fmtDateTime(r.server.updated_at), r.server.updated_by_name,
      ...dataColumns.map(c => cellText(c, byId[r.id]?.data || r.server.data)),
    ]);
    const safe = (clientName || 'client').replace(/[^\w-]+/g, '_').slice(0, 40);
    try {
      await downloadTableAsExcel({
        columns: cols, rows: data, sheetName: title,
        fileName: `${safe}_${title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`,
      });
    } catch (err) {
      setSaveError(err.message || 'Export failed');
    }
  };

  // ---- render ----
  const totalActive = rows.filter(r => !r.removed).length;
  const filtersOn = search.trim() || Object.values(colFilters).some(v => v.trim());

  const metaCell = (r) => {
    if (r.isNew) return [<span key="t" className="text-emerald-600 dark:text-emerald-400 font-semibold">New</span>, '', ''];
    const s = r.server;
    return [
      s.ticket_number
        ? <button key="t" type="button" onClick={() => s.ticket_id && onOpenTicket?.(s.ticket_id)} className="font-mono font-bold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer">{s.ticket_number}</button>
        : '—',
      fmtDateTime(s.updated_at),
      s.updated_by_name || '—',
    ];
  };

  const wrapperCls = fullscreen
    ? 'fixed inset-0 z-[75] bg-slate-100 dark:bg-zinc-950 p-4 overflow-auto flex flex-col gap-3'
    : 'space-y-3';

  return (
    <div className={wrapperCls} onClick={(e) => e.stopPropagation()}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mr-auto">
          {title} <span className="normal-case font-normal text-slate-500">({totalActive} row{totalActive === 1 ? '' : 's'})</span>
          {fullscreen && clientName && <span className="normal-case font-normal text-slate-500"> — {clientName}</span>}
        </h4>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…"
            className="pl-7 pr-2 py-1 w-44 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500" />
        </div>
        <ToolBtn icon={Filter} active={showFilters} onClick={() => setShowFilters(v => !v)} title="Filter by column">Filters</ToolBtn>
        <ToolBtn icon={showRemoved ? EyeOff : Eye} active={showRemoved} onClick={() => {
          if (hasLocalWork && !window.confirm('Switching this reloads the sheet and discards unsaved changes. Continue?')) return;
          resetLocal();
          setShowRemoved(v => !v);
        }} title="Rows that were removed, and old versions of edited rows (struck through in red)">{showRemoved ? 'Hide struck-out rows' : 'Show struck-out rows'}</ToolBtn>
        <ToolBtn icon={History} active={history === 'all'} onClick={() => setHistory(h => (h === 'all' ? null : 'all'))} title="All changes to this sheet">History</ToolBtn>
        {isSuperAdmin && !headerEdit && (
          <ToolBtn icon={Type} onClick={() => setHeaderEdit(Object.fromEntries([...metaCols, ...columns].map(c => [c.key, c.label])))}
            title="Rename the column titles (Super Admin; applies to every client)">Rename columns</ToolBtn>
        )}
        <ToolBtn icon={Download} onClick={exportExcel} title="Download as Excel (saved rows, current filters)">Excel</ToolBtn>
        <ToolBtn icon={fullscreen ? Minimize2 : Maximize2} onClick={() => setFullscreen(v => !v)} title={fullscreen ? 'Exit full screen' : 'Full screen'} />
        {canEdit && !editing && (
          <button type="button" onClick={startEditing}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer">
            <Pencil className="w-3.5 h-3.5" /> Edit sheet
          </button>
        )}
        {editing && (
          <>
            <button type="button" onClick={() => addRow(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer">
              <Plus className="w-3.5 h-3.5" /> Add row
            </button>
            <ToolBtn icon={X} onClick={stopEditing} title="Stop editing">Done</ToolBtn>
          </>
        )}
      </div>

      {headerEdit && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-300 dark:border-indigo-800 bg-indigo-50/80 dark:bg-indigo-950/30 px-3 py-2 text-xs">
          <span className="text-slate-700 dark:text-zinc-300">Type the new titles in the header row. They apply to this sheet for every client. Clear a title (or type the original) to go back to the built-in one.</span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => setHeaderEdit(null)} className="px-3 py-1 rounded-lg text-slate-700 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-800 cursor-pointer">Cancel</button>
            <button type="button" onClick={saveHeader} disabled={headerSaving}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-lg font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white cursor-pointer">
              {headerSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save titles
            </button>
          </div>
        </div>
      )}
      {flash && (
        <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4" /> {flash}
          <button type="button" onClick={() => setFlash('')} className="ml-1 text-slate-400 hover:text-slate-600 cursor-pointer"><X className="w-3 h-3" /></button>
        </div>
      )}
      {editing && (
        <p className="text-[11px] text-slate-500 dark:text-zinc-400">
          Type straight into the cells. Enter / ↓ moves down (Enter on the last row adds one), ← → move across. Paste a block copied from Excel into a cell to fill several cells at once.
        </p>
      )}
      {!editing && saveError && <p className="text-xs text-rose-600 dark:text-rose-400">{saveError}</p>}
      {secretCol && !secretsReady && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          Passwords can't be saved or shown: PLAN_SECRET_KEY is not set on the server.
        </p>
      )}
      {serviceCol && editing && services.filter(x => x.status !== 'closed').length === 0 && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          This client has no services yet. Every row must belong to a service — add one on the Services tab first.
        </p>
      )}
      {truncated && <p className="text-[11px] text-amber-600">Showing the first 5,000 rows.</p>}
      {loadError && <p className="text-xs text-rose-600 dark:text-rose-400">{loadError}</p>}

      {/* Sheet */}
      <div className={`overflow-auto rounded-lg border border-slate-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 ${fullscreen ? 'flex-1' : 'max-h-[28rem]'}`}>
        <table className="text-xs border-collapse w-max min-w-full">
          <thead className="sticky top-0 z-10 bg-slate-200 dark:bg-zinc-800">
            <tr>
              <th className="px-2 py-1.5 border-b border-r border-slate-300 dark:border-zinc-700 text-slate-500 w-10">#</th>
              {[...metaCols, ...columns].map(c => (
                <th key={c.key} style={{ minWidth: c.width || 160 }}
                  className="px-2 py-1.5 border-b border-r border-slate-300 dark:border-zinc-700 text-left font-semibold text-slate-700 dark:text-zinc-200 whitespace-nowrap">
                  {headerEdit ? (
                    <input value={headerEdit[c.key] ?? c.label} maxLength={60}
                      onChange={(e) => setHeaderEdit(h => ({ ...h, [c.key]: e.target.value }))}
                      className="w-full px-1.5 py-0.5 rounded border border-indigo-400 bg-white dark:bg-zinc-900 text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-indigo-500" />
                  ) : c.label}
                </th>
              ))}
              <th className="px-2 py-1.5 border-b border-slate-300 dark:border-zinc-700 w-16" />
            </tr>
            {showFilters && (
              <tr>
                <th className="border-b border-r border-slate-300 dark:border-zinc-700" />
                {[...metaCols, ...columns].map(c => (
                  <th key={c.key} className="p-1 border-b border-r border-slate-300 dark:border-zinc-700">
                    {c.key === '_when' || c.secret ? null : (
                      <input value={colFilters[c.key] || ''} onChange={(e) => setColFilters(f => ({ ...f, [c.key]: e.target.value }))}
                        placeholder="contains…"
                        className="w-full px-1.5 py-0.5 text-[11px] font-normal rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden" />
                    )}
                  </th>
                ))}
                <th className="border-b border-slate-300 dark:border-zinc-700">
                  {filtersOn && (
                    <button type="button" onClick={() => { setColFilters({}); setSearch(''); }} title="Clear filters"
                      className="text-[10px] text-indigo-600 hover:underline cursor-pointer">Clear</button>
                  )}
                </th>
              </tr>
            )}
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={columns.length + 5} className="px-3 py-4 text-slate-500"><Loader2 className="w-4 h-4 animate-spin inline mr-1.5" />Loading…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={columns.length + 5} className="px-3 py-4 text-slate-500 italic">
                {filtersOn ? 'No rows match the filters.' : `No rows yet.${canEdit ? ' Click “Edit sheet”, then “Add row”.' : ''}`}
              </td></tr>
            )}
            {!loading && filtered.map((r, i) => {
              const editIdx = editIndex.has(r.key) ? editIndex.get(r.key) : -1;
              const cellEditable = editing && editIdx >= 0;
              const meta = metaCell(r);
              const conflict = r.id && conflicts[r.id];
              // Removed rows and old versions of edited rows stay, struck
              // through in red; the edited version is the row below.
              const struck = 'line-through decoration-rose-600 decoration-2 text-rose-700/80 dark:text-rose-400/80 bg-rose-50/60 dark:bg-rose-950/20';
              const rowCls = r.pendingRemove
                ? struck
                : r.removed
                  ? (r.pendingRestore ? 'bg-amber-50 dark:bg-amber-950/20' : struck)
                  : r.isNew ? 'bg-emerald-50/60 dark:bg-emerald-950/20'
                    : r.edited ? 'bg-indigo-50/60 dark:bg-indigo-950/20' : '';
              return (
                <tr key={r.key} className={`${rowCls} ${conflict ? 'outline-2 outline-rose-500 -outline-offset-2' : ''} hover:bg-slate-50 dark:hover:bg-zinc-800/40`}>
                  <td className="px-2 py-1 border-b border-r border-slate-200 dark:border-zinc-800 text-slate-400 text-right whitespace-nowrap no-underline">
                    {r.removed && !r.pendingRestore && (
                      <span className="mr-1 inline-block no-underline text-[9px] font-bold uppercase text-rose-600" style={{ textDecoration: 'none' }}
                        title={r.server?.superseded ? 'Old version — the edited row is right below' : 'Removed'}>
                        {r.server?.superseded ? 'old ↓' : 'removed'}
                      </span>
                    )}
                    {i + 1}
                  </td>
                  {meta.map((m, j) => (
                    <td key={j} className="px-2 py-1 border-b border-r border-slate-200 dark:border-zinc-800 whitespace-nowrap text-slate-600 dark:text-zinc-400">{m}</td>
                  ))}
                  {columns.map((c, ci) => {
                    if (c.secret) {
                      return (
                        <td key={c.key} className="p-0 border-b border-r border-slate-200 dark:border-zinc-800 align-top">
                          <SecretCell
                            row={r} editable={cellEditable} canSet={canSetSecrets} canView={canViewSecrets}
                            secretsReady={secretsReady} draft={secretDrafts[r.key]} revealedValue={r.id ? revealed[r.id] : undefined}
                            revealing={!!(r.id && revealing[r.id])}
                            onReveal={() => reveal(r.id)} onHide={() => setRevealed(m => { const c2 = { ...m }; delete c2[r.id]; return c2; })}
                            onChange={(v) => setSecret(r, v)} onClear={() => clearSecret(r)} onUndo={() => undoSecret(r)}
                            inputRef={el => { cellRefs.current[`${r.key}:${ci}`] = el; }}
                            onKeyDown={(e) => onCellKeyDown(e, editIdx, ci)}
                            onPaste={(e) => onCellPaste(e, editIdx, ci)}
                          />
                        </td>
                      );
                    }
                    if (c.type === 'service') {
                      const sv = r.data[c.key] || '';
                      const warnS = warnings[`${r.key}:${c.key}`];
                      const editedS = r.edited && (byId[r.id]?.data?.[c.key] || '') !== sv;
                      const options = services.filter(x => x.status !== 'closed' || String(x.id) === sv);
                      return (
                        <td key={c.key} title={warnS || undefined}
                          className={`p-0 border-b border-r border-slate-200 dark:border-zinc-800 align-top ${warnS ? 'bg-amber-50 dark:bg-amber-950/30' : ''} ${editedS ? 'font-semibold' : ''}`}>
                          {cellEditable ? (
                            <select
                              ref={el => { cellRefs.current[`${r.key}:${ci}`] = el; }}
                              value={sv}
                              onChange={(e) => setCell(r, c.key, e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusCell(editIdx + 1, ci); } }}
                              className="block w-full px-1.5 py-1 bg-transparent text-slate-900 dark:text-zinc-100 text-xs focus:outline-hidden focus:ring-2 focus:ring-inset focus:ring-indigo-500 cursor-pointer"
                            >
                              <option value="">{services.length ? 'Choose service…' : 'No services — add one first'}</option>
                              {options.map(x => <option key={x.id} value={String(x.id)}>{serviceLabel(x.id)}</option>)}
                            </select>
                          ) : (
                            <div className="px-2 py-1 whitespace-nowrap">
                              {warnS && <AlertTriangle className="w-3 h-3 text-amber-500 inline mr-1 -mt-0.5" />}
                              {sv ? <span className="text-indigo-700 dark:text-indigo-300 font-medium">{serviceLabel(sv)}</span> : <span className="text-slate-300 dark:text-zinc-700">—</span>}
                            </div>
                          )}
                        </td>
                      );
                    }
                    const val = r.data[c.key] || '';
                    const warn = warnings[`${r.key}:${c.key}`];
                    const edited = r.edited && (byId[r.id]?.data?.[c.key] || '') !== val;
                    return (
                      <td key={c.key} title={warn || undefined}
                        className={`p-0 border-b border-r border-slate-200 dark:border-zinc-800 align-top ${warn ? 'bg-amber-50 dark:bg-amber-950/30' : ''} ${edited ? 'font-semibold' : ''}`}>
                        {cellEditable ? (
                          c.multiline ? (
                            <textarea
                              ref={el => { cellRefs.current[`${r.key}:${ci}`] = el; }}
                              value={val} rows={1} placeholder={c.placeholder}
                              onChange={(e) => setCell(r, c.key, e.target.value)}
                              onKeyDown={(e) => onCellKeyDown(e, editIdx, ci)}
                              onPaste={(e) => onCellPaste(e, editIdx, ci)}
                              className={`block w-full min-h-[28px] px-2 py-1 bg-transparent text-slate-900 dark:text-zinc-100 resize-y focus:outline-hidden focus:ring-2 focus:ring-inset focus:ring-indigo-500 ${c.mono ? 'font-mono' : ''}`}
                            />
                          ) : (
                            <input
                              ref={el => { cellRefs.current[`${r.key}:${ci}`] = el; }}
                              value={val} placeholder={c.placeholder}
                              onChange={(e) => setCell(r, c.key, e.target.value)}
                              onKeyDown={(e) => onCellKeyDown(e, editIdx, ci)}
                              onPaste={(e) => onCellPaste(e, editIdx, ci)}
                              className={`block w-full px-2 py-1 bg-transparent text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-inset focus:ring-indigo-500 ${c.mono ? 'font-mono' : ''}`}
                            />
                          )
                        ) : (
                          <div className={`px-2 py-1 whitespace-pre-wrap break-words ${c.mono ? 'font-mono' : ''}`}>
                            {warn && <AlertTriangle className="w-3 h-3 text-amber-500 inline mr-1 -mt-0.5" />}
                            {val || <span className="text-slate-300 dark:text-zinc-700">—</span>}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-1 py-1 border-b border-slate-200 dark:border-zinc-800 whitespace-nowrap">
                    <div className="flex items-center justify-end gap-0.5 no-underline">
                      {!r.isNew && (
                        <IconBtn icon={History} title="This row's history (all its versions)" active={history === (r.server?.lineage_id || r.id)}
                          onClick={() => { const lid = r.server?.lineage_id || r.id; setHistory(h => (h === lid ? null : lid)); }} />
                      )}
                      {editing && !r.removed && (
                        <IconBtn icon={r.pendingRemove ? Undo2 : Trash2} danger={!r.pendingRemove}
                          title={r.isNew ? 'Drop this new row' : r.pendingRemove ? 'Keep this row' : 'Remove this row (kept in history, can be restored)'}
                          onClick={() => toggleRemove(r)} />
                      )}
                      {editing && r.removed && !r.server?.superseded && (
                        <IconBtn icon={r.pendingRestore ? Undo2 : RotateCcw}
                          title={r.pendingRestore ? 'Keep it removed' : 'Restore this row'}
                          onClick={() => toggleRestore(r)} />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Save bar */}
      {editing && (pendingCount > 0 || saveError) && (
        <div className="rounded-lg border border-indigo-300 dark:border-indigo-800 bg-indigo-50/80 dark:bg-indigo-950/30 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-700 dark:text-zinc-300">
            <span className="font-semibold">Unsaved:</span>
            {pending.added.length > 0 && <span className="text-emerald-700 dark:text-emerald-400">{pending.added.length} added</span>}
            {pending.changed.length > 0 && <span className="text-indigo-700 dark:text-indigo-400">{pending.changed.length} changed</span>}
            {pending.removed.length > 0 && <span className="text-rose-700 dark:text-rose-400">{pending.removed.length} removed</span>}
            {pending.restored.length > 0 && <span className="text-amber-700 dark:text-amber-400">{pending.restored.length} restored</span>}
            {warningCount > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5" />{warningCount} warning{warningCount === 1 ? '' : 's'} (hover the yellow cells)
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[16rem]">
              <ClientTicketPicker clientId={clientId} value={ticket} onChange={setTicket} required label="Ticket authorizing these changes" allowNewTicket={false} />
            </div>
            <button type="button" onClick={discard} disabled={saving}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-slate-700 dark:text-zinc-300 hover:bg-slate-300/60 dark:hover:bg-zinc-800 cursor-pointer">
              <Undo2 className="w-4 h-4" /> Discard
            </button>
            <button type="button" onClick={save} disabled={saving || pendingCount === 0 || !ticket}
              title={!ticket ? 'Choose a ticket first' : undefined}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white cursor-pointer">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save {pendingCount > 0 ? `${pendingCount} change${pendingCount === 1 ? '' : 's'}` : ''}
            </button>
          </div>
          {saveError && (
            <p className="text-xs text-rose-600 dark:text-rose-400 flex flex-wrap items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5" /> {saveError}
              {Object.keys(conflicts).length > 0 && (
                <button type="button" onClick={reloadAfterConflict} className="font-semibold underline cursor-pointer">Reload sheet</button>
              )}
            </p>
          )}
        </div>
      )}

      {/* History */}
      {history != null && (
        <div className="rounded-lg border border-slate-300 dark:border-zinc-800 p-3 bg-slate-50 dark:bg-zinc-900/40">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-700 dark:text-zinc-300 flex items-center gap-1.5">
              <History className="w-4 h-4 text-indigo-500" />
              {history === 'all' ? `All changes to the ${title}` : 'Row history (every version)'}
            </span>
            <button type="button" onClick={() => setHistory(null)} className="p-0.5 text-slate-400 hover:text-slate-600 cursor-pointer"><X className="w-4 h-4" /></button>
          </div>
          <ClientChangeHistory clientId={clientId} recordType={recordType}
            recordId={history === 'all' ? null : history} fieldLabels={labels} refreshKey={historyKey} pageSize={30} />
        </div>
      )}
    </div>
  );
};

// The password cell. Read: •••••• plus an eye button (if allowed). Edit:
// a password box; empty means "unchanged", with a clear button to remove it.
const SecretCell = ({ row, editable, canSet, canView, secretsReady, draft, revealedValue, revealing, onReveal, onHide, onChange, onClear, onUndo, inputRef, onKeyDown, onPaste }) => {
  const [show, setShow] = useState(false);
  const has = !!row.server?.has_secret;
  const copy = () => { if (revealedValue) navigator.clipboard?.writeText(revealedValue).catch(() => {}); };

  if (editable && canSet) {
    if (draft?.clear) {
      return (
        <div className="px-2 py-1 flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
          <span className="italic">will be cleared</span>
          <button type="button" onClick={onUndo} title="Keep the password" className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-zinc-800 cursor-pointer"><Undo2 className="w-3.5 h-3.5" /></button>
        </div>
      );
    }
    return (
      <div className="flex items-center">
        <input
          ref={inputRef}
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          value={draft?.value || ''}
          placeholder={has ? '•••••• (unchanged)' : 'password'}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className="block w-full min-w-0 px-2 py-1 bg-transparent font-mono text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-inset focus:ring-indigo-500"
        />
        <button type="button" onClick={() => setShow(v => !v)} title={show ? 'Hide what you typed' : 'Show what you typed'}
          className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer">{show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}</button>
        {has && !draft && (
          <button type="button" onClick={onClear} title="Remove the saved password" className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"><X className="w-3.5 h-3.5" /></button>
        )}
      </div>
    );
  }

  if (!has) return <div className="px-2 py-1 text-slate-300 dark:text-zinc-700">—</div>;
  if (revealedValue !== undefined) {
    return (
      <div className="px-2 py-1 flex items-center gap-1.5">
        <span className="font-mono text-slate-900 dark:text-zinc-100 break-all select-all">{revealedValue}</span>
        <button type="button" onClick={copy} title="Copy" className="text-[10px] font-semibold text-indigo-600 hover:underline cursor-pointer">Copy</button>
        <button type="button" onClick={onHide} title="Hide" className="p-0.5 text-slate-400 hover:text-slate-700 cursor-pointer"><EyeOff className="w-3.5 h-3.5" /></button>
      </div>
    );
  }
  return (
    <div className="px-2 py-1 flex items-center gap-1.5">
      <span className="font-mono tracking-widest text-slate-500">••••••</span>
      {canView && secretsReady && !row.removed && (
        <button type="button" onClick={onReveal} disabled={revealing} title="Show password (logged)"
          className="p-0.5 text-slate-400 hover:text-indigo-600 cursor-pointer disabled:opacity-50">
          {revealing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  );
};

const ToolBtn = ({ icon: Icon, children, onClick, title, active }) => (
  <button type="button" onClick={onClick} title={title}
    className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border cursor-pointer ${active
      ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300'
      : 'border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-800'}`}>
    <Icon className="w-3.5 h-3.5" />{children}
  </button>
);

const IconBtn = ({ icon: Icon, onClick, title, danger, active }) => (
  <button type="button" onClick={onClick} title={title}
    className={`p-1 rounded cursor-pointer ${active
      ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400'
      : danger ? 'text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40'
        : 'text-slate-400 hover:text-slate-700 hover:bg-slate-200 dark:hover:bg-zinc-800'}`}>
    <Icon className="w-3.5 h-3.5" />
  </button>
);

export default PlanSheet;
