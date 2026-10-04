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
  TRANSFER_ASSIGNED_WORK: 'transfer_assigned_work',
  MANAGE_VENDORS: 'manage_vendors',
  ARCHIVE_RECORDS: 'archive_records'
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
  [PERMISSION_KEYS.TRANSFER_ASSIGNED_WORK]: 'Transfer My Work Within Department',
  [PERMISSION_KEYS.MANAGE_VENDORS]: 'Manage Vendor List',
  [PERMISSION_KEYS.ARCHIVE_RECORDS]: 'Archive & Restore Projects, Tasks & Tickets'
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
    [PERMISSION_KEYS.TRANSFER_ASSIGNED_WORK]: true,
    [PERMISSION_KEYS.MANAGE_VENDORS]: true,
    [PERMISSION_KEYS.ARCHIVE_RECORDS]: true
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
    [PERMISSION_KEYS.TRANSFER_ASSIGNED_WORK]: true,
    [PERMISSION_KEYS.MANAGE_VENDORS]: false,
    [PERMISSION_KEYS.ARCHIVE_RECORDS]: false
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
    [PERMISSION_KEYS.TRANSFER_ASSIGNED_WORK]: true,
    [PERMISSION_KEYS.MANAGE_VENDORS]: false,
    [PERMISSION_KEYS.ARCHIVE_RECORDS]: false
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

// Every department a person belongs to: their home department plus any
// additional ones a Super Admin added (staff only), trimmed and lower-cased.
export function userDepartments(user) {
  const out = [];
  [user?.department, ...(user?.extraDepartments || [])].forEach(d => {
    const v = (d || '').trim().toLowerCase();
    if (v && !out.includes(v)) out.push(v);
  });
  return out;
}

// Whether a person belongs to a department — home or additional. Same rule
// as the server (usersInDeptSQL / memberOf in visibility.go).
export function isInDepartment(user, dept) {
  const d = (dept || '').trim().toLowerCase();
  return !!d && userDepartments(user).includes(d);
}

// Active colleagues in any of the user's departments (transfer targets).
export function sameDepartmentUsers(user, users = []) {
  const mine = userDepartments(user);
  if (!mine.length) return [];
  return users.filter(u => u.status === 'active' &&
    mine.some(d => isInDepartment(u, d)));
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
// Departments are configured by the Super Admin only (spec slide 5; the
// backend enforces the same in Department.go). The matrix toggle no longer
// grants this to other roles. permissionMatrix is kept in the signature so
// existing call sites don't change.
// eslint-disable-next-line no-unused-vars
export function canManageDepartments(user, permissionMatrix = DEFAULT_PERMISSION_MATRIX) {
  return !!user && user.role === 'super_admin';
}

// Vendor master (Vendors page): add, edit, archive and restore vendors.
// Everyone can view the list — feasibility vendor pickers need it.
export function canManageVendors(user, permissionMatrix = DEFAULT_PERMISSION_MATRIX) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return !!permissionMatrix?.[user.role]?.[PERMISSION_KEYS.MANAGE_VENDORS];
}

// Archive and restore projects, tasks, tickets and subtasks (the backend's
// archive_records permission). Was hard-coded to admin / super_admin in
// every component, so the matrix toggle didn't exist.
export function canArchiveRecords(user, permissionMatrix = DEFAULT_PERMISSION_MATRIX) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  return !!permissionMatrix?.[user.role]?.[PERMISSION_KEYS.ARCHIVE_RECORDS];
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
//   admin         their department. Every Admin is a Department Admin (spec
//                 slide 5); only the Super Admin sees everything. There is no
//                 "admin with no department sees everything" tier any more.
//   supervisor    work assigned to them, work assigned to people they
//                 supervise, work they created
//   staff/other   work assigned to them, work they created
//   projects      department / owner (admins) or membership (everyone)

export function filterProjectsForUser(projects = [], user, allUsers = []) {
  if (!Array.isArray(projects) || !user) return [];
  if (user.role === 'super_admin') return projects;

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
  if (user.role === 'super_admin') return tasks;

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
      // Their people include staff who are also in their department.
      return !!assignee && !!userDept && isInDepartment(assignee, userDept);
    }

    // Assigned to me, or created by me (the creator has to be able to follow
    // up on what they raised).
    if (task.assignedToId === user.id || task.creatorId === user.id) return true;
    // A supervisor also sees their team's work.
    return user.role === 'supervisor' && task.supervisorId === user.id;
  });
};

// ---- CNOC ticket flow (spec slides 19-20) -------------------------------
// Mirrors internal/handlers/ticket_flow_rules.go — the server enforces these;
// the screens use them to only offer what will work.
//   HANDLER: the team the ticket is with now — its assignee, or anyone in
//            that department who can reassign tickets (or a super admin).
//   RAISER:  the department it came from — its creator, or anyone there
//            who can reassign tickets (or a super admin).
const normDept = (d) => (d || '').trim().toLowerCase();
const sameDeptName = (a, b) => !!normDept(a) && normDept(a) === normDept(b);
export const ticketOrigin = (t) => (t?.originDepartment || '').trim() || (t?.department || '').trim();
export const isTicketAwayFromOrigin = (t) =>
  !!(t?.originDepartment || '').trim() && !sameDeptName(t.originDepartment, t.department);

export function handlesTicketNow(user, t, permissionMatrix = DEFAULT_PERMISSION_MATRIX) {
  if (!user || !t) return false;
  if (user.role === 'super_admin' || String(t.assignedToId) === String(user.id)) return true;
  return canAssignTickets(user, permissionMatrix) && sameDeptName(user.department, t.department);
}

export function raisedTicket(user, t, permissionMatrix = DEFAULT_PERMISSION_MATRIX) {
  if (!user || !t) return false;
  if (user.role === 'super_admin' || String(t.createdById) === String(user.id)) return true;
  return canAssignTickets(user, permissionMatrix) && sameDeptName(user.department, ticketOrigin(t));
}

// May change the status / assignment / route: its handlers, plus its
// creator while it is still in their own department.
export function canWorkTicket(user, t, permissionMatrix = DEFAULT_PERMISSION_MATRIX) {
  if (handlesTicketNow(user, t, permissionMatrix)) return true;
  return !!user && String(t?.createdById) === String(user.id) && !isTicketAwayFromOrigin(t);
}

// Which statuses this person may pick for this ticket (the status dropdown
// and the edit form). "Reopened" only through the Reopen step; while the
// ticket is away from the department that raised it, finishing it goes
// through Return, not a status. The current status is always kept.
export function allowedTicketStatuses(user, t, statuses = [], getCategory = () => '', permissionMatrix = DEFAULT_PERMISSION_MATRIX) {
  const away = isTicketAwayFromOrigin(t) && user?.role !== 'super_admin';
  return statuses.filter(st => {
    if (st.key === t?.status) return true;
    if (st.key === 'reopened') return false;
    if (!canWorkTicket(user, t, permissionMatrix)) return false;
    const cat = getCategory('ticket', st.key);
    return !(away && (cat === 'done' || cat === 'cancelled'));
  });
}

export function filterTicketsForUser(tickets = [], user, allUsers = []) {
  if (!Array.isArray(tickets) || !user) return [];
  if (user.role === 'super_admin') return tickets;

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
      // Tickets their department worked on and returned (read-only).
      if (userDept && safeLower(t.returnedFromDept) === userDept) return true;
      if (String(t.returnedById) === String(user.id)) return true;
      const assignee = (allUsers || []).find(u => String(u.id) === String(t.assignedToId));
      return !!assignee && !!userDept && isInDepartment(assignee, userDept);
    }

    // Assigned to me, created by me (the spec has the creator close the
    // ticket after the client confirms), or worked on and returned by me.
    if (String(t.assignedToId) === String(user.id) || String(t.createdById) === String(user.id)) return true;
    if (String(t.returnedById) === String(user.id)) return true;
    if (user.role !== 'supervisor') return false;
    // Tickets assigned to the people they supervise. Read from the people
    // directory — tickets no longer carry the assignee's full record.
    const assignee = (allUsers || []).find(u => String(u.id) === String(t.assignedToId));
    return String(assignee?.supervisorId ?? t.supervisorId) === String(user.id);
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

// SLA state of a ticket for filtering (spec slide 28: "SLA — Breached ·
// Near · Within"): "breached" past the deadline; "near" in the last 25% of
// the SLA window or under an hour left; "within" otherwise; "none" when there
// is no deadline or the ticket is finished (isFinished(status)).
export function ticketSlaState(ticket, isFinished) {
  if (!ticket?.slaDeadline) return 'none';
  if (isFinished && isFinished(ticket.status)) return 'none';
  const deadline = new Date(ticket.slaDeadline).getTime();
  const now = Date.now();
  if (now > deadline) return 'breached';
  const start = ticket.createdAt ? new Date(ticket.createdAt).getTime() : deadline - 3600000;
  const remaining = deadline - now;
  if (remaining < 3600000 || remaining < (deadline - start) * 0.25) return 'near';
  return 'within';
}