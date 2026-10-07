import React, { useEffect, useState } from 'react';
import { useAppSelector } from '../../context/AppContext';
import { History, RefreshCw } from 'lucide-react';

// Per-record timeline (spec slide 20, the accountability chain): created ->
// assigned -> sub-task to Staff B -> transferred to L2 -> returned -> closed.
// Reads GET /api/{tickets|tasks}/:id/timeline, which returns this record's
// audit entries (for a task, its sub-tasks too) to anyone who can see it.
// `refreshKey` — pass something that changes when the record changes (e.g.
// its updatedAt) so the timeline reloads after edits.

const ACTION_LABELS = {
  created: 'Created',
  updated: 'Edited',
  status_changed: 'Status changed',
  assigned: 'Assigned',
  transferred: 'Transferred',
  routed: 'Routed to department',
  returned: 'Returned',
  escalated: 'Escalated',
  commented: 'Replied',
  internal_note_added: 'Internal note',
  archived: 'Archived',
  restored: 'Restored',
  access_granted: 'Access granted',
  access_revoked: 'Access removed',
  work_log_added: 'Work logged',
  submitted_for_review: 'Submitted for review',
  approved: 'Approved',
  reopened: 'Reopened',
};

const FIELD_LABELS = {
  title: 'Title', description: 'Description', priority: 'Priority', start_date: 'Start date',
  due_date: 'Due date', estimated_hours: 'Estimated hours', actual_hours: 'Actual hours',
  labels: 'Labels', story_points: 'Story points', category: 'Category', department: 'Department',
  severity: 'Severity', project_id: 'Project', resolution_summary: 'Resolution',
};

const parseJSON = (v) => {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v) || {}; } catch { return {}; }
};

const show = (v) => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleDateString();
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
};

export const TimelinePanel = ({ kind, recordId, refreshKey }) => {
  const { apiFetch, getBackendId, getStatusLabel } = useAppSelector(s => ({ apiFetch: s.apiFetch, getBackendId: s.getBackendId, getStatusLabel: s.getStatusLabel }));
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const entity = kind === 'tickets' ? 'ticket' : 'task';

  useEffect(() => {
    let cancelled = false;
    const id = getBackendId ? getBackendId(recordId) : recordId;
    if (!id) return undefined;
    setLoading(true);
    setError('');
    apiFetch(`/api/${kind}/${id}/timeline`)
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to load timeline');
        if (!cancelled) setEntries(data.timeline || []);
      })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, recordId, refreshKey, reload]);

  const describe = (e) => {
    const oldV = parseJSON(e.old_values);
    const newV = parseJSON(e.new_values);
    const lines = [];
    const statusEntity = e.resource_type === 'subtask' ? null : entity;
    if (newV.status !== undefined && oldV.status !== undefined) {
      const lbl = (k) => (statusEntity ? getStatusLabel(statusEntity, k) : String(k || '').replace(/_/g, ' '));
      lines.push(`${lbl(oldV.status)} → ${lbl(newV.status)}`);
    }
    if (newV.department !== undefined && oldV.department !== undefined && newV.department !== oldV.department) {
      lines.push(`Department: ${oldV.department || '—'} → ${newV.department || '—'}`);
    }
    if (newV.assignee !== undefined || oldV.assignee !== undefined) {
      lines.push(`${oldV.assignee || 'unassigned'} → ${newV.assignee || 'unassigned'}`);
    }
    if (e.action === 'updated') {
      Object.keys(newV).filter(k => FIELD_LABELS[k]).forEach(k => {
        lines.push(`${FIELD_LABELS[k]}: ${show(oldV[k])} → ${show(newV[k])}`);
      });
    }
    if (newV.reason) lines.push(`Reason: ${newV.reason}`);
    return lines;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
          <History className="w-4 h-4 text-indigo-500" />
          Timeline ({entries.length})
        </h3>
        <button
          type="button"
          onClick={() => setReload(r => r + 1)}
          disabled={loading}
          className="p-1 rounded text-slate-500 dark:text-zinc-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {error && <p className="text-[11px] text-rose-600 dark:text-rose-400">{error}</p>}
      {!loading && !error && entries.length === 0 && (
        <p className="text-[11px] text-slate-500 dark:text-zinc-500 italic">No history yet.</p>
      )}
      <ol className="relative border-l border-slate-300 dark:border-zinc-800 ml-1.5 space-y-3">
        {entries.map(e => {
          const when = e.created_at || e.CreatedAt;
          const lines = describe(e);
          return (
            <li key={e.id || e.ID} className="ml-4">
              <span className="absolute -left-1.5 mt-1 w-3 h-3 rounded-full bg-indigo-500 border-2 border-white dark:border-zinc-950" />
              <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="font-semibold text-slate-900 dark:text-zinc-100">
                  {ACTION_LABELS[e.action] || (e.action || '').replace(/_/g, ' ')}
                </span>
                {e.resource_type === 'subtask' && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-sky-100 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 font-bold uppercase">Sub-task</span>
                )}
                <span className="text-slate-500 dark:text-zinc-400">
                  by {e.user?.name || 'system'} · {when ? new Date(when).toLocaleString() : ''}
                </span>
              </div>
              {lines.length > 0 ? (
                <div className="mt-0.5 space-y-0.5">
                  {lines.map((l, i) => (
                    <p key={i} className="text-[11px] text-slate-700 dark:text-zinc-300">{l}</p>
                  ))}
                </div>
              ) : (
                e.details && <p className="mt-0.5 text-[11px] text-slate-600 dark:text-zinc-400">{e.details}</p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
};
