import React, { useState, useMemo, useEffect } from 'react';
import { useAppSelector } from '../../context/AppContext';
import { canManageClients, canGrantRecordAccess, canCreateClients, canRequestClientEdit } from '../../utils/permissions';
import { RecordAccessPanel } from '../common/RecordAccessPanel';
import { CustomFieldInputs } from './CustomFieldInputs';
import { ClientFieldsManager } from './ClientFieldsManager';
import { Client360View } from './Client360View';
import { ImportSpreadsheetModal } from '../common/ImportSpreadsheetModal';
import { Pager } from '../common/Pager';
import { buildClientImportConfig } from './clientImport';
import { RequestEditModal, EditRequestsPanel } from './ClientEditRequests';
import { 
  Building2, Search,
  Pencil, Trash2, X, Check, FolderKanban, UserCheck, Lock, SlidersHorizontal, LayoutDashboard,
  FileSpreadsheet, KeyRound, Clock
} from 'lucide-react';

// Cards per page. Rendering every client at once (thousands after an
// import) took seconds and froze the page.
const CLIENTS_PER_PAGE = 50;

export const ClientsView = () => {
  const {
    projects, updateClient, deleteClient, openQuickCreate, currentUser, permissionMatrix,
    clientFields, reloadClients, apiFetch, listPreset, setListPreset, fetchClientsPage, clientsVersion,
  } = useAppSelector(s => ({ fetchClientsPage: s.fetchClientsPage, clientsVersion: s.clientsVersion, projects: s.projects, updateClient: s.updateClient, deleteClient: s.deleteClient, openQuickCreate: s.openQuickCreate, currentUser: s.currentUser, permissionMatrix: s.permissionMatrix, clientFields: s.clientFields, reloadClients: s.reloadClients, apiFetch: s.apiFetch, listPreset: s.listPreset, setListPreset: s.setListPreset }));
  const canManage = canManageClients(currentUser, permissionMatrix);
  const canCreate = canCreateClients(currentUser, permissionMatrix);
  // "Staff (Client Editor)": edits clients an Admin added for 30 minutes
  // after they were added, then asks an admin for more time.
  const canRequestEdit = canRequestClientEdit(currentUser, permissionMatrix);

  // Edit requests (client_edit.go). Staff: the client they're asking about.
  // Admins: the requests panel and how many are waiting.
  const [requestFor, setRequestFor] = useState(null);
  const [showRequests, setShowRequests] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  // Re-render twice a minute so "editable for N min" counts down and the
  // Edit button disappears when the 30 minutes are up.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!canRequestEdit) return undefined;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [canRequestEdit]);

  // Admins: number of waiting requests, for the header badge.
  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    apiFetch('/api/clients/edit-requests?status=pending')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) setPendingCount((d.requests || []).length); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  // Opened from an "edit request" notification.
  useEffect(() => {
    if (!listPreset || listPreset.tab !== 'clients') return;
    if (listPreset.editRequests && canManage) setShowRequests(true);
    setListPreset(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listPreset]);

  // Editable right now (the server decides and enforces; editUntil only
  // hides the button once the time is up).
  const editableNow = (client) =>
    !!client.canEdit && (!client.editUntil || new Date(client.editUntil).getTime() > now);
  const minutesLeft = (client) =>
    client.editUntil ? Math.max(1, Math.ceil((new Date(client.editUntil).getTime() - now) / 60000)) : null;

  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  // Client whose Access panel is open (record-level grants, spec slide 16).
  const [accessOpenId, setAccessOpenId] = useState(null);
  // Client 360° view (spec slide 10) and the extra-fields manager (slide 8).
  const [overviewId, setOverviewId] = useState(null);
  const [showFieldsManager, setShowFieldsManager] = useState(false);
  // Spreadsheet import (many clients at once). Management only, same as the
  // Client fields button; the server checks and saves the rows
  // (POST /api/clients/import).
  const [showImport, setShowImport] = useState(false);
  const importConfig = useMemo(() => buildClientImportConfig({ clientFields }), [clientFields]);
  // Sharing a client: "Grant Record Access" plus full access to it
  // (management, or the person who created it) — same rule as the backend.
  const canShare = (client) => canGrantRecordAccess(currentUser, permissionMatrix) &&
    (canManage || String(client.createdById) === String(currentUser?.id));

  // ---- One page at a time, from the server ----
  // The client book can run to thousands, so it isn't kept in the browser:
  // this asks GET /api/clients for the page shown, searching on the server.
  // Refetches when the page or search changes, and when clients change
  // anywhere (clientsVersion: create, edit, archive, restore, import).
  const [page, setPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pageClients, setPageClients] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Wait for a pause in typing before asking the server.
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    fetchClientsPage({ page, limit: CLIENTS_PER_PAGE, search: debouncedSearch })
      .then(({ clients, pagination: pg }) => {
        if (cancelled) return;
        // Past the last page (e.g. after archiving its only client): go back.
        if (clients.length === 0 && page > 1 && pg.pages >= 1 && page > pg.pages) {
          setPage(pg.pages);
          return;
        }
        setPageClients(clients);
        setPagination(pg);
      })
      .catch(err => { if (!cancelled) setLoadError(err.message || 'Failed to load clients'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedSearch, clientsVersion]);

  const pager = {
    page: pagination.page || page,
    pages: Math.max(1, pagination.pages || 1),
    total: pagination.total || 0,
    start: ((pagination.page || page) - 1) * CLIENTS_PER_PAGE,
    count: pageClients.length,
    setPage,
  };

  // Projects per client, counted once for the whole list (it used to scan
  // every project for every card). Includes projects shared with other
  // clients too (slide 9).
  const projectCounts = useMemo(() => {
    const counts = new Map();
    for (const p of projects || []) {
      const ids = new Set([p.clientId, ...(p.clientIds || [])].filter(id => id != null).map(String));
      ids.forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
    }
    return counts;
  }, [projects]);
  const projectCountFor = (clientId) => projectCounts.get(String(clientId)) || 0;

  const startEdit = (client) => {
    setEditingId(client.id);
    setEditForm({
      companyName: client.companyName || '',
      contactPerson: client.contactPerson || '',
      email: client.email || '',
      phone: client.phone || '',
      website: client.website || '',
      industry: client.industry || '',
      address: client.address || '',
      city: client.city || '',
      notes: client.notes || '',
      clientName: client.clientName || '',
      cnic: client.cnic || '',
      mobile: client.mobile || '',
      customFields: { ...(client.customFields || {}) },
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveEdit = async (clientId) => {
    setIsSaving(true);
    // updateClient now returns null on failure (and already alerts with
    // the real error internally) — only exit edit mode on genuine
    // success, so a failed save doesn't discard what was typed with no
    // way to retry.
    const result = await updateClient(clientId, editForm);
    setIsSaving(false);
    if (result) {
      setEditingId(null);
      setEditForm({});
    } else if (!canManage) {
      // Most likely the 30 minutes ran out while editing: refresh, so the
      // card offers "Request edit access" instead.
      setEditingId(null);
      reloadClients();
    }
  };

  const handleDelete = async (client) => {
    if (!window.confirm(`Delete ${client.companyName}? This can't be undone.`)) return;
    await deleteClient(client.id);
  };

  return (
    <div id="clients-view" className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <Building2 className="w-6 h-6 text-purple-600 dark:text-purple-400" />
            Clients & Companies
          </h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Company profiles projects are built under.
          </p>
        </div>

        <div className="flex gap-2 self-start sm:self-auto">
        {canManage && (
          <button
            type="button"
            onClick={() => setShowFieldsManager(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-700 dark:text-zinc-300 hover:bg-slate-300/60 dark:hover:bg-zinc-800 cursor-pointer"
            title="Extra client fields (no schema change)"
          >
            <SlidersHorizontal className="w-4 h-4" /> Client fields
          </button>
        )}
        {canManage && (
          <button
            id="clients-import-btn"
            type="button"
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-700 dark:text-zinc-300 hover:bg-slate-300/60 dark:hover:bg-zinc-800 cursor-pointer"
            title="Add many clients from an Excel or CSV file"
          >
            <FileSpreadsheet className="w-4 h-4" /> Import from Excel
          </button>
        )}
        {canManage && (
          <button
            id="clients-edit-requests-btn"
            type="button"
            onClick={() => setShowRequests(true)}
            className="relative flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-700 dark:text-zinc-300 hover:bg-slate-300/60 dark:hover:bg-zinc-800 cursor-pointer"
            title="Requests from staff to edit admin-added clients after the first 30 minutes"
          >
            <KeyRound className="w-4 h-4" /> Edit requests
            {pendingCount > 0 && (
              <span className="ml-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold inline-flex items-center justify-center">
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            )}
          </button>
        )}
        {canCreate && (
          <button
            id="clients-new-btn"
            onClick={() => openQuickCreate({ tab: 'client', restrictToTab: true })}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-purple-600 hover:bg-purple-700 text-white shadow-xs transition cursor-pointer self-start sm:self-auto"
          >
            <Building2 className="w-4 h-4" />
            New Client
          </button>
        )}
        </div>
      </div>

      {showFieldsManager && <ClientFieldsManager onClose={() => setShowFieldsManager(false)} />}
      {requestFor && (
        <RequestEditModal client={requestFor} onClose={() => setRequestFor(null)} onSent={() => reloadClients()} />
      )}
      {showRequests && (
        <EditRequestsPanel onClose={() => setShowRequests(false)} onCountChange={setPendingCount} />
      )}
      {showImport && (
        <ImportSpreadsheetModal
          config={importConfig}
          onClose={() => setShowImport(false)}
          onImported={() => reloadClients()}
        />
      )}
      {overviewId && <Client360View clientId={overviewId} onClose={() => setOverviewId(null)} />}

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500 dark:text-zinc-400" />
        <input
          id="clients-search-input"
          type="text"
          placeholder="Search company, CL- ID, contact, city…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
        />
      </div>

      {/* Client List */}
      {loadError ? (
        <div className="py-10 text-center text-xs bg-slate-200/60 dark:bg-zinc-900 rounded-xl border border-slate-300 dark:border-zinc-800">
          <p className="text-rose-600 dark:text-rose-400">{loadError}</p>
          <button type="button" onClick={() => reloadClients()} className="mt-2 text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer">Try again</button>
        </div>
      ) : pageClients.length === 0 ? (
        <div className="py-16 text-center text-slate-500 bg-slate-200/60 dark:bg-zinc-900 rounded-xl border border-slate-300 dark:border-zinc-800">
          <Building2 className="w-12 h-12 mx-auto mb-3 text-slate-400 dark:text-zinc-700" />
          <p className="text-sm font-semibold text-slate-800 dark:text-zinc-300">
            {loading ? 'Loading clients…' : debouncedSearch ? 'No matching clients' : 'No clients yet'}
          </p>
          {!loading && (
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
            {debouncedSearch ? 'Try a different search term.' : 'Create your first client to start building projects under it.'}
          </p>
          )}
        </div>
      ) : (
        <>
        <div className={`transition-opacity ${loading ? 'opacity-60' : ''}`}>
        <Pager {...pager} noun="clients" />
        </div>
        {/* Compact table (same layout as Vendors). Click a row for the
            Client 360° view; address and website are there and in Edit. */}
        <div className={`rounded-xl border border-slate-300 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-x-auto transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <table className="w-full text-xs">
            <thead className="bg-slate-100 dark:bg-zinc-900 text-slate-600 dark:text-zinc-400">
              <tr>
                <th className="text-left font-semibold px-3 py-2">Client</th>
                <th className="text-left font-semibold px-3 py-2">Contact</th>
                <th className="text-left font-semibold px-3 py-2 hidden md:table-cell">City</th>
                <th className="text-left font-semibold px-3 py-2 hidden lg:table-cell">Industry</th>
                <th className="text-left font-semibold px-3 py-2 hidden sm:table-cell">Projects</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
          {pageClients.map(client => {
            const isEditing = editingId === client.id;
            const projectCount = projectCountFor(client.id);
            const canOpen = client.accessLevel !== 'reference';

            if (isEditing) {
              return (
                <tr key={client.id} id={`client-card-${client.id}`} className="border-t border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/60">
                  <td colSpan={6} className="px-3 py-3">
                        <div className="space-y-2.5">
                          <input
                            type="text"
                            placeholder="Company name"
                            value={editForm.companyName}
                            onChange={(e) => setEditForm({ ...editForm, companyName: e.target.value })}
                            className="w-full px-3 py-1.5 text-sm font-semibold rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="text"
                              placeholder="Contact person"
                              value={editForm.contactPerson}
                              onChange={(e) => setEditForm({ ...editForm, contactPerson: e.target.value })}
                              className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                            />
                            <input
                              type="email"
                              placeholder="Email"
                              value={editForm.email}
                              onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                              className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                            />
                            <input
                              type="text"
                              placeholder="Phone"
                              value={editForm.phone}
                              onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                              className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                            />
                            <input
                              type="text"
                              placeholder="Website"
                              value={editForm.website}
                              onChange={(e) => setEditForm({ ...editForm, website: e.target.value })}
                              className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                            />
                          </div>
                          <input
                            type="text"
                            placeholder="Industry"
                            value={editForm.industry}
                            onChange={(e) => setEditForm({ ...editForm, industry: e.target.value })}
                            className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                          />
                          <textarea
                            rows={2}
                            placeholder="Address"
                            value={editForm.address}
                            onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                            className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden resize-none"
                          />
                          {/* Spec slide 8 fields */}
                          <div className="grid grid-cols-2 gap-2">
                            {[['clientName', 'Client name (person)'], ['cnic', 'CNIC (optional)'], ['mobile', 'Mobile'], ['city', 'City']].map(([k, ph]) => (
                              <input key={k} type="text" placeholder={ph} value={editForm[k] || ''}
                                onChange={(e) => setEditForm({ ...editForm, [k]: e.target.value })}
                                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden" />
                            ))}
                          </div>
                          <textarea rows={2} placeholder="Notes" value={editForm.notes || ''}
                            onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                            className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden resize-none" />
                          <CustomFieldInputs values={editForm.customFields || {}}
                            onChange={(cf) => setEditForm({ ...editForm, customFields: cf })} />
                          <div className="flex justify-end gap-2 pt-1">
                            <button
                              onClick={cancelEdit}
                              disabled={isSaving}
                              className="p-1.5 text-slate-500 dark:text-zinc-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg cursor-pointer disabled:opacity-50"
                              title="Cancel"
                            >
                              <X className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => saveEdit(client.id)}
                              disabled={isSaving}
                              className="p-1.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/40 rounded-lg cursor-pointer disabled:opacity-50"
                              title="Save"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                  </td>
                </tr>
              );
            }

            return (
              <React.Fragment key={client.id}>
                <tr
                  id={`client-card-${client.id}`}
                  onClick={() => { if (canOpen) setOverviewId(client.id); }}
                  className={`border-t border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-900/60 align-top ${canOpen ? 'cursor-pointer' : ''}`}
                >
                  <td className="px-3 py-2.5 min-w-[160px]">
                    <div className="font-semibold text-slate-900 dark:text-zinc-100">{client.companyName}</div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {client.clientNumber && (
                        <span className="text-[10px] font-mono text-slate-500 dark:text-zinc-500">{client.clientNumber}</span>
                      )}
                      {client.accessLevel === 'reference' && (
                        <span
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-300/60 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 text-[9px] font-semibold uppercase"
                          title="You see this client through work linked to it. Contact details are shown to management or people given access."
                        >
                          <Lock className="w-2.5 h-2.5" /> Reference only
                        </span>
                      )}
                    </div>
                    <div onClick={(e) => e.stopPropagation()} className="w-fit">
                      {canRequestEdit && client.status !== 'archived' && (
                        editableNow(client) && client.editUntil ? (
                          <p className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                            <Clock className="w-3 h-3" /> You can edit this client for {minutesLeft(client)} more min
                          </p>
                        ) : client.editRequest === 'pending' ? (
                          <p className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-zinc-400">
                            <Clock className="w-3 h-3" /> Edit request sent — waiting for an admin
                          </p>
                        ) : !editableNow(client) && client.editRequest === 'available' ? (
                          <button
                            type="button"
                            onClick={() => setRequestFor(client)}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                          >
                            <KeyRound className="w-3 h-3" /> Request edit access
                          </button>
                        ) : null
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-700 dark:text-zinc-300 min-w-[150px]">
                    <div>{client.contactPerson || <span className="text-slate-400">—</span>}</div>
                    <div className="text-[10px] text-slate-500 dark:text-zinc-500 break-all">
                      {[client.phone || client.mobile, client.email].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-700 dark:text-zinc-300 hidden md:table-cell">
                    {client.city || <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-slate-700 dark:text-zinc-300 hidden lg:table-cell">
                    {client.industry || <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-2.5 hidden sm:table-cell">
                    <span className="inline-flex items-center gap-1 text-slate-700 dark:text-zinc-300">
                      <FolderKanban className="w-3.5 h-3.5 text-slate-400" />
                      <span className="font-semibold">{projectCount}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {(canManage || canShare(client) || client.accessLevel !== 'reference' || editableNow(client)) && <div className="flex items-center justify-end gap-0.5">
                        {client.accessLevel !== 'reference' && (
                          <button
                            onClick={() => setOverviewId(client.id)}
                            className="p-1.5 rounded-lg text-slate-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800 cursor-pointer"
                            title="Client 360° view"
                          >
                            <LayoutDashboard className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canShare(client) && (
                          <button
                            onClick={() => setAccessOpenId(accessOpenId === client.id ? null : client.id)}
                            className={`p-1.5 rounded-lg cursor-pointer ${accessOpenId === client.id
                              ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950/40'
                              : 'text-slate-500 dark:text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800'}`}
                            title="Access — share this client with specific people"
                          >
                            <UserCheck className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {editableNow(client) && (
                        <button
                          onClick={() => startEdit(client)}
                          className="p-1.5 text-slate-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg cursor-pointer"
                          title={client.editUntil ? `Edit (${minutesLeft(client)} min left)` : 'Edit'}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        )}
                        {canManage && (<>
                        <button
                          onClick={() => handleDelete(client)}
                          className="p-1.5 text-slate-500 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg cursor-pointer"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        </>)}
                      </div>}
                  </td>
                </tr>
                {accessOpenId === client.id && canShare(client) && (
                  <tr className="bg-emerald-50/60 dark:bg-emerald-950/20">
                    <td colSpan={6} className="px-3 py-2.5 border-t border-emerald-200 dark:border-emerald-900">
                      <RecordAccessPanel
                        kind="clients"
                        recordId={client.id}
                        recordLabel={client.companyName}
                        excludeUserIds={[client.createdById]}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
            </tbody>
          </table>
        </div>
        <Pager {...pager} noun="clients"
          onPageChange={() => document.getElementById('clients-view')?.scrollIntoView({ block: 'start' })} />
        </>
      )}
    </div>
  );
};