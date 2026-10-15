import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppSelector } from '../../context/AppContext';
import {
  X, Building2, FolderKanban, Ticket, FileSearch, ListChecks, Activity, Package, Network, Cable,
  History, LayoutDashboard, Truck, ChevronRight, UserRound,
} from 'lucide-react';
import { ClientServicesPanel } from './crm/ClientServicesPanel';
import { IPPlanSheet } from './crm/IPPlanSheet';
import { TransmissionPlanSheet } from './crm/TransmissionPlanSheet';
import { ClientChangeHistory } from './crm/ClientChangeHistory';
import { SERVICE_STATUS, SERVICE_ARRANGEMENT } from './crm/serviceMeta';
import { canViewNetworkPlans } from '../../utils/permissions';
import { TicketStatusBadge, TaskStatusBadge, PriorityBadge } from '../common/Badge';

// Client 360° view — spec slide 10 ("everything about one client, on one
// screen") plus the client CRM (steps 2–5): the services the client uses and
// who provides them, the IP and Transmission plans, every feasibility with
// the vendors checked and their results, open and previous tickets with who
// has them, closed services, and the history of every plan change. Every
// item opens the record it refers to.
//
// Tabs keep it readable. The plan sheets stay mounted once opened, so
// switching tabs never loses unsaved sheet edits; closing the view (or
// opening a record from it) asks first if there are any.

const PROJECT_GROUP = { active: 'running', completed: 'completed', planning: 'pending', on_hold: 'pending' };
const FEAS_GROUP = { in_progress: 'running', feasible: 'completed', not_feasible: 'completed', converted: 'completed', draft: 'pending' };

const FEAS_STATUS = {
  draft: { label: 'Draft', cls: 'bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300' },
  in_progress: { label: 'In progress', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' },
  feasible: { label: 'Feasible', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' },
  not_feasible: { label: 'Not feasible', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' },
  converted: { label: 'Converted', cls: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300' },
  cancelled: { label: 'Cancelled', cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' },
};
const VENDOR_RESULT = {
  pending: { label: 'Pending', cls: 'bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300' },
  waiting_response: { label: 'Waiting on response', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' },
  feasible: { label: 'Feasible', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' },
  not_feasible: { label: 'Not feasible', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' },
};

const HISTORY_FILTERS = [['', 'Everything'], ['service', 'Services'], ['ip_plan', 'IP Plan'], ['bgp_plan', 'BGP Plan'], ['transmission_plan', 'Core Transmission'], ['client_transmission_plan', 'Client Transmission']];

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString() : '');

const Pill = ({ cls, children }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${cls}`}>{children}</span>
);

// ---- small building blocks (module level, so their children never remount) ----
const Tile = ({ value, label, onClick, tone }) => (
  <button type="button" onClick={onClick}
    className="p-3 rounded-xl border text-left cursor-pointer transition bg-white/70 dark:bg-zinc-900 border-slate-300 dark:border-zinc-800 hover:border-indigo-400">
    <div className={`text-2xl font-bold ${tone || 'text-slate-900 dark:text-zinc-100'}`}>{value ?? 0}</div>
    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400">{label}</div>
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
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
        <Icon className="w-4 h-4 text-indigo-500" /> {title}
      </h4>
      {right}
    </div>
    {children}
  </div>
);

const Chips = ({ value, onChange, options }) => (
  <div className="flex flex-wrap gap-1">
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
    <span className="shrink-0 flex items-center gap-2">{right}</span>
  </button>
);

const Empty = ({ children }) => <p className="text-xs text-slate-500 dark:text-zinc-400 italic">{children}</p>;


export const Client360View = ({ clientId, onClose }) => {
  const {
    fetchClientOverview, clientFields, allUsers, getStatusCategory, apiFetch,
    setSelectedProjectDetailId, setSelectedTicketId, setSelectedFeasibilityId, setSelectedTaskId,
    currentUser, permissionMatrix,
  } = useAppSelector(s => ({
    fetchClientOverview: s.fetchClientOverview, clientFields: s.clientFields, allUsers: s.allUsers,
    getStatusCategory: s.getStatusCategory, apiFetch: s.apiFetch,
    setSelectedProjectDetailId: s.setSelectedProjectDetailId, setSelectedTicketId: s.setSelectedTicketId,
    setSelectedFeasibilityId: s.setSelectedFeasibilityId, setSelectedTaskId: s.setSelectedTaskId,
    currentUser: s.currentUser, permissionMatrix: s.permissionMatrix,
  }));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [services, setServices] = useState([]);
  const [tab, setTab] = useState('overview');
  const [mounted, setMounted] = useState({ overview: true });
  const [projFilter, setProjFilter] = useState('all');
  const [feasFilter, setFeasFilter] = useState('all');
  const [historyType, setHistoryType] = useState('');
  const canPlans = canViewNetworkPlans(currentUser, permissionMatrix);

  // ---- loading ----
  const loadOverview = useCallback(async (soft = false) => {
    if (!soft) { setData(null); setError(''); }
    try {
      const d = await fetchClientOverview(clientId);
      setData(d);
    } catch (err) {
      if (!soft) setError(err.message);
    }
    try {
      const res = await apiFetch(`/api/clients/${clientId}/services`);
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        setServices(body.services || []);
      }
    } catch { /* the Services tab shows its own error */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => { setTab('overview'); setMounted({ overview: true }); loadOverview(false); }, [loadOverview]);

  const goTab = (key) => {
    setTab(key);
    setMounted(m => (m[key] ? m : { ...m, [key]: true }));
    // Numbers on the Overview may have changed in another tab (a service
    // added, plan rows saved): refresh them quietly.
    if (key === 'overview' && data) loadOverview(true);
  };

  // ---- unsaved plan edits ----
  const dirtySheets = useRef(new Set());
  const markDirty = useCallback((name) => (dirty) => {
    if (dirty) dirtySheets.current.add(name);
    else dirtySheets.current.delete(name);
  }, []);
  const onIPDirty = useCallback((d) => markDirty('ip')(d), [markDirty]);
  const onTxDirty = useCallback((d) => markDirty('transmission')(d), [markDirty]);
  const guardedClose = () => {
    if (dirtySheets.current.size > 0 && !window.confirm('You have unsaved plan changes. Close and discard them?')) return false;
    onClose();
    return true;
  };
  const open = (fn, id) => { if (typeof fn === 'function' && guardedClose()) fn(id); };
  const openTicket = (id) => open(setSelectedTicketId, id);

  // ---- derived ----
  const c = data?.client;
  const counts = data?.counts || {};
  const crm = data?.crm || {};
  const creator = c?.createdById ? (allUsers || []).find(u => String(u.id) === String(c.createdById)) : null;
  const isTicketClosed = (t) => ['done', 'cancelled', 'archived'].includes(getStatusCategory('ticket', t.status));
  const allTickets = data?.tickets || [];
  const openTickets = allTickets.filter(t => !isTicketClosed(t));
  const previousTickets = allTickets.filter(isTicketClosed);
  const projects = (data?.projects || []).filter(p => projFilter === 'all' || PROJECT_GROUP[p.status] === projFilter);
  const allFeas = data?.feasibilities || [];
  const feas = allFeas.filter(f => feasFilter === 'all' || FEAS_GROUP[f.status] === feasFilter);
  const servicesInUse = services.filter(s => s.status !== 'closed');
  const userName = (id) => (allUsers || []).find(u => String(u.id) === String(id))?.name || '';
  const assigneeOf = (t) => t.assignedToName || userName(t.assignedToId);

  const TABS = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'services', label: 'Services', icon: Package, count: crm.services_in_use },
    ...(canPlans ? [
      { key: 'ip', label: 'IP Plan', icon: Network, count: (crm.ip_plan_rows || 0) + (crm.bgp_plan_rows || 0) },
      { key: 'transmission', label: 'Transmission Plan', icon: Cable, count: (crm.transmission_rows || 0) + (crm.client_transmission_rows || 0) },
    ] : []),
    { key: 'feasibilities', label: 'Feasibilities', icon: FileSearch, count: allFeas.length },
    { key: 'tickets', label: 'Tickets', icon: Ticket, count: counts.tickets_open },
    { key: 'projects', label: 'Projects & tasks', icon: FolderKanban, count: counts.projects_total },
    { key: 'history', label: 'History', icon: History },
  ];

  const moreLink = (to, label) => (
    <button type="button" onClick={() => goTab(to)} className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer">
      {label} <ChevronRight className="w-3 h-3" />
    </button>
  );

  // A ticket line: number, title, status, priority, who has it.
  const ticketRow = (t) => (
    <Row key={t.id} onClick={() => openTicket(t.id)}
      left={<>
        <span className="font-mono text-[10px] text-slate-500 mr-1.5">{t.ticketNumber}</span>
        <span className="font-semibold">{t.title}</span>
      </>}
      right={<>
        <span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-slate-500 dark:text-zinc-400">
          <UserRound className="w-3 h-3" />{assigneeOf(t) || 'Unassigned'}
        </span>
        <PriorityBadge priority={t.priority} />
        <TicketStatusBadge status={t.status} />
      </>} />
  );

  // A feasibility with every vendor checked and its result.
  const feasCard = (f, compact = false) => {
    const st = FEAS_STATUS[f.status] || FEAS_STATUS.draft;
    const vendors = f.vendors || [];
    const active = vendors.filter(v => !v.withdrawn);
    const feasibleCount = active.filter(v => v.status === 'feasible').length;
    return (
      <div key={f.id} className="rounded-lg border border-slate-300 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/60">
        <button type="button" onClick={() => open(setSelectedFeasibilityId, f.id)}
          className="w-full flex flex-wrap items-center gap-2 p-2.5 text-left text-xs cursor-pointer hover:bg-slate-50 dark:hover:bg-zinc-800/40 rounded-t-lg">
          <span className="font-mono text-[10px] text-slate-500">{f.feasibilityNumber}</span>
          <span className="font-semibold text-slate-900 dark:text-zinc-100">{[f.product, f.capacity].filter(Boolean).join(' · ')}</span>
          {f.city && <span className="text-slate-500">· {f.city}</span>}
          <span className="ml-auto flex items-center gap-2">
            <span className="text-[10px] text-slate-500 dark:text-zinc-400">
              {active.length === 0 ? 'No vendors yet' : `${feasibleCount} of ${active.length} vendor${active.length === 1 ? '' : 's'} feasible`}
            </span>
            <Pill cls={st.cls}>{st.label}</Pill>
          </span>
        </button>
        {!compact && vendors.length > 0 && (
          <div className="px-2.5 pb-2.5 flex flex-wrap gap-1.5">
            {vendors.map(v => {
              const r = VENDOR_RESULT[v.status] || VENDOR_RESULT.pending;
              return (
                <span key={v.id} title={[v.responseNotes, v.respondedAt ? `Responded ${fmtDateTime(v.respondedAt)}` : ''].filter(Boolean).join('\n') || undefined}
                  className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] ${v.withdrawn
                    ? 'border-dashed border-slate-300 dark:border-zinc-700 text-slate-400 line-through'
                    : 'border-slate-300 dark:border-zinc-700 text-slate-700 dark:text-zinc-300'}`}>
                  <Truck className="w-3 h-3" />
                  <span className="font-semibold">{v.vendorName}</span>
                  {v.withdrawn ? <span className="no-underline text-[10px]">withdrawn</span> : <Pill cls={r.cls}>{r.label}</Pill>}
                </span>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // ---- tabs ----
  const overview = data && (
    <div className="space-y-6">
      {/* Headline numbers — click to jump to the tab. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        <Tile value={crm.services_in_use} label="Services in use" onClick={() => goTab('services')} tone="text-indigo-600 dark:text-indigo-400" />
        <Tile value={crm.vendors_in_use} label="Vendors" onClick={() => goTab('services')} />
        {canPlans && <Tile value={(crm.ip_plan_rows || 0) + (crm.bgp_plan_rows || 0)} label="IP / BGP rows" onClick={() => goTab('ip')} />}
        {canPlans && <Tile value={(crm.transmission_rows || 0) + (crm.client_transmission_rows || 0)} label="Transmission rows" onClick={() => goTab('transmission')} />}
        <Tile value={counts.tickets_open} label="Open tickets" onClick={() => goTab('tickets')} tone="text-rose-600 dark:text-rose-400" />
        <Tile value={(counts.feasibilities_running || 0) + (counts.feasibilities_pending || 0)} label="Feas. open" onClick={() => goTab('feasibilities')} tone="text-amber-600 dark:text-amber-400" />
        <Tile value={counts.projects_running} label="Projects running" onClick={() => goTab('projects')} />
        {canPlans && <Tile value={crm.plan_changes_30_days} label="Plan saves (30 d)" onClick={() => goTab('history')} />}
      </div>

      {/* Services in use, with vendor and arrangement. */}
      <Section icon={Package} title={`Services in use (${servicesInUse.length})`}
        right={<div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-zinc-400">
          <span>Through us: <b className="text-slate-700 dark:text-zinc-200">{crm.through_us || 0}</b></span>
          <span>Direct: <b className="text-slate-700 dark:text-zinc-200">{crm.direct_with_client || 0}</b></span>
          {moreLink('services', `All services`)}
        </div>}>
        {servicesInUse.length === 0 ? <Empty>No services in use.</Empty> : (
          <div className="overflow-x-auto rounded-lg border border-slate-300 dark:border-zinc-800">
            <table className="w-full text-xs">
              <thead className="bg-slate-200/70 dark:bg-zinc-800/70 text-slate-600 dark:text-zinc-300">
                <tr>
                  {['Service', 'Location', 'Vendor', 'Arrangement', 'Status', 'Activated'].map(h => (
                    <th key={h} className="px-2.5 py-1.5 text-left font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {servicesInUse.map(s => {
                  const st = SERVICE_STATUS[s.status] || SERVICE_STATUS.pending;
                  const arr = SERVICE_ARRANGEMENT[s.arrangement];
                  return (
                    <tr key={s.id} onClick={() => goTab('services')} className="border-t border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800/40 cursor-pointer">
                      <td className="px-2.5 py-1.5"><span className="font-semibold text-slate-900 dark:text-zinc-100">{s.product}</span>{s.capacity && <span className="text-slate-500"> · {s.capacity}</span>}</td>
                      <td className="px-2.5 py-1.5 text-slate-600 dark:text-zinc-400">{s.location || '—'}</td>
                      <td className="px-2.5 py-1.5 font-semibold text-slate-700 dark:text-zinc-300">{s.vendor_name || <span className="font-normal italic text-slate-400">none</span>}</td>
                      <td className="px-2.5 py-1.5">{arr ? <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-semibold ${arr.cls}`}>{arr.short}</span> : '—'}</td>
                      <td className="px-2.5 py-1.5"><span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-semibold ${st.cls}`}>{st.label}</span></td>
                      <td className="px-2.5 py-1.5 whitespace-nowrap text-slate-600 dark:text-zinc-400">{fmtDate(s.activation_date) || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section icon={Ticket} title={`Open & ongoing tickets (${openTickets.length})`} right={moreLink('tickets', `All tickets`)}>
          {openTickets.length === 0 ? <Empty>No open tickets.</Empty> : openTickets.slice(0, 6).map(t => ticketRow(t))}
          {openTickets.length > 6 && moreLink('tickets', `${openTickets.length - 6} more`)}
        </Section>

        <Section icon={FileSearch} title="Feasibilities in progress" right={moreLink('feasibilities', `All feasibilities`)}>
          {(() => {
            const live = allFeas.filter(f => ['draft', 'in_progress'].includes(f.status));
            return live.length === 0 ? <Empty>No feasibility in progress.</Empty> : live.slice(0, 4).map(f => feasCard(f));
          })()}
        </Section>
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

      <Section icon={Activity} title="Recent activity" right={moreLink('history', `Full history`)}>
        {(data.activity || []).length === 0 ? <Empty>No activity yet.</Empty> : (
          <ol className="space-y-1.5">
            {data.activity.slice(0, 8).map(a => (
              <li key={a.id} className="text-xs text-slate-700 dark:text-zinc-300">
                <span className="text-slate-500 dark:text-zinc-500">{a.timestamp ? new Date(a.timestamp).toLocaleString() : ''}</span>
                {' · '}<span className="font-semibold">{a.actorName}</span>{' · '}{a.details}
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );

  const ticketsTab = (
    <div className="space-y-6">
      <Section icon={Ticket} title={`Open & ongoing (${openTickets.length})`}>
        {openTickets.length === 0 ? <Empty>No open tickets.</Empty> : openTickets.map(t => ticketRow(t))}
      </Section>
      <Section icon={History} title={`Previous tickets (${previousTickets.length})`}>
        {previousTickets.length === 0 ? <Empty>No previous tickets.</Empty> : previousTickets.map(t => ticketRow(t))}
      </Section>
    </div>
  );

  const feasTab = (
    <Section icon={FileSearch} title={`Feasibilities (${feas.length})`}
      right={<Chips value={feasFilter} onChange={setFeasFilter} options={[['all', 'All'], ['running', 'Running'], ['pending', 'Pending'], ['completed', 'Completed']]} />}>
      {feas.length === 0 ? <Empty>None.</Empty> : <div className="space-y-2">{feas.map(f => feasCard(f))}</div>}
    </Section>
  );

  const projectsTab = (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Section icon={FolderKanban} title={`Projects (${projects.length})`}
        right={<Chips value={projFilter} onChange={setProjFilter} options={[['all', 'All'], ['running', 'Running'], ['completed', 'Completed'], ['pending', 'Pending']]} />}>
        {projects.length === 0 ? <Empty>None.</Empty> : projects.map(p => (
          <Row key={p.id} onClick={() => open(setSelectedProjectDetailId, p.id)}
            left={<><span className="font-mono text-[10px] text-slate-500 mr-1.5">{p.code}</span><span className="font-semibold">{p.title}</span></>}
            right={<span className="text-[10px] capitalize text-slate-600 dark:text-zinc-400">{(p.status || '').replace(/_/g, ' ')}</span>} />
        ))}
      </Section>
      <Section icon={ListChecks} title="Recent tasks">
        {(data?.recentTasks || []).length === 0 ? <Empty>None.</Empty> : data.recentTasks.map(t => (
          <Row key={t.id} onClick={() => open(setSelectedTaskId, t.id)}
            left={<><span className="font-mono text-[10px] text-slate-500 mr-1.5">{t.taskNumber}</span><span className="font-semibold">{t.title}</span></>}
            right={<TaskStatusBadge status={t.status} />} />
        ))}
      </Section>
    </div>
  );

  const historyTab = (
    <div className="space-y-6">
      <Section icon={History} title="Service & plan change history"
        right={<Chips value={historyType} onChange={setHistoryType}
          options={canPlans ? HISTORY_FILTERS : HISTORY_FILTERS.filter(([k]) => k === '' || k === 'service')} />}>
        <ClientChangeHistory key={historyType || 'all'} clientId={clientId} recordType={historyType} pageSize={40}
          emptyText="No service or plan changes recorded yet." />
      </Section>
      <Section icon={Activity} title="Activity on projects, tickets & feasibilities">
        {(data?.activity || []).length === 0 ? <Empty>No activity yet.</Empty> : (
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
    </div>
  );

  // Panels: plan sheets and services stay mounted after their first visit.
  const panel = (key, content) => (mounted[key] ? <div key={key} className={tab === key ? '' : 'hidden'}>{content}</div> : null);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={guardedClose}>
      <div className="w-full max-w-6xl h-full flex flex-col bg-slate-100 dark:bg-zinc-950 border-l border-slate-300 dark:border-zinc-800"
        onClick={(e) => e.stopPropagation()}>
        {/* Header + tabs */}
        <div className="px-6 pt-5 border-b border-slate-300 dark:border-zinc-800 bg-slate-100/95 dark:bg-zinc-950/95">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-mono text-slate-500 dark:text-zinc-500">{c?.clientNumber}</div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-indigo-500 shrink-0" /> <span className="truncate">{c?.companyName || 'Client'}</span>
              </h2>
              {c?.clientName && <div className="text-xs text-slate-600 dark:text-zinc-400">{c.clientName}</div>}
            </div>
            <button onClick={guardedClose} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-300/60 dark:hover:bg-zinc-800 cursor-pointer"><X className="w-5 h-5" /></button>
          </div>
          {data && (
            <nav className="mt-3 -mb-px flex gap-1 overflow-x-auto">
              {TABS.map(t => {
                const Icon = t.icon;
                const active = tab === t.key;
                return (
                  <button key={t.key} type="button" onClick={() => goTab(t.key)}
                    className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 cursor-pointer ${active
                      ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300'
                      : 'border-transparent text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100'}`}>
                    <Icon className="w-4 h-4" /> {t.label}
                    {t.count > 0 && <span className={`px-1.5 rounded-full text-[10px] ${active ? 'bg-indigo-100 dark:bg-indigo-950' : 'bg-slate-200 dark:bg-zinc-800'}`}>{t.count}</span>}
                  </button>
                );
              })}
            </nav>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          {!data && !error && <p className="text-sm text-slate-500">Loading…</p>}
          {data && (<>
            {tab === 'overview' && overview}
            {panel('services', <ClientServicesPanel clientId={clientId} onOpenTicket={openTicket} active={tab === 'services'} onOpenPlan={canPlans ? goTab : undefined} />)}
            {canPlans && panel('ip', <IPPlanSheet clientId={clientId} clientName={c?.companyName} onOpenTicket={openTicket} onDirtyChange={onIPDirty} />)}
            {canPlans && panel('transmission', <TransmissionPlanSheet clientId={clientId} clientName={c?.companyName} onOpenTicket={openTicket} onDirtyChange={onTxDirty} />)}
            {tab === 'feasibilities' && feasTab}
            {tab === 'tickets' && ticketsTab}
            {tab === 'projects' && projectsTab}
            {tab === 'history' && historyTab}
          </>)}
        </div>
      </div>
    </div>
  );
};

export default Client360View;
