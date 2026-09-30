import React from 'react';

// One filter dropdown for the list pages (spec slide 28 filters). options:
// [[value, label], ...]; "all" is always the first choice.
export const FilterSelect = ({ id, value, onChange, allLabel, options, title }) => (
  <select
    id={id}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    title={title || allLabel}
    className="px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-800 dark:text-zinc-300 focus:outline-hidden max-w-[180px]"
  >
    <option value="all">{allLabel}</option>
    {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
  </select>
);
