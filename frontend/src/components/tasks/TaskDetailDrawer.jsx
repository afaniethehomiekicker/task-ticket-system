import React, { useState, useEffect } from 'react';
import { getBackendId, useAppSelector } from '../../context/AppContext';
import {
  X, CheckSquare, Plus, MessageSquare, Clock, Calendar, Paperclip,
  Send, UserCheck, ShieldAlert, CheckCircle, RotateCcw, AlertTriangle, Trash2, Edit, Link2, XCircle, Archive, Lock
} from 'lucide-react';
import { PriorityBadge, TaskStatusBadge, RoleBadge } from '../common/Badge';

import { canApproveWork, canArchiveRecords, canViewInternalNotes, canAssignTickets, canGrantRecordAccess, canTransferOwnWork, sameDepartmentUsers, isTaskAssignable, assignedByName } from '../../utils/permissions';

import { TimelinePanel } from '../common/TimelinePanel';
import { DocumentsPanel } from '../common/DocumentsPanel';
import { PrivateBadge, DeptViewBadge } from '../common/PrivateToggle';
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
    updateSubTaskAssignee,
    fetchTaskAccess,
    grantTaskAccess,
    revokeTaskAccess,
    addTaskComment,
    addTaskDependency,
    removeTaskDependency,
    deleteTask, getStatuses, getStatusCategory, recordComments, loadRecordComments } = useAppSelector(s => ({ selectedTaskId: s.selectedTaskId, setSelectedTaskId: s.setSelectedTaskId, setSelectedTaskEditId: s.setSelectedTaskEditId, tasks: s.tasks, projects: s.projects, allUsers: s.allUsers, currentUser: s.currentUser, permissionMatrix: s.permissionMatrix, updateTask: s.updateTask, updateTaskStatus: s.updateTaskStatus, submitTaskForReview: s.submitTaskForReview, approveTask: s.approveTask, reopenTask: s.reopenTask, toggleChecklistItem: s.toggleChecklistItem, addChecklistItem: s.addChecklistItem, addSubTask: s.addSubTask, updateSubTaskStatus: s.updateSubTaskStatus, updateSubTaskAssignee: s.updateSubTaskAssignee, fetchTaskAccess: s.fetchTaskAccess, grantTaskAccess: s.grantTaskAccess, revokeTaskAccess: s.revokeTaskAccess, addTaskComment: s.addTaskComment, addTaskDependency: s.addTaskDependency, removeTaskDependency: s.removeTaskDependency, deleteTask: s.deleteTask, getStatuses: s.getStatuses, getStatusCategory: s.getStatusCategory, recordComments: s.recordComments, loadRecordComments: s.loadRecordComments }));

  const [commentText, setCommentText] = useState('');
  const [commentIsInternal, setCommentIsInternal] = useState(false);
  // Record-level access grants (spec slide 16).
  const [accessList, setAccessList] = useState([]);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState('');
  const [grantUserId, setGrantUserId] = useState('');
  const [newChecklistText, setNewChecklistText] = useState('');
  const [newSubTaskText, setNewSubTaskText] = useState('');
  const [newSubTaskAssignee, setNewSubTaskAssignee] = useState('');
  const [newSubTaskDue, setNewSubTaskDue] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [showReviewInput, setShowReviewInput] = useState(false);
  const [isProcessingReview, setIsProcessingReview] = useState(false);
  const [selectedDependencyId, setSelectedDependencyId] = useState('');

  // Access list for the Access panel. This hook MUST stay above the early
  // returns below: hooks have to run in the same order on every render, and
  // placing it after `if (!task) return null` crashed the drawer ("Rendered
  // more hooks than during the previous render").
  const accessTask = selectedTaskId ? (tasks || []).find(t => String(t.id) === String(selectedTaskId)) : null;
  const accessTaskId = accessTask?.id ?? null;
  const accessPanelAllowed = !!accessTask &&
    accessTask.accessLevel !== 'subtask' && accessTask.accessLevel !== 'granted' &&
    accessTask.accessLevel !== 'department' &&
    canGrantRecordAccess(currentUser, permissionMatrix);
  useEffect(() => {
    let cancelled = false;
    if (!accessPanelAllowed || !accessTaskId) {
      setAccessList([]);
      return undefined;
    }
    setAccessLoading(true);
    setAccessError('');
    fetchTaskAccess(accessTaskId)
      .then(list => { if (!cancelled) setAccessList(list); })
      .catch(err => { if (!cancelled) setAccessError(err.message || 'Failed to load access list'); })
      .finally(() => { if (!cancelled) setAccessLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessTaskId, accessPanelAllowed]);

  // Comments are loaded when the drawer opens (the task list doesn't carry
  // them). Not for a sub-task reference view: it has no comments section.
  const commentsTaskId = accessTask && accessTask.accessLevel !== 'subtask' ? accessTask.id : null;
  useEffect(() => {
    if (commentsTaskId) loadRecordComments('task', commentsTaskId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentsTaskId]);

  if (!selectedTaskId) return null;

  const task = tasks.find(t => String(t.id) === String(selectedTaskId));
  if (!task) return null;

  const checklists = task.checklists || [];
  const subTasks = task.subTasks || [];
  const loadedComments = recordComments?.[`task:${getBackendId(task.id)}`];
  // While loading, fall back to any comments the task record already has.
  const comments = loadedComments?.status === 'loaded' || (loadedComments?.comments || []).length
    ? loadedComments.comments
    : (task.comments || []);
  const commentsLoading = !loadedComments || loadedComments.status === 'loading';
  const commentsFailed = loadedComments?.status === 'error';
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
  // Reference view (spec: private task hierarchy): the caller only sees this
  // task because one of its sub-tasks is assigned to them. The server sends
  // just the task itself and their own sub-tasks; everything else — other
  // sub-tasks, comments, checklist, dependencies, edit and status actions —
  // is hidden here and refused by the backend.
  const isReference = task.accessLevel === 'subtask';
  // Explicitly shared with the current user (record-level grant).
  const isGranted = task.accessLevel === 'granted';
  // Department view: a non-private task of the caller's department. They can
  // read all of it but change nothing except their own sub-tasks' status —
  // the server refuses everything else.
  const isViewOnly = task.accessLevel === 'department';
  const canEdit = !isReference && !isViewOnly;
  const isSupervisorOrAbove = canApproveWork(currentUser, permissionMatrix);

  // Sharing this task with specific people: admins (Grant Record Access) on
  // a task they can see themselves — not on one shared with them.
  const canManageAccess = canEdit && !isGranted && canGrantRecordAccess(currentUser, permissionMatrix);

  const reloadAccess = async () => {
    setAccessLoading(true);
    setAccessError('');
    try {
      setAccessList(await fetchTaskAccess(task.id));
    } catch (err) {
      setAccessError(err.message || 'Failed to load access list');
    } finally {
      setAccessLoading(false);
    }
  };


  const handleGrant = async (e) => {
    e.preventDefault();
    if (!grantUserId) return;
    const saved = await grantTaskAccess(task.id, grantUserId);
    if (saved) {
      setGrantUserId('');
      reloadAccess();
    }
  };

  const handleRevoke = async (g) => {
    if (!window.confirm(`Remove ${g.userName || 'this person'}'s access to ${task.taskNumber}?`)) return;
    if (await revokeTaskAccess(task.id, g.userId)) reloadAccess();
  };

  // People who could be given access: active, not already granted, and not
  // already involved as assignee/creator.
  const grantCandidates = allUsers.filter(u =>
    u.status === 'active' &&
    String(u.id) !== String(task.assignedToId) &&
    String(u.id) !== String(task.creatorId) &&
    !accessList.some(g => String(g.userId) === String(u.id)));

  // Private management notes (spec): only for people with the
  // "View & Write Internal Notes" permission; the server strips them from
  // everyone else's view.
  const showInternal = canViewInternalNotes(currentUser, permissionMatrix);

  const handleAddComment = async (e) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    const saved = await addTaskComment(task.id, commentText, showInternal && commentIsInternal);
    if (saved) {
      setCommentText('');
      setCommentIsInternal(false);
    }
  };

  const handleAddChecklist = (e) => {
    e.preventDefault();
    if (!newChecklistText.trim()) return;
    addChecklistItem(task.id, newChecklistText);
    setNewChecklistText('');
  };

  const handleAddSubTask = async (e) => {
    e.preventDefault();
    if (!newSubTaskText.trim()) return;
    const saved = await addSubTask(task.id, newSubTaskText.trim(), newSubTaskAssignee || null, 'normal', newSubTaskDue || '');
    if (saved) {
      setNewSubTaskText('');
      setNewSubTaskAssignee('');
      setNewSubTaskDue('');
    }
  };

  // Who can change a sub-task's assignee (same rules as the backend):
  //  - anyone with "Reassign Tickets & Tasks" who fully sees the task;
  //  - with "Transfer My Work Within Department": the sub-task's own
  //    assignee, or the parent task's assignee — to a colleague in their own
  //    department (spec slide 20: "Staff A creates Subtask -> assigns to
  //    Staff B", "Transferred to L2").
  const me = String(currentUser?.id);
  const canReassignAnySub = canEdit && canAssignTickets(currentUser, permissionMatrix);
  const canTransfer = canTransferOwnWork(currentUser, permissionMatrix);
  const ownsTask = canEdit && String(task.assignedToId) === me;
  // Admins assign work; they can't be given a sub-task.
  const colleagues = sameDepartmentUsers(currentUser, allUsers).filter(isTaskAssignable);
  const canChangeSubAssignee = (sub) =>
    canReassignAnySub || (canTransfer && (String(sub.assignedToId) === me || ownsTask));
  // Options for an existing sub-task; the current assignee stays listed.
  const assigneeOptionsFor = (sub) => {
    const pool = canReassignAnySub ? allUsers.filter(u => u.status === 'active' && isTaskAssignable(u)) : colleagues;
    const current = allUsers.find(u => String(u.id) === String(sub.assignedToId));
    return current && !pool.some(u => u.id === current.id) ? [...pool, current] : pool;
  };
  // New sub-tasks: anyone (with reassign), colleagues (task assignee with
  // transfer), otherwise only yourself.
  const subTaskAssignees = canReassignAnySub
    ? allUsers.filter(u => u.status === 'active' && isTaskAssignable(u))
    : (canTransfer && ownsTask ? colleagues
      : allUsers.filter(u => String(u.id) === me && isTaskAssignable(u)));
  const userName = (id) => allUsers.find(u => String(u.id) === String(id))?.name;

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
      className="fixed inset-0 z-50 flex justify-end bg-black/60"
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
            {task.isPrivate && <PrivateBadge />}
            {isViewOnly && <DeptViewBadge />}
          </div>

          <div className="flex items-center gap-2">
{canEdit && (
            <button
              id="edit-task-btn"
              onClick={() => setSelectedTaskEditId(task.id)}
              className="p-1.5 rounded-lg text-slate-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800 transition cursor-pointer"
              title="Edit task details"
            >
              <Edit className="w-4 h-4" />
            </button>
            )}
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
          {isGranted && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-300">
              This task was shared with you. You can work on it; its project is shown for reference only.
            </div>
          )}
          {isViewOnly && (
            <div className="p-3 rounded-xl bg-slate-100 dark:bg-zinc-900/60 border border-slate-300 dark:border-zinc-800 text-xs text-slate-700 dark:text-zinc-300">
              You're viewing this task as a member of its department. Only the people working on it can change it
              {subTasks.some(st => String(st.assignedToId) === String(currentUser?.id)) ? ' — you can update the status of your own sub-tasks.' : '.'}
            </div>
          )}
          {isReference && (
            <div className="p-3 rounded-xl bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900 text-xs text-sky-800 dark:text-sky-300">
              You can see this task because a sub-task of it is assigned to you. Only your sub-tasks are shown;
              you can update their status.
            </div>
          )}
          {!isReference && (<>
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

              {isSupervisorOrAbove && !isViewOnly && (
                <>
                  <textarea
                    rows={2}
                    placeholder="Notes for the assignee (optional when approving — required to reopen)..."
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
                      disabled={isProcessingReview || !reviewNotes.trim()}
                      title={!reviewNotes.trim() ? 'Add a note explaining what needs to change' : undefined}
                      className="px-3 py-1.5 bg-slate-300 dark:bg-zinc-800 hover:bg-slate-400 dark:hover:bg-zinc-700 disabled:opacity-60 disabled:cursor-not-allowed text-slate-800 dark:text-zinc-200 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> {isProcessingReview ? 'Working...' : 'Reopen'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          </>)}

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
              {assignedByName(task, allUsers) && (
                <span className="block mt-1 text-[10px] text-slate-500 dark:text-zinc-400">Assigned by {assignedByName(task, allUsers)}</span>
              )}
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

          {!isReference && (<>
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
                  onClick={() => { if (canEdit) toggleChecklistItem(task.id, item.id); }}
                  className={`p-2.5 rounded-lg border ${canEdit ? 'cursor-pointer' : 'cursor-default'} transition flex items-center gap-3 text-xs ${
                    item.completed
                      ? 'bg-slate-100 dark:bg-zinc-900/40 border-slate-300 dark:border-zinc-800 text-slate-500 dark:text-zinc-500 line-through'
                      : 'bg-slate-100 dark:bg-zinc-900 border-slate-300 dark:border-zinc-800 text-slate-900 dark:text-zinc-200 hover:border-indigo-400 dark:hover:border-indigo-500'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={item.completed}
                    onChange={() => {}}
                    disabled={!canEdit}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-0 cursor-pointer disabled:cursor-default"
                  />
                  <span>{item.title}</span>
                </div>
              ))}
            </div>

            {/* Add Checklist Form */}
            {canEdit && (
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
            )}
          </div>
          </>)}

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
                    <span className="font-medium text-slate-900 dark:text-zinc-200 block">
                      {sub.subtaskNumber && <span className="mr-1.5 font-mono text-[10px] text-slate-500 dark:text-zinc-500">{sub.subtaskNumber}</span>}
                      {sub.title}
                    </span>
                    {canChangeSubAssignee(sub) ? (
                      <div className="flex items-center gap-1.5 mt-1">
                        <select
                          value={sub.assignedToId ?? ''}
                          onChange={(e) => updateSubTaskAssignee(task.id, sub.id, e.target.value)}
                          title="Assignee"
                          className="max-w-[180px] px-1.5 py-0.5 text-[11px] rounded border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800 text-slate-800 dark:text-zinc-300 focus:outline-hidden"
                        >
                          {/* Transferring must go to someone; only the full
                              reassign right can clear the assignee. */}
                          {(canReassignAnySub || !sub.assignedToId) && <option value="">Unassigned</option>}
                          {assigneeOptionsFor(sub).map(u => (
                            <option key={u.id} value={u.id}>
                              {u.name}{u.status !== 'active' ? ' (inactive)' : ''}
                            </option>
                          ))}
                        </select>
                        {assignedByName(sub, allUsers) && <span className="text-[10px] text-slate-500 dark:text-zinc-400">by {assignedByName(sub, allUsers)}</span>}
                        {sub.dueDate && <span className="text-[10px] text-slate-500 dark:text-zinc-400">Due {sub.dueDate}</span>}
                      </div>
                    ) : (
                      <span className="text-[10px] text-slate-500 dark:text-zinc-400">
                        {sub.assignedToId ? (userName(sub.assignedToId) || 'Unknown user') : 'Unassigned'}
                        {assignedByName(sub, allUsers) ? ` · by ${assignedByName(sub, allUsers)}` : ''}
                        {sub.dueDate ? ` · Due ${sub.dueDate}` : ''}
                      </span>
                    )}
                  </div>
                  <select
                    value={sub.status}
                    onChange={(e) => updateSubTaskStatus(task.id, sub.id, e.target.value)}
                    // Department viewers: only their own sub-tasks.
                    disabled={isViewOnly && String(sub.assignedToId) !== me}
                    className="disabled:opacity-60 px-2 py-1 text-xs rounded border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800 text-slate-800 dark:text-zinc-300 focus:outline-hidden"
                  >
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Done</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              ))}
            </div>

{canEdit && (
            <form onSubmit={handleAddSubTask} className="space-y-2">
              <input
                id="add-subtask-input"
                type="text"
                placeholder="Add sub-task..."
                value={newSubTaskText}
                onChange={(e) => setNewSubTaskText(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
              />
              <div className="flex gap-2">
                {/* Who does it: the assignee sees this sub-task (and the
                    parent task as a reference) in their lists and Kanban. */}
                <select
                  value={newSubTaskAssignee}
                  onChange={(e) => setNewSubTaskAssignee(e.target.value)}
                  className="flex-1 min-w-0 px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                >
                  <option value="">Unassigned</option>
                  {subTaskAssignees.map(u => (
                    <option key={u.id} value={u.id}>{u.name}{u.department ? ` · ${u.department}` : ''}</option>
                  ))}
                </select>
                <input
                  type="date"
                  value={newSubTaskDue}
                  onChange={(e) => setNewSubTaskDue(e.target.value)}
                  title="Due date (optional)"
                  className="px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 text-xs font-semibold bg-slate-300/60 hover:bg-slate-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-800 dark:text-zinc-200 rounded-lg cursor-pointer whitespace-nowrap"
                >
                  Add Sub-task
                </button>
              </div>
            </form>
            )}
          </div>

          {canManageAccess && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
                <UserCheck className="w-4 h-4 text-emerald-500" />
                Access ({accessList.length})
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                Give someone access to this task only — not its project or the project's other tasks.
              </p>
              {accessError && <p className="text-[11px] text-rose-600 dark:text-rose-400">{accessError}</p>}
              {accessList.length === 0 && !accessLoading && !accessError && (
                <p className="text-[11px] text-slate-500 dark:text-zinc-500 italic">Not shared with anyone.</p>
              )}
              <div className="space-y-1.5">
                {accessList.map(g => (
                  <div key={g.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-100 dark:bg-zinc-900/50 border border-slate-300 dark:border-zinc-800 text-xs">
                    <div>
                      <span className="font-semibold text-slate-900 dark:text-zinc-100">{g.userName}</span>
                      {g.userDepartment && <span className="text-slate-500 dark:text-zinc-400"> · {g.userDepartment}</span>}
                      <span className="block text-[10px] text-slate-500 dark:text-zinc-500">
                        Granted by {g.grantedByName || 'unknown'}{g.createdAt ? ` · ${new Date(g.createdAt).toLocaleDateString()}` : ''}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRevoke(g)}
                      className="px-2 py-1 rounded text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/40 cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <form onSubmit={handleGrant} className="flex gap-2">
                <select
                  value={grantUserId}
                  onChange={(e) => setGrantUserId(e.target.value)}
                  className="flex-1 min-w-0 px-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                >
                  <option value="">Give access to…</option>
                  {grantCandidates.map(u => (
                    <option key={u.id} value={u.id}>{u.name}{u.department ? ` · ${u.department}` : ''}</option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={!grantUserId}
                  className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-lg cursor-pointer whitespace-nowrap"
                >
                  Grant access
                </button>
              </form>
            </div>
          )}

          {!isReference && (<>
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
                    {canEdit && (
                    <button
                      type="button"
                      onClick={() => removeTaskDependency(task.id, dep.id)}
                      className="p-1 text-slate-500 dark:text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 rounded cursor-pointer shrink-0"
                      title="Remove dependency"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                    </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {canEdit && (
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
            )}
          </div>
          </>)}

          {!isReference && (<>
          {/* Activity / Comments Stream */}
          <div className="space-y-4 pt-4 border-t border-slate-300 dark:border-zinc-800">
            <h3 className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
              <MessageSquare className="w-4 h-4 text-indigo-500" />
              Activity & Team Comments ({comments.length})
            </h3>

            <div className="space-y-3">
              {comments.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-zinc-500">
                  {commentsLoading ? 'Loading comments…' : commentsFailed ? (
                    <>Couldn't load comments.{' '}
                      <button type="button" onClick={() => loadRecordComments('task', task.id)} className="text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer">Try again</button>
                    </>
                  ) : 'No discussion comments yet.'}
                </p>
              ) : (
                comments.map(c => (
                  <div key={c.id} className={`p-3 rounded-lg border space-y-1 ${
                    c.isInternal
                      ? 'bg-purple-50/70 dark:bg-purple-950/20 border-purple-200 dark:border-purple-900'
                      : 'bg-slate-100 dark:bg-zinc-900/50 border-slate-300 dark:border-zinc-800'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <img src={c.authorAvatar} alt={c.authorName} className="w-5 h-5 rounded-full object-cover" />
                        <span className="text-xs font-semibold text-slate-900 dark:text-zinc-100">{c.authorName}</span>
                        <RoleBadge role={c.authorRole} size="xs" />
                        {c.isInternal && (
                          <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 text-[10px] font-semibold">
                            <Lock className="w-3 h-3" /> Internal
                          </span>
                        )}
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

            {/* Post Comment — not for department viewers (server refuses). */}
            {canEdit && (<>
            {showInternal && (
              <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-zinc-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={commentIsInternal}
                  onChange={(e) => setCommentIsInternal(e.target.checked)}
                  className="accent-purple-600"
                />
                <Lock className="w-3 h-3" /> Internal note (visible to management only)
              </label>
            )}
            <form onSubmit={handleAddComment} className="flex gap-2">
              <input
                id="task-comment-input"
                type="text"
                placeholder={commentIsInternal ? "Private note for management..." : "Post an update or mention team members..."}
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
            </>)}
          </div>
          </>)}

          {/* Accountability chain (spec slide 20): who did what and when, with
              previous -> new and the reason. In reference view the server
              returns only the caller's own sub-task events. */}
          {/* Documents & evidence (spec slide 27). Not in the sub-task
              reference view — files belong to the task itself. */}
          {!isReference && <DocumentsPanel recordType="task" recordId={task.id} readOnly={isViewOnly} />}

          <TimelinePanel kind="tasks" recordId={task.id} refreshKey={`${task.updatedAt}|${task.status}|${task.assignedToId}|${(task.subTasks || []).length}`} />
        </div>

        {canEdit && (<>
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
                  (task.status !== 'in_review' && task.status !== 'done')
                    ? '"In Review" and "Done" are reached via Submit for Review / Approve, not this dropdown — that\'s what keeps the review workflow\'s role checks meaningful.'
                    : undefined
                }
              >
                {/* Configurable catalog. Review / done statuses go through Submit
                    for Review / Approve (server-side role checks), so they
                    appear here only when already current. */}
                {getStatuses('task')
                  .filter(st => st.key === task.status ||
                    !['review', 'done'].includes(getStatusCategory('task', st.key)))
                  .map(st => <option key={st.key} value={st.key}>{st.label}</option>)}
              </select>
            </div>

            <div className="flex items-center gap-2">
              {task.status !== 'in_review' && task.status !== 'done' && !showReviewInput && (
                <button
                  id="task-submit-review-btn"
                  onClick={() => setShowReviewInput(true)}
                  className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-semibold shadow-xs cursor-pointer"
                >
                  Submit for Review
                </button>
              )}

              {/* Archiving is admin/super_admin only on the backend
                  (DeleteTask). It used to be offered to supervisors too, and
                  always failed for them — silently, with the task vanishing
                  from the UI anyway. */}
              {canArchiveRecords(currentUser, permissionMatrix) && (
                <button
                  id="task-delete-btn"
                  onClick={async () => {
                    if (!window.confirm(`Archive ${task.taskNumber || 'this task'}? It stays available in the archive and audit trail.`)) return;
                    const ok = await deleteTask(task.id);
                    if (ok) setSelectedTaskId(null);
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 border border-rose-300 dark:border-rose-900 text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/40 cursor-pointer"
                  title="Archive this task (it stays in the archive and audit trail)"
                >
                  <Archive className="w-3.5 h-3.5" /> Archive
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
        </>)}
      </div>
    </div>
  );
};