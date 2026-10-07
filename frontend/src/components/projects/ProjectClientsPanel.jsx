import React, { useState } from 'react';
import AsyncSelect from 'react-select/async';
import { useAppSelector } from '../../context/AppContext';
import { canCreateProject } from '../../utils/permissions';
import { Building2, Pencil } from 'lucide-react';

// The clients a project belongs to — spec slide 9: "A project can belong to
// more than one client, and a client can have many projects." The first is
// the primary client. People who can edit projects can add / remove clients;
// every change is written to the project's audit history.

const toOption = (c) => ({
  value: c.id,
  label: `${c.companyName}${c.clientNumber ? ` (${c.clientNumber})` : ''}`,
});

export const ProjectClientsPanel = ({ project }) => {
  const { currentUser, permissionMatrix, apiFetch, fetchClientsPage, updateProject } = useAppSelector(s => ({ currentUser: s.currentUser, permissionMatrix: s.permissionMatrix, apiFetch: s.apiFetch, fetchClientsPage: s.fetchClientsPage, updateProject: s.updateProject }));
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);

  const linked = project.clients && project.clients.length
    ? project.clients
    : (project.clientId ? [{ id: project.clientId, companyName: project.clientName, clientNumber: '' }] : []);
  // Primary first.
  const ordered = [...linked].sort((a, b) =>
    (String(a.id) === String(project.clientId) ? -1 : 0) - (String(b.id) === String(project.clientId) ? -1 : 0));

  const canEdit = canCreateProject(currentUser, permissionMatrix) && project.status !== 'archived';

  // Same search as the other client pickers: your own clients by default,
  // name / ID search across all clients once 2+ letters are typed.
  const loadOptions = async (input) => {
    const q = (input || '').trim();
    if (q.length < 2) {
      // First 20 of the clients this user can see, from the server.
      try {
        const { clients: firstPage } = await fetchClientsPage({ page: 1, limit: 20 });
        return firstPage.filter(c => c.status !== 'archived').map(toOption);
      } catch {
        return [];
      }
    }
    try {
      const res = await apiFetch(`/api/clients/lookup?search=${encodeURIComponent(q)}`);
      const data = await res.json().catch(() => ({}));
      return (data.clients || []).map(c => toOption({
        id: c.ID ?? c.id, companyName: c.company_name, clientNumber: c.client_number,
      }));
    } catch {
      return [];
    }
  };

  const startEdit = () => {
    setSelected(ordered.map(toOption));
    setEditing(true);
  };

  const save = async () => {
    if (selected.length === 0) {
      alert('A project needs at least one client.');
      return;
    }
    setBusy(true);
    const ok = await updateProject(project.id, { clientIds: selected.map(o => o.value) });
    setBusy(false);
    if (ok !== false && ok !== null) setEditing(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
          <Building2 className="w-3.5 h-3.5" /> Clients ({ordered.length})
        </h4>
        {canEdit && !editing && (
          <button type="button" onClick={startEdit}
            className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer">
            <Pencil className="w-3 h-3" /> Edit clients
          </button>
        )}
      </div>

      {!editing ? (
        ordered.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-zinc-500 italic">No client linked.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {ordered.map((c, i) => (
              <span key={c.id}
                className="px-2 py-1 rounded-lg text-xs bg-slate-200 dark:bg-zinc-800 text-slate-800 dark:text-zinc-200 border border-slate-300 dark:border-zinc-700">
                {c.companyName || `Client #${c.id}`}
                {c.clientNumber && <span className="ml-1 font-mono text-[10px] text-slate-500 dark:text-zinc-500">{c.clientNumber}</span>}
                {i === 0 && ordered.length > 1 && (
                  <span className="ml-1.5 text-[9px] font-bold uppercase text-indigo-600 dark:text-indigo-400">Primary</span>
                )}
              </span>
            ))}
          </div>
        )
      ) : (
        <div className="space-y-2">
          <AsyncSelect
            isMulti
            cacheOptions
            defaultOptions
            value={selected}
            loadOptions={loadOptions}
            onChange={(opts) => setSelected(opts || [])}
            noOptionsMessage={({ inputValue }) => ((inputValue || '').trim().length < 2
              ? 'Type at least 2 letters to search all clients'
              : 'No client matches')}
            placeholder="Add clients..."
            classNamePrefix="rs"
          />
          <p className="text-[10px] text-slate-500 dark:text-zinc-500">The first client is the primary one.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(false)}
              className="px-3 py-1.5 rounded-lg text-xs text-slate-600 dark:text-zinc-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800 cursor-pointer">Cancel</button>
            <button type="button" onClick={save} disabled={busy || selected.length === 0}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white cursor-pointer">
              {busy ? 'Saving…' : 'Save clients'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
