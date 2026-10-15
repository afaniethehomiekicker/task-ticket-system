import React, { useEffect, useRef, useState } from 'react';
import { Ticket, Search, Loader2, X, CheckCircle2, AlertCircle, Plus } from 'lucide-react';
import { useAppSelector, getBackendId } from '../../../context/AppContext';
import { TICKET_CATEGORIES } from '../../../utils/ticketCategories';
import { TicketStatusBadge } from '../../common/Badge';

// Pick the ticket that authorizes a change to a client's services or plans
// (client CRM, step 1). Lists the client's tickets (open first) and also
// accepts a typed ticket number, which the server checks: it must be a
// ticket of THIS client, open or closed, not archived.
//
//   <ClientTicketPicker clientId={id} value={ticket} onChange={setTicket} required
//                       newTicketTitle="IP Plan change" />
//
// allowNewTicket={false} hides it (the plan sheets: plan changes must point
// to a ticket raised the normal way).
//
// "New ticket" raises a ticket for this client on the spot (assigned to you
// by default) and selects it, so a plan change doesn't mean leaving the
// sheet to create one first.
//
// value / onChange: { id, ticketNumber, title, status } | null

const toTicket = (raw) => raw && ({
  id: raw.id,
  ticketNumber: raw.ticket_number || '',
  title: raw.title || '',
  status: raw.status || '',
});

export const ClientTicketPicker = ({ clientId, value, onChange, required = false, label = 'Authorizing ticket', compact = false, newTicketTitle = '', allowNewTicket = true }) => {
  const { apiFetch, createTicket, currentUser, departments } = useAppSelector(s => ({
    apiFetch: s.apiFetch, createTicket: s.createTicket, currentUser: s.currentUser, departments: s.departments,
  }));
  const [creating, setCreating] = useState(false);
  const [newForm, setNewForm] = useState(null); // null = closed
  const openNewForm = () => {
    setOpen(false);
    setError('');
    setNewForm({
      title: newTicketTitle,
      category: TICKET_CATEGORIES[0],
      priority: 'normal',
      department: currentUser?.department || '',
      assignToMe: true,
    });
  };
  const createNew = async () => {
    if (!newForm?.title.trim()) { setError('Enter a subject for the new ticket'); return; }
    setCreating(true);
    setError('');
    const t = await createTicket({
      title: newForm.title.trim(),
      category: newForm.category,
      priority: newForm.priority,
      department: newForm.department,
      clientId,
      assignedToId: newForm.assignToMe ? currentUser?.id : null,
    });
    setCreating(false);
    if (!t) return; // createTicket already told the user why
    setNewForm(null);
    onChange({ id: getBackendId(t.id), ticketNumber: t.ticketNumber, title: t.title, status: t.status });
  };
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const boxRef = useRef(null);
  const reqRef = useRef(0);

  // Search the client's tickets as the user types (debounced).
  useEffect(() => {
    if (!open || !clientId) return undefined;
    const my = ++reqRef.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await apiFetch(`/api/clients/${clientId}/ticket-options?q=${encodeURIComponent(query.trim())}`);
        const data = await res.json().catch(() => ({}));
        if (my !== reqRef.current) return;
        if (!res.ok) {
          setError(data.error || 'Could not load tickets');
          setOptions([]);
        } else {
          setOptions((data.tickets || []).map(toTicket));
        }
      } catch {
        if (my === reqRef.current) setError('Could not reach the server');
      } finally {
        if (my === reqRef.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [open, query, clientId, apiFetch]);

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (t) => {
    onChange(t);
    setOpen(false);
    setQuery('');
    setError('');
  };

  // A typed number that isn't in the list (e.g. a ticket the user can't
  // browse): ask the server whether it's valid for this client.
  const checkTyped = async () => {
    const ref = query.trim();
    if (!ref) return;
    const listed = options.find(o => o.ticketNumber.toLowerCase() === ref.toLowerCase());
    if (listed) { pick(listed); return; }
    setChecking(true);
    setError('');
    try {
      const res = await apiFetch(`/api/clients/${clientId}/ticket-check?ref=${encodeURIComponent(ref)}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.valid) pick(toTicket(data.ticket));
      else setError(data.error || 'That ticket can\'t be used');
    } catch {
      setError('Could not reach the server');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div ref={boxRef} className="relative">
      {!compact && (
        <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
          {label}{required && <span className="text-rose-500"> *</span>}
        </label>
      )}

      {value ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-sm">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="font-mono text-xs font-bold text-amber-700 dark:text-amber-400">{value.ticketNumber}</span>
          <span className="truncate text-slate-700 dark:text-zinc-300">{value.title}</span>
          {value.status && <span className="shrink-0"><TicketStatusBadge status={value.status} /></span>}
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(true); }}
            title="Choose a different ticket"
            className="ml-auto p-0.5 rounded text-slate-400 hover:text-rose-600 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onFocus={() => setOpen(true)}
              onChange={(e) => { setQuery(e.target.value); setOpen(true); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); checkTyped(); } }}
              placeholder="Search this client's tickets or type a ticket ID (TKT-…)"
              className={`w-full pl-8 pr-3 py-2 rounded-lg border bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden ${
                required && error ? 'border-rose-400' : 'border-slate-300 dark:border-zinc-700'
              }`}
            />
          </div>
          {allowNewTicket && !query.trim() && !newForm && (
            <button
              type="button"
              onClick={openNewForm}
              title="Raise a new ticket for this client and use it"
              className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-semibold border border-emerald-500 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 cursor-pointer"
            >
              <Plus className="w-4 h-4" /> New ticket
            </button>
          )}
          {query.trim() && (
            <button
              type="button"
              onClick={checkTyped}
              disabled={checking}
              className="shrink-0 px-3 py-2 rounded-lg text-sm font-semibold border border-slate-300 dark:border-zinc-700 text-slate-700 dark:text-zinc-300 hover:bg-slate-300/50 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-60"
            >
              {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Use'}
            </button>
          )}
        </div>
      )}

      {allowNewTicket && newForm && !value && (
        <div className="mt-2 p-3 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/20 space-y-2"
          onKeyDown={(e) => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); createNew(); } }}>
          <div className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">New ticket for this client</div>
          <input
            autoFocus
            value={newForm.title}
            onChange={(e) => setNewForm(f => ({ ...f, title: e.target.value }))}
            placeholder="Subject, e.g. Change VLAN on Mardan link"
            maxLength={200}
            className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
          />
          <div className="grid grid-cols-3 gap-2">
            <select value={newForm.category} onChange={(e) => setNewForm(f => ({ ...f, category: e.target.value }))}
              className="px-2 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-xs">
              {TICKET_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
            <select value={newForm.priority} onChange={(e) => setNewForm(f => ({ ...f, priority: e.target.value }))}
              className="px-2 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-xs">
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
            <select value={newForm.department} onChange={(e) => setNewForm(f => ({ ...f, department: e.target.value }))}
              className="px-2 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-xs">
              <option value="">Department…</option>
              {(departments || []).map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={newForm.assignToMe} onChange={(e) => setNewForm(f => ({ ...f, assignToMe: e.target.checked }))} />
            Assign it to me
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setNewForm(null)} className="px-3 py-1.5 text-xs text-slate-600 dark:text-zinc-400 hover:bg-slate-200 dark:hover:bg-zinc-800 rounded-lg cursor-pointer">Cancel</button>
            <button type="button" onClick={createNew} disabled={creating}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-lg cursor-pointer">
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Create & use ticket
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-rose-600 dark:text-rose-400">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </p>
      )}

      {open && !value && !newForm && (
        <div className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg">
          {loading && (
            <div className="px-3 py-2 text-xs text-slate-500 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading tickets…
            </div>
          )}
          {!loading && options.length === 0 && (
            <div className="px-3 py-2 text-xs text-slate-500 dark:text-zinc-400">
              No tickets found for this client{query.trim() ? ' — press Enter to check the ID you typed' : ''}.
            </div>
          )}
          {!loading && options.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => pick(t)}
              className="w-full text-left px-3 py-2 flex items-center gap-2 text-sm hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              <Ticket className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span className="font-mono text-xs font-bold text-amber-700 dark:text-amber-400 shrink-0">{t.ticketNumber}</span>
              <span className="truncate text-slate-700 dark:text-zinc-300">{t.title}</span>
              <span className="ml-auto shrink-0"><TicketStatusBadge status={t.status} /></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ClientTicketPicker;
