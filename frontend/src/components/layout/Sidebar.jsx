import React from 'react';
import { useApp } from '../../context/AppContext';
import { 
  LayoutDashboard, 
  FolderKanban, 
  Columns3, 
  CheckSquare, 
  LifeBuoy, 
  Users, 
  BarChart3, 
  ScrollText, 
  Settings, 
  Pin,
  Layers,
  Plus,
  UserCircle,
  Building2,
  Network
} from 'lucide-react';
// canManageDepartments: same unverified-import note as DepartmentsView.jsx —
// I don't have the current permissions.js in this session, so this mirrors
// canManageClients's established shape under that name.
import { canViewAuditLogs, canManageMatrixPermissions, canManageDepartments } from '../../utils/permissions';
import { RoleBadge } from '../common/Badge';

export const Sidebar = () => {
  const { 
    activeTab, 
    setActiveTab, 
    currentUser, 
    visibleProjects, 
    visibleFeasibilities,
    setSelectedProjectDetailId,
    visibleTasks,
    visibleTickets,
    permissionMatrix,
    setQuickCreatePickerOpen
  } = useApp();

  const pinnedProjects = visibleProjects.filter(p => p.isPinned);
  const pendingTasksCount = visibleTasks.filter(t => t.status !== 'completed' && t.status !== 'closed').length;
  const openTicketsCount = visibleTickets.filter(t => t.status !== 'resolved' && t.status !== 'closed').length;

  const settingsRestricted = currentUser.role === 'admin' && !canManageMatrixPermissions(currentUser, permissionMatrix);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'projects', label: 'Projects', icon: FolderKanban, badge: visibleProjects.length },
    { id: 'kanban', label: 'Kanban Board', icon: Columns3 },
    { id: 'tasks', label: 'Task Management', icon: CheckSquare, badge: pendingTasksCount },
    { id: 'tickets', label: 'Tickets Desk', icon: LifeBuoy, badge: openTicketsCount },
    { id: 'feasibilities', label: 'Feasibilities', icon: Network, badge: visibleFeasibilities?.length },
    { id: 'clients', label: 'Clients', icon: Building2 },
    // New — the spec lists Departments as its own module (slide 32), and
    // it didn't exist in this app's navigation at all until now. Viewable
    // by anyone the same way Clients is; DepartmentsView.jsx itself hides
    // the create/edit/delete controls from non-managers, but the nav entry
    // is restricted too since a plain read-only list of departments isn't
    // day-to-day relevant for staff the way Clients is.
    { id: 'departments', label: 'Departments', icon: Building2, restricted: !canManageDepartments(currentUser, permissionMatrix) },
    { id: 'team', label: 'Team & Workload', icon: Users },
    { id: 'reports', label: 'Reports & SLA', icon: BarChart3 },
    { id: 'audit', label: 'System Audit Logs', icon: ScrollText, restricted: !canViewAuditLogs(currentUser, permissionMatrix) },
    { id: 'settings', label: 'Settings & Matrix', icon: Settings, restricted: settingsRestricted },
    { id: 'profile', label: 'My Profile', icon: UserCircle },
  ];

  return (
    <aside 
      id="app-sidebar"
      className="w-64 shrink-0 bg-slate-200/80 dark:bg-black text-slate-700 dark:text-zinc-300 border-r border-slate-300 dark:border-zinc-800 flex flex-col h-screen select-none transition-colors duration-200"
    >
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-between px-5 border-b border-slate-300 dark:border-zinc-800/80 bg-slate-300/40 dark:bg-zinc-950/40">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-400 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 ring-1 ring-indigo-400/30">
            <Layers className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight truncate flex items-center gap-1.5">
              APEX CORE
            </h1>
            <span className="text-[10px] text-slate-500 dark:text-zinc-400 font-medium tracking-wide uppercase block truncate">
              Project & Ticket System
            </span>
          </div>
        </div>
        {/* Quick Create Action Button — was silently a no-op: it called
            onOpenQuickCreate, a prop App.jsx never actually passed to
            this component. Now uses the same context-driven type picker
            Navbar's button opens, no prop plumbing needed. */}
        <button
          onClick={() => setQuickCreatePickerOpen(true)}
          className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition shadow-sm cursor-pointer"
          title="Quick Create"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Current Active User Banner (Clickable to Profile) */}
      <button
        onClick={() => setActiveTab('profile')}
        className="w-full text-left px-4 py-3 bg-slate-300/30 dark:bg-zinc-950/30 border-b border-slate-300 dark:border-zinc-800/60 hover:bg-slate-300/70 dark:hover:bg-zinc-900/60 transition group cursor-pointer"
        title="View & Edit Profile"
      >
        <div className="flex items-center gap-2.5">
          <img
            src={currentUser.avatar || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='50' fill='%23cbd5e1'/%3E%3Ccircle cx='50' cy='38' r='18' fill='%2394a3b8'/%3E%3Cellipse cx='50' cy='92' rx='34' ry='26' fill='%2394a3b8'/%3E%3C/svg%3E"}
            alt={currentUser.name}
            className="w-8 h-8 rounded-full object-cover ring-1 ring-indigo-500/50 group-hover:ring-indigo-400 transition"
          />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition">
              {currentUser.name}
            </div>
            <div className="mt-0.5">
              <RoleBadge role={currentUser.role} size="xs" />
            </div>
          </div>
        </div>
      </button>

      {/* Nav List */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        <div className="px-3 pb-1.5 text-[11px] font-semibold text-slate-500 dark:text-zinc-500 uppercase tracking-wider">
          Main Modules
        </div>

        {navItems.map(item => {
          if (item.restricted) return null;
          const Icon = item.icon;
          const isActive = activeTab === item.id;

          return (
            <button
              key={item.id}
              id={`nav-item-${item.id}`}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all group cursor-pointer ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-slate-300/60 dark:hover:bg-zinc-900/60'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-500 dark:text-zinc-400 group-hover:text-slate-900 dark:group-hover:text-zinc-200'}`} />
                <span>{item.label}</span>
              </div>
              {item.badge !== undefined && item.badge > 0 && (
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                    isActive
                      ? 'bg-indigo-800 text-white'
                      : 'bg-slate-300 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 group-hover:text-slate-900 dark:group-hover:text-zinc-100'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}

        {/* Pinned Projects Section */}
        {pinnedProjects.length > 0 && (
          <div className="pt-5">
            <div className="px-3 pb-1.5 flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-zinc-500 uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <Pin className="w-3 h-3 text-amber-500 dark:text-amber-400" />
                Pinned Projects
              </span>
              <span className="text-[10px] text-slate-500 dark:text-zinc-500">{pinnedProjects.length}</span>
            </div>

            <div className="space-y-0.5 mt-1">
              {pinnedProjects.map(prj => (
                <button
                  key={prj.id}
                  id={`pinned-project-${prj.id}`}
                  onClick={() => {
                    setSelectedProjectDetailId(prj.id);
                    setActiveTab('projects');
                  }}
                  className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-slate-300/50 dark:hover:bg-zinc-900/50 text-left transition group cursor-pointer"
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 dark:bg-indigo-400"></span>
                    <span className="truncate">{prj.title}</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500 dark:text-zinc-500">{prj.progress}%</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer / System Status */}
      <div className="p-3 border-t border-slate-300 dark:border-zinc-800/80 bg-slate-300/40 dark:bg-zinc-950/40">
        <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-zinc-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse"></span>
            System Live (v3.2)
          </span>
          <span className="font-mono text-[10px]">
            <span className="font-mono text-[10px]">
  {(currentUser?.department || currentUser?.role || 'GEN').substring(0, 4).toUpperCase()}
</span>
          </span>
        </div>
      </div>
    </aside>
  );
};