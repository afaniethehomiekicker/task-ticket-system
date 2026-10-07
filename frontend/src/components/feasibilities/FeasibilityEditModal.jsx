import React, { useState, useEffect } from 'react';
import { useAppSelector } from '../../context/AppContext';
import { X } from 'lucide-react';

// New file, mirroring TaskEditModal.jsx's structure exactly. Handles the
// core record fields; status changes and vendor management live in
// FeasibilityDetailDrawer instead — same split already used for Tasks
// (TaskDetailDrawer handles status/review; TaskEditModal handles the core
// fields), so this follows an existing pattern rather than inventing one.

import { canAssignTickets, isStaffRole } from '../../utils/permissions';
import { CitySelect } from '../common/CitySelect';
import { ClientPicker } from '../common/ClientPicker';
import { feasibilityProductOptions, matchExistingProduct, MAX_PRODUCT_LENGTH, MAX_SUBJECT_LENGTH } from '../../utils/feasibilityProducts';

export const FeasibilityEditModal = () => {
  const {
    feasibilities, feasibilityProducts, feasibilitySummary,
    selectedFeasibilityEditId,
    setSelectedFeasibilityEditId,
    updateFeasibility,
    allUsers,
    departments,
    currentUser,
    permissionMatrix,
  } = useAppSelector(s => ({ feasibilities: s.feasibilities, feasibilityProducts: s.feasibilityProducts, feasibilitySummary: s.feasibilitySummary, selectedFeasibilityEditId: s.selectedFeasibilityEditId, setSelectedFeasibilityEditId: s.setSelectedFeasibilityEditId, updateFeasibility: s.updateFeasibility, allUsers: s.allUsers, departments: s.departments, currentUser: s.currentUser, permissionMatrix: s.permissionMatrix }));
  // Changing the handling department or person is a reassignment: needs
  // "Reassign Tickets & Tasks" (the backend refuses it otherwise).
  const canReassign = canAssignTickets(currentUser, permissionMatrix);

  const feasibility = (feasibilities || []).find(f => String(f.id) === String(selectedFeasibilityEditId));
  const [isSaving, setIsSaving] = useState(false);
  // Standard products + any typed in before (this record's own included).
  // Server list, plus this record's own product.
  const PRODUCTS = feasibilityProductOptions([...(feasibilityProducts || []), ...(feasibility ? [feasibility] : [])]);
  // "New product": type a product that isn't in the list.
  const [newProduct, setNewProduct] = useState(false);
  const [customProduct, setCustomProduct] = useState('');
  // Name of the selected client, shown without looking it up.
  const [clientLabel, setClientLabel] = useState('');

  const [formData, setFormData] = useState({
    product: 'DPLC',
    capacity: '',
    fromLocation: '',
    toLocation: '',
    city: '',
    requirementDetails: '',
    subject: '',
    clientId: '',
    assignedDept: '',
    assignedUserId: '',
    priority: 'normal',
    targetDate: '',
    notes: '',
  });

  useEffect(() => {
    if (feasibility) {
      setFormData({
        product: feasibility.product || 'DPLC',
        capacity: feasibility.capacity || '',
        fromLocation: feasibility.fromLocation || '',
        toLocation: feasibility.toLocation || '',
        city: feasibility.city || '',
        requirementDetails: feasibility.requirementDetails || '',
        subject: feasibility.subject || '',
        clientId: feasibility.clientId || '',
        assignedDept: feasibility.assignedDept || '',
        assignedUserId: feasibility.assignedUserId || '',
        priority: feasibility.priority || 'normal',
        targetDate: feasibility.targetDate ? String(feasibility.targetDate).slice(0, 10) : '',
        notes: feasibility.notes || '',
      });
      setNewProduct(false);
      setCustomProduct('');
      setClientLabel(feasibility.client?.companyName
        ? `${feasibility.client.companyName}${feasibility.client.clientNumber ? ` (${feasibility.client.clientNumber})` : ''}`
        : '');
    }
  }, [feasibility]);

  if (!selectedFeasibilityEditId || !feasibility) return null;

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    const product = newProduct ? matchExistingProduct(customProduct, PRODUCTS) : formData.product;
    if (!product) { setIsSaving(false); return; }
    const result = await updateFeasibility(selectedFeasibilityEditId, { ...formData, product });
    setIsSaving(false);
    if (result) {
      setSelectedFeasibilityEditId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60 p-4 overflow-y-auto">
      <div className="my-auto bg-slate-200 dark:bg-zinc-950 border border-slate-300 dark:border-zinc-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-300 dark:border-zinc-800 bg-slate-300/40 dark:bg-zinc-900/50 shrink-0">
          <div>
            <span className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 font-semibold uppercase tracking-wider">{feasibility.feasibilityNumber}</span>
            <h2 className="text-base font-bold text-slate-900 dark:text-zinc-100">Edit Feasibility</h2>
          </div>
          <button
            onClick={() => setSelectedFeasibilityEditId(null)}
            className="p-1 rounded-lg text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-slate-300/60 dark:hover:bg-zinc-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-zinc-300 cursor-pointer select-none w-fit">
            <input
              type="checkbox"
              checked={newProduct}
              onChange={(e) => setNewProduct(e.target.checked)}
              className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
            />
            New product <span className="text-slate-500 dark:text-zinc-500">(not in the list)</span>
          </label>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Product</label>
              {newProduct ? (
                <input
                  type="text"
                  required
                  autoFocus
                  maxLength={MAX_PRODUCT_LENGTH}
                  placeholder="Type the product name"
                  value={customProduct}
                  onChange={(e) => setCustomProduct(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
                />
              ) : (
              <select
                name="product"
                value={formData.product}
                onChange={handleChange}
                className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
              >
                {PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Capacity</label>
              <input
                type="text"
                name="capacity"
                placeholder="e.g. 100 Mbps, 1 Gbps"
                value={formData.capacity}
                onChange={handleChange}
                className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">From Location</label>
              <input
                type="text"
                name="fromLocation"
                value={formData.fromLocation}
                onChange={handleChange}
                className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">To Location</label>
              <input
                type="text"
                name="toLocation"
                value={formData.toLocation}
                onChange={handleChange}
                className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">City</label>
            <CitySelect
              compact
              value={formData.city}
              onChange={(city) => setFormData(fd => ({ ...fd, city }))}
              extraCities={feasibilitySummary?.cities || []}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Requirement Details</label>
            <textarea
              name="requirementDetails"
              value={formData.requirementDetails}
              onChange={handleChange}
              rows={3}
              className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Subject</label>
            <input
              type="text"
              name="subject"
              maxLength={MAX_SUBJECT_LENGTH}
              placeholder="Short subject line (optional)"
              value={formData.subject}
              onChange={handleChange}
              className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Client</label>
            <ClientPicker
              compact
              value={formData.clientId}
              label={clientLabel}
              onChange={(clientId, label) => { setFormData(fd => ({ ...fd, clientId })); setClientLabel(label); }}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Department</label>
              {/* Was free text — spec (slide 6) says departments must be a
                  real, admin-managed list ("dynamic — not hard-coded"), not
                  hardcoded options either. Sourced from the /api/departments
                  list (AppContext.jsx) instead. */}
              <select
                name="assignedDept"
                value={formData.assignedDept}
                onChange={handleChange}
                disabled={!canReassign}
                title={canReassign ? undefined : "You don't have permission to reassign"}
                className="disabled:opacity-60 disabled:cursor-not-allowed w-full px-3 py-2 bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
              >
                <option value="">No department</option>
                {(departments || []).map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                {/* If this feasibility's current department isn't in the
                    managed list (e.g. it was set before Departments existed,
                    or the department was since renamed/removed), show it
                    anyway so the field doesn't silently blank out an
                    existing value — same defensive pattern already used for
                    task/ticket status dropdowns elsewhere in this app. */}
                {formData.assignedDept && !(departments || []).some(d => d.name === formData.assignedDept) && (
                  <option value={formData.assignedDept}>{formData.assignedDept} (not in list)</option>
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Assigned To</label>
              <select
                name="assignedUserId"
                value={formData.assignedUserId}
                onChange={handleChange}
                disabled={!canReassign}
                title={canReassign ? undefined : "You don't have permission to reassign"}
                className="disabled:opacity-60 disabled:cursor-not-allowed w-full px-3 py-2 bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
              >
                <option value="">Unassigned</option>
                {(allUsers || [])
                  .filter(u => isStaffRole(u.role) || u.role === 'supervisor')
                  .filter(u => u.status === 'active' || String(u.id) === String(formData.assignedUserId))
                  .map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role}){u.status !== 'active' ? ' — inactive' : ''}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Priority</label>
              <select
                name="priority"
                value={formData.priority}
                onChange={handleChange}
                className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Target Date</label>
              <input
                type="date"
                name="targetDate"
                value={formData.targetDate}
                onChange={handleChange}
                className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">Notes</label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows={2}
              className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500 resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-300 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setSelectedFeasibilityEditId(null)}
              className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-zinc-300 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-lg text-xs transition shadow-xs cursor-pointer"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};