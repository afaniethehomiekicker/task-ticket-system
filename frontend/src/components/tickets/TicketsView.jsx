import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  LifeBuoy, Plus, Search, Filter, Download, Clock, 
  AlertTriangle, ShieldAlert, ArrowUpDown, Building, User as UserIcon, Pin, Pencil
} from 'lucide-react';
import { PriorityBadge, TicketStatusBadge, RoleBadge } from '../common/Badge';
import { exportTicketsToCSV } from '../../utils/exportUtils';

import { assignedByName, ticketSlaState, isStaffRole } from '../../utils/permissions';
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
    clients,
    visibleProjects,
    departments
  } = useApp();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');

  // Filter requested by the dashboard (drill-down), applied once.
  useEffect(() => {
    if (!listPreset || listPreset.tab !== 'tickets') return;
    if (listPreset.status !== undefined) setStatusFilter(listPreset.status);
    if (listPreset.priority !== undefined) setPriorityFilter(listPreset.priority);
    setListPreset(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listPreset]);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [clientFilter, setClientFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [slaFilter, setSlaFilter] = useState('all');
  const [sortBy, setSortBy] = useState('sla');

  const filteredTickets = useMemo(() => {
    return visibleTickets.filter(t => {
      const matchSearch = t.title.toLowerCase().includes(search.toLowerCase()) || 
                          t.ticketNumber.toLowerCase().includes(search.toLowerCase()) ||
                          t.requesterName.toLowerCase().includes(search.toLowerCase()) ||
                          (t.requesterCompany && t.requesterCompany.toLowerCase().includes(search.toLowerCase()));
      // Statuses are the backend's real Ticket.Status values. The old list
      // (open / pending_customer) matched nothing. "Escalated" isn't a status —
      // it's escalation_level != none.
      // 'open' = anything not finished (dashboard drill-down).
      const matchStatus = statusFilter === 'all'
        || (statusFilter === 'open' && !['done', 'cancelled', 'archived'].includes(getStatusCategory('ticket', t.status)))
        || (statusFilter === 'escalated' ? t.escalationLevel !== 'none' : t.status === statusFilter);
      const matchPriority = priorityFilter === 'all' || t.priority === priorityFilter;
      const matchCategory = categoryFilter === 'all' || t.category === categoryFilter;
      // String compare: the select's value is text, the id a number (this
      // never matched before).
      const matchAssignee = assigneeFilter === 'all' || String(t.assignedToId) === assigneeFilter;
      // Slide 28 filters.
      const matchClient = clientFilter === 'all' || String(t.clientId) === clientFilter;
      const matchProjectF = projectFilter === 'all' || String(t.projectId) === projectFilter;
      const matchDept = deptFilter === 'all' || (t.department || '').toLowerCase() === deptFilter.toLowerCase();
      const matchSla = slaFilter === 'all' ||
        ticketSlaState(t, (st) => ['done', 'cancelled', 'archived'].includes(getStatusCategory('ticket', st))) === slaFilter;

      return matchSearch && matchStatus && matchPriority && matchCategory && matchAssignee &&
        matchClient && matchProjectF && matchDept && matchSla;
    }).sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;

      if (sortBy === 'sla') {
        return (a.slaDueTime ? new Date(a.slaDueTime).getTime() : 0) - (b.slaDueTime ? new Date(b.slaDueTime).getTime() : 0);
      }
      if (sortBy === 'priority') {
        const order = { critical: 5, urgent: 4, high: 3, normal: 2, low: 1 };
        return order[b.priority] - order[a.priority];
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [visibleTickets, search, statusFilter, priorityFilter, categoryFilter, assigneeFilter, sortBy,
      clientFilter, projectFilter, deptFilter, slaFilter]);

  const handleExport = () => {
    exportTicketsToCSV(filteredTickets, allUsers);
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
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-zinc-800 bg-slate-200/60 dark:bg-zinc-900 text-slate-800 dark:text-zinc-300 hover:bg-slate-300/80 dark:hover:bg-zinc-800 transition cursor-pointer"
          >
            <Download className="w-4 h-4" />
            Export CSV
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
          options={(clients || []).filter(c => c.status !== 'archived').map(c => [String(c.id), c.companyName])} />
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
      <div className="bg-slate-200/60 dark:bg-zinc-900 rounded-xl border border-slate-300 dark:border-zinc-800 overflow-hidden shadow-2xs">
        {filteredTickets.length === 0 ? (
          <div className="py-16 text-center text-slate-500 p-8">
            <LifeBuoy className="w-12 h-12 mx-auto mb-3 text-slate-400 dark:text-zinc-700" />
            <p className="text-sm font-semibold text-slate-800 dark:text-zinc-300">No tickets found</p>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">Check search parameters or verify assigned tickets.</p>
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
                {filteredTickets.map(t => {
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Ticket Drawer */}
    </div>
  );
};