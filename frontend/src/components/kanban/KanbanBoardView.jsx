import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Columns3, Plus, Search, Clock, CheckSquare } from 'lucide-react';
import { PriorityBadge } from '../common/Badge';
import { canCreateTask } from '../../utils/permissions';
import { TaskDetailDrawer } from '../tasks/TaskDetailDrawer';

export const KanbanBoardView = () => {
  const { 
    visibleTasks = [], 
    visibleProjects = [], 
    allUsers = [], 
    currentUser, 
    updateTaskStatus, 
    setSelectedTaskId, 
    setQuickCreateOpen 
  } = useApp();

  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [draggingTaskId, setDraggingTaskId] = useState(null);

  const columns = [
    { id: 'new', title: 'New', color: 'border-slate-400 dark:border-zinc-700', dot: 'bg-slate-400' },
    { id: 'todo', title: 'To Do', color: 'border-blue-400 dark:border-blue-700', dot: 'bg-blue-500' },
    { id: 'in_progress', title: 'In Progress', color: 'border-indigo-400 dark:border-indigo-700', dot: 'bg-indigo-500' },
    { id: 'on_hold', title: 'On Hold', color: 'border-amber-400 dark:border-amber-700', dot: 'bg-amber-500' },
    { id: 'under_review', title: 'Under Review', color: 'border-purple-400 dark:border-purple-700', dot: 'bg-purple-500' },
    { id: 'completed', title: 'Completed', color: 'border-emerald-400 dark:border-emerald-700', dot: 'bg-emerald-500' },
    { id: 'closed', title: 'Closed', color: 'border-zinc-400 dark:border-zinc-700', dot: 'bg-zinc-500' },
  ];

  const filteredTasks = useMemo(() => {
    const query = (search || '').toLowerCase().trim();
    return (visibleTasks || []).filter(t => {
      if (!t) return false;

      const titleStr = (t.title || '').toLowerCase();
      const taskNumStr = (t.taskNumber || '').toLowerCase();
      const labelsArr = Array.isArray(t.labels) ? t.labels : [];

      const matchSearch = !query || 
        titleStr.includes(query) || 
        taskNumStr.includes(query) || 
        labelsArr.some(l => (l || '').toLowerCase().includes(query));

      const matchProj = projectFilter === 'all' || String(t.projectId) === String(projectFilter);
      const matchPriority = priorityFilter === 'all' || t.priority === priorityFilter;
      const matchAssignee = assigneeFilter === 'all' || String(t.assignedToId) === String(assigneeFilter);

      return matchSearch && matchProj && matchPriority && matchAssignee;
    });
  }, [visibleTasks, search, projectFilter, priorityFilter, assigneeFilter]);

  const handleDragStart = (e, taskId) => {
    e.dataTransfer.setData('text/plain', String(taskId));
    setDraggingTaskId(taskId);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e, targetStatus) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/plain') || draggingTaskId;
    if (taskId) {
      updateTaskStatus(taskId, targetStatus);
    }
    setDraggingTaskId(null);
  };

  return (
    <div id="kanban-board-view" className="space-y-5 h-full flex flex-col pb-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <Columns3 className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            Kanban Board
          </h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Real-time pipeline with stage transitions, WIP visibility, and review states.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canCreateTask(currentUser) && (
            <button
              id="kanban-create-task-btn"
              onClick={() => setQuickCreateOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              New Task
            </button>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2.5 p-3 rounded-xl bg-slate-200/70 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 shrink-0 text-xs">
        {/* Search */}
        <div className="relative min-w-[180px] max-w-xs flex-1">
          <Search className="w-4 h-4 absolute left-3 top-2 text-slate-500 dark:text-zinc-400" />
          <input
            id="kanban-search-input"
            type="text"
            placeholder="Search cards or #labels..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
          />
        </div>

        {/* Project */}
        <select
          id="kanban-project-filter"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-800 dark:text-zinc-300 focus:outline-hidden"
        >
          <option value="all">All Projects</option>
          {(visibleProjects || []).map(p => (
            <option key={p.id} value={p.id}>
              {p.code || p.title}
            </option>
          ))}
        </select>

        {/* Priority */}
        <select
          id="kanban-priority-filter"
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

        {/* Assignee */}
        {currentUser?.role !== 'staff' && (
          <select
            id="kanban-assignee-filter"
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-800 dark:text-zinc-300 focus:outline-hidden"
          >
            <option value="all">All Assignees</option>
            {(allUsers || []).map(u => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Kanban Columns */}
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden pb-4">
        <div className="flex gap-4 h-full min-w-[1250px]">
          {columns.map(col => {
            const columnTasks = filteredTasks.filter(t => t.status === col.id);

            return (
              <div
                key={col.id}
                id={`kanban-column-${col.id}`}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, col.id)}
                className="w-72 shrink-0 flex flex-col bg-slate-200/80 dark:bg-zinc-950/60 rounded-xl border border-slate-300 dark:border-zinc-800 overflow-hidden"
              >
                {/* Column Header */}
                <div className={`px-3.5 py-2.5 border-t-4 ${col.color} bg-slate-200 dark:bg-zinc-900 flex items-center justify-between border-b border-slate-300 dark:border-zinc-800`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                    <span className="text-xs font-bold text-slate-800 dark:text-zinc-200 uppercase tracking-wider">
                      {col.title}
                    </span>
                  </div>
                  <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-slate-300/60 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300">
                    {columnTasks.length}
                  </span>
                </div>

                {/* Column Cards Drop Area */}
                <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
                  {columnTasks.length === 0 ? (
                    <div className="h-24 flex items-center justify-center border-2 border-dashed border-slate-300 dark:border-zinc-800 rounded-lg text-slate-500 dark:text-zinc-500 text-[11px]">
                      Drop task here
                    </div>
                  ) : (
                    columnTasks.map(task => {
                      const assignee = (allUsers || []).find(u => String(u.id) === String(task.assignedToId));
                      const taskChecklists = task.checklists || [];
                      const taskLabels = task.labels || [];
                      const completedChecklists = taskChecklists.filter(c => c && c.completed).length;

                      return (
                        <div
                          key={task.id}
                          id={`kanban-card-${task.id}`}
                          draggable
                          onDragStart={(e) => handleDragStart(e, task.id)}
                          onClick={() => setSelectedTaskId(task.id)}
                          className="p-3.5 rounded-xl bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 shadow-2xs hover:shadow-md hover:border-indigo-400 dark:hover:border-indigo-500 cursor-grab active:cursor-grabbing transition group select-none"
                        >
                          <div className="flex items-center justify-between gap-1 mb-2">
                            <span className="font-mono text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
                              {task.taskNumber || task.id}
                            </span>
                            <PriorityBadge priority={task.priority} />
                          </div>

                          <h4 className="text-xs font-semibold text-slate-900 dark:text-zinc-100 line-clamp-2 mb-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition">
                            {task.title || 'Untitled Task'}
                          </h4>

                          {taskLabels.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-3">
                              {taskLabels.slice(0, 2).map(label => (
                                <span
                                  key={label}
                                  className="text-[9px] px-1.5 py-0.5 rounded bg-slate-300/60 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 font-medium"
                                >
                                  {label}
                                </span>
                              ))}
                            </div>
                          )}

                          {taskChecklists.length > 0 && (
                            <div className="w-full h-1 bg-slate-300 dark:bg-zinc-800 rounded-full overflow-hidden mb-3">
                              <div
                                className="h-full bg-indigo-500 rounded-full"
                                style={{ width: `${task.progress || 0}%` }}
                              />
                            </div>
                          )}

                          <div className="pt-2 border-t border-slate-300/60 dark:border-zinc-800/80 flex items-center justify-between text-[11px] text-slate-500 dark:text-zinc-400">
                            <div className="flex items-center gap-2">
                              <span className="flex items-center gap-1" title="Due Date">
                                
{task?.dueDate ? String(task.dueDate).substring(5) : '--/--'}
                              </span>
                              {taskChecklists.length > 0 && (
                                <span className="flex items-center gap-1" title="Checklists">
                                  <CheckSquare className="w-3 h-3" /> {completedChecklists}/{taskChecklists.length}
                                </span>
                              )}
                            </div>

                            {assignee?.avatar && (
                              <img
                                src={assignee.avatar}
                                alt={assignee.name}
                                title={assignee.name}
                                className="w-5 h-5 rounded-full object-cover ring-1 ring-slate-300 dark:ring-zinc-700"
                              />
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <TaskDetailDrawer />
    </div>
  );
};