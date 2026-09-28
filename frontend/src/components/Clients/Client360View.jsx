import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { X, Building2, FolderKanban, Ticket, FileSearch, ListChecks, Activity } from 'lucide-react';
import { TicketStatusBadge, TaskStatusBadge } from '../common/Badge';

// Client 360° view — spec slide 10: "Everything about one client, on one
// screen." Summary tiles (Total / Running / Completed / Pending projects,
// Open / Closed tickets, feasibilities) that filter the lists below, the full
// profile (slide 8, including admin-defined fields), recent tasks and a feed
// of recent activity — without leaving the profile.

const PROJECT_GROUP = { active: 'running', completed: 'completed', planning: 'pending', on_hold: 'pending' };
const FEAS_GROUP = { in_progress: 'running', feasible: 'completed', not_feasible: 'completed', converted: 'completed', draft: 'pending' };

export const Client360View = ({ clientId, onClose }) => {
  const {
    fetchClientOverview, clientFields, allUsers, getStatusCategory,
    setSelectedProjectDetailId, setSelectedTicketId, setSelectedFeasibilityId, setSelectedTaskId,
  } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [projFilter, setProjFilter] = useState('all');
  const [ticketFilter, setTicketFilter] = useState('all');
  const [feasFilter, setFeasFilter] = useState('all');

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    fetchClientOverview(clientId)
      .then(d => { if (!cancelled) setData(d); })
      .catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const open = (fn, id) => { if (typeof fn === 'function') { fn(id); onClose(); } };

  const c = data?.client;
  const counts = data?.counts || {};
  const creator = c?.createdById ? (allUsers || []).find(u => String(u.id) === String(c.createdById)) : null;
  const isTicketClosed = (t) => ['done', 'cancelled', 'archived'].includes(getStatusCategory('ticket', t.status));

  const projects = (data?.projects || []).filter(p => projFilter === 'all' || PROJECT_GROUP[p.status] === projFilter);
  const tickets = (data?.tickets || []).filter(t =>
    ticketFilter === 'all' || (ticketFilter === 'closed' ? isTicketClosed(t) : !isTicketClosed(t)));
  const feas = (data?.feasibilities || []).filter(f => feasFilter === 'all' || FEAS_GROUP[f.status] === feasFilter);

  const Tile = ({ value, label, active, onClick, tone }) => (
    <button type="button" onClick={onClick}
      className={`p-3 rounded-xl border text-left cursor-pointer transition ${active
        ? 'bg-indigo-600 border-indigo-600 text-white'
        : 'bg-white/70 dark:bg-zinc-900 border-slate-300 dark:border-zinc-800 hover:border-indigo-400'}`}>
      <div className={`text-2xl font-bold ${active ? '' : tone || 'text-slate-900 dark:text-zinc-100'}`}>{value ?? 0}</div>
      <div className={`text-[10px] font-semibold uppercase tracking-wider ${active ? 'text-indigo-100' : 'text-slate-500 dark:text-zinc-400'}`}>{label}</div>
    </button>
  );

  const Field = ({ label, value }) => (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">{label}</div>
      <div className="text-xs text-slate-900 dark:text-zinc-100 break-words">{value || '—'}</div>
    </div>
  );

  const Section = ({ icon: Icon, title, children, right }) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
          <Icon className="w-4 h-4 text-indigo-500" /> {title}
        </h4>
        {right}
      </div>
      {children}
    </div>
  );

  const Chips = ({ value, onChange, options }) => (
    <div className="flex gap-1">
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={`px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer ${value === v
            ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800'}`}>{l}</button>
      ))}
    </div>
  );

  const Row = ({ onClick, left, right }) => (
    <button type="button" onClick={onClick}
      className="w-full flex items-center justify-between gap-2 p-2 rounded-lg bg-white/70 dark:bg-zinc-900/60 border border-slate-300 dark:border-zinc-800 hover:border-indigo-400 text-left text-xs cursor-pointer">
      <span className="min-w-0 truncate">{left}</span>
      <span className="shrink-0">{right}</span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs" onClick={onClose}>
      <div className="w-full max-w-4xl h-full overflow-y-auto bg-slate-100 dark:bg-zinc-950 border-l border-slate-300 dark:border-zinc-800 p-6 space-y-6"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-mono text-slate-500 dark:text-zinc-500">{c?.clientNumber}</div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-indigo-500" /> {c?.companyName || 'Client'}
            </h2>
            {c?.clientName && <div className="text-xs text-slate-600 dark:text-zinc-400">{c.clientName}</div>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-300/60 dark:hover:bg-zinc-800 cursor-pointer"><X className="w-5 h-5" /></button>
        </div>

        {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        {!data && !error && <p className="text-sm text-slate-500">Loading…</p>}

        {data && (<>
          {/* Summary tiles — click to filter the lists below (slide 10). */}
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
            <Tile value={counts.projects_total} label="Projects" active={projFilter === 'all'} onClick={() => setProjFilter('all')} />
            <Tile value={counts.projects_running} label="Running" active={projFilter === 'running'} onClick={() => setProjFilter('running')} tone="text-indigo-600 dark:text-indigo-400" />
            <Tile value={counts.projects_completed} label="Completed" active={projFilter === 'completed'} onClick={() => setProjFilter('completed')} tone="text-emerald-600 dark:text-emerald-400" />
            <Tile value={counts.projects_pending} label="Pending" active={projFilter === 'pending'} onClick={() => setProjFilter('pending')} tone="text-amber-600 dark:text-amber-400" />
            <Tile value={counts.tickets_open} label="Open tickets" active={ticketFilter === 'open'} onClick={() => setTicketFilter(ticketFilter === 'open' ? 'all' : 'open')} tone="text-rose-600 dark:text-rose-400" />
            <Tile value={counts.tickets_closed} label="Closed tickets" active={ticketFilter === 'closed'} onClick={() => setTicketFilter(ticketFilter === 'closed' ? 'all' : 'closed')} />
            <Tile value={counts.feasibilities_running} label="Feas. running" active={feasFilter === 'running'} onClick={() => setFeasFilter(feasFilter === 'running' ? 'all' : 'running')} tone="text-indigo-600 dark:text-indigo-400" />
            <Tile value={counts.feasibilities_pending} label="Feas. pending" active={feasFilter === 'pending'} onClick={() => setFeasFilter(feasFilter === 'pending' ? 'all' : 'pending')} tone="text-amber-600 dark:text-amber-400" />
            <Tile value={counts.feasibilities_completed} label="Feas. done" active={feasFilter === 'completed'} onClick={() => setFeasFilter(feasFilter === 'completed' ? 'all' : 'completed')} tone="text-emerald-600 dark:text-emerald-400" />
          </div>

          {/* Profile (slide 8) */}
          <div className="p-4 rounded-xl bg-white/70 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Contact person" value={c.contactPerson} />
            <Field label="Email" value={c.email} />
            <Field label="Telephone" value={c.phone} />
            <Field label="Mobile" value={c.mobile} />
            <Field label="CNIC" value={c.cnic} />
            <Field label="City" value={c.city} />
            <Field label="Address" value={c.address} />
            <Field label="Status" value={c.status} />
            {(clientFields || []).filter(f => f.enabled || c.customFields?.[f.key] !== undefined).map(f => (
              <Field key={f.key} label={f.label} value={c.customFields?.[f.key] !== undefined ? String(c.customFields[f.key]) : ''} />
            ))}
            <Field label="Created by" value={creator?.name} />
            <Field label="Created" value={c.createdAt ? new Date(c.createdAt).toLocaleString() : ''} />
            <Field label="Updated" value={c.updatedAt ? new Date(c.updatedAt).toLocaleString() : ''} />
            {c.notes && <div className="col-span-2 sm:col-span-4"><Field label="Notes" value={c.notes} /></div>}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Section icon={FolderKanban} title={`Projects (${projects.length})`}
              right={<Chips value={projFilter} onChange={setProjFilter} options={[['all', 'All'], ['running', 'Running'], ['completed', 'Completed'], ['pending', 'Pending']]} />}>
              {projects.length === 0 ? <p className="text-xs text-slate-500 italic">None.</p> : projects.map(p => (
                <Row key={p.id} onClick={() => open(setSelectedProjectDetailId, p.id)}
                  left={<><span className="font-mono text-[10px] text-slate-500 mr-1.5">{p.code}</span><span className="font-semibold">{p.title}</span></>}
                  right={<span className="text-[10px] capitalize text-slate-600 dark:text-zinc-400">{(p.status || '').replace(/_/g, ' ')}</span>} />
              ))}
            </Section>

            <Section icon={Ticket} title={`Tickets (${tickets.length})`}
              right={<Chips value={ticketFilter} onChange={setTicketFilter} options={[['all', 'All'], ['open', 'Open'], ['closed', 'Closed']]} />}>
              {tickets.length === 0 ? <p className="text-xs text-slate-500 italic">None.</p> : tickets.map(t => (
                <Row key={t.id} onClick={() => open(setSelectedTicketId, t.id)}
                  left={<><span className="font-mono text-[10px] text-slate-500 mr-1.5">{t.ticketNumber}</span><span className="font-semibold">{t.title}</span></>}
                  right={<TicketStatusBadge status={t.status} />} />
              ))}
            </Section>

            <Section icon={FileSearch} title={`Feasibilities (${feas.length})`}
              right={<Chips value={feasFilter} onChange={setFeasFilter} options={[['all', 'All'], ['running', 'Running'], ['completed', 'Completed'], ['pending', 'Pending']]} />}>
              {feas.length === 0 ? <p className="text-xs text-slate-500 italic">None.</p> : feas.map(f => (
                <Row key={f.id} onClick={() => open(setSelectedFeasibilityId, f.id)}
                  left={<><span className="font-mono text-[10px] text-slate-500 mr-1.5">{f.feasibilityNumber}</span><span className="font-semibold">{[f.product, f.capacity].filter(Boolean).join(' · ')}</span></>}
                  right={<span className="text-[10px] capitalize text-slate-600 dark:text-zinc-400">{(f.status || '').replace(/_/g, ' ')}</span>} />
              ))}
            </Section>

            <Section icon={ListChecks} title="Recent tasks">
              {(data.recentTasks || []).length === 0 ? <p className="text-xs text-slate-500 italic">None.</p> : data.recentTasks.map(t => (
                <Row key={t.id} onClick={() => open(setSelectedTaskId, t.id)}
                  left={<><span className="font-mono text-[10px] text-slate-500 mr-1.5">{t.taskNumber}</span><span className="font-semibold">{t.title}</span></>}
                  right={<TaskStatusBadge status={t.status} />} />
              ))}
            </Section>
          </div>

          <Section icon={Activity} title="Recent activity">
            {(data.activity || []).length === 0 ? <p className="text-xs text-slate-500 italic">No activity yet.</p> : (
              <ol className="space-y-1.5">
                {data.activity.map(a => (
                  <li key={a.id} className="text-xs text-slate-700 dark:text-zinc-300">
                    <span className="text-slate-500 dark:text-zinc-500">{a.timestamp ? new Date(a.timestamp).toLocaleString() : ''}</span>
                    {' · '}<span className="font-semibold">{a.actorName}</span>{' · '}{a.details}
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </>)}
      </div>
    </div>
  );
};
