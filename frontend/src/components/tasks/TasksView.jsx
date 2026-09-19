import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  CheckSquare, Plus, Search, Filter, Download, Clock, 
  Calendar, CheckCircle, ShieldAlert, ArrowUpDown, ChevronRight, User as UserIcon, Pin
} from 'lucide-react';
import { PriorityBadge, TaskStatusBadge, RoleBadge } from '../common/Badge';

import { canCreateTask } from '../../utils/permissions';
import { exportTasksToCSV } from '../../utils/exportUtils';
import { TaskDetailDrawer } from './TaskDetailDrawer';

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
    updateTask
  } = useApp();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('dueDate');

  const filteredTasks = useMemo(() => {
    return visibleTasks.filter(t => {
      const matchSearch = t.title.toLowerCase().includes(search.toLowerCase()) || 
                          t.taskNumber.toLowerCase().includes(search.toLowerCase()) ||
                          (t.description || '').toLowerCase().includes(search.toLowerCase()) ||
                          (t.labels || []).some(l => l.toLowerCase().includes(search.toLowerCase()));
      const matchStatus = statusFilter === 'all' || t.status === statusFilter;
      const matchPriority = priorityFilter === 'all' || t.priority === priorityFilter;
      const matchProject = projectFilter === 'all' || t.projectId === projectFilter;
      const matchAssignee = assigneeFilter === 'all' || t.assignedToId === assigneeFilter;

      return matchSearch && matchStatus && matchPriority && matchProject && matchAssignee;
    }).sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;

      if (sortBy === 'dueDate') {
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      }
      if (sortBy === 'priority') {
        const order = { critical: 5, urgent: 4, high: 3, normal: 2, low: 1 };
        return order[b.priority] - order[a.priority];
      }
      if (sortBy === 'status') {
        return a.status.localeCompare(b.status);
      }
      return b.taskNumber.localeCompare(a.taskNumber);
    });
  }, [visibleTasks, search, statusFilter, priorityFilter, projectFilter, assigneeFilter, sortBy]);

  const handleExport = () => {
    exportTasksToCSV(filteredTasks, allUsers, visibleProjects);
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
            {currentUser.role === 'staff' ? 'Your assigned tasks, deliverables, and checklists.' : 'Department work items, delegations, and quality sign-off queue.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="export-tasks-csv-btn"
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-zinc-800 bg-slate-200/60 dark:bg-zinc-900 text-slate-800 dark:text-zinc-300 hover:bg-slate-300/80 dark:hover:bg-zinc-800 transition cursor-pointer"
          >
            <Download className="w-4 h-4" />
            Export CSV
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
          <option value="all">All Statuses</option>
          <option value="new">New</option>
          <option value="todo">To Do</option>
          <option value="in_progress">In Progress</option>
          <option value="under_review">Under Review</option>
          <option value="completed">Completed</option>
          <option value="on_hold">On Hold</option>
          <option value="closed">Closed</option>
        </select>

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
        {currentUser.role !== 'staff' && (
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
        </div>
      </div>

      {/* Task List Table */}
      <div className="bg-slate-200/60 dark:bg-zinc-900 rounded-xl border border-slate-300 dark:border-zinc-800 overflow-hidden shadow-2xs">
        {filteredTasks.length === 0 ? (
          <div className="py-16 text-center text-slate-500 p-8">
            <CheckSquare className="w-12 h-12 mx-auto mb-3 text-slate-400 dark:text-zinc-700" />
            <p className="text-sm font-semibold text-slate-800 dark:text-zinc-300">No tasks match your criteria</p>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">Try clearing filters or search query.</p>
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
                {filteredTasks.map(t => {
                  const assignee = allUsers.find(u => u.id === t.assignedToId);
                  const project = visibleProjects.find(p => p.id === t.projectId);
                  const isUnderReview = t.status === 'under_review';

                  return (
                    <tr
                      key={t.id}
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
                            <img src={assignee.avatar} alt={assignee.name} className="w-5 h-5 rounded-full object-cover" />
                            <span className="font-medium">{assignee.name}</span>
                          </div>
                        ) : (
                          <span className="text-slate-500 dark:text-zinc-500">Unassigned</span>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Task Drawer */}
      <TaskDetailDrawer />
    </div>
  );
};