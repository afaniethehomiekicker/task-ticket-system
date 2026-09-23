import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { canManageClients } from '../../utils/permissions';
import { 
  Building2, Search, Mail, Phone, Globe, MapPin, Briefcase, 
  Pencil, Trash2, X, Check, FolderKanban
} from 'lucide-react';

export const ClientsView = () => {
  const { clients, projects, updateClient, deleteClient, openQuickCreate, currentUser, permissionMatrix } = useApp();
  const canManage = canManageClients(currentUser, permissionMatrix);

  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [isSaving, setIsSaving] = useState(false);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients || [];
    return (clients || []).filter(c =>
      (c.companyName || '').toLowerCase().includes(q) ||
      (c.contactPerson || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.industry || '').toLowerCase().includes(q)
    );
  }, [clients, search]);

  const projectCountFor = (clientId) =>
    (projects || []).filter(p => String(p.clientId) === String(clientId)).length;

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

        {canManage && (
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

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500 dark:text-zinc-400" />
        <input
          id="clients-search-input"
          type="text"
          placeholder="Search company, contact, or industry..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
        />
      </div>

      {/* Client List */}
      {filteredClients.length === 0 ? (
        <div className="py-16 text-center text-slate-500 bg-slate-200/60 dark:bg-zinc-900 rounded-xl border border-slate-300 dark:border-zinc-800">
          <Building2 className="w-12 h-12 mx-auto mb-3 text-slate-400 dark:text-zinc-700" />
          <p className="text-sm font-semibold text-slate-800 dark:text-zinc-300">
            {clients?.length ? 'No matching clients' : 'No clients yet'}
          </p>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
            {clients?.length ? 'Try a different search term.' : 'Create your first client to start building projects under it.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredClients.map(client => {
            const isEditing = editingId === client.id;
            const projectCount = projectCountFor(client.id);

            return (
              <div
                key={client.id}
                id={`client-card-${client.id}`}
                className="p-4 rounded-xl border border-slate-300 dark:border-zinc-800 bg-slate-200/60 dark:bg-zinc-900 space-y-3"
              >
                {isEditing ? (
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
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 truncate">
                          {client.companyName}
                        </h3>
                        {client.industry && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
                            <Briefcase className="w-3 h-3" />
                            {client.industry}
                          </span>
                        )}
                      </div>
                      {canManage && <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => startEdit(client)}
                          className="p-1.5 text-slate-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg cursor-pointer"
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(client)}
                          className="p-1.5 text-slate-500 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg cursor-pointer"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>}
                    </div>

                    <div className="space-y-1 text-xs text-slate-600 dark:text-zinc-400">
                      {client.contactPerson && (
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-slate-700 dark:text-zinc-300">{client.contactPerson}</span>
                        </div>
                      )}
                      {client.email && (
                        <div className="flex items-center gap-1.5">
                          <Mail className="w-3 h-3 shrink-0" />
                          <a href={`mailto:${client.email}`} className="hover:underline truncate" onClick={(e) => e.stopPropagation()}>
                            {client.email}
                          </a>
                        </div>
                      )}
                      {client.phone && (
                        <div className="flex items-center gap-1.5">
                          <Phone className="w-3 h-3 shrink-0" />
                          <span>{client.phone}</span>
                        </div>
                      )}
                      {client.website && (
                        <div className="flex items-center gap-1.5">
                          <Globe className="w-3 h-3 shrink-0" />
                          <a
                            href={client.website.startsWith('http') ? client.website : `https://${client.website}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline truncate"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {client.website}
                          </a>
                        </div>
                      )}
                      {client.address && (
                        <div className="flex items-start gap-1.5">
                          <MapPin className="w-3 h-3 shrink-0 mt-0.5" />
                          <span className="whitespace-pre-line">{client.address}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-zinc-500 pt-2 border-t border-slate-300 dark:border-zinc-800">
                      <FolderKanban className="w-3.5 h-3.5" />
                      {projectCount} {projectCount === 1 ? 'project' : 'projects'}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};