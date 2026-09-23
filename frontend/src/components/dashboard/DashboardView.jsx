import React from 'react';
import { useApp } from '../../context/AppContext';
import { 
  FolderKanban, CheckSquare, LifeBuoy, ShieldCheck, 
  TrendingUp, Clock, Plus, Flame, ChevronRight
} from 'lucide-react';
import { RoleBadge, PriorityBadge, TaskStatusBadge } from '../common/Badge';

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
    setQuickCreateOpen
  } = useApp();

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
  const activeTasks = visibleTasks.filter(t => !['done', 'cancelled', 'archived'].includes(t.status));
  const criticalTasks = visibleTasks.filter(t => (t.priority === 'critical' || t.priority === 'urgent') && !['done', 'cancelled', 'archived'].includes(t.status));
  const pendingReviewTasks = visibleTasks.filter(t => t.status === 'in_review');
  const openTickets = visibleTickets.filter(t => t.status !== 'resolved' && t.status !== 'closed');
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

      {/* KPI Cards Grid — Clicking navigates to views */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
       <div
          onClick={() => setActiveTab('projects')}
          className="p-5 rounded-xl bg-slate-200/60 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 cursor-pointer transition hover:border-indigo-400 dark:hover:border-indigo-500"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-600 dark:text-zinc-400 uppercase tracking-wider">Total Projects</span>
            <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400"><FolderKanban className="w-5 h-5" /></div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold text-slate-900 dark:text-zinc-100">{totalProjects}</span>
            <span className="text-xs text-slate-500 dark:text-zinc-400">Visible to you</span>
          </div>
        </div>

        <div 
          onClick={() => setActiveTab('tasks')} 
          className="p-5 rounded-xl bg-slate-200/60 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 cursor-pointer transition hover:border-indigo-400 dark:hover:border-indigo-500"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-600 dark:text-zinc-400 uppercase tracking-wider">Pending Tasks</span>
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400"><CheckSquare className="w-5 h-5" /></div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold text-slate-900 dark:text-zinc-100">{activeTasks.length}</span>
            <span className="text-xs text-slate-500 dark:text-zinc-400">{criticalTasks.length > 0 ? `${criticalTasks.length} urgent` : 'Normal priority'}</span>
          </div>
        </div>

        <div 
          onClick={() => setActiveTab('tickets')} 
          className="p-5 rounded-xl bg-slate-200/60 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 cursor-pointer transition hover:border-indigo-400 dark:hover:border-indigo-500"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-600 dark:text-zinc-400 uppercase tracking-wider">Open Tickets</span>
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400"><LifeBuoy className="w-5 h-5" /></div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold text-slate-900 dark:text-zinc-100">{openTickets.length}</span>
            <span className={`text-xs font-medium ${escalatedTickets.length > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-zinc-400'}`}>
              {escalatedTickets.length > 0 ? `${escalatedTickets.length} Escalated` : '98% SLA Met'}
            </span>
          </div>
        </div>

        <div 
          onClick={() => setActiveTab('reports')} 
          className="p-5 rounded-xl bg-slate-200/60 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 cursor-pointer transition hover:border-indigo-400 dark:hover:border-indigo-500"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-600 dark:text-zinc-400 uppercase tracking-wider">Reviews Pending</span>
            <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-400"><ShieldCheck className="w-5 h-5" /></div>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold text-slate-900 dark:text-zinc-100">{pendingReviewTasks.length}</span>
            <span className="text-xs text-purple-600 dark:text-purple-400 font-medium">Awaiting Sign-off</span>
          </div>
        </div>
      </div>

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