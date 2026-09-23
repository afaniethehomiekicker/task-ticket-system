import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { X } from 'lucide-react';
import { canAssignTickets, canApproveWork } from '../../utils/permissions';

export const TaskEditModal = () => {
  const { 
    tasks, 
    selectedTaskEditId, 
    setSelectedTaskEditId, 
    updateTask, 
    allUsers,
    currentUser,
    permissionMatrix
  } = useApp();

  // Reassigning needs the assign_tickets permission ("Reassign Tickets &
  // Tasks"); the backend now enforces it, so don't offer a control that will
  // just be refused.
  const canReassign = canAssignTickets(currentUser, permissionMatrix);
  const canMarkDone = canApproveWork(currentUser, permissionMatrix);

  const task = (tasks || []).find(t => t.id === selectedTaskEditId);
  const [isSaving, setIsSaving] = useState(false);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'normal',
    status: 'todo',
    assignedToId: '',
    dueDate: '',
    estimatedHours: 0
  });

  useEffect(() => {
    if (task) {
      setFormData({
        title: task.title || '',
        description: task.description || '',
        priority: task.priority || 'normal',
        status: task.status || 'todo',
        assignedToId: task.assignedToId || '',
        dueDate: task.dueDate || '',
        estimatedHours: task.estimatedHours || 0
      });
    }
  }, [task]);

  if (!selectedTaskEditId || !task) return null;

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    // updateTask now returns null/undefined on failure (and already
    // alerts with the real error) — only close the modal on genuine
    // success, so a failed save doesn't look like it worked AND doesn't
    // silently discard what was typed.
    const result = await updateTask(selectedTaskEditId, formData);
    setIsSaving(false);
    if (result) {
      setSelectedTaskEditId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-slate-200 dark:bg-zinc-950 border border-slate-300 dark:border-zinc-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-300 dark:border-zinc-800 bg-slate-300/40 dark:bg-zinc-900/50">
          <div>
            <span className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 font-semibold uppercase tracking-wider">{task.taskNumber}</span>
            <h2 className="text-base font-bold text-slate-900 dark:text-zinc-100">Edit Task Details</h2>
          </div>
          <button
            onClick={() => setSelectedTaskEditId(null)}
            className="p-1 rounded-lg text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-slate-300/60 dark:hover:bg-zinc-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Task Title</label>
            <input
              type="text"
              name="title"
              value={formData.title}
              onChange={handleChange}
              required
              className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Description</label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              rows={3}
              className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Priority</label>
              <select
                name="priority"
                value={formData.priority}
                onChange={handleChange}
                className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Status</label>
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
              >
                {/* The backend's own status names (todo, in_progress, in_review,
                    done, blocked, cancelled), which is also what
                    TaskStatusBadge and the Kanban board use. "In Review" is
                    only ever reached through Submit for Review, and "Done"
                    needs the approve_work permission (the server enforces
                    both), so In Review is shown only when it is already the
                    current status and Done only to people who can set it.
                    "archived" stays excluded (archive action only). */}
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="blocked">Blocked</option>
                {task.status === 'in_review' && <option value="in_review">In Review</option>}
                {(task.status === 'done' || canMarkDone) && <option value="done">Done</option>}
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Assignee</label>
              <select
                name="assignedToId"
                value={formData.assignedToId}
                onChange={handleChange}
                disabled={!canReassign}
                title={!canReassign ? 'You don\'t have permission to reassign tasks' : undefined}
                className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
              >
                <option value="">Unassigned</option>
                {allUsers.map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Due Date</label>
              <input
                type="date"
                name="dueDate"
                value={formData.dueDate}
                onChange={handleChange}
                className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Estimated Hours</label>
            <input
              type="number"
              name="estimatedHours"
              value={formData.estimatedHours}
              onChange={handleChange}
              min="0"
              className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-300 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setSelectedTaskEditId(null)}
              className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-zinc-300 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-lg text-xs transition shadow-xs cursor-pointer"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};