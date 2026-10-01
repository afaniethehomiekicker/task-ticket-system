import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  Truck, Plus, Search, Pencil, Archive, RotateCcw, X, Phone, Mail, MapPin, User as UserIcon, Layers,
} from 'lucide-react';
import { canManageVendors } from '../../utils/permissions';
import { normalizeVendor, invalidateVendorList } from './vendorList';

// Vendor master — spec slides 30-31 ("Vendors" in the main menu; a core
// entity with its own ID, audit trail and no hard delete). Everyone can view
// the list and each vendor's track record; "Manage Vendor List" is needed to
// add, edit, archive or restore. Vendors typed on a feasibility are added
// here automatically, so this list fills itself as work happens.

const EMPTY_FORM = { name: '', contactPerson: '', phone: '', email: '', cities: '', services: '', notes: '' };

const VENDOR_STATUS_LABELS = {
  pending: 'Pending',
  waiting_response: 'Waiting',
  feasible: 'Feasible',
  not_feasible: 'Not feasible',
};

const vendorStatusClass = (s) => {
  switch (s) {
    case 'feasible': return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900';
    case 'not_feasible': return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900';
    default: return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900';
  }
};

const inputClass = 'w-full p-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-xs focus:outline-hidden';

const StatChips = ({ stats }) => (
  <div className="flex flex-wrap gap-1">
    <span className="px-1.5 py-0.5 rounded border text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900" title="Feasible">
      ✓ {stats.feasible}
    </span>
    <span className="px-1.5 py-0.5 rounded border text-[10px] bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900" title="Not feasible">
      ✗ {stats.notFeasible}
    </span>
    <span className="px-1.5 py-0.5 rounded border text-[10px] bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900" title="Pending">
      … {stats.pending}
    </span>
  </div>
);

export const VendorsView = () => {
  const { apiFetch, currentUser, permissionMatrix, setSelectedFeasibilityId } = useApp();
  const canManage = canManageVendors(currentUser, permissionMatrix);

  const [tab, setTab] = useState('active'); // active | archived
  const [search, setSearch] = useState('');
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null); // vendor being edited, or null for new
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [detailId, setDetailId] = useState(null);
  const [detail, setDetail] = useState(null); // { vendor, history }
  const [detailLoading, setDetailLoading] = useState(false);

  const loadVendors = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await apiFetch(tab === 'archived' ? '/api/vendors?status=archived' : '/api/vendors');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data.error || 'Could not load vendors.');
        setVendors([]);
      } else {
        setVendors((data.vendors || []).map(normalizeVendor).filter(Boolean));
      }
    } catch {
      setLoadError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => { loadVendors(); }, [loadVendors]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter(v =>
      [v.name, v.vendorNumber, v.contactPerson, v.phone, v.email, v.cities, v.services]
        .some(f => (f || '').toLowerCase().includes(q)));
  }, [vendors, search]);

  const openDetail = async (id) => {
    setDetailId(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await apiFetch(`/api/vendors/${id}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDetail({ vendor: normalizeVendor(data.vendor), history: data.history || [] });
      } else {
        setDetail({ error: data.error || 'Could not load this vendor.' });
      }
    } catch {
      setDetail({ error: 'Could not reach the server.' });
    } finally {
      setDetailLoading(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (v) => {
    setEditing(v);
    setForm({
      name: v.name, contactPerson: v.contactPerson, phone: v.phone, email: v.email,
      cities: v.cities, services: v.services, notes: v.notes,
    });
    setFormError('');
    setFormOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormError('Vendor name is required.');
      return;
    }
    setSaving(true);
    setFormError('');
    const body = {
      name: form.name.trim(),
      contact_person: form.contactPerson.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      cities: form.cities.trim(),
      services: form.services.trim(),
      notes: form.notes.trim(),
    };
    try {
      const res = await apiFetch(editing ? `/api/vendors/${editing.id}` : '/api/vendors', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error || 'Could not save the vendor.');
        return;
      }
      setFormOpen(false);
      invalidateVendorList();
      await loadVendors();
      if (editing && String(detailId) === String(editing.id)) openDetail(editing.id);
    } catch {
      setFormError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (v) => {
    if (!window.confirm(`Archive ${v.name}?\n\nIt leaves the vendor pickers but keeps its ID and full history. You can restore it from the Archived tab.`)) return;
    const res = await apiFetch(`/api/vendors/${v.id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Could not archive the vendor.');
      return;
    }
    setDetailId(null);
    invalidateVendorList();
    loadVendors();
  };

  const handleRestore = async (v) => {
    const res = await apiFetch(`/api/vendors/${v.id}/restore`, { method: 'PATCH' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Could not restore the vendor.');
      return;
    }
    setDetailId(null);
    invalidateVendorList();
    loadVendors();
  };

  const openFeasibility = (id) => {
    setDetailId(null);
    setSelectedFeasibilityId?.(id);
  };

  return (
    <div id="vendors-view" className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <Truck className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            Vendors
          </h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            One shared vendor list with contacts and each vendor's feasibility track record.
          </p>
        </div>
        {canManage && tab === 'active' && (
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Add Vendor
          </button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <div className="inline-flex rounded-lg border border-slate-300 dark:border-zinc-700 overflow-hidden text-xs">
          {[['active', 'Active'], ['archived', 'Archived']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3.5 py-1.5 cursor-pointer ${tab === key
                ? 'bg-indigo-600 text-white'
                : 'bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, VEN-ID, city, service…"
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden"
          />
        </div>
      </div>

      <div className="rounded-xl border border-slate-300 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-x-auto">
        {loading ? (
          <p className="p-6 text-xs text-slate-500 dark:text-zinc-400">Loading vendors…</p>
        ) : loadError ? (
          <p className="p-6 text-xs text-rose-500">{loadError}</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-xs text-slate-500 dark:text-zinc-400">
            {search ? 'No vendors match your search.' : tab === 'archived' ? 'No archived vendors.' : 'No vendors yet. Vendors added to a feasibility appear here automatically.'}
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-100 dark:bg-zinc-900 text-slate-600 dark:text-zinc-400">
              <tr>
                <th className="text-left font-semibold px-3 py-2">Vendor</th>
                <th className="text-left font-semibold px-3 py-2">Contact</th>
                <th className="text-left font-semibold px-3 py-2">Cities</th>
                <th className="text-left font-semibold px-3 py-2">Services</th>
                <th className="text-left font-semibold px-3 py-2">Feasibilities</th>
                {canManage && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map(v => (
                <tr
                  key={v.id}
                  onClick={() => openDetail(v.id)}
                  className="border-t border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-900/60 cursor-pointer"
                >
                  <td className="px-3 py-2.5">
                    <div className="font-semibold text-slate-900 dark:text-zinc-100">{v.name}</div>
                    <div className="text-[10px] text-slate-500 dark:text-zinc-500 font-mono">{v.vendorNumber}</div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-700 dark:text-zinc-300">
                    <div>{v.contactPerson || <span className="text-slate-400">—</span>}</div>
                    <div className="text-[10px] text-slate-500 dark:text-zinc-500">{[v.phone, v.email].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-700 dark:text-zinc-300">{v.cities || <span className="text-slate-400">—</span>}</td>
                  <td className="px-3 py-2.5 text-slate-700 dark:text-zinc-300">{v.services || <span className="text-slate-400">—</span>}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-700 dark:text-zinc-300 font-semibold">{v.stats.total}</span>
                      <StatChips stats={v.stats} />
                    </div>
                  </td>
                  {canManage && (
                    <td className="px-3 py-2.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {tab === 'active' ? (
                        <>
                          <button onClick={() => openEdit(v)} title="Edit" className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleArchive(v)} title="Archive" className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer">
                            <Archive className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <button onClick={() => handleRestore(v)} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-indigo-600 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer">
                          <RotateCcw className="w-3.5 h-3.5" /> Restore
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail */}
      {detailId && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setDetailId(null)}>
          <div
            className="w-full max-w-lg h-full overflow-y-auto bg-white dark:bg-zinc-950 border-l border-slate-300 dark:border-zinc-800 p-5 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-mono text-slate-500">{detail?.vendor?.vendorNumber}</p>
                <h3 className="text-lg font-bold text-slate-900 dark:text-zinc-100">{detail?.vendor?.name || 'Vendor'}</h3>
                {detail?.vendor?.status === 'archived' && (
                  <span className="inline-block mt-1 px-1.5 py-0.5 rounded border text-[10px] bg-slate-100 text-slate-600 border-slate-300 dark:bg-zinc-900 dark:text-zinc-400 dark:border-zinc-700">Archived</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {canManage && detail?.vendor && detail.vendor.status !== 'archived' && (
                  <button onClick={() => openEdit(detail.vendor)} className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer" title="Edit">
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => setDetailId(null)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {detailLoading && <p className="text-xs text-slate-500">Loading…</p>}
            {detail?.error && <p className="text-xs text-rose-500">{detail.error}</p>}

            {detail?.vendor && (
              <>
                <div className="grid grid-cols-1 gap-2 text-xs text-slate-700 dark:text-zinc-300">
                  <p className="flex items-center gap-2"><UserIcon className="w-3.5 h-3.5 text-slate-400" />{detail.vendor.contactPerson || '—'}</p>
                  <p className="flex items-center gap-2"><Phone className="w-3.5 h-3.5 text-slate-400" />{detail.vendor.phone || '—'}</p>
                  <p className="flex items-center gap-2"><Mail className="w-3.5 h-3.5 text-slate-400" />{detail.vendor.email || '—'}</p>
                  <p className="flex items-center gap-2"><MapPin className="w-3.5 h-3.5 text-slate-400" />{detail.vendor.cities || '—'}</p>
                  <p className="flex items-center gap-2"><Layers className="w-3.5 h-3.5 text-slate-400" />{detail.vendor.services || '—'}</p>
                  {detail.vendor.notes && (
                    <p className="whitespace-pre-wrap p-2.5 rounded-lg bg-slate-100 dark:bg-zinc-900 text-slate-700 dark:text-zinc-300">{detail.vendor.notes}</p>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    ['Total', detail.vendor.stats.total, 'text-slate-900 dark:text-zinc-100'],
                    ['Feasible', detail.vendor.stats.feasible, 'text-emerald-600'],
                    ['Not feasible', detail.vendor.stats.notFeasible, 'text-rose-600'],
                    ['Pending', detail.vendor.stats.pending, 'text-amber-600'],
                  ].map(([label, n, cls]) => (
                    <div key={label} className="p-2 rounded-lg border border-slate-200 dark:border-zinc-800">
                      <div className={`text-lg font-bold ${cls}`}>{n}</div>
                      <div className="text-[10px] text-slate-500 dark:text-zinc-400">{label}</div>
                    </div>
                  ))}
                </div>

                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-zinc-100 mb-2">Feasibility history</h4>
                  {detail.history.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-zinc-400">No feasibilities you have access to use this vendor yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {detail.history.map((h, i) => (
                        <button
                          key={`${h.feasibility_id}-${i}`}
                          onClick={() => openFeasibility(h.feasibility_id)}
                          className={`w-full text-left p-2.5 rounded-lg border border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-900 cursor-pointer ${h.withdrawn ? 'opacity-60' : ''}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400">{h.feasibility_number}</span>
                            <span className={`px-1.5 py-0.5 rounded border text-[10px] ${vendorStatusClass(h.vendor_status)}`}>
                              {h.withdrawn ? 'Withdrawn' : (VENDOR_STATUS_LABELS[h.vendor_status] || h.vendor_status)}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-600 dark:text-zinc-400 mt-0.5">
                            {[h.client_name, h.product, h.city].filter(Boolean).join(' · ')}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {canManage && (
                  <div className="pt-2 border-t border-slate-200 dark:border-zinc-800">
                    {detail.vendor.status === 'archived' ? (
                      <button onClick={() => handleRestore(detail.vendor)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-indigo-600 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer">
                        <RotateCcw className="w-3.5 h-3.5" /> Restore vendor
                      </button>
                    ) : (
                      <button onClick={() => handleArchive(detail.vendor)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-rose-600 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer">
                        <Archive className="w-3.5 h-3.5" /> Archive vendor
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Add / edit */}
      {formOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => !saving && setFormOpen(false)}>
          <div className="w-full max-w-lg rounded-xl bg-white dark:bg-zinc-950 border border-slate-300 dark:border-zinc-800 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-slate-900 dark:text-zinc-100">{editing ? `Edit ${editing.name}` : 'Add Vendor'}</h3>
              <button onClick={() => setFormOpen(false)} className="text-slate-500 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 dark:text-zinc-300 block mb-1">Vendor name</label>
                <input type="text" required maxLength={150} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-zinc-300 block mb-1">Contact person</label>
                  <input type="text" maxLength={150} value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 dark:text-zinc-300 block mb-1">Phone</label>
                  <input type="text" maxLength={50} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputClass} />
                </div>
              </div>
              <div>
                <label className="font-semibold text-slate-700 dark:text-zinc-300 block mb-1">Email</label>
                <input type="email" maxLength={150} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-zinc-300 block mb-1">Cities covered</label>
                  <input type="text" maxLength={500} placeholder="e.g. Islamabad, Lahore" value={form.cities} onChange={(e) => setForm({ ...form, cities: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 dark:text-zinc-300 block mb-1">Services</label>
                  <input type="text" maxLength={500} placeholder="e.g. DPLC, Dark Fiber, IPT" value={form.services} onChange={(e) => setForm({ ...form, services: e.target.value })} className={inputClass} />
                </div>
              </div>
              <div>
                <label className="font-semibold text-slate-700 dark:text-zinc-300 block mb-1">Notes</label>
                <textarea rows={3} maxLength={4000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputClass} />
              </div>
              {formError && <p className="text-rose-500">{formError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setFormOpen(false)} disabled={saving} className="px-3.5 py-2 rounded-lg text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 cursor-pointer">Cancel</button>
                <button type="submit" disabled={saving} className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold cursor-pointer">
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Vendor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
