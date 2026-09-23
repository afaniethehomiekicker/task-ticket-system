import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Building2, Plus, Pencil, Trash2, X, Check, Users2, Info } from 'lucide-react';
// ASSUMPTION, unverified — I don't have the current permissions.js in this
// session, so this import mirrors the established canManageClients pattern
// (same file, same shape) exactly, under the name canManageDepartments. If
// permissions.js doesn't actually export a function by that name, this
// screen's gating (and the matching import in Sidebar.jsx) needs a one-line
// fix once the real file is checked.
import { canManageDepartments } from '../../utils/permissions';

// New file — the "Departments" module the spec lists (slide 32) alongside
// Clients/Staff/Vendors, which didn't exist in the sidebar at all. Modeled
// on ClientsView.jsx's list-with-inline-edit shape, with one addition
// ClientsView doesn't need: renaming or deleting here has real consequences
// elsewhere (department.go cascades a rename to every user/task/ticket/
// project/feasibility that references it by name, and blocks deleting one
// still in use) — both are surfaced here rather than left as a silent
// side effect.

export const DepartmentsView = () => {
  const { departments, currentUser, permissionMatrix, createDepartment, updateDepartment, deleteDepartment } = useApp();

  const canManage = canManageDepartments(currentUser, permissionMatrix);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '' });
  const [isSaving, setIsSaving] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', description: '' });

  const startEdit = (dept) => {
    setEditingId(dept.id);
    setEditForm({ name: dept.name, description: dept.description || '' });
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ name: '', description: '' });
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!createForm.name.trim()) return;
    setIsSaving(true);
    const saved = await createDepartment({ name: createForm.name.trim(), description: createForm.description.trim() });
    setIsSaving(false);
    if (saved) {
      setCreateForm({ name: '', description: '' });
      setShowCreate(false);
    }
  };

  const handleSaveEdit = async (id) => {
    if (!editForm.name.trim()) return;
    const original = departments.find(d => String(d.id) === String(id));
    const renaming = original && original.name !== editForm.name.trim();
    if (renaming && !window.confirm(
      `Rename "${original.name}" to "${editForm.name.trim()}"?\n\nThis will update every user, task, ticket, project, and feasibility currently assigned to "${original.name}" to the new name.`
    )) {
      return;
    }
    setIsSaving(true);
    const saved = await updateDepartment(id, { name: editForm.name.trim(), description: editForm.description.trim() });
    setIsSaving(false);
    if (saved) cancelEdit();
  };

  const handleDelete = async (dept) => {
    if (!window.confirm(`Delete department "${dept.name}"? This only works if nothing currently uses it — you'll be told if something does.`)) return;
    await deleteDepartment(dept.id);
  };

  return (
    <div id="departments-view" className="space-y-6 max-w-4xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <Building2 className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            Departments
          </h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Managed centrally — used everywhere a Department is assigned (Users, Tasks, Tickets, Projects, Feasibilities).
          </p>
        </div>
        {canManage && !showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition cursor-pointer self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" /> New Department
          </button>
        )}
      </div>

      {!canManage && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-slate-200/60 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 text-xs text-slate-600 dark:text-zinc-400">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          You can view departments, but only an Admin or Super Admin can create, rename, or delete one.
        </div>
      )}

      {showCreate && (
        <form onSubmit={handleCreate} className="p-4 rounded-xl bg-slate-200/60 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 space-y-3">
          <input
            type="text"
            placeholder="Department name (required)"
            value={createForm.name}
            onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={createForm.description}
            onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-xs text-slate-600 dark:text-zinc-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg cursor-pointer">Cancel</button>
            <button type="submit" disabled={isSaving || !createForm.name.trim()} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg text-xs font-semibold cursor-pointer">
              {isSaving ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {departments.length === 0 ? (
        <div className="py-16 text-center text-slate-500 bg-slate-200/60 dark:bg-zinc-900 rounded-xl border border-slate-300 dark:border-zinc-800">
          <Building2 className="w-12 h-12 mx-auto mb-3 text-slate-400 dark:text-zinc-700" />
          <p className="text-sm font-semibold text-slate-800 dark:text-zinc-300">No departments yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {departments.map(dept => {
            const isEditing = editingId === dept.id;
            return (
              <div key={dept.id} className="p-4 rounded-xl border border-slate-300 dark:border-zinc-800 bg-slate-200/60 dark:bg-zinc-900 space-y-2">
                {isEditing ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="w-full px-3 py-1.5 text-sm font-semibold rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                    />
                    <input
                      type="text"
                      placeholder="Description"
                      value={editForm.description}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                    />
                    <div className="flex justify-end gap-2">
                      <button onClick={cancelEdit} disabled={isSaving} className="p-1.5 text-slate-500 dark:text-zinc-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg cursor-pointer disabled:opacity-50" title="Cancel">
                        <X className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleSaveEdit(dept.id)} disabled={isSaving} className="p-1.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/40 rounded-lg cursor-pointer disabled:opacity-50" title="Save">
                        <Check className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 truncate flex items-center gap-1.5">
                          <Users2 className="w-3.5 h-3.5 text-slate-400" /> {dept.name}
                        </h3>
                        {dept.description && (
                          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">{dept.description}</p>
                        )}
                      </div>
                      {canManage && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => startEdit(dept)} className="p-1.5 text-slate-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg cursor-pointer" title="Edit">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleDelete(dept)} className="p-1.5 text-slate-500 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg cursor-pointer" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
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