import React from 'react';
import { useApp } from '../../context/AppContext';
import { 
  Settings, Shield, Check, X as XIcon, RotateCcw, 
  Database, Palette, ScrollText, Lock
} from 'lucide-react';
import { RoleBadge } from '../common/Badge';
import { PERMISSION_KEYS, PERMISSION_LABELS } from '../../utils/permissions';

const EDITABLE_ROLES = ['admin', 'supervisor', 'staff'];

export const SettingsView = () => {
  const { 
    currentUser, 
    resetToSeedData, 
    darkMode, 
    setDarkMode, 
    permissionMatrix, 
    updateRolePermission 
  } = useApp();

  const isSuperAdmin = currentUser.role === 'super_admin';

  return (
    <div id="settings-view" className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <Settings className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            System Settings & Access Control Matrix
          </h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Role definitions, permission boundaries, and application configuration.
          </p>
        </div>
      </div>

      {/* Role & Permission Hierarchy Matrix — interactive for Super Admin */}
      <div className="bg-slate-200/60 dark:bg-zinc-950 rounded-xl border border-slate-300 dark:border-zinc-800 p-6 shadow-2xs space-y-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <Shield className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            Role & Permission Hierarchy Matrix
          </h3>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            {isSuperAdmin
              ? 'Toggle a capability on or off for a role. Changes apply immediately, application-wide, to every user holding that role.'
              : 'Live enforcement matrix governing data isolation and operational rights. Only a Super Admin can modify these settings.'}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-300/40 dark:bg-zinc-900/60 border-b border-slate-300 dark:border-zinc-800 text-slate-700 dark:text-zinc-300 font-semibold">
              <tr>
                <th className="p-3.5">Capability</th>
                <th className="p-3.5"><RoleBadge role="super_admin" size="xs" /></th>
                <th className="p-3.5"><RoleBadge role="admin" size="xs" /></th>
                <th className="p-3.5"><RoleBadge role="supervisor" size="xs" /></th>
                <th className="p-3.5"><RoleBadge role="staff" size="xs" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300/60 dark:divide-zinc-800/60 text-slate-800 dark:text-zinc-300">
              {Object.values(PERMISSION_KEYS).map(key => (
                <tr key={key} className="hover:bg-slate-300/30 dark:hover:bg-zinc-900/40">
                  <td className="p-3.5 font-medium text-slate-900 dark:text-zinc-100">
                    {PERMISSION_LABELS[key]}
                  </td>

                  {/* Super Admin: always full, never editable */}
                  <td className="p-3.5">
                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold text-xs">
                      <Check className="w-3.5 h-3.5" /> Full
                    </span>
                  </td>

                  {/* Admin / Supervisor / Staff: editable toggle cells */}
                  {EDITABLE_ROLES.map(role => {
                    const granted = !!permissionMatrix?.[role]?.[key];
                    return (
                      <td key={role} className="p-3.5">
                        <button
                          id={`permission-toggle-${role}-${key}`}
                          disabled={!isSuperAdmin}
                          onClick={() => updateRolePermission(role, key, !granted)}
                          title={
                            isSuperAdmin
                              ? `${granted ? 'Revoke' : 'Grant'} "${PERMISSION_LABELS[key]}" for ${role}`
                              : 'Only a Super Admin can modify this'
                          }
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                            granted
                              ? 'bg-emerald-100/80 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                              : 'bg-slate-100 dark:bg-zinc-800/60 text-slate-500 dark:text-zinc-400 border-slate-300 dark:border-zinc-700'
                          } ${isSuperAdmin ? 'hover:opacity-80 cursor-pointer' : 'opacity-70 cursor-not-allowed'}`}
                        >
                          {granted ? <Check className="w-3 h-3" /> : <XIcon className="w-3 h-3" />}
                          {granted ? 'Granted' : 'None'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!isSuperAdmin && (
          <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-zinc-400 pt-1">
            <Lock className="w-3.5 h-3.5" />
            Viewing in read-only mode. Sign in as Super Admin to edit role permissions.
          </div>
        )}
      </div>

      {/* Preferences & Reset Card */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-slate-200/60 dark:bg-zinc-950 rounded-xl border border-slate-300 dark:border-zinc-800 p-6 shadow-2xs space-y-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <Palette className="w-4 h-4 text-indigo-500" />
            Display & UI Preferences
          </h3>
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between p-3 rounded-lg border border-slate-300 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900">
              <div>
                <span className="font-semibold text-slate-900 dark:text-zinc-100 block">Dark Mode Theme</span>
                <span className="text-slate-500 dark:text-zinc-400">Toggle high-contrast dark palette</span>
              </div>
              <button
                id="settings-theme-toggle"
                onClick={() => setDarkMode(!darkMode)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                  darkMode ? 'bg-indigo-600 text-white' : 'bg-slate-300 text-slate-800'
                }`}
              >
                {darkMode ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          </div>
        </div>

        <div className="bg-slate-200/60 dark:bg-zinc-950 rounded-xl border border-slate-300 dark:border-zinc-800 p-6 shadow-2xs space-y-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <Database className="w-4 h-4 text-rose-500" />
            Demo Data & Environment
          </h3>
          <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed">
            Reset all projects, tasks, tickets, comments, and audit logs back to original multi-department seed state.
          </p>
          <button
            id="settings-reset-demo-btn"
            onClick={resetToSeedData}
            className="flex items-center gap-2 px-4 py-2 bg-rose-100/80 hover:bg-rose-200 dark:bg-rose-950/40 dark:hover:bg-rose-950/70 text-rose-800 dark:text-rose-300 rounded-lg text-xs font-semibold border border-rose-300 dark:border-rose-900 transition cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Initial Demo Dataset
          </button>
        </div>
      </div>
    </div>
  );
};