import React, { useEffect, useState } from 'react';
import { useAppSelector } from '../../context/AppContext';
import { Timer, AlertTriangle, CheckCircle2 } from 'lucide-react';

// SLA tracking for one ticket — spec slide 22: "System tracks: start time,
// SLA deadline, remaining time, acknowledged?, work started?, breached?"
// Remaining time counts down live. Once the SLA is breached, the server's
// monitor escalates the ticket up the chain automatically.

const STEP_LABELS = ['Not escalated', 'Department Head', 'Department Admin', 'Super Admin'];

const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

const duration = (ms) => {
  const abs = Math.abs(ms);
  const mins = Math.floor(abs / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

export const SLAStatus = ({ ticket }) => {
  const { getStatusCategory } = useAppSelector(s => ({ getStatusCategory: s.getStatusCategory }));
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const deadline = ticket.slaDeadline ? new Date(ticket.slaDeadline).getTime() : null;
  const category = getStatusCategory('ticket', ticket.status);
  const finished = ['done', 'cancelled', 'archived'].includes(category);
  const finishedAt = ticket.resolvedAt || ticket.closedAt;

  let state = 'none';
  let text = 'No SLA set';
  if (deadline) {
    if (finished) {
      const at = finishedAt ? new Date(finishedAt).getTime() : null;
      if (at && at <= deadline) { state = 'met'; text = 'SLA met'; }
      else if (at) { state = 'missed'; text = `SLA missed by ${duration(at - deadline)}`; }
      else { state = 'met'; text = 'Finished'; }
    } else if (now > deadline) {
      state = 'breached'; text = `Breached ${duration(now - deadline)} ago`;
    } else {
      state = (deadline - now) < 15 * 60000 ? 'soon' : 'ok';
      text = `${duration(deadline - now)} remaining`;
    }
  }

  const tone = {
    breached: 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300',
    missed: 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300',
    soon: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300',
    ok: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300',
    met: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300',
    none: 'bg-slate-100 dark:bg-zinc-900/60 border-slate-300 dark:border-zinc-800 text-slate-600 dark:text-zinc-400',
  }[state];

  const Icon = state === 'breached' || state === 'missed' ? AlertTriangle : state === 'met' ? CheckCircle2 : Timer;

  return (
    <div className={`p-3 rounded-xl border text-xs space-y-2 ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold flex items-center gap-1.5">
          <Icon className="w-4 h-4" /> {text}
        </span>
        <span className="opacity-80">Deadline: {fmt(ticket.slaDeadline)}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-slate-700 dark:text-zinc-300">
        <span>Started: {fmt(ticket.createdAt)}</span>
        <span>Acknowledged: {ticket.acknowledgedAt ? fmt(ticket.acknowledgedAt) : 'not yet'}</span>
        <span>Work started: {ticket.workStartedAt ? fmt(ticket.workStartedAt) : 'not yet'}</span>
        <span>
          Auto-escalation: {STEP_LABELS[ticket.autoEscalationStep] || STEP_LABELS[0]}
        </span>
      </div>
    </div>
  );
};
