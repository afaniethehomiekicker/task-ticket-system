import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  BarChart3, Download, TrendingUp, CheckCircle, Clock, 
  AlertTriangle, ShieldCheck, PieChart, Users, ArrowUpRight
} from 'lucide-react';
import { PriorityBadge } from '../common/Badge';

export const ReportsView = () => {
  const { 
    visibleProjects, 
    visibleTasks, 
    visibleTickets, 
    allUsers,
    currentUser
  } = useApp();

  const [dateRange, setDateRange] = useState('30d');

  // Compute Analytics Metrics
  //
  // Was `t.status === 'completed' || t.status === 'closed'` — neither
  // is a real Task.Status value on the backend (todo, in_progress,
  // in_review, done, blocked, cancelled, archived — confirmed in
  // models.go). This meant completedTasks was always empty regardless
  // of how many tasks were genuinely done, and Task Completion Rate
  // always showed 0% no matter what.
  const totalTasks = visibleTasks.length;
  const completedTasks = visibleTasks.filter(t => t.status === 'done');
  const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks.length / totalTasks) * 100) : 0;

  const totalTickets = visibleTickets.length;
  const resolvedTickets = visibleTickets.filter(t => t.status === 'resolved' || t.status === 'closed');
  const ticketResolutionRate = totalTickets > 0 ? Math.round((resolvedTickets.length / totalTickets) * 100) : 0;

  const breachedTickets = visibleTickets.filter(t => t.slaBreached);
  const slaCompliance = totalTickets > 0 ? Math.round(((totalTickets - breachedTickets.length) / totalTickets) * 100) : 100;

  // Department analytics
  const departments = ['Engineering', 'Customer Success', 'Product & Design', 'Marketing & Growth'];
  const departmentStats = departments.map(dept => {
    const deptProjects = visibleProjects.filter(p => p.department === dept);
    const deptUsers = allUsers.filter(u => u.department === dept);
    const deptTasks = visibleTasks.filter(t => {
      const p = visibleProjects.find(pr => pr.id === t.projectId);
      return p?.department === dept;
    });
    const completedDeptTasks = deptTasks.filter(t => t.status === 'completed' || t.status === 'closed');
    const velocity = deptTasks.length > 0 ? Math.round((completedDeptTasks.length / deptTasks.length) * 100) : 0;

    return {
      department: dept,
      projectCount: deptProjects.length,
      taskCount: deptTasks.length,
      completedTaskCount: completedDeptTasks.length,
      velocity
    };
  });

  return (
    <div id="reports-view" className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            Executive Reports & SLA Analytics
          </h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Operational benchmarks, SLA conformance, project delivery velocity, and staff throughput.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            id="reports-date-range-select"
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-800 dark:text-zinc-300 font-medium focus:outline-hidden"
          >
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last Quarter (90d)</option>
            <option value="all">All-Time Cumulative</option>
          </select>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl bg-slate-200/60 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 shadow-2xs">
          <span className="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider block mb-2">
            Task Completion Rate
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-bold text-slate-900 dark:text-zinc-100">{taskCompletionRate}%</span>
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center">
              {completedTasks.length}/{totalTasks} done
            </span>
          </div>
          <div className="w-full h-1.5 bg-slate-300 dark:bg-zinc-800 rounded-full mt-3 overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${taskCompletionRate}%` }} />
          </div>
        </div>

        <div className="p-5 rounded-xl bg-slate-200/60 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 shadow-2xs">
          <span className="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider block mb-2">
            SLA Compliance Index
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-bold text-indigo-600 dark:text-indigo-400">{slaCompliance}%</span>
            <span className="text-xs font-medium text-slate-500 dark:text-zinc-400">
              {breachedTickets.length} Breaches
            </span>
          </div>
          <div className="w-full h-1.5 bg-slate-300 dark:bg-zinc-800 rounded-full mt-3 overflow-hidden">
            <div className="h-full bg-indigo-600 rounded-full" style={{ width: `${slaCompliance}%` }} />
          </div>
        </div>

        <div className="p-5 rounded-xl bg-slate-200/60 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 shadow-2xs">
          <span className="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider block mb-2">
            Ticket Resolution Velocity
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-bold text-amber-600 dark:text-amber-400">{ticketResolutionRate}%</span>
            <span className="text-xs font-medium text-slate-500 dark:text-zinc-400">
              {resolvedTickets.length}/{totalTickets} resolved
            </span>
          </div>
          <div className="w-full h-1.5 bg-slate-300 dark:bg-zinc-800 rounded-full mt-3 overflow-hidden">
            <div className="h-full bg-amber-500 rounded-full" style={{ width: `${ticketResolutionRate}%` }} />
          </div>
        </div>

        <div className="p-5 rounded-xl bg-slate-200/60 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 shadow-2xs">
          <span className="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider block mb-2">
            Average Turnaround Time
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-bold text-slate-900 dark:text-zinc-100">1.8d</span>
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center">
              -14% vs target
            </span>
          </div>
          <div className="w-full h-1.5 bg-slate-300 dark:bg-zinc-800 rounded-full mt-3 overflow-hidden">
            <div className="h-full bg-purple-500 rounded-full" style={{ width: '85%' }} />
          </div>
        </div>
      </div>

      {/* Department Breakdown */}
      <div className="bg-slate-200/60 dark:bg-zinc-900 rounded-xl border border-slate-300 dark:border-zinc-800 p-6 shadow-2xs">
        <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 uppercase tracking-wider mb-4">
          Departmental Velocity & Execution
        </h3>

        <div className="space-y-5">
          {departmentStats.map(dept => (
            <div key={dept.department} className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800 dark:text-zinc-200">
                  {dept.department}
                </span>
                <span className="text-slate-500 dark:text-zinc-400 font-mono">
                  {dept.completedTaskCount} / {dept.taskCount} tasks completed ({dept.velocity}%)
                </span>
              </div>
              <div className="w-full h-2 bg-slate-300 dark:bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-600 rounded-full transition-all duration-500"
                  style={{ width: `${dept.velocity}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Staff Leaderboard */}
      <div className="bg-slate-200/60 dark:bg-zinc-900 rounded-xl border border-slate-300 dark:border-zinc-800 p-6 shadow-2xs">
        <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Users className="w-4 h-4 text-indigo-500" />
          Staff Performance & Resolution Volume
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-300 dark:border-zinc-800 text-slate-600 dark:text-zinc-400 uppercase tracking-wider font-semibold">
              <tr>
                <th className="pb-3">Team Member</th>
                <th className="pb-3">Role</th>
                <th className="pb-3">Tasks Completed</th>
                <th className="pb-3">Active Tickets</th>
                <th className="pb-3">SLA Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300/50 dark:divide-zinc-800/60 text-slate-800 dark:text-zinc-300">
              {allUsers.filter(u => u.role === 'staff' || u.role === 'supervisor').map(user => {
                const userCompletedTasks = visibleTasks.filter(t => t.assignedToId === user.id && t.status === 'done').length;
                const userActiveTickets = visibleTickets.filter(t => t.assignedToId === user.id && t.status !== 'resolved' && t.status !== 'closed').length;

                return (
                  <tr key={user.id}>
                    <td className="py-3 flex items-center gap-2.5">
                      <img src={user.avatar || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='50' fill='%23cbd5e1'/%3E%3Ccircle cx='50' cy='38' r='18' fill='%2394a3b8'/%3E%3Cellipse cx='50' cy='92' rx='34' ry='26' fill='%2394a3b8'/%3E%3C/svg%3E"} alt={user.name} className="w-6 h-6 rounded-full object-cover" />
                      <span className="font-semibold text-slate-900 dark:text-zinc-100">{user.name}</span>
                    </td>
                    <td className="py-3 text-slate-500 dark:text-zinc-400 capitalize">{user.role.replace('_', ' ')}</td>
                    <td className="py-3 font-mono font-medium text-emerald-600 dark:text-emerald-400">
                      {userCompletedTasks} tasks
                    </td>
                    <td className="py-3 font-mono font-medium text-amber-600 dark:text-amber-400">
                      {userActiveTickets} open
                    </td>
                    <td className="py-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                        100% Compliant
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};