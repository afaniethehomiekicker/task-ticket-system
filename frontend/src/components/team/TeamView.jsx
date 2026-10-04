import React, { useState } from 'react';
import { useApp, getBackendId } from '../../context/AppContext';
import { 
  Users, Plus, Search, Shield, UserCheck, Mail, Building, 
  CheckCircle, AlertCircle, Edit, ToggleLeft, ToggleRight, X, Phone, Archive,
  Eye, EyeOff, KeyRound
} from 'lucide-react';
import { RoleBadge } from '../common/Badge';
import { canManageUsers, getRoleDisplayName } from '../../utils/permissions';

export const TeamView = () => {
  const { 
    allUsers, 
    currentUser, 
    tasks, 
    tickets, 
    toggleUserActiveStatus, 
    createUser, 
    updateUser,
    changeUserRole,
    customRoles,
    departments,
    permissionMatrix,
    archiveUser,
    apiFetch
  } = useApp();

  // L1..L4 are support tiers inside CNOC (spec), not departments. The tier
  // field only applies to CNOC users; the backend stores it empty otherwise.
  const SUPPORT_TIERS = ['L1', 'L2', 'L3', 'L4'];
  const isSupportDept = (name) => (name || '').trim().toLowerCase().startsWith('cnoc');

  const deptFilterOptions = Array.from(new Set([
    ...(departments || []).map(d => d.name),
    ...(allUsers || []).map(r => r.department).filter(Boolean),
  ])).sort((a, b) => a.localeCompare(b));

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [editingUser, setEditingUser] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedMemberDetailId, setSelectedMemberDetailId] = useState(null);
  const [isSavingUser, setIsSavingUser] = useState(false);
  const [tempPasswordBanner, setTempPasswordBanner] = useState(null);
  const [passwordError, setPasswordError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Reset password (Edit Member → Reset Password). Super admin only, for
  // anyone except themselves (own password: My Profile). Saving signs that
  // person out everywhere; they log in again with the new password.
  const EMPTY_RESET = { password: '', confirm: '', showPassword: false, showConfirm: false };
  const [resetFor, setResetFor] = useState(null); // user being reset, or null
  const [resetForm, setResetForm] = useState(EMPTY_RESET);
  const [resetError, setResetError] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetDoneFor, setResetDoneFor] = useState(null); // name, for the confirmation
  const canResetPassword = (u) =>
    currentUser?.role === 'super_admin' && !!u && String(u.id) !== String(currentUser?.id);

  const openReset = (u) => {
    setResetFor(u);
    setResetForm(EMPTY_RESET);
    setResetError('');
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (resetForm.password.length < MIN_PASSWORD_LENGTH) {
      setResetError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (resetForm.password !== resetForm.confirm) {
      setResetError('The two passwords do not match.');
      return;
    }
    setIsResetting(true);
    setResetError('');
    try {
      const res = await apiFetch(`/api/users/${getBackendId(resetFor.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: resetForm.password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResetError(data.error || 'Could not change the password.');
        return;
      }
      setResetDoneFor(resetFor.name);
      setResetFor(null);
      setResetForm(EMPTY_RESET);
    } catch {
      setResetError('Could not reach the server.');
    } finally {
      setIsResetting(false);
    }
  };

  // No default avatar: the old stock-photo URL was stored on every new user,
  // and the backend (correctly) rejects external avatar URLs on edit, so
  // those users could never be edited again. The UI already falls back to a
  // placeholder when avatar is empty. No default department either — it was
  // a hard-coded "Engineering" that isn't one of the managed departments.
  const EMPTY_FORM = {
    name: '',
    email: '',
    role: 'staff',
    department: '',
    title: '',
    adminId: '',
    supervisorId: '',
    supportTier: '',
    // New members only: the admin sets the first password themselves (no
    // more random temporary passwords). Never sent when editing.
    password: '',
    confirmPassword: ''
  };
  const MIN_PASSWORD_LENGTH = 8;

  const [formData, setFormData] = useState(EMPTY_FORM);

  // Department admins manage only their own department's people (the
  // server enforces the same rule); everyone else is listed read-only.
  // Department admins can only add people to their own department.
  const ownDeptOnly = (currentUser && currentUser.role !== 'super_admin' && (currentUser.department || '').trim())
    ? currentUser.department.trim().toLowerCase()
    : '';

  const canManageMember = (u) => {
    if (!currentUser) return false;
    if (currentUser.role === 'super_admin') return true;
    const myDept = (currentUser.department || '').trim().toLowerCase();
    return !!myDept && (u.department || '').trim().toLowerCase() === myDept;
  };

  // Active people only, plus whoever is currently linked (so an existing link
  // to a since-deactivated person still displays instead of blanking).
  const admins = allUsers.filter(u => u.role === 'admin' &&
    (u.status === 'active' || String(u.id) === String(formData.adminId)));
  const supervisors = allUsers.filter(u => u.role === 'supervisor' &&
    (u.status === 'active' || String(u.id) === String(formData.supervisorId)));

  const filteredUsers = allUsers.filter(u => {
    const matchSearch = u.name.toLowerCase().includes(search.toLowerCase()) ||
                        u.email.toLowerCase().includes(search.toLowerCase()) ||
                        u.title.toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === 'all' || u.role === roleFilter;
    // Archived accounts live in Archive → Users, not on the Team page.
    if (u.status === 'archived') return false;
    // Department admins (and everyone else with a department) see their own
    // department's people here; super admins see all.
    if (ownDeptOnly && (u.department || '').trim().toLowerCase() !== ownDeptOnly) return false;
    const matchDept = deptFilter === 'all' || u.department === deptFilter;
    return matchSearch && matchRole && matchDept;
  });

  const selectedMember = allUsers.find(u => u.id === selectedMemberDetailId);
  const memberTasks = tasks.filter(t => t.assignedToId === selectedMemberDetailId);
  const memberTickets = tickets.filter(t => t.assignedToId === selectedMemberDetailId);

  const handleSaveUser = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.email) return;

    if (!editingUser) {
      if ((formData.password || '').length < MIN_PASSWORD_LENGTH) {
        setPasswordError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        return;
      }
      if (formData.password !== formData.confirmPassword) {
        setPasswordError('The two passwords do not match.');
        return;
      }
    }
    setPasswordError('');

    // Spec slide 5: every Admin is a Department Admin — the server refuses an
    // Admin without a department, so say so before sending anything.
    if ((formData.role || 'staff') === 'admin' && !(formData.department || '').trim()) {
      alert('An Admin must belong to a department. Choose one, or make this person a Super Admin.');
      return;
    }

    setIsSavingUser(true);
    try {
      if (editingUser) {
        // Only the fields this form edits. It used to send the whole user
        // record back (avatar, status, ids...), so a user carrying an old
        // external avatar URL could never be saved, and the modal closed even
        // when the save failed.
        const saved = await updateUser(editingUser.id, {
          name: formData.name,
          title: formData.title || '',
          department: formData.department || '',
          adminId: formData.adminId || '',
          supervisorId: formData.supervisorId || '',
          supportTier: isSupportDept(formData.department) ? (formData.supportTier || '') : '',
        });
        if (!saved) return;

        // Role change: separate, audited endpoint, and confirmed first.
        if (formData.role && formData.role !== editingUser.role) {
          const ok = window.confirm(
            `Change ${formData.name}'s role from ${getRoleDisplayName(editingUser.role)} to ${getRoleDisplayName(formData.role)}? ` +
            'This changes what they can see and do across the whole system.'
          );
          if (!ok) return;
          const changed = await changeUserRole(editingUser.id, formData.role);
          if (!changed) return;
        }

        setEditingUser(null);
        setShowAddModal(false);
      } else {
        // Explicit fields only — never whatever else happens to be in the
        // form state.
        const result = await createUser({
          name: formData.name,
          email: formData.email,
          password: formData.password,
          role: formData.role || 'staff',
          department: formData.department || '',
          title: formData.title || '',
          adminId: formData.adminId || '',
          supervisorId: formData.supervisorId || '',
          supportTier: isSupportDept(formData.department) ? (formData.supportTier || '') : '',
        });
        if (result) {
          setShowAddModal(false);
          if (result.temporaryPassword) {
            setTempPasswordBanner({ name: result.user?.name || formData.name, password: result.temporaryPassword });
          }
        } else {
          return;
        }
      }

      setFormData(EMPTY_FORM);
    } finally {
      setIsSavingUser(false);
    }
  };

  const openEditModal = (u, e) => {
    e.stopPropagation();
    setEditingUser(u);
    setFormData({
      ...EMPTY_FORM,
      ...u,
      adminId: u.adminId ?? '',
      supervisorId: u.supervisorId ?? '',
      supportTier: u.supportTier || '',
    });
    setShowAddModal(true);
  };

  return (
    <div id="team-view" className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <Users className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            Team & Workload Directory
          </h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Role hierarchy, team staffing allocations, reporting lines, and member status.
          </p>
        </div>

        {canManageUsers(currentUser, permissionMatrix) && (
          <button
            id="add-team-member-btn"
            onClick={() => {
              // Reset the form: it used to keep whatever user was last opened
              // with Edit, so "Add" sent that user's old avatar URL (rejected
              // by the backend) and other leftover fields.
              setEditingUser(null);
              setFormData(EMPTY_FORM);
              setPasswordError('');
              setShowPassword(false);
              setShowAddModal(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Add Team Member
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2.5 p-3 rounded-xl bg-slate-200/70 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 text-xs">
        <div className="relative min-w-[200px] max-w-xs flex-1">
          <Search className="w-4 h-4 absolute left-3 top-2 text-slate-500 dark:text-zinc-400" />
          <input
            id="team-search-input"
            type="text"
            placeholder="Search by name, email, or role..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
          />
        </div>

        <select
          id="team-role-filter"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-800 dark:text-zinc-300 focus:outline-hidden"
        >
          <option value="all">All Roles</option>
          <option value="super_admin">Super Admin</option>
          <option value="admin">Admin</option>
          <option value="supervisor">Supervisor</option>
          <option value="staff">Staff</option>
        </select>

        <select
          id="team-dept-filter"
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className="px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-800 dark:text-zinc-300 focus:outline-hidden"
        >
          <option value="all">All Departments</option>
          {/* Managed departments, plus any other value still on existing
              records (so old data stays filterable). Was a hard-coded list. */}
          {deptFilterOptions.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredUsers.map(user => {
          const userTasks = tasks.filter(t => t.assignedToId === user.id && t.status !== 'completed' && t.status !== 'closed');
          const userTickets = tickets.filter(t => t.assignedToId === user.id && t.status !== 'resolved' && t.status !== 'closed');
          const totalLoad = userTasks.length + userTickets.length;
          const supervisor = allUsers.find(u => u.id === user.supervisorId);
          const admin = allUsers.find(u => u.id === user.adminId);

          return (
            <div
              key={user.id}
              id={`user-card-${user.id}`}
              onClick={() => setSelectedMemberDetailId(user.id)}
              className={`rounded-xl border p-5 bg-slate-200/60 dark:bg-zinc-900 shadow-2xs flex flex-col justify-between transition cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-500 ${
                user.status === 'active'
                  ? 'border-slate-300 dark:border-zinc-800'
                  : 'border-slate-300 dark:border-zinc-800 opacity-60 bg-slate-200/30 dark:bg-zinc-950/50'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <img
                      src={user.avatar || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='50' fill='%23cbd5e1'/%3E%3Ccircle cx='50' cy='38' r='18' fill='%2394a3b8'/%3E%3Cellipse cx='50' cy='92' rx='34' ry='26' fill='%2394a3b8'/%3E%3C/svg%3E"}
                      alt={user.name}
                      className="w-12 h-12 rounded-full object-cover ring-2 ring-indigo-500/20"
                    />
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-1.5">
                        {user.name}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-zinc-400">{user.title}</p>
                    </div>
                  </div>

                  <RoleBadge role={user.role} size="xs" />
                </div>

                <div className="space-y-2 text-xs py-3 border-y border-slate-300/60 dark:border-zinc-800/80">
                  {user.userNumber && (
                    <div className="flex items-center justify-between text-slate-600 dark:text-zinc-400">
                      <span>User ID:</span>
                      <span className="font-mono">{user.userNumber}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-slate-600 dark:text-zinc-400">
                    <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> Email:</span>
                    <span className="font-mono">{user.email}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600 dark:text-zinc-400">
                    <span className="flex items-center gap-1.5"><Building className="w-3.5 h-3.5" /> Department:</span>
                    <span className="font-medium">
                      {user.department}
                      {user.supportTier && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold">
                          {user.supportTier}
                        </span>
                      )}
                    </span>
                  </div>
                  {supervisor && (
                    <div className="flex items-center justify-between text-slate-600 dark:text-zinc-400">
                      <span>Supervisor:</span>
                      <span className="font-medium text-slate-800 dark:text-zinc-200">{supervisor.name}</span>
                    </div>
                  )}
                  {admin && (
                    <div className="flex items-center justify-between text-slate-600 dark:text-zinc-400">
                      <span>Department Admin:</span>
                      <span className="font-medium text-slate-800 dark:text-zinc-200">{admin.name}</span>
                    </div>
                  )}
                </div>

                <div className="py-3">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-500 dark:text-zinc-400">Active Workload:</span>
                    <span className="font-semibold text-slate-800 dark:text-zinc-200">
                      {userTasks.length} tasks • {userTickets.length} tickets
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-300 dark:bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        totalLoad > 5 ? 'bg-rose-500' : totalLoad > 2 ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.min(totalLoad * 20, 100)}%` }}
                    />
                  </div>
                </div>
              </div>

              {canManageUsers(currentUser, permissionMatrix) && canManageMember(user) && (
                <div 
                  className="pt-3 border-t border-slate-300/60 dark:border-zinc-800/80 flex items-center justify-between text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={async () => {
                      // toggleUserActiveStatus (an alias for
                      // toggleUserStatus in AppContext.jsx) now only
                      // updates local state when the backend call
                      // actually succeeds — previously it was a pure
                      // local mutation with no backend call at all, so a
                      // toggle looked like it worked but reverted on the
                      // next reload. That's fixed at the source now, but
                      // this click handler still silently did nothing on
                      // failure with no feedback at all; this gives the
                      // person a reason when nothing visibly changes.
                      const result = await toggleUserActiveStatus(user.id);
                      if (!result) {
                        alert('Failed to update account status. Please try again.');
                      }
                    }}
                    className={`flex items-center gap-1 font-medium transition cursor-pointer ${
                      user.status === 'active' ? 'text-emerald-600 dark:text-emerald-400 hover:text-emerald-700' : 'text-slate-500 hover:text-slate-700 dark:text-zinc-500 dark:hover:text-zinc-300'
                    }`}
                  >
                    {user.status === 'active' ? (
                      <>
                        <CheckCircle className="w-3.5 h-3.5" /> Active Account
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-3.5 h-3.5" /> Inactive
                      </>
                    )}
                  </button>

                  <div className="flex items-center gap-1">
                    {/* Archive instead of delete (spec slides 4/29): they
                        can't sign in, their name stays on past work, and
                        they can be restored from Archive → Users. */}
                    {String(user.id) !== String(currentUser?.id) && (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!window.confirm(`Archive ${user.name}? They won't be able to sign in. Their name stays on past work, and you can restore them from Archive → Users.`)) return;
                          await archiveUser(user.id);
                        }}
                        className="p-1 rounded text-slate-500 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 flex items-center gap-1 cursor-pointer"
                        title="Archive (restorable)"
                      >
                        <Archive className="w-3.5 h-3.5" /> Archive
                      </button>
                    )}
                    <button
                      onClick={(e) => openEditModal(user, e)}
                      className="p-1 rounded text-slate-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1 cursor-pointer"
                    >
                      <Edit className="w-3.5 h-3.5" /> Edit
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selectedMember && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setSelectedMemberDetailId(null)}
        >
          <div 
            className="w-full max-w-2xl bg-slate-200 dark:bg-zinc-950 rounded-2xl shadow-2xl border border-slate-300 dark:border-zinc-800 overflow-hidden space-y-6 p-6 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-300 dark:border-zinc-800 pb-4">
              <div className="flex items-center gap-3">
                <img src={selectedMember.avatar || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='50' fill='%23cbd5e1'/%3E%3Ccircle cx='50' cy='38' r='18' fill='%2394a3b8'/%3E%3Cellipse cx='50' cy='92' rx='34' ry='26' fill='%2394a3b8'/%3E%3C/svg%3E"} alt={selectedMember.name} className="w-12 h-12 rounded-full object-cover" />
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-zinc-100">{selectedMember.name}</h3>
                  <p className="text-xs text-slate-500 dark:text-zinc-400">{selectedMember.title} • {selectedMember.department}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <RoleBadge role={selectedMember.role} />
                <button onClick={() => setSelectedMemberDetailId(null)} className="p-1 rounded-lg text-slate-500 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs bg-slate-100 dark:bg-zinc-900/60 p-4 rounded-xl border border-slate-300 dark:border-zinc-800">
              <div>
                <span className="text-slate-500 dark:text-zinc-400 block">Email Address</span>
                <span className="font-medium text-slate-800 dark:text-zinc-200">{selectedMember.email}</span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-zinc-400 block">Account Status</span>
                <span className="font-medium text-slate-800 dark:text-zinc-200 capitalize">{selectedMember.status === 'active' ? 'Active' : 'Inactive'}</span>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">Assigned Tasks ({memberTasks.length})</h4>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {memberTasks.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-zinc-500 italic">No active tasks assigned.</p>
                ) : (
                  memberTasks.map(t => (
                    <div key={t.id} className="p-2.5 rounded-lg border border-slate-300 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900/40 flex items-center justify-between text-xs">
                      <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">{t.taskNumber}</span>
                      <span className="font-medium text-slate-800 dark:text-zinc-200 truncate flex-1 mx-3">{t.title}</span>
                      <span className="text-slate-500 dark:text-zinc-400">{t.status}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">Assigned Tickets ({memberTickets.length})</h4>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {memberTickets.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-zinc-500 italic">No active tickets assigned.</p>
                ) : (
                  memberTickets.map(tk => (
                    <div key={tk.id} className="p-2.5 rounded-lg border border-slate-300 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900/40 flex items-center justify-between text-xs">
                      <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">{tk.ticketNumber}</span>
                      <span className="font-medium text-slate-800 dark:text-zinc-200 truncate flex-1 mx-3">{tk.title}</span>
                      <span className="text-slate-500 dark:text-zinc-400">{tk.status}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-300 dark:border-zinc-800">
              <button
                onClick={() => setSelectedMemberDetailId(null)}
                className="px-4 py-2 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 cursor-pointer"
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-200 dark:bg-zinc-950 rounded-2xl p-6 border border-slate-300 dark:border-zinc-800 w-full max-w-lg shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-zinc-100">
                {editingUser ? 'Edit Member Profile' : 'Add New Team Member'}
              </h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-500 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="space-y-3.5 text-xs">
              <div>
                <label className="font-semibold text-slate-700 dark:text-zinc-300 block mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full p-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-zinc-300 block mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={formData.email || ''}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 dark:text-zinc-300 block mb-1">Job Title</label>
                  <input
                    type="text"
                    required
                    value={formData.title || ''}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                  />
                </div>
              </div>

              {!editingUser && (
                <div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-semibold text-slate-700 dark:text-zinc-300 block mb-1">Password</label>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          minLength={MIN_PASSWORD_LENGTH}
                          autoComplete="new-password"
                          value={formData.password || ''}
                          onChange={(e) => { setPasswordError(''); setFormData({ ...formData, password: e.target.value }); }}
                          className="w-full p-2 pr-8 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(v => !v)}
                          className="absolute inset-y-0 right-0 px-2 flex items-center text-slate-500 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
                          title={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="font-semibold text-slate-700 dark:text-zinc-300 block mb-1">Confirm Password</label>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        autoComplete="new-password"
                        value={formData.confirmPassword || ''}
                        onChange={(e) => { setPasswordError(''); setFormData({ ...formData, confirmPassword: e.target.value }); }}
                        className="w-full p-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                      />
                    </div>
                  </div>
                  <p className={`mt-1 text-[11px] ${passwordError ? 'text-rose-500' : 'text-slate-500 dark:text-zinc-400'}`}>
                    {passwordError || `At least ${MIN_PASSWORD_LENGTH} characters. Share it with the new member directly.`}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-zinc-300 block mb-1">Role</label>
                  {/* Editable on edit too now; a change is confirmed and saved
                      through the audited role endpoint. Your own role can't be
                      changed here (the backend refuses it as well). */}
                  <select
                    value={formData.role || 'staff'}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    disabled={!!editingUser && String(editingUser.id) === String(currentUser?.id)}
                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {(customRoles && customRoles.length ? customRoles : ['super_admin', 'admin', 'supervisor', 'staff'])
                      .filter(r => r !== 'super_admin' || currentUser?.role === 'super_admin')
                      .map(r => (
                        <option key={r} value={r}>{getRoleDisplayName(r)}</option>
                      ))}
                  </select>
                  {editingUser && formData.role !== editingUser.role && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">
                      Role will change on save (you'll be asked to confirm).
                    </p>
                  )}
                </div>
                <div>
                  <label className="font-semibold text-slate-700 dark:text-zinc-300 block mb-1">Department</label>
                  {/* The managed department list (Departments view), not free text. */}
                  <select
                    value={formData.department || ''}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                  >
                    {!ownDeptOnly && (
                      formData.role === 'admin'
                        ? <option value="" disabled>Select a department…</option>
                        : <option value="">No department</option>
                    )}
                    {(departments || [])
                      .filter(d => !ownDeptOnly || d.name.trim().toLowerCase() === ownDeptOnly)
                      .map(d => (
                        <option key={d.id} value={d.name}>{d.name}</option>
                      ))}
                    {/* Keep a legacy value visible instead of silently blanking it. */}
                    {formData.department && !(departments || []).some(d => d.name === formData.department) && (
                      <option value={formData.department}>{formData.department} (not in list)</option>
                    )}
                  </select>
                  {isSupportDept(formData.department) && (
                    <div className="mt-2">
                      <label className="font-semibold text-slate-700 dark:text-zinc-300 block mb-1">Support Tier</label>
                      <select
                        value={formData.supportTier || ''}
                        onChange={(e) => setFormData({ ...formData, supportTier: e.target.value })}
                        className="w-full p-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                      >
                        <option value="">No tier</option>
                        {SUPPORT_TIERS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-zinc-300 block mb-1">Assign to Admin</label>
                  <select
                    value={formData.adminId || ''}
                    onChange={(e) => setFormData({ ...formData, adminId: e.target.value })}
                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                  >
                    <option value="">None</option>
                    {admins.map(a => (
                      <option key={a.id} value={a.id}>{a.name} ({a.department})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 dark:text-zinc-300 block mb-1">Assign to Supervisor</label>
                  <select
                    value={formData.supervisorId || ''}
                    onChange={(e) => setFormData({ ...formData, supervisorId: e.target.value })}
                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                  >
                    <option value="">None</option>
                    {supervisors.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.department})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-2 justify-end items-center pt-3 border-t border-slate-300 dark:border-zinc-800">
                {editingUser && canResetPassword(editingUser) && (
                  <button
                    type="button"
                    onClick={() => openReset(editingUser)}
                    className="mr-auto flex items-center gap-1.5 px-3 py-2 rounded-lg text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-950/40 cursor-pointer"
                  >
                    <KeyRound className="w-4 h-4" /> Reset Password
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-lg text-slate-700 dark:text-zinc-300 hover:bg-slate-300/60 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingUser}
                  className="px-4 py-2 rounded-lg font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white shadow-xs cursor-pointer"
                >
                  {isSavingUser ? 'Saving...' : (editingUser ? 'Save Changes' : 'Create User')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {resetFor && (
        <div
          className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => !isResetting && setResetFor(null)}
        >
          <div
            className="bg-slate-200 dark:bg-zinc-950 rounded-2xl p-6 border border-slate-300 dark:border-zinc-800 w-full max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-amber-500" /> Reset Password
              </h3>
              <button
                type="button"
                onClick={() => setResetFor(null)}
                disabled={isResetting}
                className="text-slate-500 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-600 dark:text-zinc-400 mb-4">
              New password for <span className="font-semibold">{resetFor.name}</span>. They will be signed out
              everywhere and must log in with this password.
            </p>
            <form onSubmit={handleResetPassword} className="space-y-3 text-xs">
              {[
                ['password', 'showPassword', 'New Password', 'new-password'],
                ['confirm', 'showConfirm', 'Confirm New Password', 'new-password'],
              ].map(([field, showKey, label, ac]) => (
                <div key={field}>
                  <label className="font-semibold text-slate-700 dark:text-zinc-300 block mb-1">{label}</label>
                  <div className="relative">
                    <input
                      type={resetForm[showKey] ? 'text' : 'password'}
                      required
                      autoComplete={ac}
                      autoFocus={field === 'password'}
                      value={resetForm[field]}
                      onChange={(e) => { setResetError(''); setResetForm(f => ({ ...f, [field]: e.target.value })); }}
                      className="w-full p-2 pr-9 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                    />
                    <button
                      type="button"
                      onClick={() => setResetForm(f => ({ ...f, [showKey]: !f[showKey] }))}
                      title={resetForm[showKey] ? 'Hide password' : 'Show password'}
                      aria-label={resetForm[showKey] ? 'Hide password' : 'Show password'}
                      className="absolute inset-y-0 right-0 px-2.5 flex items-center text-slate-500 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-200 cursor-pointer"
                    >
                      {resetForm[showKey] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              ))}
              <p className={`text-[11px] ${resetError ? 'text-rose-500' : 'text-slate-500 dark:text-zinc-400'}`}>
                {resetError || `At least ${MIN_PASSWORD_LENGTH} characters.`}
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setResetFor(null)}
                  disabled={isResetting}
                  className="px-4 py-2 rounded-lg text-slate-700 dark:text-zinc-300 hover:bg-slate-300/60 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isResetting}
                  className="px-4 py-2 rounded-lg font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white cursor-pointer"
                >
                  {isResetting ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {resetDoneFor && (
        <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4" onClick={() => setResetDoneFor(null)}>
          <div className="bg-slate-200 dark:bg-zinc-950 rounded-2xl p-6 border border-slate-300 dark:border-zinc-800 w-full max-w-sm shadow-2xl space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-500" />
              <h3 className="text-base font-bold text-slate-900 dark:text-zinc-100">Password updated</h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-zinc-400">
              {resetDoneFor} has been signed out and can now log in with the new password. Share it with them directly.
            </p>
            <div className="flex justify-end">
              <button onClick={() => setResetDoneFor(null)} className="px-4 py-2 rounded-lg font-semibold bg-indigo-600 hover:bg-indigo-700 text-white text-xs cursor-pointer">
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {tempPasswordBanner && (
        <div className="fixed inset-0 z-60 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-200 dark:bg-zinc-950 rounded-2xl p-6 border border-slate-300 dark:border-zinc-800 w-full max-w-md shadow-2xl space-y-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-500" />
              <h3 className="text-base font-bold text-slate-900 dark:text-zinc-100">
                {tempPasswordBanner.name} was created
              </h3>
            </div>
            <p className="text-xs text-slate-600 dark:text-zinc-400">
              Share this temporary password with them directly — it will not be shown again.
            </p>
            <div className="flex items-center justify-between gap-2 p-3 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 font-mono text-sm text-slate-900 dark:text-zinc-100">
              <span className="select-all">{tempPasswordBanner.password}</span>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(tempPasswordBanner.password)}
                className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
              >
                Copy
              </button>
            </div>
            <div className="flex justify-end pt-2 border-t border-slate-300 dark:border-zinc-800">
              <button
                onClick={() => setTempPasswordBanner(null)}
                className="px-4 py-2 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};