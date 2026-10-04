import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { isTaskAssignable, canWorkTicket, handlesTicketNow, raisedTicket } from '../../utils/permissions';
import { Route, Undo2, RotateCcw, Building2 } from 'lucide-react';

// CNOC / Support flow for one ticket — spec slide 19:
//   Create Ticket -> Assign ("Routed to Technical Dept / L1 / L2 / L3 / staff")
//   -> Work & Escalate -> Client Confirms. "Resolved -> Closed. Not resolved
//   -> Reopened." "If Client says not resolved: CNOC adds new comment/detail
//   -> Ticket is returned or reassigned -> technical team investigates again.
//   The loop is fully tracked, not restarted."
// Slide 20: "Returned to CNOC after L2 completion", "Closed by User A after
// client confirmation".
//
// Route: send it on to a department (optionally a named person there).
// Return: hand it back to the department that raised it, marked Resolved.
// Reopen: client not satisfied — straight back to whoever returned it.

export const TicketFlowActions = ({ ticket }) => {
  const {
    currentUser, permissionMatrix, departments, searchAssignees, apiFetch,
    routeTicket, returnTicket, reopenTicket, getStatusCategory,
  } = useApp();
  const [mode, setMode] = useState(null); // 'route' | 'return' | 'reopen'
  const [dept, setDept] = useState('');
  const [assignee, setAssignee] = useState('');
  const [people, setPeople] = useState([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // Departments are re-read from the server whenever the Route form opens,
  // so the list is never stale or empty because of how the app loaded.
  const [deptList, setDeptList] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (mode !== 'route') return undefined;
    apiFetch('/api/departments')
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to load departments');
        const list = (data.departments || [])
          .map(d => ({ id: d.id ?? d.ID, name: d.name || '' }))
          .filter(d => d.name);
        if (!cancelled) setDeptList(list);
      })
      .catch(() => { if (!cancelled) setDeptList(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // People in the chosen department (the directory only lists your own
  // department unless you're an admin — otherwise route to the department and
  // its admin assigns it).
  useEffect(() => {
    let cancelled = false;
    setAssignee('');
    if (mode !== 'route' || !dept) { setPeople([]); return undefined; }
    searchAssignees({ department: dept })
      .then(list => {
        if (!cancelled) {
          setPeople(list.filter(u => (u.department || '').toLowerCase() === dept.toLowerCase() && isTaskAssignable(u)));
        }
      })
      .catch(() => { if (!cancelled) setPeople([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dept, mode]);

  const me = String(currentUser?.id);
  const isAssignee = String(ticket.assignedToId) === me;
  const category = getStatusCategory('ticket', ticket.status);
  const finished = ['done', 'cancelled', 'archived'].includes(category);
  const origin = (ticket.originDepartment || '').trim();
  const awayFromOrigin = origin && origin.toLowerCase() !== (ticket.department || '').trim().toLowerCase();

  // Same rules as the server (ticket_flow_rules.go): the team the ticket is
  // with routes it on and returns it; the creator may route it only while it
  // is still in their own department; the raising department reopens it.
  const canRoute = !finished && canWorkTicket(currentUser, ticket, permissionMatrix);
  const canReturn = !finished && awayFromOrigin && handlesTicketNow(currentUser, ticket, permissionMatrix);
  const canReopen = category === 'done' && (raisedTicket(currentUser, ticket, permissionMatrix) || isAssignee);

  if (ticket.status === 'archived' || (!canRoute && !canReturn && !canReopen && !origin)) return null;

  // Every department except the one it's with now.
  const routeTargets = (deptList || departments || [])
    .filter(d => d.name && d.name.trim().toLowerCase() !== (ticket.department || '').trim().toLowerCase());

  const reset = () => { setMode(null); setDept(''); setAssignee(''); setNote(''); };

  const submit = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    let ok = false;
    if (mode === 'route') ok = await routeTicket(ticket.id, { department: dept, assignedToId: assignee || null, note: note.trim() });
    if (mode === 'return') ok = await returnTicket(ticket.id, note.trim());
    if (mode === 'reopen') ok = await reopenTicket(ticket.id, note.trim());
    setBusy(false);
    if (ok) reset();
  };

  const btn = 'px-2.5 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1 border cursor-pointer';

  return (
    <div className="p-3 rounded-xl bg-slate-100 dark:bg-zinc-900/60 border border-slate-300 dark:border-zinc-800 text-xs space-y-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-600 dark:text-zinc-400">
        <span className="flex items-center gap-1"><Building2 className="w-3.5 h-3.5" /> Raised by <b className="text-slate-800 dark:text-zinc-200">{origin || '—'}</b></span>
        <span>· Now with <b className="text-slate-800 dark:text-zinc-200">{ticket.department || '—'}</b></span>
      </div>

      {!mode && (
        <div className="flex flex-wrap gap-2">
          {canRoute && (
            <button type="button" onClick={() => setMode('route')}
              className={`${btn} border-indigo-300 dark:border-indigo-900 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-950/40`}>
              <Route className="w-3.5 h-3.5" /> Route to department
            </button>
          )}
          {canReturn && (
            <button type="button" onClick={() => setMode('return')}
              className={`${btn} border-emerald-300 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/40`}>
              <Undo2 className="w-3.5 h-3.5" /> Return to {origin}
            </button>
          )}
          {canReopen && (
            <button type="button" onClick={() => setMode('reopen')}
              className={`${btn} border-orange-300 dark:border-orange-900 text-orange-700 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-950/40`}>
              <RotateCcw className="w-3.5 h-3.5" /> Client not satisfied — reopen
            </button>
          )}
        </div>
      )}

      {mode && (
        <form onSubmit={submit} className="space-y-2">
          {mode === 'route' && routeTargets.length === 0 && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              There's no other department to route to. Departments are managed on the Departments page.
            </p>
          )}
          {mode === 'route' && (
            <div className="flex flex-wrap gap-2">
              <select value={dept} onChange={(e) => setDept(e.target.value)} required
                className="flex-1 min-w-[140px] px-2 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden">
                <option value="">Department…</option>
                {routeTargets.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={!dept}
                className="flex-1 min-w-[140px] px-2 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden disabled:opacity-60">
                <option value="">Anyone (department assigns)</option>
                {people.map(u => (
                  <option key={u.id} value={u.id}>{u.name}{u.supportTier ? ` · ${u.supportTier}` : ''}</option>
                ))}
              </select>
            </div>
          )}
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            required
            placeholder={mode === 'route' ? 'What does the receiving team need to do?'
              : mode === 'return' ? 'What was done? (the client will be asked to confirm)'
              : "Client's feedback — why it isn't resolved"}
            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden resize-none"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={reset} className="px-3 py-1.5 rounded-lg text-slate-600 dark:text-zinc-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800 cursor-pointer">Cancel</button>
            <button type="submit" disabled={busy || !note.trim() || (mode === 'route' && !dept)}
              className="px-3 py-1.5 rounded-lg font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white cursor-pointer">
              {busy ? 'Saving…' : mode === 'route' ? 'Route' : mode === 'return' ? `Return to ${origin}` : 'Reopen'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};