import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  X, Pencil, Trash2, Building, MapPin, Truck, User as UserIcon, Calendar,
  Plus, ShieldCheck, ArrowRightCircle, Pin, Paperclip
} from 'lucide-react';
import { PriorityBadge } from '../common/Badge';
import { canCreateProject } from '../../utils/permissions';

// New file — FeasibilitiesView.jsx's onClick (setSelectedFeasibilityId) has
// been wired to this since the view was first built; nothing rendered it,
// because this file and FeasibilityEditModal.jsx never existed (the imports
// in FeasibilitiesView.jsx were commented out with a note saying so). This
// mirrors TaskDetailDrawer / TicketDetailDrawer's split: this drawer is the
// read + status + vendors + convert + delete surface, with an Edit button
// that opens the separate FeasibilityEditModal for the core fields.

const STATUS_OPTIONS = [
  ['draft', 'Draft'],
  ['in_progress', 'In Progress'],
  ['feasible', 'Feasible'],
  ['not_feasible', 'Not Feasible'],
  ['cancelled', 'Cancelled'],
  // "converted" is deliberately not selectable here — it's only ever set by
  // the Convert to Project action below, which does more than change a
  // status field (it creates a real project and links it).
];

const VENDOR_STATUS_OPTIONS = [
  ['pending', 'Pending'],
  ['feasible', 'Feasible'],
  ['not_feasible', 'Not Feasible'],
  ['waiting_response', 'Waiting on Response'],
];

const getStatusColor = (status) => {
  switch (status) {
    case 'draft': return 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300';
    case 'in_progress': return 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300';
    case 'feasible': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300';
    case 'not_feasible': return 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300';
    case 'converted': return 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300';
    case 'cancelled': return 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300';
    default: return 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300';
  }
};

const getVendorStatusColor = (status) => {
  switch (status) {
    case 'feasible': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300';
    case 'not_feasible': return 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300';
    case 'waiting_response': return 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300';
    default: return 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300';
  }
};

const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : '—');
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString() : '—');

export const FeasibilityDetailDrawer = () => {
  const {
    feasibilities,
    selectedFeasibilityId,
    setSelectedFeasibilityId,
    setSelectedFeasibilityEditId,
    currentUser,
    permissionMatrix,
    updateFeasibility,
    updateFeasibilityVendor,
    deleteFeasibilityVendor,
    addFeasibilityVendor,
    deleteFeasibility,
    convertFeasibilityToProject,
  } = useApp();

  const [isBusy, setIsBusy] = useState(false);
  const [showAddVendor, setShowAddVendor] = useState(false);
  const [vendorForm, setVendorForm] = useState({ vendorName: '', contactPerson: '', contactEmail: '', contactPhone: '', quotationRef: '' });
  const [showConvert, setShowConvert] = useState(false);
  const [convertForm, setConvertForm] = useState({ projectTitle: '', projectDescription: '', projectPriority: 'normal' });

  if (!selectedFeasibilityId) return null;
  const feasibility = (feasibilities || []).find(f => String(f.id) === String(selectedFeasibilityId));
  if (!feasibility || !currentUser) return null;

  const canManage = canCreateProject(currentUser, permissionMatrix);
  const isClosedOut = feasibility.status === 'converted' || feasibility.status === 'cancelled';
  const vendors = feasibility.vendors || [];
  const feasibleCount = vendors.filter(v => v.status === 'feasible').length;

  const close = () => setSelectedFeasibilityId(null);

  const handleStatusChange = async (next) => {
    if (!next || next === feasibility.status) return;
    setIsBusy(true);
    await updateFeasibility(feasibility.id, { status: next });
    setIsBusy(false);
  };

  const handleTogglePin = async () => {
    setIsBusy(true);
    await updateFeasibility(feasibility.id, { isPinned: !feasibility.isPinned });
    setIsBusy(false);
  };

  const handleVendorStatus = async (vendorId, status) => {
    setIsBusy(true);
    await updateFeasibilityVendor(feasibility.id, vendorId, { status });
    setIsBusy(false);
  };

  const handleVendorNotes = async (vendorId, response_notes) => {
    setIsBusy(true);
    await updateFeasibilityVendor(feasibility.id, vendorId, { response_notes });
    setIsBusy(false);
  };

  const handleRemoveVendor = async (vendorId) => {
    if (!window.confirm('Remove this vendor from the feasibility check?')) return;
    setIsBusy(true);
    await deleteFeasibilityVendor(feasibility.id, vendorId);
    setIsBusy(false);
  };

  const handleAddVendor = async (e) => {
    e.preventDefault();
    if (!vendorForm.vendorName.trim()) return;
    setIsBusy(true);
    const saved = await addFeasibilityVendor(feasibility.id, {
      vendor_name: vendorForm.vendorName.trim(),
      contact_person: vendorForm.contactPerson.trim(),
      contact_email: vendorForm.contactEmail.trim(),
      contact_phone: vendorForm.contactPhone.trim(),
      quotation_ref: vendorForm.quotationRef.trim(),
    });
    setIsBusy(false);
    if (saved) {
      setVendorForm({ vendorName: '', contactPerson: '', contactEmail: '', contactPhone: '', quotationRef: '' });
      setShowAddVendor(false);
    }
  };

  const handleConvert = async (e) => {
    e.preventDefault();
    if (!convertForm.projectTitle.trim()) return;
    setIsBusy(true);
    await convertFeasibilityToProject(feasibility.id, {
      project_title: convertForm.projectTitle.trim(),
      project_description: convertForm.projectDescription.trim(),
      project_priority: convertForm.projectPriority,
    });
    setIsBusy(false);
    setShowConvert(false);
  };

  const handleArchive = async () => {
    if (!window.confirm(`Archive ${feasibility.feasibilityNumber}? It stays available for audit but leaves the default list.`)) return;
    const ok = await deleteFeasibility(feasibility.id);
    if (ok !== false) close();
  };

  return (
    <div
      id="feasibility-detail-drawer-backdrop"
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs"
      onClick={close}
    >
      <div
        id="feasibility-detail-drawer-container"
        className="w-full max-w-2xl bg-slate-200 dark:bg-zinc-950 h-full shadow-2xl border-l border-slate-300 dark:border-zinc-800 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-300 dark:border-zinc-800 bg-slate-300/40 dark:bg-zinc-900/50">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-950/80 px-2 py-0.5 rounded">
                {feasibility.feasibilityNumber}
              </span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(feasibility.status)} whitespace-nowrap`}>
                {feasibility.status.replace('_', ' ')}
              </span>
              <PriorityBadge priority={feasibility.priority} />
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-zinc-100 break-words">
              {feasibility.product}{feasibility.capacity ? ` — ${feasibility.capacity}` : ''}
            </h2>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={handleTogglePin}
              disabled={isBusy}
              className={`p-1.5 rounded-lg cursor-pointer disabled:opacity-60 ${feasibility.isPinned ? 'text-amber-500 hover:text-amber-600' : 'text-slate-500 dark:text-zinc-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800'}`}
              title={feasibility.isPinned ? 'Unpin' : 'Pin'}
            >
              <Pin className={`w-4 h-4 ${feasibility.isPinned ? 'fill-current' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => { setSelectedFeasibilityId(null); setSelectedFeasibilityEditId(feasibility.id); }}
              className="p-1.5 rounded-lg text-slate-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800 cursor-pointer"
              title="Edit"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={close}
              className="p-1.5 rounded-lg text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-slate-300/60 dark:hover:bg-zinc-800 cursor-pointer"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {feasibility.convertedProject && (
            <div className="p-4 rounded-xl bg-purple-100/60 dark:bg-purple-950/30 border border-purple-300 dark:border-purple-800 flex items-center gap-3">
              <ShieldCheck className="w-5 h-5 text-purple-600 shrink-0" />
              <div className="text-xs text-purple-900 dark:text-purple-200">
                Converted to project <span className="font-mono font-bold">{feasibility.convertedProject.code}</span> — {feasibility.convertedProject.title}
                {feasibility.convertedAt && <span className="block text-purple-700 dark:text-purple-400 mt-0.5">on {fmt(feasibility.convertedAt)}</span>}
              </div>
            </div>
          )}

          {feasibility.requirementDetails && (
            <div className="p-4 rounded-xl bg-slate-100 dark:bg-zinc-900/60 border border-slate-300 dark:border-zinc-800 text-xs text-slate-800 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">
              {feasibility.requirementDetails}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-slate-100 dark:bg-zinc-900/60 border border-slate-300 dark:border-zinc-800 text-xs">
            <div>
              <span className="text-slate-500 dark:text-zinc-400 block mb-1">Client</span>
              <span className="font-medium text-slate-900 dark:text-zinc-200 flex items-center gap-1">
                <Building className="w-3 h-3 shrink-0" /> {feasibility.client?.companyName || '—'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-zinc-400 block mb-1">City</span>
              <span className="font-medium text-slate-900 dark:text-zinc-200 flex items-center gap-1">
                <Truck className="w-3 h-3 shrink-0" /> {feasibility.city || '—'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-zinc-400 block mb-1">Route</span>
              <span className="font-medium text-slate-900 dark:text-zinc-200 flex items-center gap-1">
                <MapPin className="w-3 h-3 shrink-0" />
                {feasibility.fromLocation || '—'} → {feasibility.toLocation || '—'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-zinc-400 block mb-1">Department</span>
              <span className="font-medium text-slate-900 dark:text-zinc-200">{feasibility.assignedDept || '—'}</span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-zinc-400 block mb-1">Assigned to</span>
              <span className="font-medium text-slate-900 dark:text-zinc-200 flex items-center gap-1">
                <UserIcon className="w-3 h-3 shrink-0" /> {feasibility.assignedUser?.name || 'Unassigned'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-zinc-400 block mb-1">Target date</span>
              <span className="font-medium text-slate-900 dark:text-zinc-200 flex items-center gap-1">
                <Calendar className="w-3 h-3 shrink-0" /> {fmtDate(feasibility.targetDate)}
              </span>
            </div>
          </div>

          {feasibility.notes && (
            <div>
              <h3 className="text-xs font-bold text-slate-800 dark:text-zinc-200 mb-1.5">Notes</h3>
              <p className="text-xs text-slate-700 dark:text-zinc-300 whitespace-pre-wrap p-3 rounded-lg bg-slate-100 dark:bg-zinc-900/60 border border-slate-300 dark:border-zinc-800">
                {feasibility.notes}
              </p>
            </div>
          )}

          {/* Vendors */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-slate-800 dark:text-zinc-200">
                Vendors ({vendors.length}){feasibleCount > 0 && <span className="text-emerald-600 dark:text-emerald-400 font-normal"> · {feasibleCount} feasible</span>}
              </h3>
              {!isClosedOut && (
                <button
                  type="button"
                  onClick={() => setShowAddVendor(v => !v)}
                  className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Add vendor
                </button>
              )}
            </div>

            {showAddVendor && (
              <form onSubmit={handleAddVendor} className="mb-3 p-3 rounded-xl bg-slate-100 dark:bg-zinc-900/60 border border-slate-300 dark:border-zinc-800 space-y-2">
                <input
                  type="text"
                  placeholder="Vendor name (required)"
                  value={vendorForm.vendorName}
                  onChange={(e) => setVendorForm({ ...vendorForm, vendorName: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" placeholder="Contact person" value={vendorForm.contactPerson} onChange={(e) => setVendorForm({ ...vendorForm, contactPerson: e.target.value })} className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden" />
                  <input type="email" placeholder="Contact email" value={vendorForm.contactEmail} onChange={(e) => setVendorForm({ ...vendorForm, contactEmail: e.target.value })} className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden" />
                  <input type="text" placeholder="Contact phone" value={vendorForm.contactPhone} onChange={(e) => setVendorForm({ ...vendorForm, contactPhone: e.target.value })} className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden" />
                  <input type="text" placeholder="Quotation ref" value={vendorForm.quotationRef} onChange={(e) => setVendorForm({ ...vendorForm, quotationRef: e.target.value })} className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden" />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" onClick={() => setShowAddVendor(false)} className="px-3 py-1.5 text-xs text-slate-600 dark:text-zinc-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg cursor-pointer">Cancel</button>
                  <button type="submit" disabled={isBusy || !vendorForm.vendorName.trim()} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg text-xs font-semibold cursor-pointer">Add</button>
                </div>
              </form>
            )}

            {vendors.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-zinc-500 italic">No vendors added yet.</p>
            ) : (
              <div className="space-y-2">
                {vendors.map(v => (
                  <div key={v.id} className="p-3 rounded-xl bg-slate-100 dark:bg-zinc-900/60 border border-slate-300 dark:border-zinc-800">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="min-w-0">
                        <div className="font-semibold text-xs text-slate-900 dark:text-zinc-100 truncate">{v.vendorName}</div>
                        {(v.contactPerson || v.contactEmail) && (
                          <div className="text-[11px] text-slate-500 dark:text-zinc-400 truncate">
                            {v.contactPerson}{v.contactPerson && v.contactEmail ? ' · ' : ''}{v.contactEmail}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <select
                          value={v.status}
                          onChange={(e) => handleVendorStatus(v.id, e.target.value)}
                          disabled={isBusy || isClosedOut}
                          className={`text-[11px] px-1.5 py-1 rounded-md border-0 font-medium cursor-pointer disabled:opacity-60 ${getVendorStatusColor(v.status)}`}
                        >
                          {VENDOR_STATUS_OPTIONS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                        </select>
                        {!isClosedOut && (
                          <button type="button" onClick={() => handleRemoveVendor(v.id)} disabled={isBusy} className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded cursor-pointer disabled:opacity-60" title="Remove vendor">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <textarea
                      rows={1}
                      defaultValue={v.responseNotes}
                      onBlur={(e) => { if (e.target.value !== v.responseNotes) handleVendorNotes(v.id, e.target.value); }}
                      disabled={isBusy || isClosedOut}
                      placeholder="Response notes..."
                      className="w-full px-2 py-1 text-[11px] rounded-md border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 focus:outline-hidden resize-none disabled:opacity-60"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Attachments (read-only — no upload path exists for feasibilities yet) */}
          {(feasibility.attachments || []).length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-slate-800 dark:text-zinc-200 mb-2 flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5" /> Attachments ({feasibility.attachments.length})
              </h3>
              <ul className="space-y-1.5">
                {feasibility.attachments.map(a => (
                  <li key={a.id} className="text-xs flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-100 dark:bg-zinc-900/60 border border-slate-300 dark:border-zinc-800">
                    <span className="truncate font-medium text-slate-800 dark:text-zinc-200">{a.name || 'Attachment'}</span>
                    <span className="text-[11px] text-slate-500 dark:text-zinc-400 shrink-0">{a.uploadedByName ? `${a.uploadedByName} · ` : ''}{fmt(a.uploadedAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-4 border-t border-slate-300 dark:border-zinc-800 bg-slate-300/40 dark:bg-zinc-950 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600 dark:text-zinc-400 font-medium">Status:</span>
              <select
                value={feasibility.status}
                onChange={(e) => handleStatusChange(e.target.value)}
                disabled={isBusy || feasibility.status === 'converted'}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 font-medium focus:outline-hidden disabled:opacity-60"
              >
                {!STATUS_OPTIONS.some(([v]) => v === feasibility.status) && (
                  <option value={feasibility.status}>{feasibility.status.replace('_', ' ')}</option>
                )}
                {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>

            <div className="flex items-center gap-2">
              {canManage && !isClosedOut && !showConvert && (
                <button
                  type="button"
                  onClick={() => { setShowConvert(true); setConvertForm(f => ({ ...f, projectTitle: f.projectTitle || `${feasibility.product} — ${feasibility.city}` })); }}
                  className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <ArrowRightCircle className="w-3.5 h-3.5" /> Convert to Project
                </button>
              )}
              {canManage && !isClosedOut && (
                <button
                  type="button"
                  onClick={handleArchive}
                  className="p-1.5 text-slate-500 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg cursor-pointer"
                  title="Archive feasibility"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {showConvert && (
            <form onSubmit={handleConvert} className="space-y-2 p-3 rounded-xl bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-900">
              <input
                type="text"
                placeholder="Project title (required)"
                value={convertForm.projectTitle}
                onChange={(e) => setConvertForm({ ...convertForm, projectTitle: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg border border-purple-300 dark:border-purple-800 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
              />
              <textarea
                rows={2}
                placeholder="Project description (optional)"
                value={convertForm.projectDescription}
                onChange={(e) => setConvertForm({ ...convertForm, projectDescription: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg border border-purple-300 dark:border-purple-800 bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden resize-none"
              />
              <div className="flex items-center gap-2 justify-end">
                <button type="button" onClick={() => setShowConvert(false)} disabled={isBusy} className="px-3 py-1.5 text-xs text-slate-600 dark:text-zinc-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg cursor-pointer disabled:opacity-60">Cancel</button>
                <button type="submit" disabled={isBusy || !convertForm.projectTitle.trim()} className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white rounded-lg text-xs font-semibold cursor-pointer">
                  {isBusy ? 'Converting...' : 'Confirm conversion'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};