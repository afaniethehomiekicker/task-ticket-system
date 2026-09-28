export const PERMISSION_KEYS = {
  MANAGE_USERS: 'manage_users',
  VIEW_AUDIT_LOGS: 'view_audit_logs',
  MANAGE_MATRIX_PERMISSIONS: 'manage_matrix_permissions',
  CREATE_PROJECTS: 'create_projects',
  CREATE_TASKS: 'create_tasks',
  APPROVE_WORK: 'approve_work',
  ESCALATE_TICKETS: 'escalate_tickets',
  ASSIGN_TICKETS: 'assign_tickets',
  MANAGE_CLIENTS: 'manage_clients',
  MANAGE_DEPARTMENTS: 'manage_departments',
  VIEW_INTERNAL_NOTES: 'view_internal_notes',
  CREATE_FEASIBILITIES: 'create_feasibilities',
  GRANT_RECORD_ACCESS: 'grant_record_access',
  TRANSFER_ASSIGNED_WORK: 'transfer_assigned_work'
};

export const PERMISSION_LABELS = {
  [PERMISSION_KEYS.MANAGE_USERS]: 'Manage User Accounts & Roles',
  [PERMISSION_KEYS.VIEW_AUDIT_LOGS]: 'View System Audit Trail',
  [PERMISSION_KEYS.MANAGE_MATRIX_PERMISSIONS]: 'Settings & Matrix Management',
  [PERMISSION_KEYS.CREATE_PROJECTS]: 'Create & Edit Projects',
  [PERMISSION_KEYS.CREATE_TASKS]: 'Create Tasks',
  [PERMISSION_KEYS.APPROVE_WORK]: 'Approve & Sign-off Tasks',
  [PERMISSION_KEYS.ESCALATE_TICKETS]: 'Escalate Incident Tickets',
  [PERMISSION_KEYS.ASSIGN_TICKETS]: 'Reassign Tickets & Tasks',
  [PERMISSION_KEYS.MANAGE_CLIENTS]: 'Manage Client & Company Profiles',
  [PERMISSION_KEYS.MANAGE_DEPARTMENTS]: 'Manage Departments',
  [PERMISSION_KEYS.VIEW_INTERNAL_NOTES]: 'View & Write Internal Notes',
  [PERMISSION_KEYS.CREATE_FEASIBILITIES]: 'Create Feasibility Requests',
  [PERMISSION_KEYS.GRANT_RECORD_ACCESS]: 'Grant Record Access',
  [PERMISSION_KEYS.TRANSFER_ASSIGNED_WORK]: 'Transfer My Work Within Department'
};

// Default role -> permission matrix. Super Admin is deliberately excluded —
// it always has every capability regardless of what this matrix says.
export const DEFAULT_PERMISSION_MATRIX = {
  admin: {
    [PERMISSION_KEYS.MANAGE_USERS]: true,
    [PERMISSION_KEYS.VIEW_AUDIT_LOGS]: false,
    [PERMISSION_KEYS.MANAGE_MATRIX_PERMISSIONS]: false,
    [PERMISSION_KEYS.CREATE_PROJECTS]: true,
    [PERMISSION_KEYS.CREATE_TASKS]: true,
    [PERMISSION_KEYS.APPROVE_WORK]: true,
    [PERMISSION_KEYS.ESCALATE_TICKETS]: true,
    [PERMISSION_KEYS.ASSIGN_TICKETS]: true,
    [PERMISSION_KEYS.MANAGE_CLIENTS]: true,
    [PERMISSION_KEYS.MANAGE_DEPARTMENTS]: true,
    [PERMISSION_KEYS.VIEW_INTERNAL_NOTES]: true,
    [PERMISSION_KEYS.CREATE_FEASIBILITIES]: true,
    [PERMISSION_KEYS.GRANT_RECORD_ACCESS]: true,
    [PERMISSION_KEYS.TRANSFER_ASSIGNED_WORK]: true
  },
  supervisor: {
    [PERMISSION_KEYS.MANAGE_USERS]: false,
    [PERMISSION_KEYS.VIEW_AUDIT_LOGS]: false,
    [PERMISSION_KEYS.MANAGE_MATRIX_PERMISSIONS]: false,
    [PERMISSION_KEYS.CREATE_PROJECTS]: false,
    [PERMISSION_KEYS.CREATE_TASKS]: true,
    [PERMISSION_KEYS.APPROVE_WORK]: true,
    [PERMISSION_KEYS.ESCALATE_TICKETS]: true,
    [PERMISSION_KEYS.ASSIGN_TICKETS]: true,
    [PERMISSION_KEYS.MANAGE_CLIENTS]: false,
    [PERMISSION_KEYS.MANAGE_DEPARTMENTS]: false,
    [PERMISSION_KEYS.VIEW_INTERNAL_NOTES]: true,
    [PERMISSION_KEYS.CREATE_FEASIBILITIES]: true,
    [PERMISSION_KEYS.GRANT_RECORD_ACCESS]: false,
    [PERMISSION_KEYS.TRANSFER_ASSIGNED_WORK]: true
  },
  staff: {
    [PERMISSION_KEYS.MANAGE_USERS]: false,
    [PERMISSION_KEYS.VIEW_AUDIT_LOGS]: false,
    [PERMISSION_KEYS.MANAGE_MATRIX_PERMISSIONS]: false,
    [PERMISSION_KEYS.CREATE_PROJECTS]: false,
    [PERMISSION_KEYS.CREATE_TASKS]: false,
    [PERMISSION_KEYS.APPROVE_WORK]: false,
    [PERMISSION_KEYS.ESCALATE_TICKETS]: true,
    [PERMISSION_KEYS.ASSIGN_TICKETS]: false,
    [PERMISSION_KEYS.MANAGE_CLIENTS]: false,
    [PERMISSION_KEYS.MANAGE_DEPARTMENTS]: false,
    [PERMISSION_KEYS.VIEW_INTERNAL_NOTES]: false,
    [PERMISSION_KEYS.CREATE_FEASIBILITIES]: true,
    [PERMISSION_KEYS.GRANT_RECORD_ACCESS]: false,
    [PERMISSION_KEYS.TRANSFER_ASSIGNED_WORK]: true
  }
};

const safeLower = (str) => (str || '').toLowerCase();

/**
 * Action permissions updated for Super Admin vs. Admin restrictions with null guards
 */
export function canCreateProject(user, permissionMatrix = DEFAULT_PERMISSION_MATRIX) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return !!permissionMatrix?.[user.role]?.[PERMISSION_KEYS.CREATE_PROJECTS];
}

export function canCreateTask(user, permissionMatrix = DEFAULT_PERMISSION_MATRIX) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return !!permissionMatrix?.[user.role]?.[PERMISSION_KEYS.CREATE_TASKS];
}

export function canCreateTicket(user) {
  return !!user;
}

export function canManageUsers(user, permissionMatrix = DEFAULT_PERMISSION_MATRIX) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return !!permissionMatrix?.[user.role]?.[PERMISSION_KEYS.MANAGE_USERS];
}

export function canViewAuditLogs(user, permissionMatrix = DEFAULT_PERMISSION_MATRIX) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return !!permissionMatrix?.[user.role]?.[PERMISSION_KEYS.VIEW_AUDIT_LOGS];
}

export function canManageMatrixPermissions(user, permissionMatrix = DEFAULT_PERMISSION_MATRIX) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return !!permissionMatrix?.[user.role]?.[PERMISSION_KEYS.MANAGE_MATRIX_PERMISSIONS];
}

export function canApproveWork(user, permissionMatrix = DEFAULT_PERMISSION_MATRIX) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return !!permissionMatrix?.[user.role]?.[PERMISSION_KEYS.APPROVE_WORK];
}

export function canEscalateTicket(user, ticket, permissionMatrix = DEFAULT_PERMISSION_MATRIX) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  if (permissionMatrix?.[user.role]?.[PERMISSION_KEYS.ESCALATE_TICKETS]) return true;
  return ticket?.assignedToId === user.id;
}

export function canAssignTickets(user, permissionMatrix = DEFAULT_PERMISSION_MATRIX) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return !!permissionMatrix?.[user.role]?.[PERMISSION_KEYS.ASSIGN_TICKETS];
}

// The backend gates client create/update/delete on manage_clients
// (routes.go), but the frontend had no matching permission, so every role saw
// New Client / Edit / Delete and got a 403 on click.
// Private management comments / internal notes (spec: visible only to
// authorized management). The backend strips them from every response for
// anyone without this permission; this only decides what UI to show.
export function canViewInternalNotes(user, permissionMatrix = DEFAULT_PERMISSION_MATRIX) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return !!permissionMatrix?.[user.role]?.[PERMISSION_KEYS.VIEW_INTERNAL_NOTES];
}

// Raising a feasibility request (spec: staff raise them). Archive / restore /
// convert-to-project stay on create_projects.
export function canCreateFeasibility(user, permissionMatrix = DEFAULT_PERMISSION_MATRIX) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return !!permissionMatrix?.[user.role]?.[PERMISSION_KEYS.CREATE_FEASIBILITIES];
}

// Explicitly sharing one record (e.g. pulling a staff member from another
// department into one task) — spec slide 6/16. Admins by default.
export function canGrantRecordAccess(user, permissionMatrix = DEFAULT_PERMISSION_MATRIX) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return !!permissionMatrix?.[user.role]?.[PERMISSION_KEYS.GRANT_RECORD_ACCESS];
}

// Passing work assigned to YOU to a colleague in your own department (spec
// slide 20: "Transferred to L2", "Staff A ... assigns to Staff B"). Separate
// from canAssignTickets, which reassigns anyone's work.
export function canTransferOwnWork(user, permissionMatrix = DEFAULT_PERMISSION_MATRIX) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return !!permissionMatrix?.[user.role]?.[PERMISSION_KEYS.TRANSFER_ASSIGNED_WORK];
}

// Active colleagues in the user's own department (transfer targets).
export function sameDepartmentUsers(user, users = []) {
  const dept = (user?.department || '').trim().toLowerCase();
  if (!dept) return [];
  return users.filter(u => u.status === 'active' &&
    (u.department || '').trim().toLowerCase() === dept);
}

// Admins and super admins assign tasks to their team; they can't be assigned
// a task or sub-task themselves (the backend enforces the same rule).
export function isTaskAssignable(user) {
  return !!user && user.role !== 'admin' && user.role !== 'super_admin';
}

export function canManageClients(user, permissionMatrix = DEFAULT_PERMISSION_MATRIX) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return !!permissionMatrix?.[user.role]?.[PERMISSION_KEYS.MANAGE_CLIENTS];
}

// Matches role.go's manage_departments defaults exactly (admin: true,
// supervisor/staff: false) — used by DepartmentsView.jsx (gates
// create/edit/delete) and Sidebar.jsx (gates the nav entry).
export function canManageDepartments(user, permissionMatrix = DEFAULT_PERMISSION_MATRIX) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return !!permissionMatrix?.[user.role]?.[PERMISSION_KEYS.MANAGE_DEPARTMENTS];
}

export function getRoleBadgeColor(role) {
  switch (role) {
    case 'super_admin':
      return { bg: 'bg-purple-50 dark:bg-purple-950/40', text: 'text-purple-700 dark:text-purple-300', border: 'border-purple-200 dark:border-purple-800' };
    case 'admin':
      return { bg: 'bg-blue-50 dark:bg-blue-950/40', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-200 dark:border-blue-800' };
    case 'supervisor':
      return { bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-800' };
    case 'staff':
      return { bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-200 dark:border-emerald-800' };
    default:
      return { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200' };
  }
}

export function getRoleDisplayName(role) {
  switch (role) {
    case 'super_admin': return 'Super Admin';
    case 'admin': return 'Admin';
    case 'supervisor': return 'Supervisor';
    case 'staff': return 'Staff';
    default: return role || 'Guest';
  }
}

// Visibility filters — control which records a user is allowed to see,
// layered on top of the action permissions above.
//
// These mirror the backend's visibility rules exactly (backend/visibility.go),
// which is where they are actually enforced now — the API only returns what
// these functions would keep. Change one, change the other.
//
//   super_admin   everything
//   admin         their department; an admin with NO department is a system
//                 admin and sees everything (otherwise such an account would
//                 see nothing at all)
//   supervisor    work assigned to them, work assigned to people they
//                 supervise, work they created
//   staff/other   work assigned to them, work they created
//   projects      department / owner (admins) or membership (everyone)

const isSystemAdmin = (user) => user.role === 'admin' && !safeLower(user.department);

export function filterProjectsForUser(projects = [], user, allUsers = []) {
  if (!Array.isArray(projects) || !user) return [];
  if (user.role === 'super_admin' || isSystemAdmin(user)) return projects;

  const isMember = (p) => (p.memberIds || []).includes(user.id);

  if (user.role === 'admin') {
    const userDept = safeLower(user.department);
    return projects.filter(p => {
      if (!p) return false;
      return safeLower(p.department) === userDept || p.ownerId === user.id || isMember(p);
    });
  }

  // supervisor / staff / custom roles — only projects they're a member of
  return projects.filter(p => p && isMember(p));
}

export const filterTasksForUser = (tasks = [], user, allUsers = []) => {
  if (!Array.isArray(tasks) || !user) return [];
  if (user.role === 'super_admin' || isSystemAdmin(user)) return tasks;

  const userDept = safeLower(user.department);

  return tasks.filter(task => {
    if (!task) return false;
    // Parent of a sub-task assigned to this user: the server already decided
    // they may see it (as a reference view).
    if (task.accessLevel === 'subtask' || task.accessLevel === 'granted') return true;

    if (user.role === 'admin') {
      // Same rule as the server (visibility.go): their department's tasks,
      // tasks they created, and tasks assigned to people in their
      // department — wherever the task's project lives. This mirror only
      // allowed the first, so a task an admin assigned inside a project from
      // another department (or with none) vanished from their own list even
      // though the server sent it.
      const taskDept = safeLower(task.department);
      if (taskDept && taskDept === userDept) return true;
      if (String(task.creatorId) === String(user.id)) return true;
      const assignee = (allUsers || []).find(u => String(u.id) === String(task.assignedToId));
      return !!assignee && !!userDept && safeLower(assignee.department) === userDept;
    }

    // Assigned to me, or created by me (the creator has to be able to follow
    // up on what they raised).
    if (task.assignedToId === user.id || task.creatorId === user.id) return true;
    // A supervisor also sees their team's work.
    return user.role === 'supervisor' && task.supervisorId === user.id;
  });
};

export function filterTicketsForUser(tickets = [], user, allUsers = []) {
  if (!Array.isArray(tickets) || !user) return [];
  if (user.role === 'super_admin' || isSystemAdmin(user)) return tickets;

  const userDept = safeLower(user.department);

  return tickets.filter(t => {
    if (!t) return false;

    if (user.role === 'admin') {
      // Mirrors the server: their department's tickets, tickets their
      // department raised (routed elsewhere), tickets they created, and
      // tickets assigned to their people.
      const ticketDept = safeLower(t.department);
      if (ticketDept && ticketDept === userDept) return true;
      if (userDept && safeLower(t.originDepartment) === userDept) return true;
      if (String(t.createdById) === String(user.id)) return true;
      const assignee = (allUsers || []).find(u => String(u.id) === String(t.assignedToId));
      return !!assignee && !!userDept && safeLower(assignee.department) === userDept;
    }

    // Assigned to me, or created by me (the spec has the creator close the
    // ticket after the client confirms).
    if (t.assignedToId === user.id || t.createdById === user.id) return true;
    return user.role === 'supervisor' && t.supervisorId === user.id;
  });
}
// "5 days (40 h)" / "40 h" — a project's budget as entered, with hours.
export function formatBudget(project) {
  if (!project) return '—';
  const hours = Number(project.budgetHours) || 0;
  const value = Number(project.budgetValue) || 0;
  if (project.budgetUnit === 'days' && value) {
    return `${value} day${value === 1 ? '' : 's'} (${hours} h)`;
  }
  return `${hours} h`;
}

// Name of whoever assigned the work: from the record, else the people list.
export function assignedByName(record, users = []) {
  if (!record || !record.assignedById) return '';
  if (record.assignedByName) return record.assignedByName;
  return (users || []).find(u => String(u.id) === String(record.assignedById))?.name || '';
}

// Readable date for display: "28 Oct 2026". Accepts "2026-10-28" or a full
// timestamp ("2026-10-28T05:00:00+05:00"), which was being shown raw.
export function formatDate(value) {
  if (!value) return '';
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
