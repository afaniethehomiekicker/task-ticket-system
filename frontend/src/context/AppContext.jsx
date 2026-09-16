import { 
  SEED_AUDIT_LOGS, 
  SEED_NOTIFICATIONS 
} from '../data/seedData';
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
// The Go backend is the ONLY source of user data now — no more frontend
// seed data to reconcile it against, so there's no more merging, no more
// two id schemes, no more normalizeUserKey/dedup logic. What's still
// needed is translating the backend's raw JSON shape into the shape every
// existing view component already reads: GORM's default field casing
// (`ID`, not `id`) and snake_case foreign keys (`admin_id`, not
// `adminId`) don't match what TaskDetailDrawer, Sidebar,
// ProjectDetailModal, etc. expect. This is the ONE place that translation
// happens — every consumer of allUsers gets the already-normalized shape.
//
// NOTE: `lastActive` (a "5 mins ago"-style display string) existed on the
// old frontend seed users but has no backend equivalent — the backend
// doesn't track last-login timestamps. It's deliberately left out here
// rather than faked with a placeholder string. If a component reads
// user.lastActive and breaks on its absence, that component needs a
// small update — flagging this now since I haven't reviewed every view
// component (TeamView.jsx in particular hasn't been shown to me yet).
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
// Same treatment as normalizeUser above. The previous merge-against-seed
// approach never handled `admin_id` at all (adminId was always
// undefined, so filterProjectsForUser's Admin branch could never match
// ANY real project), and read a `memberIds` key that doesn't exist in
// the API response at all — the real field is `members`, a nested array
// of full User objects (per models.go's Members []User relation), not a
// flat array of ids. Both bugs meant a project's actual backend
// membership/ownership was invisible to every permission check no
// matter how correctly it was seeded.
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

// Looks up a user by id. Simplified from an earlier three-way check
// (canonical id / legacy seed id / raw backend id) that existed only
// because two different id schemes needed bridging — now there's exactly
// one real id (the backend's), so this is just a String()-coerced
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
    startDate: raw.start_date || '',
    dueDate: raw.due_date || '',
    estimatedHours: raw.estimated_hours ?? 0,
    actualHours: raw.actual_hours ?? 0,
    isPinned: !!raw.is_pinned,
    reviewStatus: raw.review_status || 'none',
    reviewNotes: raw.review_notes || '',
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
    status: raw.status || 'open',
    requesterName: raw.requester_name || '',
    requesterEmail: raw.requester_email || '',
    requesterCompany: raw.requester_company || '',
    projectId: raw.project_id ?? null,
    assignedToId: raw.assigned_to_id ?? null,
    supervisorId: raw.assigned_to?.supervisor_id ?? null,
    adminId: raw.assigned_to?.admin_id ?? null,
    dueDate: raw.due_date || '',
    responseSlaMinutes: raw.response_sla_minutes ?? 0,
    resolutionSlaMinutes: raw.resolution_sla_minutes ?? 0,
    firstResponseAt: raw.first_response_at || null,
    resolvedAt: raw.resolved_at || null,
    closedAt: raw.closed_at || null,
    escalationLevel: raw.escalation_level || 'none',
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

const AppContext = createContext(undefined);

const STORAGE_KEYS = {
  USERS: 'pm_system_users_v1',
  PROJECTS: 'pm_system_projects_v1',
  TASKS: 'pm_system_tasks_v1',
  TICKETS: 'pm_system_tickets_v1',
  AUDIT_LOGS: 'pm_system_audit_logs_v1',
  NOTIFICATIONS: 'pm_system_notifications_v1',
  CURRENT_USER_ID: 'pm_system_active_user_id_v1',
  DARK_MODE: 'pm_system_theme_dark_v1',
  PERMISSION_MATRIX: 'pm_system_permission_matrix_v1',
  CUSTOM_ROLES: 'pm_system_custom_roles_v1',
  AUTH_TOKEN: 'pm_system_auth_token_v1',
  CLIENTS: 'pm_system_clients_v1'
};

export const AppProvider = ({ children }) => {
  const [allUsers, setAllUsers] = useState(() => {
    // Cache-then-refresh, not a fallback dataset: this is just the last
    // known-good response from the backend, shown instantly on load while
    // fetchInitialData below fetches a fresh copy. Unlike the old
    // SEED_USERS fallback, there's no scenario where this diverges from
    // the backend on its own — it's the same single source of truth,
    // just cached for a faster first paint. An empty array (not a seed
    // array) is the correct "nothing cached yet" state.
    const saved = localStorage.getItem(STORAGE_KEYS.USERS);
    return saved ? JSON.parse(saved) : [];
  });

  const [currentUserId, setCurrentUserIdState] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.CURRENT_USER_ID);
    return saved || null;
  });

  const [projects, setProjects] = useState(() => {
    // Cache-then-refresh, not a fallback dataset — same reasoning as
    // allUsers above. Projects now come from the backend exclusively;
    // this is just the last known-good response shown instantly on load
    // while fetchInitialData below fetches a fresh copy.
    const saved = localStorage.getItem(STORAGE_KEYS.PROJECTS);
    return saved ? JSON.parse(saved) : [];
  });

  const [clients, setClients] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.CLIENTS);
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CLIENTS, JSON.stringify(clients));
  }, [clients]);

  const [tasks, setTasks] = useState(() => {
    // Cache-then-refresh, not a fallback dataset — same reasoning as
    // allUsers/projects above.
    const saved = localStorage.getItem(STORAGE_KEYS.TASKS);
    return saved ? JSON.parse(saved) : [];
  });

  const [tickets, setTickets] = useState(() => {
    // Cache-then-refresh, not a fallback dataset — same reasoning as
    // allUsers/projects/tasks above.
    const saved = localStorage.getItem(STORAGE_KEYS.TICKETS);
    return saved ? JSON.parse(saved) : [];
  });

  const [auditLogs, setAuditLogs] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.AUDIT_LOGS);
    return saved ? JSON.parse(saved) : SEED_AUDIT_LOGS;
  });

  const [notifications, setNotifications] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS);
    return saved ? JSON.parse(saved) : SEED_NOTIFICATIONS;
  });

  const [activeTab, setActiveTab] = useState('dashboard');
  const [darkMode, setDarkModeState] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.DARK_MODE);
    return saved ? JSON.parse(saved) : false;
  });

  const [permissionMatrix, setPermissionMatrix] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.PERMISSION_MATRIX);
    return saved ? JSON.parse(saved) : DEFAULT_PERMISSION_MATRIX;
  });

  // The JWT issued by the backend on successful login (see handlers.Login
  // / middleware.GenerateToken). Every authenticated backend request needs
  // this attached as "Authorization: Bearer <token>" — see apiFetch below.
  const [authToken, setAuthTokenState] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) || null;
  });

  const setAuthToken = (token) => {
    setAuthTokenState(token);
    if (token) {
      localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
    } else {
      localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
    }
  };

  // Single point every backend call goes through. Merges in
  // "Authorization: Bearer <token>" whenever a token is present, without
  // clobbering any headers the caller already set (e.g. Content-Type).
  // Replaces 21 previously-separate bare fetch() calls scattered through
  // this file, none of which sent any authentication at all — the backend
  // now requires a verified token on its protected routes (see
  // middleware.AuthenticateJWT), so every one of those call sites needed
  // this in order to keep working, not just the ones that were already
  // hitting a protected route today.
  const apiFetch = (url, options = {}) => {
    const headers = { ...(options.headers || {}) };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    return fetch(url, { ...options, headers });
  };

  const [customRoles, setCustomRoles] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.CUSTOM_ROLES);
    return saved ? JSON.parse(saved) : ['super_admin', 'admin', 'supervisor', 'staff', 'client'];
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CUSTOM_ROLES, JSON.stringify(customRoles));
  }, [customRoles]);

  // Guards against React 18 StrictMode's dev-only double-invoke of
  // mount effects. Without this, fetchInitialData would run twice on
  // first mount; the merge logic above is idempotent against that on its
  // own, but there's no reason to hit four API endpoints twice every load.
  const didFetchInitialDataRef = useRef(false);

  // --- Strict Email & Identity Fetch from Go Backend API ---
  useEffect(() => {
    if (didFetchInitialDataRef.current) return;
    didFetchInitialDataRef.current = true;

    const fetchInitialData = async () => {
      try {
        const [usersRes, projectsRes, tasksRes, ticketsRes, clientsRes] = await Promise.allSettled([
          apiFetch('/api/users'),
          apiFetch('/api/projects'),
          apiFetch('/api/tasks'),
          apiFetch('/api/tickets'),
          apiFetch('/api/clients')
        ]);

        if (usersRes.status === 'fulfilled' && usersRes.value.ok) {
          const data = await usersRes.value.json();
          setAllUsers((data.users || []).map(normalizeUser).filter(Boolean));
        }

        if (projectsRes.status === 'fulfilled' && projectsRes.value.ok) {
          const data = await projectsRes.value.json();
          setProjects((data.projects || []).map(normalizeProject).filter(Boolean));
        }

        if (clientsRes.status === 'fulfilled' && clientsRes.value.ok) {
          const data = await clientsRes.value.json();
          setClients((data.clients || []).map(normalizeClient).filter(Boolean));
        }

        if (tasksRes.status === 'fulfilled' && tasksRes.value.ok) {
          const data = await tasksRes.value.json();
          setTasks((data.tasks || []).map(normalizeTask).filter(Boolean));
        }

        if (ticketsRes.status === 'fulfilled' && ticketsRes.value.ok) {
          const data = await ticketsRes.value.json();
          setTickets((data.tickets || []).map(normalizeTicket).filter(Boolean));
        }
      } catch (err) {
        console.warn('Backend API offline, operating on local cache/seed data:', err);
      }
    };

    fetchInitialData();
  }, []);

  useEffect(() => {
    if (!currentUserId) return;
    const activeUser = findUserByAnyId(allUsers, currentUserId);
    if (!activeUser || (activeUser.role !== 'super_admin' && activeUser.role !== 'admin')) return;

    const fetchAuditLogs = async () => {
      try {
        const res = await apiFetch('/api/audit-logs', {
          headers: {
            'x-user-role': activeUser.role === 'super_admin' ? 'Super Admin' : 'Admin'
          }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.logs && data.logs.length > 0) setAuditLogs(data.logs);
        }
      } catch (err) {
        console.warn('Failed to fetch audit logs from backend:', err);
      }
    };

    fetchAuditLogs();
  }, [currentUserId, allUsers]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.PERMISSION_MATRIX, JSON.stringify(permissionMatrix));
  }, [permissionMatrix]);

  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [selectedTaskEditId, setSelectedTaskEditId] = useState(null);
  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [selectedTicketEditId, setSelectedTicketEditId] = useState(null);
  const [selectedProjectDetailId, setSelectedProjectDetailId] = useState(null);
  const [selectedProjectEditId, setSelectedProjectEditId] = useState(null);
  const [quickCreateOpen, setQuickCreateOpenState] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);

  const [quickCreateConfig, setQuickCreateConfig] = useState({
    tab: 'project',
    lockedProjectId: null,
    restrictToTab: false
  });

  const setQuickCreateOpen = (val) => {
    setQuickCreateOpenState(val);
    if (!val) {
      setQuickCreateConfig({ tab: 'project', lockedProjectId: null, restrictToTab: false });
    }
  };

  const openQuickCreate = (config = {}) => {
    setQuickCreateConfig({
      tab: config.tab || 'project',
      lockedProjectId: config.lockedProjectId || null,
      restrictToTab: !!config.restrictToTab
    });
    setQuickCreateOpenState(true);
  };

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem(STORAGE_KEYS.DARK_MODE, JSON.stringify(darkMode));
  }, [darkMode]);

  const setDarkMode = (val) => {
    setDarkModeState(val);
  };

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(allUsers));
  }, [allUsers]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.TICKETS, JSON.stringify(tickets));
  }, [tickets]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.AUDIT_LOGS, JSON.stringify(auditLogs));
  }, [auditLogs]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(notifications));
  }, [notifications]);

  const currentUser = useMemo(() => {
    if (!currentUserId) return null;
    return findUserByAnyId(allUsers, currentUserId);
  }, [allUsers, currentUserId]);

  const setCurrentUserId = (id) => {
    setCurrentUserIdState(id);

    // Logout passes null — write an actual absence to localStorage rather
    // than the string "null" (which String(id) would otherwise produce).
    // The stringified "null" happened to still behave correctly by
    // coincidence (no real user id equals the string "null"), but relying
    // on that coincidence is fragile.
    if (id === null || id === undefined) {
      localStorage.removeItem(STORAGE_KEYS.CURRENT_USER_ID);
      // Logging out should also drop the auth token — an empty
      // currentUserId with a still-valid token would leave the app in an
      // inconsistent state (no active user, but api calls still
      // authenticated as whoever was last logged in).
      setAuthToken(null);
    } else {
      localStorage.setItem(STORAGE_KEYS.CURRENT_USER_ID, String(id));
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

      updateUser(currentUser.id, { avatar: data.url });
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

    // Guarantee the creator can actually see their own project afterward.
    // filterProjectsForUser's Supervisor/Staff branch gates visibility
    // ENTIRELY on memberIds.includes(user.id) — no exception for "you
    // created this." Without explicitly adding the creator here, a
    // Staff/Supervisor account's own new project would be created
    // successfully on the backend and then immediately filtered out of
    // their own visibleProjects, since nothing ever added them to
    // memberIds. Deduped against whatever memberIds the form itself
    // supplied, so a form that already adds the creator doesn't end up
    // with a duplicate entry.
    const memberIds = Array.from(new Set([
      ...(data.memberIds || []),
      ...(currentUser?.id ? [currentUser.id] : [])
    ]));

    // The Admin branch of filterProjectsForUser also accepts
    // p.createdBy === user.id and p.adminId === user.id as alternate
    // visibility paths — setting both here means an Admin creator is
    // covered even if they're not literally in memberIds. adminId only
    // defaults here if the form didn't already choose one explicitly:
    // an Admin's own projects default to themselves; a Supervisor/Staff
    // creator's project defaults to inheriting THEIR OWN adminId, so the
    // department admin managing them can also see it.
    const resolvedAdminId = data.adminId ?? (
      currentUser?.role === 'admin' ? currentUser.id : currentUser?.adminId ?? null
    );

    const basePayload = {
      ...data,
      memberIds,
      adminId: resolvedAdminId,
      createdBy: currentUser?.id ?? null,
      progress: 0,
      spentHours: 0,
    };

    // Wire payload sends BOTH camelCase and snake_case spellings for the
    // fields most likely to matter. CreateProject's Go handler binds the
    // POST body directly into a typed struct (CreateProjectInput), unlike
    // UpdateProject/UpdateTask/UpdateTicket which bind into a generic map
    // and explicitly translate camelCase to snake_case. Typed-struct
    // binding only matches an EXACT tag name, and an unrecognized key is
    // silently dropped, not rejected — sending both spellings means
    // whichever one the live backend struct actually expects gets
    // through, without needing to trust that this file and the current
    // project.go agree on casing.
    const wirePayload = {
      ...basePayload,
      member_ids: memberIds,
      admin_id: resolvedAdminId,
      created_by: currentUser?.id ?? null,
      owner_id: basePayload.ownerId ?? currentUser?.id ?? null,
      client_id: getBackendId(data.clientId) || null,
    };

    let savedProject = null;
    try {
      const res = await apiFetch('/api/projects', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-role': currentUser?.role === 'super_admin' ? 'Super Admin' : (currentUser?.role || 'Admin'),
          'x-user-id': String(currentUser?.id || 1)
        },
        body: JSON.stringify(wirePayload)
      });
      if (res.ok) {
        const resData = await res.json();
        // Use the REAL id and REAL stored member/admin data the backend
        // just assigned, not a locally-fabricated one. The old version
        // generated `prj_${Date.now().toString(36)}` here regardless of
        // what the backend did — a fake id that could never correctly
        // resolve back to the real row for any future update/delete, and
        // that also meant a page reload would replace this optimistic
        // object with the backend's version anyway, so keeping them in
        // sync from the start avoids a visible flicker/mismatch too.
        savedProject = normalizeProject(resData.project);
      }
    } catch (err) {
      console.error('Failed to sync createProject to API:', err);
    }

    // Falls back to a locally-fabricated object ONLY if the request
    // genuinely failed — keeps the app usable offline/on a flaky
    // connection rather than losing the user's input entirely.
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
      details: `Created project [${newProject.code}] for client/company ID: ${newProject.clientId || newProject.companyId}`
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

  const updateProject = async (id, updates) => {
    const targetId = getBackendId(id);
    if (targetId) {
      try {
        await apiFetch(`/api/projects/${targetId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates)
        });
      } catch (err) {
        console.error('Failed to sync updateProject to API:', err);
      }
    }

    setProjects(prev => prev.map(p => {
      if (String(p.id) === String(id)) {
        return { ...p, ...updates, updatedAt: new Date().toISOString() };
      }
      return p;
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

  // --- Client Actions -----------------------------------------------------
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

    // No locally-fabricated fallback here on purpose: unlike
    // projects/tasks/tickets (which the user is actively mid-workflow
    // on and shouldn't lose if the network hiccups), a client record
    // with no real backend id isn't useful for anything — it can't be
    // linked to a real project via a real foreign key. If the request
    // genuinely failed, surface that rather than silently pretending it
    // worked.
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
    if (targetId) {
      try {
        await apiFetch(`/api/clients/${targetId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates)
        });
      } catch (err) {
        console.error('Failed to sync updateClient to API:', err);
      }
    }

    setClients(prev => prev.map(c => String(c.id) === String(id) ? { ...c, ...updates } : c));

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
  };

  const deleteClient = async (id) => {
    const targetId = getBackendId(id);
    if (targetId) {
      try {
        await apiFetch(`/api/clients/${targetId}`, { method: 'DELETE' });
      } catch (err) {
        console.error('Failed to sync deleteClient to API:', err);
      }
    }

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

    // Explicitly null, never a hardcoded fallback id. The previous
    // version defaulted BOTH project_id and assignee_id to 1 whenever a
    // task had no project or no assignee — silently attaching every
    // genuinely-unassigned task to whatever record happened to have
    // backend id 1 (Super Admin, per this app's seed data), rather than
    // leaving it actually unassigned. Same anti-pattern already found
    // and removed from the Go handlers themselves.
    const wirePayload = {
      task_number: taskNumber,
      title: basePayload.title,
      description: basePayload.description,
      department: basePayload.department || currentUser?.department || '',
      // Lowercase, matching every other status/priority value in this
      // system. The previous version sent literal "New"/"Normal" (Title
      // Case) whenever status/priority were falsy — which, being
      // non-empty strings once sent, bypassed the backend's own
      // lowercase-default fallback entirely and got stored as-is.
      status: basePayload.status || 'todo',
      priority: basePayload.priority || 'normal',
      labels: Array.isArray(basePayload.labels) ? basePayload.labels.join(',') : (basePayload.labels || ''),
      project_id: getBackendId(basePayload.projectId) || null,
      assignee_id: assignee?.id ?? getBackendId(basePayload.assignedToId) ?? null,
      creator_id: currentUser?.id ?? null,
      start_date: basePayload.startDate || '',
      due_date: basePayload.dueDate || '',
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
        // Real backend id and real stored data, not a locally-fabricated
        // id/object — same reasoning as createProject.
        savedTask = normalizeTask(resData.task);
      }
    } catch (err) {
      console.error('Failed to sync createTask to API:', err);
    }

    const newTask = savedTask || {
      ...basePayload,
      id: `tsk_${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

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
    if (targetId) {
      try {
        await apiFetch(`/api/tasks/${targetId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates)
        });
      } catch (err) {
        console.error('Failed to sync updateTask to API:', err);
      }
    }

    setTasks(prev => (prev || []).map(t => {
      if (String(t.id) === String(id)) {
        return { ...t, ...updates, updatedAt: new Date().toISOString() };
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
  };

  const updateTaskStatus = async (id, newStatus) => {
    const task = (tasks || []).find(t => String(t.id) === String(id));
    if (!task) return;

    let progress = task.progress;
    if (newStatus === 'completed' || newStatus === 'closed') {
      progress = 100;
      if (typeof confetti === 'function') {
        confetti({ particleCount: 50, spread: 60, origin: { y: 0.7 } });
      }
    } else if (newStatus === 'new' || newStatus === 'todo') {
      progress = 0;
    } else if (newStatus === 'in_progress' && progress === 0) {
      progress = 25;
    }

    const targetId = getBackendId(id);
    if (targetId) {
      try {
        await apiFetch(`/api/tasks/${targetId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        });
      } catch (err) {
        console.error('Failed to sync updateTaskStatus to API:', err);
      }
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

  const submitTaskForReview = (id, notes) => {
    const task = (tasks || []).find(t => String(t.id) === String(id));
    if (!task) return;

    setTasks(prev => (prev || []).map(t => {
      if (String(t.id) === String(id)) {
        return {
          ...t,
          status: 'under_review',
          reviewStatus: 'submitted_for_review',
          reviewNotes: notes || 'Work finished, ready for supervisor validation.',
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

  const approveTask = (id, notes) => {
    const task = (tasks || []).find(t => String(t.id) === String(id));
    if (!task || !currentUser) return;

    const isSupervisor = currentUser.role === 'supervisor';
    const newReviewStatus = isSupervisor ? 'supervisor_approved' : 'admin_approved';
    const newStatus = 'completed';

    setTasks(prev => (prev || []).map(t => {
      if (String(t.id) === String(id)) {
        return {
          ...t,
          status: newStatus,
          progress: 100,
          reviewStatus: newReviewStatus,
          reviewNotes: notes || `Approved by ${currentUser.name}`,
          updatedAt: new Date().toISOString()
        };
      }
      return t;
    }));

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

  const reopenTask = (id, notes) => {
    const task = (tasks || []).find(t => String(t.id) === String(id));
    if (!task || !currentUser) return;

    setTasks(prev => (prev || []).map(t => {
      if (String(t.id) === String(id)) {
        return {
          ...t,
          status: 'in_progress',
          reviewStatus: 'reopened',
          reviewNotes: notes || `Reopened by ${currentUser.name}. Additional changes needed.`,
          updatedAt: new Date().toISOString()
        };
      }
      return t;
    }));

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

  const toggleChecklistItem = (taskId, checklistId) => {
    setTasks(prev => prev.map(t => {
      if (String(t.id) === String(taskId)) {
        const updatedChecklists = (t.checklists || []).map(c => {
          if (String(c.id) === String(checklistId)) {
            const nextCompleted = !c.completed;
            return {
              ...c,
              completed: nextCompleted,
              completedBy: nextCompleted ? currentUser?.id : undefined,
              completedAt: nextCompleted ? new Date().toISOString() : undefined
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

  const addChecklistItem = (taskId, title) => {
    const newItem = {
      id: `chk_${Date.now()}`,
      title,
      completed: false
    };
    setTasks(prev => prev.map(t => {
      if (String(t.id) === String(taskId)) {
        return {
          ...t,
          checklists: [...(t.checklists || []), newItem],
          updatedAt: new Date().toISOString()
        };
      }
      return t;
    }));
  };

  const addSubTask = async (taskId, title, assignedToId, priority = 'normal', dueDate = new Date().toISOString().split('T')[0], type = 'flowchart') => {
    const newSub = {
      id: `sub_${Date.now()}`,
      title,
      assignedToId: assignedToId || currentUser?.id,
      status: 'todo',
      priority,
      dueDate,
      type,
      completed: false,
      estimatedHours: 4,
      actualHours: 0
    };

    const targetTaskId = getBackendId(taskId);
    if (targetTaskId) {
      try {
        await apiFetch('/api/subtasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, task_id: targetTaskId })
        });
      } catch (err) {
        console.error('Failed to sync subtask to API:', err);
      }
    }

    setTasks(prev => prev.map(t => {
      if (String(t.id) === String(taskId)) {
        return {
          ...t,
          subTasks: [...(t.subTasks || []), newSub],
          updatedAt: new Date().toISOString()
        };
      }
      return t;
    }));
  };

  const updateSubTaskStatus = async (taskId, subTaskId, status) => {
    const targetSubTaskId = getBackendId(subTaskId);
    if (targetSubTaskId) {
      try {
        await apiFetch(`/api/subtasks/${targetSubTaskId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status })
        });
      } catch (err) {
        console.error('Failed to sync subtask status to API:', err);
      }
    }

    setTasks(prev => prev.map(t => {
      if (String(t.id) === String(taskId)) {
        return {
          ...t,
          subTasks: (t.subTasks || []).map(st => String(st.id) === String(subTaskId) ? { ...st, status } : st),
          updatedAt: new Date().toISOString()
        };
      }
      return t;
    }));
  };

  const addTaskComment = async (taskId, content, isInternal = false) => {
    const newComment = {
      id: `com_${Date.now()}`,
      authorId: currentUser?.id,
      authorName: currentUser?.name,
      authorAvatar: currentUser?.avatar,
      authorRole: currentUser?.role,
      content,
      isInternal,
      createdAt: new Date().toISOString()
    };

    const targetTaskId = getBackendId(taskId);
    if (targetTaskId) {
      try {
        await apiFetch('/api/comments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, task_id: targetTaskId, author_id: currentUser?.backendId || getBackendId(currentUser?.id) || 1 })
        });
      } catch (err) {
        console.error('Failed to sync comment to API:', err);
      }
    }

    setTasks(prev => prev.map(t => {
      if (String(t.id) === String(taskId)) {
        return {
          ...t,
          comments: [...(t.comments || []), newComment],
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

  const createTicket = async (data) => {
    const assignee = findUserByAnyId(allUsers, data.assignedToId);
    const supervisorId = assignee?.supervisorId ?? data.supervisorId ?? null;
    const adminId = assignee?.adminId ?? data.adminId ?? null;

    const basePayload = {
      ...data,
      supervisorId,
      adminId,
      labels: data.labels || [],
    };

    // Lowercase, matching the backend's own defaults — same fix as
    // createTask. Also: the previous version only ever sent
    // title/description/priority/status/assigned_to_id — department,
    // category, severity, requester info, project_id, due_date, and both
    // SLA minute fields were never sent at all, despite CreateTicketInput
    // accepting all of them. A ticket created through this flow could
    // never actually record who the requester was or what its SLA was.
    const wirePayload = {
      ticket_number: basePayload.ticketNumber || undefined,
      title: basePayload.title,
      description: basePayload.description,
      department: basePayload.department || currentUser?.department || '',
      category: basePayload.category || '',
      priority: basePayload.priority || 'normal',
      severity: basePayload.severity || 'normal',
      status: basePayload.status || 'open',
      requester_name: basePayload.requesterName || '',
      requester_email: basePayload.requesterEmail || '',
      requester_company: basePayload.requesterCompany || '',
      project_id: getBackendId(basePayload.projectId) || null,
      assigned_to_id: assignee?.id ?? getBackendId(basePayload.assignedToId) ?? null,
      due_date: basePayload.dueDate || '',
      response_sla_minutes: basePayload.responseSlaMinutes ?? 0,
      resolution_sla_minutes: basePayload.resolutionSlaMinutes ?? 0,
      labels: Array.isArray(basePayload.labels) ? basePayload.labels.join(',') : (basePayload.labels || ''),
    };

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

    // NOTE: the auto-spawned linked task below is NOT sent to the
    // backend at all — only the ticket itself is. It's built with a
    // purely local fake id and inserted straight into local state. Since
    // fetchInitialData now does a full setTasks(...) replace from the
    // backend (see the Tasks normalization pass), this spawned task will
    // silently disappear the next time tasks are refetched — on reload,
    // definitely; possibly sooner if this app ever polls. This is a real
    // gap in a feature that was added independently of anything I built:
    // either it needs a real POST /api/tasks call (reusing createTask's
    // now-fixed logic) to actually persist, or the feature should be
    // reconsidered. Flagging rather than silently deciding — didn't want
    // to either rip out functionality you may be relying on, or paper
    // over its brokenness by making it LOOK persisted without being so.
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

    // Find the actual user object from allUsers via the shared canonical
    // lookup — matches on local id, legacyId, or backendId so this
    // resolves correctly regardless of which id scheme the caller passed.
    const targetUser = findUserByAnyId(allUsers, rawAssignedId);

    const canonicalAssignedId = targetUser ? targetUser.id : (rawAssignedId && rawAssignedId !== 'unassigned' ? rawAssignedId : null);
    const apiAssignedId = targetUser ? (targetUser.backendId || getBackendId(targetUser.id)) : getBackendId(rawAssignedId);

    if (targetId) {
      try {
        await apiFetch(`/api/tickets/${targetId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...updates,
            assigned_to_id: hasAssignedProp ? apiAssignedId : undefined
          })
        });
      } catch (err) {
        console.error('Failed to sync updateTicket to API:', err);
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
        await apiFetch(`/api/tickets/${targetId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, resolution_summary: resolutionSummary })
        });
      } catch (err) {
        console.error('Failed to sync updateTicketStatus to API:', err);
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
        await apiFetch(`/api/tickets/${targetId}/escalate`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ level, reason })
        });
      } catch (err) {
        console.error('Failed to sync escalateTicket to API:', err);
      }
    }

    setTickets(prev => prev.map(t => {
      if (String(t.id) === String(id)) {
        return {
          ...t,
          status: 'escalated',
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
  };

  const addTicketComment = (ticketId, content) => {
    const newComment = {
      id: `tcom_${Date.now()}`,
      authorId: currentUser?.id,
      authorName: currentUser?.name,
      authorAvatar: currentUser?.avatar,
      authorRole: currentUser?.role,
      content,
      isInternal: false,
      createdAt: new Date().toISOString()
    };
    setTickets(prev => prev.map(t => {
      if (String(t.id) === String(ticketId)) {
        return {
          ...t,
          comments: [...(t.comments || []), newComment],
          firstResponseAt: t.firstResponseAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }
      return t;
    }));
  };

  const addTicketInternalNote = (ticketId, content) => {
    const newNote = {
      id: `note_${Date.now()}`,
      authorId: currentUser?.id,
      authorName: currentUser?.name,
      authorAvatar: currentUser?.avatar,
      content,
      createdAt: new Date().toISOString()
    };
    setTickets(prev => prev.map(t => {
      if (String(t.id) === String(ticketId)) {
        return {
          ...t,
          internalNotes: [...(t.internalNotes || []), newNote],
          updatedAt: new Date().toISOString()
        };
      }
      return t;
    }));

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
  };

  const addTicketResponse = (ticketId, content, isInternalNote = false) => {
    const newResponse = {
      id: `resp_${Date.now()}`,
      authorId: currentUser?.id,
      authorName: currentUser?.name,
      authorAvatar: currentUser?.avatar,
      authorRole: currentUser?.role,
      content,
      isInternalNote,
      createdAt: new Date().toISOString()
    };
    setTickets(prev => prev.map(t => {
      if (String(t.id) === String(ticketId)) {
        return {
          ...t,
          responses: [...(t.responses || []), newResponse],
          firstResponseAt: t.firstResponseAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      }
      return t;
    }));

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

  const assignTicket = (ticketId, agentId) => {
    const ticket = tickets.find(t => String(t.id) === String(ticketId));
    if (!ticket) return;

    const agent = findUserByAnyId(allUsers, agentId);

    setTickets(prev => prev.map(t => {
      if (String(t.id) === String(ticketId)) {
        return {
          ...t,
          assignedToId: agent ? agent.id : (agentId || undefined),
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
      details: agent ? `Reassigned to ${agent.name}` : 'Unassigned'
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
  };

  const deleteTicket = async (id) => {
    const targetId = getBackendId(id);
    if (targetId) {
      try {
        await apiFetch(`/api/tickets/${targetId}`, { method: 'DELETE' });
      } catch (err) {
        console.error('Failed to sync deleteTicket to API:', err);
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

  const createUser = (userData) => {
    const newId = `usr_${Date.now().toString(36)}`;
    const newUser = {
      ...userData,
      id: newId,
      createdAt: new Date().toISOString(),
      lastActive: 'Active now'
    };
    setAllUsers(prev => [...prev, newUser]);

    logAudit({
      actorId: currentUser?.id,
      actorName: currentUser?.name,
      actorRole: currentUser?.role,
      action: 'USER_CREATED',
      entityType: 'user',
      entityId: newId,
      entityTitle: newUser.name,
      details: `Created new user account with role ${newUser.role.toUpperCase()} in ${newUser.department}`
    });
  };

  const updateUser = (userId, updates) => {
    setAllUsers(prev => prev.map(u => String(u.id) === String(userId) ? { ...u, ...updates } : u));
    logAudit({
      actorId: currentUser?.id,
      actorName: currentUser?.name,
      actorRole: currentUser?.role,
      action: 'USER_UPDATED',
      entityType: 'user',
      entityId: userId,
      entityTitle: `User ${userId}`,
      details: `Updated user profile attributes: ${Object.keys(updates).join(', ')}`
    });
  };

  const toggleUserStatus = (userId) => {
    const user = allUsers.find(u => String(u.id) === String(userId));
    if (!user) return;
    const nextStatus = user.status === 'active' ? 'deactivated' : 'active';
    setAllUsers(prev => prev.map(u => String(u.id) === String(userId) ? { ...u, status: nextStatus } : u));

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

  const createCustomRole = (roleKey, roleDisplayName, initialPermissions = {}) => {
    if (currentUser?.role !== 'super_admin') return;

    const normalizedKey = roleKey.toLowerCase().trim().replace(/\s+/g, '_');
    if (!normalizedKey) return;

    if (customRoles.includes(normalizedKey)) {
      alert('Role already exists!');
      return;
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

  const deleteCustomRole = (roleKey) => {
    if (currentUser?.role !== 'super_admin') return;

    const builtInRoles = ['super_admin', 'admin', 'supervisor', 'staff', 'client'];
    if (builtInRoles.includes(roleKey)) return;

    setCustomRoles(prev => {
      const updated = prev.filter(r => r !== roleKey);
      localStorage.setItem(STORAGE_KEYS.CUSTOM_ROLES, JSON.stringify(updated));
      return updated;
    });

    setPermissionMatrix(prev => {
      const updated = { ...prev };
      delete updated[roleKey];
      localStorage.setItem(STORAGE_KEYS.PERMISSION_MATRIX, JSON.stringify(updated));
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

  const updateRolePermission = (role, permissionKey, value) => {
    if (currentUser?.role !== 'super_admin') return;
    if (role === 'super_admin') return;

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

  const resetToSeedData = () => {
    localStorage.clear();
    // Users are no longer reset here — there's no local seed array to
    // reset them TO anymore, and this button shouldn't silently wipe real
    // backend user data. Instead, this now logs the current session out
    // (clearing currentUserId and the auth token) so the app returns to
    // the login screen — a real backend reseed (truncate + restart) is
    // what actually resets user data now, matching how the rest of this
    // migration moved seeding to the backend.
    setCurrentUserIdState(null);
    setAuthToken(null);
    // Projects, Tasks, and Tickets are no longer reset here either, same
    // reasoning as Users above — they're backend-sourced now, not a
    // local seed array.
    setAuditLogs(SEED_AUDIT_LOGS);
    setNotifications(SEED_NOTIFICATIONS);
    setPermissionMatrix(DEFAULT_PERMISSION_MATRIX);
    setCustomRoles(['super_admin', 'admin', 'supervisor', 'staff', 'client']);
    setActiveTab('dashboard');
  };

  return (
    <AppContext.Provider
      value={{
        currentUser,
        allUsers,
        users: allUsers,
        authToken,
        setAuthToken,
        projects,
        clients,
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
        userNotifications,
        unreadNotificationCount,
        setCurrentUserId,
        logAudit,
        uploadAvatar,
        createProject,
        updateProject,
        togglePinProject,
        deleteProject,
        addProjectAttachment,
        createClient,
        updateClient,
        deleteClient,
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
        resetToSeedData,
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
        quickCreateOpen,
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