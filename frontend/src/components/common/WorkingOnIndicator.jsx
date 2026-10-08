import React, { useState } from 'react';
import { Play, Square, Loader2 } from 'lucide-react';
import { getBackendId, useAppSelector } from '../../context/AppContext';

// "I'm working on this" — who is actively working on a task, ticket or
// project right now, plus the Start / Stop button for the person allowed to
// set it (the task's / ticket's assignee, or a project member).
//
//   <WorkingOnIndicator type="task" record={task} />            compact (lists)
//   <WorkingOnIndicator type="ticket" record={ticket} size="md" /> drawers / modals
//
// The server is the source of truth (handlers/working.go) and clears markers
// on finished / reassigned work; the checks here only hide a stale marker
// straight away, before the next refresh.

const PROJECT_FINISHED = new Set(['completed', 'cancelled', 'archived']);

const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='50' fill='%23cbd5e1'/%3E%3Ccircle cx='50' cy='38' r='18' fill='%2394a3b8'/%3E%3Cellipse cx='50' cy='92' rx='34' ry='26' fill='%2394a3b8'/%3E%3C/svg%3E";

const sameId = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);

export const isWorkFinished = (type, status, getStatusCategory) => {
  if (!status) return false;
  if (type === 'project') return PROJECT_FINISHED.has(status);
  if (status === 'archived') return true;
  const cat = getStatusCategory ? getStatusCategory(type, status) : '';
  if (cat === 'done' || cat === 'cancelled') return true;
  // Fallback when the status catalog hasn't loaded yet.
  return type === 'task'
    ? ['done', 'cancelled'].includes(status)
    : ['resolved', 'closed', 'cancelled'].includes(status);
};

// Is this person (still) on the record — the only people who can work on it.
const isOnRecord = (type, record, userId) => {
  if (!record) return false;
  if (type === 'project') return (record.memberIds || []).some(id => sameId(id, userId));
  return sameId(record.assignedToId, userId);
};

// Active markers on a record, minus ones that no longer hold.
export const activeWorkersFor = (workSessions, type, record, getStatusCategory) => {
  if (!record) return [];
  const bid = getBackendId(record.id);
  const list = workSessions?.byRecord?.[`${type}:${bid}`] || [];
  if (!list.length) return list;
  if (isWorkFinished(type, record.status, getStatusCategory)) return [];
  return list.filter(w => isOnRecord(type, record, w.userId));
};

const sinceLabel = (iso) => {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ${mins % 60} min`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
};

const workerTooltip = (workers) =>
  workers.map(w => `${w.userName || 'Someone'} — working on this${sinceLabel(w.startedAt) ? ` for ${sinceLabel(w.startedAt)}` : ''}`).join('\n');

export const WorkingOnIndicator = ({ type, record, size = 'sm', className = '' }) => {
  const { workSessions, currentUser, startWorking, stopWorking, getStatusCategory } = useAppSelector(s => ({
    workSessions: s.workSessions,
    currentUser: s.currentUser,
    startWorking: s.startWorking,
    stopWorking: s.stopWorking,
    getStatusCategory: s.getStatusCategory,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!record) return null;

  const workers = activeWorkersFor(workSessions, type, record, getStatusCategory);
  const finished = isWorkFinished(type, record.status, getStatusCategory);
  const canSet = !!currentUser && !finished && isOnRecord(type, record, currentUser.id);
  const mine = !!currentUser && workers.some(w => sameId(w.userId, currentUser.id));
  const others = workers.filter(w => !currentUser || !sameId(w.userId, currentUser.id));

  if (!workers.length && !canSet) return null;

  const toggle = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const res = mine ? await stopWorking(type, record.id) : await startWorking(type, record.id);
    setBusy(false);
    if (!res?.ok) {
      setError(res?.error || 'Something went wrong');
      setTimeout(() => setError(''), 4000);
    }
  };

  const md = size === 'md';
  const noun = type === 'project' ? 'project' : type;

  // Who's on it (everyone but me — "me" is shown by the button's state).
  const chip = others.length > 0 && (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-semibold ${md ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[10px]'}`}
      title={workerTooltip(others)}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      <span className="flex -space-x-1.5">
        {others.slice(0, 3).map(w => (
          <img
            key={w.userId}
            src={w.userAvatar || DEFAULT_AVATAR}
            alt={w.userName}
            className={`${md ? 'w-5 h-5' : 'w-4 h-4'} rounded-full object-cover ring-1 ring-white dark:ring-zinc-900`}
          />
        ))}
      </span>
      <span className="truncate max-w-[12rem]">
        {others.length === 1
          ? `${others[0].userName || 'Someone'} is working on this`
          : `${others[0].userName || 'Someone'} +${others.length - 1} working`}
      </span>
    </span>
  );

  const button = canSet && (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      title={mine ? `Stop showing that you're working on this ${noun}` : `Let your department see you're working on this ${noun}`}
      className={`inline-flex items-center gap-1 rounded-full border font-semibold transition cursor-pointer disabled:opacity-60 disabled:cursor-wait ${md ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[10px]'} ${
        mine
          ? 'border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600 hover:border-emerald-600'
          : 'border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:border-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400'
      }`}
    >
      {busy ? (
        <Loader2 className={`${md ? 'w-3.5 h-3.5' : 'w-3 h-3'} animate-spin`} />
      ) : mine ? (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
        </span>
      ) : (
        <Play className={`${md ? 'w-3.5 h-3.5' : 'w-3 h-3'}`} />
      )}
      <span>{mine ? "I'm working on this" : 'Start working'}</span>
      {mine && !busy && <Square className={`${md ? 'w-3 h-3' : 'w-2.5 h-2.5'} opacity-80`} />}
    </button>
  );

  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 ${className}`}>
      {chip}
      {button}
      {error && <span className="text-[10px] text-rose-600 dark:text-rose-400 font-medium">{error}</span>}
    </span>
  );
};

// What one person is working on right now — for the Team view's member
// cards. Lists only records the viewer can see (the server already filtered
// them). Clicking one opens it.
const TYPE_STYLE = {
  task: 'text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-900',
  ticket: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900',
  project: 'text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-900',
};

export const WorkingNowList = ({ userId, max = 4 }) => {
  const { workSessions, setSelectedTaskId, setSelectedTicketId, setSelectedProjectDetailId } = useAppSelector(s => ({
    workSessions: s.workSessions,
    setSelectedTaskId: s.setSelectedTaskId,
    setSelectedTicketId: s.setSelectedTicketId,
    setSelectedProjectDetailId: s.setSelectedProjectDetailId,
  }));
  const [showAll, setShowAll] = useState(false);
  const list = workSessions?.byUser?.[userId] || [];
  if (!list.length) return null;

  const open = (e, w) => {
    e.stopPropagation();
    if (w.recordType === 'task') setSelectedTaskId(w.recordId);
    else if (w.recordType === 'ticket') setSelectedTicketId(w.recordId);
    else if (w.recordType === 'project') setSelectedProjectDetailId(w.recordId);
  };

  const shown = showAll ? list : list.slice(0, max);
  return (
    <div className="pt-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 mb-1.5">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        Working on now ({list.length})
      </div>
      <div className="flex flex-col gap-1">
        {shown.map(w => (
          <button
            key={`${w.recordType}:${w.recordId}`}
            type="button"
            onClick={(e) => open(e, w)}
            title={`${w.recordTitle}${sinceLabel(w.startedAt) ? ` — for ${sinceLabel(w.startedAt)}` : ''}`}
            className={`w-full text-left flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] cursor-pointer hover:brightness-95 transition ${TYPE_STYLE[w.recordType] || ''}`}
          >
            <span className="font-mono font-semibold shrink-0">{w.recordNumber || w.recordType}</span>
            <span className="truncate text-slate-700 dark:text-zinc-300">{w.recordTitle}</span>
          </button>
        ))}
      </div>
      {list.length > max && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setShowAll(v => !v); }}
          className="mt-1 text-[10px] font-semibold text-slate-500 dark:text-zinc-400 hover:text-indigo-600 cursor-pointer"
        >
          {showAll ? 'Show less' : `Show all ${list.length}`}
        </button>
      )}
    </div>
  );
};

export default WorkingOnIndicator;
