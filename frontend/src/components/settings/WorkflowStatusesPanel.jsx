import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { ListChecks, Plus, Lock } from 'lucide-react';

// Settings → Workflow Statuses (Super Admin). Spec slide 21: "Configurable
// statuses, always with a recorded reason." Rename, enable/disable, require a
// reason, reorder, or add statuses for tickets and tasks — every dropdown,
// filter, badge and Kanban column follows this list.

const CATEGORIES = [
  ['open', 'Open — not started'],
  ['active', 'Active — being worked on'],
  ['waiting', 'Waiting — paused on someone else'],
  ['done', 'Done — finished'],
  ['cancelled', 'Cancelled'],
];
const CATEGORY_LABEL = { ...Object.fromEntries(CATEGORIES), review: 'Review — awaiting approval' };

export const WorkflowStatusesPanel = () => {
  const { getStatuses, createWorkflowStatus, updateWorkflowStatus } = useApp();
  const [entity, setEntity] = useState('ticket');
  const [labels, setLabels] = useState({});
  const [newLabel, setNewLabel] = useState('');
  const [newCategory, setNewCategory] = useState('waiting');
  const [newReason, setNewReason] = useState(false);
  const [busy, setBusy] = useState(false);

  const rows = getStatuses(entity, { includeDisabled: true });

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const saveLabel = (st) => {
    const value = (labels[st.id] ?? st.label).trim();
    if (!value || value === st.label) return;
    run(async () => {
      if (await updateWorkflowStatus(st.id, { label: value })) {
        setLabels(prev => { const n = { ...prev }; delete n[st.id]; return n; });
      }
    });
  };

  const move = (index, dir) => {
    const other = rows[index + dir];
    const st = rows[index];
    if (!other) return;
    run(async () => {
      // Swap sort orders (spread apart if they were equal).
      const a = st.sortOrder, b = other.sortOrder === st.sortOrder ? st.sortOrder + dir : other.sortOrder;
      await updateWorkflowStatus(st.id, { sortOrder: b });
      await updateWorkflowStatus(other.id, { sortOrder: a });
    });
  };

  const handleAdd = (e) => {
    e.preventDefault();
    if (!newLabel.trim()) return;
    run(async () => {
      if (await createWorkflowStatus({ entity, label: newLabel.trim(), category: newCategory, reasonRequired: newReason })) {
        setNewLabel('');
        setNewReason(false);
      }
    });
  };

  return (
    <div className="bg-slate-200/60 dark:bg-zinc-900 rounded-xl border border-slate-300 dark:border-zinc-800 p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-indigo-500" />
            Workflow Statuses
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
            Every status change records previous → new, who and when. Tick “Reason” to require a reason for moving into that status.
          </p>
        </div>
        <div className="flex gap-1 text-xs">
          {['ticket', 'task'].map(e => (
            <button
              key={e}
              type="button"
              onClick={() => setEntity(e)}
              className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${entity === e
                ? 'bg-indigo-600 text-white'
                : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-300/70 dark:hover:bg-zinc-800'}`}
            >
              {e === 'ticket' ? 'Tickets' : 'Tasks'}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-slate-600 dark:text-zinc-400 uppercase tracking-wider font-semibold border-b border-slate-300 dark:border-zinc-800">
            <tr>
              <th className="p-2">Order</th>
              <th className="p-2">Label</th>
              <th className="p-2">Key</th>
              <th className="p-2">Category</th>
              <th className="p-2 text-center">Reason</th>
              <th className="p-2 text-center">Enabled</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-300/50 dark:divide-zinc-800/60 text-slate-800 dark:text-zinc-300">
            {rows.map((st, idx) => (
              <tr key={st.id} className={st.enabled ? '' : 'opacity-50'}>
                <td className="p-2 whitespace-nowrap">
                  <button type="button" disabled={busy || idx === 0} onClick={() => move(idx, -1)}
                    className="px-1.5 rounded hover:bg-slate-300/70 dark:hover:bg-zinc-800 disabled:opacity-30 cursor-pointer">↑</button>
                  <button type="button" disabled={busy || idx === rows.length - 1} onClick={() => move(idx, 1)}
                    className="px-1.5 rounded hover:bg-slate-300/70 dark:hover:bg-zinc-800 disabled:opacity-30 cursor-pointer">↓</button>
                </td>
                <td className="p-2">
                  <input
                    type="text"
                    value={labels[st.id] ?? st.label}
                    onChange={(e) => setLabels({ ...labels, [st.id]: e.target.value })}
                    onBlur={() => saveLabel(st)}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    className="w-44 px-2 py-1 rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                  />
                </td>
                <td className="p-2 font-mono text-[10px] text-slate-500 dark:text-zinc-500 whitespace-nowrap">
                  {st.key}
                  {st.system && <Lock className="inline w-3 h-3 ml-1 -mt-0.5" title="Built-in: can't be disabled or re-categorised" />}
                </td>
                <td className="p-2">
                  {st.system ? (
                    <span className="text-slate-500 dark:text-zinc-400">{CATEGORY_LABEL[st.category] || st.category}</span>
                  ) : (
                    <select
                      value={st.category}
                      disabled={busy}
                      onChange={(e) => run(() => updateWorkflowStatus(st.id, { category: e.target.value }))}
                      className="px-2 py-1 rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                    >
                      {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  )}
                </td>
                <td className="p-2 text-center">
                  <input
                    type="checkbox"
                    checked={st.reasonRequired}
                    disabled={busy}
                    onChange={(e) => run(() => updateWorkflowStatus(st.id, { reasonRequired: e.target.checked }))}
                    className="accent-indigo-600"
                  />
                </td>
                <td className="p-2 text-center">
                  <input
                    type="checkbox"
                    checked={st.enabled}
                    disabled={busy || st.system}
                    title={st.system ? 'Built-in status — the workflow relies on it' : undefined}
                    onChange={(e) => run(() => updateWorkflowStatus(st.id, { enabled: e.target.checked }))}
                    className="accent-indigo-600"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={handleAdd} className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-300 dark:border-zinc-800 text-xs">
        <input
          type="text"
          placeholder={`New ${entity} status (e.g. "Waiting for PTA")`}
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          className="flex-1 min-w-[200px] px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
        />
        <select
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          className="px-2 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
        >
          {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label className="flex items-center gap-1 text-slate-700 dark:text-zinc-300 cursor-pointer">
          <input type="checkbox" checked={newReason} onChange={(e) => setNewReason(e.target.checked)} className="accent-indigo-600" />
          Reason required
        </label>
        <button
          type="submit"
          disabled={busy || !newLabel.trim()}
          className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg font-semibold cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" /> Add status
        </button>
      </form>
    </div>
  );
};
