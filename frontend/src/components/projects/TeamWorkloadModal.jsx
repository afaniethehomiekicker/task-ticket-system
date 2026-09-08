import React from 'react';
import { useApp } from '../../context/AppContext';

export const TeamWorkloadModal = ({ isOpen, onClose, memberId, projectId }) => {
  const { allUsers, tasks, projects } = useApp() || {};

  if (!isOpen || !memberId) return null;

  const member = allUsers.find(u => u.id === memberId);
  
  const memberTasks = (tasks || []).filter(t => t.assignedToId === memberId);

  const completedCount = memberTasks.filter(t => t.status === 'completed' || t.status === 'closed').length;
  const activeCount = memberTasks.length - completedCount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-slate-200 dark:bg-zinc-950 rounded-xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-300 dark:border-zinc-800 p-6">
        <div className="flex justify-between items-center mb-4 border-b border-slate-300 dark:border-zinc-800 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">{member?.name || 'Team Member'} Workload</h3>
            <p className="text-xs text-slate-500 dark:text-zinc-400 capitalize">{member?.role} — {member?.department || 'General'}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 text-sm font-bold transition cursor-pointer">✕</button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="bg-slate-100 dark:bg-zinc-900 p-3 rounded-lg border border-slate-300 dark:border-zinc-800 text-center">
            <span className="block text-xl font-bold text-indigo-600 dark:text-indigo-400">{activeCount}</span>
            <span className="text-[11px] text-slate-500 dark:text-zinc-400 uppercase tracking-wider font-medium">Active Tasks</span>
          </div>
          <div className="bg-slate-100 dark:bg-zinc-900 p-3 rounded-lg border border-slate-300 dark:border-zinc-800 text-center">
            <span className="block text-xl font-bold text-emerald-600 dark:text-emerald-400">{completedCount}</span>
            <span className="text-[11px] text-slate-500 dark:text-zinc-400 uppercase tracking-wider font-medium">Completed</span>
          </div>
        </div>

        <h4 className="text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-2">Assigned Items</h4>
        <div className="max-h-60 overflow-y-auto space-y-2">
          {memberTasks.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-zinc-500 text-center py-4">No tasks assigned.</p>
          ) : (
            memberTasks.map(task => {
              const taskProject = projects?.find(p => p.id === task.projectId);
              return (
                <div key={task.id} className="p-2.5 rounded-lg border border-slate-300 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900/60 text-xs flex justify-between items-center">
                  <div>
                    <span className="font-medium text-slate-900 dark:text-zinc-200">{task.taskNumber || 'TSK'}: {task.title}</span>
                    <span className="block text-[10px] text-slate-500 dark:text-zinc-400 mt-0.5">
                      {taskProject ? `Project: ${taskProject.title}` : 'General Task'} • Priority: {task.priority}
                    </span>
                  </div>
                  <span className={`px-2 py-0.5 text-[10px] rounded-full font-medium shrink-0 ml-2 ${
                    task.status === 'completed' || task.status === 'closed' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                  }`}>
                    {task.status}
                  </span>
                </div>
              );
            })
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold bg-slate-300/60 hover:bg-slate-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-800 dark:text-zinc-200 rounded-lg cursor-pointer">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};