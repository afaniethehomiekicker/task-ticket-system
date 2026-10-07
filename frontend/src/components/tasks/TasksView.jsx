import React, { useState, useMemo, useEffect, useRef, Fragment } from 'react';
import { Pager } from '../common/Pager';
import { useAppSelector } from '../../context/AppContext';
import { 
  CheckSquare, Plus, Search, Filter, Download, Clock, 
  Calendar, CheckCircle, ShieldAlert, ArrowUpDown, ChevronRight, User as UserIcon, Pin
} from 'lucide-react';
import { PriorityBadge, TaskStatusBadge, RoleBadge } from '../common/Badge';

import { canCreateTask, canAssignTickets, canTransferOwnWork, sameDepartmentUsers, isTaskAssignable, assignedByName, isStaffRole, isLimitedTaskView, isDepartmentView } from '../../utils/permissions';
import { clientOptionsFromProjects } from '../../utils/clientOptions';
import { PrivateBadge, DeptViewBadge } from '../common/PrivateToggle';
import { exportTasksToCSV } from '../../utils/exportUtils';

import { FilterSelect } from '../common/FilterSelect';
export const TasksView = () => {
  const { 
    visibleTasks, 
    visibleProjects, 
    allUsers, 
    currentUser, 
    setSelectedTaskId, 
    openQuickCreate,
    permissionMatrix,
    updateTaskStatus,
    updateTask,
    updateSubTaskStatus,
    updateSubTaskAssignee, getStatuses,
    taskListPreset,
    setTaskListPreset,
    listPreset,
    setListPreset,
    getStatusCategory,
    departments, fetchTasksPage, tasksVersion,
  } = useAppSelector(s => ({ fetchTasksPage: s.fetchTasksPage, tasksVersion: s.tasksVersion, visibleTasks: s.visibleTasks, visibleProjects: s.visibleProjects, allUsers: s.allUsers, currentUser: s.currentUser, setSelectedTaskId: s.setSelectedTaskId, openQuickCreate: s.openQuickCreate, permissionMatrix: s.permissionMatrix, updateTaskStatus: s.updateTaskStatus, updateTask: s.updateTask, updateSubTaskStatus: s.updateSubTaskStatus, updateSubTaskAssignee: s.updateSubTaskAssignee, getStatuses: s.getStatuses, taskListPreset: s.taskListPreset, setTaskListPreset: s.setTaskListPreset, listPreset: s.listPreset, setListPreset: s.setListPreset, getStatusCategory: s.getStatusCategory, departments: s.departments }));

  // A dashboard card's filter is the INITIAL filter, so the page draws once,
  // already filtered (instead of the full list first, then the filter).
  const preset = listPreset?.tab === 'tasks' ? listPreset : null;
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(preset?.status ?? taskListPreset?.status ?? 'all');

  // Apply a filter requested by another screen (dashboard cards), once.
  useEffect(() => {
    if (!taskListPreset) return;
    if (taskListPreset.status) setStatusFilter(taskListPreset.status);
    setTaskListPreset(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskListPreset]);
  const [priorityFilter, setPriorityFilter] = useState(preset?.priority ?? 'all');

  // Filter requested by the dashboard (drill-down), applied once.
  useEffect(() => {
    if (!listPreset || listPreset.tab !== 'tasks') return;
    if (listPreset.status !== undefined) setStatusFilter(listPreset.status);
    if (listPreset.priority !== undefined) setPriorityFilter(listPreset.priority);
    setListPreset(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listPreset]);
  const [projectFilter, setProjectFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [clientFilter, setClientFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [sortBy, setSortBy] = useState('dueDate');
  // Sub-tasks are listed under their parent task (they used to be visible
  // only inside the task drawer).
  const [showSubTasks, setShowSubTasks] = useState(true);

  // Sub-tasks shown under a task: live ones, narrowed by the assignee filter
  // and by search (a search that matches the parent shows all its sub-tasks).
  const subTasksToShow = (t) => {
    if (!showSubTasks) return [];
    const q = search.toLowerCase();
    const parentMatchesSearch = !q ||
      t.title.toLowerCase().includes(q) || t.taskNumber.toLowerCase().includes(q);
    return (t.subTasks || []).filter(st =>
      st && st.status !== 'archived' &&
      (assigneeFilter === 'all' || String(st.assignedToId) === assigneeFilter) &&
      (parentMatchesSearch || (st.title || '').toLowerCase().includes(q))
    );
  };

  // ---- One page at a time, from the server, across all history ----
  // The browser only keeps the working set (open + recently finished tasks),
  // so the list asks GET /api/tasks for the page shown, with every filter,
  // the search and the sort applied there (sub=1: a sub-task can match the
  // person / search, as before). It keeps the ids and reads each task from
  // the shared cache, so edits show at once, and refetches after any task
  // change (tasksVersion).
  const TASKS_PER_PAGE = 50;
  const SORT_PARAM = { dueDate: 'due', priority: 'priority', status: 'status' };
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
    search: debouncedSearch, status: statusFilter, priority: priorityFilter, projectId: projectFilter,
    assignedToId: assigneeFilter, clientId: clientFilter, department: deptFilter, sub: showSubTasks,
    sort: SORT_PARAM[sortBy] || 'number',
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
    fetchTasksPage({ ...filters, page, limit: TASKS_PER_PAGE })
      .then(({ tasks, pagination: pg }) => {
        if (cancelled) return;
        if (tasks.length === 0 && page > 1 && page > (pg.pages || 1)) { setPage(Math.max(1, pg.pages || 1)); return; }
        setPageIds(tasks.map(t => String(t.id)));
        setPagination(pg);
      })
      .catch(err => { if (!cancelled) setLoadError(err.message || 'Failed to load tasks'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filterKey, tasksVersion, reloadKey]);

  // This page's tasks, in the server's order, from the shared cache.
  const pageTasks = useMemo(() => {
    const byId = new Map((visibleTasks || []).map(t => [String(t.id), t]));
    return pageIds.map(id => byId.get(id)).filter(Boolean);
  }, [pageIds, visibleTasks]);
  const filteredTasks = pageTasks; // (name kept for the render below)

  const taskPager = {
    page: pagination.page || page,
    pages: Math.max(1, pagination.pages || 1),
    total: pagination.total || 0,
    start: ((pagination.page || page) - 1) * TASKS_PER_PAGE,
    count: pageTasks.length,
    setPage,
  };

  // Export: every task matching the filters, not just this page.
  const [exporting, setExporting] = useState(false);
  const handleExport = async () => {
    setExporting(true);
    try {
      let all = [];
      for (let p = 1; p <= 50; p++) {
        const { tasks, pagination: pg } = await fetchTasksPage({ ...filters, page: p, limit: 200 });
        all = all.concat(tasks);
        if (p >= (pg.pages || 1)) break;
      }
      exportTasksToCSV(all, allUsers, visibleProjects);
    } catch (err) {
      alert(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div id="tasks-view" className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <CheckSquare className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            Task Management
          </h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            {isStaffRole(currentUser.role) ? 'Your assigned tasks, deliverables, and checklists.' : 'Department work items, delegations, and quality sign-off queue.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="export-tasks-csv-btn"
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-zinc-800 bg-slate-200/60 dark:bg-zinc-900 text-slate-800 dark:text-zinc-300 hover:bg-slate-300/80 dark:hover:bg-zinc-800 transition cursor-pointer disabled:opacity-60 disabled:cursor-wait"
          >
            <Download className="w-4 h-4" />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>

          {canCreateTask(currentUser, permissionMatrix) && (
            <button
              id="create-task-main-btn"
              onClick={() => openQuickCreate({ tab: 'task', restrictToTab: true })}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              New Task
            </button>
          )}
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="flex flex-wrap items-center gap-2.5 p-3 rounded-xl bg-slate-200/70 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 text-xs">
        {/* Search */}
        <div className="relative min-w-[200px] max-w-xs flex-1">
          <Search className="w-4 h-4 absolute left-3 top-2 text-slate-500 dark:text-zinc-400" />
          <input
            id="tasks-search-input"
            type="text"
            placeholder="Search by title, #TSK, or label..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
          />
        </div>

        {/* Project Filter */}
        <select
          id="tasks-project-filter"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-800 dark:text-zinc-300 focus:outline-hidden"
        >
          <option value="all">All Projects</option>
          {visibleProjects.map(p => (
            <option key={p.id} value={p.id}>
              {p.code}
            </option>
          ))}
        </select>

        {/* Status Filter */}
        <select
          id="tasks-status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-800 dark:text-zinc-300 focus:outline-hidden"
        >
          {/* Rewritten to match the real backend Task.Status enum (see
              the matching comment in TaskEditModal.jsx) — "new"/
              "on_hold"/"closed" aren't real Task statuses at all, and
              "under_review"/"completed" were near-misses for the real
              "in_review"/"done". Every one of the old options either
              matched nothing or matched the wrong tasks. */}
          <option value="all">All Statuses</option>
          <option value="open">Open (not finished)</option>
          <option value="overdue">Overdue</option>
          {getStatuses('task', { includeDisabled: true }).map(st => (
            <option key={st.key} value={st.key}>{st.label}{st.enabled ? '' : ' (disabled)'}</option>
          ))}
        </select>
          <FilterSelect id="tasks-client-filter" value={clientFilter} onChange={setClientFilter} allLabel="All Clients"
            options={clientOptionsFromProjects(visibleProjects)} />
          <FilterSelect id="tasks-dept-filter" value={deptFilter} onChange={setDeptFilter} allLabel="All Departments"
            options={(departments || []).map(d => [d.name, d.name])} />

        {/* Priority Filter */}
        <select
          id="tasks-priority-filter"
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

        {/* Assignee Filter */}
        {!isStaffRole(currentUser.role) && (
          <select
            id="tasks-assignee-filter"
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-800 dark:text-zinc-300 focus:outline-hidden"
          >
            <option value="all">All Team Members</option>
            {allUsers.map(u => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}

        {/* Sort By */}
        <div className="flex items-center gap-1.5 ml-auto">
          <ArrowUpDown className="w-3.5 h-3.5 text-slate-500 dark:text-zinc-400" />
          <select
            id="tasks-sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-2 py-1 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-800 dark:text-zinc-300 focus:outline-hidden"
          >
            <option value="dueDate">Sort by Due Date</option>
            <option value="priority">Sort by Priority</option>
            <option value="status">Sort by Status</option>
            <option value="number">Sort by Task #</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-zinc-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showSubTasks}
              onChange={(e) => setShowSubTasks(e.target.checked)}
              className="accent-indigo-600"
            />
            Show sub-tasks
          </label>
        </div>
      </div>

      {/* Task List Table */}
      <div className={`bg-slate-200/60 dark:bg-zinc-900 rounded-xl border border-slate-300 dark:border-zinc-800 overflow-hidden shadow-2xs transition-opacity ${loading ? 'opacity-70' : ''}`}>
        {loadError ? (
          <div className="py-10 text-center text-sm">
            <p className="text-rose-600 dark:text-rose-400">{loadError}</p>
            <button type="button" onClick={() => setReloadKey(k => k + 1)} className="mt-2 text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer">Try again</button>
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="py-16 text-center text-slate-500 p-8">
            <CheckSquare className="w-12 h-12 mx-auto mb-3 text-slate-400 dark:text-zinc-700" />
            <p className="text-sm font-semibold text-slate-800 dark:text-zinc-300">{loading ? 'Loading tasks…' : 'No tasks match your criteria'}</p>
            {!loading && <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">Try clearing filters or search query.</p>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-300/40 dark:bg-zinc-800/60 border-b border-slate-300 dark:border-zinc-800 text-slate-600 dark:text-zinc-400 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="p-3.5">Task #</th>
                  <th className="p-3.5">Title & Labels</th>
                  <th className="p-3.5">Project</th>
                  <th className="p-3.5">Assignee</th>
                  <th className="p-3.5">Priority</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5">Progress</th>
                  <th className="p-3.5">Due Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-300/50 dark:divide-zinc-800/60 text-slate-800 dark:text-zinc-300">
                {pageTasks.map(t => {
                  const assignee = allUsers.find(u => u.id === t.assignedToId);
                  const project = visibleProjects.find(p => p.id === t.projectId);
                  const isUnderReview = t.status === 'in_review';

                  const subRows = subTasksToShow(t);

                  return (
                    <Fragment key={t.id}>
                    <tr
                      id={`task-row-${t.id}`}
                      onClick={() => setSelectedTaskId(t.id)}
                      className={`hover:bg-slate-300/50 dark:hover:bg-zinc-800/50 cursor-pointer transition ${
                        isUnderReview ? 'bg-purple-100/40 dark:bg-purple-950/20' : ''
                      }`}
                    >
                      <td className="p-3.5 font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              updateTask(t.id, { isPinned: !t.isPinned });
                            }}
                            className={`p-1 rounded transition hover:bg-slate-300 dark:hover:bg-zinc-800 cursor-pointer ${
                              t.isPinned ? 'text-amber-500 hover:text-amber-600' : 'text-slate-400 hover:text-slate-600 dark:text-zinc-600 dark:hover:text-zinc-400'
                            }`}
                            title={t.isPinned ? 'Unpin task' : 'Pin task'}
                          >
                            <Pin className={`w-3.5 h-3.5 ${t.isPinned ? 'fill-current' : ''}`} />
                          </button>
                          <span>{t.taskNumber}</span>
                          {t.isPrivate && <PrivateBadge />}
                          {isDepartmentView(t) && <DeptViewBadge />}
                        </div>
                      </td>
                      <td className="p-3.5 max-w-xs">
                        <div className="font-semibold text-slate-900 dark:text-zinc-100 line-clamp-1 mb-0.5">
                          {t.title}
                        </div>
                        {(t.labels || []).length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {(t.labels || []).slice(0, 3).map(l => (
                              <span key={l} className="text-[9px] px-1.5 py-0.2 rounded bg-slate-300/60 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 font-medium">
                                {l}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="p-3.5 text-slate-600 dark:text-zinc-400">{project?.code || 'PRJ'}</td>
                      <td className="p-3.5">
                        {assignee ? (
                          <div className="flex items-center gap-2">
                            <img src={assignee.avatar || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='50' fill='%23cbd5e1'/%3E%3Ccircle cx='50' cy='38' r='18' fill='%2394a3b8'/%3E%3Cellipse cx='50' cy='92' rx='34' ry='26' fill='%2394a3b8'/%3E%3C/svg%3E"} alt={assignee.name} className="w-5 h-5 rounded-full object-cover" />
                            <span className="font-medium">{assignee.name}</span>
                          </div>
                        ) : (
                          <span className="text-slate-500 dark:text-zinc-500">Unassigned</span>
                        )}
                        {assignee && assignedByName(t, allUsers) && (
                          <span className="block mt-0.5 text-[10px] text-slate-500 dark:text-zinc-400">by {assignedByName(t, allUsers)}</span>
                        )}
                      </td>
                      <td className="p-3.5"><PriorityBadge priority={t.priority} /></td>
                      <td className="p-3.5">
                        <div className="flex items-center gap-1.5">
                          <TaskStatusBadge status={t.status} />
                          {isUnderReview && (
                            <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" title="Needs review" />
                          )}
                        </div>
                      </td>
                      <td className="p-3.5 font-mono">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-slate-300 dark:bg-zinc-800 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${t.progress || 0}%` }} />
                          </div>
                          <span>{t.progress || 0}%</span>
                        </div>
                      </td>
                      <td className="p-3.5 whitespace-nowrap">{t.dueDate}</td>
                    </tr>
                    {subRows.map(st => {
                      const subAssignee = allUsers.find(u => String(u.id) === String(st.assignedToId));
                      // The backend allows the sub-task's own assignee, or
                      // anyone with full access to the parent task.
                      // (A sub-task reference view or a department view only
                      // lets you change your own sub-tasks.)
                      const canChange = !isLimitedTaskView(t) || String(st.assignedToId) === String(currentUser?.id);
                      return (
                        <tr
                          key={`sub-${st.id}`}
                          onClick={() => setSelectedTaskId(t.id)}
                          className="bg-slate-100/60 dark:bg-zinc-950/40 hover:bg-slate-300/40 dark:hover:bg-zinc-800/40 cursor-pointer transition"
                        >
                          <td className="py-2 px-3.5 pl-10 font-mono text-[10px] text-slate-500 dark:text-zinc-500 whitespace-nowrap">
                            ↳ {t.taskNumber}
                          </td>
                          <td className="py-2 px-3.5 max-w-xs">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 font-bold uppercase">Sub-task</span>
                              {st.subtaskNumber && <span className="font-mono text-[10px] text-slate-500 dark:text-zinc-500">{st.subtaskNumber}</span>}
                              <span className="text-slate-800 dark:text-zinc-200 line-clamp-1">{st.title}</span>
                            </div>
                          </td>
                          <td className="py-2 px-3.5 text-slate-500 dark:text-zinc-500">{project?.code || ''}</td>
                          <td className="py-2 px-3.5" onClick={(e) => e.stopPropagation()}>
                            {(() => {
                              // Same rules as the drawer / backend: reassign
                              // anyone's (full access), or transfer within your
                              // department if it's your sub-task or your task.
                              const me = String(currentUser?.id);
                              const anyRight = !isLimitedTaskView(t) && canAssignTickets(currentUser, permissionMatrix);
                              const transferRight = canTransferOwnWork(currentUser, permissionMatrix) &&
                                (String(st.assignedToId) === me || (!isLimitedTaskView(t) && String(t.assignedToId) === me));
                              if (!anyRight && !transferRight) return null;
                              const pool = (anyRight ? allUsers.filter(u => u.status === 'active') : sameDepartmentUsers(currentUser, allUsers))
                                .filter(isTaskAssignable); // admins assign, aren't assigned
                              const current = allUsers.find(u => String(u.id) === String(st.assignedToId));
                              const options = current && !pool.some(u => u.id === current.id) ? [...pool, current] : pool;
                              return (
                                <select
                                  value={st.assignedToId ?? ''}
                                  onChange={(e) => updateSubTaskAssignee(t.id, st.id, e.target.value)}
                                  className="max-w-[160px] px-2 py-1 text-[11px] rounded border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800 text-slate-800 dark:text-zinc-300 focus:outline-hidden"
                                >
                                  {anyRight && <option value="">Unassigned</option>}
                                  {options.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                                </select>
                              );
                            })() ?? (
                              subAssignee ? <span className="font-medium">{subAssignee.name}</span>
                                : <span className="text-slate-500 dark:text-zinc-500">Unassigned</span>
                            )}
                          </td>
                          <td className="py-2 px-3.5"><PriorityBadge priority={st.priority} /></td>
                          <td className="py-2 px-3.5" onClick={(e) => e.stopPropagation()}>
                            <select
                              value={st.status}
                              disabled={!canChange}
                              onChange={(e) => updateSubTaskStatus(t.id, st.id, e.target.value)}
                              className="px-2 py-1 text-[11px] rounded border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800 text-slate-800 dark:text-zinc-300 focus:outline-hidden disabled:opacity-60"
                            >
                              <option value="todo">To Do</option>
                              <option value="in_progress">In Progress</option>
                              <option value="done">Done</option>
                              <option value="cancelled">Cancelled</option>
                            </select>
                          </td>
                          <td className="py-2 px-3.5"></td>
                          <td className="py-2 px-3.5 whitespace-nowrap text-slate-500 dark:text-zinc-400">{st.dueDate || '—'}</td>
                        </tr>
                      );
                    })}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {/* A page at a time: drawing thousands of rows froze the page. */}
        <div className="px-3.5 py-2.5 border-t border-slate-300 dark:border-zinc-800">
          <Pager {...taskPager} noun="tasks" />
        </div>
      </div>

      {/* Task Drawer */}
    </div>
  );
};