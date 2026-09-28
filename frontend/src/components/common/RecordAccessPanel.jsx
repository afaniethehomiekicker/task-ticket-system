import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { UserCheck } from 'lucide-react';

// Record-level access grants (spec slide 16) for one record: who has been
// explicitly given access, grant, remove. `kind` is the API path segment
// ('clients' | 'tasks'). Render it only for people allowed to manage grants
// on that record — the backend checks again.
export const RecordAccessPanel = ({ kind, recordId, recordLabel, excludeUserIds = [] }) => {
  const { allUsers, fetchRecordAccess, grantRecordAccess, revokeRecordAccess } = useApp();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState('');

  const reload = async () => {
    setLoading(true);
    setError('');
    try {
      setList(await fetchRecordAccess(kind, recordId));
    } catch (err) {
      setError(err.message || 'Failed to load access list');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, recordId]);

  const candidates = (allUsers || []).filter(u =>
    u.status === 'active' &&
    !excludeUserIds.some(id => String(id) === String(u.id)) &&
    !list.some(g => String(g.userId) === String(u.id)));

  const handleGrant = async (e) => {
    e.preventDefault();
    if (!userId) return;
    if (await grantRecordAccess(kind, recordId, userId)) {
      setUserId('');
      reload();
    }
  };

  const handleRevoke = async (g) => {
    if (!window.confirm(`Remove ${g.userName || 'this person'}'s access to ${recordLabel}?`)) return;
    if (await revokeRecordAccess(kind, recordId, g.userId)) reload();
  };

  return (
    <div className="space-y-2">
      <h4 className="text-[11px] font-bold text-slate-700 dark:text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
        <UserCheck className="w-3.5 h-3.5 text-emerald-500" />
        Access ({list.length})
      </h4>
      {error && <p className="text-[11px] text-rose-600 dark:text-rose-400">{error}</p>}
      {!loading && !error && list.length === 0 && (
        <p className="text-[11px] text-slate-500 dark:text-zinc-500 italic">Not shared with anyone.</p>
      )}
      {list.map(g => (
        <div key={g.id} className="flex items-center justify-between p-2 rounded-lg bg-white/70 dark:bg-zinc-900/60 border border-slate-300 dark:border-zinc-800 text-xs">
          <div className="min-w-0">
            <span className="font-semibold text-slate-900 dark:text-zinc-100">{g.userName}</span>
            {g.userDepartment && <span className="text-slate-500 dark:text-zinc-400"> · {g.userDepartment}</span>}
            <span className="block text-[10px] text-slate-500 dark:text-zinc-500">
              Granted by {g.grantedByName || 'unknown'}{g.createdAt ? ` · ${new Date(g.createdAt).toLocaleDateString()}` : ''}
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleRevoke(g)}
            className="px-2 py-1 rounded text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/40 cursor-pointer"
          >
            Remove
          </button>
        </div>
      ))}
      <form onSubmit={handleGrant} className="flex gap-2">
        <select
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="flex-1 min-w-0 px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
        >
          <option value="">Give access to…</option>
          {candidates.map(u => (
            <option key={u.id} value={u.id}>{u.name}{u.department ? ` · ${u.department}` : ''}</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={!userId}
          className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-lg cursor-pointer whitespace-nowrap"
        >
          Grant
        </button>
      </form>
    </div>
  );
};
