import React from 'react';
import { useApp } from '../../context/AppContext';
import { TrendingUp, Clock, DollarSign, AlertTriangle, CheckCircle2 } from 'lucide-react';

export const ProjectAnalyticsCard = ({ projectId }) => {
  const { tasks, projects } = useApp() || {};
  const project = (projects || []).find(p => p.id === projectId);

  if (!project) return null;

  const projectTasks = (tasks || []).filter(t => t.projectId === projectId);
  const totalTasks = projectTasks.length;
  const completedTasks = projectTasks.filter(t => t.status === 'completed' || t.status === 'closed').length;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Budget calculations
  const budgetHours = project.budgetHours || 100;
  const spentHours = project.spentHours || Math.round(budgetHours * (completionRate / 100));
  const isOverBudget = spentHours > budgetHours;
  const budgetPercentage = Math.min(Math.round((spentHours / budgetHours) * 100), 100);

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
          <span className="text-xs text-slate-400">of {budgetHours}h budget</span>
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
          {isOverBudget ? (
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          ) : (
            <TrendingUp className="w-4 h-4 text-indigo-500" />
          )}
        </div>
        <div className="pt-1">
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
            isOverBudget 
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300' 
              : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
          }`}>
            {isOverBudget ? 'Budget Attention Needed' : 'On Track & Healthy'}
          </span>
        </div>
      </div>
    </div>
  );
};