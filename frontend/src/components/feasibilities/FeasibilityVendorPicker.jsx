import React, { useEffect, useState } from 'react';
import { Plus, X, Truck } from 'lucide-react';
import { useAppSelector } from '../../context/AppContext';
import { useVendorList, findVendorByName, invalidateVendorList } from '../vendors/vendorList';

// Vendors for a NEW feasibility (the Quick Create form). The same rules as
// "Add vendor" on an existing feasibility: pick from the vendor list (linked
// by vendor_id, contacts filled in) or type a new name, which the server adds
// to the vendor list. Each vendor only once.
//
// value:    [{ vendorId, vendorName, vendorNumber, contactPerson, contactEmail, contactPhone }]
// onChange: (nextArray) => void

const sameName = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

export const FeasibilityVendorPicker = ({ value = [], onChange }) => {
  const apiFetch = useAppSelector(s => s.apiFetch);
  const vendorList = useVendorList(apiFetch);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  // Fresh list every time the form opens: vendors just added on the Vendors
  // page must be offered.
  useEffect(() => { invalidateVendorList(); }, []);

  const picked = (value || []);
  const isAdded = (vendor, typed) => picked.some(p =>
    (vendor && p.vendorId && String(p.vendorId) === String(vendor.id)) || sameName(p.vendorName, typed));

  const add = (typed) => {
    const clean = (typed || '').trim();
    if (!clean) return;
    const match = findVendorByName(vendorList, clean);
    if (isAdded(match, match ? match.name : clean)) {
      setError(`${match ? match.name : clean} is already added`);
      return;
    }
    if (match && match.status === 'archived') {
      setError(`${match.name} is archived on the Vendors page`);
      return;
    }
    onChange([
      ...picked,
      match
        ? {
            vendorId: match.id,
            vendorName: match.name,
            vendorNumber: match.vendorNumber,
            contactPerson: match.contactPerson,
            contactEmail: match.email,
            contactPhone: match.phone,
          }
        : { vendorId: null, vendorName: clean, vendorNumber: '', contactPerson: '', contactEmail: '', contactPhone: '' },
    ]);
    setName('');
    setError('');
  };

  const handleChange = (e) => {
    const text = e.target.value;
    setError('');
    setName(text);
    // Choosing an entry from the dropdown adds it straight away. Browsers
    // report that as a replacement (or no input type at all), unlike typing,
    // so a typed name that happens to match waits for Add / Enter.
    const inputType = e.nativeEvent?.inputType;
    const fromDropdown = !inputType || inputType === 'insertReplacementText';
    const match = findVendorByName(vendorList, text);
    if (fromDropdown && match && text === match.name && !isAdded(match, match.name)) add(text);
  };

  const remove = (idx) => onChange(picked.filter((_, i) => i !== idx));

  const typedMatch = findVendorByName(vendorList, name);

  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
        Vendors <span className="normal-case font-normal text-slate-500 dark:text-zinc-500">(optional)</span>
      </label>

      <div className="flex gap-2">
        <input
          type="text"
          list="new-feasibility-vendor-options"
          autoComplete="off"
          placeholder="Pick from the vendor list or type a new name"
          value={name}
          onChange={handleChange}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault(); // don't submit the whole form
              add(name);
            }
          }}
          className="flex-1 min-w-0 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
        />
        <button
          type="button"
          onClick={() => add(name)}
          disabled={!name.trim()}
          className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white cursor-pointer disabled:cursor-not-allowed"
        >
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>
      <datalist id="new-feasibility-vendor-options">
        {vendorList
          .filter(v => !isAdded(v, v.name))
          .map(v => (
            <option key={v.id} value={v.name}>{[v.vendorNumber, v.cities].filter(Boolean).join(' · ')}</option>
          ))}
      </datalist>

      {error ? (
        <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{error}</p>
      ) : name.trim() ? (
        <p className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400">
          {typedMatch
            ? `From the vendor list (${typedMatch.vendorNumber}).`
            : 'New vendor — press Add; it will be added to the vendor list.'}
        </p>
      ) : null}

      {picked.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          {picked.map((v, i) => (
            <div
              key={`${v.vendorId || 'new'}-${v.vendorName}`}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
            >
              <Truck className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              <span className="font-semibold text-slate-800 dark:text-zinc-100 truncate">{v.vendorName}</span>
              <span className="text-slate-500 dark:text-zinc-400 truncate">
                {v.vendorNumber || 'new vendor'}
                {v.contactPerson ? ` · ${v.contactPerson}` : ''}
              </span>
              <button
                type="button"
                onClick={() => remove(i)}
                title="Remove"
                className="ml-auto p-0.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FeasibilityVendorPicker;
