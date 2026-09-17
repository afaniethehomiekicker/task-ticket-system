import React, { createContext, useContext, useState, useEffect, useMemo, useRef } from 'react';
import {
  filterProjectsForUser, filterTasksForUser, filterTicketsForUser,
  DEFAULT_PERMISSION_MATRIX, getRoleDisplayName, PERMISSION_KEYS
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
    address: raw.address || '',
    stack: raw.stack || '',
    skills: raw.skills || '',
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
    // Richer than the original seed data's bare ['TSK-103'] strings —
    // this is a genuinely new feature (no dependency UI/handler existed
    // at all before), so the shape is designed fresh rather than
    // constrained to match old mock data. Real task ids are kept
    // alongside the display number specifically so a "remove" action has
    // something real to call DELETE .../dependencies/:depId with.
    dependencies: Array.isArray(raw.depends_on)
      ? raw.depends_on.map(d => ({
          id: d.id ?? d.ID,
          taskNumber: d.task_number || '',
          title: d.title || '',
          status: d.status || '',
        })).filter(d => d.id)
      : [],
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
    // Computed server-side, fresh, every response — see the Breached
    // field comment in models.go for why this is never stored.
    breached: !!raw.breached,
    // TicketsView.jsx already had SLA-breach UI built in, expecting these
    // exact names — it was silently dead (badge never lit, due date
    // never shown) purely because this function didn't produce them.
    // Aliased rather than renamed, since `breached`/`dueDate` are also
    // used/expected elsewhere.
    slaBreached: !!raw.breached,
    slaDueTime: raw.due_date || null,
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
    const saved = localStorage.getItem(STORAGE_KEYS.USERS);
    return saved ? JSON.parse(saved) : [];
  });

  const [currentUserId, setCurrentUserIdState] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.CURRENT_USER_ID);
    return saved || null;
  });

  const [projects, setProjects] = useState(() => {
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
    const saved = localStorage.getItem(STORAGE_KEYS.TASKS);
    return saved ? JSON.parse(saved) : [];
  });

  const [tickets, setTickets] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.TICKETS);
    return saved ? JSON.parse(saved) : [];
  });

  const [auditLogs, setAuditLogs] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.AUDIT_LOGS);
    return saved ? JSON.parse(saved) : [];
  });

  const [notifications, setNotifications] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS);
    return saved ? JSON.parse(saved) : [];
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

  const didFetchInitialDataRef = useRef(false);

  useEffect(() => {
    if (didFetchInitialDataRef.current) return;
    didFetchInitialDataRef.current = true;

    const fetchInitialData = async () => {
      try {
        const [usersRes, projectsRes, tasksRes, ticketsRes, clientsRes, permissionsRes] = await Promise.allSettled([
          apiFetch('/api/users'),
          apiFetch('/api/projects'),
          apiFetch('/api/tasks'),
          apiFetch('/api/tickets'),
          apiFetch('/api/clients'),
          apiFetch('/api/permissions')
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

        if (permissionsRes.status === 'fulfilled' && permissionsRes.value.ok) {
          const data = await permissionsRes.value.json();
          // data.matrix is already shaped exactly as permissions.js and
          // SettingsView.jsx expect — {[roleKey]: {[permissionKey]: bool}}
          // — no transformation needed. data.roles includes super_admin
          // too (seeded at startup); existing UI logic already filters
          // it out of the editable columns, so no special-casing here.
          if (data.matrix) setPermissionMatrix(data.matrix);
          if (Array.isArray(data.roles)) setCustomRoles(data.roles.map(r => r.key));
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
        console.warn('Backend API offline, operating on local cache:', err);
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
  const [quickCreatePickerOpen, setQuickCreatePickerOpen] = useState(false);

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

    if (id === null || id === undefined) {
      localStorage.removeItem(STORAGE_KEYS.CURRENT_USER_ID);
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

    const memberIds = Array.from(new Set([
      ...(data.memberIds || []),
      ...(currentUser?.id ? [currentUser.id] : [])
    ]));

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

    const wirePayload = {
      task_number: taskNumber,
      title: basePayload.title,
      description: basePayload.description,
      department: basePayload.department || currentUser?.department || '',
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

    const wireUpdates = { ...updates };
    ['assignedToId', 'projectId', 'creatorId'].forEach(key => {
      if (key in wireUpdates) {
        const val = wireUpdates[key];
        wireUpdates[key] = (val === '' || val === null || val === undefined) ? null : getBackendId(val);
      }
    });
    if ('estimatedHours' in wireUpdates) {
      wireUpdates.estimatedHours = Number(wireUpdates.estimatedHours) || 0;
    }

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
      const res = await apiFetch('/api/subtasks', {
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
      const res = await apiFetch(`/api/subtasks/${targetSubTaskId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        const resData = await res.json();
        savedSub = normalizeSubTask(resData.subtask);
      }
    } catch (err) {
      console.error('Failed to sync subtask status to API:', err);
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
      const res = await apiFetch('/api/comments', {
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

  const postTicketComment = async (ticketId, content, isInternal) => {
    const targetTicketId = getBackendId(ticketId);
    let savedComment = null;
    try {
      const res = await apiFetch('/api/comments', {
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
    await postTicketComment(ticketId, content, false);
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
    if (updates.currentPassword) wirePayload.current_password = updates.currentPassword;
    if (updates.address !== undefined) wirePayload.address = updates.address;
    if (updates.stack !== undefined) wirePayload.stack = updates.stack;
    if (updates.skills !== undefined) wirePayload.skills = updates.skills;
    if (updates.department !== undefined) wirePayload.department = updates.department;
    if (updates.supervisorId !== undefined) wirePayload.supervisor_id = getBackendId(updates.supervisorId);
    if (updates.adminId !== undefined) wirePayload.admin_id = getBackendId(updates.adminId);
    if (updates.status !== undefined) wirePayload.status = updates.status;

    let savedUser = null;
    if (targetId) {
      try {
        const res = await apiFetch(`/api/users/${targetId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(wirePayload)
        });
        const resData = await res.json().catch(() => ({}));
        if (!res.ok) {
          // Previously fell through to an optimistic local update even
          // on failure, which is exactly why a rejected/failed save
          // looked identical to a successful one until the next reload
          // re-fetched the real, unchanged DB state.
          alert(resData.error || 'Failed to update user.');
          return null;
        }
        savedUser = normalizeUser(resData.user);
      } catch (err) {
        console.error('Failed to sync updateUser to API:', err);
        alert('Failed to update user. Please check your connection and try again.');
        return null;
      }
    }

    setAllUsers(prev => prev.map(u => String(u.id) === String(userId)
      ? (savedUser || { ...u, ...updates })
      : u
    ));

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

    return savedUser || true;
  };

  const toggleUserStatus = async (userId) => {
    const user = allUsers.find(u => String(u.id) === String(userId));
    if (!user) return;
    // Was 'deactivated' — standardizing on 'active'/'inactive' since the
    // backend's login check specifically tests for 'inactive'.
    const nextStatus = user.status === 'active' ? 'inactive' : 'active';

    // Delegates to updateUser for the real backend call — this used to
    // be purely local state with no backend call at all.
    const result = await updateUser(userId, { status: nextStatus });
    if (!result) return; // updateUser already alerted with the real error

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

  const deleteUser = async (userId) => {
    const targetId = getBackendId(userId);
    const user = allUsers.find(u => String(u.id) === String(userId));

    if (targetId) {
      try {
        const res = await apiFetch(`/api/users/${targetId}`, { method: 'DELETE' });
        const resData = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(resData.error || 'Failed to delete user.');
          return;
        }
      } catch (err) {
        console.error('Failed to sync deleteUser to API:', err);
        alert('Failed to delete user. Please check your connection and try again.');
        return;
      }
    }

    setAllUsers(prev => prev.filter(u => String(u.id) !== String(userId)));

    if (user) {
      logAudit({
        actorId: currentUser?.id,
        actorName: currentUser?.name,
        actorRole: currentUser?.role,
        action: 'USER_DELETED',
        entityType: 'user',
        entityId: userId,
        entityTitle: user.name,
        details: `Deleted user account ${user.name}`
      });
    }
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

    let created = null;
    try {
      const res = await apiFetch('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: normalizedKey, label: roleDisplayName || roleKey })
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(resData.error || 'Failed to create role.');
        return;
      }
      created = resData.role;
    } catch (err) {
      console.error('Failed to sync createCustomRole to API:', err);
      alert('Failed to create role. Please check your connection and try again.');
      return;
    }

    // CreateRole always seeds every permission as false server-side —
    // each granted checkbox in the "Create Custom Role" modal needs its
    // own follow-up call to actually grant it. Sequential, not
    // parallel: this is a rare, admin-only action, and sequential calls
    // are simpler to reason about than a batch endpoint that doesn't
    // exist yet.
    const grantedKeys = Object.keys(initialPermissions).filter(k => initialPermissions[k]);
    for (const key of grantedKeys) {
      try {
        await apiFetch(`/api/permissions/${created.key}/${key}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ granted: true })
        });
      } catch (err) {
        console.error(`Failed to grant initial permission ${key} for new role:`, err);
      }
    }

    setCustomRoles(prev => [...prev, created.key]);
    setPermissionMatrix(prev => ({
      ...prev,
      [created.key]: Object.fromEntries(
        Object.values(PERMISSION_KEYS).map(k => [k, !!initialPermissions[k]])
      )
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

    const builtInRoles = ['super_admin', 'admin', 'supervisor', 'staff', 'client'];
    if (builtInRoles.includes(roleKey)) return;

    try {
      const res = await apiFetch(`/api/roles/${roleKey}`, { method: 'DELETE' });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(resData.error || 'Failed to delete role.');
        return;
      }
    } catch (err) {
      console.error('Failed to sync deleteCustomRole to API:', err);
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

    // Optimistic, with rollback on failure — a single-cell toggle should
    // feel instant, but silently keeping a change that never actually
    // persisted is exactly the class of bug this whole feature exists to
    // avoid, so a failure reverts the cell rather than leaving it wrong.
    setPermissionMatrix(prev => ({
      ...prev,
      [role]: { ...(prev[role] || {}), [permissionKey]: value }
    }));

    try {
      const res = await apiFetch(`/api/permissions/${role}/${permissionKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ granted: value })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        alert(errData.error || 'Failed to update permission.');
        setPermissionMatrix(prev => ({
          ...prev,
          [role]: { ...(prev[role] || {}), [permissionKey]: !value }
        }));
        return;
      }
    } catch (err) {
      console.error('Failed to sync updateRolePermission to API:', err);
      alert('Failed to update permission. Please check your connection and try again.');
      setPermissionMatrix(prev => ({
        ...prev,
        [role]: { ...(prev[role] || {}), [permissionKey]: !value }
      }));
      return;
    }

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
    setCurrentUserIdState(null);
    setAuthToken(null);
    setAuditLogs([]);
    setNotifications([]);
    // Roles/permissionMatrix are no longer reset here — they're
    // backend-sourced now (GET /api/permissions), same reasoning as
    // Users/Projects/Tasks/Tickets above. A real reset means truncating
    // the roles/role_permissions tables server-side, not overwriting
    // local state with DEFAULT_PERMISSION_MATRIX.
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
        apiFetch,
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
        deleteUser,
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