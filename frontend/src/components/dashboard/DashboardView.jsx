import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  FolderKanban, CheckSquare, LifeBuoy, ShieldCheck, 
  TrendingUp, Clock, Plus, Flame, ChevronRight, FileSearch, Pin, UserCheck
} from 'lucide-react';
import { RoleBadge, PriorityBadge, TaskStatusBadge } from '../common/Badge';
import { isStaffRole } from '../../utils/permissions';

export const DashboardView = () => {
  const { 
    currentUser, 
    visibleProjects, 
    visibleTasks, 
    visibleTickets, 
    allUsers, 
    auditLogs,
    setActiveTab,
    setSelectedTaskId,
    setQuickCreateOpen, getStatusCategory,
    setTaskListPreset,
    getStatuses,
    setListPreset,
    visibleFeasibilities,
    setSelectedTicketId,
    setSelectedProjectDetailId,
    setSelectedFeasibilityId
  } = useApp();
  const [showPinned, setShowPinned] = useState(false);

  if (!currentUser) return null;

  // Metric Computations
  const totalProjects = visibleProjects.length;
  // Every task-status comparison below was checking values that don't
  // exist on the backend's real Task.Status enum (todo, in_progress,
  // in_review, done, blocked, cancelled, archived — confirmed directly
  // in models.go). 'completed'/'closed'/'under_review' are Ticket
  // statuses, not Task ones, and Tasks never actually have them — so
  // these comparisons were silently no-ops: activeTasks counted every
  // task including done/cancelled/archived ones, and pendingReviewTasks
  // was always empty regardless of how many tasks were genuinely
  // awaiting review.
  // By status category (configurable catalog), so renamed / added statuses
  // count correctly — e.g. "Waiting for Client" or "Reopened" tickets.
  const isFinished = (entity, st) => ['done', 'cancelled', 'archived'].includes(getStatusCategory(entity, st));
  const activeTasks = visibleTasks.filter(t => !isFinished('task', t.status));
  const criticalTasks = visibleTasks.filter(t => (t.priority === 'critical' || t.priority === 'urgent') && !isFinished('task', t.status));
  const pendingReviewTasks = visibleTasks.filter(t => getStatusCategory('task', t.status) === 'review');
  const openTickets = visibleTickets.filter(t => !isFinished('ticket', t.status));
  // Staff now also see their department's tickets (read-only), so "Open
  // Tickets" is the department's; this is just the open ones that are theirs.
  const isStaff = isStaffRole(currentUser.role);
  const assignedTickets = openTickets.filter(t => String(t.assignedToId) === String(currentUser.id));
  // Was `t.status === 'escalated' || t.escalationLevel !== 'none'` —
  // "escalated" isn't a real Ticket.Status value, and escalation isn't
  // an implemented feature on this backend at all (no EscalationLevel
  // field exists, no /escalate route exists — flagged earlier as an
  // open decision, not resolved yet). t.escalationLevel was therefore
  // always undefined, and undefined !== 'none' is always true — meaning
  // this matched EVERY ticket, unconditionally, showing "all tickets
  // escalated" on the dashboard regardless of reality. Left empty
  // rather than inventing a stand-in metric; this re-activates
  // correctly once the escalation feature decision is made.
  const escalatedTickets = [];

  // Slide 28 cards.
  const today = new Date().toISOString().slice(0, 10);
  const criticalTickets = openTickets.filter(t => t.priority === 'critical');
  const overdueTasks = activeTasks.filter(t => t.dueDate && String(t.dueDate).slice(0, 10) < today);
  const runningProjects = visibleProjects.filter(p => p.status === 'active');
  const pendingFeasibilities = (visibleFeasibilities || []).filter(f => ['draft', 'in_progress'].includes(f.status));
  const pinnedItems = [
    ...visibleProjects.filter(p => p.isPinned).map(p => ({ kind: 'project', id: p.id, ref: p.code, title: p.title, open: () => setSelectedProjectDetailId(p.id) })),
    ...visibleTasks.filter(t => t.isPinned).map(t => ({ kind: 'task', id: t.id, ref: t.taskNumber, title: t.title, open: () => setSelectedTaskId(t.id) })),
    ...visibleTickets.filter(t => t.isPinned).map(t => ({ kind: 'ticket', id: t.id, ref: t.ticketNumber, title: t.title, open: () => setSelectedTicketId(t.id) })),
    ...(visibleFeasibilities || []).filter(f => f.isPinned).map(f => ({ kind: 'feasibility', id: f.id, ref: f.feasibilityNumber, title: [f.product, f.capacity].filter(Boolean).join(' · '), open: () => setSelectedFeasibilityId(f.id) })),
  ];

  return (
    <div id="dashboard-view" className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Welcome Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-gradient-to-r from-zinc-950 to-indigo-950 text-white p-6 rounded-2xl shadow-sm border border-zinc-800">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <RoleBadge role={currentUser.role} size="sm" />
            <span className="text-xs text-indigo-300 font-mono tracking-wide">
              {currentUser.department} Department
            </span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-white">
            Welcome back, {currentUser.name}
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <button
            id="dashboard-quick-create-btn"
            onClick={() => setQuickCreateOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl shadow-md shadow-indigo-600/30 transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Create Work Item
          </button>
        </div>
      </div>

      {/* KPI cards — spec slide 28. Every card opens the exact filtered list
          behind its number ("single-click drill-down"). */}
      <div className={`grid grid-cols-2 sm:grid-cols-3 gap-3 ${isStaff ? 'lg:grid-cols-4 xl:grid-cols-8' : 'lg:grid-cols-7'}`}>
        {[
          { id: 'open-tickets', label: 'Open Tickets', value: openTickets.length, icon: LifeBuoy, tone: 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950',
            go: () => { setListPreset({ tab: 'tickets', status: 'open', priority: 'all', assignee: 'all' }); setActiveTab('tickets'); } },
          // Staff accounts only: open tickets assigned to them.
          ...(isStaff ? [{ id: 'assigned-tickets', label: 'Assigned Tickets', value: assignedTickets.length, icon: UserCheck, tone: 'text-teal-600 dark:text-teal-400 bg-teal-100 dark:bg-teal-950',
            go: () => { setListPreset({ tab: 'tickets', status: 'open', priority: 'all', assignee: String(currentUser.id) }); setActiveTab('tickets'); } }] : []),
          { id: 'critical-tickets', label: 'Critical Tickets', value: criticalTickets.length, icon: Flame, tone: 'text-rose-600 dark:text-rose-400 bg-rose-100 dark:bg-rose-950',
            go: () => { setListPreset({ tab: 'tickets', status: 'open', priority: 'critical', assignee: 'all' }); setActiveTab('tickets'); } },
          { id: 'overdue-tasks', label: 'Overdue Tasks', value: overdueTasks.length, icon: Clock, tone: 'text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-950',
            go: () => { setListPreset({ tab: 'tasks', status: 'overdue', priority: 'all' }); setActiveTab('tasks'); } },
          { id: 'running-projects', label: 'Running Projects', value: runningProjects.length, icon: FolderKanban, tone: 'text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-950',
            go: () => { setListPreset({ tab: 'projects', status: 'active' }); setActiveTab('projects'); } },
          { id: 'pending-feas', label: 'Pending Feasibilities', value: pendingFeasibilities.length, icon: FileSearch, tone: 'text-sky-600 dark:text-sky-400 bg-sky-100 dark:bg-sky-950',
            go: () => { setListPreset({ tab: 'feasibilities', status: 'pending' }); setActiveTab('feasibilities'); } },
          { id: 'pinned', label: 'Pinned Items', value: pinnedItems.length, icon: Pin, tone: 'text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-950',
            go: () => setShowPinned(v => !v), active: showPinned },
          { id: 'reviews', label: 'Reviews Pending', value: pendingReviewTasks.length, icon: ShieldCheck, tone: 'text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-950',
            go: () => {
              const reviewKey = (getStatuses('task').find(st => st.category === 'review') || {}).key || 'in_review';
              setListPreset({ tab: 'tasks', status: reviewKey, priority: 'all' });
              setActiveTab('tasks');
            } },
        ].map(card => (
          <button
            key={card.id}
            id={`kpi-${card.id}`}
            type="button"
            onClick={card.go}
            className={`p-4 rounded-xl text-left cursor-pointer transition border ${card.active
              ? 'bg-yellow-50 dark:bg-yellow-950/20 border-yellow-400 dark:border-yellow-700'
              : 'bg-slate-200/60 dark:bg-zinc-900 border-slate-300 dark:border-zinc-800 hover:border-indigo-400 dark:hover:border-indigo-500'}`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold text-slate-600 dark:text-zinc-400 uppercase tracking-wider leading-tight">{card.label}</span>
              <span className={`p-1.5 rounded-lg ${card.tone}`}><card.icon className="w-4 h-4" /></span>
            </div>
            <span className="text-2xl font-bold text-slate-900 dark:text-zinc-100">{card.value}</span>
          </button>
        ))}
      </div>

      {/* Pinned items (per person) — opened from the Pinned Items card. */}
      {showPinned && (
        <div className="p-4 rounded-xl bg-yellow-50/60 dark:bg-yellow-950/10 border border-yellow-300 dark:border-yellow-900">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-zinc-300 mb-2 flex items-center gap-1.5">
            <Pin className="w-4 h-4 text-yellow-600" /> Your pinned items ({pinnedItems.length})
          </h3>
          {pinnedItems.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-zinc-400">Nothing pinned yet — use the pin icon on any project, task, ticket or feasibility.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {pinnedItems.map(item => (
                <button key={`${item.kind}-${item.id}`} type="button" onClick={item.open}
                  className="flex items-center gap-2 p-2 rounded-lg bg-white/70 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 hover:border-indigo-400 text-left text-xs cursor-pointer">
                  <span className="font-mono text-[10px] text-indigo-600 dark:text-indigo-400">{item.ref}</span>
                  <span className="font-semibold text-slate-900 dark:text-zinc-100 truncate">{item.title}</span>
                  <span className="ml-auto text-[10px] uppercase text-slate-500">{item.kind}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-slate-200/60 dark:bg-zinc-900 rounded-xl border border-slate-300 dark:border-zinc-800 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-rose-500" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 uppercase tracking-wider">Critical & In-Progress Tasks</h3>
              </div>
              <button onClick={() => setActiveTab('tasks')} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-medium flex items-center cursor-pointer">
                View all ({visibleTasks.length}) <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
              </button>
            </div>

            <div className="space-y-2.5">
              {activeTasks.length === 0 ? (
                <div className="py-8 text-center text-slate-500 dark:text-zinc-500 text-xs">No active tasks found in your queue. Click 'Create Work Item' to add one.</div>
              ) : (
                activeTasks.map(task => (
                  <div
                    key={task.id}
                    onClick={() => setSelectedTaskId(task.id)}
                    className="p-3.5 rounded-lg border border-slate-300 dark:border-zinc-800 hover:border-indigo-400 dark:hover:border-indigo-500 bg-slate-100 dark:bg-zinc-800/40 cursor-pointer transition flex items-center justify-between gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-xs font-semibold text-indigo-600 dark:text-indigo-400">{task.taskNumber}</span>
                        <span className="text-xs font-semibold text-slate-900 dark:text-zinc-100 truncate">{task.title}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-zinc-400">
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3 text-slate-400 dark:text-zinc-500" /> Due {task.dueDate}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <PriorityBadge priority={task.priority} />
                      <TaskStatusBadge status={task.status} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Activity Logs */}
        <div className="space-y-6">
          <div className="bg-slate-200/60 dark:bg-zinc-900 rounded-xl border border-slate-300 dark:border-zinc-800 p-5">
            <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 uppercase tracking-wider mb-4">Recent Activity</h3>
            <div className="space-y-3">
              {auditLogs.slice(0, 6).map(log => (
                <div key={log.id} className="text-xs flex items-start gap-2.5 pb-2.5 border-b border-slate-300/60 dark:border-zinc-800 last:border-0">
                  <div className="w-2 h-2 rounded-full bg-indigo-500 mt-1.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-800 dark:text-zinc-200 leading-snug">
                      <span className="font-semibold">{log.actorName}</span> <span className="text-slate-500 dark:text-zinc-400">{log.details}</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};