import React from 'react';
import { useAppSelector } from '../../context/AppContext';
import { TrendingUp, Clock, DollarSign, AlertTriangle, CheckCircle2 } from 'lucide-react';

export const ProjectAnalyticsCard = ({ projectId }) => {
  const { tasks, projects, getStatusCategory } = useAppSelector(s => ({ tasks: s.tasks, projects: s.projects, getStatusCategory: s.getStatusCategory }));
  const project = (projects || []).find(p => p.id === projectId);

  if (!project) return null;

  // Task counts: the server's figures (all the project's tasks, even ones
  // this user can't see), else counted from the tasks loaded here. Finished
  // = status category "done"; cancelled / archived don't count. This used to
  // count status "completed"/"closed", which tasks never have — always 0.
  const localTasks = (tasks || []).filter(t => String(t.projectId) === String(projectId) &&
    !['cancelled', 'archived'].includes(getStatusCategory('task', t.status)) && t.status !== 'archived');
  const totalTasks = project.tasksTotal || localTasks.length;
  const completedTasks = project.tasksTotal
    ? project.tasksDone
    : localTasks.filter(t => getStatusCategory('task', t.status) === 'done').length;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : (project.progress || 0);

  // Budget: real figures only. It used to assume a 100 h budget when none was
  // set, and to estimate "spent" from the completion rate.
  const budgetHours = Number(project.budgetHours) || 0;
  const spentHours = Number(project.spentHours) || 0;
  const isOverBudget = budgetHours > 0 && spentHours > budgetHours;
  const budgetPercentage = budgetHours > 0 ? Math.min(Math.round((spentHours / budgetHours) * 100), 100) : 0;
  const budgetLabel = budgetHours > 0
    ? (project.budgetUnit === 'days' && project.budgetValue
        ? `of ${project.budgetValue} day${project.budgetValue === 1 ? '' : 's'} (${budgetHours}h) budget`
        : `of ${budgetHours}h budget`)
    : 'no budget set';
  const isOverdue = !!project.dueDate && completionRate < 100 &&
    new Date(String(project.dueDate).slice(0, 10) + 'T23:59:59') < new Date();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {/* Completion Velocity */}
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Task Velocity</span>
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold text-slate-900 dark:text-white">{completedTasks} / {totalTasks}</span>
          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">({completionRate}%)</span>
        </div>
        <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${completionRate}%` }} />
        </div>
      </div>

      {/* Budget & Time Burn */}
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Time Burn</span>
          <Clock className={`w-4 h-4 ${isOverBudget ? 'text-rose-500' : 'text-indigo-500'}`} />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold text-slate-900 dark:text-white">{spentHours}h</span>
          <span className="text-xs text-slate-400">{budgetLabel}</span>
        </div>
        <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
          <div 
            className={`h-full rounded-full ${isOverBudget ? 'bg-rose-500' : 'bg-indigo-600'}`} 
            style={{ width: `${budgetPercentage}%` }} 
          />
        </div>
      </div>

      {/* Project Status Health */}
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Health Status</span>
          {isOverBudget || isOverdue ? (
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          ) : (
            <TrendingUp className="w-4 h-4 text-indigo-500" />
          )}
        </div>
        <div className="pt-1">
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
            isOverBudget || isOverdue
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300' 
              : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
          }`}>
            {isOverBudget ? 'Budget Attention Needed' : isOverdue ? 'Past Due Date' : completionRate === 100 && totalTasks > 0 ? 'All Tasks Done' : 'On Track & Healthy'}
          </span>
        </div>
      </div>
    </div>
  );
};