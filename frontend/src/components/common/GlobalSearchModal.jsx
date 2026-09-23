import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Search, FolderKanban, CheckSquare, LifeBuoy, Users, ArrowRight, X } from 'lucide-react';
import { PriorityBadge, TaskStatusBadge, TicketStatusBadge, RoleBadge } from './Badge';

export const GlobalSearchModal = () => {
  const { 
    globalSearchOpen, 
    setGlobalSearchOpen, 
    visibleProjects, 
    visibleTasks, 
    visibleTickets, 
    allUsers,
    setSelectedTaskId,
    setSelectedTicketId,
    setSelectedProjectDetailId,
    setActiveTab
  } = useApp();

  const [query, setQuery] = useState('');

  // Keyboard shortcut Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setGlobalSearchOpen(true);
      }
      if (e.key === 'Escape' && globalSearchOpen) {
        setGlobalSearchOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [globalSearchOpen, setGlobalSearchOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { projects: [], tasks: [], tickets: [], users: [] };

    return {
      projects: visibleProjects.filter(p => 
        p.title.toLowerCase().includes(q) || 
        p.code.toLowerCase().includes(q) ||
        p.department.toLowerCase().includes(q)
      ).slice(0, 3),
      tasks: visibleTasks.filter(t => 
        t.title.toLowerCase().includes(q) || 
        t.taskNumber.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.labels.some(l => l.toLowerCase().includes(q))
      ).slice(0, 4),
      tickets: visibleTickets.filter(t => 
        t.title.toLowerCase().includes(q) || 
        t.ticketNumber.toLowerCase().includes(q) ||
        t.requesterName.toLowerCase().includes(q) ||
        t.requesterCompany?.toLowerCase().includes(q)
      ).slice(0, 4),
      users: allUsers.filter(u => 
        u.name.toLowerCase().includes(q) || 
        u.email.toLowerCase().includes(q) ||
        u.title.toLowerCase().includes(q) ||
        u.department.toLowerCase().includes(q)
      ).slice(0, 3)
    };
  }, [query, visibleProjects, visibleTasks, visibleTickets, allUsers]);

  if (!globalSearchOpen) return null;

  const hasResults = 
    filtered.projects.length > 0 || 
    filtered.tasks.length > 0 || 
    filtered.tickets.length > 0 || 
    filtered.users.length > 0;

  return (
    <div 
      id="global-search-modal-backdrop" 
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/60 backdrop-blur-xs p-4"
      onClick={() => setGlobalSearchOpen(false)}
    >
      <div 
        id="global-search-modal-container"
        className="w-full max-w-2xl bg-slate-200 dark:bg-zinc-950 rounded-xl shadow-2xl border border-slate-300 dark:border-zinc-800 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Bar Input */}
        <div className="flex items-center px-4 py-3.5 border-b border-slate-300 dark:border-zinc-800">
          <Search className="w-5 h-5 text-slate-500 dark:text-zinc-400 mr-3 shrink-0" />
          <input
            id="global-search-input"
            autoFocus
            type="text"
            placeholder="Search projects, tasks, tickets, staff, or labels... (ESC to exit)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-slate-900 dark:text-zinc-100 placeholder-slate-500 dark:placeholder-zinc-500 focus:outline-hidden text-base"
          />
          {query && (
            <button 
              id="clear-search-btn"
              onClick={() => setQuery('')}
              className="text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 p-1 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Results Area */}
        <div className="max-h-[60vh] overflow-y-auto p-4 space-y-6">
          {!query ? (
            <div className="py-8 text-center text-slate-500 dark:text-zinc-400">
              <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Type keywords to search across all records visible to your role.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs font-medium text-slate-600 dark:text-zinc-400">
                <span className="px-2 py-1 rounded bg-slate-300/60 dark:bg-zinc-800">Projects</span>
                <span className="px-2 py-1 rounded bg-slate-300/60 dark:bg-zinc-800">Tasks</span>
                <span className="px-2 py-1 rounded bg-slate-300/60 dark:bg-zinc-800">Tickets</span>
                <span className="px-2 py-1 rounded bg-slate-300/60 dark:bg-zinc-800">Employees</span>
              </div>
            </div>
          ) : !hasResults ? (
            <div className="py-8 text-center text-slate-500 dark:text-zinc-400">
              <p className="text-sm">No records found matching "{query}".</p>
              <p className="text-xs mt-1 text-slate-500 dark:text-zinc-500">Ensure the requested item is within your role's visibility scope.</p>
            </div>
          ) : (
            <>
              {/* Tasks */}
              {filtered.tasks.length > 0 && (
                <div>
                  <div className="flex items-center text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                    <CheckSquare className="w-3.5 h-3.5 mr-1.5" />
                    Tasks ({filtered.tasks.length})
                  </div>
                  <div className="space-y-1.5">
                    {filtered.tasks.map(t => (
                      <div
                        key={t.id}
                        id={`search-item-task-${t.id}`}
                        onClick={() => {
                          setSelectedTaskId(t.id);
                          setGlobalSearchOpen(false);
                        }}
                        className="flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-300/50 dark:hover:bg-zinc-900 cursor-pointer border border-transparent hover:border-slate-300 dark:hover:border-zinc-800 transition"
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-xs font-semibold text-indigo-600 dark:text-indigo-400">{t.taskNumber}</span>
                          <span className="text-sm font-medium text-slate-900 dark:text-zinc-100">{t.title}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <TaskStatusBadge status={t.status} />
                          <PriorityBadge priority={t.priority} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tickets */}
              {filtered.tickets.length > 0 && (
                <div>
                  <div className="flex items-center text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                    <LifeBuoy className="w-3.5 h-3.5 mr-1.5" />
                    Tickets ({filtered.tickets.length})
                  </div>
                  <div className="space-y-1.5">
                    {filtered.tickets.map(t => (
                      <div
                        key={t.id}
                        id={`search-item-ticket-${t.id}`}
                        onClick={() => {
                          setSelectedTicketId(t.id);
                          setGlobalSearchOpen(false);
                        }}
                        className="flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-300/50 dark:hover:bg-zinc-900 cursor-pointer border border-transparent hover:border-slate-300 dark:hover:border-zinc-800 transition"
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-xs font-semibold text-amber-600 dark:text-amber-400">{t.ticketNumber}</span>
                          <div>
                            <span className="text-sm font-medium text-slate-900 dark:text-zinc-100">{t.title}</span>
                            <span className="text-xs text-slate-500 dark:text-zinc-400 block">{t.requesterCompany || t.requesterName}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <TicketStatusBadge status={t.status} />
                          <PriorityBadge priority={t.priority} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Projects */}
              {filtered.projects.length > 0 && (
                <div>
                  <div className="flex items-center text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                    <FolderKanban className="w-3.5 h-3.5 mr-1.5" />
                    Projects ({filtered.projects.length})
                  </div>
                  <div className="space-y-1.5">
                    {filtered.projects.map(p => (
                      <div
                        key={p.id}
                        id={`search-item-project-${p.id}`}
                        onClick={() => {
                          setSelectedProjectDetailId(p.id);
                          setGlobalSearchOpen(false);
                        }}
                        className="flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-300/50 dark:hover:bg-zinc-900 cursor-pointer border border-transparent hover:border-slate-300 dark:hover:border-zinc-800 transition"
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">{p.code}</span>
                          <span className="text-sm font-medium text-slate-900 dark:text-zinc-100">{p.title}</span>
                        </div>
                        <div className="text-xs text-slate-500 dark:text-zinc-400">
                          {p.department}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Users */}
              {filtered.users.length > 0 && (
                <div>
                  <div className="flex items-center text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                    <Users className="w-3.5 h-3.5 mr-1.5" />
                    Team & Users ({filtered.users.length})
                  </div>
                  <div className="space-y-1.5">
                    {filtered.users.map(u => (
                      <div
                        key={u.id}
                        id={`search-item-user-${u.id}`}
                        onClick={() => {
                          setActiveTab('team');
                          setGlobalSearchOpen(false);
                        }}
                        className="flex items-center justify-between p-2.5 rounded-lg hover:bg-slate-300/50 dark:hover:bg-zinc-900 cursor-pointer border border-transparent hover:border-slate-300 dark:hover:border-zinc-800 transition"
                      >
                        <div className="flex items-center gap-3">
                          <img src={u.avatar || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='50' fill='%23cbd5e1'/%3E%3Ccircle cx='50' cy='38' r='18' fill='%2394a3b8'/%3E%3Cellipse cx='50' cy='92' rx='34' ry='26' fill='%2394a3b8'/%3E%3C/svg%3E"} alt={u.name} className="w-7 h-7 rounded-full object-cover" />
                          <div>
                            <span className="text-sm font-medium text-slate-900 dark:text-zinc-100 block">{u.name}</span>
                            <span className="text-xs text-slate-500 dark:text-zinc-400">{u.title} • {u.department}</span>
                          </div>
                        </div>
                        <RoleBadge role={u.role} size="xs" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="px-4 py-2.5 bg-slate-300/40 dark:bg-zinc-950 border-t border-slate-300 dark:border-zinc-800 flex items-center justify-between text-xs text-slate-500 dark:text-zinc-400">
          <div className="flex items-center gap-3">
            <span><kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 font-mono text-slate-700 dark:text-zinc-300">ESC</kbd> to close</span>
            <span><kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 font-mono text-slate-700 dark:text-zinc-300">↵</kbd> to select</span>
          </div>
          <span>Role Scope: Active</span>
        </div>
      </div>
    </div>
  );
};