import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Paperclip, Upload, Download, History, Trash2, RefreshCw } from 'lucide-react';

// Documents & evidence for one record — spec slide 27 ("tracked with who
// uploaded it, when, on which record, with version history") and slide 25
// (evidence per feasibility vendor). recordType: ticket | task | project |
// feasibility | vendor. Files are downloaded through an access-checked link,
// never a public URL.

const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.log,.csv,.xlsx,.xls,.docx,.doc,.pptx,.ppt,.vsdx,.drawio,.zip,.pcap,.pcapng,.msg,.eml,.json,.xml';

// readOnly: list and download only (a department viewer of someone else's
// task or ticket — the server refuses their uploads and removals).
export const DocumentsPanel = ({ recordType, recordId, compact = false, title = 'Documents', readOnly = false }) => {
  const { apiFetch, currentUser } = useApp();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [openHistory, setOpenHistory] = useState(null);
  const [replacing, setReplacing] = useState(null);
  const fileRef = useRef(null);

  const load = async () => {
    if (!recordId) return;
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`/api/documents?record_type=${recordType}&record_id=${recordId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load documents');
      setDocs(data.documents || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [recordType, recordId]);

  // Latest version of each document, with its older versions.
  const groups = [];
  const byGroup = {};
  docs.forEach(d => {
    const g = d.group_id || d.id;
    if (!byGroup[g]) { byGroup[g] = []; groups.push(g); }
    byGroup[g].push(d);
  });
  groups.forEach(g => byGroup[g].sort((a, b) => b.version - a.version));

  const upload = async (file, replacesId) => {
    if (!file) return;
    if (file.size > 25 * 1048576) { alert('That file is larger than 25 MB.'); return; }
    const form = new FormData();
    form.append('file', file);
    form.append('record_type', recordType);
    form.append('record_id', String(recordId));
    if (note.trim()) form.append('note', note.trim());
    if (replacesId) form.append('replaces_id', String(replacesId));
    setBusy(true);
    try {
      const res = await apiFetch('/api/documents', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { alert(data.error || 'Upload failed.'); return; }
      setNote('');
      await load();
    } catch {
      alert('Upload failed. Please check your connection and try again.');
    } finally {
      setBusy(false);
      setReplacing(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const download = async (d) => {
    try {
      const res = await apiFetch(`/api/documents/${d.id}/download`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Download failed.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = d.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      alert('Download failed.');
    }
  };

  const remove = async (d) => {
    if (!window.confirm(`Remove "${d.name}"? It disappears from this record but is kept in storage.`)) return;
    const res = await apiFetch(`/api/documents/${d.id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { alert(data.error || 'Failed to remove.'); return; }
    load();
  };

  const canRemove = (d) => !readOnly && (d.uploaded_by_id === currentUser?.id || ['admin', 'super_admin'].includes(currentUser?.role));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className={`${compact ? 'text-[11px]' : 'text-xs'} font-bold text-slate-700 dark:text-zinc-300 uppercase tracking-wider flex items-center gap-1.5`}>
          <Paperclip className="w-3.5 h-3.5 text-indigo-500" /> {title} ({groups.length})
        </h4>
        <button type="button" onClick={load} disabled={loading} title="Refresh"
          className="p-1 rounded text-slate-500 hover:bg-slate-300/60 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-50">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {error && <p className="text-[11px] text-rose-600 dark:text-rose-400">{error}</p>}
      {!loading && !error && groups.length === 0 && (
        <p className="text-[11px] text-slate-500 dark:text-zinc-500 italic">No files yet.</p>
      )}

      {groups.map(g => {
        const [latest, ...older] = byGroup[g];
        return (
          <div key={g} className="p-2 rounded-lg bg-white/70 dark:bg-zinc-900/60 border border-slate-300 dark:border-zinc-800 text-xs">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => download(latest)} className="min-w-0 flex-1 text-left cursor-pointer" title="Download">
                <span className="font-semibold text-indigo-700 dark:text-indigo-400 hover:underline break-all">{latest.name}</span>
                {latest.version > 1 && <span className="ml-1.5 text-[10px] font-bold text-slate-500">v{latest.version}</span>}
                <span className="block text-[10px] text-slate-500 dark:text-zinc-400">
                  {fmtSize(latest.size)} · {latest.uploaded_by?.name || 'someone'} · {new Date(latest.created_at).toLocaleString()}
                </span>
                {latest.note && <span className="block text-[11px] text-slate-600 dark:text-zinc-300">{latest.note}</span>}
              </button>
              <button type="button" onClick={() => download(latest)} title="Download" className="p-1 rounded text-slate-500 hover:text-indigo-600 cursor-pointer"><Download className="w-3.5 h-3.5" /></button>
              {!readOnly && (
              <button type="button" onClick={() => { setReplacing(latest.id); fileRef.current?.click(); }} disabled={busy}
                title="Upload a new version" className="p-1 rounded text-slate-500 hover:text-indigo-600 cursor-pointer disabled:opacity-50"><Upload className="w-3.5 h-3.5" /></button>
              )}
              {older.length > 0 && (
                <button type="button" onClick={() => setOpenHistory(openHistory === g ? null : g)} title="Version history"
                  className="p-1 rounded text-slate-500 hover:text-indigo-600 cursor-pointer flex items-center gap-0.5">
                  <History className="w-3.5 h-3.5" /><span className="text-[10px]">{older.length}</span>
                </button>
              )}
              {canRemove(latest) && (
                <button type="button" onClick={() => remove(latest)} title="Remove (kept in storage)"
                  className="p-1 rounded text-slate-500 hover:text-rose-600 cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
              )}
            </div>
            {openHistory === g && (
              <ul className="mt-1.5 pl-2 border-l border-slate-300 dark:border-zinc-700 space-y-1">
                {older.map(o => (
                  <li key={o.id}>
                    <button type="button" onClick={() => download(o)} className="text-[11px] text-left hover:underline cursor-pointer text-slate-700 dark:text-zinc-300">
                      v{o.version} · {o.name} · {fmtSize(o.size)} · {o.uploaded_by?.name || 'someone'} · {new Date(o.created_at).toLocaleString()}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {!readOnly && (<>
      <div className="flex flex-wrap items-center gap-2">
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional), e.g. “ping results from site B”"
          className="flex-1 min-w-[160px] px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden" />
        <button type="button" onClick={() => { setReplacing(null); fileRef.current?.click(); }} disabled={busy}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg cursor-pointer">
          <Upload className="w-3.5 h-3.5" /> {busy ? 'Uploading…' : 'Upload file'}
        </button>
        <input ref={fileRef} type="file" accept={ACCEPT} className="hidden"
          onChange={(e) => upload(e.target.files?.[0], replacing)} />
      </div>
      <p className="text-[10px] text-slate-500 dark:text-zinc-500">PDF, images, Office files, diagrams, logs, captures · max 25 MB</p>
      </>)}
    </div>
  );
};
