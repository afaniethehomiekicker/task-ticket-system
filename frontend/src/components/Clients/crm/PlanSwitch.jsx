import React, { useCallback, useRef, useState } from 'react';
import { PlanSheet } from './PlanSheet';

// Two (or more) plan sheets behind one switch — used by the IP Plan tab
// (Static IP | BGP) and the Transmission tab (Core | Client).
//
//   views: [{ key, label, icon, title, recordType, columns }]   key = the :plan URL value
//
// Every sheet stays mounted once opened, so switching never loses unsaved
// edits; unsaved work in any of them is reported up as one dirty flag.

// The required service link used by the IP, BGP and Client Transmission plans.
export const SERVICE_COLUMN = {
  key: '_service', label: 'Service', type: 'service', required: true, width: 240,
  validate: (v) => (v ? '' : 'Choose the service this row belongs to'),
};

export const PlanSwitch = ({ views, clientId, clientName, onOpenTicket, onDirtyChange }) => {
  const [view, setView] = useState(views[0].key);
  const [mounted, setMounted] = useState({ [views[0].key]: true });
  const dirty = useRef({});
  const report = useCallback((key, d) => {
    dirty.current[key] = d;
    onDirtyChange?.(Object.values(dirty.current).some(Boolean));
  }, [onDirtyChange]);
  // Stable per-view callbacks (PlanSheet reports through an effect).
  const callbacks = useRef({});
  const dirtyFor = (key) => {
    if (!callbacks.current[key]) callbacks.current[key] = (d) => report(key, d);
    return callbacks.current[key];
  };

  const go = (key) => { setView(key); setMounted(m => ({ ...m, [key]: true })); };

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-lg border border-slate-300 dark:border-zinc-700 p-0.5 bg-white dark:bg-zinc-900">
        {views.map(v => {
          const Icon = v.icon;
          return (
            <button key={v.key} type="button" onClick={() => go(v.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold cursor-pointer ${view === v.key
                ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800'}`}>
              {Icon && <Icon className="w-3.5 h-3.5" />} {v.label}
            </button>
          );
        })}
      </div>
      {views.map(v => (mounted[v.key] ? (
        <div key={v.key} className={view === v.key ? '' : 'hidden'}>
          <PlanSheet
            clientId={clientId}
            clientName={clientName}
            plan={v.key}
            title={v.title}
            recordType={v.recordType}
            columns={v.columns}
            fieldLabels={v.fieldLabels}
            onOpenTicket={onOpenTicket}
            onDirtyChange={dirtyFor(v.key)}
          />
        </div>
      ) : null))}
    </div>
  );
};

export default PlanSwitch;
