import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  Users, Plus, Search, Shield, UserCheck, Mail, Building, 
  CheckCircle, AlertCircle, Edit, ToggleLeft, ToggleRight, X, Phone
} from 'lucide-react';
import { RoleBadge } from '../common/Badge';
import { canManageUsers } from '../../utils/permissions';

export const TeamView = () => {
  const { 
    allUsers, 
    currentUser, 
    tasks, 
    tickets, 
    toggleUserActiveStatus, 
    createUser, 
    updateUser 
  } = useApp();

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [editingUser, setEditingUser] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedMemberDetailId, setSelectedMemberDetailId] = useState(null);

  // New user form state
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    role: 'staff',
    department: 'Engineering',
    title: '',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    adminId: '',
    supervisorId: ''
  });

  const admins = allUsers.filter(u => u.role === 'admin');
  const supervisors = allUsers.filter(u => u.role === 'supervisor');

  const filteredUsers = allUsers.filter(u => {
    const matchSearch = u.name.toLowerCase().includes(search.toLowerCase()) ||
                        u.email.toLowerCase().includes(search.toLowerCase()) ||
                        u.title.toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === 'all' || u.role === roleFilter;
    const matchDept = deptFilter === 'all' || u.department === deptFilter;
    return matchSearch && matchRole && matchDept;
  });

  const selectedMember = allUsers.find(u => u.id === selectedMemberDetailId);
  const memberTasks = tasks.filter(t => t.assignedToId === selectedMemberDetailId);
  const memberTickets = tickets.filter(t => t.assignedToId === selectedMemberDetailId);

  const handleSaveUser = (e) => {
    e.preventDefault();
    if (!formData.name || !formData.email) return;

    if (editingUser) {
      updateUser(editingUser.id, formData);
      setEditingUser(null);
    } else {
      createUser(formData);
      setShowAddModal(false);
    }

    setFormData({
      name: '',
      email: '',
      role: 'staff',
      department: 'Engineering',
      title: '',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      adminId: '',
      supervisorId: ''
    });
  };

  const openEditModal = (u, e) => {
    e.stopPropagation();
    setEditingUser(u);
    setFormData(u);
    setShowAddModal(true);
  };

  return (
    <div id="team-view" className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header */}
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

        {canManageUsers(currentUser) && (
          <button
            id="add-team-member-btn"
            onClick={() => {
              setEditingUser(null);
              setShowAddModal(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Add Team Member
          </button>
        )}
      </div>

      {/* Filter Bar */}
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
          <option value="Executive Management">Executive Management</option>
          <option value="Engineering">Engineering</option>
          <option value="Customer Success">Customer Success</option>
          <option value="Product & Design">Product & Design</option>
        </select>
      </div>

      {/* User Cards Grid */}
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
                user.isActive
                  ? 'border-slate-300 dark:border-zinc-800'
                  : 'border-slate-300 dark:border-zinc-800 opacity-60 bg-slate-200/30 dark:bg-zinc-950/50'
              }`}
            >
              <div>
                {/* Header Profile */}
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <img
                      src={user.avatar}
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

                {/* Info Details */}
                <div className="space-y-2 text-xs py-3 border-y border-slate-300/60 dark:border-zinc-800/80">
                  <div className="flex items-center justify-between text-slate-600 dark:text-zinc-400">
                    <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> Email:</span>
                    <span className="font-mono">{user.email}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600 dark:text-zinc-400">
                    <span className="flex items-center gap-1.5"><Building className="w-3.5 h-3.5" /> Department:</span>
                    <span className="font-medium">{user.department}</span>
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

                {/* Workload Indicator */}
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

              {/* Card Actions */}
              {canManageUsers(currentUser) && (
                <div 
                  className="pt-3 border-t border-slate-300/60 dark:border-zinc-800/80 flex items-center justify-between text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => toggleUserActiveStatus(user.id)}
                    className={`flex items-center gap-1 font-medium transition cursor-pointer ${
                      user.isActive ? 'text-emerald-600 dark:text-emerald-400 hover:text-emerald-700' : 'text-slate-500 hover:text-slate-700 dark:text-zinc-500 dark:hover:text-zinc-300'
                    }`}
                  >
                    {user.isActive ? (
                      <>
                        <CheckCircle className="w-3.5 h-3.5" /> Active Account
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-3.5 h-3.5" /> Inactive
                      </>
                    )}
                  </button>

                  <button
                    onClick={(e) => openEditModal(user, e)}
                    className="p-1 rounded text-slate-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1 cursor-pointer"
                  >
                    <Edit className="w-3.5 h-3.5" /> Edit
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Full Team Member Details Modal */}
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
                <img src={selectedMember.avatar} alt={selectedMember.name} className="w-12 h-12 rounded-full object-cover" />
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
                <span className="font-medium text-slate-800 dark:text-zinc-200 capitalize">{selectedMember.isActive ? 'Active' : 'Inactive'}</span>
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

      {/* Add / Edit User Modal */}
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-zinc-300 block mb-1">Role</label>
                  <select
                    value={formData.role || 'staff'}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                  >
                    <option value="super_admin">Super Admin</option>
                    <option value="admin">Admin</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="staff">Staff</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 dark:text-zinc-300 block mb-1">Department</label>
                  <input
                    type="text"
                    value={formData.department || ''}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 focus:outline-hidden"
                  />
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

              <div className="flex gap-2 justify-end pt-3 border-t border-slate-300 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-lg text-slate-700 dark:text-zinc-300 hover:bg-slate-300/60 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs cursor-pointer"
                >
                  {editingUser ? 'Save Changes' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};