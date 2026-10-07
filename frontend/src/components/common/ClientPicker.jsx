import React from 'react';
import AsyncSelect from 'react-select/async';
import { useAppSelector } from '../../context/AppContext';

// Searchable client picker for forms. The client book isn't kept in the
// browser (it can run to thousands), so this asks the server:
//   - nothing typed: the first 20 clients the user can see;
//   - 2+ letters: name / CL- ID search across all clients
//     (GET /api/clients/lookup — reference fields only, same as Quick Create).
//
// value: the client id ('' or null = none); label: its name, so the current
// client shows without a lookup; onChange(id, label).

const toOption = (c) => ({
  value: c.id,
  label: `${c.companyName}${c.clientNumber ? ` (${c.clientNumber})` : ''}${c.city ? ` — ${c.city}` : ''}`,
});

export const ClientPicker = ({ value, label, onChange, id, compact = false, placeholder = 'Search client by name or CL- ID…' }) => {
  const { apiFetch, fetchClientsPage } = useAppSelector(s => ({ apiFetch: s.apiFetch, fetchClientsPage: s.fetchClientsPage }));

  const loadOptions = async (input) => {
    const q = (input || '').trim();
    try {
      if (q.length < 2) {
        const { clients } = await fetchClientsPage({ page: 1, limit: 20 });
        return clients.filter(c => c.status !== 'archived').map(toOption);
      }
      const res = await apiFetch(`/api/clients/lookup?search=${encodeURIComponent(q)}`);
      const data = await res.json().catch(() => ({}));
      return (data.clients || []).map(c => toOption({
        id: c.ID ?? c.id, companyName: c.company_name || '', clientNumber: c.client_number || '', city: c.city || '',
      }));
    } catch {
      return [];
    }
  };

  const selected = value ? { value, label: label || `Client #${value}` } : null;
  const pad = compact ? 'min-h-[34px] px-2' : 'min-h-[38px] px-2.5';
  const text = compact ? 'text-base sm:text-xs' : 'text-base sm:text-sm';

  return (
    <AsyncSelect
      inputId={id}
      unstyled
      isClearable
      cacheOptions
      defaultOptions
      loadOptions={loadOptions}
      value={selected}
      onChange={(opt) => onChange(opt ? opt.value : '', opt ? opt.label : '')}
      placeholder={placeholder}
      noOptionsMessage={({ inputValue }) => (inputValue.trim().length < 2 ? 'Type at least 2 letters to search all clients' : 'No client found')}
      loadingMessage={() => 'Searching…'}
      menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
      menuPlacement="auto"
      maxMenuHeight={240}
      styles={{ menuPortal: (base) => ({ ...base, zIndex: 9999 }) }}
      classNames={{
        container: () => 'w-full',
        control: ({ isFocused }) =>
          `${pad} ${text} w-full rounded-lg border bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 cursor-text transition ${
            isFocused ? 'border-indigo-500 ring-2 ring-indigo-500/40' : 'border-slate-300 dark:border-zinc-700 hover:border-indigo-400'
          }`,
        valueContainer: () => 'gap-1 py-1',
        placeholder: () => 'text-slate-400 dark:text-zinc-500',
        singleValue: () => 'text-slate-900 dark:text-zinc-100',
        input: () => 'text-slate-900 dark:text-zinc-100',
        indicatorsContainer: () => 'gap-1 text-slate-400 dark:text-zinc-500',
        clearIndicator: () => 'p-1 rounded hover:text-rose-500 cursor-pointer',
        dropdownIndicator: () => 'p-1 hover:text-indigo-500 cursor-pointer',
        indicatorSeparator: () => 'my-2 w-px bg-slate-300 dark:bg-zinc-700',
        menu: () => `mt-1 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xl overflow-hidden ${text}`,
        menuList: () => 'py-1',
        option: ({ isFocused, isSelected }) =>
          `px-3 py-2.5 sm:py-2 cursor-pointer ${
            isSelected ? 'bg-indigo-600 text-white'
              : isFocused ? 'bg-slate-100 dark:bg-zinc-800 text-slate-900 dark:text-zinc-100'
                : 'text-slate-800 dark:text-zinc-200'
          }`,
        noOptionsMessage: () => 'px-3 py-2 text-slate-500 dark:text-zinc-400',
        loadingMessage: () => 'px-3 py-2 text-slate-500 dark:text-zinc-400',
      }}
    />
  );
};

export default ClientPicker;
