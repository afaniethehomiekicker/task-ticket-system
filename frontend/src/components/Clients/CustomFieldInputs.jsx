import React from 'react';
import { useApp } from '../../context/AppContext';

// Inputs for the admin-defined extra client fields (spec slide 8). `values`
// is the client's customFields object; onChange receives the updated object.
export const CustomFieldInputs = ({ values = {}, onChange, inputClassName = '' }) => {
  const { clientFields } = useApp();
  const fields = (clientFields || []).filter(f => f.enabled);
  if (fields.length === 0) return null;

  const set = (key, v) => onChange({ ...values, [key]: v });
  const cls = inputClassName ||
    'w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden';

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {fields.map(f => {
        const v = values[f.key] ?? '';
        return (
          <label key={f.key} className="block">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-0.5">
              {f.label}{f.required ? ' *' : ''}
            </span>
            {f.fieldType === 'select' ? (
              <select value={v} onChange={(e) => set(f.key, e.target.value)} className={cls} required={f.required}>
                <option value="">—</option>
                {f.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                type={f.fieldType === 'number' ? 'number' : f.fieldType === 'date' ? 'date' : 'text'}
                value={v}
                onChange={(e) => set(f.key, e.target.value)}
                required={f.required}
                className={cls}
              />
            )}
          </label>
        );
      })}
    </div>
  );
};
