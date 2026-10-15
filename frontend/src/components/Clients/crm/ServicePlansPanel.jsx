import React, { useEffect, useState } from 'react';
import { Loader2, Network, Share2, Users, ExternalLink } from 'lucide-react';
import { useAppSelector } from '../../../context/AppContext';
import { IP_PLAN_COLUMNS, BGP_PLAN_COLUMNS } from './IPPlanSheet';
import { CLIENT_TRANSMISSION_COLUMNS } from './TransmissionPlanSheet';
import { usePlanColumnLabels } from './planColumnLabels';

// The plan rows decided for one service (the "Plans" dropdown on a service
// card): its Static IP, BGP and Client Transmission rows, read-only. Editing
// stays in the plan tabs ("Open" jumps there). The Core Transmission Plan
// isn't per service, so it isn't listed here.

const SECTIONS = [
  { key: 'ip', label: 'IP Plan — Static IP', icon: Network, tab: 'ip', columns: IP_PLAN_COLUMNS },
  { key: 'bgp', label: 'IP Plan — BGP', icon: Share2, tab: 'ip', columns: BGP_PLAN_COLUMNS },
  { key: 'tx_client', label: 'Client Transmission Plan', icon: Users, tab: 'transmission', columns: CLIENT_TRANSMISSION_COLUMNS },
];

export const ServicePlansPanel = ({ clientId, serviceId, refreshKey = 0, onOpenTicket, onOpenPlan }) => {
  const apiFetch = useAppSelector(s => s.apiFetch);
  const [plans, setPlans] = useState(null);
  const [error, setError] = useState('');
  // Column titles as renamed by the Super Admin.
  const custom = {
    ip: usePlanColumnLabels(apiFetch, 'ip'),
    bgp: usePlanColumnLabels(apiFetch, 'bgp'),
    tx_client: usePlanColumnLabels(apiFetch, 'tx_client'),
  };

  useEffect(() => {
    let alive = true;
    setError('');
    apiFetch(`/api/clients/${clientId}/services/${serviceId}/plans`)
      .then(async (res) => {
        const d = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok) setError(d.error || 'Could not load the plans');
        else setPlans(d.plans || {});
      })
      .catch(() => { if (alive) setError('Could not reach the server'); });
    return () => { alive = false; };
  }, [apiFetch, clientId, serviceId, refreshKey]);

  if (error) return <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>;
  if (!plans) return <p className="text-xs text-slate-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading plans…</p>;

  const any = SECTIONS.some(sec => (plans[sec.key] || []).length > 0);
  if (!any) {
    return (
      <p className="text-xs text-slate-500 dark:text-zinc-400 italic">
        No IP, BGP or client transmission rows are linked to this service yet.
        {onOpenPlan && <> Add them on the <button type="button" onClick={() => onOpenPlan('ip')} className="text-indigo-600 hover:underline cursor-pointer not-italic">IP Plan</button> or <button type="button" onClick={() => onOpenPlan('transmission')} className="text-indigo-600 hover:underline cursor-pointer not-italic">Transmission Plan</button> tab and pick this service.</>}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {SECTIONS.map(sec => {
        const rows = plans[sec.key] || [];
        if (rows.length === 0) return null;
        const titles = custom[sec.key] || {};
        const cols = sec.columns.filter(c => c.type !== 'service' && !c.secret).map(c => (titles[c.key] ? { ...c, label: titles[c.key] } : c));
        const Icon = sec.icon;
        return (
          <div key={sec.key}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-zinc-400 flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5 text-indigo-500" /> {sec.label} ({rows.length})
              </span>
              {onOpenPlan && (
                <button type="button" onClick={() => onOpenPlan(sec.tab)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer">
                  Open <ExternalLink className="w-3 h-3" />
                </button>
              )}
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-300 dark:border-zinc-800">
              <table className="text-xs w-max min-w-full">
                <thead className="bg-slate-200/70 dark:bg-zinc-800/70 text-slate-600 dark:text-zinc-300">
                  <tr>
                    <th className="px-2 py-1 text-left font-semibold whitespace-nowrap">{titles._ticket || 'Ticket ID'}</th>
                    {cols.map(c => <th key={c.key} className="px-2 py-1 text-left font-semibold whitespace-nowrap">{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} className="border-t border-slate-200 dark:border-zinc-800 align-top">
                      <td className="px-2 py-1 whitespace-nowrap">
                        {r.ticket_number ? (
                          <button type="button" onClick={() => r.ticket_id && onOpenTicket?.(r.ticket_id)}
                            className="font-mono font-bold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer">{r.ticket_number}</button>
                        ) : '—'}
                      </td>
                      {cols.map(c => (
                        <td key={c.key} className={`px-2 py-1 whitespace-pre-wrap break-words text-slate-800 dark:text-zinc-200 ${c.mono ? 'font-mono' : ''}`}>
                          {r.data?.[c.key] || <span className="text-slate-300 dark:text-zinc-700">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ServicePlansPanel;
