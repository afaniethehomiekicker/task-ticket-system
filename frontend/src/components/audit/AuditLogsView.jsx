import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  ScrollText, Search, Filter, Download, ShieldCheck, 
  Clock, ShieldAlert, FileText, CheckCircle, RefreshCw
} from 'lucide-react';
import { RoleBadge } from '../common/Badge';
import { exportAuditLogsToCSV } from '../../utils/exportUtils';
import { canViewAuditLogs } from '../../utils/permissions';

export const AuditLogsView = () => {
  const {
    auditLogs, auditPagination, auditLoading, fetchAuditLogs,
    currentUser, permissionMatrix
  } = useApp();

  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');

  // Live matrix, not the defaults — an admin granted view_audit_logs in
  // Settings was still shown "Access Restricted".
  const allowed = canViewAuditLogs(currentUser, permissionMatrix);

  // Filtering happens on the server now (it used to filter only the handful
  // of rows already in memory). Search is debounced.
  const firstRun = useRef(true);
  useEffect(() => {
    if (!allowed) return;
    const run = () => fetchAuditLogs({
      page: 1,
      search: search.trim() || undefined,
      action: actionFilter === 'all' ? undefined : actionFilter,
      resourceType: entityFilter === 'all' ? undefined : entityFilter,
    });
    if (firstRun.current) {
      firstRun.current = false;
      run();
      return;
    }
    const t = setTimeout(run, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, entityFilter, actionFilter, allowed]);

  const filteredLogs = auditLogs;
  const canLoadMore = auditPagination.page > 0 && auditPagination.page < auditPagination.pages;

  const handleExport = () => {
    exportAuditLogsToCSV(filteredLogs);
  };

  if (!allowed) {
    return (
      <div className="py-20 text-center max-w-md mx-auto">
        <ShieldAlert className="w-12 h-12 text-rose-500 mx-auto mb-3" />
        <h3 className="text-base font-bold text-slate-900 dark:text-zinc-100">Access Restricted</h3>
        <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
          System audit trails are only available to roles with the "View System Audit Trail" permission.
        </p>
      </div>
    );
  }

  return (
    <div id="audit-logs-view" className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <ScrollText className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            System Audit & Governance Logs
          </h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Immutable timeline of state modifications, permission escalations, and security actions.
          </p>
        </div>

        <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => fetchAuditLogs({ page: 1,
            search: search.trim() || undefined,
            action: actionFilter === 'all' ? undefined : actionFilter,
            resourceType: entityFilter === 'all' ? undefined : entityFilter })}
          disabled={auditLoading}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-zinc-800 bg-slate-200/60 dark:bg-zinc-900 text-slate-800 dark:text-zinc-300 hover:bg-slate-300/80 dark:hover:bg-zinc-800 transition cursor-pointer disabled:opacity-60"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${auditLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
        <button
          id="export-audit-csv-btn"
          onClick={handleExport}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-zinc-800 bg-slate-200/60 dark:bg-zinc-900 text-slate-800 dark:text-zinc-300 hover:bg-slate-300/80 dark:hover:bg-zinc-800 transition cursor-pointer"
        >
          <Download className="w-4 h-4" />
          Export Loaded Rows (CSV)
        </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2.5 p-3 rounded-xl bg-slate-200/70 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 text-xs">
        <div className="relative min-w-[200px] max-w-xs flex-1">
          <Search className="w-4 h-4 absolute left-3 top-2 text-slate-500 dark:text-zinc-400" />
          <input
            id="audit-search-input"
            type="text"
            placeholder="Search by actor or log details..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
          />
        </div>

        <select
          id="audit-entity-filter"
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
          className="px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-800 dark:text-zinc-300 focus:outline-hidden"
        >
          <option value="all">All Entity Types</option>
          <option value="project">Projects</option>
          <option value="task">Tasks</option>
          <option value="subtask">Subtasks</option>
          <option value="ticket">Tickets</option>
          <option value="feasibility">Feasibilities</option>
          <option value="client">Clients</option>
          <option value="user">Users</option>
          <option value="role">Roles & Permissions</option>
          <option value="department">Departments</option>
        </select>

        <select
          id="audit-action-filter"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-800 dark:text-zinc-300 focus:outline-hidden"
        >
          <option value="all">All Actions</option>
          <option value="created">Created</option>
          <option value="updated">Updated</option>
          <option value="status_changed">Status Change</option>
          <option value="assigned">Assigned</option>
          <option value="escalated">Escalated</option>
          <option value="archived">Archived</option>
          <option value="commented">Commented</option>
          <option value="internal_note_added">Internal Note</option>
          <option value="role_changed">Role Changed</option>
          <option value="permission_changed">Permission Changed</option>
          <option value="work_log_added">Work Log Added</option>
        </select>
      </div>

      {/* Audit Log Table */}
      <div className="bg-slate-200/60 dark:bg-zinc-900 rounded-xl border border-slate-300 dark:border-zinc-800 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-300/40 dark:bg-zinc-800/60 border-b border-slate-300 dark:border-zinc-800 text-slate-600 dark:text-zinc-400 uppercase tracking-wider font-semibold">
              <tr>
                <th className="p-3.5">Timestamp</th>
                <th className="p-3.5">Actor</th>
                <th className="p-3.5">Role</th>
                <th className="p-3.5">Entity</th>
                <th className="p-3.5">Action</th>
                <th className="p-3.5">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300/50 dark:divide-zinc-800/60 text-slate-800 dark:text-zinc-300 font-mono">
              {filteredLogs.map(log => (
                <tr key={log.id} className="hover:bg-slate-300/50 dark:hover:bg-zinc-800/50 transition">
                  <td className="p-3.5 whitespace-nowrap text-slate-500 dark:text-zinc-400 text-[11px]">
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td className="p-3.5 font-sans font-semibold text-slate-900 dark:text-zinc-100">
                    {log.actorName}
                  </td>
                  <td className="p-3.5 font-sans">
                    <RoleBadge role={log.actorRole} size="xs" />
                  </td>
                  <td className="p-3.5 uppercase text-[10px] text-slate-500 dark:text-zinc-400 font-sans">
                    {log.entityType}
                  </td>
                  <td className="p-3.5">
                    <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-slate-300/60 dark:bg-zinc-800 text-slate-800 dark:text-zinc-300">
                      {(log.action || '').replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="p-3.5 font-sans text-slate-800 dark:text-zinc-300 text-xs">
                    {log.details}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredLogs.length === 0 && !auditLoading && (
            <p className="p-6 text-center text-xs text-slate-500 dark:text-zinc-400">No audit entries match.</p>
          )}
        </div>
        <div className="flex items-center justify-between px-3.5 py-2.5 border-t border-slate-300 dark:border-zinc-800 text-[11px] text-slate-500 dark:text-zinc-400">
          <span>Showing {filteredLogs.length} of {auditPagination.total} entries</span>
          {canLoadMore && (
            <button
              type="button"
              onClick={() => fetchAuditLogs({ page: auditPagination.page + 1, append: true })}
              disabled={auditLoading}
              className="px-3 py-1 rounded-lg font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60 cursor-pointer"
            >
              {auditLoading ? 'Loading...' : 'Load more'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};