import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  FolderKanban, Plus, Search, Filter, Download, Pin, Star, 
  Calendar, Clock, Users, ArrowUpRight, Grid, List as ListIcon, CheckCircle2
} from 'lucide-react';
import { PriorityBadge, ProjectStatusBadge } from '../common/Badge';
import { canCreateProject } from '../../utils/permissions';
import { exportProjectsToCSV } from '../../utils/exportUtils';
import { ProjectDetailModal } from './ProjectDetailModal';

export const ProjectsView = () => {
  const { 
    visibleProjects, 
    allUsers, 
    currentUser, 
    togglePinProject, 
    setSelectedProjectDetailId,
    setQuickCreateOpen
  } = useApp();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [viewMode, setViewMode] = useState('grid');

  const filteredProjects = useMemo(() => {
    return visibleProjects.filter(p => {
      const matchSearch = p.title.toLowerCase().includes(search.toLowerCase()) || 
                          p.code.toLowerCase().includes(search.toLowerCase()) ||
                          p.description.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === 'all' || p.status === statusFilter;
      const matchDept = deptFilter === 'all' || p.department === deptFilter;
      return matchSearch && matchStatus && matchDept;
    });
  }, [visibleProjects, search, statusFilter, deptFilter]);

  const handleExport = () => {
    exportProjectsToCSV(filteredProjects, allUsers);
  };

  return (
    <div id="projects-view" className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <FolderKanban className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            Project Management
          </h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Track strategic initiatives, resource budgets, and department deliverables.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="export-projects-csv-btn"
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-zinc-800 bg-slate-200/60 dark:bg-zinc-900 text-slate-800 dark:text-zinc-300 hover:bg-slate-300/80 dark:hover:bg-zinc-800 transition cursor-pointer"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>

          {canCreateProject(currentUser) && (
            <button
              id="create-new-project-btn"
              onClick={() => setQuickCreateOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              New Project
            </button>
          )}
        </div>
      </div>

      {/* Filters & Search Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 rounded-xl bg-slate-200/70 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500 dark:text-zinc-400" />
            <input
              id="projects-search-input"
              type="text"
              placeholder="Search projects by title or code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-900 dark:text-zinc-100 placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Department Filter */}
          <select
            id="projects-dept-filter"
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-800 dark:text-zinc-300 focus:outline-hidden"
          >
            <option value="all">All Departments</option>
            <option value="Engineering">Engineering</option>
            <option value="Customer Success">Customer Success</option>
            <option value="Product & Design">Product & Design</option>
            <option value="Marketing & Growth">Marketing & Growth</option>
            <option value="Operations">Operations</option>
          </select>

          {/* Status Filter */}
          <select
            id="projects-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-800/80 text-slate-800 dark:text-zinc-300 focus:outline-hidden"
          >
            <option value="all">All Statuses</option>
            <option value="planning">Planning</option>
            <option value="active">Active</option>
            <option value="on_hold">On Hold</option>
            <option value="completed">Completed</option>
          </select>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center gap-1 border border-slate-300 dark:border-zinc-700 rounded-lg p-0.5 bg-slate-100 dark:bg-zinc-800/80 shrink-0">
          <button
            id="view-mode-grid-btn"
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded-md cursor-pointer ${viewMode === 'grid' ? 'bg-slate-200 dark:bg-zinc-700 shadow-2xs text-indigo-600 dark:text-indigo-300' : 'text-slate-500 dark:text-zinc-400'}`}
            title="Grid View"
          >
            <Grid className="w-3.5 h-3.5" />
          </button>
          <button
            id="view-mode-table-btn"
            onClick={() => setViewMode('table')}
            className={`p-1.5 rounded-md cursor-pointer ${viewMode === 'table' ? 'bg-slate-200 dark:bg-zinc-700 shadow-2xs text-indigo-600 dark:text-indigo-300' : 'text-slate-500 dark:text-zinc-400'}`}
            title="Table View"
          >
            <ListIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Projects Display */}
      {filteredProjects.length === 0 ? (
        <div className="py-16 text-center bg-slate-200/60 dark:bg-zinc-900 rounded-xl border border-slate-300 dark:border-zinc-800 p-8">
          <FolderKanban className="w-12 h-12 mx-auto mb-3 text-slate-400 dark:text-zinc-700" />
          <p className="text-sm font-semibold text-slate-800 dark:text-zinc-300">No matching projects found</p>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">Adjust your search parameters or check your role's access permissions.</p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredProjects.map(project => {
            const owner = allUsers.find(u => u.id === project.ownerId);
            const members = allUsers.filter(u => project.memberIds?.includes(u.id));

            return (
              <div
                key={project.id}
                id={`project-card-${project.id}`}
                onClick={() => setSelectedProjectDetailId(project.id)}
                className="rounded-xl bg-slate-200/60 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-800 hover:border-indigo-400 dark:hover:border-indigo-500 p-5 shadow-2xs hover:shadow-md transition-all flex flex-col justify-between cursor-pointer group"
              >
                <div>
                  {/* Card Header */}
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/80 text-indigo-800 dark:text-indigo-300">
                      {project.code}
                    </span>
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => togglePinProject(project.id)}
                        className={`p-1 rounded-md transition cursor-pointer ${
                          project.isPinned ? 'text-amber-500 hover:text-amber-600' : 'text-slate-400 dark:text-zinc-600 hover:text-slate-600 dark:hover:text-zinc-400'
                        }`}
                        title="Pin Project"
                      >
                        <Pin className="w-3.5 h-3.5 fill-current" />
                      </button>
                      <ProjectStatusBadge status={project.status} />
                    </div>
                  </div>

                  {/* Title & Desc */}
                  <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition line-clamp-1 mb-1.5">
                    {project.title}
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-zinc-400 line-clamp-2 leading-relaxed mb-4">
                    {project.description}
                  </p>
                </div>

                <div>
                  {/* Progress Meter */}
                  <div className="space-y-1.5 mb-4">
                    <div className="flex items-center justify-between text-[11px] font-medium text-slate-600 dark:text-zinc-400">
                      <span>Progress</span>
                      <span className="font-mono">{project.progress}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-300 dark:bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-600 rounded-full"
                        style={{ width: `${project.progress}%` }}
                      />
                    </div>
                  </div>

                  {/* Footer Meta */}
                  <div className="pt-3 border-t border-slate-300/60 dark:border-zinc-800/80 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 text-slate-500 dark:text-zinc-400">
                      <Calendar className="w-3.5 h-3.5" />
                      <span className="text-[11px]">{project.dueDate}</span>
                    </div>

                    {/* Member Avatars Stack */}
                    <div className="flex -space-x-1.5 overflow-hidden">
                      {members.slice(0, 3).map(m => (
                        <img
                          key={m.id}
                          src={m.avatar}
                          alt={m.name}
                          title={m.name}
                          className="w-5 h-5 rounded-full object-cover ring-1 ring-slate-200 dark:ring-zinc-900"
                        />
                      ))}
                      {members.length > 3 && (
                        <span className="w-5 h-5 rounded-full bg-slate-300 dark:bg-zinc-800 text-[10px] font-semibold flex items-center justify-center text-slate-700 dark:text-zinc-300 ring-1 ring-slate-200 dark:ring-zinc-900">
                          +{members.length - 3}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Table View */
        <div className="bg-slate-200/60 dark:bg-zinc-900 rounded-xl border border-slate-300 dark:border-zinc-800 overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-300/40 dark:bg-zinc-800/60 border-b border-slate-300 dark:border-zinc-800 text-slate-600 dark:text-zinc-400 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="p-3.5">Code</th>
                  <th className="p-3.5">Project Title</th>
                  <th className="p-3.5">Department</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5">Priority</th>
                  <th className="p-3.5">Progress</th>
                  <th className="p-3.5">Due Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-300/50 dark:divide-zinc-800/60 text-slate-800 dark:text-zinc-300">
                {filteredProjects.map(p => (
                  <tr
                    key={p.id}
                    onClick={() => setSelectedProjectDetailId(p.id)}
                    className="hover:bg-slate-300/50 dark:hover:bg-zinc-800/50 cursor-pointer transition"
                  >
                    <td className="p-3.5 font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                      {p.code}
                    </td>
                    <td className="p-3.5 font-semibold text-slate-900 dark:text-zinc-100">
                      {p.title}
                    </td>
                    <td className="p-3.5">{p.department}</td>
                    <td className="p-3.5"><ProjectStatusBadge status={p.status} /></td>
                    <td className="p-3.5"><PriorityBadge priority={p.priority} /></td>
                    <td className="p-3.5 font-mono">{p.progress}%</td>
                    <td className="p-3.5">{p.dueDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Project Detail Slide-over / Modal */}
      <ProjectDetailModal />
    </div>
  );
};