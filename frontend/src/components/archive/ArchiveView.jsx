import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Archive, Search, RefreshCw, ShieldAlert, RotateCcw } from 'lucide-react';
import { canCreateProject, canManageClients, canManageUsers, canManageDepartments, canArchiveRecords } from '../../utils/permissions';

// Archive — every archived Project / Task / Ticket / Feasibility / Client.
//
// Nothing in this system is hard-deleted: "delete" sets status = archived and
// stamps archived_at / archived_by_id. Until now the app only ever loaded
// active records, so once something was archived it could no longer be seen
// anywhere in the UI. The spec requires archived work to stay visible to
// authorized management, which is what this view is for. Admins can restore any row.
//
// Access: admins and super admins (the roles that can archive). The backend
// still applies its normal visibility rules, so a department admin sees their
// department's archive only.
//
// Restore: each row can be restored to the status it had before it was
// archived (the backend saves it at archive time). Rows archived before that
// was recorded show the default they will come back as.

const TABS = [
  { id: 'projects', label: 'Projects' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'tickets', label: 'Tickets' },
  { id: 'feasibilities', label: 'Feasibilities' },
  { id: 'clients', label: 'Clients' },
  { id: 'users', label: 'Users' },
  { id: 'departments', label: 'Departments' },
];

// How each kind is shown: its permanent ID, a title, and one context column.
const describe = {
  projects: (r) => ({ ref: r.code, title: r.title, context: r.department || '—' }),
  tasks: (r) => ({ ref: r.taskNumber, title: r.title, context: r.department || '—' }),
  tickets: (r) => ({ ref: r.ticketNumber, title: r.title, context: r.department || '—' }),
  feasibilities: (r) => ({
    ref: r.feasibilityNumber,
    title: [r.product, r.capacity].filter(Boolean).join(' · ') || '—',
    context: r.client?.companyName || r.city || '—',
  }),
  clients: (r) => ({ ref: r.clientNumber, title: r.companyName, context: r.contactPerson || '—' }),
  users: (r) => ({ ref: r.userNumber, title: `${r.name} (${r.email})`, context: r.department || '—' }),
  departments: (r) => ({ ref: r.deptNumber, title: r.name, context: r.description || '—' }),
};

// What the backend falls back to when no pre-archive status was saved —
// mirrors restore.go.
const restoreFallback = {
  projects: () => 'active',
  tasks: () => 'todo',
  tickets: (r) => (r.assignedToId ? 'assigned' : 'new'),
  feasibilities: (r) => (r.convertedProjectId ? 'converted' : 'draft'),
  clients: () => 'active',
  users: () => 'active',
  departments: () => 'active',
};

const prettyStatus = (s) => (s || '').replace(/_/g, ' ');

const contextLabel = {
  projects: 'Department',
  tasks: 'Department',
  tickets: 'Department',
  feasibilities: 'Client / City',
  clients: 'Contact',
  users: 'Department',
  departments: 'Description',
};

export const ArchiveView = () => {
  const { currentUser, allUsers, fetchArchived, restoreArchived, permissionMatrix } = useApp();
  const [restoringId, setRestoringId] = useState(null);
  // Admins (for users, clients, feasibilities) and anyone with the
  // archive_records permission (projects, tasks, tickets) — same as Sidebar.
  const allowed = currentUser?.role === 'admin' || currentUser?.role === 'super_admin' ||
    canArchiveRecords(currentUser, permissionMatrix);

  const [tab, setTab] = useState('projects');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const load = async (kind) => {
    setLoading(true);
    setError('');
    try {
      setRows(await fetchArchived(kind));
    } catch (err) {
      setRows([]);
      setError(err.message || 'Failed to load archive.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (allowed) load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, allowed]);

  // Same permission the backend checks for each kind's restore route.
  const canRestore = (kind) => {
    if (kind === 'feasibilities') return canCreateProject(currentUser, permissionMatrix);
    if (kind === 'clients') return canManageClients(currentUser, permissionMatrix);
    if (kind === 'users') return canManageUsers(currentUser, permissionMatrix);
    // Departments: Super Admin only (spec slide 5; same rule as Department.go).
    if (kind === 'departments') return canManageDepartments(currentUser, permissionMatrix);
    return canArchiveRecords(currentUser, permissionMatrix); // projects / tasks / tickets
  };

  const handleRestore = async (row) => {
    const d = describe[tab](row);
    const to = row.preArchiveStatus || restoreFallback[tab](row);
    if (!window.confirm(`Restore ${d.ref || 'this record'}${d.title ? `: ${d.title}` : ''}? It returns as "${prettyStatus(to)}".`)) return;
    setRestoringId(row.id);
    const ok = await restoreArchived(tab, row.id);
    setRestoringId(null);
    if (ok) setRows(prev => prev.filter(r => String(r.id) !== String(row.id)));
  };

  const userName = (id) => {
    if (id === null || id === undefined) return '—';
    return (allUsers || []).find(u => String(u.id) === String(id))?.name || `User #${id}`;
  };

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = [...rows].sort((a, b) =>
      new Date(b.archivedAt || 0).getTime() - new Date(a.archivedAt || 0).getTime());
    if (!q) return list;
    return list.filter(r => {
      const d = describe[tab](r);
      return [d.ref, d.title, d.context].some(v => String(v || '').toLowerCase().includes(q));
    });
  }, [rows, search, tab]);

  if (!allowed) {
    return (
      <div className="py-20 text-center max-w-md mx-auto">
        <ShieldAlert className="w-12 h-12 text-rose-500 mx-auto mb-3" />
        <h3 className="text-base font-bold text-slate-900 dark:text-zinc-100">Access Restricted</h3>
        <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
          The archive is available to admins and super admins.
        </p>
      </div>
    );
  }

  return (
    <div id="archive-view" className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <Archive className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            Archive
          </h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Archived records are never deleted. Their full history stays in the audit trail.
          </p>
        </div>
        <button
          type="button"
          onClick={() => load(tab)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-zinc-800 bg-slate-200/60 dark:bg-zinc-900 text-slate-800 dark:text-zinc-300 hover:bg-slate-300/80 dark:hover:bg-zinc-800 transition cursor-pointer disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2.5 p-3 rounded-xl bg-slate-200/70 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 text-xs">
        <div className="flex flex-wrap gap-1">
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => { setTab(t.id); setSearch(''); }}
              className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition ${
                tab === t.id
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-700 dark:text-zinc-300 hover:bg-slate-300/70 dark:hover:bg-zinc-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[200px] max-w-xs flex-1 ml-auto">
          <Search className="w-4 h-4 absolute left-3 top-2 text-slate-500 dark:text-zinc-400" />
          <input
            type="text"
            placeholder="Search by ID, title..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
          />
        </div>
      </div>

      <div className="bg-slate-200/60 dark:bg-zinc-900 rounded-xl border border-slate-300 dark:border-zinc-800 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-300/40 dark:bg-zinc-800/60 border-b border-slate-300 dark:border-zinc-800 text-slate-600 dark:text-zinc-400 uppercase tracking-wider font-semibold">
              <tr>
                <th className="p-3.5">ID</th>
                <th className="p-3.5">Title</th>
                <th className="p-3.5">{contextLabel[tab]}</th>
                <th className="p-3.5">Archived</th>
                <th className="p-3.5">Archived by</th>
                <th className="p-3.5">Restores as</th>
                <th className="p-3.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300/50 dark:divide-zinc-800/60 text-slate-800 dark:text-zinc-300">
              {visibleRows.map(r => {
                const d = describe[tab](r);
                return (
                  <tr key={r.id} className="hover:bg-slate-300/50 dark:hover:bg-zinc-800/50 transition">
                    <td className="p-3.5 font-mono whitespace-nowrap text-slate-600 dark:text-zinc-400">{d.ref || `#${r.id}`}</td>
                    <td className="p-3.5 font-semibold text-slate-900 dark:text-zinc-100">{d.title || '—'}</td>
                    <td className="p-3.5">{d.context}</td>
                    <td className="p-3.5 whitespace-nowrap text-slate-500 dark:text-zinc-400">
                      {r.archivedAt ? new Date(r.archivedAt).toLocaleString() : '—'}
                    </td>
                    <td className="p-3.5">{userName(r.archivedById)}</td>
                    <td className="p-3.5 capitalize whitespace-nowrap">
                      {prettyStatus(r.preArchiveStatus || restoreFallback[tab](r))}
                      {!r.preArchiveStatus && (
                        <span className="normal-case text-[10px] text-slate-500 dark:text-zinc-500" title="Archived before previous statuses were recorded"> (default)</span>
                      )}
                    </td>
                    <td className="p-3.5 text-right">
                      {canRestore(tab) && (
                        <button
                          type="button"
                          onClick={() => handleRestore(r)}
                          disabled={restoringId !== null}
                          className="px-3 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1 border border-indigo-300 dark:border-indigo-900 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-950/40 cursor-pointer disabled:opacity-60"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          {restoringId === r.id ? 'Restoring...' : 'Restore'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {error && (
            <p className="p-6 text-center text-xs text-rose-600 dark:text-rose-400">{error}</p>
          )}
          {!error && !loading && visibleRows.length === 0 && (
            <p className="p-6 text-center text-xs text-slate-500 dark:text-zinc-400">
              No archived {TABS.find(t => t.id === tab)?.label.toLowerCase()}.
            </p>
          )}
          {loading && visibleRows.length === 0 && (
            <p className="p-6 text-center text-xs text-slate-500 dark:text-zinc-400">Loading...</p>
          )}
        </div>
      </div>
    </div>
  );
};