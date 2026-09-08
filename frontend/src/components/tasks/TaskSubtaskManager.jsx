import React, { useState } from 'react';
import { CheckCircle2, Circle, Plus, Trash2, Pin, GitPullRequest, Code, FileText } from 'lucide-react';

const SUBTASK_TYPES = [
  { id: 'flowchart', label: 'Flow Chart Design', icon: GitPullRequest },
  { id: 'development', label: 'Development', icon: Code },
  { id: 'documentation', label: 'Documentation', icon: FileText }
];

export const TaskSubtaskManager = ({ task, onUpdateTask }) => {
  const [newSubTitle, setNewSubTitle] = useState('');
  const [selectedType, setSelectedType] = useState('flowchart');

  const subtasks = task.subtasks || [];

  const handleToggleSubtask = (subId) => {
    const updated = subtasks.map(s => s.id === subId ? { ...s, completed: !s.completed } : s);
    onUpdateTask(task.id, { subtasks: updated });
  };

  const handleAddSubtask = (e) => {
    e.preventDefault();
    if (!newSubTitle.trim()) return;
    const newSub = {
      id: `sub-${Date.now()}`,
      title: newSubTitle.trim(),
      type: selectedType,
      completed: false
    };
    onUpdateTask(task.id, { subtasks: [...subtasks, newSub] });
    setNewSubTitle('');
  };

  const handleDeleteSubtask = (subId) => {
    const updated = subtasks.filter(s => s.id !== subId);
    onUpdateTask(task.id, { subtasks: updated });
  };

  const handleTogglePin = () => {
    onUpdateTask(task.id, { isPinned: !task.isPinned });
  };

  return (
    <div className="space-y-4">
      {/* Task Pinning Header */}
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Sub-Tasks & Flow Breakdown</span>
        <button
          onClick={handleTogglePin}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition ${
            task.isPinned ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
          }`}
        >
          <Pin className={`w-3.5 h-3.5 ${task.isPinned ? 'fill-current' : ''}`} />
          {task.isPinned ? 'Pinned Task' : 'Pin Task'}
        </button>
      </div>

      {/* Add Subtask Form */}
      <form onSubmit={handleAddSubtask} className="space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Add sub-task objective..."
            value={newSubTitle}
            onChange={(e) => setNewSubTitle(e.target.value)}
            className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-hidden"
          />
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="px-2.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-hidden"
          >
            {SUBTASK_TYPES.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!newSubTitle.trim()}
            className="flex items-center gap-1 px-3 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
      </form>

      {/* Subtasks List */}
      <div className="space-y-2">
        {subtasks.length === 0 ? (
          <div className="py-6 text-center text-slate-400 text-xs">No sub-tasks defined.</div>
        ) : (
          subtasks.map(sub => {
            const typeConfig = SUBTASK_TYPES.find(t => t.id === sub.type) || SUBTASK_TYPES[0];
            const TypeIcon = typeConfig.icon;
            return (
              <div 
                key={sub.id} 
                className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between gap-3 group"
              >
                <div 
                  onClick={() => handleToggleSubtask(sub.id)}
                  className="flex items-center gap-2.5 cursor-pointer flex-1 min-w-0"
                >
                  {sub.completed ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 text-slate-300 dark:text-slate-700 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <span className={`text-xs font-medium block truncate ${sub.completed ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-200'}`}>
                      {sub.title}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10px] text-indigo-600 dark:text-indigo-400 mt-0.5">
                      <TypeIcon className="w-3 h-3" /> {typeConfig.label}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteSubtask(sub.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-600 transition shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};