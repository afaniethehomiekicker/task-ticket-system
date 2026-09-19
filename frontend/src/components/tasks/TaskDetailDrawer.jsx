import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  X, CheckSquare, Plus, MessageSquare, Clock, Calendar, Paperclip, 
  Send, UserCheck, ShieldAlert, CheckCircle, RotateCcw, AlertTriangle, Trash2, Edit, Link2, XCircle
} from 'lucide-react';
import { PriorityBadge, TaskStatusBadge, RoleBadge } from '../common/Badge';

import { canApproveWork } from '../../utils/permissions';

export const TaskDetailDrawer = () => {
  const { 
    selectedTaskId, 
    setSelectedTaskId, 
    setSelectedTaskEditId,
    tasks, 
    projects, 
    allUsers, 
    currentUser,
    permissionMatrix,
    updateTask, 
    updateTaskStatus,
    submitTaskForReview,
    approveTask,
    reopenTask,
    toggleChecklistItem,
    addChecklistItem,
    addSubTask,
    updateSubTaskStatus,
    addTaskComment,
    addTaskDependency,
    removeTaskDependency,
    deleteTask
  } = useApp();

  const [commentText, setCommentText] = useState('');
  const [newChecklistText, setNewChecklistText] = useState('');
  const [newSubTaskText, setNewSubTaskText] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [showReviewInput, setShowReviewInput] = useState(false);
  const [isProcessingReview, setIsProcessingReview] = useState(false);
  const [selectedDependencyId, setSelectedDependencyId] = useState('');

  if (!selectedTaskId) return null;

  const task = tasks.find(t => t.id === selectedTaskId);
  if (!task) return null;

  const checklists = task.checklists || [];
  const subTasks = task.subTasks || [];
  const comments = task.comments || [];
  const dependencies = task.dependencies || [];

  // Candidate pool for "add dependency" — every other real task, minus
  // ones already linked, minus the task itself (self-dependency is also
  // rejected server-side, but no reason to even offer it here).
  const dependencyCandidates = (tasks || []).filter(t =>
    String(t.id) !== String(task.id) &&
    !dependencies.some(d => String(d.id) === String(t.id))
  );

  const project = projects.find(p => p.id === task.projectId);
  const assignee = allUsers.find(u => u.id === task.assignedToId);
  const supervisor = allUsers.find(u => u.id === task.supervisorId);
  const creator = allUsers.find(u => u.id === task.creatorId);

  const isStaffAssignee = currentUser.id === task.assignedToId;
  const isSupervisorOrAbove = canApproveWork(currentUser, permissionMatrix);

  const handleAddComment = (e) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    addTaskComment(task.id, commentText);
    setCommentText('');
  };

  const handleAddChecklist = (e) => {
    e.preventDefault();
    if (!newChecklistText.trim()) return;
    addChecklistItem(task.id, newChecklistText);
    setNewChecklistText('');
  };

  const handleAddSubTask = (e) => {
    e.preventDefault();
    if (!newSubTaskText.trim()) return;
    addSubTask(task.id, newSubTaskText);
    setNewSubTaskText('');
  };

  const handleAddDependency = (e) => {
    e.preventDefault();
    if (!selectedDependencyId) return;
    addTaskDependency(task.id, selectedDependencyId);
    setSelectedDependencyId('');
  };

  const handleApprove = async () => {
    setIsProcessingReview(true);
    await approveTask(task.id, reviewNotes.trim() || undefined);
    setIsProcessingReview(false);
    setReviewNotes('');
  };

  const handleReopen = async () => {
    setIsProcessingReview(true);
    await reopenTask(task.id, reviewNotes.trim() || undefined);
    setIsProcessingReview(false);
    setReviewNotes('');
  };

  const handleSubmitForReview = async () => {
    setIsProcessingReview(true);
    await submitTaskForReview(task.id, reviewNotes.trim() || undefined);
    setIsProcessingReview(false);
    setReviewNotes('');
    setShowReviewInput(false);
  };

  return (
    <div 
      id="task-detail-drawer-backdrop"
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs"
      onClick={() => setSelectedTaskId(null)}
    >
      <div 
        id="task-detail-drawer-container"
        className="w-full max-w-2xl bg-slate-200 dark:bg-zinc-950 h-full shadow-2xl border-l border-slate-300 dark:border-zinc-800 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-300 dark:border-zinc-800 bg-slate-300/40 dark:bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-950/80 px-2 py-0.5 rounded">
              {task.taskNumber}
            </span>
            <TaskStatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
          </div>

          <div className="flex items-center gap-2">
            <button
              id="edit-task-btn"
              onClick={() => setSelectedTaskEditId(task.id)}
              className="p-1.5 rounded-lg text-slate-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800 transition cursor-pointer"
              title="Edit task details"
            >
              <Edit className="w-4 h-4" />
            </button>
            <button
              id="close-task-detail-drawer"
              onClick={() => setSelectedTaskId(null)}
              className="p-1 rounded-lg text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Review Banner if under review */}
          {task.reviewStatus === 'submitted_for_review' && (
            <div className="p-4 rounded-xl bg-purple-100/80 dark:bg-purple-950/40 border border-purple-300 dark:border-purple-800 space-y-3">
              <div className="flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-purple-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-bold text-purple-900 dark:text-purple-200">
                    Awaiting Senior Review & Sign-Off
                  </h4>
                  <p className="text-xs text-purple-800 dark:text-purple-300 mt-0.5">
                    {task.reviewNotes || 'Work has been submitted by assignee and is ready for quality approval.'}
                  </p>
                </div>
              </div>

              {isSupervisorOrAbove && (
                <>
                  <textarea
                    rows={2}
                    placeholder="Notes for the assignee (optional — shown either way, whether you approve or reopen)..."
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    disabled={isProcessingReview}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-purple-300 dark:border-purple-800 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:ring-1 focus:ring-purple-500 resize-none disabled:opacity-60"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      id="task-approve-btn"
                      onClick={handleApprove}
                      disabled={isProcessingReview}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg text-xs font-semibold flex items-center gap-1 shadow-xs cursor-pointer"
                    >
                      <CheckCircle className="w-3.5 h-3.5" /> {isProcessingReview ? 'Working...' : 'Approve'}
                    </button>
                    <button
                      id="task-reopen-btn"
                      onClick={handleReopen}
                      disabled={isProcessingReview}
                      className="px-3 py-1.5 bg-slate-300 dark:bg-zinc-800 hover:bg-slate-400 dark:hover:bg-zinc-700 disabled:opacity-60 disabled:cursor-not-allowed text-slate-800 dark:text-zinc-200 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> {isProcessingReview ? 'Working...' : 'Reopen'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Title & Description */}
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-zinc-100 mb-2">
              {task.title}
            </h2>
            <div className="p-4 rounded-xl bg-slate-100 dark:bg-zinc-900/60 border border-slate-300 dark:border-zinc-800 text-xs text-slate-800 dark:text-zinc-300 leading-relaxed">
              {task.description || 'No detailed description provided.'}
            </div>
          </div>

          {/* Quick Details Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl border border-slate-300 dark:border-zinc-800 text-xs">
            <div>
              <span className="text-slate-500 dark:text-zinc-400 block mb-1">Assignee</span>
              <div className="flex items-center gap-2">
                {assignee && (
                  <>
                    <img src={assignee.avatar} alt={assignee.name} className="w-5 h-5 rounded-full object-cover" />
                    <span className="font-medium text-slate-900 dark:text-zinc-200 truncate">{assignee.name}</span>
                  </>
                )}
              </div>
            </div>

            <div>
              <span className="text-slate-500 dark:text-zinc-400 block mb-1">Parent Project</span>
              <span className="font-medium text-slate-900 dark:text-zinc-200 block truncate">
                {project?.code || 'General'}
              </span>
            </div>

            <div>
              <span className="text-slate-500 dark:text-zinc-400 block mb-1">Due Date</span>
              <span className="font-medium text-slate-900 dark:text-zinc-200 block">
                {task.dueDate}
              </span>
            </div>

            <div>
              <span className="text-slate-500 dark:text-zinc-400 block mb-1">Hours (Est / Act)</span>
              <span className="font-medium text-slate-900 dark:text-zinc-200 block font-mono">
                {task.estimatedHours}h / {task.actualHours}h
              </span>
            </div>
          </div>

          {/* Checklists Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <CheckSquare className="w-4 h-4 text-indigo-500" />
                Checklist ({checklists.filter(c => c.completed).length}/{checklists.length})
              </h3>
              <span className="font-mono text-xs text-indigo-600 dark:text-indigo-400 font-semibold">
                {task.progress}%
              </span>
            </div>

            {/* Checklists Items */}
            <div className="space-y-2">
              {checklists.map(item => (
                <div
                  key={item.id}
                  id={`checklist-item-${item.id}`}
                  onClick={() => toggleChecklistItem(task.id, item.id)}
                  className={`p-2.5 rounded-lg border cursor-pointer transition flex items-center gap-3 text-xs ${
                    item.completed
                      ? 'bg-slate-100 dark:bg-zinc-900/40 border-slate-300 dark:border-zinc-800 text-slate-500 dark:text-zinc-500 line-through'
                      : 'bg-slate-100 dark:bg-zinc-900 border-slate-300 dark:border-zinc-800 text-slate-900 dark:text-zinc-200 hover:border-indigo-400 dark:hover:border-indigo-500'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={item.completed}
                    onChange={() => {}}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-0 cursor-pointer"
                  />
                  <span>{item.title}</span>
                </div>
              ))}
            </div>

            {/* Add Checklist Form */}
            <form onSubmit={handleAddChecklist} className="flex gap-2">
              <input
                id="add-checklist-input"
                type="text"
                placeholder="Add new checklist item..."
                value={newChecklistText}
                onChange={(e) => setNewChecklistText(e.target.value)}
                className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
              />
              <button
                type="submit"
                className="px-3 py-1.5 text-xs font-semibold bg-slate-300/60 hover:bg-slate-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-800 dark:text-zinc-200 rounded-lg cursor-pointer"
              >
                Add
              </button>
            </form>
          </div>

          {/* Sub-tasks Section */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">
              Sub-Tasks & Action Items ({subTasks.length})
            </h3>
            <div className="space-y-2">
              {subTasks.map(sub => (
                <div
                  key={sub.id}
                  className="p-3 rounded-lg border border-slate-300 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900 flex items-center justify-between text-xs"
                >
                  <div>
                    <span className="font-medium text-slate-900 dark:text-zinc-200 block">{sub.title}</span>
                    <span className="text-[10px] text-slate-500 dark:text-zinc-400">Due {sub.dueDate}</span>
                  </div>
                  <select
                    value={sub.status}
                    onChange={(e) => updateSubTaskStatus(task.id, sub.id, e.target.value)}
                    className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800 text-slate-800 dark:text-zinc-300 focus:outline-hidden"
                  >
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
              ))}
            </div>

            <form onSubmit={handleAddSubTask} className="flex gap-2">
              <input
                id="add-subtask-input"
                type="text"
                placeholder="Add sub-task..."
                value={newSubTaskText}
                onChange={(e) => setNewSubTaskText(e.target.value)}
                className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
              />
              <button
                type="submit"
                className="px-3 py-1.5 text-xs font-semibold bg-slate-300/60 hover:bg-slate-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-800 dark:text-zinc-200 rounded-lg cursor-pointer"
              >
                Add Sub-task
              </button>
            </form>
          </div>

          {/* Task Dependencies Section */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
              <Link2 className="w-4 h-4 text-indigo-500" />
              Depends On ({dependencies.length})
            </h3>

            {dependencies.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-zinc-500">
                This task doesn't depend on any other task.
              </p>
            ) : (
              <div className="space-y-2">
                {dependencies.map(dep => (
                  <div
                    key={dep.id}
                    className="p-2.5 rounded-lg border border-slate-300 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400 shrink-0">
                        {dep.taskNumber}
                      </span>
                      <span className="text-slate-800 dark:text-zinc-200 truncate">{dep.title}</span>
                      {dep.status && <TaskStatusBadge status={dep.status} />}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeTaskDependency(task.id, dep.id)}
                      className="p-1 text-slate-500 dark:text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 rounded cursor-pointer shrink-0"
                      title="Remove dependency"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleAddDependency} className="flex gap-2">
              <select
                value={selectedDependencyId}
                onChange={(e) => setSelectedDependencyId(e.target.value)}
                disabled={dependencyCandidates.length === 0}
                className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-900 dark:text-zinc-100 focus:outline-hidden disabled:opacity-50"
              >
                <option value="">
                  {dependencyCandidates.length === 0 ? 'No other tasks available' : 'Select a task this depends on...'}
                </option>
                {dependencyCandidates.map(t => (
                  <option key={t.id} value={t.id}>{t.taskNumber} — {t.title}</option>
                ))}
              </select>
              <button
                type="submit"
                disabled={!selectedDependencyId}
                className="px-3 py-1.5 text-xs font-semibold bg-slate-300/60 hover:bg-slate-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-800 dark:text-zinc-200 rounded-lg cursor-pointer"
              >
                Add Dependency
              </button>
            </form>
          </div>

          {/* Activity / Comments Stream */}
          <div className="space-y-4 pt-4 border-t border-slate-300 dark:border-zinc-800">
            <h3 className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
              <MessageSquare className="w-4 h-4 text-indigo-500" />
              Activity & Team Comments ({comments.length})
            </h3>

            <div className="space-y-3">
              {comments.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-zinc-500">No discussion comments yet.</p>
              ) : (
                comments.map(c => (
                  <div key={c.id} className="p-3 rounded-lg bg-slate-100 dark:bg-zinc-900/50 border border-slate-300 dark:border-zinc-800 space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <img src={c.authorAvatar} alt={c.authorName} className="w-5 h-5 rounded-full object-cover" />
                        <span className="text-xs font-semibold text-slate-900 dark:text-zinc-100">{c.authorName}</span>
                        <RoleBadge role={c.authorRole} size="xs" />
                      </div>
                      <span className="text-[10px] text-slate-500 dark:text-zinc-400">
                        {new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-xs text-slate-800 dark:text-zinc-300 pl-7 leading-relaxed">
                      {c.content}
                    </p>
                  </div>
                ))
              )}
            </div>

            {/* Post Comment */}
            <form onSubmit={handleAddComment} className="flex gap-2">
              <input
                id="task-comment-input"
                type="text"
                placeholder="Post an update or mention team members..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                className="flex-1 px-3.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
              />
              <button
                id="task-post-comment-btn"
                type="submit"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" /> Post
              </button>
            </form>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-300 dark:border-zinc-800 bg-slate-300/40 dark:bg-zinc-950 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600 dark:text-zinc-400 font-medium">Status:</span>
              <select
                id="task-status-select"
                value={task.status}
                onChange={(e) => updateTaskStatus(task.id, e.target.value)}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 font-medium focus:outline-hidden"
                title={
                  (task.status !== 'under_review' && task.status !== 'completed')
                    ? '"Under Review" and "Completed" are reached via Submit for Review / Approve, not this dropdown — that\'s what keeps the review workflow\'s role checks meaningful.'
                    : undefined
                }
              >
                <option value="new">New</option>
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="on_hold">On Hold</option>
                {/* "Under Review" and "Completed" are intentionally NOT
                    freely selectable here — reaching either one must go
                    through submitTaskForReview / approveTask, which
                    (unlike this generic status PATCH) are backed by real
                    server-side role checks. Only shown as an option at
                    all when it's already the task's current status, so
                    the dropdown still displays correctly rather than
                    showing blank. */}
                {task.status === 'under_review' && <option value="under_review">Under Review</option>}
                {task.status === 'completed' && <option value="completed">Completed</option>}
                <option value="closed">Closed</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              {task.status !== 'under_review' && task.status !== 'completed' && !showReviewInput && (
                <button
                  id="task-submit-review-btn"
                  onClick={() => setShowReviewInput(true)}
                  className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-semibold shadow-xs cursor-pointer"
                >
                  Submit for Review
                </button>
              )}

              {isSupervisorOrAbove && (
                <button
                  id="task-delete-btn"
                  onClick={() => {
                    deleteTask(task.id);
                    setSelectedTaskId(null);
                  }}
                  className="p-1.5 text-slate-500 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg cursor-pointer"
                  title="Delete Task"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {showReviewInput && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Note for the reviewer (optional)..."
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                disabled={isProcessingReview}
                className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden disabled:opacity-60"
              />
              <button
                onClick={handleSubmitForReview}
                disabled={isProcessingReview}
                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                {isProcessingReview ? 'Submitting...' : 'Confirm'}
              </button>
              <button
                onClick={() => { setShowReviewInput(false); setReviewNotes(''); }}
                disabled={isProcessingReview}
                className="px-3 py-1.5 text-xs text-slate-600 dark:text-zinc-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg cursor-pointer disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};