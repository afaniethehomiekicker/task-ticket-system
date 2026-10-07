import React, { useEffect, useState } from 'react';
import { useAppSelector } from '../../context/AppContext';
import { Timer } from 'lucide-react';

// Settings → SLA (Super Admin). Spec slide 22: "Example SLA (fully
// configurable)" — Critical 30 min, High 1 h, Normal 4 h — and "SLA breach
// triggers an automatic escalation chain": Department Head at the deadline,
// Department Admin one step later, Super Admin one step after that.

const ORDER = ['critical', 'high', 'normal', 'low'];

export const SLAPoliciesPanel = () => {
  const { fetchSLAPolicies, updateSLAPolicy } = useAppSelector(s => ({ fetchSLAPolicies: s.fetchSLAPolicies, updateSLAPolicy: s.updateSLAPolicy }));
  const [rows, setRows] = useState([]);
  const [edits, setEdits] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const list = await fetchSLAPolicies();
      list.sort((a, b) => ORDER.indexOf(a.priority) - ORDER.indexOf(b.priority));
      setRows(list);
      setEdits({});
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const val = (row, field) => edits[row.id]?.[field] ?? row[field];
  const setVal = (row, field, v) => setEdits(prev => ({ ...prev, [row.id]: { ...prev[row.id], [field]: v } }));
  const dirty = (row) => !!edits[row.id] &&
    (Number(val(row, 'resolutionMinutes')) !== row.resolutionMinutes ||
     Number(val(row, 'escalationStepMinutes')) !== row.escalationStepMinutes);

  const save = async (row) => {
    setBusy(true);
    const ok = await updateSLAPolicy(row.id, {
      resolutionMinutes: val(row, 'resolutionMinutes'),
      escalationStepMinutes: val(row, 'escalationStepMinutes'),
    });
    setBusy(false);
    if (ok) load();
  };

  const human = (m) => {
    const n = Number(m) || 0;
    if (n >= 1440 && n % 1440 === 0) return `${n / 1440} day${n === 1440 ? '' : 's'}`;
    if (n >= 60 && n % 60 === 0) return `${n / 60} h`;
    return `${n} min`;
  };

  return (
    <div className="bg-slate-200/60 dark:bg-zinc-900 rounded-xl border border-slate-300 dark:border-zinc-800 p-5 space-y-4">
      <div>
        <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
          <Timer className="w-4 h-4 text-indigo-500" />
          SLA &amp; Escalation
        </h3>
        <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
          New tickets get a deadline from their priority. When it passes and the ticket isn't finished, it's escalated
          automatically: Department Head at the deadline, Department Admin one step later, Super Admin one step after that.
        </p>
      </div>
      {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-slate-600 dark:text-zinc-400 uppercase tracking-wider font-semibold border-b border-slate-300 dark:border-zinc-800">
            <tr>
              <th className="p-2">Priority</th>
              <th className="p-2">Resolve within (minutes)</th>
              <th className="p-2">Escalation step (minutes)</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-300/50 dark:divide-zinc-800/60 text-slate-800 dark:text-zinc-300">
            {rows.map(row => (
              <tr key={row.id}>
                <td className="p-2 font-semibold capitalize">{row.priority}</td>
                <td className="p-2">
                  <input type="number" min="1" value={val(row, 'resolutionMinutes')}
                    onChange={(e) => setVal(row, 'resolutionMinutes', e.target.value)}
                    className="w-24 px-2 py-1 rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden" />
                  <span className="ml-2 text-[10px] text-slate-500 dark:text-zinc-500">{human(val(row, 'resolutionMinutes'))}</span>
                </td>
                <td className="p-2">
                  <input type="number" min="1" value={val(row, 'escalationStepMinutes')}
                    onChange={(e) => setVal(row, 'escalationStepMinutes', e.target.value)}
                    className="w-24 px-2 py-1 rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden" />
                  <span className="ml-2 text-[10px] text-slate-500 dark:text-zinc-500">{human(val(row, 'escalationStepMinutes'))}</span>
                </td>
                <td className="p-2 text-right">
                  <button type="button" disabled={busy || !dirty(row)} onClick={() => save(row)}
                    className="px-3 py-1 rounded-lg font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white cursor-pointer">
                    Save
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-slate-500 dark:text-zinc-500">
        Changes apply to new tickets and to priority changes; existing deadlines aren't moved.
      </p>
    </div>
  );
};
