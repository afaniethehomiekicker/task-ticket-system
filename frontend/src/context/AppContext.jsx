import { 
  SEED_PROJECTS, 
  SEED_TASKS, 
  SEED_USERS, 
  SEED_TICKETS, 
  SEED_AUDIT_LOGS, 
  SEED_NOTIFICATIONS 
} from '../data/seedData';
import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import {
  filterProjectsForUser, filterTasksForUser, filterTicketsForUser,
  DEFAULT_PERMISSION_MATRIX, getRoleDisplayName
} from '../utils/permissions';
import confetti from 'canvas-confetti';

// Export helper at top level so it is available globally
export const getBackendId = (rawId) => {
  if (typeof rawId === 'number') return rawId;
  if (!rawId || rawId === 'undefined') return null;
  const match = String(rawId).match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
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
  PERMISSION_MATRIX: 'pm_system_permission_matrix_v1'
};

export const AppProvider = ({ children }) => {
  const [allUsers, setAllUsers] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.USERS);
    return saved ? JSON.parse(saved) : SEED_USERS;
  });

  const [currentUserId, setCurrentUserIdState] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.CURRENT_USER_ID);
    return saved || null;
  });

  const [projects, setProjects] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.PROJECTS);
    return saved ? JSON.parse(saved) : SEED_PROJECTS;
  });

  const [tasks, setTasks] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.TASKS);
    return saved ? JSON.parse(saved) : SEED_TASKS;
  });

  const [tickets, setTickets] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.TICKETS);
    return saved ? JSON.parse(saved) : SEED_TICKETS;
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

  // --- Smart Merge Public Fetch from Go Backend API ---
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const [usersRes, projectsRes, tasksRes, ticketsRes] = await Promise.allSettled([
          fetch('/api/users'),
          fetch('/api/projects'),
          fetch('/api/tasks'),
          fetch('/api/tickets')
        ]);

        if (usersRes.status === 'fulfilled' && usersRes.value.ok) {
          const data = await usersRes.value.json();
          if (data.users && data.users.length > 0) {
            setAllUsers(prev => {
              const apiMap = new Map(data.users.map(u => [String(u.id || u.ID), u]));
              return prev.map(seedUser => {
                const idStr = String(seedUser.id);
                const numId = idStr.match(/\d+/)?.[0];
                const apiUser = apiMap.get(idStr) || (numId ? apiMap.get(numId) : null) || data.users.find(u => u.email === seedUser.email);
                return apiUser ? { ...seedUser, ...apiUser } : seedUser;
              });
            });
          }
        }

        if (projectsRes.status === 'fulfilled' && projectsRes.value.ok) {
          const data = await projectsRes.value.json();
          if (data.projects && data.projects.length > 0) {
            setProjects(prev => {
              const apiMap = new Map(data.projects.map(p => [String(p.id || p.ID), p]));
              const updated = prev.map(seed => {
                const idStr = String(seed.id);
                const numId = idStr.match(/\d+/)?.[0];
                const api = apiMap.get(idStr) || (numId ? apiMap.get(numId) : null);
                if (api) {
                  apiMap.delete(String(api.id || api.ID));
                  return {
                    ...seed,
                    ...api,
                    id: seed.id,
                    title: api.title || seed.title,
                    status: api.status || seed.status,
                    priority: api.priority || seed.priority,
                    department: api.department || seed.department,
                    budgetHours: api.budget_hours || api.budgetHours || seed.budgetHours,
                    startDate: api.start_date || api.startDate || seed.startDate,
                    endDate: api.end_date || api.endDate || seed.endDate,
                    memberIds: seed.memberIds || api.memberIds || [],
                    attachments: seed.attachments || api.attachments || []
                  };
                }
                return seed;
              });
              const remainingNew = Array.from(apiMap.values()).map(p => ({
                ...p,
                id: p.id || p.ID,
                memberIds: p.memberIds || [],
                attachments: p.attachments || []
              }));
              return [...updated, ...remainingNew];
            });
          }
        }

        if (tasksRes.status === 'fulfilled' && tasksRes.value.ok) {
          const data = await tasksRes.value.json();
          if (data.tasks && data.tasks.length > 0) {
            setTasks(prev => {
              const apiMap = new Map(data.tasks.map(t => [String(t.id || t.ID), t]));
              const updated = (prev || []).map(seed => {
                const idStr = String(seed.id);
                const numId = idStr.match(/\d+/)?.[0];
                const api = apiMap.get(idStr) || (numId ? apiMap.get(numId) : null);
                if (api) {
                  apiMap.delete(String(api.id || api.ID));
                  return {
                    ...seed,
                    ...api,
                    id: seed.id,
                    title: api.title || seed.title,
                    status: api.status || seed.status,
                    priority: api.priority || seed.priority,
                    labels: Array.isArray(api.labels) ? api.labels : (typeof api.labels === 'string' && api.labels ? api.labels.split(',') : seed.labels || []),
                    checklists: seed.checklists || api.checklists || [],
                    comments: seed.comments || api.comments || [],
                    subTasks: seed.subTasks || api.subTasks || []
                  };
                }
                return seed;
              });
              const remainingNew = Array.from(apiMap.values()).map(t => ({
                ...t,
                id: t.id || t.ID,
                taskNumber: t.taskNumber || t.TaskNumber || `TSK-${t.id || t.ID}`,
                labels: Array.isArray(t.labels) ? t.labels : (typeof t.labels === 'string' && t.labels ? t.labels.split(',') : []),
                checklists: t.checklists || [],
                comments: t.comments || [],
                subTasks: t.subTasks || []
              }));
              return [...updated, ...remainingNew];
            });
          }
        }

        if (ticketsRes.status === 'fulfilled' && ticketsRes.value.ok) {
          const data = await ticketsRes.value.json();
          if (data.tickets && data.tickets.length > 0) {
            setTickets(prev => {
              const apiMap = new Map(data.tickets.map(t => [String(t.id || t.ID), t]));
              const updated = (prev || []).map(seed => {
                const idStr = String(seed.id);
                const numId = idStr.match(/\d+/)?.[0];
                const api = apiMap.get(idStr) || (numId ? apiMap.get(numId) : null);
                if (api) {
                  apiMap.delete(String(api.id || api.ID));
                  return {
                    ...seed,
                    ...api,
                    id: seed.id,
                    title: api.title || seed.title,
                    status: api.status || seed.status,
                    priority: api.priority || seed.priority,
                    labels: Array.isArray(api.labels) ? api.labels : (typeof api.labels === 'string' && api.labels ? api.labels.split(',') : seed.labels || []),
                    internalNotes: seed.internalNotes || api.internalNotes || [],
                    comments: seed.comments || api.comments || [],
                    responses: seed.responses || api.responses || [],
                    attachments: seed.attachments || api.attachments || []
                  };
                }
                return seed;
              });
              const remainingNew = Array.from(apiMap.values()).map(t => ({
                ...t,
                id: t.id || t.ID,
                ticketNumber: t.ticketNumber || t.TicketNumber || `TCK-${t.id || t.ID}`,
                labels: Array.isArray(t.labels) ? t.labels : (typeof t.labels === 'string' && t.labels ? t.labels.split(',') : []),
                internalNotes: t.internalNotes || [],
                comments: t.comments || [],
                responses: t.responses || [],
                attachments: t.attachments || []
              }));
              return [...updated, ...remainingNew];
            });
          }
        }
      } catch (err) {
        console.warn('Backend API offline, operating on local cache/seed data:', err);
      }
    };

    fetchInitialData();
  }, []);

  useEffect(() => {
    if (!currentUserId) return;
    const activeUser = allUsers.find(u => String(u.id) === String(currentUserId));
    if (!activeUser || (activeUser.role !== 'super_admin' && activeUser.role !== 'admin')) return;

    const fetchAuditLogs = async () => {
      try {
        const res = await fetch('/api/audit-logs', {
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
    const found = allUsers.find(u => String(u.id) === String(currentUserId));
    return found || null;
  }, [allUsers, currentUserId]);

  const setCurrentUserId = (id) => {
    setCurrentUserIdState(id);
    localStorage.setItem(STORAGE_KEYS.CURRENT_USER_ID, String(id));

    const switchedUser = allUsers.find(u => String(u.id) === String(id));
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
      const res = await fetch('/api/upload', {
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

    const newId = `prj_${Date.now().toString(36)}`;
    const newProject = {
      ...data,
      id: newId,
      progress: 0,
      spentHours: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      await fetch('/api/projects', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-role': currentUser?.role === 'super_admin' ? 'Super Admin' : (currentUser?.role || 'Admin'),
          'x-user-id': String(currentUser?.id || 1)
        },
        body: JSON.stringify(newProject)
      });
    } catch (err) {
      console.error('Failed to sync createProject to API:', err);
    }

    setProjects(prev => [newProject, ...prev]);

    logAudit({
      actorId: currentUser?.id,
      actorName: currentUser?.name,
      actorRole: currentUser?.role,
      action: 'PROJECT_CREATED',
      entityType: 'project',
      entityId: newId,
      entityTitle: newProject.title,
      details: `Created project [${newProject.code}] for client/company ID: ${newProject.clientId || newProject.companyId}`
    });

    data.memberIds?.forEach(memId => {
      if (String(memId) !== String(currentUser?.id)) {
        pushNotification({
          recipientId: memId,
          title: 'Added to New Project',
          message: `You were assigned as a team member on project: ${newProject.title}`,
          type: 'assignment',
          entityType: 'project',
          entityId: newId
        });
      }
    });
  };

  const updateProject = async (id, updates) => {
    const targetId = getBackendId(id);
    if (targetId) {
      try {
        await fetch(`/api/projects/${targetId}`, {
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
        await fetch(`/api/projects/${targetId}`, { method: 'DELETE' });
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
    const taskNumber = `TSK-${count}`;
    const newId = `tsk_${Date.now().toString(36)}`;

    const assignee = allUsers?.find(u => String(u.id) === String(data.assignedToId));
    const supervisorId = assignee?.supervisorId || data.supervisorId;
    const adminId = assignee?.adminId || data.adminId;

    const newTask = {
      labels: [],
      subTasks: [],
      checklists: [],
      comments: [],
      description: '',
      dueDate: new Date().toISOString().split('T')[0],
      progress: 0,
      isPinned: false,
      ...data,
      id: newId,
      taskNumber,
      actualHours: 0,
      supervisorId,
      adminId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTask.title,
          description: newTask.description,
          status: newTask.status || 'New',
          priority: newTask.priority || 'Normal',
          labels: Array.isArray(newTask.labels) ? newTask.labels.join(',') : newTask.labels,
          project_id: getBackendId(newTask.projectId) || 1,
          assignee_id: getBackendId(newTask.assignedToId) || 1
        })
      });
    } catch (err) {
      console.error('Failed to sync createTask to API:', err);
    }

    setTasks(prev => [newTask, ...(prev || [])]);

    if (currentUser) {
      logAudit({
        actorId: currentUser.id,
        actorName: currentUser.name,
        actorRole: currentUser.role,
        action: 'TASK_CREATED',
        entityType: 'task',
        entityId: newId,
        entityTitle: `${taskNumber}: ${newTask.title}`,
        details: `Created task assigned to ${assignee?.name || 'Unassigned'} with priority ${newTask.priority}`
      });
    }

    if (newTask.assignedToId && currentUser && String(newTask.assignedToId) !== String(currentUser.id)) {
      pushNotification({
        recipientId: newTask.assignedToId,
        title: 'New Task Assignment',
        message: `You were assigned ${taskNumber}: ${newTask.title}`,
        type: 'assignment',
        entityType: 'task',
        entityId: newId
      });
    }
  };

  const updateTask = async (id, updates) => {
    const targetId = getBackendId(id);
    if (targetId) {
      try {
        await fetch(`/api/tasks/${targetId}`, {
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
        await fetch(`/api/tasks/${targetId}/status`, {
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
        await fetch('/api/subtasks', {
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
        await fetch(`/api/subtasks/${targetSubTaskId}/status`, {
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
        await fetch('/api/comments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, task_id: targetTaskId, author_id: getBackendId(currentUser?.id) || 1 })
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
        await fetch(`/api/tasks/${targetId}`, { method: 'DELETE' });
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
    const count = tickets.length + 1041;
    const ticketNumber = `TCK-${count}`;
    const newId = `tck_${Date.now().toString(36)}`;

    const assignee = allUsers.find(u => String(u.id) === String(data.assignedToId));
    const supervisorId = assignee?.supervisorId || data.supervisorId;
    const adminId = assignee?.adminId || data.adminId;

    const newTicket = {
      ...data,
      id: newId,
      ticketNumber,
      supervisorId,
      adminId,
      internalNotes: [],
      comments: [],
      responses: [],
      attachments: [],
      labels: data.labels || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTicket.title,
          description: newTicket.description,
          priority: newTicket.priority || 'Normal',
          status: newTicket.status || 'New',
          assigned_to_id: getBackendId(newTicket.assignedToId) || 1
        })
      });
    } catch (err) {
      console.error('Failed to sync createTicket to API:', err);
    }

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
      ticketId: newId,
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
      entityId: newId,
      entityTitle: `${ticketNumber}: ${newTicket.title}`,
      details: `Created new ${newTicket.priority} ticket requested by ${newTicket.requesterName} and spawned task ${taskNumber}`
    });

    if (newTicket.assignedToId && String(newTicket.assignedToId) !== String(currentUser?.id)) {
      pushNotification({
        recipientId: newTicket.assignedToId,
        title: 'New Ticket Assigned',
        message: `You were assigned ${ticketNumber} (${newTicket.priority.toUpperCase()} priority)`,
        type: 'assignment',
        entityType: 'ticket',
        entityId: newId
      });
    }
  };

  const updateTicket = async (id, updates) => {
    const targetId = getBackendId(id);
    if (targetId) {
      try {
        await fetch(`/api/tickets/${targetId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates)
        });
      } catch (err) {
        console.error('Failed to sync updateTicket to API:', err);
      }
    }

    setTickets(prev => prev.map(t => {
      if (String(t.id) === String(id)) {
        return { ...t, ...updates, updatedAt: new Date().toISOString() };
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
        await fetch(`/api/tickets/${targetId}/status`, {
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
        await fetch(`/api/tickets/${targetId}/escalate`, {
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

    const agent = allUsers.find(u => String(u.id) === String(agentId));

    setTickets(prev => prev.map(t => {
      if (String(t.id) === String(ticketId)) {
        return {
          ...t,
          assignedToId: agentId || undefined,
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
        await fetch(`/api/tickets/${targetId}`, { method: 'DELETE' });
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
    setAllUsers(SEED_USERS);
    setCurrentUserIdState('usr_super_admin');
    setProjects(SEED_PROJECTS);
    setTasks(SEED_TASKS);
    setTickets(SEED_TICKETS);
    setAuditLogs(SEED_AUDIT_LOGS);
    setNotifications(SEED_NOTIFICATIONS);
    setPermissionMatrix(DEFAULT_PERMISSION_MATRIX);
    setActiveTab('dashboard');
  };

  return (
    <AppContext.Provider
      value={{
        currentUser,
        allUsers,
        users: allUsers,
        projects,
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