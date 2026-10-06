import React, { createContext, useContext, useState, useEffect, useMemo, useRef } from 'react';
import {
  filterProjectsForUser, filterTasksForUser, filterTicketsForUser,
  DEFAULT_PERMISSION_MATRIX, getRoleDisplayName, canViewAuditLogs, registerRoles } from '../utils/permissions';
import confetti from 'canvas-confetti';

// Still needed for Projects/Tasks/Tickets, which haven't been normalized
// to real backend ids yet this pass — they still use the old string
// scheme (e.g. 'prj_eng_01'), so every create/update call for them
// extracts a numeric id via this function. Once those entities get the
// same normalization treatment Users just got, this can likely shrink or
// go away entirely (it already no-ops correctly on a plain number, which
// is exactly what normalized User ids are now).
export const getBackendId = (rawId) => {
  if (typeof rawId === 'number') return rawId;
  if (!rawId || rawId === 'undefined') return null;
  const match = String(rawId).match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
};

// --- User shape translation ------------------------------------------------
//
// The Go backend is the ONLY source of user data. What's needed here is
// translating the backend's raw JSON shape into the shape every existing
// view component already reads: GORM's default field casing (`ID`, not
// `id`) and snake_case foreign keys (`admin_id`, not `adminId`) don't
// match what TaskDetailDrawer, Sidebar, ProjectDetailModal, etc. expect.
// This is the ONE place that translation happens — every consumer of
// allUsers gets the already-normalized shape.
const normalizeUser = (raw) => {
  if (!raw) return null;
  return {
    id: raw.id ?? raw.ID,
    userNumber: raw.user_number || '', // USR-000001 (spec slide 7)
    archivedAt: raw.archived_at || null,
    archivedById: raw.archived_by_id ?? null,
    preArchiveStatus: raw.pre_archive_status || '',
    name: raw.name || '',
    email: raw.email || '',
    avatar: raw.avatar || '',
    role: raw.role || 'staff',
    department: raw.department || '',
    // Other departments a Staff member also works in (Super Admin sets them).
    extraDepartments: Array.isArray(raw.extra_departments) ? raw.extra_departments.filter(Boolean) : [],
    title: raw.title || '',
    phone: raw.phone || '',
    status: raw.status || 'active',
    supervisorId: raw.supervisor_id ?? null,
    // CNOC support tier (L1..L4); empty for everyone outside CNOC.
    supportTier: raw.support_tier || '',
    // The user's Admin is stored in users.manager_id (there is no admin_id
    // column). Reading admin_id left this null for every user, so the
    // "Admin" reporting line never showed anywhere.
    adminId: raw.manager_id ?? raw.admin_id ?? null,
    createdAt: raw.created_at || raw.CreatedAt || null,
  };
};

// --- Project shape translation ----------------------------------------
//
// Same treatment as normalizeUser above. Handles the backend's nested
// `members`/`supervisors` relation arrays (full User objects, per
// models.go's Members/Supervisors []User relations) and the snake_case
// foreign keys/columns so filterProjectsForUser's ownership/admin checks
// work against real backend data.
const normalizeProject = (raw) => {
  if (!raw) return null;
  const memberIds = Array.isArray(raw.members)
    ? raw.members.map(u => u.id ?? u.ID).filter(id => id !== undefined && id !== null)
    : [];
  const supervisorIds = Array.isArray(raw.supervisors)
    ? raw.supervisors.map(u => u.id ?? u.ID).filter(id => id !== undefined && id !== null)
    : [];
  return {
    id: raw.id ?? raw.ID,
    code: raw.code || '',
    title: raw.title || '',
    description: raw.description || '',
    department: raw.department || '',
    status: raw.status || 'planning',
    archivedAt: raw.archived_at || null,
    archivedById: raw.archived_by_id ?? null,
    preArchiveStatus: raw.pre_archive_status || '',
    priority: raw.priority || 'normal',
    startDate: raw.start_date || '',
    dueDate: raw.due_date || '',
    ownerId: raw.owner_id ?? null,
    adminId: raw.admin_id ?? null,
    clientId: raw.client_id ?? null,
    clientName: raw.client?.company_name || '',
    // Every linked client (spec slide 9); clientId above is the primary one.
    clients: (raw.clients || []).map(c => ({
      id: c.ID ?? c.id,
      companyName: c.company_name || '',
      clientNumber: c.client_number || '',
    })),
    clientIds: (raw.clients || []).map(c => c.ID ?? c.id).filter(v => v !== undefined && v !== null),
    memberIds,
    supervisorIds,
    // Calculated by the server from the project's tasks (finished / all,
    // excluding cancelled and archived).
    progress: raw.progress ?? 0,
    tasksTotal: raw.tasks_total ?? 0,
    tasksDone: raw.tasks_done ?? 0,
    progressOverride: !!raw.progress_override,
    budgetHours: raw.budget_hours ?? 0,
    // Budget as entered, in hours or days (1 day = 8 h). budgetHours is the
    // same budget in hours.
    budgetValue: raw.budget_value ?? raw.budget_hours ?? 0,
    budgetUnit: raw.budget_unit || 'hours',
    spentHours: raw.spent_hours ?? 0,
    isPinned: !!raw.is_pinned,
    tags: typeof raw.tags === 'string'
      ? raw.tags.split(',').map(t => t.trim()).filter(Boolean)
      : (Array.isArray(raw.tags) ? raw.tags : []),
    attachments: Array.isArray(raw.attachments) ? raw.attachments.map(a => ({
      id: a.id ?? a.ID,
      name: a.name || '',
      size: a.size || '',
      type: a.type || '',
      url: a.url || '',
      uploadedById: a.uploaded_by_id ?? null,
      uploadedByName: a.uploaded_by?.name || '',
      uploadedAt: a.uploaded_at || a.CreatedAt || null,
    })) : [],
    createdAt: raw.created_at || raw.CreatedAt || null,
    updatedAt: raw.updated_at || raw.UpdatedAt || null,
  };
};

// Looks up a user by id. With the backend as the single id source there
// is exactly one real id per user, so this is just a String()-coerced
// equality check, kept as a named helper so call sites (createTicket,
// updateTicket, assignTicket, etc.) don't each repeat the coercion logic
// inline.
const findUserByAnyId = (users, rawId) => {
  if (!rawId && rawId !== 0) return null;
  const target = String(rawId);
  return (users || []).find(u => String(u.id) === target) || null;
};

// --- Task shape translation ----------------------------------------------
//
// Same treatment as normalizeUser/normalizeProject. Two backend-naming
// quirks specific to Task worth calling out: the assignee relation is
// named "Assignee"/"assignee_id" on the backend, but every existing view
// component (built against the original frontend convention) reads
// task.assignedToId — so the name itself changes, not just the casing.
// And supervisorId/adminId are deliberately NOT stored on Task at all
// (see the comment in models.go) — they're derived here from the nested
// Assignee relation (which GetTasks Preloads), the same "one copy of the
// fact" principle applied at read time instead of write time.

const normalizeComment = (raw) => {
  if (!raw) return null;
  return {
    id: raw.id ?? raw.ID,
    authorId: raw.user_id ?? null,
    authorName: raw.user?.name || '',
    authorAvatar: raw.user?.avatar || '',
    authorRole: raw.user?.role || '',
    content: raw.content || '',
    isInternal: !!raw.is_internal,
    createdAt: raw.created_at || raw.CreatedAt || null,
  };
};

const normalizeChecklistItem = (raw) => {
  if (!raw) return null;
  return {
    id: raw.id ?? raw.ID,
    title: raw.title || '',
    completed: !!raw.completed,
    completedBy: raw.completed_by_id ?? null,
    completedAt: raw.completed_at ?? null,
  };
};

// <input type="date"> only accepts yyyy-MM-dd; the backend sends full RFC3339
// timestamps ("2026-09-30T05:00:00+05:00"), which produced the console warning
// and left date fields blank.
const toDateOnly = (v) => (typeof v === 'string' && v.includes('T')) ? v.slice(0, 10) : (v || '');

const normalizeSubTask = (raw) => {
  if (!raw) return null;
  return {
    id: raw.id ?? raw.ID,
    subtaskNumber: raw.subtask_number || '', // STK-000001 (spec slide 7)
    assignedById: raw.assigned_by_id ?? null,
    assignedByName: raw.assigned_by?.name || '',
    title: raw.title || '',
    status: raw.status || 'todo',
    priority: raw.priority || 'normal',
    dueDate: raw.deadline || '',
    assignedToId: raw.assignee_id ?? null,
    estimatedHours: raw.estimated_hours ?? 0,
    actualHours: raw.actual_hours ?? 0,
  };
};

const normalizeTask = (raw) => {
  if (!raw) return null;
  const labels = typeof raw.labels === 'string'
    ? raw.labels.split(',').map(l => l.trim()).filter(Boolean)
    : (Array.isArray(raw.labels) ? raw.labels : []);
  return {
    id: raw.id ?? raw.ID,
    taskNumber: raw.task_number || '',
    title: raw.title || '',
    description: raw.description || '',
    department: raw.department || '',
    status: raw.status || 'todo',
    // Who gave it to the current assignee.
    assignedById: raw.assigned_by_id ?? null,
    assignedByName: raw.assigned_by?.name || '',
    // 'subtask' = reference view: caller sees this task only via a sub-task
    // assigned to them (see limitToSubtaskView in visibility.go).
    // 'department' = a non-private task of the caller's department: they can
    // read it but not change it.
    accessLevel: raw.access_level || 'full',
    // Private: only the people on it (and their managers) see it. Otherwise
    // the whole department can view it.
    isPrivate: !!raw.is_private,
    archivedAt: raw.archived_at || null,
    archivedById: raw.archived_by_id ?? null,
    preArchiveStatus: raw.pre_archive_status || '',
    priority: raw.priority || 'normal',
    labels,
    projectId: raw.project_id ?? null,
    assignedToId: raw.assignee_id ?? null,
    creatorId: raw.creator_id ?? null,
    supervisorId: raw.assignee?.supervisor_id ?? null,
    adminId: raw.assignee?.manager_id ?? null, // see normalizeUser
    progress: raw.progress ?? 0,
    startDate: toDateOnly(raw.start_date),
    dueDate: toDateOnly(raw.due_date),
    estimatedHours: raw.estimated_hours ?? 0,
    actualHours: raw.actual_hours ?? 0,
    isPinned: !!raw.is_pinned,
    reviewStatus: raw.review_status || 'none',
    reviewNotes: raw.review_notes || '',
    // models.Task serialises this relation as "dependencies"; the old code
    // only looked for "depends_on", so dependencies never survived a reload.
    dependencies: (Array.isArray(raw.dependencies) ? raw.dependencies : (Array.isArray(raw.depends_on) ? raw.depends_on : []))
      .map(d => ({
        id: d.id ?? d.ID,
        taskNumber: d.task_number || '',
        title: d.title || '',
        status: d.status || '',
      })).filter(d => d.id),
    checklists: Array.isArray(raw.checklists) ? raw.checklists.map(normalizeChecklistItem).filter(Boolean) : [],
    subTasks: Array.isArray(raw.sub_tasks) ? raw.sub_tasks.map(normalizeSubTask).filter(Boolean) : [],
    comments: Array.isArray(raw.comments) ? raw.comments.map(normalizeComment).filter(Boolean) : [],
    createdAt: raw.created_at || raw.CreatedAt || null,
    updatedAt: raw.updated_at || raw.UpdatedAt || null,
  };
};

// --- Ticket shape translation ----------------------------------------
//
// Same treatment again. Two things specific to Ticket worth calling out:
// severity/SLA/escalation/requester fields were entirely unmapped before
// this (the raw snake_case key sat unused while the UI's camelCase key
// stayed stale or empty), and the frontend historically split comments
// into THREE separate concepts — public comments, staff-only
// internalNotes, and a "unified responses" thread used by one specific
// drawer. The backend Comment model correctly consolidated all of that
// into one list with an IsInternal flag (see models.go) — so all three
// legacy shapes are derived here from that single source, covering
// whichever of the three a given view component still expects without
// needing to know which one for certain.
const normalizeTicket = (raw) => {
  if (!raw) return null;
  const labels = typeof raw.labels === 'string'
    ? raw.labels.split(',').map(l => l.trim()).filter(Boolean)
    : (Array.isArray(raw.labels) ? raw.labels : []);

  const allComments = Array.isArray(raw.comments) ? raw.comments.map(normalizeComment).filter(Boolean) : [];
  const publicComments = allComments.filter(c => !c.isInternal);
  const internalNotes = allComments.filter(c => c.isInternal);

  return {
    id: raw.id ?? raw.ID,
    ticketNumber: raw.ticket_number || '',
    title: raw.title || '',
    description: raw.description || '',
    department: raw.department || '',
    category: raw.category || '',
    priority: raw.priority || 'normal',
    severity: raw.severity || 'normal',
    status: raw.status || 'new',
    // Who gave it to the current assignee.
    assignedById: raw.assigned_by_id ?? null,
    assignedByName: raw.assigned_by?.name || '',
    archivedAt: raw.archived_at || null,
    archivedById: raw.archived_by_id ?? null,
    preArchiveStatus: raw.pre_archive_status || '',
    // The Ticket model has no requester_* columns; the linked Client is the
    // real source (GetTickets preloads it), so fall back to that.
    requesterName: raw.requester_name || raw.client?.contact_person || '',
    requesterEmail: raw.requester_email || raw.client?.email || '',
    requesterCompany: raw.requester_company || raw.client?.company_name || '',
    clientId: raw.client_id ?? null,
    // 'department' = a non-private ticket of the caller's department: they
    // can read it but not change it (see applyTicketAccessLevels).
    accessLevel: raw.access_level || 'full',
    isPrivate: !!raw.is_private,
    // CNOC flow (spec slide 19): where it came from, and who handed it back.
    originDepartment: raw.origin_department || '',
    returnedById: raw.returned_by_id ?? null,
    returnedFromDept: raw.returned_from_dept || '',
    projectId: raw.project_id ?? null,
    assignedToId: raw.assigned_to_id ?? null,
    createdById: raw.created_by_id ?? null,
    supervisorId: raw.assigned_to?.supervisor_id ?? null,
    adminId: raw.assigned_to?.manager_id ?? null, // see normalizeUser
    dueDate: raw.due_date || '',
    slaDeadline: raw.sla_deadline || null,
    responseSlaMinutes: raw.response_sla_minutes ?? 0,
    resolutionSlaMinutes: raw.resolution_sla_minutes ?? 0,
    firstResponseAt: raw.first_response_at || null,
    // SLA tracking (spec slide 22): acknowledged? work started? and the
    // automatic escalation step (0 none, 1 dept head, 2 dept admin, 3 super admin).
    acknowledgedAt: raw.acknowledged_at || null,
    workStartedAt: raw.work_started_at || null,
    autoEscalationStep: raw.auto_escalation_step ?? 0,
    resolvedAt: raw.resolved_at || null,
    closedAt: raw.closed_at || null,
    escalationLevel: raw.escalation_level || 'none',
    // Was `!!raw.breached` — the comment above this claimed it was
    // "computed server-side, fresh, every response," referencing a
    // Breached field in models.go. That's true of the ORIGINAL project's
    // backend, which had exactly that virtual field — but this replica's
    // actual Ticket model has no such field at all (confirmed directly
    // in models.go), so raw.breached was always undefined and this was
    // always false, for every ticket, regardless of real SLA status.
    // The SLA Compliance report was showing 100% unconditionally as a
    // direct result. Computed client-side instead, from sla_deadline
    // (which this function wasn't even reading before — it only read
    // due_date, a field this replica's Ticket model also doesn't have)
    // and status, mirroring the exact logic report.go's GetSLABreaches
    // and GetDashboardStats already use server-side in SQL: a deadline
    // in the past, on a ticket that isn't resolved/closed/archived yet.
    breached: !!(raw.sla_deadline &&
      new Date(raw.sla_deadline).getTime() < Date.now() &&
      !['resolved', 'closed', 'archived'].includes(raw.status)),
    // TicketsView.jsx already had SLA-breach UI built in, expecting these
    // exact names — it was silently dead (badge never lit, due date
    // never shown) purely because this function didn't produce them.
    // Aliased rather than renamed, since `breached`/`dueDate` are also
    // used/expected elsewhere.
    slaBreached: !!(raw.sla_deadline &&
      new Date(raw.sla_deadline).getTime() < Date.now() &&
      !['resolved', 'closed', 'archived'].includes(raw.status)),
    slaDueTime: raw.sla_deadline || raw.due_date || null,
    escalationReason: raw.escalation_reason || '',
    resolutionSummary: raw.resolution_summary || '',
    labels,
    isPinned: !!raw.is_pinned,
    // Three shapes, one source — see comment above.
    comments: publicComments,
    internalNotes,
    responses: allComments,
    attachments: Array.isArray(raw.attachments) ? raw.attachments.map(a => ({
      id: a.id ?? a.ID,
      name: a.name || '',
      size: a.size || '',
      type: a.type || '',
      url: a.url || '',
      uploadedById: a.uploaded_by_id ?? null,
      uploadedByName: a.uploaded_by?.name || '',
      uploadedAt: a.uploaded_at || a.CreatedAt || null,
    })) : [],
    createdAt: raw.created_at || raw.CreatedAt || null,
    updatedAt: raw.updated_at || raw.UpdatedAt || null,
  };
};

// --- Client shape translation -------------------------------------------
const normalizeClient = (raw) => {
  if (!raw) return null;
  return {
    id: raw.id ?? raw.ID,
    companyName: raw.company_name || '',
    // Spec slide 8 fields + admin-defined extras (empty for reference-only
    // viewers — the server doesn't send them).
    clientName: raw.client_name || '',
    cnic: raw.cnic || '',
    mobile: raw.mobile || '',
    customFields: raw.custom_fields || {},
    clientNumber: raw.client_number || '',
    city: raw.city || '',
    status: raw.status || 'active',
    // 'reference' = the user sees this client only through related work:
    // name and ID, no contact details (server strips them).
    accessLevel: raw.access_level || 'full',
    createdById: raw.created_by_id ?? null,
    archivedAt: raw.archived_at || null,
    archivedById: raw.archived_by_id ?? null,
    preArchiveStatus: raw.pre_archive_status || '',
    contactPerson: raw.contact_person || '',
    email: raw.email || '',
    notes: raw.notes || '',
    country: raw.country || '',
    phone: raw.phone || '',
    website: raw.website || '',
    industry: raw.industry || '',
    address: raw.address || '',
    createdAt: raw.created_at || raw.CreatedAt || null,
    updatedAt: raw.updated_at || raw.UpdatedAt || null,
    // Edit access for the signed-in user, decided by the server (see
    // internal/handlers/client_edit.go): canEdit now; editUntil = when that
    // ends (30-minute window or an approved request); editRequest = 'pending'
    // when they have asked an admin for edit access.
    canEdit: !!raw.can_edit,
    editUntil: raw.edit_until || null,
    editRequest: raw.edit_request || '',
  };
};

// --- Feasibility shape translation ---------------------------------------
const normalizeFeasibilityVendor = (raw) => {
  if (!raw) return null;
  return {
    id: raw.id ?? raw.ID,
    // Link to the vendor master (Vendors page).
    vendorId: raw.vendor_id ?? null,
    vendorName: raw.vendor_name || '',
    // Withdrawn vendors stay on the feasibility (greyed out), reinstatable.
    withdrawn: !!raw.withdrawn,
    withdrawnAt: raw.withdrawn_at || null,
    contactPerson: raw.contact_person || '',
    contactEmail: raw.contact_email || '',
    contactPhone: raw.contact_phone || '',
    quotationRef: raw.quotation_ref || '',
    status: raw.status || 'pending',
    responseNotes: raw.response_notes || '',
    evidenceURLs: raw.evidence_urls || '',
    respondedAt: raw.responded_at || null,
  };
};

const normalizeFeasibilityAttachment = (raw) => {
  if (!raw) return null;
  return {
    id: raw.id ?? raw.ID,
    name: raw.name || '',
    size: raw.size || '',
    type: raw.type || '',
    url: raw.url || '',
    uploadedById: raw.uploaded_by_id ?? null,
    uploadedByName: raw.uploaded_by?.name || '',
    uploadedAt: raw.uploaded_at || raw.CreatedAt || null,
  };
};

// Previously fetchAuditLogs (below) stored the raw backend response
// directly with no normalization at all — the one entity in this whole
// app that skipped it. That meant consumers (exportUtils.js's
// exportAuditLogsToCSV, and presumably AuditLogsView) were working with
// raw Go field names: user_id, resource_type, resource_id, and gorm.
// Model's CreatedAt with a capital C (no json tag on that field, same
// reason User.ID serializes as "ID" elsewhere in this app). This maps
// it into the same camelCase shape every other normalizeX function
// already produces.
const normalizeAuditLog = (raw) => {
  if (!raw) return null;
  return {
    id: raw.id ?? raw.ID,
    userId: raw.user_id ?? null,
    // No user = done by the system itself (e.g. SLA auto-escalation).
    actorName: raw.user?.name || (raw.user_id == null ? 'System' : 'Unknown'),
    actorRole: raw.user?.role || '',
    action: raw.action || '',
    entityType: raw.resource_type || '',
    entityId: raw.resource_id ?? null,
    oldValues: raw.old_values || '',
    newValues: raw.new_values || '',
    details: raw.details || '',
    ipAddress: raw.ip_address || '',
    userAgent: raw.user_agent || '',
    timestamp: raw.created_at || raw.CreatedAt || null,
  };
};

const normalizeFeasibility = (raw) => {
  if (!raw) return null;
  return {
    id: raw.id ?? raw.ID,
    feasibilityNumber: raw.feasibility_number || '',
    clientId: raw.client_id ?? null,
    client: raw.client ? normalizeClient(raw.client) : null,
    product: raw.product || '',
    capacity: raw.capacity || '',
    fromLocation: raw.from_location || '',
    toLocation: raw.to_location || '',
    city: raw.city || '',
    requirementDetails: raw.requirement_details || '',
    assignedDept: raw.assigned_dept || '',
    assignedUserId: raw.assigned_user_id ?? null,
    assignedUser: raw.assigned_user ? normalizeUser(raw.assigned_user) : null,
    priority: raw.priority || 'normal',
    status: raw.status || 'draft',
    archivedAt: raw.archived_at || null,
    archivedById: raw.archived_by_id ?? null,
    preArchiveStatus: raw.pre_archive_status || '',
    notes: raw.notes || '',
    targetDate: raw.target_date || '',
    completedAt: raw.completed_at ?? null,
    convertedProjectId: raw.converted_project_id ?? null,
    convertedProject: raw.converted_project ? {
      id: raw.converted_project.id ?? raw.converted_project.ID,
      code: raw.converted_project.code || '',
      title: raw.converted_project.title || '',
    } : null,
    convertedAt: raw.converted_at ?? null,
    vendors: Array.isArray(raw.vendors) ? raw.vendors.map(normalizeFeasibilityVendor).filter(Boolean) : [],
    attachments: Array.isArray(raw.attachments) ? raw.attachments.map(normalizeFeasibilityAttachment).filter(Boolean) : [],
    createdAt: raw.created_at || raw.CreatedAt || null,
    updatedAt: raw.updated_at || raw.UpdatedAt || null,
  };
};

const normalizeDepartment = (raw) => {
  if (!raw) return null;
  return {
    id: raw.id ?? raw.ID,
    name: raw.name || '',
    description: raw.description || '',
    deptNumber: raw.dept_number || '', // DEP-000001 (spec slide 7)
    status: raw.status || 'active',
    archivedAt: raw.archived_at || null,
    archivedById: raw.archived_by_id ?? null,
  };
};

const AppContext = createContext(undefined);

// The ONLY thing persisted across reloads is the session token (JWT).
// Every collection of business data is fetched fresh from the backend on
// startup — this app intentionally has no client-side cache of
// users/projects/tasks/tickets/etc., so a first run is genuinely empty.
const AUTH_TOKEN_KEY = 'pm_system_auth_token_v1';

// The JWT issued by the backend carries the user id in its payload. It's
// decoded here (read-only, client-side) so the active user can be restored
// from the session token alone, without persisting any extra state.
// Converts a bare "YYYY-MM-DD" date string (what every date picker and
// default in this file produces) into a full RFC3339 timestamp, which
// is what Go's standard time.Time JSON unmarshaling actually requires
// (format 2006-01-02T15:04:05Z07:00). A bare date string fails to parse
// at all — "cannot parse \"\" as \"T\"" — which is exactly what was
// happening on every createProject/createTask call that included a
// start or due date. An empty string is converted to null rather than
// sent as-is, since Go's *time.Time also can't parse "" — sending null
// lets the pointer stay nil, which is what "no date set" should mean.
// A string that already looks like it has a time component (contains
// "T") is passed through unchanged, so this is safe to apply even if a
// caller somewhere is already sending a full timestamp.
const toRFC3339 = (dateInput) => {
  if (!dateInput) return null;
  if (typeof dateInput === 'string' && dateInput.includes('T')) return dateInput;
  const d = dateInput instanceof Date ? dateInput : new Date(`${dateInput}T00:00:00Z`);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
};

const decodeTokenUserId = (token) => {
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(base64));
    return json.user_id ?? null;
  } catch (err) {
    return null;
  }
};

export const AppProvider = ({ children }) => {
  // Every collection of business data starts empty — nothing is rehydrated
  // from localStorage. The backend is the single source of truth and is
  // fetched on startup (see fetchInitialData below).
  const [allUsers, setAllUsers] = useState([]);

  // The active user id is derived from the session token only (see
  // decodeTokenUserId above) — it is never written to localStorage.
  const [authToken, setAuthTokenState] = useState(() => {
    return localStorage.getItem(AUTH_TOKEN_KEY) || null;
  });
  const [currentUserId, setCurrentUserIdState] = useState(() => {
    return decodeTokenUserId(authToken);
  });

  const [projects, setProjects] = useState([]);
  const [clients, setClients] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [feasibilities, setFeasibilities] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [notifications, setNotifications] = useState([]);

  const [activeTab, setActiveTab] = useState('dashboard');
  // A filter another screen asks Task Management to open with (e.g. the
  // dashboard's "Reviews Pending" card -> tasks awaiting review). Task
  // Management applies it once and clears it.
  const [taskListPreset, setTaskListPreset] = useState(null);
  // Same idea for every list page: { tab, status, priority } that the page
  // applies once on opening (dashboard drill-down, spec slide 28: "Click any
  // card -> instantly opens the exact filtered list behind that number").
  const [listPreset, setListPreset] = useState(null);
  const [darkMode, setDarkModeState] = useState(false);
  const [permissionMatrix, setPermissionMatrix] = useState(DEFAULT_PERMISSION_MATRIX);

  // Set once a 401 has signed the user out, so a burst of failing requests
  // produces one notice, not one per request.
  const sessionEndedRef = useRef(false);

  const setAuthToken = (token) => {
    if (token) sessionEndedRef.current = false;
    setAuthTokenState(token);
    if (token) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  };

  const apiFetch = (url, options = {}) => {
    const headers = { ...(options.headers || {}) };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    return fetch(url, { ...options, headers }).then((res) => {
      // 401 means this session is no longer valid: it expired (24 hours, or
      // 30 days with "Keep me signed in"),
      // the password was changed or reset, or the account was removed.
      // Go back to the login page instead of showing an error for every
      // action. The request is left pending: the screen that made it is
      // replaced by the login page, so its own error pop-up never appears.
      if (res.status === 401 && authToken) {
        if (!sessionEndedRef.current) {
          sessionEndedRef.current = true;
          setCurrentUserIdState(null);
          setAuthToken(null);
          setTimeout(() => alert('Your session has ended. Please sign in again.'), 0);
        }
        return new Promise(() => {});
      }
      return res;
    });
  };

  // List endpoints are paginated server-side (default 20 per page) and the
  // app loads everything once at startup with no paging UI, so anything past
  // the first 20 tasks/tickets/etc. simply never existed in the frontend.
  // Fetches every page (up to a safety cap) and hands back a Response-like
  // object so the existing `.ok` / `.json()` handling below is unchanged.
  const fetchAllPages = async (path, key) => {
    const PAGE_SIZE = 200;
    const MAX_PAGES = 50;
    const first = await apiFetch(`${path}?page=1&limit=${PAGE_SIZE}`);
    if (!first.ok) return first;
    const firstData = await first.json();
    let all = Array.isArray(firstData[key]) ? firstData[key] : [];
    const pages = firstData.pagination?.pages || 1;
    for (let page = 2; page <= pages && page <= MAX_PAGES; page++) {
      const res = await apiFetch(`${path}?page=${page}&limit=${PAGE_SIZE}`);
      if (!res.ok) break;
      const data = await res.json();
      all = all.concat(Array.isArray(data[key]) ? data[key] : []);
    }
    return { ok: true, json: async () => ({ ...firstData, [key]: all }) };
  };

  // Archived records. Nothing is ever hard-deleted, but the app only loads
  // active records at startup, so archived ones had no place in the UI at all
  // (spec: archived work must stay visible to authorized management). Loaded
  // on demand by the Archive view; the backend applies the same visibility
  // rules as the normal lists.
  const ARCHIVE_SOURCES = {
    projects: ['/api/projects', 'projects', normalizeProject],
    tasks: ['/api/tasks', 'tasks', normalizeTask],
    tickets: ['/api/tickets', 'tickets', normalizeTicket],
    feasibilities: ['/api/feasibilities', 'feasibilities', normalizeFeasibility],
    clients: ['/api/clients', 'clients', normalizeClient],
    users: ['/api/users', 'users', normalizeUser],
    departments: ['/api/departments', 'departments', normalizeDepartment],
  };

  const fetchArchived = async (kind) => {
    const source = ARCHIVE_SOURCES[kind];
    if (!source) return [];
    const [path, key, normalize] = source;
    const PAGE_SIZE = 200;
    const MAX_PAGES = 50;
    let all = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await apiFetch(`${path}?status=archived&page=${page}&limit=${PAGE_SIZE}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed to load archived ${kind}`);
      all = all.concat(Array.isArray(data[key]) ? data[key] : []);
      // Clients/feasibilities aren't paginated server-side (no pagination
      // block) — one request returns everything.
      const pages = data.pagination?.pages || 1;
      if (page >= pages) break;
    }
    return all.map(normalize).filter(Boolean);
  };

  // Undo an archive (PATCH /:id/restore). The server returns the record to the
  // status it had before archiving; the restored record is added back into
  // the matching active list so it shows up immediately.
  const RESTORE_TARGETS = {
    projects: ['/api/projects', 'project', normalizeProject, setProjects],
    tasks: ['/api/tasks', 'task', normalizeTask, setTasks],
    tickets: ['/api/tickets', 'ticket', normalizeTicket, setTickets],
    feasibilities: ['/api/feasibilities', 'feasibility', normalizeFeasibility, setFeasibilities],
    clients: ['/api/clients', 'client', normalizeClient, setClients],
    users: ['/api/users', 'user', normalizeUser, setAllUsers],
    departments: ['/api/departments', 'department', normalizeDepartment, setDepartments],
  };

  const restoreArchived = async (kind, id) => {
    const target = RESTORE_TARGETS[kind];
    const backendId = getBackendId(id);
    if (!target || !backendId) return null;
    const [path, key, normalize, setList] = target;
    let restored = null;
    try {
      const res = await apiFetch(`${path}/${backendId}/restore`, { method: 'PATCH' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Failed to restore.');
        return null;
      }
      restored = normalize(data[key]);
    } catch (err) {
      console.error(`Failed to restore ${kind}:`, err);
      alert('Failed to restore. Please check your connection and try again.');
      return null;
    }
    if (restored) {
      setList(prev => [restored, ...(prev || []).filter(r => String(r.id) !== String(restored.id))]);
    }
    logAudit();
    return restored || true;
  };

  // Assignee search for every user picker. Uses the people directory, which
  // every logged-in user may read (scoped server-side: admins see everyone,
  // others their own department) and which returns active users only. The
  // pickers used to call /api/users, which needs manage_users — so for staff
  // and supervisors every search failed with 403.
  const searchAssignees = async ({ search = '', department = '' } = {}) => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (department) params.set('department', department);
    const res = await apiFetch(`/api/directory/users${params.toString() ? `?${params}` : ''}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'User search failed');
    return (data.users || []).map(normalizeUser).filter(Boolean);
  };

  // ---- Configurable status catalog (spec slide 21) ----
  // Loaded from /api/workflow/statuses; every status dropdown, filter, badge
  // and Kanban column reads from it, so statuses the Super Admin renames, adds
  // or disables show up everywhere without code changes.
  const [workflowStatuses, setWorkflowStatuses] = useState([]);

  const loadWorkflowStatuses = async () => {
    try {
      const res = await apiFetch('/api/workflow/statuses');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setWorkflowStatuses((data.statuses || []).map(r => ({
        id: r.id,
        entity: r.entity,
        key: r.key,
        label: r.label,
        category: r.category,
        reasonRequired: !!r.reason_required,
        enabled: !!r.enabled,
        sortOrder: r.sort_order ?? 0,
        system: !!r.system,
      })));
    } catch (err) {
      console.warn('Failed to load workflow statuses:', err);
    }
  };

  useEffect(() => {
    if (currentUserId) loadWorkflowStatuses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);

  // Notifications: load on sign-in, then check every 30 seconds.
  useEffect(() => {
    if (!currentUserId) {
      setNotifications([]);
      return undefined;
    }
    loadNotifications();
    const timer = setInterval(loadNotifications, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);

  // Enabled statuses for 'ticket' | 'task', in display order.
  const getStatuses = (entity, { includeDisabled = false } = {}) =>
    workflowStatuses
      .filter(st => st.entity === entity && (includeDisabled || st.enabled))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

  const getStatusDef = (entity, key) =>
    workflowStatuses.find(st => st.entity === entity && st.key === key) || null;

  const getStatusLabel = (entity, key) => {
    if (key === 'archived') return 'Archived';
    return getStatusDef(entity, key)?.label || (key || '').replace(/_/g, ' ');
  };

  const getStatusCategory = (entity, key) => {
    if (key === 'archived') return 'archived';
    return getStatusDef(entity, key)?.category || '';
  };

  // Asks for the reason a status requires. Returns the reason, '' when none
  // is needed, or null when the user cancelled (the change must not happen).
  const askStatusReason = (entity, key, provided = '') => {
    const def = getStatusDef(entity, key);
    if (!def?.reasonRequired || (provided || '').trim()) return (provided || '').trim();
    const answer = window.prompt(`A reason is required to set the status to "${def.label}". Reason:`);
    if (answer === null) return null;
    const trimmed = answer.trim();
    if (!trimmed) {
      alert('A reason is required for this status change.');
      return null;
    }
    return trimmed;
  };

  const createWorkflowStatus = async (data) => {
    try {
      const res = await apiFetch('/api/workflow/statuses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity: data.entity,
          label: data.label,
          category: data.category,
          reason_required: !!data.reasonRequired,
        })
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(resData.error || 'Failed to add status.');
        return false;
      }
      await loadWorkflowStatuses();
      return true;
    } catch (err) {
      alert('Failed to add status. Please check your connection and try again.');
      return false;
    }
  };

  const updateWorkflowStatus = async (id, patch) => {
    const wire = {};
    if (patch.label !== undefined) wire.label = patch.label;
    if (patch.category !== undefined) wire.category = patch.category;
    if (patch.reasonRequired !== undefined) wire.reason_required = !!patch.reasonRequired;
    if (patch.enabled !== undefined) wire.enabled = !!patch.enabled;
    if (patch.sortOrder !== undefined) wire.sort_order = Number(patch.sortOrder) || 0;
    try {
      const res = await apiFetch(`/api/workflow/statuses/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wire)
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(resData.error || 'Failed to update status.');
        return false;
      }
      await loadWorkflowStatuses();
      return true;
    } catch (err) {
      alert('Failed to update status. Please check your connection and try again.');
      return false;
    }
  };

  // ---- SLA policies (spec slide 22), Super Admin configures ----
  const fetchSLAPolicies = async () => {
    const res = await apiFetch('/api/workflow/sla');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to load SLA policies');
    return (data.policies || []).map(p => ({
      id: p.id,
      priority: p.priority,
      resolutionMinutes: p.resolution_minutes,
      escalationStepMinutes: p.escalation_step_minutes,
    }));
  };

  const updateSLAPolicy = async (id, patch) => {
    const wire = {};
    if (patch.resolutionMinutes !== undefined) wire.resolution_minutes = Number(patch.resolutionMinutes);
    if (patch.escalationStepMinutes !== undefined) wire.escalation_step_minutes = Number(patch.escalationStepMinutes);
    try {
      const res = await apiFetch(`/api/workflow/sla/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wire)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Failed to update SLA.');
        return false;
      }
      return true;
    } catch (err) {
      alert('Failed to update SLA. Please check your connection and try again.');
      return false;
    }
  };

  // ---- CNOC flow actions (spec slide 19) ----
  // action: 'route' | 'return' | 'reopen'. Replaces the ticket with the
  // server's copy on success.
  const ticketFlowAction = async (ticketId, action, body) => {
    const id = getBackendId(ticketId);
    if (!id) return false;
    try {
      const res = await apiFetch(`/api/tickets/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'That action failed.');
        return false;
      }
      const saved = data.ticket ? normalizeTicket(data.ticket) : null;
      if (saved) setTickets(prev => prev.map(t => String(t.id) === String(ticketId) ? saved : t));
      logAudit();
      return true;
    } catch (err) {
      alert('That action failed. Please check your connection and try again.');
      return false;
    }
  };
  const routeTicket = (ticketId, { department, assignedToId, note }) =>
    ticketFlowAction(ticketId, 'route', {
      department, note, assigned_to_id: getBackendId(assignedToId) || null,
    });
  const returnTicket = (ticketId, note) => ticketFlowAction(ticketId, 'return', { note });
  const reopenTicket = (ticketId, reason) => ticketFlowAction(ticketId, 'reopen', { reason });

  // ---- Admin-configurable client fields (spec slide 8) ----
  const [clientFields, setClientFields] = useState([]);

  const loadClientFields = async () => {
    try {
      const res = await apiFetch('/api/clients/fields');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setClientFields((data.fields || []).map(f => ({
        id: f.id,
        key: f.key,
        label: f.label,
        fieldType: f.field_type,
        options: (f.options || '').split('\n').map(o => o.trim()).filter(Boolean),
        required: !!f.required,
        enabled: !!f.enabled,
        sortOrder: f.sort_order ?? 0,
      })).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id));
    } catch (err) {
      console.warn('Failed to load client fields:', err);
    }
  };

  useEffect(() => {
    if (currentUserId) loadClientFields();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);

  const saveClientField = async (id, data) => {
    const wire = {};
    if (data.label !== undefined) wire.label = data.label;
    if (data.fieldType !== undefined) wire.field_type = data.fieldType;
    if (data.options !== undefined) wire.options = Array.isArray(data.options) ? data.options.join('\n') : data.options;
    if (data.required !== undefined) wire.required = !!data.required;
    if (data.enabled !== undefined) wire.enabled = !!data.enabled;
    if (data.sortOrder !== undefined) wire.sort_order = Number(data.sortOrder) || 0;
    try {
      const res = await apiFetch(id ? `/api/clients/fields/${id}` : '/api/clients/fields', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wire)
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(resData.error || 'Failed to save field.');
        return false;
      }
      await loadClientFields();
      return true;
    } catch (err) {
      alert('Failed to save field. Please check your connection and try again.');
      return false;
    }
  };

  // Client 360° view data (spec slide 10).
  const fetchClientOverview = async (clientId) => {
    const id = getBackendId(clientId);
    const res = await apiFetch(`/api/clients/${id}/overview`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to load client');
    return {
      client: normalizeClient(data.client),
      counts: data.counts || {},
      projects: (data.projects || []).map(normalizeProject).filter(Boolean),
      tickets: (data.tickets || []).map(normalizeTicket).filter(Boolean),
      feasibilities: (data.feasibilities || []).map(normalizeFeasibility).filter(Boolean),
      recentTasks: (data.recent_tasks || []).map(normalizeTask).filter(Boolean),
      activity: (data.activity || []).map(normalizeAuditLog).filter(Boolean),
    };
  };

  const [customRoles, setCustomRoles] = useState(['super_admin', 'admin', 'supervisor', 'staff']);

  const fetchedForTokenRef = useRef(null);
  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
    // Previously ran unconditionally on mount with an empty dependency
    // array ([]) — meaning it fired before anyone was even logged in,
    // hitting every protected endpoint with no Authorization header and
    // getting 401s back immediately. That's exactly what was visible on
    // the bare login screen: six failed requests before any credentials
    // were ever submitted. Now gated on authToken actually being
    // present, and keyed to the token's value (not just a boolean) so
    // logging in — or logging out and into a different account — always
    // triggers a fresh fetch, rather than "only ever once per page load."
    if (!authToken) {
      setDataLoaded(false);
      return;
    }
    if (fetchedForTokenRef.current === authToken) return;
    fetchedForTokenRef.current = authToken;

    const fetchInitialData = async () => {
      try {
        const [usersRes, projectsRes, tasksRes, ticketsRes, clientsRes, feasibilitiesRes, rolesRes, permMatrixRes, departmentsRes] = await Promise.allSettled([
          // The people directory, not /api/users: /api/users needs
          // manage_users, so for everyone else it failed with a 403 on every
          // page load before falling back to this. The directory returns
          // everyone to admins and their department to everyone else;
          // include_inactive keeps names resolvable on older work.
          apiFetch('/api/directory/users?include_inactive=true'),
          fetchAllPages('/api/projects', 'projects'),
          fetchAllPages('/api/tasks', 'tasks'),
          fetchAllPages('/api/tickets', 'tickets'),
          fetchAllPages('/api/clients', 'clients'),
          fetchAllPages('/api/feasibilities', 'feasibilities'),
          apiFetch('/api/roles'),
          apiFetch('/api/roles/permissions'),
          apiFetch('/api/departments')
        ]);

        if (usersRes.status === 'fulfilled' && usersRes.value.ok) {
          const data = await usersRes.value.json();
          setAllUsers((data.users || []).map(normalizeUser).filter(Boolean));
        } else {
          // GET /api/users is restricted to user managers, so for everyone
          // else it fails and allUsers stayed empty — which also left
          // currentUser (looked up in allUsers) null. The directory endpoint
          // returns the same people without needing manage_users.
          try {
            // include_inactive: this is the lookup list for NAMES everywhere
            // (who created / is assigned to existing work), so deactivated
            // people must still resolve. Pickers use searchAssignees().
            const dirRes = await apiFetch('/api/directory/users?include_inactive=true');
            if (dirRes.ok) {
              const dirData = await dirRes.json();
              setAllUsers((dirData.users || []).map(normalizeUser).filter(Boolean));
            }
          } catch (err) {
            console.warn('Failed to load user directory:', err);
          }
        }

        // Whatever the list contained, the logged-in user must be in it.
        try {
          const meRes = await apiFetch('/api/me');
          if (meRes.ok) {
            const meData = await meRes.json();
            const me = normalizeUser(meData.user);
            if (me) {
              setAllUsers(prev => prev.some(u => String(u.id) === String(me.id)) ? prev : [...prev, me]);
            }
          }
        } catch (err) {
          console.warn('Failed to load current user:', err);
        }

        if (projectsRes.status === 'fulfilled' && projectsRes.value.ok) {
          const data = await projectsRes.value.json();
          setProjects((data.projects || []).map(normalizeProject).filter(Boolean));
        }

        if (clientsRes.status === 'fulfilled' && clientsRes.value.ok) {
          const data = await clientsRes.value.json();
          setClients((data.clients || []).map(normalizeClient).filter(Boolean));
        }

        if (feasibilitiesRes.status === 'fulfilled' && feasibilitiesRes.value.ok) {
          const data = await feasibilitiesRes.value.json();
          setFeasibilities((data.feasibilities || []).map(normalizeFeasibility).filter(Boolean));
        }

        // Departments: option B — a real, admin-managed list (spec: "not
        // hard-coded"), fetched once at startup like every other collection,
        // so every Department dropdown across the app reads from one source
        // of truth instead of a hardcoded array or free text.
        if (departmentsRes.status === 'fulfilled' && departmentsRes.value.ok) {
          const data = await departmentsRes.value.json();
          setDepartments((data.departments || []).map(normalizeDepartment).filter(Boolean));
        }

        if (tasksRes.status === 'fulfilled' && tasksRes.value.ok) {
          const data = await tasksRes.value.json();
          setTasks((data.tasks || []).map(normalizeTask).filter(Boolean));
        }

        if (ticketsRes.status === 'fulfilled' && ticketsRes.value.ok) {
          const data = await ticketsRes.value.json();
          setTickets((data.tickets || []).map(normalizeTicket).filter(Boolean));
        }

        // Was never fetched at all — customRoles/permissionMatrix
        // permanently stayed at their hardcoded defaults regardless of
        // what actually existed in the database, and every mutation
        // (createCustomRole/deleteCustomRole/updateRolePermission,
        // fixed separately) had no real backend state to sync against
        // in the first place. NOTE: the exact response shape of
        // GetRoles/GetPermissionMatrix hasn't been verified against
        // their actual handler source (not yet reviewed) — this checks
        // a couple of reasonable key names defensively, and simply
        // leaves the existing state untouched if neither matches, so a
        // wrong guess here can't make things worse than they already
        // were.
        if (rolesRes.status === 'fulfilled' && rolesRes.value.ok) {
          const data = await rolesRes.value.json();
          const rawRoles = Array.isArray(data.roles) ? data.roles : (Array.isArray(data) ? data : null);
          if (rawRoles) {
            const keys = rawRoles.map(r => r.key ?? r.Key).filter(Boolean);
            // Labels and base roles ("Staff (Client Editor)" is a kind of
            // Staff) for isStaffRole / getRoleDisplayName.
            registerRoles(rawRoles);
            if (keys.length > 0) setCustomRoles(keys);
          }
        }

        if (permMatrixRes.status === 'fulfilled' && permMatrixRes.value.ok) {
          const data = await permMatrixRes.value.json();
          const matrix = data.matrix || data.permissions || (typeof data === 'object' && !data.error ? data : null);
          if (matrix && typeof matrix === 'object') setPermissionMatrix(matrix);
        }
      } catch (err) {
        console.warn('Backend API offline:', err);
      } finally {
        setDataLoaded(true);
      }
    };

    fetchInitialData();
  }, [authToken]);

  // Audit logs come ONLY from the server (GET /api/audit). Previously:
  //  - the response was read as data.logs, but the backend sends
  //    data.audit_logs, so nothing ever loaded;
  //  - it was requested only for admin/super_admin by role, while the backend
  //    gates on the view_audit_logs permission;
  //  - logAudit() pushed made-up browser-only entries into the same list,
  //    which vanished on reload and mixed with real ones.
  const [auditPagination, setAuditPagination] = useState({ page: 0, pages: 0, total: 0, limit: 50 });
  const [auditLoading, setAuditLoading] = useState(false);
  const auditQueryRef = useRef({});
  const auditLimitRef = useRef((() => {
    try {
      const saved = Number(localStorage.getItem('audit_page_size'));
      return [10, 20, 50, 100, 500].includes(saved) ? saved : 50;
    } catch { return 50; }
  })());
  const auditPageRef = useRef(1);
  const auditRequestRef = useRef(0);
  const auditRefreshTimerRef = useRef(null);

  const fetchAuditLogs = async ({ page = 1, limit, append = false, search, action, resourceType, resourceId } = {}) => {
    // Remember the filters so background refreshes (see logAudit) keep them.
    if (!append) auditQueryRef.current = { search, action, resourceType, resourceId };
    const q = append ? auditQueryRef.current : { search, action, resourceType, resourceId };
    // Rows per page (Audit Logs page: 10/20/50/100/500). Remembered, so
    // refreshes and page changes keep the size the person picked.
    if (limit) auditLimitRef.current = limit;
    const pageSize = auditLimitRef.current;
    auditPageRef.current = page;
    // Only the newest request may update the list: quick page clicks can
    // otherwise answer out of order and show the wrong page.
    const requestNo = ++auditRequestRef.current;
    const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
    if (q.search) params.set('search', q.search);
    if (q.action) params.set('action', q.action);
    if (q.resourceType) params.set('resource_type', q.resourceType);
    if (q.resourceId) params.set('resource_id', String(q.resourceId));

    setAuditLoading(true);
    try {
      const res = await apiFetch(`/api/audit?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (requestNo !== auditRequestRef.current) return false;
      if (!res.ok) {
        console.warn('Audit logs request refused:', data.error);
        return false;
      }
      const rows = (data.audit_logs || []).map(normalizeAuditLog).filter(Boolean);
      setAuditLogs(prev => append ? [...prev, ...rows] : rows);
      setAuditPagination({
        page: data.pagination?.page || page,
        pages: data.pagination?.pages || 0,
        total: data.pagination?.total || 0,
        limit: data.pagination?.limit || pageSize,
      });
      return true;
    } catch (err) {
      console.warn('Failed to fetch audit logs from backend:', err);
      return false;
    } finally {
      if (requestNo === auditRequestRef.current) setAuditLoading(false);
    }
  };

  const currentUserForAudit = findUserByAnyId(allUsers, currentUserId);
  const mayViewAudit = !!currentUserForAudit && canViewAuditLogs(currentUserForAudit, permissionMatrix);

  // Load (or clear) when the user or their permission changes — not on every
  // change to the user list, which is what the old dependency on allUsers did.
  useEffect(() => {
    if (!mayViewAudit) {
      setAuditLogs([]);
      setAuditPagination({ page: 0, pages: 0, total: 0, limit: auditLimitRef.current });
      return;
    }
    fetchAuditLogs({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, mayViewAudit]);

  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [selectedTaskEditId, setSelectedTaskEditId] = useState(null);
  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [selectedTicketEditId, setSelectedTicketEditId] = useState(null);
  const [selectedProjectDetailId, setSelectedProjectDetailId] = useState(null);
  const [selectedProjectEditId, setSelectedProjectEditId] = useState(null);
  const [selectedFeasibilityId, setSelectedFeasibilityId] = useState(null);
  const [selectedFeasibilityEditId, setSelectedFeasibilityEditId] = useState(null);
  const [quickCreateOpen, setQuickCreateOpenState] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [quickCreatePickerOpen, setQuickCreatePickerOpen] = useState(false);

  const [quickCreateConfig, setQuickCreateConfig] = useState({
    tab: 'project',
    lockedProjectId: null,
    restrictToTab: false,
    projectType: null
  });

  const setQuickCreateOpen = (val) => {
    setQuickCreateOpenState(val);
    if (!val) {
      setQuickCreateConfig({ tab: 'project', lockedProjectId: null, restrictToTab: false, projectType: null });
    }
  };

  const openQuickCreate = (config = {}) => {
    // Was silently dropping config.projectType — QuickCreateTypePicker
    // passes it (to distinguish "General Project" from "Support / TT"),
    // but this function only ever carried tab/lockedProjectId/
    // restrictToTab through. Picking "Support / TT" had no observable
    // effect at all as a result.
    setQuickCreateConfig({
      tab: config.tab || 'project',
      lockedProjectId: config.lockedProjectId || null,
      restrictToTab: !!config.restrictToTab,
      projectType: config.projectType || null
    });
    setQuickCreateOpenState(true);
  };

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const setDarkMode = (val) => {
    setDarkModeState(val);
  };

  const currentUser = useMemo(() => {
    if (!currentUserId) return null;
    return findUserByAnyId(allUsers, currentUserId);
  }, [allUsers, currentUserId]);

  const setCurrentUserId = (id) => {
    setCurrentUserIdState(id);

    if (id === null || id === undefined) {
      setAuthToken(null);
    }

    const switchedUser = findUserByAnyId(allUsers, id);
    if (switchedUser) {
      logAudit({
        actorId: id,
        actorName: switchedUser.name,
        actorRole: switchedUser.role,
        action: 'SESSION_SWITCH',
        entityType: 'auth',
        entityId: id,
        entityTitle: switchedUser.name,
        details: `Active user context switched to ${switchedUser.name} (${switchedUser.role.toUpperCase()})`
      });
    }
  };

  // The backend writes the real audit entry for every action it performs.
  // Call sites still call logAudit(...) after a successful change; that now
  // just schedules a refresh of the first page from the server (debounced,
  // and after a short delay because the backend writes audit rows
  // asynchronously). The entry argument is ignored — it used to be inserted
  // as a fake, unsaved log line.
  const logAudit = (_entry) => {
    if (!mayViewAudit) return;
    if (auditRefreshTimerRef.current) clearTimeout(auditRefreshTimerRef.current);
    auditRefreshTimerRef.current = setTimeout(() => {
      // Stay on the page being viewed; new entries appear on page 1.
      fetchAuditLogs({ page: auditPageRef.current || 1, ...auditQueryRef.current });
    }, 800);
  };

  // Notifications are created on the server now (spec slide 27), for the
  // person they're meant for. This used to add them to the SENDER's own
  // browser only, so recipients never saw anything. Kept as a no-op so the
  // existing call sites don't need touching; the server sends the real ones.
  const pushNotification = () => {};

  const loadNotifications = async () => {
    try {
      const res = await apiFetch('/api/notifications?limit=50');
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      setNotifications((data.notifications || []).map(n => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        entityType: n.entity_type,
        entityId: n.entity_id,
        isRead: !!n.read_at,
        createdAt: n.created_at,
        actorName: n.actor?.name || (n.actor_id ? '' : 'System'),
      })));
    } catch {
      // try again on the next poll
    }
  };

  // ---- Per-person pins (spec slide 28) ----
  // "type:id" keys of what the current user pinned. Pins used to be one flag
  // on the record shared by everyone (and project pins weren't saved).
  const [pinKeys, setPinKeys] = useState(() => new Set());

  useEffect(() => {
    if (!currentUserId) { setPinKeys(new Set()); return; }
    apiFetch('/api/pins')
      .then(res => (res.ok ? res.json() : { pins: [] }))
      .then(data => setPinKeys(new Set((data.pins || []).map(p => `${p.record_type}:${p.record_id}`))))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);

  const isPinnedFor = (type, id) => pinKeys.has(`${type}:${getBackendId(id)}`);

  const togglePin = async (type, id) => {
    const bid = getBackendId(id);
    if (!bid) return false;
    const key = `${type}:${bid}`;
    const pinning = !pinKeys.has(key);
    setPinKeys(prev => {
      const next = new Set(prev);
      if (pinning) next.add(key); else next.delete(key);
      return next;
    });
    try {
      const res = await apiFetch(`/api/pins/${type}/${bid}`, { method: pinning ? 'PUT' : 'DELETE' });
      if (!res.ok) throw new Error('pin failed');
    } catch {
      // Undo on failure.
      setPinKeys(prev => {
        const next = new Set(prev);
        if (pinning) next.delete(key); else next.add(key);
        return next;
      });
      return false;
    }
    return true;
  };

  const withPins = (list, type) => (list || []).map(r =>
    r ? { ...r, isPinned: pinKeys.has(`${type}:${getBackendId(r.id)}`) } : r);
  const pinnedProjectsList = useMemo(() => withPins(projects, 'project'), [projects, pinKeys]); // eslint-disable-line react-hooks/exhaustive-deps
  const pinnedTasksList = useMemo(() => withPins(tasks, 'task'), [tasks, pinKeys]); // eslint-disable-line react-hooks/exhaustive-deps
  const pinnedTicketsList = useMemo(() => withPins(tickets, 'ticket'), [tickets, pinKeys]); // eslint-disable-line react-hooks/exhaustive-deps
  const pinnedFeasList = useMemo(() => withPins(feasibilities, 'feasibility'), [feasibilities, pinKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleProjects = useMemo(() => {
    return filterProjectsForUser(pinnedProjectsList, currentUser, allUsers);
  }, [pinnedProjectsList, currentUser, allUsers]);

  const visibleTasks = useMemo(() => {
    return filterTasksForUser(pinnedTasksList, currentUser, allUsers);
  }, [pinnedTasksList, currentUser, allUsers]);

  const visibleTickets = useMemo(() => {
    return filterTicketsForUser(pinnedTicketsList, currentUser, allUsers);
  }, [pinnedTicketsList, currentUser, allUsers]);

  const visibleFeasibilities = useMemo(() => {
    // Feasibilities are visible to all authenticated users (management overview)
    return pinnedFeasList;
  }, [pinnedFeasList]);

  // The server returns only the caller's own notifications.
  const userNotifications = notifications;

  const unreadNotificationCount = useMemo(() => {
    return userNotifications.filter(n => !n.isRead).length;
  }, [userNotifications]);

  const uploadAvatar = async (file) => {
    if (!file || !currentUser) return;

    const formData = new FormData();
    formData.append('avatar', file);

    try {
      const res = await apiFetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      const updated = await updateUser(currentUser.id, { avatar: data.url });
      if (!updated) throw new Error('Image uploaded, but saving it to your profile failed');
      return data.url;
    } catch (err) {
      console.error('Avatar upload failed:', err);
      throw err;
    }
  };

  const createProject = async (data) => {
    if (!data.clientId && !data.companyId) {
      alert('Validation Error: A project must be built on top of a client or company profile.');
      return null;
    }

    const memberIds = Array.from(new Set([
      ...(data.memberIds || []),
      ...(currentUser?.id ? [currentUser.id] : [])
    ]));

    const resolvedAdminId = data.adminId ?? (
      currentUser?.role === 'admin' ? currentUser.id : currentUser?.adminId ?? null
    );

    // Determine project type: 'general' or 'ticketing'
    const projectType = data.projectType || 'general';

    // Build wire payload matching new backend
    const wirePayload = {
      // Omit entirely when not explicitly provided — the backend now
      // auto-generates a real, collision-free code (PRJ-000001 style)
      // when this field is absent. Was previously
      // `data.code || \`PRJ-${Date.now().toString().slice(-4)}\`` — the
      // last 4 digits of a millisecond timestamp, which repeats every
      // 10 seconds and would collide under completely ordinary usage,
      // not just a rare race condition.
      ...(data.code ? { code: data.code } : {}),
      title: data.title,
      description: data.description,
      type: projectType,
      department: data.department || currentUser?.department || '',
      status: data.status || 'planning',
      priority: data.priority || 'normal',
      start_date: toRFC3339(data.startDate) || toRFC3339(new Date()),
      due_date: toRFC3339(data.dueDate),
      client_id: getBackendId(data.clientId) || null,
      // All clients (slide 9); the first is the primary.
      client_ids: (data.clientIds || (data.clientId ? [data.clientId] : []))
        .map(getBackendId).filter(Boolean),
      owner_id: data.ownerId ?? currentUser?.id ?? null,
      admin_id: data.adminId ?? resolvedAdminId,
      budget_hours: data.budgetHours ?? 0,
      ...(data.budgetValue !== undefined ? { budget_value: Number(data.budgetValue) || 0, budget_unit: data.budgetUnit || 'hours' } : {}),
      member_ids: memberIds,
      supervisor_ids: data.supervisorIds || [],
    };

    // Strip budget_hours for ticketing projects
    if (projectType === 'ticketing') {
      delete wirePayload.budget_hours;
    }

    // No local fallback: a failed create used to add a fake `prj_` project
    // that vanished on reload (and whose id getBackendId() could turn into
    // a real, unrelated project id).
    let newProject = null;
    try {
      const res = await apiFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wirePayload)
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(resData.error || 'Failed to create project.');
        return null;
      }
      newProject = normalizeProject(resData.project);
    } catch (err) {
      console.error('Failed to sync createProject to API:', err);
      alert('Failed to create project. Please check your connection and try again.');
      return null;
    }
    if (!newProject) return null;

    setProjects(prev => [newProject, ...prev]);

    logAudit({
      actorId: currentUser?.id,
      actorName: currentUser?.name,
      actorRole: currentUser?.role,
      action: 'PROJECT_CREATED',
      entityType: 'project',
      entityId: newProject.id,
      entityTitle: newProject.title,
      details: `Created ${projectType} project [${newProject.code}] for client ID: ${newProject.clientId}`
    });

    memberIds.forEach(memId => {
      if (String(memId) !== String(currentUser?.id)) {
        pushNotification({
          recipientId: memId,
          title: 'Added to New Project',
          message: `You were assigned as a team member on project: ${newProject.title}`,
          type: 'assignment',
          entityType: 'project',
          entityId: newProject.id
        });
      }
    });

    return newProject;
  };

  // Adding/removing a project MEMBER is not part of updateProject below —
  // its wirePayload has no field for it at all, so handleAddMember calling
  // updateProject(id, { memberIds }) silently sent a request with no member
  // information whatsoever: the backend correctly changed nothing and
  // returned 200, which is why it looked like it worked (green network
  // request, form closed) but never actually attached anyone. The real
  // endpoints already existed on the backend (POST/DELETE
  // /api/projects/:id/members, ticket_extra.go) — nothing on the frontend
  // called them.
  const addProjectMember = async (projectId, userId) => {
    const targetProjectId = getBackendId(projectId);
    const targetUserId = getBackendId(userId);
    if (!targetProjectId || !targetUserId) return null;

    let savedProject = null;
    try {
      const res = await apiFetch(`/api/projects/${targetProjectId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: targetUserId })
      });
      if (res.ok) {
        const resData = await res.json();
        savedProject = normalizeProject(resData.project);
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || 'Failed to add member.');
        return null;
      }
    } catch (err) {
      console.error('Failed to sync addProjectMember to API:', err);
      alert('Failed to add member. Please check your connection and try again.');
      return null;
    }

    setProjects(prev => prev.map(p => String(p.id) === String(projectId) ? savedProject : p));

    const member = allUsers.find(u => String(u.id) === String(userId));
    logAudit({
      actorId: currentUser?.id,
      actorName: currentUser?.name,
      actorRole: currentUser?.role,
      action: 'PROJECT_MEMBER_ADDED',
      entityType: 'project',
      entityId: projectId,
      entityTitle: savedProject?.title || '',
      details: member ? `Added ${member.name} to the project team` : 'Added a team member'
    });

    return savedProject;
  };

  // The backend's response here has no "project" key at all (just a plain
  // success message) — unlike add, which returns the full updated project.
  // Local state has to be updated by filtering the member out directly
  // rather than trusting a returned object that doesn't exist.
  const removeProjectMember = async (projectId, userId) => {
    const targetProjectId = getBackendId(projectId);
    const targetUserId = getBackendId(userId);
    if (!targetProjectId || !targetUserId) return false;

    try {
      const res = await apiFetch(`/api/projects/${targetProjectId}/members/${targetUserId}`, { method: 'DELETE' });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || 'Failed to remove member.');
        return false;
      }
    } catch (err) {
      console.error('Failed to sync removeProjectMember to API:', err);
      alert('Failed to remove member. Please check your connection and try again.');
      return false;
    }

    const project = projects.find(p => String(p.id) === String(projectId));
    const member = allUsers.find(u => String(u.id) === String(userId));

    setProjects(prev => prev.map(p => {
      if (String(p.id) !== String(projectId)) return p;
      return { ...p, memberIds: (p.memberIds || []).filter(id => String(id) !== String(userId)) };
    }));

    logAudit({
      actorId: currentUser?.id,
      actorName: currentUser?.name,
      actorRole: currentUser?.role,
      action: 'PROJECT_MEMBER_REMOVED',
      entityType: 'project',
      entityId: projectId,
      entityTitle: project?.title || '',
      details: member ? `Removed ${member.name} from the project team` : 'Removed a team member'
    });

    return true;
  };

  const updateProject = async (id, updates) => {
    const targetId = getBackendId(id);

    // Was sending `updates` directly as the request body — the raw
    // camelCase keys this app uses everywhere on the frontend
    // (budgetHours, dueDate, clientId, etc.) never matched the
    // backend's snake_case json tags, so most fields silently failed to
    // bind at all even on a "successful" 200 response. Also never
    // checked res.ok — a failed request (validation error, permission
    // denied, network failure) still unconditionally applied the
    // attempted change to local state, so the UI always showed success
    // regardless of what actually happened server-side. This mirrors
    // the exact fix already applied to updateUser earlier in this
    // review.
    const wirePayload = {};
    if (updates.title !== undefined) wirePayload.title = updates.title;
    if (updates.code !== undefined) wirePayload.code = updates.code;
    if (updates.description !== undefined) wirePayload.description = updates.description;
    if (updates.department !== undefined) wirePayload.department = updates.department;
    if (updates.status !== undefined) wirePayload.status = updates.status;
    if (updates.priority !== undefined) wirePayload.priority = updates.priority;
    if (updates.startDate !== undefined) wirePayload.start_date = toRFC3339(updates.startDate);
    if (updates.dueDate !== undefined) wirePayload.due_date = toRFC3339(updates.dueDate);
    if (updates.clientId !== undefined) wirePayload.client_id = getBackendId(updates.clientId);
    // Replaces the project's whole client list (first = primary).
    if (updates.clientIds !== undefined) wirePayload.client_ids = (updates.clientIds || []).map(getBackendId).filter(Boolean);
    if (updates.ownerId !== undefined) wirePayload.owner_id = getBackendId(updates.ownerId);
    if (updates.adminId !== undefined) wirePayload.admin_id = getBackendId(updates.adminId);
    if (updates.budgetHours !== undefined) wirePayload.budget_hours = updates.budgetHours;
    if (updates.budgetValue !== undefined) wirePayload.budget_value = Number(updates.budgetValue) || 0;
    if (updates.budgetUnit !== undefined) wirePayload.budget_unit = updates.budgetUnit;
    if (updates.progress !== undefined) wirePayload.progress = updates.progress;
    if (updates.isPinned !== undefined) wirePayload.is_pinned = updates.isPinned;

    let succeeded = false;
    let savedProject = null;
    if (targetId) {
      try {
        const res = await apiFetch(`/api/projects/${targetId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(wirePayload)
        });
        if (res.ok) {
          const resData = await res.json().catch(() => ({}));
          savedProject = resData.project ? normalizeProject(resData.project) : null;
          succeeded = true;
        } else {
          const errData = await res.json().catch(() => ({}));
          alert(errData.error || 'Failed to update project.');
        }
      } catch (err) {
        console.error('Failed to sync updateProject to API:', err);
        alert('Failed to update project. Please check your connection and try again.');
      }
    }

    if (!succeeded) return null;

    setProjects(prev => prev.map(p => {
      if (String(p.id) !== String(id)) return p;
      return savedProject || { ...p, ...updates, updatedAt: new Date().toISOString() };
    }));

    const prj = projects.find(p => String(p.id) === String(id));
    if (prj) {
      logAudit({
        actorId: currentUser?.id,
        actorName: currentUser?.name,
        actorRole: currentUser?.role,
        action: 'PROJECT_UPDATED',
        entityType: 'project',
        entityId: id,
        entityTitle: prj.title,
        details: `Updated project fields: ${Object.keys(updates).join(', ')}`
      });
    }

    return savedProject || true;
  };

  // Saved per person on the server (it used to only flip a local flag).
  const togglePinProject = (id) => togglePin('project', id);

  // Archives (the backend never hard-deletes). Only removed from the UI when
  // the server confirms — it used to vanish locally even on a 403.
  const deleteProject = async (id) => {
    const targetId = getBackendId(id);
    if (!targetId) return false;
    try {
      const res = await apiFetch(`/api/projects/${targetId}`, { method: 'DELETE' });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || 'Failed to archive project.');
        return false;
      }
    } catch (err) {
      console.error('Failed to sync deleteProject to API:', err);
      alert('Failed to archive project. Please check your connection and try again.');
      return false;
    }

    setProjects(prev => prev.filter(p => String(p.id) !== String(id)));
    logAudit();
    return true;
  };

  const createDepartment = async (data) => {
    let savedDept = null;
    try {
      const res = await apiFetch('/api/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: data.name, description: data.description || '' })
      });
      if (res.ok) {
        const resData = await res.json();
        savedDept = normalizeDepartment(resData.department);
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || 'Failed to create department.');
      }
    } catch (err) {
      console.error('Failed to sync createDepartment to API:', err);
      alert('Failed to create department. Please check your connection and try again.');
    }

    if (!savedDept) return null;
    setDepartments(prev => [...prev, savedDept].sort((a, b) => a.name.localeCompare(b.name)));

    logAudit({
      actorId: currentUser?.id,
      actorName: currentUser?.name,
      actorRole: currentUser?.role,
      action: 'DEPARTMENT_CREATED',
      entityType: 'department',
      entityId: savedDept.id,
      entityTitle: savedDept.name,
      details: `Created department ${savedDept.name}`
    });

    return savedDept;
  };

  // Renaming cascades server-side to every user/task/ticket/project/
  // feasibility currently pointing at the old name (department.go), so a
  // successful rename here means those records changed too — not just this
  // one row. There's no local-state cascade to mirror that; the affected
  // collections will show the old name until their next fetch. Acceptable
  // for now since nothing currently re-derives visibility from a stale
  // in-memory department string mid-session, but worth knowing if that
  // changes later.
  const updateDepartment = async (id, updates) => {
    const targetId = getBackendId(id);
    if (!targetId) return null;

    let succeeded = false;
    let savedDept = null;
    try {
      const res = await apiFetch(`/api/departments/${targetId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: updates.name,
          description: updates.description !== undefined ? updates.description : undefined
        })
      });
      if (res.ok) {
        const resData = await res.json().catch(() => ({}));
        savedDept = resData.department ? normalizeDepartment(resData.department) : null;
        succeeded = true;
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || 'Failed to update department.');
      }
    } catch (err) {
      console.error('Failed to sync updateDepartment to API:', err);
      alert('Failed to update department. Please check your connection and try again.');
    }

    if (!succeeded) return null;
    setDepartments(prev => prev.map(d => String(d.id) === String(id) ? (savedDept || { ...d, ...updates }) : d)
      .sort((a, b) => a.name.localeCompare(b.name)));

    logAudit({
      actorId: currentUser?.id,
      actorName: currentUser?.name,
      actorRole: currentUser?.role,
      action: 'DEPARTMENT_UPDATED',
      entityType: 'department',
      entityId: id,
      entityTitle: savedDept?.name || updates.name || '',
      details: `Updated department fields: ${Object.keys(updates).join(', ')}`
    });

    return savedDept || true;
  };

  const deleteDepartment = async (id) => {
    const targetId = getBackendId(id);
    const dept = departments.find(d => String(d.id) === String(id));
    if (targetId) {
      try {
        const res = await apiFetch(`/api/departments/${targetId}`, { method: 'DELETE' });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          alert(errData.error || 'Failed to archive department.');
          return false;
        }
      } catch (err) {
        console.error('Failed to sync deleteDepartment to API:', err);
        alert('Failed to delete department. Please check your connection and try again.');
        return false;
      }
    }

    setDepartments(prev => prev.filter(d => String(d.id) !== String(id)));
    if (dept) {
      logAudit({
        actorId: currentUser?.id,
        actorName: currentUser?.name,
        actorRole: currentUser?.role,
        action: 'DEPARTMENT_ARCHIVED',
        entityType: 'department',
        entityId: id,
        entityTitle: dept.name,
        details: `Archived department ${dept.name}`
      });
    }
    return true;
  };

  // Reloads the client list from the server — used after a spreadsheet
  // import, which can add thousands of clients in one request. Returns
  // false when the reload failed (the old list stays in place).
  const reloadClients = async () => {
    try {
      const res = await apiFetch('/api/clients');
      if (!res.ok) return false;
      const data = await res.json();
      setClients((data.clients || []).map(normalizeClient).filter(Boolean));
      return true;
    } catch (err) {
      console.warn('Failed to reload clients:', err);
      return false;
    }
  };

  const createClient = async (data) => {
    const wirePayload = {
      company_name: data.companyName,
      contact_person: data.contactPerson || '',
      email: data.email || '',
      phone: data.phone || '',
      website: data.website || '',
      industry: data.industry || '',
      address: data.address || '',
      city: data.city || '',
      country: data.country || '',
      notes: data.notes || '',
      client_name: data.clientName || '',
      cnic: data.cnic || '',
      mobile: data.mobile || '',
      custom_fields: data.customFields || {},
    };

    let savedClient = null;
    try {
      const res = await apiFetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wirePayload)
      });
      if (res.ok) {
        const resData = await res.json();
        savedClient = normalizeClient(resData.client);
      }
    } catch (err) {
      console.error('Failed to sync createClient to API:', err);
    }

    if (!savedClient) {
      alert('Failed to create client. Please check your connection and try again.');
      return null;
    }

    setClients(prev => [savedClient, ...prev]);

    logAudit({
      actorId: currentUser?.id,
      actorName: currentUser?.name,
      actorRole: currentUser?.role,
      action: 'CLIENT_CREATED',
      entityType: 'client',
      entityId: savedClient.id,
      entityTitle: savedClient.companyName,
      details: `Created client profile for ${savedClient.companyName}`
    });

    return savedClient;
  };

  const updateClient = async (id, updates) => {
    const targetId = getBackendId(id);

    // Same class of fix as updateProject/updateUser — was sending
    // camelCase `updates` directly (companyName, contactPerson, etc.)
    // to a snake_case backend, and never checked res.ok before applying
    // the change to local state regardless of outcome.
    const wirePayload = {};
    if (updates.companyName !== undefined) wirePayload.company_name = updates.companyName;
    if (updates.contactPerson !== undefined) wirePayload.contact_person = updates.contactPerson;
    if (updates.email !== undefined) wirePayload.email = updates.email;
    if (updates.phone !== undefined) wirePayload.phone = updates.phone;
    if (updates.website !== undefined) wirePayload.website = updates.website;
    if (updates.industry !== undefined) wirePayload.industry = updates.industry;
    if (updates.address !== undefined) wirePayload.address = updates.address;
    if (updates.city !== undefined) wirePayload.city = updates.city;
    if (updates.country !== undefined) wirePayload.country = updates.country;
    if (updates.notes !== undefined) wirePayload.notes = updates.notes;
    if (updates.status !== undefined) wirePayload.status = updates.status;
    if (updates.clientName !== undefined) wirePayload.client_name = updates.clientName;
    if (updates.cnic !== undefined) wirePayload.cnic = updates.cnic;
    if (updates.mobile !== undefined) wirePayload.mobile = updates.mobile;
    if (updates.customFields !== undefined) wirePayload.custom_fields = updates.customFields;

    let succeeded = false;
    let savedClient = null;
    if (targetId) {
      try {
        const res = await apiFetch(`/api/clients/${targetId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(wirePayload)
        });
        if (res.ok) {
          const resData = await res.json().catch(() => ({}));
          savedClient = resData.client ? normalizeClient(resData.client) : null;
          succeeded = true;
        } else {
          const errData = await res.json().catch(() => ({}));
          alert(errData.error || 'Failed to update client.');
        }
      } catch (err) {
        console.error('Failed to sync updateClient to API:', err);
        alert('Failed to update client. Please check your connection and try again.');
      }
    }

    if (!succeeded) return null;

    setClients(prev => prev.map(c => String(c.id) === String(id) ? (savedClient || { ...c, ...updates }) : c));

    logAudit({
      actorId: currentUser?.id,
      actorName: currentUser?.name,
      actorRole: currentUser?.role,
      action: 'CLIENT_UPDATED',
      entityType: 'client',
      entityId: id,
      entityTitle: updates.companyName || clients.find(c => String(c.id) === String(id))?.companyName || '',
      details: `Updated client profile fields: ${Object.keys(updates).join(', ')}`
    });

    return savedClient || true;
  };

  const deleteClient = async (id) => {
    const targetId = getBackendId(id);
    let succeeded = false;
    if (targetId) {
      try {
        const res = await apiFetch(`/api/clients/${targetId}`, { method: 'DELETE' });
        if (res.ok) {
          succeeded = true;
        } else {
          // Was unconditionally removed from local state regardless of
          // this response — meaning a client that failed to delete on
          // the backend (permission denied, network error) still
          // vanished from the UI, giving the false impression it was
          // gone when it still existed server-side.
          const errData = await res.json().catch(() => ({}));
          alert(errData.error || 'Failed to delete client.');
        }
      } catch (err) {
        console.error('Failed to sync deleteClient to API:', err);
        alert('Failed to delete client. Please check your connection and try again.');
      }
    }

    if (!succeeded) return false;

    const client = clients.find(c => String(c.id) === String(id));
    setClients(prev => prev.filter(c => String(c.id) !== String(id)));
    if (client) {
      logAudit({
        actorId: currentUser?.id,
        actorName: currentUser?.name,
        actorRole: currentUser?.role,
        action: 'CLIENT_DELETED',
        entityType: 'client',
        entityId: id,
        entityTitle: client.companyName,
        details: `Deleted client profile ${client.companyName}`
      });
    }

    return true;
  };

  // --- Feasibility API Functions ---
  const createFeasibility = async (data) => {
    const wirePayload = {
      feasibility_number: data.feasibilityNumber || undefined,
      client_id: data.clientId,
      product: data.product,
      capacity: data.capacity || '',
      from_location: data.fromLocation || '',
      to_location: data.toLocation || '',
      city: data.city || '',
      requirement_details: data.requirementDetails || '',
      assigned_dept: data.assignedDept || '',
      assigned_user_id: data.assignedUserId || null,
      priority: data.priority || 'normal',
      status: data.status || 'draft',
      target_date: data.targetDate || '',
      notes: data.notes || '',
      vendors: (data.vendors || []).map(v => ({
        vendor_id: v.vendorId || null,
        vendor_name: v.vendorName,
        contact_person: v.contactPerson || '',
        contact_email: v.contactEmail || '',
        contact_phone: v.contactPhone || '',
        quotation_ref: v.quotationRef || '',
        status: v.status || 'pending'
      }))
    };

    let succeeded = false;
    let savedFeasibility = null;
    try {
      const res = await apiFetch('/api/feasibilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wirePayload)
      });
      if (res.ok) {
        const resData = await res.json();
        savedFeasibility = normalizeFeasibility(resData.feasibility);
        succeeded = true;
      } else {
        // Was falling back to a fake local object on ANY failure and
        // returning it as if it were real — meaning a rejected request
        // (missing required product field, network error, anything)
        // still showed success and added a feasibility to the list that
        // didn't actually exist on the backend.
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || 'Failed to create feasibility.');
      }
    } catch (err) {
      console.error('Failed to sync createFeasibility to API:', err);
      alert('Failed to create feasibility. Please check your connection and try again.');
    }

    if (!succeeded) return null;

    setFeasibilities(prev => [savedFeasibility, ...prev]);

    logAudit({
      actorId: currentUser?.id,
      actorName: currentUser?.name,
      actorRole: currentUser?.role,
      action: 'FEASIBILITY_CREATED',
      entityType: 'feasibility',
      entityId: savedFeasibility.id,
      entityTitle: savedFeasibility.feasibilityNumber,
      details: `Created feasibility ${savedFeasibility.feasibilityNumber} for ${savedFeasibility.product} in ${savedFeasibility.city}`
    });

    return savedFeasibility;
  };

  const updateFeasibility = async (id, updates) => {
    // Pinning is per person now (spec slide 28), not a field on the record.
    if (updates && Object.keys(updates).length === 1 && updates.isPinned !== undefined) {
      await togglePin('feasibility', id);
      return true;
    }
    const targetId = getBackendId(id);

    // Same class of fix as updateProject/updateClient above — raw
    // camelCase updates sent directly to a snake_case backend, and no
    // res.ok check before applying the change to local state.
    const wirePayload = {};
    if (updates.product !== undefined) wirePayload.product = updates.product;
    if (updates.capacity !== undefined) wirePayload.capacity = updates.capacity;
    if (updates.fromLocation !== undefined) wirePayload.from_location = updates.fromLocation;
    if (updates.toLocation !== undefined) wirePayload.to_location = updates.toLocation;
    if (updates.city !== undefined) wirePayload.city = updates.city;
    if (updates.clientId !== undefined) wirePayload.client_id = getBackendId(updates.clientId);
    if (updates.requirementDetails !== undefined) wirePayload.requirement_details = updates.requirementDetails;
    if (updates.assignedDept !== undefined) wirePayload.assigned_dept = updates.assignedDept;
    // 0 = unassign (null reads as "not sent" on the backend).
    if (updates.assignedUserId !== undefined) wirePayload.assigned_user_id = getBackendId(updates.assignedUserId) ?? 0;
    if (updates.priority !== undefined) wirePayload.priority = updates.priority;
    if (updates.status !== undefined) wirePayload.status = updates.status;
    if (updates.targetDate !== undefined) wirePayload.target_date = updates.targetDate;
    if (updates.notes !== undefined) wirePayload.notes = updates.notes;

    let succeeded = false;
    let savedFeasibility = null;
    if (targetId) {
      try {
        const res = await apiFetch(`/api/feasibilities/${targetId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(wirePayload)
        });
        if (res.ok) {
          const resData = await res.json().catch(() => ({}));
          savedFeasibility = resData.feasibility ? normalizeFeasibility(resData.feasibility) : null;
          succeeded = true;
        } else {
          const errData = await res.json().catch(() => ({}));
          alert(errData.error || 'Failed to update feasibility.');
        }
      } catch (err) {
        console.error('Failed to sync updateFeasibility to API:', err);
        alert('Failed to update feasibility. Please check your connection and try again.');
      }
    }

    if (!succeeded) return null;

    setFeasibilities(prev => prev.map(f => {
      if (String(f.id) !== String(id)) return f;
      return savedFeasibility || { ...f, ...updates, updatedAt: new Date().toISOString() };
    }));

    const feas = feasibilities.find(f => String(f.id) === String(id));
    if (feas) {
      logAudit({
        actorId: currentUser?.id,
        actorName: currentUser?.name,
        actorRole: currentUser?.role,
        action: 'FEASIBILITY_UPDATED',
        entityType: 'feasibility',
        entityId: id,
        entityTitle: feas.feasibilityNumber,
        details: `Updated feasibility fields: ${Object.keys(updates).join(', ')}`
      });
    }

    return savedFeasibility || true;
  };

  // Was silent on failure (no res.ok check, no return value at all) — a
  // rejected add (missing vendor_name, network error) looked identical to
  // success from the caller's side, since nothing was ever returned to
  // check. Now returns the created vendor on success, null on failure,
  // matching every other create-style function in this file.
  const addFeasibilityVendor = async (feasibilityId, vendorData) => {
    const targetId = getBackendId(feasibilityId);
    if (!targetId) return null;

    try {
      const res = await apiFetch(`/api/feasibilities/${targetId}/vendors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vendorData)
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || 'Failed to add vendor.');
        return null;
      }
      const resData = await res.json();
      // Take the server's full vendor list as the truth. This used to pick
      // the new vendor out with `v.id === resData.vendor?.id`: vendors are
      // serialized with "ID" (not "id") and resData.vendor didn't exist, so
      // it compared undefined === undefined, matched the FIRST vendor every
      // time, and appended a duplicate of it instead of the new one.
      const serverVendors = Array.isArray(resData.feasibility?.vendors)
        ? resData.feasibility.vendors.map(normalizeFeasibilityVendor).filter(Boolean)
        : null;
      const newVendor = normalizeFeasibilityVendor(resData.vendor);
      setFeasibilities(prev => prev.map(f => {
        if (String(f.id) !== String(feasibilityId)) return f;
        const vendors = serverVendors
          || (newVendor ? [...(f.vendors || []), newVendor] : (f.vendors || []));
        return { ...f, vendors, updatedAt: new Date().toISOString() };
      }));
      return newVendor || true;
    } catch (err) {
      console.error('Failed to sync addFeasibilityVendor to API:', err);
      alert('Failed to add vendor. Please check your connection and try again.');
      return null;
    }
  };

  // Was applying `updates` to local state unconditionally, even when the
  // PUT failed or the response was never checked (res.ok was never even
  // read) — so a rejected vendor status change still showed as changed in
  // the UI, permanently, until the next full reload silently reverted it.
  const updateFeasibilityVendor = async (feasibilityId, vendorId, updates) => {
    const targetFeasId = getBackendId(feasibilityId);
    const targetVendorId = getBackendId(vendorId);
    if (!targetFeasId || !targetVendorId) return false;

    try {
      const res = await apiFetch(`/api/feasibilities/${targetFeasId}/vendors/${targetVendorId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || 'Failed to update vendor.');
        return false;
      }
    } catch (err) {
      console.error('Failed to sync updateFeasibilityVendor to API:', err);
      alert('Failed to update vendor. Please check your connection and try again.');
      return false;
    }

    setFeasibilities(prev => prev.map(f => {
      if (String(f.id) === String(feasibilityId)) {
        return {
          ...f,
          vendors: (f.vendors || []).map(v => String(v.id) === String(vendorId) ? { ...v, ...updates } : v),
          updatedAt: new Date().toISOString()
        };
      }
      return f;
    }));
    return true;
  };

  const deleteFeasibilityVendor = async (feasibilityId, vendorId) => {
    const targetFeasId = getBackendId(feasibilityId);
    const targetVendorId = getBackendId(vendorId);
    if (!targetFeasId || !targetVendorId) return;

    try {
      const res = await apiFetch(`/api/feasibilities/${targetFeasId}/vendors/${targetVendorId}`, { method: 'DELETE' });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || 'Failed to remove vendor.');
        return false;
      }
    } catch (err) {
      console.error('Failed to sync deleteFeasibilityVendor to API:', err);
      alert('Failed to remove vendor. Please check your connection and try again.');
      return false;
    }

    setFeasibilities(prev => prev.map(f => {
      if (String(f.id) === String(feasibilityId)) {
        return {
          ...f,
          // Withdrawn, not removed (spec: nothing is hard-deleted).
          vendors: (f.vendors || []).map(v => String(v.id) === String(vendorId)
            ? { ...v, withdrawn: true, withdrawnAt: new Date().toISOString() } : v),
          updatedAt: new Date().toISOString()
        };
      }
      return f;
    }));
    return true;
  };

  // Backend route exists (DELETE /api/feasibilities/:id, gated by
  // create_projects — routes.go) but nothing in this file called it.
  // Mirrors deleteTicket's shape exactly.
  const deleteFeasibility = async (id) => {
    const targetId = getBackendId(id);
    if (targetId) {
      try {
        const res = await apiFetch(`/api/feasibilities/${targetId}`, { method: 'DELETE' });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          alert(errData.error || 'Failed to archive feasibility.');
          return false;
        }
      } catch (err) {
        console.error('Failed to sync deleteFeasibility to API:', err);
        alert('Failed to archive feasibility. Please check your connection and try again.');
        return false;
      }
    }

    const feas = feasibilities.find(f => String(f.id) === String(id));
    setFeasibilities(prev => prev.filter(f => String(f.id) !== String(id)));
    if (feas) {
      logAudit({
        actorId: currentUser?.id,
        actorName: currentUser?.name,
        actorRole: currentUser?.role,
        action: 'FEASIBILITY_DELETED',
        entityType: 'feasibility',
        entityId: id,
        entityTitle: feas.feasibilityNumber,
        details: `Archived feasibility ${feas.feasibilityNumber}`
      });
    }
    return true;
  };

  const convertFeasibilityToProject = async (feasibilityId, projectData) => {
    const targetId = getBackendId(feasibilityId);
    if (!targetId) return;

    try {
      const res = await apiFetch(`/api/feasibilities/${targetId}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(projectData)
      });
      if (res.ok) {
        const resData = await res.json();
        setFeasibilities(prev => prev.map(f => {
          if (String(f.id) === String(feasibilityId)) {
            return { 
              ...f, 
              status: 'converted', 
              convertedProjectId: resData.project?.id,
              convertedProject: resData.project,
              convertedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString() 
            };
          }
          return f;
        }));
        if (resData.project) {
          const newProject = normalizeProject(resData.project);
          setProjects(prev => [newProject, ...prev]);
        }
      }
    } catch (err) {
      console.error('Failed to sync convertFeasibilityToProject to API:', err);
    }
  };

  const addProjectAttachment = (projectId, attachment) => {
    const project = projects.find(p => String(p.id) === String(projectId));
    if (!project) return;

    const newAttachment = {
      id: `att_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      uploadedBy: currentUser?.id,
      uploadedByName: currentUser?.name,
      uploadedAt: new Date().toISOString(),
      ...attachment
    };

    setProjects(prev => prev.map(p => {
      if (String(p.id) === String(projectId)) {
        return {
          ...p,
          attachments: [...(p.attachments || []), newAttachment],
          updatedAt: new Date().toISOString()
        };
      }
      return p;
    }));

    logAudit({
      actorId: currentUser?.id,
      actorName: currentUser?.name,
      actorRole: currentUser?.role,
      action: 'PROJECT_ATTACHMENT_ADDED',
      entityType: 'project',
      entityId: projectId,
      entityTitle: project.title,
      details: `Uploaded file: ${newAttachment.name}`
    });
  };

  // Re-read one project so its progress (calculated from its tasks on the
  // server) updates as soon as a task changes, not only after a reload.
  const refreshProjectProgress = async (projectId) => {
    const id = getBackendId(projectId);
    if (!id) return;
    try {
      const res = await apiFetch(`/api/projects/${id}`);
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      if (!data.project) return;
      const fresh = normalizeProject(data.project);
      setProjects(prev => prev.map(p => String(p.id) === String(projectId)
        // Status too: it moves automatically with the tasks (backend
        // syncProjectStatusFromTasks).
        ? { ...p, progress: fresh.progress, tasksTotal: fresh.tasksTotal, tasksDone: fresh.tasksDone, status: fresh.status }
        : p));
    } catch {
      // Best effort — the next reload shows it anyway.
    }
  };

  const createTask = async (data) => {
    const count = (tasks || []).length + 101;
    const taskNumber = data.taskNumber || `TSK-${count}`;

    const assignee = findUserByAnyId(allUsers, data.assignedToId);
    const supervisorId = assignee?.supervisorId ?? data.supervisorId ?? null;
    const adminId = assignee?.adminId ?? data.adminId ?? null;

    const basePayload = {
      labels: [],
      subTasks: [],
      checklists: [],
      comments: [],
      description: '',
      dueDate: new Date().toISOString().split('T')[0],
      progress: 0,
      isPinned: false,
      ...data,
      taskNumber,
      actualHours: data.actualHours ?? 0,
      supervisorId,
      adminId,
    };

    const wirePayload = {
      task_number: taskNumber,
      title: basePayload.title,
      description: basePayload.description,
      department: basePayload.department || currentUser?.department || '',
      status: basePayload.status || 'todo',
      priority: basePayload.priority || 'normal',
      labels: Array.isArray(basePayload.labels) ? basePayload.labels.join(',') : (basePayload.labels || ''),
      project_id: getBackendId(basePayload.projectId) || null,
      // Checklist items created with the task (one request).
      checklist: Array.isArray(basePayload.checklistItems) ? basePayload.checklistItems : [],
      ticket_id: getBackendId(basePayload.ticketId) || null,
      assignee_id: assignee?.id ?? getBackendId(basePayload.assignedToId) ?? null,
      creator_id: currentUser?.id ?? null,
      start_date: toRFC3339(basePayload.startDate),
      due_date: toRFC3339(basePayload.dueDate),
      estimated_hours: basePayload.estimatedHours ?? 0,
      is_private: !!basePayload.isPrivate,
    };

    let savedTask = null;
    try {
      const res = await apiFetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wirePayload)
      });
      if (res.ok) {
        const resData = await res.json();
        savedTask = normalizeTask(resData.task);
      } else {
        // Was silently falling through to a made-up local task, so a refused
        // request (no create_tasks permission, validation error) still looked
        // like success and the "task" vanished on the next reload.
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || 'Failed to create task.');
        return null;
      }
    } catch (err) {
      console.error('Failed to sync createTask to API:', err);
      alert('Failed to create task. Please check your connection and try again.');
      return null;
    }

    if (!savedTask) return null;
    const newTask = savedTask;

    setTasks(prev => [newTask, ...(prev || [])]);

    if (currentUser) {
      logAudit({
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.role,
        action: 'TASK_CREATED',
        entityType: 'task',
        entityId: newTask.id,
        entityTitle: `${newTask.taskNumber}: ${newTask.title}`,
        details: `Created task assigned to ${assignee?.name || 'Unassigned'} with priority ${newTask.priority}`
      });
    }

    if (newTask.assignedToId && currentUser && String(newTask.assignedToId) !== String(currentUser.id)) {
      pushNotification({
        recipientId: newTask.assignedToId,
        title: 'New Task Assignment',
        message: `You were assigned ${newTask.taskNumber}: ${newTask.title}`,
        type: 'assignment',
        entityType: 'task',
        entityId: newTask.id
      });
    }

    refreshProjectProgress(newTask?.projectId);
    return newTask;
  };

  const updateTask = async (id, updates) => {
    // Pinning is per person now (spec slide 28), not a field on the record.
    if (updates && Object.keys(updates).length === 1 && updates.isPinned !== undefined) {
      await togglePin('task', id);
      return true;
    }
    const targetId = getBackendId(id);

    // This used to spread the camelCase `updates` straight onto the wire
    // (assignedToId, dueDate, startDate, estimatedHours, ...). The backend
    // binds snake_case (assignee_id, due_date, ...), so it ignored every
    // one of those, answered 200 with the task unchanged, and the UI then
    // replaced its state with that unchanged copy — reassigning a task or
    // changing its dates silently did nothing. Only fields the backend's
    // UpdateTaskInput actually accepts are sent.
    const wireUpdates = {};
    if (updates.title !== undefined) wireUpdates.title = updates.title;
    if (updates.description !== undefined) wireUpdates.description = updates.description;
    if (updates.priority !== undefined) wireUpdates.priority = updates.priority;
    if (updates.status !== undefined) {
      wireUpdates.status = updates.status;
      const current = (tasks || []).find(t => String(t.id) === String(id));
      if (!current || current.status !== updates.status) {
        const reason = askStatusReason('task', updates.status, updates.statusReason || '');
        if (reason === null) return null;
        if (reason) wireUpdates.status_reason = reason;
      }
    }
    if (updates.assignedToId !== undefined && updates.assignedToId !== '' && updates.assignedToId !== null) {
      wireUpdates.assignee_id = getBackendId(updates.assignedToId);
    }
    if (updates.dueDate) wireUpdates.due_date = toRFC3339(updates.dueDate);
    if (updates.startDate) wireUpdates.start_date = toRFC3339(updates.startDate);
    if (updates.storyPoints !== undefined) wireUpdates.story_points = Number(updates.storyPoints) || 0;
    if (updates.labels !== undefined) {
      wireUpdates.labels = Array.isArray(updates.labels) ? updates.labels.join(',') : (updates.labels || '');
    }
    if (updates.estimatedHours !== undefined) wireUpdates.estimated_hours = Number(updates.estimatedHours) || 0;
    if (updates.actualHours !== undefined) wireUpdates.actual_hours = Number(updates.actualHours) || 0;
    if (updates.isPinned !== undefined) wireUpdates.is_pinned = !!updates.isPinned;
    if (updates.isPrivate !== undefined) wireUpdates.is_private = !!updates.isPrivate;

    let savedTask = null;
    if (targetId) {
      try {
        const res = await apiFetch(`/api/tasks/${targetId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(wireUpdates)
        });
        const resData = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(resData.error || 'Failed to update task.');
          return null;
        }
        savedTask = normalizeTask(resData.task);
      } catch (err) {
        console.error('Failed to sync updateTask to API:', err);
        alert('Failed to update task. Please check your connection and try again.');
        return null;
      }
    }

    setTasks(prev => (prev || []).map(t => {
      if (String(t.id) === String(id)) {
        return savedTask || { ...t, ...updates, updatedAt: new Date().toISOString() };
      }
      return t;
    }));

    const task = (tasks || []).find(t => String(t.id) === String(id));
    if (task && currentUser) {
      logAudit({
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.role,
        action: 'TASK_UPDATED',
        entityType: 'task',
        entityId: id,
        entityTitle: `${task.taskNumber}: ${task.title}`,
        details: `Updated task properties: ${Object.keys(updates).join(', ')}`
      });
    }

    refreshProjectProgress((tasks.find(t => String(t.id) === String(id)) || {}).projectId);
    return savedTask || true;
  };

  // reason: required for some statuses (catalog); asked for here if missing.
  const updateTaskStatus = async (id, newStatus, reason = '') => {
    const task = (tasks || []).find(t => String(t.id) === String(id));
    if (!task) return false;
    if (task.status === newStatus) return true;
    const finalReason = askStatusReason('task', newStatus, reason);
    if (finalReason === null) return false;

    const targetId = getBackendId(id);
    let savedTask = null;
    if (targetId) {
      try {
        const res = await apiFetch(`/api/tasks/${targetId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus, reason: finalReason })
        });
        const resData = await res.json().catch(() => ({}));
        if (!res.ok) {
          // The response used to be ignored, so a rejected change still
          // showed as applied until the next reload.
          alert(resData.error || 'Failed to update task status.');
          return false;
        }
        // The backend now returns the full task (all relations), so it's
        // used as-is. The old local progress guess (in_progress -> 25%)
        // didn't match anything the server stores.
        savedTask = resData.task ? normalizeTask(resData.task) : null;
      } catch (err) {
        console.error('Failed to sync updateTaskStatus to API:', err);
        alert('Failed to update task status. Please check your connection and try again.');
        return false;
      }
    }

    if (newStatus === 'done' && typeof confetti === 'function') {
      confetti({ particleCount: 50, spread: 60, origin: { y: 0.7 } });
    }

    setTasks(prev => (prev || []).map(t => {
      if (String(t.id) !== String(id)) return t;
      return savedTask || { ...t, status: newStatus, updatedAt: new Date().toISOString() };
    }));

    if (currentUser) {
      logAudit({
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.role,
        action: 'TASK_STATUS_CHANGED',
        entityType: 'task',
        entityId: id,
        entityTitle: `${task.taskNumber}: ${task.title}`,
        details: `Status transitioned from ${task.status.toUpperCase()} to ${newStatus.toUpperCase()}`
      });
    }

    if (task.supervisorId && currentUser && String(task.supervisorId) !== String(currentUser.id)) {
      pushNotification({
        recipientId: task.supervisorId,
        title: 'Task Status Updated',
        message: `${task.taskNumber} status changed to ${newStatus} by ${currentUser.name}`,
        type: 'status_change',
        entityType: 'task',
        entityId: id
      });
    }
    refreshProjectProgress(task.projectId);
    return true;
  };

  const submitTaskForReview = async (id, notes) => {
    const task = (tasks || []).find(t => String(t.id) === String(id));
    if (!task) return;

    const targetId = getBackendId(id);
    let savedTask = null;
    try {
      const res = await apiFetch(`/api/tasks/${targetId}/submit-review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notes || '' })
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(resData.error || 'Failed to submit task for review.');
        return;
      }
      savedTask = normalizeTask(resData.task);
    } catch (err) {
      console.error('Failed to sync submitTaskForReview to API:', err);
      alert('Failed to submit task for review. Please check your connection and try again.');
      return;
    }

    setTasks(prev => (prev || []).map(t => String(t.id) === String(id) ? savedTask : t));

    if (currentUser) {
      logAudit({
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.role,
        action: 'TASK_SUBMITTED_FOR_REVIEW',
        entityType: 'task',
        entityId: id,
        entityTitle: `${task.taskNumber}: ${task.title}`,
        details: `Submitted for review by ${currentUser.name}. Notes: ${notes || 'None'}`
      });
    }

    if (task.supervisorId && currentUser) {
      pushNotification({
        recipientId: task.supervisorId,
        title: 'Task Ready for Review',
        message: `${currentUser.name} submitted ${task.taskNumber} for your review.`,
        type: 'review',
        entityType: 'task',
        entityId: id
      });
    }
  };

  const approveTask = async (id, notes) => {
    const task = (tasks || []).find(t => String(t.id) === String(id));
    if (!task || !currentUser) return;

    const targetId = getBackendId(id);
    let savedTask = null;
    try {
      const res = await apiFetch(`/api/tasks/${targetId}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notes || '' })
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(resData.error || 'Failed to approve task.');
        return;
      }
      savedTask = normalizeTask(resData.task);
    } catch (err) {
      console.error('Failed to sync approveTask to API:', err);
      alert('Failed to approve task. Please check your connection and try again.');
      return;
    }

    setTasks(prev => (prev || []).map(t => String(t.id) === String(id) ? savedTask : t));

    if (typeof confetti === 'function') {
      confetti({ particleCount: 70, spread: 80, origin: { y: 0.6 } });
    }

    logAudit({
      actorId: currentUser.id,
      actorName: currentUser.name,
      actorRole: currentUser.role,
      action: 'TASK_APPROVED',
      entityType: 'task',
      entityId: id,
      entityTitle: `${task.taskNumber}: ${task.title}`,
      details: `Work approved by ${currentUser.name} (${currentUser.role}).`
    });

    pushNotification({
      recipientId: task.assignedToId,
      title: 'Task Approved! 🎉',
      message: `Your task ${task.taskNumber} was approved by ${currentUser.name}.`,
      type: 'review',
      entityType: 'task',
      entityId: id
    });
    refreshProjectProgress((tasks.find(t => String(t.id) === String(id)) || {}).projectId);
  };

  const reopenTask = async (id, notes) => {
    const task = (tasks || []).find(t => String(t.id) === String(id));
    if (!task || !currentUser) return;

    const targetId = getBackendId(id);
    let savedTask = null;
    try {
      const res = await apiFetch(`/api/tasks/${targetId}/reopen`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notes || '' })
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(resData.error || 'Failed to reopen task.');
        return;
      }
      savedTask = normalizeTask(resData.task);
    } catch (err) {
      console.error('Failed to sync reopenTask to API:', err);
      alert('Failed to reopen task. Please check your connection and try again.');
      return;
    }

    setTasks(prev => (prev || []).map(t => String(t.id) === String(id) ? savedTask : t));

    logAudit({
      actorId: currentUser.id,
      actorName: currentUser.name,
      actorRole: currentUser.role,
      action: 'TASK_REOPENED',
      entityType: 'task',
      entityId: id,
      entityTitle: `${task.taskNumber}: ${task.title}`,
      details: `Task reopened by ${currentUser.name}. Notes: ${notes || 'None'}`
    });

    pushNotification({
      recipientId: task.assignedToId,
      title: 'Task Reopened',
      message: `${task.taskNumber} was returned for revision by ${currentUser.name}.`,
      type: 'status_change',
      entityType: 'task',
      entityId: id
    });
    refreshProjectProgress((tasks.find(t => String(t.id) === String(id)) || {}).projectId);
  };

  const toggleChecklistItem = async (taskId, checklistId) => {
    const targetId = getBackendId(checklistId);
    let savedItem = null;
    try {
      const res = await apiFetch(`/api/checklists/${targetId}/toggle`, { method: 'PATCH' });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Used to fall through and tick the box locally anyway, so a refused
        // toggle looked saved until the next reload.
        alert(resData.error || 'Failed to update checklist item.');
        return;
      }
      savedItem = normalizeChecklistItem(resData.checklist);
    } catch (err) {
      console.error('Failed to sync toggleChecklistItem to API:', err);
      alert('Failed to update checklist item. Please check your connection and try again.');
      return;
    }

    setTasks(prev => prev.map(t => {
      if (String(t.id) === String(taskId)) {
        const updatedChecklists = (t.checklists || []).map(c => {
          if (String(c.id) === String(checklistId)) {
            if (savedItem) return savedItem;
            const nextCompleted = !c.completed;
            return {
              ...c,
              completed: nextCompleted,
              completedBy: nextCompleted ? currentUser?.id : null,
              completedAt: nextCompleted ? new Date().toISOString() : null
            };
          }
          return c;
        });

        const completedCount = updatedChecklists.filter(c => c.completed).length;
        const total = updatedChecklists.length;
        const calcProgress = total > 0 ? Math.round((completedCount / total) * 100) : t.progress;

        return {
          ...t,
          checklists: updatedChecklists,
          progress: calcProgress,
          updatedAt: new Date().toISOString()
        };
      }
      return t;
    }));
  };

  const addChecklistItem = async (taskId, title) => {
    const targetTaskId = getBackendId(taskId);
    let savedItem = null;
    try {
      const res = await apiFetch('/api/checklists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: targetTaskId, title })
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(resData.error || 'Failed to add checklist item.');
        return;
      }
      savedItem = normalizeChecklistItem(resData.checklist);
    } catch (err) {
      console.error('Failed to sync addChecklistItem to API:', err);
      alert('Failed to add checklist item. Please check your connection and try again.');
      return;
    }

    setTasks(prev => prev.map(t => {
      if (String(t.id) === String(taskId)) {
        return {
          ...t,
          checklists: [...(t.checklists || []), savedItem],
          updatedAt: new Date().toISOString()
        };
      }
      return t;
    }));
  };

  // assignedToId / dueDate are optional. It used to always assign the
  // sub-task to whoever created it (the form had no assignee picker), so a
  // sub-task could never be handed to anyone else.
  const addSubTask = async (taskId, title, assignedToId = null, priority = 'normal', dueDate = '') => {
    const targetTaskId = getBackendId(taskId);
    const resolvedAssigneeId = getBackendId(assignedToId) || null;

    let savedSub = null;
    try {
      // Was POSTing to the flat "/api/subtasks" — the real route is
      // nested under its parent task (tasks.POST("/:id/subtasks", ...)
      // in routes.go), which is why every subtask creation was 404ing.
      const res = await apiFetch(`/api/tasks/${targetTaskId}/subtasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          task_id: targetTaskId,
          assignee_id: resolvedAssigneeId,
          priority,
          deadline: dueDate || '',
        })
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(resData.error || 'Failed to add subtask.');
        return null;
      }
      savedSub = normalizeSubTask(resData.subtask);
    } catch (err) {
      console.error('Failed to sync addSubTask to API:', err);
      alert('Failed to add subtask. Please check your connection and try again.');
      return null;
    }

    setTasks(prev => prev.map(t => {
      if (String(t.id) === String(taskId)) {
        return {
          ...t,
          subTasks: [...(t.subTasks || []), savedSub],
          updatedAt: new Date().toISOString()
        };
      }
      return t;
    }));
    return savedSub;
  };

  // Reassign (or clear, with an empty value) a sub-task's assignee. The
  // backend requires the "Reassign Tickets & Tasks" permission and logs the
  // change. Returns true on success.
  const updateSubTaskAssignee = async (taskId, subTaskId, assigneeId) => {
    const targetSubTaskId = getBackendId(subTaskId);
    if (!targetSubTaskId) return false;
    let savedSub = null;
    try {
      const res = await apiFetch(`/api/tasks/subtasks/${targetSubTaskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // 0 = unassign (null would read as "not sent" on the backend).
        body: JSON.stringify({ assignee_id: getBackendId(assigneeId) || 0 })
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(resData.error || 'Failed to reassign sub-task.');
        return false;
      }
      savedSub = normalizeSubTask(resData.subtask);
    } catch (err) {
      console.error('Failed to reassign sub-task:', err);
      alert('Failed to reassign sub-task. Please check your connection and try again.');
      return false;
    }
    setTasks(prev => prev.map(t => {
      if (String(t.id) !== String(taskId)) return t;
      return {
        ...t,
        subTasks: (t.subTasks || []).map(st => String(st.id) === String(subTaskId) ? (savedSub || st) : st),
        updatedAt: new Date().toISOString()
      };
    }));
    logAudit();
    return true;
  };

  // ---- Record-level access grants on a task (spec slide 16) ----
  const normalizeGrant = (g) => g && ({
    id: g.id,
    userId: g.user_id,
    userName: g.user?.name || '',
    userDepartment: g.user?.department || '',
    grantedById: g.granted_by_id,
    grantedByName: g.granted_by?.name || '',
    createdAt: g.created_at,
  });

  // kind: 'tasks' | 'clients' (the API path segment).
  const fetchRecordAccess = async (kind, recordId) => {
    const id = getBackendId(recordId);
    if (!id) return [];
    const res = await apiFetch(`/api/${kind}/${id}/access`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to load access list');
    return (data.access || []).map(normalizeGrant).filter(Boolean);
  };

  const grantRecordAccess = async (kind, recordId, userId) => {
    const id = getBackendId(recordId);
    const uid = getBackendId(userId);
    if (!id || !uid) return null;
    try {
      const res = await apiFetch(`/api/${kind}/${id}/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: uid })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Failed to grant access.');
        return null;
      }
      logAudit();
      return normalizeGrant(data.access);
    } catch (err) {
      console.error('Failed to grant access:', err);
      alert('Failed to grant access. Please check your connection and try again.');
      return null;
    }
  };

  const revokeRecordAccess = async (kind, recordId, userId) => {
    const id = getBackendId(recordId);
    const uid = getBackendId(userId);
    if (!id || !uid) return false;
    try {
      const res = await apiFetch(`/api/${kind}/${id}/access/${uid}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Failed to revoke access.');
        return false;
      }
      logAudit();
      return true;
    } catch (err) {
      console.error('Failed to revoke access:', err);
      alert('Failed to revoke access. Please check your connection and try again.');
      return false;
    }
  };

  const fetchTaskAccess = (taskId) => fetchRecordAccess('tasks', taskId);
  const grantTaskAccess = (taskId, userId) => grantRecordAccess('tasks', taskId, userId);
  const revokeTaskAccess = (taskId, userId) => revokeRecordAccess('tasks', taskId, userId);

  // Bring a withdrawn feasibility vendor back.
  const reinstateFeasibilityVendor = async (feasibilityId, vendorId) => {
    const fid = getBackendId(feasibilityId);
    const vid = getBackendId(vendorId);
    if (!fid || !vid) return false;
    try {
      const res = await apiFetch(`/api/feasibilities/${fid}/vendors/${vid}/reinstate`, { method: 'PATCH' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Failed to reinstate vendor.');
        return false;
      }
    } catch (err) {
      alert('Failed to reinstate vendor. Please check your connection and try again.');
      return false;
    }
    setFeasibilities(prev => prev.map(f => String(f.id) !== String(feasibilityId) ? f : {
      ...f,
      vendors: (f.vendors || []).map(v => String(v.id) === String(vendorId) ? { ...v, withdrawn: false, withdrawnAt: null } : v),
    }));
    logAudit();
    return true;
  };

  // Archive a user (replaces delete: they can't sign in, their name stays on
  // past work). Refused by the server while they still have open work.
  const archiveUser = async (userId) => {
    const id = getBackendId(userId);
    if (!id) return false;
    try {
      const res = await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Failed to archive user.');
        return false;
      }
    } catch (err) {
      alert('Failed to archive user. Please check your connection and try again.');
      return false;
    }
    setAllUsers(prev => prev.map(u => String(u.id) === String(userId) ? { ...u, status: 'archived' } : u));
    logAudit();
    return true;
  };

  const updateSubTaskStatus = async (taskId, subTaskId, status) => {
    const targetSubTaskId = getBackendId(subTaskId);
    let savedSub = null;
    try {
      const res = await apiFetch(`/api/tasks/subtasks/${targetSubTaskId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        const resData = await res.json();
        savedSub = normalizeSubTask(resData.subtask);
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || 'Failed to update sub-task status.');
        return false;
      }
    } catch (err) {
      console.error('Failed to sync subtask status to API:', err);
      alert('Failed to update sub-task status. Please check your connection and try again.');
      return false;
    }

    setTasks(prev => prev.map(t => {
      if (String(t.id) === String(taskId)) {
        return {
          ...t,
          subTasks: (t.subTasks || []).map(st => {
            if (String(st.id) !== String(subTaskId)) return st;
            return savedSub || { ...st, status };
          }),
          updatedAt: new Date().toISOString()
        };
      }
      return t;
    }));
    return true;
  };

  const addTaskComment = async (taskId, content, isInternal = false) => {
    const targetTaskId = getBackendId(taskId);
    let savedComment = null;
    try {
      // Was POSTing to the flat "/api/comments" — the real route is
      // nested under the parent task (tasks.POST("/:id/comments", ...)
      // in routes.go).
      const res = await apiFetch(`/api/tasks/${targetTaskId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          task_id: targetTaskId,
          user_id: getBackendId(currentUser?.id) || null,
          is_internal: isInternal,
        })
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(resData.error || 'Failed to post comment.');
        return null;
      }
      savedComment = normalizeComment(resData.comment);
    } catch (err) {
      console.error('Failed to sync comment to API:', err);
      alert('Failed to post comment. Please check your connection and try again.');
      return null;
    }

    setTasks(prev => prev.map(t => {
      if (String(t.id) === String(taskId)) {
        return {
          ...t,
          comments: [...(t.comments || []), savedComment],
          updatedAt: new Date().toISOString()
        };
      }
      return t;
    }));

    const task = tasks.find(t => String(t.id) === String(taskId));
    // No "new comment" notification for an internal note: the assignee may
    // not be allowed to see it.
    if (task && !isInternal && String(task.assignedToId) !== String(currentUser?.id)) {
      pushNotification({
        recipientId: task.assignedToId,
        title: 'New Comment on Task',
        message: `${currentUser?.name} commented on ${task.taskNumber}`,
        type: 'comment',
        entityType: 'task',
        entityId: taskId
      });
    }
    return savedComment;
  };

  // Archives the task. Only removed from the UI when the server confirms —
  // it used to vanish locally even when the request was refused.
  const deleteTask = async (id) => {
    const targetId = getBackendId(id);
    if (!targetId) return false;
    try {
      const res = await apiFetch(`/api/tasks/${targetId}`, { method: 'DELETE' });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || 'Failed to archive task.');
        return false;
      }
    } catch (err) {
      console.error('Failed to sync deleteTask to API:', err);
      alert('Failed to archive task. Please check your connection and try again.');
      return false;
    }

    setTasks(prev => prev.filter(t => String(t.id) !== String(id)));
    logAudit();
    refreshProjectProgress((tasks.find(t => String(t.id) === String(id)) || {}).projectId);
    return true;
  };

  const addTaskDependency = async (taskId, dependsOnTaskId) => {
    const targetId = getBackendId(taskId);
    const dependsOnId = getBackendId(dependsOnTaskId);
    let savedTask = null;
    try {
      const res = await apiFetch(`/api/tasks/${targetId}/dependencies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depends_on_task_id: dependsOnId })
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(resData.error || 'Failed to add dependency.');
        return;
      }
      savedTask = normalizeTask(resData.task);
    } catch (err) {
      console.error('Failed to sync addTaskDependency to API:', err);
      alert('Failed to add dependency. Please check your connection and try again.');
      return;
    }

    setTasks(prev => prev.map(t => String(t.id) === String(taskId) ? savedTask : t));
  };

  const removeTaskDependency = async (taskId, dependsOnTaskId) => {
    const targetId = getBackendId(taskId);
    const dependsOnId = getBackendId(dependsOnTaskId);
    let savedTask = null;
    try {
      const res = await apiFetch(`/api/tasks/${targetId}/dependencies/${dependsOnId}`, { method: 'DELETE' });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(resData.error || 'Failed to remove dependency.');
        return;
      }
      savedTask = resData.task ? normalizeTask(resData.task) : null;
    } catch (err) {
      console.error('Failed to sync removeTaskDependency to API:', err);
      alert('Failed to remove dependency. Please check your connection and try again.');
      return;
    }

    setTasks(prev => prev.map(t => {
      if (String(t.id) !== String(taskId)) return t;
      if (savedTask) return savedTask;
      return { ...t, dependencies: (t.dependencies || []).filter(d => String(d.id) !== String(dependsOnTaskId)) };
    }));
  };

  const createTicket = async (data) => {
    const assignee = findUserByAnyId(allUsers, data.assignedToId);

    // Only fields CreateTicketInput (ticket.go) binds. This used to send
    // due_date / response_sla_minutes / requester_* / status, none of which
    // the backend reads — so no ticket ever got an SLA deadline. The SLA is
    // now either sent explicitly (slaMinutes) or derived server-side from
    // the priority.
    const wirePayload = {
      title: data.title,
      description: data.description || '',
      department: data.department || currentUser?.department || '',
      category: data.category || 'incident',
      priority: data.priority || 'normal',
      project_id: getBackendId(data.projectId) || null,
      client_id: getBackendId(data.clientId) || null,
      assigned_to_id: assignee?.id ?? getBackendId(data.assignedToId) ?? null,
      is_private: !!data.isPrivate,
    };
    if (data.severity) wirePayload.severity = data.severity;
    if (data.source) wirePayload.source = data.source;
    if (Number(data.slaMinutes) > 0) wirePayload.sla_minutes = Number(data.slaMinutes);

    // No local fallback. It used to invent a ticket with a fake `tck_` id when
    // the request failed, and ALWAYS spawn a local-only "Resolve:" task with a
    // fake `tsk_` id that was never saved. getBackendId() pulls the digits out
    // of those ids, so acting on the phantom task could hit a real, unrelated
    // task on the server.
    let newTicket = null;
    try {
      const res = await apiFetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wirePayload)
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(resData.error || 'Failed to create ticket.');
        return null;
      }
      newTicket = normalizeTicket(resData.ticket);
    } catch (err) {
      console.error('Failed to sync createTicket to API:', err);
      alert('Failed to create ticket. Please check your connection and try again.');
      return null;
    }
    if (!newTicket) return null;

    setTickets(prev => [newTicket, ...prev]);

    logAudit({
      actorId: currentUser?.id,
      actorName: currentUser?.name,
      actorRole: currentUser?.role,
      action: 'TICKET_CREATED',
      entityType: 'ticket',
      entityId: newTicket.id,
      entityTitle: `${newTicket.ticketNumber}: ${newTicket.title}`,
      details: `Created new ${newTicket.priority} ticket ${newTicket.ticketNumber}`
    });

    if (newTicket.assignedToId && String(newTicket.assignedToId) !== String(currentUser?.id)) {
      pushNotification({
        recipientId: newTicket.assignedToId,
        title: 'New Ticket Assigned',
        message: `You were assigned ${newTicket.ticketNumber} (${(newTicket.priority || 'normal').toUpperCase()} priority)`,
        type: 'assignment',
        entityType: 'ticket',
        entityId: newTicket.id
      });
    }

    return newTicket;
  };

  const updateTicket = async (id, updates) => {
    // Pinning is per person now (spec slide 28), not a field on the record.
    if (updates && Object.keys(updates).length === 1 && updates.isPinned !== undefined) {
      await togglePin('ticket', id);
      return true;
    }
    const targetId = getBackendId(id);
    const hasAssignedProp = 'assignedToId' in updates || 'assigned_to_id' in updates;
    const rawAssignedId = updates.assignedToId !== undefined ? updates.assignedToId : updates.assigned_to_id;

    const targetUser = findUserByAnyId(allUsers, rawAssignedId);

    const canonicalAssignedId = targetUser ? targetUser.id : (rawAssignedId && rawAssignedId !== 'unassigned' ? rawAssignedId : null);
    const apiAssignedId = targetUser ? (targetUser.backendId || getBackendId(targetUser.id)) : getBackendId(rawAssignedId);

    // Only fields UpdateTicketInput binds. This used to spread the whole
    // camelCase `updates` object onto the wire, so anything not named the same
    // as its backend field (isPinned, ...) was silently ignored, and the
    // response was never checked, so a refused change still showed as saved.
    const wire = {};
    ['title', 'description', 'category', 'priority', 'severity', 'status', 'department'].forEach(key => {
      if (updates[key] !== undefined) wire[key] = updates[key];
    });
    if (updates.status !== undefined) {
      const current = tickets.find(t => String(t.id) === String(id));
      if (!current || current.status !== updates.status) {
        const reason = askStatusReason('ticket', updates.status, updates.statusReason || '');
        if (reason === null) return null;
        if (reason) wire.status_reason = reason;
      }
    }
    if (updates.isPinned !== undefined) wire.is_pinned = !!updates.isPinned;
    if (updates.isPrivate !== undefined) wire.is_private = !!updates.isPrivate;
    if (updates.projectId !== undefined && updates.projectId !== '') wire.project_id = getBackendId(updates.projectId);
    if (hasAssignedProp && apiAssignedId) wire.assigned_to_id = apiAssignedId;

    if (targetId) {
      try {
        const res = await apiFetch(`/api/tickets/${targetId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(wire)
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          alert(errData.error || 'Failed to update ticket.');
          return null;
        }
      } catch (err) {
        console.error('Failed to sync updateTicket to API:', err);
        alert('Failed to update ticket. Please check your connection and try again.');
        return null;
      }
    }

    setTickets(prev => prev.map(t => {
      if (String(t.id) === String(id)) {
        return { 
          ...t, 
          ...updates, 
          assignedToId: hasAssignedProp ? canonicalAssignedId : t.assignedToId,
          supervisorId: targetUser?.supervisorId || t.supervisorId,
          adminId: targetUser?.adminId || t.adminId,
          updatedAt: new Date().toISOString() 
        };
      }
      return t;
    }));

    const ticket = tickets.find(t => String(t.id) === String(id));
    if (ticket) {
      logAudit({
        actorId: currentUser?.id,
        actorName: currentUser?.name,
        actorRole: currentUser?.role,
        action: 'TICKET_UPDATED',
        entityType: 'ticket',
        entityId: id,
        entityTitle: `${ticket.ticketNumber}: ${ticket.title}`,
        details: `Updated ticket properties: ${Object.keys(updates).join(', ')}`
      });
    }
    return true;
  };

  // reason: required for some statuses (catalog); asked for here if missing.
  // A resolution summary counts as the reason for "resolved".
  const updateTicketStatus = async (id, status, resolutionSummary, reason = '') => {
    const ticket = tickets.find(t => String(t.id) === String(id));
    if (!ticket) return false;
    const finalReason = askStatusReason('ticket', status,
      reason || (status === 'resolved' ? (resolutionSummary || '') : ''));
    if (finalReason === null) return false;

    const now = new Date().toISOString();
    const resolvedAt = (status === 'resolved' || status === 'closed') ? (ticket.resolvedAt || now) : undefined;
    const closedAt = status === 'closed' ? (ticket.closedAt || now) : undefined;

    const targetId = getBackendId(id);
    let serverTicket = null;
    if (targetId) {
      try {
        const res = await apiFetch(`/api/tickets/${targetId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, resolution_summary: resolutionSummary, reason: finalReason })
        });
        const resData = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(resData.error || 'Failed to update ticket status.');
          return false;
        }
        serverTicket = resData.ticket || null;
      } catch (err) {
        console.error('Failed to sync updateTicketStatus to API:', err);
        alert('Failed to update ticket status. Please check your connection and try again.');
        return false;
      }
    }

    setTickets(prev => prev.map(t => {
      if (String(t.id) === String(id)) {
        return {
          ...t,
          status,
          // Server's values (reopening clears them).
          resolvedAt: serverTicket ? (serverTicket.resolved_at || null) : resolvedAt,
          closedAt: serverTicket ? (serverTicket.closed_at || null) : closedAt,
          resolutionSummary: resolutionSummary || t.resolutionSummary,
          // Moving to in_progress/resolved is what sets first response
          // server-side; mirror the saved value.
          firstResponseAt: serverTicket?.first_response_at || t.firstResponseAt,
          updatedAt: now
        };
      }
      return t;
    }));

    if (status === 'resolved') {
      confetti({ particleCount: 60, spread: 70, origin: { y: 0.7 } });
    }

    logAudit({
      actorId: currentUser?.id,
      actorName: currentUser?.name,
      actorRole: currentUser?.role,
      action: 'TICKET_STATUS_CHANGED',
      entityType: 'ticket',
      entityId: id,
      entityTitle: `${ticket.ticketNumber}: ${ticket.title}`,
      details: `Status transitioned to ${status.toUpperCase()}. Resolution: ${resolutionSummary || 'None'}`
    });
    return true;
  };

  const escalateTicket = async (id, level, reason) => {
    const ticket = tickets.find(t => String(t.id) === String(id));
    if (!ticket) return;

    const targetId = getBackendId(id);
    if (targetId) {
      try {
        const res = await apiFetch(`/api/tickets/${targetId}/escalate`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ level, reason })
        });
        if (!res.ok) {
          // Was fire-and-forget, so a refused escalation (no permission, no
          // reason) still showed as escalated until the next reload.
          const errData = await res.json().catch(() => ({}));
          alert(errData.error || 'Failed to escalate ticket.');
          return false;
        }
      } catch (err) {
        console.error('Failed to sync escalateTicket to API:', err);
        alert('Failed to escalate ticket. Please check your connection and try again.');
        return false;
      }
    }

    // Status is deliberately left alone: escalation is tracked by
    // escalationLevel, and 'escalated' isn't a real Ticket.Status (the status
    // badge would render it as "New").
    setTickets(prev => prev.map(t => {
      if (String(t.id) === String(id)) {
        return {
          ...t,
          escalationLevel: level,
          escalationReason: reason,
          updatedAt: new Date().toISOString()
        };
      }
      return t;
    }));

    logAudit({
      actorId: currentUser?.id,
      actorName: currentUser?.name,
      actorRole: currentUser?.role,
      action: 'TICKET_ESCALATED',
      entityType: 'ticket',
      entityId: id,
      entityTitle: `${ticket.ticketNumber}: ${ticket.title}`,
      details: `Escalated to ${level.toUpperCase()} tier by ${currentUser?.name}. Reason: ${reason}`
    });

    const targetUserId = level === 'supervisor' ? ticket.supervisorId : (level === 'admin' ? ticket.adminId : 'usr_super_admin');
    if (targetUserId) {
      pushNotification({
        recipientId: targetUserId,
        title: '⚠️ Ticket Escalated',
        message: `${ticket.ticketNumber} was escalated: "${reason}"`,
        type: 'escalation',
        entityType: 'ticket',
        entityId: id
      });
    }
    return true;
  };

  const postTicketComment = async (ticketId, content, isInternal) => {
    const targetTicketId = getBackendId(ticketId);
    let savedComment = null;
    let serverFirstResponseAt = null;
    try {
      // Was POSTing to the flat "/api/comments" — the real route is
      // nested under the parent ticket (tickets.POST("/:id/comments",
      // ...) in routes.go).
      const res = await apiFetch(`/api/tickets/${targetTicketId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          ticket_id: targetTicketId,
          user_id: getBackendId(currentUser?.id) || null,
          is_internal: isInternal,
        })
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(resData.error || 'Failed to post comment.');
        return null;
      }
      savedComment = normalizeComment(resData.comment);
      serverFirstResponseAt = resData.first_response_at || null;
    } catch (err) {
      console.error('Failed to sync ticket comment to API:', err);
      alert('Failed to post comment. Please check your connection and try again.');
      return null;
    }

    setTickets(prev => prev.map(t => {
      if (String(t.id) === String(ticketId)) {
        return {
          ...t,
          comments: savedComment.isInternal ? (t.comments || []) : [...(t.comments || []), savedComment],
          internalNotes: savedComment.isInternal ? [...(t.internalNotes || []), savedComment] : (t.internalNotes || []),
          responses: [...(t.responses || []), savedComment],
          // Taken from the server, which only sets it for the first PUBLIC
          // reply. It used to be invented here for any comment (internal
          // notes included) and was lost on reload.
          firstResponseAt: serverFirstResponseAt || t.firstResponseAt,
          updatedAt: new Date().toISOString()
        };
      }
      return t;
    }));

    return savedComment;
  };

  const addTicketComment = async (ticketId, content) => {
    return await postTicketComment(ticketId, content, false);
  };

  const addTicketInternalNote = async (ticketId, content) => {
    const saved = await postTicketComment(ticketId, content, true);
    if (saved) {
      logAudit({
        actorId: currentUser?.id,
        actorName: currentUser?.name,
        actorRole: currentUser?.role,
        action: 'TICKET_INTERNAL_NOTE_ADDED',
        entityType: 'ticket',
        entityId: ticketId,
        entityTitle: `Ticket ${ticketId}`,
        details: `Added internal staff note by ${currentUser?.name}`
      });
    }
    return saved;
  };

  const addTicketResponse = async (ticketId, content, isInternalNote = false) => {
    const saved = await postTicketComment(ticketId, content, isInternalNote);
    if (!saved) return;

    const ticket = tickets.find(t => String(t.id) === String(ticketId));
    if (ticket && !isInternalNote && ticket.assignedToId && String(ticket.assignedToId) !== String(currentUser?.id)) {
      pushNotification({
        recipientId: ticket.assignedToId,
        title: 'New Ticket Reply',
        message: `${currentUser?.name} responded on ${ticket.ticketNumber}`,
        type: 'comment',
        entityType: 'ticket',
        entityId: ticketId
      });
    }
  };

  // Was a purely local state change — it never called the backend, so every
  // assignment made from the ticket drawer disappeared on reload. Uses the
  // real POST /tickets/:id/assign (assign_tickets permission).
  const assignTicket = async (ticketId, agentId) => {
    const ticket = tickets.find(t => String(t.id) === String(ticketId));
    if (!ticket) return false;

    const agent = findUserByAnyId(allUsers, agentId);
    const apiAgentId = agent ? getBackendId(agent.id) : getBackendId(agentId);
    if (!apiAgentId) {
      alert('Pick an agent to assign this ticket to.');
      return false;
    }

    const targetId = getBackendId(ticketId);
    let saved = null;
    try {
      const res = await apiFetch(`/api/tickets/${targetId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigned_to_id: apiAgentId })
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(resData.error || 'Failed to assign ticket.');
        return false;
      }
      saved = resData.ticket || null;
    } catch (err) {
      console.error('Failed to sync assignTicket to API:', err);
      alert('Failed to assign ticket. Please check your connection and try again.');
      return false;
    }

    setTickets(prev => prev.map(t => {
      if (String(t.id) === String(ticketId)) {
        return {
          ...t,
          assignedToId: agent ? agent.id : apiAgentId,
          status: saved?.status || t.status,
          firstResponseAt: saved?.first_response_at || t.firstResponseAt,
          supervisorId: agent?.supervisorId || t.supervisorId,
          adminId: agent?.adminId || t.adminId,
          updatedAt: new Date().toISOString()
        };
      }
      return t;
    }));

    logAudit({
      actorId: currentUser?.id,
      actorName: currentUser?.name,
      actorRole: currentUser?.role,
      action: 'TICKET_ASSIGNED',
      entityType: 'ticket',
      entityId: ticketId,
      entityTitle: `${ticket.ticketNumber}: ${ticket.title}`,
      details: agent ? `Reassigned to ${agent.name}` : 'Reassigned'
    });

    if (agent && String(agent.id) !== String(currentUser?.id)) {
      pushNotification({
        recipientId: agent.id,
        title: 'New Ticket Assigned',
        message: `You were assigned ${ticket.ticketNumber} by ${currentUser?.name}`,
        type: 'assignment',
        entityType: 'ticket',
        entityId: ticketId
      });
    }
    return true;
  };

  const deleteTicket = async (id) => {
    const targetId = getBackendId(id);
    if (targetId) {
      try {
        const res = await apiFetch(`/api/tickets/${targetId}`, { method: 'DELETE' });
        if (!res.ok) {
          // Removed the ticket from the UI even when the server refused
          // (only admins may archive), so it "vanished" until the next reload.
          const errData = await res.json().catch(() => ({}));
          alert(errData.error || 'Failed to archive ticket.');
          return false;
        }
      } catch (err) {
        console.error('Failed to sync deleteTicket to API:', err);
        alert('Failed to archive ticket. Please check your connection and try again.');
        return false;
      }
    }

    const ticket = tickets.find(t => String(t.id) === String(id));
    setTickets(prev => prev.filter(t => String(t.id) !== String(id)));
    if (ticket) {
      logAudit({
        actorId: currentUser?.id,
        actorName: currentUser?.name,
        actorRole: currentUser?.role,
        action: 'TICKET_DELETED',
        entityType: 'ticket',
        entityId: id,
        entityTitle: `${ticket.ticketNumber}: ${ticket.title}`,
        details: `Deleted ticket ${ticket.ticketNumber}`
      });
    }
    return true;
  };

  const createUser = async (userData) => {
    const wirePayload = {
      name: userData.name,
      email: userData.email,
      password: userData.password || undefined,
      role: userData.role,
      department: userData.department || '',
      title: userData.title || '',
      phone: userData.phone || '',
      avatar: userData.avatar || '',
      supervisor_id: getBackendId(userData.supervisorId) || null,
      admin_id: getBackendId(userData.adminId) || null,
      support_tier: userData.supportTier || '',
      // Only a Super Admin may send a non-empty list (server-enforced).
      extra_departments: userData.extraDepartments || [],
    };

    let created = null;
    let temporaryPassword = null;
    try {
      const res = await apiFetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wirePayload)
      });
      const resData = await res.json().catch(() => ({}));
      if (res.ok) {
        created = normalizeUser(resData.user);
        temporaryPassword = resData.temporary_password || null;
      } else {
        alert(resData.error || 'Failed to create user.');
        return null;
      }
    } catch (err) {
      console.error('Failed to sync createUser to API:', err);
      alert('Failed to create user. Please check your connection and try again.');
      return null;
    }

    setAllUsers(prev => [...prev, created]);

    logAudit({
      actorId: currentUser?.id,
      actorName: currentUser?.name,
      actorRole: currentUser?.role,
      action: 'USER_CREATED',
      entityType: 'user',
      entityId: created.id,
      entityTitle: created.name,
      details: `Created new user account with role ${(created.role || '').toUpperCase()} in ${created.department}`
    });

    return { user: created, temporaryPassword };
  };

  const updateUser = async (userId, updates) => {
    const targetId = getBackendId(userId);

    const wirePayload = {};
    if (updates.name !== undefined) wirePayload.name = updates.name;
    if (updates.title !== undefined) wirePayload.title = updates.title;
    if (updates.phone !== undefined) wirePayload.phone = updates.phone;
    if (updates.avatar !== undefined) wirePayload.avatar = updates.avatar;
    if (updates.password) wirePayload.password = updates.password;
    // Was never sent at all — a self-service password change had no way
    // for the backend to verify the caller actually knows their current
    // password, even though profile.jsx's form collects it and checks
    // it's non-empty. Checking "did they type something" client-side
    // isn't verification; the backend needs the value itself to check it
    // against the real hash.
    if (updates.currentPassword) wirePayload.current_password = updates.currentPassword;
    if (updates.department !== undefined) wirePayload.department = updates.department;
    // 0 means "clear this link" to the backend. Sending null (what an empty
    // "None" selection became) was indistinguishable from "not sent", so a
    // reporting line could never be removed.
    if (updates.supervisorId !== undefined) wirePayload.supervisor_id = getBackendId(updates.supervisorId) ?? 0;
    if (updates.adminId !== undefined) wirePayload.admin_id = getBackendId(updates.adminId) ?? 0;
    if (updates.status !== undefined) wirePayload.status = updates.status;
    // CNOC support tier (L1..L4). This line was mistakenly put in
    // updateProject when tiers were added, so editing a user never sent it.
    if (updates.supportTier !== undefined) wirePayload.support_tier = updates.supportTier || '';
    // Additional departments (staff only, Super Admin only). [] clears them.
    if (updates.extraDepartments !== undefined) wirePayload.extra_departments = updates.extraDepartments || [];

    // PUT /api/users/:id needs manage_users, so a regular user editing their
    // OWN profile (name/title/phone/avatar/password) was rejected — and that
    // rejection was only console.error'd. Self-service edits go through
    // /api/me and /api/me/password instead; anything that touches
    // department/supervisor/status still needs the admin endpoint.
    const isSelfService =
      !!targetId &&
      String(targetId) === String(getBackendId(currentUser?.id)) &&
      updates.department === undefined &&
      updates.supervisorId === undefined &&
      updates.adminId === undefined &&
      updates.supportTier === undefined &&
      updates.extraDepartments === undefined &&
      updates.status === undefined;

    let savedUser = null;
    let succeeded = false;
    if (targetId && isSelfService) {
      try {
        let ok = true;
        const selfPayload = {};
        if (wirePayload.name !== undefined) selfPayload.name = wirePayload.name;
        if (wirePayload.title !== undefined) selfPayload.title = wirePayload.title;
        if (wirePayload.phone !== undefined) selfPayload.phone = wirePayload.phone;
        if (wirePayload.avatar !== undefined) selfPayload.avatar = wirePayload.avatar;

        if (Object.keys(selfPayload).length > 0) {
          const res = await apiFetch('/api/me', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(selfPayload)
          });
          if (res.ok) {
            const resData = await res.json();
            savedUser = normalizeUser(resData.user);
          } else {
            ok = false;
            const errData = await res.json().catch(() => ({}));
            alert(errData.error || 'Failed to update profile.');
          }
        }

        if (ok && updates.password) {
          const res = await apiFetch('/api/me/password', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              old_password: updates.currentPassword || '',
              new_password: updates.password
            })
          });
          if (!res.ok) {
            ok = false;
            const errData = await res.json().catch(() => ({}));
            alert(errData.error || 'Failed to change password.');
          } else {
            // Changing the password ends all other sessions; the server hands
            // this one a fresh token so it carries on.
            const data = await res.json().catch(() => ({}));
            if (data.token) setAuthToken(data.token);
          }
        }
        succeeded = ok;
      } catch (err) {
        console.error('Failed to sync updateUser (self) to API:', err);
        alert('Failed to update profile. Please check your connection and try again.');
      }
    } else if (targetId) {
      try {
        const res = await apiFetch(`/api/users/${targetId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(wirePayload)
        });
        if (res.ok) {
          const resData = await res.json();
          savedUser = normalizeUser(resData.user);
          succeeded = true;
        } else {
          // Was console-only, so a refused edit closed the form as if it had
          // been saved.
          const errData = await res.json().catch(() => ({}));
          alert(errData.error || 'Failed to update user.');
        }
      } catch (err) {
        console.error('Failed to sync updateUser to API:', err);
        alert('Failed to update user. Please check your connection and try again.');
      }
    }

    // Previously applied `savedUser || { ...u, ...updates }` unconditionally
    // — meaning a FAILED update still merged the attempted changes into
    // local state, so the UI displayed success regardless of what the
    // backend actually did. Now local state only changes when the API
    // call genuinely succeeded, matching how every other update function
    // in this file already behaves.
    if (!succeeded) return null;
    setAllUsers(prev => prev.map(u => String(u.id) === String(userId) ? (savedUser || u) : u));

    logAudit({
      actorId: currentUser?.id,
      actorName: currentUser?.name,
      actorRole: currentUser?.role,
      action: 'USER_UPDATED',
      entityType: 'user',
      entityId: userId,
      entityTitle: savedUser?.name || `User ${userId}`,
      details: `Updated user profile attributes: ${Object.keys(updates).join(', ')}`
    });

    // Callers previously had no way to tell success from failure at all
    // — updateUser had no return statement, so `await updateUser(...)`
    // always evaluated to undefined regardless of what actually happened.
    return savedUser || true;
  };

  // Role changes go through their own audited endpoint (PUT /users/:id/role),
  // which had no caller anywhere in the UI — a user created with the wrong
  // role couldn't be fixed without touching the database.
  const changeUserRole = async (userId, role) => {
    const targetId = getBackendId(userId);
    if (!targetId || !role) return null;
    let saved = null;
    try {
      const res = await apiFetch(`/api/users/${targetId}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(resData.error || 'Failed to change role.');
        return null;
      }
      saved = normalizeUser(resData.user);
    } catch (err) {
      console.error('Failed to sync changeUserRole to API:', err);
      alert('Failed to change role. Please check your connection and try again.');
      return null;
    }
    if (saved) {
      setAllUsers(prev => prev.map(u => String(u.id) === String(userId) ? saved : u));
    }
    return saved || true;
  };

  const toggleUserStatus = async (userId) => {
    const user = allUsers.find(u => String(u.id) === String(userId));
    if (!user) return null;
    const nextStatus = user.status === 'active' ? 'inactive' : 'active';

    // Was a pure local setAllUsers mutation with NO backend call at all
    // — meaning a status toggle looked like it worked but was never
    // persisted; reloading the page silently reverted it. Reusing
    // updateUser here means this now goes through the same real PUT
    // request, the same success-only state update, and the same audit
    // logging as every other user edit, rather than duplicating (and
    // re-breaking) that logic separately.
    const result = await updateUser(userId, { status: nextStatus });
    if (!result) return null;

    logAudit({
      actorId: currentUser?.id,
      actorName: currentUser?.name,
      actorRole: currentUser?.role,
      action: nextStatus === 'active' ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
      entityType: 'user',
      entityId: userId,
      entityTitle: user.name,
      details: `User status changed to ${nextStatus.toUpperCase()}`
    });
  };

  const toggleUserPermission = (userId, permissionKey) => {
    if (currentUser?.role !== 'super_admin') return;

    const targetUser = allUsers.find(u => String(u.id) === String(userId));
    if (!targetUser || targetUser.role !== 'admin') return;

    const hasPermission = (targetUser.permissions || []).includes(permissionKey);
    const nextPermissions = hasPermission
      ? (targetUser.permissions || []).filter(p => p !== permissionKey)
      : [...(targetUser.permissions || []), permissionKey];

    setAllUsers(prev => prev.map(u => String(u.id) === String(userId) ? { ...u, permissions: nextPermissions } : u));

    logAudit({
      actorId: currentUser?.id,
      actorName: currentUser?.name,
      actorRole: currentUser?.role,
      action: hasPermission ? 'PERMISSION_REVOKED' : 'PERMISSION_GRANTED',
      entityType: 'user',
      entityId: userId,
      entityTitle: targetUser.name,
      details: `${hasPermission ? 'Revoked' : 'Granted'} "${permissionKey}" ${hasPermission ? 'from' : 'to'} ${targetUser.name}`
    });

    pushNotification({
      recipientId: userId,
      title: hasPermission ? 'Access Revoked' : 'Access Granted',
      message: `${currentUser?.name} ${hasPermission ? 'revoked' : 'granted'} your access to ${permissionKey.replace(/_/g, ' ')}`,
      type: 'system',
      entityType: 'user',
      entityId: userId
    });
  };

  const createCustomRole = async (roleKey, roleDisplayName, initialPermissions = {}) => {
    if (currentUser?.role !== 'super_admin') return;

    const normalizedKey = roleKey.toLowerCase().trim().replace(/\s+/g, '_');
    if (!normalizedKey) return;

    if (customRoles.includes(normalizedKey)) {
      alert('Role already exists!');
      return;
    }

    // Was pure local state — setCustomRoles/setPermissionMatrix with no
    // backend call at all. A role "created" here never touched the real
    // roles table, so it vanished on reload and — far more seriously —
    // was never usable for actual permission enforcement, since
    // middleware.RequirePermission checks the real database, which this
    // never wrote to.
    try {
      const res = await apiFetch('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: normalizedKey, label: roleDisplayName || roleKey })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || 'Failed to create role.');
        return;
      }
    } catch (err) {
      console.error('Failed to create role:', err);
      alert('Failed to create role. Please check your connection and try again.');
      return;
    }

    // No bulk "create role with initial permissions" endpoint exists —
    // grant each checked one individually via SetPermission.
    for (const [permKey, granted] of Object.entries(initialPermissions)) {
      if (!granted) continue;
      try {
        await apiFetch(`/api/roles/${normalizedKey}/permissions/${permKey}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ granted: true })
        });
      } catch (err) {
        console.error(`Failed to grant ${permKey} for new role ${normalizedKey}:`, err);
      }
    }

    setCustomRoles(prev => [...prev, normalizedKey]);

    setPermissionMatrix(prev => ({
      ...prev,
      [normalizedKey]: initialPermissions
    }));

    logAudit({
      actorId: currentUser?.id,
      actorName: currentUser?.name,
      actorRole: currentUser?.role,
      action: 'CUSTOM_ROLE_CREATED',
      entityType: 'role',
      entityId: normalizedKey,
      entityTitle: roleDisplayName || roleKey,
      details: `Super Admin created custom role: ${roleDisplayName || roleKey}`
    });
  };

  const deleteCustomRole = async (roleKey) => {
    if (currentUser?.role !== 'super_admin') return;

    // "client" removed from this list — it isn't a real backend role at
    // all (allowedRoles in auth.go only recognizes super_admin/admin/
    // supervisor/staff), so treating it as a protected built-in here was
    // just dead weight left over from an earlier design.
    const builtInRoles = ['super_admin', 'admin', 'supervisor', 'staff'];
    if (builtInRoles.includes(roleKey)) return;

    // Same fix as createCustomRole above — was pure local state, never
    // called the backend, so a "deleted" role's permission rows stayed
    // in the real database untouched.
    try {
      const res = await apiFetch(`/api/roles/${roleKey}`, { method: 'DELETE' });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || 'Failed to delete role.');
        return;
      }
    } catch (err) {
      console.error('Failed to delete role:', err);
      alert('Failed to delete role. Please check your connection and try again.');
      return;
    }

    setCustomRoles(prev => prev.filter(r => r !== roleKey));

    setPermissionMatrix(prev => {
      const updated = { ...prev };
      delete updated[roleKey];
      return updated;
    });

    logAudit({
      actorId: currentUser?.id,
      actorName: currentUser?.name,
      actorRole: currentUser?.role,
      action: 'CUSTOM_ROLE_DELETED',
      entityType: 'role',
      entityId: roleKey,
      entityTitle: roleKey,
      details: `Super Admin deleted custom role: ${roleKey}`
    });
  };

  const updateRolePermission = async (role, permissionKey, value) => {
    if (currentUser?.role !== 'super_admin') return;
    if (role === 'super_admin') return;

    // Was pure local state — this is the most consequential of the
    // three fixes here. Every toggle in the Settings & Matrix UI was
    // purely cosmetic: it looked granted or revoked on screen, an audit
    // entry was even created, but the real role_permissions table (what
    // middleware.RequirePermission actually checks on every protected
    // request) was never touched. A Super Admin revoking a capability
    // believed they'd changed system behavior; nothing downstream ever
    // changed at all.
    try {
      const res = await apiFetch(`/api/roles/${role}/permissions/${permissionKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ granted: value })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || 'Failed to update permission.');
        return;
      }
    } catch (err) {
      console.error('Failed to update permission:', err);
      alert('Failed to update permission. Please check your connection and try again.');
      return;
    }

    setPermissionMatrix(prev => ({
      ...prev,
      [role]: {
        ...(prev[role] || {}),
        [permissionKey]: value
      }
    }));

    logAudit({
      actorId: currentUser?.id,
      actorName: currentUser?.name,
      actorRole: currentUser?.role,
      action: value ? 'ROLE_PERMISSION_GRANTED' : 'ROLE_PERMISSION_REVOKED',
      entityType: 'role_permission',
      entityId: role,
      entityTitle: getRoleDisplayName(role),
      details: `${value ? 'Granted' : 'Revoked'} "${permissionKey.replace(/_/g, ' ')}" for all ${getRoleDisplayName(role)} users`
    });

    allUsers
      .filter(u => u.role === role)
      .forEach(u => {
        pushNotification({
          recipientId: u.id,
          title: value ? 'Access Granted' : 'Access Revoked',
          message: `${currentUser?.name} ${value ? 'granted' : 'revoked'} "${permissionKey.replace(/_/g, ' ')}" access for your role (${getRoleDisplayName(role)})`,
          type: 'system',
          entityType: 'role_permission',
          entityId: role
        });
      });
  };

  const markNotificationAsRead = (id) => {
    setNotifications(prev => prev.map(n => String(n.id) === String(id) ? { ...n, isRead: true } : n));
    apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' }).catch(() => {});
  };

  const markAllNotificationsAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    apiFetch('/api/notifications/read-all', { method: 'POST' }).catch(() => {});
  };

  return (
    <AppContext.Provider
      value={{
        currentUser,
        allUsers,
        users: allUsers,
        authToken,
        apiFetch,
        setAuthToken,
        dataLoaded,
        projects: pinnedProjectsList,
        clients,
        feasibilities: pinnedFeasList,
        tasks: pinnedTasksList,
        tickets: pinnedTicketsList,
        auditLogs,
        auditPagination,
        auditLoading,
        fetchAuditLogs,
        fetchArchived,
        workflowStatuses,
        getStatuses,
        getStatusLabel,
        getStatusCategory,
        askStatusReason,
        createWorkflowStatus,
        fetchSLAPolicies,
        clientFields,
        saveClientField,
        reloadClients,
        fetchClientOverview,
        routeTicket,
        returnTicket,
        reopenTicket,
        updateSLAPolicy,
        updateWorkflowStatus,
        searchAssignees,
        restoreArchived,
        canSeeAuditLogs: mayViewAudit,
        notifications,
        activeTab,
        setActiveTab,
        taskListPreset,
        setTaskListPreset,
        listPreset,
        setListPreset,
        darkMode,
        setDarkMode,
        selectedProjectId,
        setSelectedProjectId,
        searchQuery,
        setSearchQuery,
        visibleProjects,
        visibleTasks,
        visibleTickets,
        visibleFeasibilities,
        togglePin,
        isPinnedFor,
        userNotifications,
        unreadNotificationCount,
        setCurrentUserId,
        logAudit,
        uploadAvatar,
        createProject,
        updateProject,
        addProjectMember,
        removeProjectMember,
        togglePinProject,
        deleteProject,
        addProjectAttachment,
        createClient,
        updateClient,
        deleteClient,
        departments,
        createDepartment,
        updateDepartment,
        deleteDepartment,
        createFeasibility,
        updateFeasibility,
        addFeasibilityVendor,
        updateFeasibilityVendor,
        deleteFeasibilityVendor,
        reinstateFeasibilityVendor,
        archiveUser,
        deleteFeasibility,
        convertFeasibilityToProject,
        createTask,
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
        fetchRecordAccess,
        grantRecordAccess,
        revokeRecordAccess,
        addTaskComment,
        deleteTask,
        addTaskDependency,
        removeTaskDependency,
        createTicket,
        updateTicket,
        updateTicketStatus,
        escalateTicket,
        addTicketComment,
        addTicketInternalNote,
        addTicketResponse,
        assignTicket,
        deleteTicket,
        createUser,
        updateUser,
        changeUserRole,
        toggleUserStatus,
        toggleUserActiveStatus: toggleUserStatus,
        toggleUserPermission,
        permissionMatrix,
        customRoles,
        createCustomRole,
        deleteCustomRole,
        updateRolePermission,
        markNotificationAsRead,
        markAllNotificationsAsRead,
        selectedTaskId,
        setSelectedTaskId,
        selectedTaskEditId,
        setSelectedTaskEditId,
        selectedProjectEditId,
        setSelectedProjectEditId,
        selectedTicketId,
        setSelectedTicketId,
        selectedTicketEditId,
        setSelectedTicketEditId,
        selectedProjectDetailId,
        setSelectedProjectDetailId,
        selectedFeasibilityId,
        setSelectedFeasibilityId,
        selectedFeasibilityEditId,
        setSelectedFeasibilityEditId,
        quickCreateOpen,
        quickCreatePickerOpen,
        setQuickCreatePickerOpen,
        setQuickCreateOpen,
        quickCreateConfig,
        openQuickCreate,
        globalSearchOpen,
        setGlobalSearchOpen
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};