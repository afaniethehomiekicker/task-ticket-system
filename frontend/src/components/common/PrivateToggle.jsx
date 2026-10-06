import React from 'react';
import { Lock, Users } from 'lucide-react';

// Private / department-visible switch for tasks and tickets.
//
//   Off (default)  everyone in the department can VIEW it (read-only);
//                  only the people working on it can change it.
//   On  (private)  only the assignee, the creator, the assignee's
//                  supervisor, the department admin and the Super Admin see it.
//
// The server enforces both (visibility.go) and who may flip it
// (canSetPrivacy) — `disabled` just avoids offering a change it will refuse.
export const PrivateToggle = ({ value, onChange, kind = 'task', disabled = false, compact = false }) => {
  const isPrivate = !!value;
  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-lg border px-3 ${compact ? 'py-2' : 'py-2.5'} ${
        isPrivate
          ? 'border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/30'
          : 'border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900'
      }`}
    >
      <div className="flex items-start gap-2 min-w-0">
        {isPrivate
          ? <Lock className="w-4 h-4 mt-0.5 shrink-0 text-purple-600 dark:text-purple-400" />
          : <Users className="w-4 h-4 mt-0.5 shrink-0 text-slate-500 dark:text-zinc-400" />}
        <div className="min-w-0">
          <span className="block text-xs font-semibold text-slate-800 dark:text-zinc-200">
            {isPrivate ? `Private ${kind}` : `Visible to the department`}
          </span>
          <span className="block text-[11px] leading-snug text-slate-500 dark:text-zinc-400">
            {isPrivate
              ? 'Only the assignee, the creator and their managers can see it.'
              : `Everyone in the department can view this ${kind}; only the people on it can change it.`}
          </span>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={isPrivate}
        aria-label={`Private ${kind}`}
        disabled={disabled}
        onClick={() => !disabled && onChange(!isPrivate)}
        title={disabled ? `Only the person who created this ${kind}, a supervisor or an admin can change this` : undefined}
        className={`relative inline-flex h-5 w-9 shrink-0 mt-0.5 rounded-full transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
          isPrivate ? 'bg-purple-600' : 'bg-slate-400 dark:bg-zinc-600'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            isPrivate ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
};

// Small lock marker for list rows and drawer headers.
export const PrivateBadge = ({ className = '' }) => (
  <span
    title="Private — only the people on it and their managers can see it"
    className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 ${className}`}
  >
    <Lock className="w-3 h-3" /> Private
  </span>
);

// Marker for records seen only through the department (read-only).
export const DeptViewBadge = ({ className = '' }) => (
  <span
    title="Your department's work — you can view it but not change it"
    className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 ${className}`}
  >
    <Users className="w-3 h-3" /> Dept · view only
  </span>
);
