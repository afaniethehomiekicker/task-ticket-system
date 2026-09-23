import React from 'react';
import { useApp } from '../../context/AppContext';
import { FolderKanban, CheckSquare, LifeBuoy, Building2, X } from 'lucide-react';

// The four options here MUST match a real tab QuickCreateModal knows how
// to render. Picking one calls openQuickCreate({ tab, restrictToTab: true
// }) — the same restricted-tab mechanism every other entry point into
// QuickCreateModal already uses, so this never introduces a way to
// switch tabs inside an already-open modal.
const QUICK_CREATE_TYPES = [
  { tab: 'project', label: 'General Project', description: 'Start a program of work under a client.', icon: FolderKanban, color: 'text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-950/50', projectType: 'general' },
  { tab: 'project', label: 'Support / TT', description: 'A support/TT project (no budget tracking).', icon: LifeBuoy, color: 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/50', projectType: 'ticketing' },
  { tab: 'task', label: 'New Task', description: 'A unit of work assigned to someone.', icon: CheckSquare, color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950/50' },
  { tab: 'ticket', label: 'New Ticket', description: 'A customer support request.', icon: LifeBuoy, color: 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/50' },
  { tab: 'client', label: 'New Client', description: 'A company profile projects can be built under.', icon: Building2, color: 'text-purple-600 dark:text-purple-400 bg-purple-100 dark:bg-purple-950/50' },
];

export const QuickCreateTypePicker = () => {
  const { quickCreatePickerOpen, setQuickCreatePickerOpen, openQuickCreate } = useApp();

  if (!quickCreatePickerOpen) return null;

  const handlePick = (tab, projectType) => {
    setQuickCreatePickerOpen(false);
    openQuickCreate({ tab, restrictToTab: true, projectType });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
      onClick={() => setQuickCreatePickerOpen(false)}
    >
      <div
        className="bg-slate-200 dark:bg-zinc-950 rounded-2xl border border-slate-300 dark:border-zinc-800 shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-300 dark:border-zinc-800">
          <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100">What would you like to create?</h3>
          <button
            onClick={() => setQuickCreatePickerOpen(false)}
            className="p-1 rounded-lg text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-slate-300/60 dark:hover:bg-zinc-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 space-y-1.5">
          {QUICK_CREATE_TYPES.map(({ tab, label, description, icon: Icon, color, projectType }) => (
            <button
              key={tab + (projectType || '')}
              id={`quick-create-pick-${tab}${projectType ? '-' + projectType : ''}`}
              onClick={() => handlePick(tab, projectType)}
              className="w-full flex items-center gap-3 p-3 rounded-xl text-left hover:bg-slate-300/50 dark:hover:bg-zinc-900 transition cursor-pointer"
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
                <Icon className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 dark:text-zinc-100">{label}</div>
                <div className="text-[11px] text-slate-500 dark:text-zinc-400 truncate">{description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
