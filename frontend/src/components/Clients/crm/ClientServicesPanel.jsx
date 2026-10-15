import React, { useCallback, useEffect, useState } from 'react';
import { Package, Plus, Pencil, History, Loader2, MapPin, Truck, CalendarDays, Ticket, ChevronDown, Network } from 'lucide-react';
import { useAppSelector } from '../../../context/AppContext';
import { ClientServiceForm } from './ClientServiceForm';
import { ClientChangeHistory } from './ClientChangeHistory';
import { ServicePlansPanel } from './ServicePlansPanel';
import { SERVICE_STATUS, SERVICE_ARRANGEMENT, SERVICE_FIELD_LABELS } from './serviceMeta';

// A client's products & services (client CRM step 2), shown in the Client
// 360 view. Everyone with full access to the client sees them; adding and
// editing needs "Manage Client Products & Services" (the server decides and
// tells us via can_manage).
//
// onOpenTicket(id) opens a related ticket.

const Pill = ({ cls, children }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-semibold whitespace-nowrap ${cls}`}>{children}</span>
);

const fmtDate = (d) => {
  if (!d) return '';
  const t = new Date(String(d).slice(0, 10) + 'T00:00:00');
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};

export const ClientServicesPanel = ({ clientId, onOpenTicket, onOpenPlan, active = true }) => {
  const apiFetch = useAppSelector(s => s.apiFetch);
  const [services, setServices] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [planCounts, setPlanCounts] = useState({});
  const [canViewPlans, setCanViewPlans] = useState(false);
  const [plansFor, setPlansFor] = useState(null); // service id whose plans are open
  const [plansKey, setPlansKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('open');
  const [editing, setEditing] = useState(null); // null | 'new' | service
  const [historyFor, setHistoryFor] = useState(null);
  const [historyKey, setHistoryKey] = useState(0);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await apiFetch(`/api/clients/${clientId}/services`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not load services');
        return;
      }
      setServices(data.services || []);
      setCanManage(!!data.can_manage);
      setPlanCounts(data.plan_counts || {});
      setCanViewPlans(!!data.can_view_plans);
    } catch {
      setError('Could not reach the server');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, clientId]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  // Back on this tab after editing plans elsewhere: refresh the numbers and
  // any open plan dropdown.
  const wasActive = React.useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) { load(); setPlansKey(k => k + 1); }
    wasActive.current = active;
  }, [active, load]);

  const counts = {
    open: services.filter(s => s.status !== 'closed').length,
    closed: services.filter(s => s.status === 'closed').length,
    all: services.length,
  };
  const shown = services.filter(s => filter === 'all' || (filter === 'closed' ? s.status === 'closed' : s.status !== 'closed'));

  const onSaved = () => {
    setEditing(null);
    setHistoryKey(k => k + 1);
    load();
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
          <Package className="w-4 h-4 text-indigo-500" /> Products &amp; services ({counts.open} in use)
        </h4>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {[['open', `In use (${counts.open})`], ['closed', `Closed (${counts.closed})`], ['all', `All (${counts.all})`]].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setFilter(k)}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer ${filter === k
                  ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800'}`}>{l}</button>
            ))}
          </div>
          {canManage && (
            <button type="button" onClick={() => setEditing('new')}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer">
              <Plus className="w-3.5 h-3.5" /> Add service
            </button>
          )}
        </div>
      </div>

      {loading && <p className="text-xs text-slate-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading services…</p>}
      {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      {!loading && !error && shown.length === 0 && (
        <p className="text-xs text-slate-500 italic">
          {filter === 'closed' ? 'No closed services.' : 'No services recorded for this client yet.'}
        </p>
      )}

      <div className="space-y-2">
        {shown.map(s => {
          const st = SERVICE_STATUS[s.status] || SERVICE_STATUS.pending;
          const arr = SERVICE_ARRANGEMENT[s.arrangement];
          const showHistory = historyFor === s.id;
          return (
            <div key={s.id} className={`rounded-lg border bg-white/70 dark:bg-zinc-900/60 ${s.status === 'closed' ? 'border-slate-300/70 dark:border-zinc-800 opacity-80' : 'border-slate-300 dark:border-zinc-800'}`}>
              <div className="p-3 flex flex-wrap items-start gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[10px] text-slate-500">{s.service_number}</span>
                    <span className="text-sm font-semibold text-slate-900 dark:text-zinc-100">{s.product}</span>
                    {s.capacity && <span className="text-xs text-slate-600 dark:text-zinc-400">· {s.capacity}</span>}
                    <Pill cls={st.cls}>{st.label}</Pill>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600 dark:text-zinc-400">
                    {s.location && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{s.location}</span>}
                    {s.vendor_name ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Truck className="w-3 h-3" /><span className="font-semibold text-slate-700 dark:text-zinc-300">{s.vendor_name}</span>
                        {arr && <Pill cls={arr.cls}>{arr.short}</Pill>}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 italic"><Truck className="w-3 h-3" />No vendor</span>
                    )}
                    {s.activation_date && <span className="inline-flex items-center gap-1"><CalendarDays className="w-3 h-3" />Activated {fmtDate(s.activation_date)}</span>}
                    {s.status === 'closed' && s.closed_at && <span>Closed {fmtDate(s.closed_at)}</span>}
                    {s.ticket_number && (
                      <button type="button" onClick={() => s.ticket_id && onOpenTicket?.(s.ticket_id)}
                        className="inline-flex items-center gap-1 font-mono font-bold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer">
                        <Ticket className="w-3 h-3" />{s.ticket_number}
                      </button>
                    )}
                  </div>
                  {s.notes && <p className="mt-1.5 text-xs text-slate-700 dark:text-zinc-300 whitespace-pre-wrap break-words line-clamp-3">{s.notes}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {canViewPlans && (() => {
                    const pc = planCounts[s.id] || {};
                    const total = (pc.ip || 0) + (pc.bgp || 0) + (pc.tx_client || 0);
                    const parts = [pc.ip && `IP ${pc.ip}`, pc.bgp && `BGP ${pc.bgp}`, pc.tx_client && `Transmission ${pc.tx_client}`].filter(Boolean);
                    const openP = plansFor === s.id;
                    return (
                      <button type="button" onClick={() => setPlansFor(openP ? null : s.id)}
                        title="IP, BGP and transmission plan rows decided for this service"
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border cursor-pointer ${openP
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300'
                          : total ? 'border-indigo-300 text-indigo-700 dark:border-indigo-800 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/30'
                            : 'border-slate-300 text-slate-500 dark:border-zinc-700 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800'}`}>
                        <Network className="w-3.5 h-3.5" />
                        Plans{total ? `: ${parts.join(' · ')}` : ''}
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${openP ? 'rotate-180' : ''}`} />
                      </button>
                    );
                  })()}
                  <button type="button" onClick={() => setHistoryFor(showHistory ? null : s.id)} title="Change history"
                    className={`p-1.5 rounded-lg cursor-pointer ${showHistory ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400' : 'text-slate-500 hover:bg-slate-300/60 dark:hover:bg-zinc-800'}`}>
                    <History className="w-4 h-4" />
                  </button>
                  {canManage && (
                    <button type="button" onClick={() => setEditing(s)} title="Edit"
                      className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-300/60 dark:hover:bg-zinc-800 cursor-pointer">
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
              {plansFor === s.id && (
                <div className="px-3 pb-3 border-t border-slate-300/70 dark:border-zinc-800 pt-2">
                  <ServicePlansPanel clientId={clientId} serviceId={s.id} refreshKey={plansKey}
                    onOpenTicket={onOpenTicket} onOpenPlan={onOpenPlan} />
                </div>
              )}
              {showHistory && (
                <div className="px-3 pb-3 border-t border-slate-300/70 dark:border-zinc-800 pt-2">
                  <ClientChangeHistory clientId={clientId} recordType="service" recordId={s.id}
                    fieldLabels={SERVICE_FIELD_LABELS} refreshKey={historyKey} pageSize={20} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editing && (
        <ClientServiceForm
          clientId={clientId}
          service={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
};

export default ClientServicesPanel;
