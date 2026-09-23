import React, { createContext, useContext, useState, useEffect, useMemo, useRef } from 'react';
import {
  filterProjectsForUser, filterTasksForUser, filterTicketsForUser,
  DEFAULT_PERMISSION_MATRIX, getRoleDisplayName
} from '../utils/permissions';
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
    name: raw.name || '',
    email: raw.email || '',
    avatar: raw.avatar || '',
    role: raw.role || 'staff',
    department: raw.department || '',
    title: raw.title || '',
    phone: raw.phone || '',
    status: raw.status || 'active',
    managerId: raw.manager_id ?? null,
    supervisorId: raw.supervisor_id ?? null,
    adminId: raw.admin_id ?? null,
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
    priority: raw.priority || 'normal',
    startDate: raw.start_date || '',
    dueDate: raw.due_date || '',
    ownerId: raw.owner_id ?? null,
    adminId: raw.admin_id ?? null,
    clientId: raw.client_id ?? null,
    clientName: raw.client?.company_name || '',
    memberIds,
    supervisorIds,
    progress: raw.progress ?? 0,
    progressOverride: !!raw.progress_override,
    budgetHours: raw.budget_hours ?? 0,
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
    priority: raw.priority || 'normal',
    labels,
    projectId: raw.project_id ?? null,
    assignedToId: raw.assignee_id ?? null,
    creatorId: raw.creator_id ?? null,
    supervisorId: raw.assignee?.supervisor_id ?? null,
    adminId: raw.assignee?.admin_id ?? null,
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
    // The Ticket model has no requester_* columns; the linked Client is the
    // real source (GetTickets preloads it), so fall back to that.
    requesterName: raw.requester_name || raw.client?.contact_person || '',
    requesterEmail: raw.requester_email || raw.client?.email || '',
    requesterCompany: raw.requester_company || raw.client?.company_name || '',
    projectId: raw.project_id ?? null,
    assignedToId: raw.assigned_to_id ?? null,
    createdById: raw.created_by_id ?? null,
    supervisorId: raw.assigned_to?.supervisor_id ?? null,
    adminId: raw.assigned_to?.admin_id ?? null,
    dueDate: raw.due_date || '',
    slaDeadline: raw.sla_deadline || null,
    responseSlaMinutes: raw.response_sla_minutes ?? 0,
    resolutionSlaMinutes: raw.resolution_sla_minutes ?? 0,
    firstResponseAt: raw.first_response_at || null,
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
    contactPerson: raw.contact_person || '',
    email: raw.email || '',
    phone: raw.phone || '',
    website: raw.website || '',
    industry: raw.industry || '',
    address: raw.address || '',
    createdAt: raw.created_at || raw.CreatedAt || null,
    updatedAt: raw.updated_at || raw.UpdatedAt || null,
  };
};

// --- Feasibility shape translation ---------------------------------------
const normalizeFeasibilityVendor = (raw) => {
  if (!raw) return null;
  return {
    id: raw.id ?? raw.ID,
    vendorName: raw.vendor_name || '',
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
    actorName: raw.user?.name || 'Unknown',
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
  const [darkMode, setDarkModeState] = useState(false);
  const [permissionMatrix, setPermissionMatrix] = useState(DEFAULT_PERMISSION_MATRIX);

  const setAuthToken = (token) => {
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
    return fetch(url, { ...options, headers });
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
          apiFetch('/api/users'),
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
            const dirRes = await apiFetch('/api/directory/users');
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

  useEffect(() => {
    if (!currentUserId) return;
    const activeUser = findUserByAnyId(allUsers, currentUserId);
    if (!activeUser || (activeUser.role !== 'super_admin' && activeUser.role !== 'admin')) return;

    const fetchAuditLogs = async () => {
      try {
        // Was "/api/audit-logs" — the actual registered route is
        // "/api/audit" (see routes.go: protected.Group("/audit")). Also
        // dropped the manually-set "x-user-role" header — the backend's
        // RequirePermission middleware reads role from the verified JWT
        // exclusively now, never from a client-supplied header, so this
        // was sending information nothing on the other end reads at all.
        const res = await apiFetch('/api/audit');
        if (res.ok) {
          const data = await res.json();
          if (data.logs && data.logs.length > 0) setAuditLogs(data.logs.map(normalizeAuditLog).filter(Boolean));
        }
      } catch (err) {
        console.warn('Failed to fetch audit logs from backend:', err);
      }
    };

    fetchAuditLogs();
  }, [currentUserId, allUsers]);

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

  const logAudit = (entry) => {
    const newLog = {
      ...entry,
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString()
    };
    setAuditLogs(prev => [newLog, ...prev]);
  };

  const pushNotification = (notif) => {
    const newNotif = {
      ...notif,
      id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      isRead: false,
      createdAt: new Date().toISOString()
    };
    setNotifications(prev => [newNotif, ...prev]);
  };

  const visibleProjects = useMemo(() => {
    return filterProjectsForUser(projects, currentUser, allUsers);
  }, [projects, currentUser, allUsers]);

  const visibleTasks = useMemo(() => {
    return filterTasksForUser(tasks, currentUser, allUsers);
  }, [tasks, currentUser, allUsers]);

  const visibleTickets = useMemo(() => {
    return filterTicketsForUser(tickets, currentUser, allUsers);
  }, [tickets, currentUser, allUsers]);

  const visibleFeasibilities = useMemo(() => {
    // Feasibilities are visible to all authenticated users (management overview)
    return feasibilities;
  }, [feasibilities]);

  const userNotifications = useMemo(() => {
    if (!currentUser) return [];
    if (currentUser.role === 'super_admin') {
      return notifications;
    }
    return notifications.filter(n => String(n.recipientId) === String(currentUser.id));
  }, [notifications, currentUser]);

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
      return;
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

    const basePayload = {
      ...data,
      memberIds,
      adminId: resolvedAdminId,
      createdBy: currentUser?.id ?? null,
      progress: 0,
      spentHours: 0,
      projectType,
    };

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
      owner_id: data.ownerId ?? currentUser?.id ?? null,
      admin_id: data.adminId ?? resolvedAdminId,
      budget_hours: data.budgetHours ?? 0,
      member_ids: memberIds,
      supervisor_ids: data.supervisorIds || [],
    };

    // Strip budget_hours for ticketing projects
    if (projectType === 'ticketing') {
      delete wirePayload.budget_hours;
    }

    let savedProject = null;
    try {
      const res = await apiFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wirePayload)
      });
      if (res.ok) {
        const resData = await res.json();
        savedProject = normalizeProject(resData.project);
      }
    } catch (err) {
      console.error('Failed to sync createProject to API:', err);
    }

    const newProject = savedProject || {
      ...basePayload,
      id: `prj_${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

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
    if (updates.ownerId !== undefined) wirePayload.owner_id = getBackendId(updates.ownerId);
    if (updates.adminId !== undefined) wirePayload.admin_id = getBackendId(updates.adminId);
    if (updates.budgetHours !== undefined) wirePayload.budget_hours = updates.budgetHours;
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

  const togglePinProject = (id) => {
    setProjects(prev => prev.map(p => String(p.id) === String(id) ? { ...p, isPinned: !p.isPinned } : p));
  };

  const deleteProject = async (id) => {
    const targetId = getBackendId(id);
    if (targetId) {
      try {
        await apiFetch(`/api/projects/${targetId}`, { method: 'DELETE' });
      } catch (err) {
        console.error('Failed to sync deleteProject to API:', err);
      }
    }

    const prj = projects.find(p => String(p.id) === String(id));
    setProjects(prev => prev.filter(p => String(p.id) !== String(id)));
    if (prj) {
      logAudit({
        actorId: currentUser?.id,
        actorName: currentUser?.name,
        actorRole: currentUser?.role,
        action: 'PROJECT_DELETED',
        entityType: 'project',
        entityId: id,
        entityTitle: prj.title,
        details: `Archived/Deleted project ${prj.title}`
      });
    }
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
          alert(errData.error || 'Failed to delete department.');
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
        action: 'DEPARTMENT_DELETED',
        entityType: 'department',
        entityId: id,
        entityTitle: dept.name,
        details: `Deleted department ${dept.name}`
      });
    }
    return true;
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
    if (updates.assignedUserId !== undefined) wirePayload.assigned_user_id = getBackendId(updates.assignedUserId);
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
      const newVendor = normalizeFeasibilityVendor(resData.feasibility?.vendors?.find(v => v.id === resData.vendor?.id) || resData.vendor);
      setFeasibilities(prev => prev.map(f => {
        if (String(f.id) === String(feasibilityId)) {
          return { ...f, vendors: [...(f.vendors || []), newVendor], updatedAt: new Date().toISOString() };
        }
        return f;
      }));
      return newVendor;
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
      await apiFetch(`/api/feasibilities/${targetFeasId}/vendors/${targetVendorId}`, { method: 'DELETE' });
    } catch (err) {
      console.error('Failed to sync deleteFeasibilityVendor to API:', err);
    }

    setFeasibilities(prev => prev.map(f => {
      if (String(f.id) === String(feasibilityId)) {
        return {
          ...f,
          vendors: (f.vendors || []).filter(v => String(v.id) !== String(vendorId)),
          updatedAt: new Date().toISOString()
        };
      }
      return f;
    }));
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
      ticket_id: getBackendId(basePayload.ticketId) || null,
      assignee_id: assignee?.id ?? getBackendId(basePayload.assignedToId) ?? null,
      creator_id: currentUser?.id ?? null,
      start_date: toRFC3339(basePayload.startDate),
      due_date: toRFC3339(basePayload.dueDate),
      estimated_hours: basePayload.estimatedHours ?? 0,
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
  };

  const updateTask = async (id, updates) => {
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
    if (updates.status !== undefined) wireUpdates.status = updates.status;
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

    return savedTask || true;
  };

  const updateTaskStatus = async (id, newStatus) => {
    const task = (tasks || []).find(t => String(t.id) === String(id));
    if (!task) return;

    let progress = task.progress;
    if (newStatus === 'done') {
      progress = 100;
    } else if (newStatus === 'todo') {
      progress = 0;
    } else if (newStatus === 'in_progress' && progress === 0) {
      progress = 25;
    }

    const targetId = getBackendId(id);
    if (targetId) {
      try {
        const res = await apiFetch(`/api/tasks/${targetId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        });
        if (!res.ok) {
          // The response used to be ignored, so a rejected change still
          // showed as applied until the next reload.
          const errData = await res.json().catch(() => ({}));
          alert(errData.error || 'Failed to update task status.');
          return;
        }
      } catch (err) {
        console.error('Failed to sync updateTaskStatus to API:', err);
        alert('Failed to update task status. Please check your connection and try again.');
        return;
      }
    }

    if (newStatus === 'done' && typeof confetti === 'function') {
      confetti({ particleCount: 50, spread: 60, origin: { y: 0.7 } });
    }

    setTasks(prev => (prev || []).map(t => {
      if (String(t.id) === String(id)) {
        return {
          ...t,
          status: newStatus,
          progress,
          updatedAt: new Date().toISOString()
        };
      }
      return t;
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
  };

  const toggleChecklistItem = async (taskId, checklistId) => {
    const targetId = getBackendId(checklistId);
    let savedItem = null;
    try {
      const res = await apiFetch(`/api/checklists/${targetId}/toggle`, { method: 'PATCH' });
      if (res.ok) {
        const resData = await res.json();
        savedItem = normalizeChecklistItem(resData.checklist);
      }
    } catch (err) {
      console.error('Failed to sync toggleChecklistItem to API:', err);
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

  const addSubTask = async (taskId, title, assignedToId, priority = 'normal', dueDate = new Date().toISOString().split('T')[0], type = 'flowchart') => {
    const targetTaskId = getBackendId(taskId);
    const resolvedAssigneeId = getBackendId(assignedToId) || getBackendId(currentUser?.id) || null;

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
          deadline: dueDate,
          estimated_hours: 4,
        })
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(resData.error || 'Failed to add subtask.');
        return;
      }
      savedSub = normalizeSubTask(resData.subtask);
    } catch (err) {
      console.error('Failed to sync addSubTask to API:', err);
      alert('Failed to add subtask. Please check your connection and try again.');
      return;
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
        return;
      }
    } catch (err) {
      console.error('Failed to sync subtask status to API:', err);
      alert('Failed to update sub-task status. Please check your connection and try again.');
      return;
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
        return;
      }
      savedComment = normalizeComment(resData.comment);
    } catch (err) {
      console.error('Failed to sync comment to API:', err);
      alert('Failed to post comment. Please check your connection and try again.');
      return;
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
    if (task && String(task.assignedToId) !== String(currentUser?.id)) {
      pushNotification({
        recipientId: task.assignedToId,
        title: 'New Comment on Task',
        message: `${currentUser?.name} commented on ${task.taskNumber}`,
        type: 'comment',
        entityType: 'task',
        entityId: taskId
      });
    }
  };

  const deleteTask = async (id) => {
    const targetId = getBackendId(id);
    if (targetId) {
      try {
        await apiFetch(`/api/tasks/${targetId}`, { method: 'DELETE' });
      } catch (err) {
        console.error('Failed to sync deleteTask to API:', err);
      }
    }

    const task = tasks.find(t => String(t.id) === String(id));
    setTasks(prev => prev.filter(t => String(t.id) !== String(id)));
    if (task) {
      logAudit({
        actorId: currentUser?.id,
        actorName: currentUser?.name,
        actorRole: currentUser?.role,
        action: 'TASK_DELETED',
        entityType: 'task',
        entityId: id,
        entityTitle: `${task.taskNumber}: ${task.title}`,
        details: `Deleted task ${task.taskNumber}`
      });
    }
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
      if (res.ok) {
        const resData = await res.json();
        savedTask = normalizeTask(resData.task);
      }
    } catch (err) {
      console.error('Failed to sync removeTaskDependency to API:', err);
    }

    setTasks(prev => prev.map(t => {
      if (String(t.id) !== String(taskId)) return t;
      if (savedTask) return savedTask;
      return { ...t, dependencies: (t.dependencies || []).filter(d => String(d.id) !== String(dependsOnTaskId)) };
    }));
  };

  const createTicket = async (data) => {
    const assignee = findUserByAnyId(allUsers, data.assignedToId);
    const supervisorId = assignee?.supervisorId ?? data.supervisorId ?? null;
    const adminId = assignee?.adminId ?? data.adminId ?? null;

    // Determine if this is a Support/TT (ticketing) type
    const isSupportTT = data.projectType === 'ticketing';

    const basePayload = {
      ...data,
      supervisorId,
      adminId,
      labels: data.labels || [],
    };

    const wirePayload = {
      ticket_number: basePayload.ticketNumber || undefined,
      title: basePayload.title,
      description: basePayload.description,
      department: basePayload.department || currentUser?.department || '',
      category: basePayload.category || 'incident',
      priority: basePayload.priority || 'normal',
      severity: basePayload.severity || 'minor',
      status: basePayload.status || 'open',
      requester_name: basePayload.requesterName || '',
      requester_email: basePayload.requesterEmail || '',
      requester_company: basePayload.requesterCompany || '',
      project_id: getBackendId(basePayload.projectId) || null,
      assigned_to_id: assignee?.id ?? getBackendId(basePayload.assignedToId) ?? null,
      due_date: toRFC3339(basePayload.dueDate),
      response_sla_minutes: basePayload.responseSlaMinutes ?? 0,
      resolution_sla_minutes: basePayload.resolutionSlaMinutes ?? 0,
      labels: Array.isArray(basePayload.labels) ? basePayload.labels.join(',') : (basePayload.labels || ''),
    };

    // Strip fields not applicable to Support/TT tickets
    if (isSupportTT) {
      // For Support/TT, department comes from the project or user's department
      wirePayload.department = wirePayload.department || currentUser?.department || 'Support';
    }

    let savedTicket = null;
    try {
      const res = await apiFetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wirePayload)
      });
      if (res.ok) {
        const resData = await res.json();
        savedTicket = normalizeTicket(resData.ticket);
      }
    } catch (err) {
      console.error('Failed to sync createTicket to API:', err);
    }

    const newTicket = savedTicket || {
      ...basePayload,
      id: `tck_${Date.now().toString(36)}`,
      ticketNumber: basePayload.ticketNumber || `TCK-${tickets.length + 1041}`,
      internalNotes: [],
      comments: [],
      responses: [],
      attachments: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const taskCount = (tasks || []).length + 101;
    const taskNumber = `TSK-${taskCount}`;
    const newTaskId = `tsk_${Date.now().toString(36)}`;

    const spawnedTask = {
      id: newTaskId,
      taskNumber,
      title: `Resolve: ${newTicket.title}`,
      description: `Auto-generated from ticket ${newTicket.ticketNumber}`,
      status: 'todo',
      priority: newTicket.priority || 'normal',
      projectId: newTicket.projectId || null,
      ticketId: newTicket.id,
      assignedToId: newTicket.assignedToId,
      supervisorId,
      adminId,
      isPinned: true,
      subTasks: [
        { id: `sub_${Date.now()}_1`, title: 'Analyze requirements & draft flow chart design', type: 'flowchart', completed: false },
        { id: `sub_${Date.now()}_2`, title: 'Implementation & technical review', type: 'development', completed: false }
      ],
      labels: [],
      checklists: [],
      comments: [],
      dueDate: new Date().toISOString().split('T')[0],
      progress: 0,
      actualHours: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    setTickets(prev => [newTicket, ...prev]);
    setTasks(prev => [spawnedTask, ...(prev || [])]);

    logAudit({
      actorId: currentUser?.id,
      actorName: currentUser?.name,
      actorRole: currentUser?.role,
      action: 'TICKET_CREATED',
      entityType: 'ticket',
      entityId: newTicket.id,
      entityTitle: `${newTicket.ticketNumber}: ${newTicket.title}`,
      details: `Created new ${newTicket.priority} ticket requested by ${newTicket.requesterName} and spawned task ${taskNumber}`
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
  };

  const updateTicket = async (id, updates) => {
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
    if (updates.isPinned !== undefined) wire.is_pinned = !!updates.isPinned;
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

  const updateTicketStatus = async (id, status, resolutionSummary) => {
    const ticket = tickets.find(t => String(t.id) === String(id));
    if (!ticket) return;

    const now = new Date().toISOString();
    const resolvedAt = (status === 'resolved' || status === 'closed') ? (ticket.resolvedAt || now) : undefined;
    const closedAt = status === 'closed' ? (ticket.closedAt || now) : undefined;

    const targetId = getBackendId(id);
    if (targetId) {
      try {
        const res = await apiFetch(`/api/tickets/${targetId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, resolution_summary: resolutionSummary })
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          alert(errData.error || 'Failed to update ticket status.');
          return;
        }
      } catch (err) {
        console.error('Failed to sync updateTicketStatus to API:', err);
        alert('Failed to update ticket status. Please check your connection and try again.');
        return;
      }
    }

    setTickets(prev => prev.map(t => {
      if (String(t.id) === String(id)) {
        return {
          ...t,
          status,
          resolvedAt,
          closedAt,
          resolutionSummary: resolutionSummary || t.resolutionSummary,
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
          firstResponseAt: t.firstResponseAt || new Date().toISOString(),
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
    if (updates.supervisorId !== undefined) wirePayload.supervisor_id = getBackendId(updates.supervisorId);
    if (updates.adminId !== undefined) wirePayload.admin_id = getBackendId(updates.adminId);
    if (updates.status !== undefined) wirePayload.status = updates.status;

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
            console.error('updateUser (self) failed:', errData.error);
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
          }
        }
        succeeded = ok;
      } catch (err) {
        console.error('Failed to sync updateUser (self) to API:', err);
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
          const errData = await res.json().catch(() => ({}));
          console.error('updateUser failed:', errData.error);
        }
      } catch (err) {
        console.error('Failed to sync updateUser to API:', err);
      }
    }

    // Previously applied `savedUser || { ...u, ...updates }` unconditionally
    // — meaning a FAILED update still merged the attempted changes into
    // local state, so the UI displayed success regardless of what the
    // backend actually did. Now local state only changes when the API
    // call genuinely succeeded, matching how every other update function
    // in this file already behaves.
    if (succeeded) {
      setAllUsers(prev => prev.map(u => String(u.id) === String(userId) ? (savedUser || u) : u));
    }

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
    return succeeded ? (savedUser || true) : null;
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
  };

  const markAllNotificationsAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
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
        projects,
        clients,
        feasibilities,
        tasks,
        tickets,
        auditLogs,
        notifications,
        activeTab,
        setActiveTab,
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