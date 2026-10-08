import React, { useState, useEffect } from 'react';
import { useAppSelector } from '../../context/AppContext';
import { 
  X, Pin, Calendar, Users, Clock, CheckSquare, LifeBuoy, FileText, 
  Paperclip, Plus, ArrowRight, TrendingUp, AlertCircle, Edit, Trash2, Archive, Upload, ShieldAlert, UserPlus, UserMinus, Check
} from 'lucide-react';
import { PriorityBadge, ProjectStatusBadge, TaskStatusBadge, TicketStatusBadge, RoleBadge } from '../common/Badge';
import { WorkingOnIndicator } from '../common/WorkingOnIndicator';
import { canCreateTask, formatBudget, formatDate, canCreateProject, canArchiveRecords, isStaffRole } from '../../utils/permissions';
import { TeamWorkloadModal } from './TeamWorkloadModal';
import { ProjectActivityLog } from './ProjectActivityLog';
import { ProjectAnalyticsCard } from './ProjectAnalyticsCard';

// Accepted file types for project attachments, per spec: images plus
// PDF / XLSX / MD documents.
const ACCEPTED_EXTENSIONS = ['.pdf', '.xlsx', '.md'];

const isAcceptedFile = (file) => {
  if (file.type && file.type.startsWith('image/')) return true;
  const lowerName = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some(ext => lowerName.endsWith(ext));
};

const formatFileSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});


import { ProjectClientsPanel } from './ProjectClientsPanel';
// Project statuses (backend validProjectStatus).
const PROJECT_STATUSES = [
  ['planning', 'Planning'], ['active', 'Active'], ['on_hold', 'On Hold'],
  ['completed', 'Completed'], ['cancelled', 'Cancelled'],
];
import { DocumentsPanel } from '../common/DocumentsPanel';
export const ProjectDetailModal = () => {
  const { 
    selectedProjectDetailId, 
    setSelectedProjectDetailId, 
    projects, 
    tasks, 
    tickets, 
    allUsers, 
    currentUser,
    permissionMatrix,
    togglePinProject, 
    updateProject,
    departments,
    deleteProject,
    addProjectMember,
    removeProjectMember,
    addProjectAttachment,
    setSelectedTaskId,
    setSelectedTicketId,
    openQuickCreate,
    fetchTasksPage, fetchTicketsPage,
  } = useAppSelector(s => ({ selectedProjectDetailId: s.selectedProjectDetailId, setSelectedProjectDetailId: s.setSelectedProjectDetailId, projects: s.projects, tasks: s.tasks, tickets: s.tickets, allUsers: s.allUsers, currentUser: s.currentUser, permissionMatrix: s.permissionMatrix, togglePinProject: s.togglePinProject, updateProject: s.updateProject, departments: s.departments, deleteProject: s.deleteProject, addProjectMember: s.addProjectMember, removeProjectMember: s.removeProjectMember, addProjectAttachment: s.addProjectAttachment, setSelectedTaskId: s.setSelectedTaskId, setSelectedTicketId: s.setSelectedTicketId, openQuickCreate: s.openQuickCreate, fetchTasksPage: s.fetchTasksPage, fetchTicketsPage: s.fetchTicketsPage }));

  const [activeTab, setActiveTab] = useState('overview');
  const [showEditModal, setShowEditModal] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [selectedMemberToAdd, setSelectedMemberToAdd] = useState('');
  const [selectedWorkloadMemberId, setSelectedWorkloadMemberId] = useState(null);

  // Edit form local state, populated when the modal opens
  const [editDescription, setEditDescription] = useState('');
  const [editDepartment, setEditDepartment] = useState('');
  const [editStatus, setEditStatus] = useState('planning');
  const [editStartDate, setEditStartDate] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editBudgetHours, setEditBudgetHours] = useState(0);
  const [isQuickEditingBudget, setIsQuickEditingBudget] = useState(false);
  const [quickBudgetValue, setQuickBudgetValue] = useState(0);
  const [quickBudgetUnit, setQuickBudgetUnit] = useState('hours');
  const [editBudgetUnit, setEditBudgetUnit] = useState('hours');
  const [isSavingQuickBudget, setIsSavingQuickBudget] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  // The browser holds only open and recently finished tasks / tickets: load
  // this project's full history when it's opened, so its Tasks and Tickets
  // tabs list everything (they go into the shared cache).
  useEffect(() => {
    if (!selectedProjectDetailId) return;
    const loadAll = async (fetchPage) => {
      for (let p = 1; p <= 10; p++) {
        const { pagination } = await fetchPage({ projectId: selectedProjectDetailId, page: p, limit: 200 });
        if (p >= (pagination.pages || 1)) break;
      }
    };
    loadAll(fetchTasksPage).catch(() => {});
    loadAll(fetchTicketsPage).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectDetailId]);

  if (!selectedProjectDetailId) return null;

  const project = projects.find(p => p.id === selectedProjectDetailId);
  if (!project) return null;

  const projectTasks = tasks.filter(t => t.projectId === project.id);
  const projectTickets = tickets.filter(t => t.projectId === project.id);
  const owner = allUsers.find(u => u.id === project.ownerId);
  const admin = allUsers.find(u => u.id === project.adminId);
  const members = allUsers.filter(u => project.memberIds?.includes(u.id));

  // Deactivated accounts can't log in, so they aren't offered as new members.
  const availableUsersToAdd = allUsers.filter(u => u.status === 'active' && !(project.memberIds || []).includes(u.id));

  const canManageTeam = !isStaffRole(currentUser.role);

  // The server's progress (finished / all tasks, excluding cancelled and
  // archived — see fillProjectProgress). This used to count status
  // "completed"/"closed", which tasks never have, so it always read 0%.
  const calculatedProgress = project.progress || 0;

  const openEditModal = () => {
    setEditDescription(project.description || '');
    setEditDepartment(project.department || '');
    setEditStatus(project.status || 'planning');
    setEditStartDate(project.startDate || '');
    setEditDueDate(project.dueDate || '');
    setEditBudgetHours(project.budgetValue || project.budgetHours || 0);
    setEditBudgetUnit(project.budgetUnit || 'hours');
    setShowEditModal(true);
  };

  const handleSaveEdit = (e) => {
    e.preventDefault();
    updateProject(project.id, {
      description: editDescription,
      department: editDepartment,
      status: editStatus,
      startDate: editStartDate,
      dueDate: editDueDate,
      budgetValue: editBudgetHours,
      budgetUnit: editBudgetUnit,
    });
    setShowEditModal(false);
  };

  const handleTogglePriority = () => {
    const nextPriority = project.priority === 'critical' ? 'normal' : 'critical';
    updateProject(project.id, { priority: nextPriority });
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setUploadError('');
    const invalidFile = files.find(f => !isAcceptedFile(f));
    if (invalidFile) {
      setUploadError(`"${invalidFile.name}" isn't a supported type. Allowed: images, .pdf, .xlsx, .md`);
      e.target.value = '';
      return;
    }

    setIsUploading(true);
    try {
      for (const file of files) {
        const base64Url = await fileToBase64(file);
        const extension = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : 'file';
        addProjectAttachment(project.id, {
          name: file.name,
          size: formatFileSize(file.size),
          type: file.type.startsWith('image/') ? 'image' : extension,
          url: base64Url,
        });
      }
    } catch (err) {
      setUploadError('Something went wrong reading that file. Please try again.');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  // Was routing through updateProject, whose request body has no field for
  // membership at all — see AppContext.jsx's addProjectMember/
  // removeProjectMember for the full explanation. Those call the
  // dedicated /api/projects/:id/members endpoints that actually exist for
  // this, same as every other add/remove-from-a-collection action in this
  // app (feasibility vendors, project attachments, etc.).
  const handleAddMember = async (e) => {
    e.preventDefault();
    if (!selectedMemberToAdd) return;
    await addProjectMember(project.id, selectedMemberToAdd);
    setSelectedMemberToAdd('');
  };

  const handleRemoveMember = async (userId) => {
    await removeProjectMember(project.id, userId);
  };

  return (
    <div 
      id="project-detail-modal-backdrop"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 overflow-y-auto"
      onClick={() => setSelectedProjectDetailId(null)}
    >
      <div 
        id="project-detail-modal-container"
        className="my-auto w-full max-w-4xl bg-slate-200 dark:bg-zinc-950 rounded-2xl shadow-2xl border border-slate-300 dark:border-zinc-800 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-300 dark:border-zinc-800 bg-slate-300/40 dark:bg-zinc-900/50">
          <div className="flex items-center gap-3 min-w-0">
            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-950/80 dark:text-indigo-300">
              {project.code}
            </span>
            <h3 className="text-base font-bold text-slate-900 dark:text-zinc-100 truncate">
              {project.title}
            </h3>
            <button
              id="toggle-pin-project-detail-btn"
              onClick={() => togglePinProject(project.id)}
              className={`p-1 rounded-lg transition cursor-pointer ${
                project.isPinned ? 'text-amber-500 hover:text-amber-600' : 'text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200'
              }`}
              title={project.isPinned ? 'Unpin project' : 'Pin project to sidebar'}
            >
              <Pin className="w-4 h-4 fill-current" />
            </button>
            <WorkingOnIndicator type="project" record={project} size="md" className="shrink-0" />
          </div>

          <div className="flex items-center gap-2">
            {canCreateProject(currentUser, permissionMatrix) && project.status !== 'archived' ? (
              <select
                value={project.status}
                onChange={(e) => updateProject(project.id, { status: e.target.value })}
                title="Project status (also moves automatically with its tasks)"
                className="px-2 py-1 text-xs font-semibold rounded-md border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800 text-slate-800 dark:text-zinc-200 cursor-pointer focus:outline-hidden"
              >
                {PROJECT_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            ) : (
              <ProjectStatusBadge status={project.status} />
            )}
            <button
              id="toggle-project-priority-btn"
              onClick={handleTogglePriority}
              title="Toggle between Normal and Critical priority"
              className="cursor-pointer"
            >
              <PriorityBadge priority={project.priority} />
            </button>
            <button
              id="edit-project-btn"
              onClick={openEditModal}
              className="p-1.5 rounded-lg text-slate-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800 transition cursor-pointer"
              title="Edit project details"
            >
              <Edit className="w-4 h-4" />
            </button>
            <button
              id="close-project-detail-btn"
              onClick={() => setSelectedProjectDetailId(null)}
              className="p-1 rounded-lg text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Navigation Tabs */}
        <div className="flex border-b border-slate-300 dark:border-zinc-800 bg-slate-200/80 dark:bg-zinc-950 px-6 overflow-x-auto">
          <button
            id="proj-tab-overview"
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition shrink-0 cursor-pointer ${
              activeTab === 'overview'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                : 'border-transparent text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
            }`}
          >
            Overview & Specs
          </button>
          <button
            id="proj-tab-tasks"
            onClick={() => setActiveTab('tasks')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 shrink-0 cursor-pointer ${
              activeTab === 'tasks'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                : 'border-transparent text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
            }`}
          >
            <CheckSquare className="w-3.5 h-3.5" />
            Tasks ({projectTasks.length})
          </button>
          <button
            id="proj-tab-tickets"
            onClick={() => setActiveTab('tickets')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 shrink-0 cursor-pointer ${
              activeTab === 'tickets'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                : 'border-transparent text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
            }`}
          >
            <LifeBuoy className="w-3.5 h-3.5" />
            Linked Tickets ({projectTickets.length})
          </button>
          <button
            id="proj-tab-team"
            onClick={() => setActiveTab('team')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 shrink-0 cursor-pointer ${
              activeTab === 'team'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                : 'border-transparent text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Team ({members.length})
          </button>
          <button
            id="proj-tab-files"
            onClick={() => setActiveTab('files')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 shrink-0 cursor-pointer ${
              activeTab === 'files'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                : 'border-transparent text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
            }`}
          >
            <Paperclip className="w-3.5 h-3.5" />
            Files
          </button>
          <button
            id="proj-tab-activity"
            onClick={() => setActiveTab('activity')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 shrink-0 cursor-pointer ${
              activeTab === 'activity'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                : 'border-transparent text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            Activity Log
          </button>
        </div>

        {/* Modal Tab Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Project Analytics Burn Card */}
              <ProjectAnalyticsCard projectId={project.id} />

              {/* Progress & Milestone Strip */}
              <div className="p-4 rounded-xl bg-slate-100 dark:bg-zinc-900/60 border border-slate-300 dark:border-zinc-800">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-zinc-300 mb-2">
                  <span>Overall Project Completion</span>
                  <span className="font-mono text-indigo-600 dark:text-indigo-400">{calculatedProgress}%</span>
                </div>
                <div className="w-full h-2.5 bg-slate-300 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-indigo-600 rounded-full transition-all duration-500"
                    style={{ width: `${calculatedProgress}%` }}
                  />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-3 border-t border-slate-300 dark:border-zinc-800 text-xs">
                  <div>
                    <span className="text-slate-500 dark:text-zinc-400 block">Department</span>
                    <span className="font-medium text-slate-900 dark:text-zinc-100">{project.department}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-zinc-400 block">Schedule</span>
                    <span className="font-medium text-slate-900 dark:text-zinc-100">{formatDate(project.startDate) || '—'} → {formatDate(project.dueDate) || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-zinc-400 block">Budget</span>
                    {isQuickEditingBudget ? (
                      <div className="flex items-center gap-1 mt-0.5">
                        <input
                          type="number"
                          min={0}
                          autoFocus
                          value={quickBudgetValue}
                          onChange={(e) => setQuickBudgetValue(e.target.value)}
                          disabled={isSavingQuickBudget}
                          className="w-16 px-1.5 py-0.5 text-xs rounded border border-indigo-400 dark:border-indigo-600 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden disabled:opacity-60"
                        />
                        <select
                          value={quickBudgetUnit}
                          onChange={(e) => setQuickBudgetUnit(e.target.value)}
                          disabled={isSavingQuickBudget}
                          className="px-1 py-0.5 text-xs rounded border border-indigo-400 dark:border-indigo-600 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                        >
                          <option value="hours">h</option>
                          <option value="days">days</option>
                        </select>
                        <button
                          type="button"
                          onClick={async () => {
                            setIsSavingQuickBudget(true);
                            await updateProject(project.id, { budgetValue: Number(quickBudgetValue) || 0, budgetUnit: quickBudgetUnit });
                            setIsSavingQuickBudget(false);
                            setIsQuickEditingBudget(false);
                          }}
                          disabled={isSavingQuickBudget}
                          className="p-0.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/40 rounded cursor-pointer disabled:opacity-50"
                          title="Save"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsQuickEditingBudget(false)}
                          disabled={isSavingQuickBudget}
                          className="p-0.5 text-slate-500 dark:text-zinc-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded cursor-pointer disabled:opacity-50"
                          title="Cancel"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <span className="font-medium text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
                        {project.spentHours}h / {formatBudget(project)}
                        {canManageTeam && (
                          <button
                            type="button"
                            onClick={() => {
                              setQuickBudgetValue(project.budgetValue || project.budgetHours || 0);
                              setQuickBudgetUnit(project.budgetUnit || 'hours');
                              setIsQuickEditingBudget(true);
                            }}
                            className="p-0.5 text-slate-400 dark:text-zinc-500 hover:text-indigo-600 dark:hover:text-indigo-400 rounded cursor-pointer"
                            title="Quick-edit budget hours"
                          >
                            <Edit className="w-3 h-3" />
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-zinc-400 block">Department Admin</span>
                    <span className="font-medium text-slate-900 dark:text-zinc-100">{admin?.name || 'Assigned'}</span>
                  </div>
                </div>
              </div>

              {/* Clients (spec slide 9: a project can have several). */}
              <ProjectClientsPanel project={project} />

              {/* Description */}
              <div>
                <h4 className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                  Project Description & Scope
                </h4>
                <div className="p-4 rounded-xl border border-slate-300 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900 text-xs text-slate-800 dark:text-zinc-300 leading-relaxed">
                  {project.description || (
                    <span className="text-slate-500 dark:text-zinc-500 italic">No description provided.</span>
                  )}
                </div>
              </div>

              {/* Tags */}
              {project.tags?.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                    Project Labels & Focus
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {project.tags.map(tag => (
                      <span key={tag} className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-300/60 dark:bg-zinc-800 text-slate-800 dark:text-zinc-300">
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'tasks' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">
                  Associated Project Tasks ({projectTasks.length})
                </span>
                {canCreateTask(currentUser, permissionMatrix) && (
                  <button
                    id="add-task-to-project-btn"
                    onClick={() => openQuickCreate({ tab: 'task', lockedProjectId: project.id, restrictToTab: true })}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Task
                  </button>
                )}
              </div>

              <div className="space-y-2">
                {projectTasks.length === 0 ? (
                  <div className="py-8 text-center text-slate-500 dark:text-zinc-500 text-xs">
                    No tasks currently created for this project.
                  </div>
                ) : (
                  projectTasks.map(t => {
                    const assignee = allUsers.find(u => u.id === t.assignedToId);
                    return (
                      <div
                        key={t.id}
                        id={`project-task-item-${t.id}`}
                        onClick={() => {
                          setSelectedTaskId(t.id);
                          setSelectedProjectDetailId(null);
                        }}
                        className="p-3 rounded-lg border border-slate-300 dark:border-zinc-800 hover:border-indigo-400 dark:hover:border-indigo-500 cursor-pointer bg-slate-100 dark:bg-zinc-900 transition flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                            {t.taskNumber}
                          </span>
                          <span className="text-xs font-medium text-slate-900 dark:text-zinc-100">
                            {t.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <TaskStatusBadge status={t.status} />
                          <PriorityBadge priority={t.priority} />
                          {assignee && (
                            <img src={assignee.avatar || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='50' fill='%23cbd5e1'/%3E%3Ccircle cx='50' cy='38' r='18' fill='%2394a3b8'/%3E%3Cellipse cx='50' cy='92' rx='34' ry='26' fill='%2394a3b8'/%3E%3C/svg%3E"} alt={assignee.name} className="w-6 h-6 rounded-full object-cover" />
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {activeTab === 'tickets' && (
            <div className="space-y-4">
              <span className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider block">
                Linked Customer & Incident Tickets ({projectTickets.length})
              </span>
              <div className="space-y-2">
                {projectTickets.length === 0 ? (
                  <div className="py-8 text-center text-slate-500 dark:text-zinc-500 text-xs">
                    No open tickets linked directly to this project code.
                  </div>
                ) : (
                  projectTickets.map(ticket => (
                    <div
                      key={ticket.id}
                      id={`project-ticket-item-${ticket.id}`}
                      onClick={() => {
                        setSelectedTicketId(ticket.id);
                        setSelectedProjectDetailId(null);
                      }}
                      className="p-3 rounded-lg border border-slate-300 dark:border-zinc-800 hover:border-amber-400 dark:hover:border-amber-500 cursor-pointer bg-slate-100 dark:bg-zinc-900 transition flex items-center justify-between gap-3"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-amber-600 dark:text-amber-400">
                            {ticket.ticketNumber}
                          </span>
                          <span className="text-xs font-medium text-slate-900 dark:text-zinc-100">
                            {ticket.title}
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-500 dark:text-zinc-400">
                          {ticket.requesterCompany || ticket.requesterName} • {ticket.category}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <TicketStatusBadge status={ticket.status} />
                        <PriorityBadge priority={ticket.priority} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'team' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">
                  Assigned Team Members & Stakeholders ({members.length})
                </span>
              </div>

              {canManageTeam && (
                <form onSubmit={handleAddMember} className="flex gap-2">
                  <select
                    id="project-add-member-select"
                    value={selectedMemberToAdd}
                    onChange={(e) => setSelectedMemberToAdd(e.target.value)}
                    disabled={availableUsersToAdd.length === 0}
                    className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden disabled:opacity-50"
                  >
                    <option value="">
                      {availableUsersToAdd.length === 0 ? 'All users already assigned' : 'Select a user to add...'}
                    </option>
                    {availableUsersToAdd.map(u => (
                      <option key={u.id} value={u.id}>
                        {u.name} — {u.title}
                      </option>
                    ))}
                  </select>
                  <button
                    id="project-add-member-btn"
                    type="submit"
                    disabled={!selectedMemberToAdd}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg shrink-0 cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    Add Member
                  </button>
                </form>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {members.length === 0 ? (
                  <div className="py-8 text-center text-slate-500 dark:text-zinc-500 text-xs sm:col-span-2">
                    No team members assigned to this project yet.
                  </div>
                ) : (
                  members.map(m => (
                    <div 
                      key={m.id} 
                      onClick={() => setSelectedWorkloadMemberId(m.id)}
                      className="p-3 rounded-lg border border-slate-300 dark:border-zinc-800 hover:border-indigo-400 dark:hover:border-indigo-500 cursor-pointer bg-slate-100 dark:bg-zinc-900/60 transition flex items-center justify-between"
                      title="Click to view workload"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <img src={m.avatar || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='50' fill='%23cbd5e1'/%3E%3Ccircle cx='50' cy='38' r='18' fill='%2394a3b8'/%3E%3Cellipse cx='50' cy='92' rx='34' ry='26' fill='%2394a3b8'/%3E%3C/svg%3E"} alt={m.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
                        <div className="min-w-0">
                          <span className="text-xs font-semibold text-slate-900 dark:text-zinc-100 block truncate">{m.name}</span>
                          <span className="text-[11px] text-slate-500 dark:text-zinc-400 block truncate">{m.title}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <RoleBadge role={m.role} size="xs" />
                        {canManageTeam && (
                          <button
                            id={`project-remove-member-${m.id}`}
                            onClick={() => handleRemoveMember(m.id)}
                            title={`Remove ${m.name} from project`}
                            className="p-1 rounded-lg text-slate-500 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/60 transition cursor-pointer"
                          >
                            <UserMinus className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'files' && (
            // Real uploads with who / when / versions, downloaded through an
            // access-checked link (spec slide 27). This tab used to list
            // attachments nothing could add to.
            <DocumentsPanel recordType="project" recordId={project.id} title="Project documents" />
          )}

          {activeTab === 'activity' && (
            <ProjectActivityLog projectId={project.id} />
          )}
        </div>
      </div>

      {/* Edit Project Modal */}
      {showEditModal && (
        <div
          className="fixed inset-0 z-60 bg-black/60 flex items-start justify-center p-4 overflow-y-auto"
          onClick={() => setShowEditModal(false)}
        >
          <div
            className="my-auto bg-slate-200 dark:bg-zinc-950 rounded-xl p-5 border border-slate-300 dark:border-zinc-800 w-full max-w-md shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
                <Edit className="w-4 h-4 text-indigo-500" />
                Edit Project — {project.code}
              </h3>
              <button onClick={() => setShowEditModal(false)} className="text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Description
                </label>
                <textarea
                  rows={3}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full p-2.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Status
                </label>
                {/* There was no way to change a project's status at all. It
                    also moves automatically with the tasks (Planning -> Active
                    when work starts, -> Completed when all tasks are done);
                    On Hold / Cancelled are only ever set here. */}
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full p-2.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                >
                  {PROJECT_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Department
                </label>
                <select
                  value={editDepartment}
                  onChange={(e) => setEditDepartment(e.target.value)}
                  className="w-full p-2.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                >
                  {/* Managed Departments list (was hard-coded to two names). */}
                  <option value="">No department</option>
                  {(departments || []).map(d => (
                    <option key={d.id} value={d.name}>{d.name}</option>
                  ))}
                  {editDepartment && !(departments || []).some(d => d.name === editDepartment) && (
                    <option value={editDepartment}>{editDepartment} (not in list)</option>
                  )}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={editStartDate}
                    onChange={(e) => setEditStartDate(e.target.value)}
                    className="w-full p-2.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                    className="w-full p-2.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Budget
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={editBudgetHours}
                    onChange={(e) => setEditBudgetHours(Number(e.target.value))}
                    className="flex-1 p-2.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                  />
                  <select
                    value={editBudgetUnit}
                    onChange={(e) => setEditBudgetUnit(e.target.value)}
                    className="px-2.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                  >
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-2">
                {/* Archive: the archive_records permission (same rule as the
                    backend's DeleteProject). Closes the project only when it
                    succeeds. */}
                {canArchiveRecords(currentUser, permissionMatrix) && project.status !== 'archived' && (
                  <button
                    type="button"
                    disabled={isArchiving}
                    onClick={async () => {
                      if (!window.confirm(`Archive ${project.code || 'this project'}: ${project.title}? It leaves the active list but stays available in the archive and audit trail.`)) return;
                      setIsArchiving(true);
                      const ok = await deleteProject(project.id);
                      setIsArchiving(false);
                      if (ok) {
                        setShowEditModal(false);
                        setSelectedProjectDetailId(null);
                      }
                    }}
                    className="mr-auto px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 border border-rose-300 dark:border-rose-900 text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/40 cursor-pointer disabled:opacity-60"
                  >
                    <Archive className="w-3.5 h-3.5" /> {isArchiving ? 'Archiving...' : 'Archive Project'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-700 dark:text-zinc-300 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Team Workload Inspection Modal */}
      <TeamWorkloadModal
        isOpen={!!selectedWorkloadMemberId}
        onClose={() => setSelectedWorkloadMemberId(null)}
        memberId={selectedWorkloadMemberId}
        projectId={project.id}
      />
    </div>
  );
};