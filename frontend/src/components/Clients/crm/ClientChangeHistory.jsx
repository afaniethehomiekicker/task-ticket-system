import React, { useCallback, useEffect, useState } from 'react';
import { History, Loader2, ArrowRight, PlusCircle, Trash2, RotateCcw, Pencil } from 'lucide-react';
import { useAppSelector } from '../../../context/AppContext';

// Change history for a client's services and plans (client CRM, step 1):
// who changed what, old → new, when, and the ticket that authorized it.
// Clicking a ticket number opens the ticket.
//
//   <ClientChangeHistory clientId={id} />                                   everything
//   <ClientChangeHistory clientId={id} recordType="ip_plan" />              one sheet
//   <ClientChangeHistory clientId={id} recordType="ip_plan" recordId={7} /> one row
//
// `fieldLabels` maps stored field keys to column titles; `refreshKey`
// reloads the list when it changes (after a save).

const RECORD_LABEL = {
  service: 'Service',
  ip_plan: 'IP Plan',
  bgp_plan: 'BGP Plan',
  transmission_plan: 'Core Transmission',
  client_transmission_plan: 'Client Transmission',
};

const ACTION_STYLE = {
  created: { icon: PlusCircle, text: 'Added', cls: 'text-emerald-600 dark:text-emerald-400' },
  updated: { icon: Pencil, text: 'Changed', cls: 'text-indigo-600 dark:text-indigo-400' },
  removed: { icon: Trash2, text: 'Removed', cls: 'text-rose-600 dark:text-rose-400' },
  restored: { icon: RotateCcw, text: 'Restored', cls: 'text-amber-600 dark:text-amber-400' },
};

const fmt = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const prettyField = (key, labels) =>
  labels?.[key] || (key || '').replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());

export const ClientChangeHistory = ({ clientId, recordType = '', recordId = null, fieldLabels = {}, refreshKey = 0, pageSize = 50, emptyText = 'No changes recorded yet.' }) => {
  const { apiFetch, setSelectedTicketId } = useAppSelector(s => ({ apiFetch: s.apiFetch, setSelectedTicketId: s.setSelectedTicketId }));
  const [rows, setRows] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (beforeId = null) => {
    if (!clientId) return;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ limit: String(pageSize) });
    if (recordType) params.set('record_type', recordType);
    if (recordId) params.set('record_id', String(recordId));
    if (beforeId) params.set('before_id', String(beforeId));
    try {
      const res = await apiFetch(`/api/clients/${clientId}/changes?${params}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not load the history');
        return;
      }
      const list = data.changes || [];
      setRows(prev => (beforeId ? [...prev, ...list] : list));
      setHasMore(!!data.has_more);
    } catch {
      setError('Could not reach the server');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, clientId, recordType, recordId, pageSize]);

  useEffect(() => { load(null); }, [load, refreshKey]);

  if (error) return <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>;
  if (!loading && rows.length === 0) {
    return <p className="text-xs text-slate-500 dark:text-zinc-400 italic">{emptyText}</p>;
  }

  return (
    <div className="space-y-1.5">
      {rows.map(r => {
        const st = ACTION_STYLE[r.action] || ACTION_STYLE.updated;
        const Icon = st.icon;
        return (
          <div key={r.id} className="flex gap-2.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 text-xs">
            <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${st.cls}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span className={`font-semibold ${st.cls}`}>{st.text}</span>
                {!recordType && <span className="text-slate-500 dark:text-zinc-400">{RECORD_LABEL[r.record_type] || r.record_type}</span>}
                {r.field && <span className="font-semibold text-slate-800 dark:text-zinc-200">{prettyField(r.field, fieldLabels)}</span>}
              </div>
              {(r.old_value || r.new_value) && (
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-slate-700 dark:text-zinc-300 break-all">
                  {r.action === 'updated' ? (
                    <>
                      <span className="line-through decoration-rose-400/70 text-slate-500 dark:text-zinc-500">{r.old_value || '—'}</span>
                      <ArrowRight className="w-3 h-3 shrink-0 text-slate-400" />
                      <span className="font-medium">{r.new_value || '—'}</span>
                    </>
                  ) : (
                    <span>{r.new_value || r.old_value}</span>
                  )}
                </div>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-zinc-400">
                <span>{r.changed_by_name || 'Unknown user'}</span>
                <span>·</span>
                <span>{fmt(r.created_at)}</span>
                {r.ticket_number && (
                  <>
                    <span>·</span>
                    <button
                      type="button"
                      onClick={() => r.ticket_id && setSelectedTicketId(r.ticket_id)}
                      className="font-mono font-bold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                      title="Open the ticket"
                    >
                      {r.ticket_number}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-slate-500 py-1">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading history…
        </div>
      )}
      {hasMore && !loading && (
        <button
          type="button"
          onClick={() => load(rows[rows.length - 1]?.id)}
          className="flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
        >
          <History className="w-3.5 h-3.5" /> Load older changes
        </button>
      )}
    </div>
  );
};

export default ClientChangeHistory;
