import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { X, Plus, SlidersHorizontal } from 'lucide-react';

// Manage extra client fields (spec slide 8: "Additional fields should be
// configurable later by an authorized Admin — no schema change required").
// Fields are never deleted — disable them to hide, so recorded values stay.
const TYPES = [['text', 'Text'], ['number', 'Number'], ['date', 'Date'], ['select', 'Dropdown']];

export const ClientFieldsManager = ({ onClose }) => {
  const { clientFields, saveClientField } = useApp();
  const [label, setLabel] = useState('');
  const [type, setType] = useState('text');
  const [options, setOptions] = useState('');
  const [required, setRequired] = useState(false);
  const [busy, setBusy] = useState(false);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    const ok = await saveClientField(null, { label, fieldType: type, options, required });
    setBusy(false);
    if (ok) { setLabel(''); setOptions(''); setRequired(false); setType('text'); }
  };

  const input = 'px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl bg-slate-100 dark:bg-zinc-950 border border-slate-300 dark:border-zinc-800 p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-indigo-500" /> Client Fields
          </h3>
          <button onClick={onClose} className="p-1 rounded text-slate-500 hover:bg-slate-300/60 dark:hover:bg-zinc-800 cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-zinc-400">
          Extra attributes on every client profile. Disable a field to hide it; values already recorded are kept.
        </p>

        <table className="w-full text-left text-xs">
          <thead className="text-slate-600 dark:text-zinc-400 uppercase tracking-wider font-semibold border-b border-slate-300 dark:border-zinc-800">
            <tr><th className="p-2">Label</th><th className="p-2">Type</th><th className="p-2">Options</th><th className="p-2 text-center">Required</th><th className="p-2 text-center">Enabled</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-300/50 dark:divide-zinc-800/60 text-slate-800 dark:text-zinc-300">
            {(clientFields || []).length === 0 && (
              <tr><td colSpan={5} className="p-3 text-center text-slate-500 italic">No extra fields yet.</td></tr>
            )}
            {(clientFields || []).map(f => (
              <tr key={f.id} className={f.enabled ? '' : 'opacity-50'}>
                <td className="p-2">
                  <input defaultValue={f.label} className={`${input} w-40`}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== f.label) saveClientField(f.id, { label: v }); }} />
                </td>
                <td className="p-2">{(TYPES.find(t => t[0] === f.fieldType) || [, f.fieldType])[1]}</td>
                <td className="p-2">
                  {f.fieldType === 'select' ? (
                    <textarea defaultValue={f.options.join('\n')} rows={2} className={`${input} w-40`}
                      onBlur={(e) => { if (e.target.value !== f.options.join('\n')) saveClientField(f.id, { options: e.target.value }); }} />
                  ) : '—'}
                </td>
                <td className="p-2 text-center">
                  <input type="checkbox" checked={f.required} className="accent-indigo-600"
                    onChange={(e) => saveClientField(f.id, { required: e.target.checked })} />
                </td>
                <td className="p-2 text-center">
                  <input type="checkbox" checked={f.enabled} className="accent-indigo-600"
                    onChange={(e) => saveClientField(f.id, { enabled: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <form onSubmit={add} className="flex flex-wrap items-start gap-2 pt-3 border-t border-slate-300 dark:border-zinc-800 text-xs">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder='New field (e.g. "NTN Number")' className={`${input} flex-1 min-w-[160px]`} />
          <select value={type} onChange={(e) => setType(e.target.value)} className={input}>
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {type === 'select' && (
            <textarea value={options} onChange={(e) => setOptions(e.target.value)} rows={2}
              placeholder="One option per line" className={`${input} min-w-[160px]`} />
          )}
          <label className="flex items-center gap-1 py-1.5 text-slate-700 dark:text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="accent-indigo-600" /> Required
          </label>
          <button type="submit" disabled={busy || !label.trim()}
            className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-semibold cursor-pointer">
            <Plus className="w-3.5 h-3.5" /> Add field
          </button>
        </form>
      </div>
    </div>
  );
};
