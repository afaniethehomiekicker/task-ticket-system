import React, { useMemo } from 'react';
import CreatableSelect from 'react-select/creatable';
import { PAKISTAN_CITIES } from '../../utils/pakistanCities';

// City picker: a dropdown of Pakistan's cities that you can type into.
//
//   - Typing filters to cities that START with what you typed
//     ("K" → Karachi, Kasur, Kohat …; "Ka" → Karachi, Kasur …).
//   - A place that isn't in the list can still be used: type it and pick
//     "Use “…”" (small towns, villages).
//   - Follows light / dark mode, and the menu is drawn above the modal so it
//     is never cut off; 16px text on phones so iOS doesn't zoom in.
//
// value / onChange work with a plain string ('' = no city).

const PREFIX_FILTER = (option, input) => {
  // Always keep the "Use …" option for a typed city that isn't listed.
  if (option.data?.__isNew__) return true;
  const q = input.trim().toLowerCase();
  return !q || option.label.toLowerCase().startsWith(q);
};

export const CitySelect = ({
  value,
  onChange,
  id,
  placeholder = 'Select or type a city',
  compact = false,
  extraCities = [],
}) => {
  const options = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const c of [...PAKISTAN_CITIES, ...extraCities]) {
      const name = (c || '').trim();
      if (name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        list.push(name);
      }
    }
    // A saved city that isn't in the list (typed in before) still shows.
    const current = (value || '').trim();
    if (current && !seen.has(current.toLowerCase())) list.push(current);
    return list.sort((a, b) => a.localeCompare(b)).map(c => ({ value: c, label: c }));
  }, [extraCities, value]);

  const selected = value ? { value, label: value } : null;
  const pad = compact ? 'min-h-[34px] px-2' : 'min-h-[38px] px-2.5';
  const text = compact ? 'text-base sm:text-xs' : 'text-base sm:text-sm';

  return (
    <CreatableSelect
      inputId={id}
      unstyled
      isClearable
      options={options}
      value={selected}
      onChange={(opt) => onChange(opt ? opt.value.trim() : '')}
      // Pick a typed city with the existing spelling ("karachi" → "Karachi").
      onCreateOption={(typed) => {
        const t = typed.trim();
        const match = options.find(o => o.value.toLowerCase() === t.toLowerCase());
        onChange(match ? match.value : t);
      }}
      filterOption={PREFIX_FILTER}
      formatCreateLabel={(typed) => `Use “${typed.trim()}”`}
      isValidNewOption={(typed, _v, opts) => {
        const t = typed.trim().toLowerCase();
        return !!t && !opts.some(o => o.label.toLowerCase() === t);
      }}
      placeholder={placeholder}
      noOptionsMessage={() => 'No city starts with that'}
      // Drawn on <body> so the modal's scroll area never clips it.
      menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
      menuPlacement="auto"
      maxMenuHeight={240}
      styles={{ menuPortal: (base) => ({ ...base, zIndex: 9999 }) }}
      classNames={{
        container: () => 'w-full',
        control: ({ isFocused }) =>
          `${pad} ${text} w-full rounded-lg border bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 cursor-text transition ${
            isFocused
              ? 'border-indigo-500 ring-2 ring-indigo-500/40'
              : 'border-slate-300 dark:border-zinc-700 hover:border-indigo-400'
          }`,
        valueContainer: () => 'gap-1 py-1',
        placeholder: () => 'text-slate-400 dark:text-zinc-500',
        singleValue: () => 'text-slate-900 dark:text-zinc-100',
        input: () => 'text-slate-900 dark:text-zinc-100',
        indicatorsContainer: () => 'gap-1 text-slate-400 dark:text-zinc-500',
        clearIndicator: () => 'p-1 rounded hover:text-rose-500 cursor-pointer',
        dropdownIndicator: () => 'p-1 hover:text-indigo-500 cursor-pointer',
        indicatorSeparator: () => 'my-2 w-px bg-slate-300 dark:bg-zinc-700',
        menu: () =>
          `mt-1 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl overflow-hidden ${text}`,
        menuList: () => 'py-1',
        option: ({ isFocused, isSelected }) =>
          `px-3 py-2.5 sm:py-2 cursor-pointer ${
            isSelected
              ? 'bg-indigo-600 text-white'
              : isFocused
                ? 'bg-slate-100 dark:bg-zinc-800 text-slate-900 dark:text-zinc-100'
                : 'text-slate-800 dark:text-zinc-200'
          }`,
        noOptionsMessage: () => 'px-3 py-2 text-slate-500 dark:text-zinc-400',
      }}
    />
  );
};

export default CitySelect;
