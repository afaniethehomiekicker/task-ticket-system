import React from 'react';




export const RoleBadge = ({ role, size = 'sm' }) => {
  const sizeClasses = {
    xs: 'text-[10px] px-1.5 py-0.5 font-medium',
    sm: 'text-xs px-2.5 py-0.5 font-medium',
    md: 'text-sm px-3 py-1 font-semibold'
  }[size];

  const map = {
    super_admin: {
      bg: 'bg-purple-100 dark:bg-purple-950/60',
      text: 'text-purple-700 dark:text-purple-300',
      border: 'border-purple-200 dark:border-purple-800/80',
      label: 'Super Admin'
    },
    admin: {
      bg: 'bg-blue-100 dark:bg-blue-950/60',
      text: 'text-blue-700 dark:text-blue-300',
      border: 'border-blue-200 dark:border-blue-800/80',
      label: 'Admin'
    },
    supervisor: {
      bg: 'bg-amber-100 dark:bg-amber-950/60',
      text: 'text-amber-700 dark:text-amber-300',
      border: 'border-amber-200 dark:border-amber-800/80',
      label: 'Supervisor'
    },
    staff: {
      bg: 'bg-emerald-100 dark:bg-emerald-950/60',
      text: 'text-emerald-700 dark:text-emerald-300',
      border: 'border-emerald-200 dark:border-emerald-800/80',
      label: 'Staff'
    }
  };

  const current = map[role] || map.staff;

  return (
    <span
      id={`role-badge-${role}`}
      className={`inline-flex items-center whitespace-nowrap rounded-md border ${current.bg} ${current.text} ${current.border} ${sizeClasses}`}
    >
      {current.label}
    </span>
  );
};

export const PriorityBadge = ({ priority, showIcon }) => {
  const map = {
    low: { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-700 dark:text-slate-300', dot: 'bg-slate-400', label: 'Low' },
    normal: { bg: 'bg-blue-50 dark:bg-blue-950/50', text: 'text-blue-700 dark:text-blue-300', dot: 'bg-blue-500', label: 'Normal' },
    high: { bg: 'bg-amber-50 dark:bg-amber-950/50', text: 'text-amber-700 dark:text-amber-300', dot: 'bg-amber-500', label: 'High' },
    urgent: { bg: 'bg-orange-50 dark:bg-orange-950/50', text: 'text-orange-700 dark:text-orange-300', dot: 'bg-orange-500', label: 'Urgent' },
    critical: { bg: 'bg-rose-50 dark:bg-rose-950/50', text: 'text-rose-700 dark:text-rose-300', dot: 'bg-rose-600 animate-pulse', label: 'Critical' }
  };

  const c = map[priority] || map.normal;

  return (
    <span
      id={`priority-badge-${priority}`}
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${c.bg} ${c.text}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
};

export const TaskStatusBadge = ({ status }) => {
  const map = {
    new: { bg: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300', text: '', label: 'New' },
    todo: { bg: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300', text: '', label: 'To Do' },
    in_progress: { bg: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300', text: '', label: 'In Progress' },
    on_hold: { bg: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300', text: '', label: 'On Hold' },
    under_review: { bg: 'bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300', text: '', label: 'Under Review' },
    completed: { bg: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300', text: '', label: 'Completed' },
    closed: { bg: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400', text: '', label: 'Closed' }
  };

  const c = map[status] || map.todo;

  return (
    <span
      id={`task-status-badge-${status}`}
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium whitespace-nowrap ${c.bg}`}
    >
      {c.label}
    </span>
  );
};

export const TicketStatusBadge = ({ status }) => {
  const map = {
    open: { bg: 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300', text: '', label: 'Open' },
    assigned: { bg: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300', text: '', label: 'Assigned' },
    in_progress: { bg: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300', text: '', label: 'In Progress' },
    pending: { bg: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300', text: '', label: 'Pending' },
    escalated: { bg: 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 font-semibold', text: '', label: 'Escalated' },
    resolved: { bg: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300', text: '', label: 'Resolved' },
    closed: { bg: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400', text: '', label: 'Closed' },
    reopened: { bg: 'bg-orange-50 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300', text: '', label: 'Reopened' }
  };

  const c = map[status] || map.open;

  return (
    <span
      id={`ticket-status-badge-${status}`}
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium whitespace-nowrap ${c.bg}`}
    >
      {c.label}
    </span>
  );
};

export const ProjectStatusBadge = ({ status }) => {
  const map = {
    planning: { bg: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300', text: '', label: 'Planning' },
    active: { bg: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300', text: '', label: 'Active' },
    on_hold: { bg: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300', text: '', label: 'On Hold' },
    completed: { bg: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300', text: '', label: 'Completed' },
    archived: { bg: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400', text: '', label: 'Archived' }
  };

  const c = map[status] || map.active;

  return (
    <span
      id={`project-status-badge-${status}`}
      className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium whitespace-nowrap ${c.bg}`}
    >
      {c.label}
    </span>
  );
};