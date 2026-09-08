import React from 'react';
import { useApp } from '../../context/AppContext';
import { Clock, CheckCircle2, UserPlus, FileText, AlertCircle } from 'lucide-react';

export const ProjectActivityLog = ({ projectId }) => {
  const { tasks, tickets, projects, allUsers } = useApp() || {};
  const project = (projects || []).find(p => p.id === projectId);

  if (!project) return null;

  // Compile a dynamic activity stream from project creation, tasks, and attachments
  const activities = [
    {
      id: 'created',
      type: 'project',
      title: `Project "${project.title}" was created`,
      timestamp: project.startDate || 'Recently',
      icon: CheckCircle2,
      color: 'text-indigo-500 bg-indigo-50 dark:bg-indigo-950/50'
    },
    ...(project.attachments || []).map(att => ({
      id: att.id,
      type: 'attachment',
      title: `File "${att.name}" was uploaded by ${att.uploadedByName || 'Team Member'}`,
      timestamp: 'Recent upload',
      icon: FileText,
      color: 'text-blue-500 bg-blue-50 dark:bg-blue-950/50'
    })),
    ...(tasks || []).filter(t => t.projectId === projectId).map(t => ({
      id: t.id,
      type: 'task',
      title: `Task "${t.title}" is currently marked as ${t.status}`,
      timestamp: t.dueDate ? `Due: ${t.dueDate}` : 'Active',
      icon: Clock,
      color: 'text-amber-500 bg-amber-50 dark:bg-amber-950/50'
    }))
  ];

  return (
    <div className="space-y-4">
      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Project Activity Timeline</h4>
      <div className="space-y-3 relative before:absolute before:inset-0 before:left-3 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
        {activities.map((act, index) => {
          const IconComponent = act.icon;
          return (
            <div key={act.id || index} className="flex items-start gap-3 relative pl-1">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center z-10 shrink-0 ${act.color}`}>
                <IconComponent className="w-3 h-3" />
              </span>
              <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-lg p-3 flex-1 text-xs">
                <p className="font-medium text-slate-800 dark:text-slate-200">{act.title}</p>
                <span className="text-[10px] text-slate-400 mt-0.5 block">{act.timestamp}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};