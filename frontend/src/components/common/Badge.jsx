import React from 'react';
import { useAppSelector } from '../../context/AppContext';
import { isStaffRole, getRoleDisplayName } from '../../utils/permissions';

// Status badges read the configurable status catalog (Settings → Workflow
// Statuses) for the label, so renamed and newly added statuses display
// correctly. Colour: a specific one for well-known keys, otherwise by the
// status's category.
const CATEGORY_COLORS = {
  open: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',
  active: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300',
  waiting: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  review: 'bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300',
  done: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  cancelled: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  archived: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500',
};

const CatalogStatusBadge = ({ entity, status, keyColors }) => {
  // Only the status getters: a badge re-renders when the status catalog changes, nothing else.
  const app = useAppSelector(s => ({ getStatusLabel: s.getStatusLabel, getStatusCategory: s.getStatusCategory }));
  const label = app.getStatusLabel ? app.getStatusLabel(entity, status) : (status || '').replace(/_/g, ' ');
  const category = app.getStatusCategory ? app.getStatusCategory(entity, status) : '';
  const bg = keyColors[status] || CATEGORY_COLORS[category] || CATEGORY_COLORS.open;
  return (
    <span
      id={`${entity}-status-badge-${status}`}
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium whitespace-nowrap ${bg}`}
    >
      {label}
    </span>
  );
};




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

  // Custom roles (created in Settings and now assignable to users) aren't in
  // the map above. They used to fall through to map.staff, so a "Technician"
  // rendered as a green "Staff" badge. Show the real role name in a neutral
  // style instead; only a missing role still defaults to Staff.
  const prettify = (r) => String(r).split('_').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const current = map[role] || (role && isStaffRole(role) ? { ...map.staff, label: getRoleDisplayName(role) } : null) || (role ? {
    bg: 'bg-slate-100 dark:bg-zinc-800',
    text: 'text-slate-700 dark:text-zinc-300',
    border: 'border-slate-200 dark:border-zinc-700',
    label: getRoleDisplayName(role) || prettify(role)
  } : map.staff);

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

export const TaskStatusBadge = ({ status }) => (
  <CatalogStatusBadge
    entity="task"
    status={status}
    keyColors={{
      blocked: 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
    }}
  />
);

export const TicketStatusBadge = ({ status }) => (
  <CatalogStatusBadge
    entity="ticket"
    status={status}
    keyColors={{
      assigned: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300',
      closed: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
      blocked: 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
      reopened: 'bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300',
    }}
  />
);

export const ProjectStatusBadge = ({ status }) => {
  // Added "cancelled" — the actual backend enum for Project.Status (see
  // models.go) includes it, and its absence here meant a cancelled
  // project fell through to the default and displayed a green "Active"
  // badge, which is actively misleading rather than just cosmetically
  // off.
  const map = {
    planning: { bg: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300', text: '', label: 'Planning' },
    active: { bg: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300', text: '', label: 'Active' },
    on_hold: { bg: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300', text: '', label: 'On Hold' },
    completed: { bg: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300', text: '', label: 'Completed' },
    cancelled: { bg: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400', text: '', label: 'Cancelled' },
    archived: { bg: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500', text: '', label: 'Archived' }
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