import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { X } from 'lucide-react';
import AsyncSelect from 'react-select/async';

export const TicketEditModal = () => {
  const { tickets, selectedTicketEditId, setSelectedTicketEditId, updateTicket, allUsers } = useApp();

  const ticket = (tickets || []).find(t => String(t.id) === String(selectedTicketEditId));

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'normal',
    status: 'open',
    assignedToId: '',
    category: ''
  });

  useEffect(() => {
    if (ticket) {
      setFormData({
        title: ticket.title || '',
        description: ticket.description || '',
        priority: ticket.priority || 'normal',
        status: ticket.status || 'open',
        assignedToId: ticket.assignedToId || '',
        category: ticket.category || ''
      });
    }
  }, [ticket]);

  // Resolves a raw id from a live /api/users search result (which may be a
  // bare backend numeric id, unrelated to the app's canonical local id
  // scheme) against the already-loaded allUsers list. If a local match
  // exists, we store THAT canonical id — the same id every other view
  // (ticket list, drawers, etc.) reads via allUsers.find(u => u.id === ...).
  // Without this, selecting a user here could store a raw backend id that
  // matches nothing in allUsers by strict equality, making the assignment
  // silently fail to display anywhere outside this modal.
  const resolveToCanonicalId = (rawId) => {
    if (!rawId && rawId !== 0) return '';
    const target = String(rawId);
    const match = (allUsers || []).find(u =>
      String(u.id) === target ||
      String(u.legacyId) === target ||
      (u.backendId !== undefined && u.backendId !== null && String(u.backendId) === target)
    );
    return match ? match.id : rawId;
  };

  // Server-side user search fetching function
  const loadUserOptions = async (inputValue) => {
    try {
      const res = await fetch(`/api/users?search=${encodeURIComponent(inputValue)}`);
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();

      const fetchedUsers = data.users || [];
      const options = fetchedUsers.map(u => {
        const rawId = u.id ?? u.ID;
        return {
          value: resolveToCanonicalId(rawId),
          label: `${u.name} (${u.role || 'Staff'}) - ${u.email || ''}`,
          user: u
        };
      });

      return [{ value: '', label: 'Unassigned' }, ...options];
    } catch (err) {
      // Fallback local search filtering if offline
      const filtered = (allUsers || []).filter(u => 
        u.name?.toLowerCase().includes(inputValue.toLowerCase()) ||
        u.email?.toLowerCase().includes(inputValue.toLowerCase())
      );
      return [
        { value: '', label: 'Unassigned' },
        ...filtered.map(u => ({ value: u.id, label: `${u.name} (${u.role})` }))
      ];
    }
  };

  if (!selectedTicketEditId || !ticket) return null;

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    updateTicket(selectedTicketEditId, formData);
    setSelectedTicketEditId(null);
  };

  // Pre-selected assignee option for React Select
  const currentAssignee = allUsers.find(u => String(u.id) === String(formData.assignedToId));
  const selectedUserOption = formData.assignedToId
    ? {
        value: formData.assignedToId,
        label: currentAssignee ? `${currentAssignee.name} (${currentAssignee.role})` : `User #${formData.assignedToId}`
      }
    : { value: '', label: 'Unassigned' };

  // Styling for React Select matching Tailwind Dark/Light Mode
  const customStyles = {
    control: (base, state) => ({
      ...base,
      backgroundColor: 'rgba(24, 24, 27, 0.8)',
      borderColor: state.isFocused ? '#6366f1' : '#3f3f46',
      borderRadius: '0.5rem',
      padding: '1px',
      fontSize: '0.75rem',
      boxShadow: 'none',
      '&:hover': { borderColor: '#6366f1' }
    }),
    // Rendered via menuPortalTarget (see below), so this needs its own
    // z-index high enough to sit above the modal backdrop (z-50) — the
    // menu is no longer a descendant of the modal card once portaled, so
    // the card's stacking context no longer applies to it.
    menuPortal: (base) => ({ ...base, zIndex: 9999 }),
    menu: (base) => ({
      ...base,
      backgroundColor: '#18181b',
      border: '1px solid #3f3f46',
      borderRadius: '0.5rem',
      fontSize: '0.75rem'
    }),
    option: (base, state) => ({
      ...base,
      backgroundColor: state.isFocused ? '#3f3f46' : '#18181b',
      color: '#f4f4f5',
      cursor: 'pointer'
    }),
    singleValue: (base) => ({ ...base, color: '#f4f4f5' }),
    input: (base) => ({ ...base, color: '#f4f4f5' }),
    placeholder: (base) => ({ ...base, color: '#a1a1aa' })
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-slate-200 dark:bg-zinc-950 border border-slate-300 dark:border-zinc-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-300 dark:border-zinc-800 bg-slate-300/40 dark:bg-zinc-900/50">
          <div>
            <span className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 font-semibold uppercase tracking-wider">{ticket.ticketNumber}</span>
            <h2 className="text-base font-bold text-slate-900 dark:text-zinc-100">Edit Ticket Details</h2>
          </div>
          <button
            onClick={() => setSelectedTicketEditId(null)}
            className="p-1 rounded-lg text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-slate-300/60 dark:hover:bg-zinc-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300 mb-1">Ticket Title</label>
            <input
              type="text"
              name="title"
              value={formData.title}
              onChange={handleChange}
              required
              className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300 mb-1">Description</label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              rows={3}
              className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300 mb-1">Priority</label>
              <select
                name="priority"
                value={formData.priority}
                onChange={handleChange}
                className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300 mb-1">Status</label>
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
              >
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300 mb-1">Assigned Agent (Searchable)</label>
            <AsyncSelect
              cacheOptions
              defaultOptions
              isSearchable
              loadOptions={loadUserOptions}
              value={selectedUserOption}
              onChange={(option) => setFormData({ ...formData, assignedToId: option ? option.value : '' })}
              placeholder="Search agent name or email..."
              styles={customStyles}
              // Renders the dropdown menu into document.body instead of as
              // a DOM child of this modal card. The card has
              // overflow-hidden (needed for its rounded corners), which
              // was silently clipping the menu since this field sits near
              // the bottom of the form — the control was clickable but the
              // opened menu had nowhere visible to render. menuPosition
              // "fixed" keeps it correctly positioned relative to the
              // control even though it's no longer a DOM descendant of it.
              menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
              menuPosition="fixed"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-300 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setSelectedTicketEditId(null)}
              className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-zinc-300 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg text-xs transition shadow-xs cursor-pointer"
            >
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
