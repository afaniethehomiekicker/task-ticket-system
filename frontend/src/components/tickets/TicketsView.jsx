import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Pager } from '../common/Pager';
import { useAppSelector } from '../../context/AppContext';
import { 
  LifeBuoy, Plus, Search, Filter, Download, Clock, 
  AlertTriangle, ShieldAlert, ArrowUpDown, Building, User as UserIcon, Pin, Pencil
} from 'lucide-react';
import { PriorityBadge, TicketStatusBadge, RoleBadge } from '../common/Badge';
import { exportTicketsToCSV } from '../../utils/exportUtils';

import { assignedByName, ticketSlaState, isStaffRole, isDepartmentView } from '../../utils/permissions';
import { clientOptionsFromTickets } from '../../utils/clientOptions';
import { PrivateBadge, DeptViewBadge } from '../common/PrivateToggle';
import { FilterSelect } from '../common/FilterSelect';
export const TicketsView = () => {
  const { 
    visibleTickets, 
    allUsers, 
    currentUser, 
    setSelectedTicketId, 
    setSelectedTicketEditId,
    openQuickCreate,
    updateTicket, getStatuses,
    listPreset,
    setListPreset,
    getStatusCategory,
    visibleProjects,
    departments, fetchTicketsPage, ticketsVersion,
  } = useAppSelector(s => ({ fetchTicketsPage: s.fetchTicketsPage, ticketsVersion: s.ticketsVersion, visibleTickets: s.visibleTickets, allUsers: s.allUsers, currentUser: s.currentUser, setSelectedTicketId: s.setSelectedTicketId, setSelectedTicketEditId: s.setSelectedTicketEditId, openQuickCreate: s.openQuickCreate, updateTicket: s.updateTicket, getStatuses: s.getStatuses, listPreset: s.listPreset, setListPreset: s.setListPreset, getStatusCategory: s.getStatusCategory, visibleProjects: s.visibleProjects, departments: s.departments }));

  // A dashboard card's filter is used as the INITIAL filter, so the page
  // draws once, already filtered. (It used to draw the full list first and
  // only then apply the filter — a visible delay on every card click.)
  const preset = listPreset?.tab === 'tickets' ? listPreset : null;
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(preset?.status ?? 'all');
  const [priorityFilter, setPriorityFilter] = useState(preset?.priority ?? 'all');
  const [assigneeFilter, setAssigneeFilter] = useState(preset?.assignee !== undefined ? String(preset.assignee) : 'all');

  // Filter requested by the dashboard (drill-down), applied once.
  useEffect(() => {
    if (!listPreset || listPreset.tab !== 'tickets') return;
    if (listPreset.status !== undefined) setStatusFilter(listPreset.status);
    if (listPreset.priority !== undefined) setPriorityFilter(listPreset.priority);
    if (listPreset.assignee !== undefined) setAssigneeFilter(String(listPreset.assignee));
    setListPreset(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listPreset]);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [clientFilter, setClientFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [slaFilter, setSlaFilter] = useState('all');
  const [sortBy, setSortBy] = useState('sla');

  // ---- One page at a time, from the server, across all history ----
  // The browser only keeps the working set (open + recently finished
  // tickets), so the list asks GET /api/tickets for the page shown, with
  // every filter, the search and the sort applied there. It keeps the ids
  // and reads each ticket from the shared cache, so edits show at once, and
  // refetches after any ticket change (ticketsVersion).
  const TICKETS_PER_PAGE = 50;
  const SORT_PARAM = { sla: 'sla', priority: 'priority', date: 'date' };
  const [page, setPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pageIds, setPageIds] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const filters = {
    search: debouncedSearch, status: statusFilter, priority: priorityFilter, category: categoryFilter,
    assignedToId: assigneeFilter, clientId: clientFilter, projectId: projectFilter, department: deptFilter,
    sla: slaFilter, sort: SORT_PARAM[sortBy] || 'date',
  };
  const filterKey = JSON.stringify(filters);
  // Any filter change goes back to page 1 (one request, not two).
  const lastFilterKeyRef = useRef(filterKey);

  useEffect(() => {
    if (lastFilterKeyRef.current !== filterKey) {
      lastFilterKeyRef.current = filterKey;
      if (page !== 1) { setPage(1); return undefined; }
    }
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    fetchTicketsPage({ ...filters, page, limit: TICKETS_PER_PAGE })
      .then(({ tickets, pagination: pg }) => {
        if (cancelled) return;
        if (tickets.length === 0 && page > 1 && page > (pg.pages || 1)) { setPage(Math.max(1, pg.pages || 1)); return; }
        setPageIds(tickets.map(t => String(t.id)));
        setPagination(pg);
      })
      .catch(err => { if (!cancelled) setLoadError(err.message || 'Failed to load tickets'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filterKey, ticketsVersion, reloadKey]);

  // This page's tickets, in the server's order, from the shared cache.
  const pageTickets = useMemo(() => {
    const byId = new Map((visibleTickets || []).map(t => [String(t.id), t]));
    return pageIds.map(id => byId.get(id)).filter(Boolean);
  }, [pageIds, visibleTickets]);
  const filteredTickets = pageTickets; // (name kept for the render below)

  const ticketPager = {
    page: pagination.page || page,
    pages: Math.max(1, pagination.pages || 1),
    total: pagination.total || 0,
    start: ((pagination.page || page) - 1) * TICKETS_PER_PAGE,
    count: pageTickets.length,
    setPage,
  };

  // Export: every ticket matching the filters, not just this page.
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    setExporting(true);
    try {
      let all = [];
      for (let p = 1; p <= 50; p++) {
        const { tickets, pagination: pg } = await fetchTicketsPage({ ...filters, page: p, limit: 200 });
        all = all.concat(tickets);
        if (p >= (pg.pages || 1)) break;
      }
      exportTicketsToCSV(all, allUsers);
    } catch (err) {
      alert(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div id="tickets-view" className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <LifeBuoy className="w-6 h-6 text-amber-600 dark:text-amber-400" />
            Tickets Desk & Help Center
          </h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Customer inquiries, technical incidents, SLA response benchmarks, and tier escalations.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="export-tickets-csv-btn"
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-zinc-800 bg-slate-200/60 dark:bg-zinc-900 text-slate-800 dark:text-zinc-300 hover:bg-slate-300/80 dark:hover:bg-zinc-800 transition cursor-pointer disabled:opacity-60 disabled:cursor-wait"
          >
            <Download className="w-4 h-4" />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>

          <button
            id="create-ticket-main-btn"
            onClick={() => openQuickCreate({ tab: 'ticket', restrictToTab: true })}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            New Ticket
          </button>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="flex flex-wrap items-center gap-2.5 p-3 rounded-xl bg-slate-200/70 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 text-xs">
        <div className="relative min-w-[200px] max-w-xs flex-1">
          <Search className="w-4 h-4 absolute left-3 top-2 text-slate-500 dark:text-zinc-400" />
          <input
            id="tickets-search-input"
            type="text"
            placeholder="Search #TCK, requester, or company..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
          />
        </div>

        <select
          id="tickets-status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-800 dark:text-zinc-300 focus:outline-hidden"
        >
          <option value="all">All Statuses</option>
          <option value="open">Open (not finished)</option>
          {/* From the configurable status catalog (Settings → Workflow Statuses). */}
          {getStatuses('ticket', { includeDisabled: true }).map(st => (
            <option key={st.key} value={st.key}>{st.label}{st.enabled ? '' : ' (disabled)'}</option>
          ))}
          <option value="escalated">Escalated (any tier)</option>
        </select>
        <FilterSelect id="tickets-sla-filter" value={slaFilter} onChange={setSlaFilter} allLabel="Any SLA"
          options={[['breached', 'SLA breached'], ['near', 'SLA near'], ['within', 'Within SLA'], ['none', 'No SLA / finished']]} />
        <FilterSelect id="tickets-client-filter" value={clientFilter} onChange={setClientFilter} allLabel="All Clients"
          options={clientOptionsFromTickets(visibleTickets)} />
        <FilterSelect id="tickets-project-filter" value={projectFilter} onChange={setProjectFilter} allLabel="All Projects"
          options={(visibleProjects || []).map(p => [String(p.id), `${p.code} ${p.title}`])} />
        <FilterSelect id="tickets-dept-filter" value={deptFilter} onChange={setDeptFilter} allLabel="All Departments"
          options={(departments || []).map(d => [d.name, d.name])} />

        <select
          id="tickets-category-filter"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-800 dark:text-zinc-300 focus:outline-hidden"
        >
          <option value="all">All Categories</option>
          <option value="Technical Support">Technical Support</option>
          <option value="Bug Report">Bug Report</option>
          <option value="Feature Request">Feature Request</option>
          <option value="Billing & Account">Billing & Account</option>
          <option value="General Inquiry">General Inquiry</option>
          <option value="Generic">Generic</option>
        </select>

        <select
          id="tickets-priority-filter"
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-800 dark:text-zinc-300 focus:outline-hidden"
        >
          <option value="all">All Priorities</option>
          <option value="critical">Critical</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>

        {!isStaffRole(currentUser.role) && (
          <select
            id="tickets-assignee-filter"
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-800 dark:text-zinc-300 focus:outline-hidden"
          >
            <option value="all">All Support Agents</option>
            {allUsers.map(u => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}

        {/* Staff see their department's tickets too; this narrows the list
            to their own (also what the dashboard's Assigned Tickets opens). */}
        {isStaffRole(currentUser.role) && (
          <button
            id="tickets-assigned-to-me"
            type="button"
            onClick={() => setAssigneeFilter(assigneeFilter === String(currentUser.id) ? 'all' : String(currentUser.id))}
            className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition cursor-pointer ${
              assigneeFilter === String(currentUser.id)
                ? 'border-teal-400 dark:border-teal-700 bg-teal-100 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300'
                : 'border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-700 dark:text-zinc-300 hover:border-teal-400'
            }`}
          >
            Assigned to me
          </button>
        )}

        <div className="flex items-center gap-1.5 ml-auto">
          <ArrowUpDown className="w-3.5 h-3.5 text-slate-500 dark:text-zinc-400" />
          <select
            id="tickets-sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-2 py-1 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-800 dark:text-zinc-300 focus:outline-hidden"
          >
            <option value="sla">Sort by SLA Due Target</option>
            <option value="priority">Sort by Priority</option>
            <option value="date">Sort by Creation Date</option>
          </select>
        </div>
      </div>

      {/* Tickets List Table */}
      <div className={`bg-slate-200/60 dark:bg-zinc-900 rounded-xl border border-slate-300 dark:border-zinc-800 overflow-hidden shadow-2xs transition-opacity ${loading ? 'opacity-70' : ''}`}>
        {loadError ? (
          <div className="py-10 text-center text-sm">
            <p className="text-rose-600 dark:text-rose-400">{loadError}</p>
            <button type="button" onClick={() => setReloadKey(k => k + 1)} className="mt-2 text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer">Try again</button>
          </div>
        ) : filteredTickets.length === 0 ? (
          <div className="py-16 text-center text-slate-500 p-8">
            <LifeBuoy className="w-12 h-12 mx-auto mb-3 text-slate-400 dark:text-zinc-700" />
            <p className="text-sm font-semibold text-slate-800 dark:text-zinc-300">{loading ? 'Loading tickets…' : 'No tickets found'}</p>
            {!loading && <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">Check search parameters or verify assigned tickets.</p>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-300/40 dark:bg-zinc-800/60 border-b border-slate-300 dark:border-zinc-800 text-slate-600 dark:text-zinc-400 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="p-3.5">Ticket #</th>
                  <th className="p-3.5">Subject & Requester</th>
                  <th className="p-3.5">Category</th>
                  <th className="p-3.5">Assigned Agent</th>
                  <th className="p-3.5">Priority</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5">Escalation</th>
                  <th className="p-3.5">SLA Target</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-300/50 dark:divide-zinc-800/60 text-slate-800 dark:text-zinc-300">
                {pageTickets.map(t => {
                  const assignee = allUsers.find(u => u.id === t.assignedToId);
                  const isEscalated = t.status === 'escalated' || t.escalationLevel !== 'none';

                  return (
                    <tr
                      key={t.id}
                      id={`ticket-row-${t.id}`}
                      onClick={() => setSelectedTicketId(t.id)}
                      className={`hover:bg-slate-300/50 dark:hover:bg-zinc-800/50 cursor-pointer transition ${
                        isEscalated ? 'bg-rose-100/40 dark:bg-rose-950/20' : ''
                      }`}
                    >
                      <td className="p-3.5 font-mono font-semibold text-amber-600 dark:text-amber-400">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (typeof updateTicket === 'function') {
                                updateTicket(t.id, { isPinned: !t.isPinned });
                              }
                            }}
                            className={`p-1 rounded transition hover:bg-slate-300 dark:hover:bg-zinc-800 cursor-pointer ${
                              t.isPinned ? 'text-amber-500 hover:text-amber-600' : 'text-slate-400 hover:text-slate-600 dark:text-zinc-600 dark:hover:text-zinc-400'
                            }`}
                            title={t.isPinned ? 'Unpin ticket' : 'Pin ticket'}
                          >
                            <Pin className={`w-3.5 h-3.5 ${t.isPinned ? 'fill-current' : ''}`} />
                          </button>
                          <span>{t.ticketNumber}</span>
                          {t.isPrivate && <PrivateBadge />}
                          {isDepartmentView(t) && <DeptViewBadge />}
                        </div>
                      </td>
                      <td className="p-3.5 max-w-xs">
                        <div className="font-semibold text-slate-900 dark:text-zinc-100 line-clamp-1 mb-0.5">
                          {t.title}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-zinc-400 flex items-center gap-1.5">
                          <span>{t.requesterName}</span>
                          {t.requesterCompany && (
                            <>
                              <span>•</span>
                              <span>{t.requesterCompany}</span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="p-3.5 text-indigo-600 dark:text-indigo-400 font-medium">
                        {t.category}
                      </td>
                      <td className="p-3.5">
                        {assignee ? (
                          <div className="flex items-center gap-2">
                            <img src={assignee.avatar || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='50' fill='%23cbd5e1'/%3E%3Ccircle cx='50' cy='38' r='18' fill='%2394a3b8'/%3E%3Cellipse cx='50' cy='92' rx='34' ry='26' fill='%2394a3b8'/%3E%3C/svg%3E"} alt={assignee.name} className="w-5 h-5 rounded-full object-cover" />
                            <span className="font-medium">{assignee.name}</span>
                          </div>
                        ) : (
                          <span className="text-amber-600 font-medium">Unassigned</span>
                        )}
                        {assignee && assignedByName(t, allUsers) && (
                          <span className="block mt-0.5 text-[10px] text-slate-500 dark:text-zinc-400">by {assignedByName(t, allUsers)}</span>
                        )}
                      </td>
                      <td className="p-3.5"><PriorityBadge priority={t.priority} /></td>
                      <td className="p-3.5"><TicketStatusBadge status={t.status} /></td>
                      <td className="p-3.5">
                        {t.escalationLevel !== 'none' ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 uppercase">
                            {t.escalationLevel}
                          </span>
                        ) : (
                          <span className="text-slate-500 dark:text-zinc-500 text-[11px]">None</span>
                        )}
                      </td>
                      <td className="p-3.5 whitespace-nowrap font-mono text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <Clock className={`w-3.5 h-3.5 ${t.slaBreached ? 'text-rose-500' : 'text-slate-500 dark:text-zinc-400'}`} />
                          <span className={t.slaBreached ? 'text-rose-600 font-semibold' : ''}>
                            {t.slaDueTime ? new Date(t.slaDueTime).toLocaleDateString() : 'Active'}
                          </span>
                        </div>
                      </td>
                      <td className="p-3.5 text-right whitespace-nowrap">
                        {/* Department viewers can open it (row click) but not edit. */}
                        {!isDepartmentView(t) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTicketEditId(t.id);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md border border-indigo-300 dark:border-indigo-800/80 bg-indigo-50/80 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition cursor-pointer"
                        >
                          <Pencil className="w-3 h-3" />
                          Edit
                        </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {/* A page at a time: drawing thousands of rows froze the page. */}
        <div className="px-3.5 py-2.5 border-t border-slate-300 dark:border-zinc-800">
          <Pager {...ticketPager} noun="tickets" />
        </div>
      </div>

      {/* Ticket Drawer */}
    </div>
  );
};