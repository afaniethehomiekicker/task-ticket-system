import React, { useState } from "react";
import { useApp } from "../../context/AppContext";
import {
  Settings,
  Shield,
  Check,
  X as XIcon,
  RotateCcw,
  Database,
  Palette,
  Lock,
  Plus,
  UserCheck,
} from "lucide-react";
import { RoleBadge } from "../common/Badge";
import { PERMISSION_KEYS, PERMISSION_LABELS } from "../../utils/permissions";

export const SettingsView = () => {
  const {
    currentUser,
    darkMode,
    setDarkMode,
    permissionMatrix,
    updateRolePermission,
    customRoles = ["super_admin", "admin", "supervisor", "staff", "client"],
    createCustomRole,
    deleteCustomRole,
  } = useApp();

  const isSuperAdmin = currentUser?.role === "super_admin";

  // Custom Role Modal state
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [initialPermissions, setInitialPermissions] = useState({});

  // All non-super-admin roles to render in the matrix table dynamically
  const editableRoles = customRoles.filter((role) => role !== "super_admin");
  const builtInRoles = ["admin", "supervisor", "staff", "client"];

  const handleToggleInitialPermission = (key) => {
    setInitialPermissions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleCreateRoleSubmit = (e) => {
    e.preventDefault();
    if (!newRoleName.trim()) return;

    const roleKey = newRoleName.toLowerCase().trim().replace(/\s+/g, "_");
    if (typeof createCustomRole === "function") {
      createCustomRole(roleKey, newRoleName, initialPermissions);
    }

    setNewRoleName("");
    setInitialPermissions({});
    setIsRoleModalOpen(false);
  };

  const handleDeleteRole = (roleKey) => {
    if (
      window.confirm(
        `Are you sure you want to delete the "${roleKey.replace(/_/g, " ")}" role?`,
      )
    ) {
      if (typeof deleteCustomRole === "function") {
        deleteCustomRole(roleKey);
      }
    }
  };

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
            Role definitions, permission boundaries, and application
            configuration.
          </p>
        </div>

        {isSuperAdmin && (
          <button
            onClick={() => setIsRoleModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg shadow-xs transition cursor-pointer self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            Create Custom Role
          </button>
        )}
      </div>

      {/* Role & Permission Hierarchy Matrix */}
      <div className="bg-slate-200/60 dark:bg-zinc-950 rounded-xl border border-slate-300 dark:border-zinc-800 p-6 shadow-2xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
              <Shield className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              Role & Permission Hierarchy Matrix
            </h3>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
              {isSuperAdmin
                ? "Toggle a capability on or off for a role. Changes apply immediately, application-wide, to every user holding that role."
                : "Live enforcement matrix governing data isolation and operational rights. Only a Super Admin can modify these settings."}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-300/40 dark:bg-zinc-900/60 border-b border-slate-300 dark:border-zinc-800 text-slate-700 dark:text-zinc-300 font-semibold">
              <tr>
                <th className="p-3.5">Capability</th>
                <th className="p-3.5">
                  <RoleBadge role="super_admin" size="xs" />
                </th>
                {editableRoles.map((role) => {
                  const isBuiltIn = builtInRoles.includes(role);
                  return (
                    <th key={role} className="p-3.5">
                      {isBuiltIn ? (
                        <RoleBadge role={role} size="xs" />
                      ) : (
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-800">
                          <span className="text-[10px] font-bold uppercase tracking-wider">
                            {role.replace(/_/g, " ")}
                          </span>
                          {isSuperAdmin && (
                            <button
                              type="button"
                              onClick={() => handleDeleteRole(role)}
                              className="text-purple-600 dark:text-purple-400 hover:text-rose-500 cursor-pointer ml-1"
                              title={`Delete ${role.replace(/_/g, " ")} role`}
                            >
                              <XIcon className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300/60 dark:divide-zinc-800/60 text-slate-800 dark:text-zinc-300">
              {Object.values(PERMISSION_KEYS).map((key) => (
                <tr
                  key={key}
                  className="hover:bg-slate-300/30 dark:hover:bg-zinc-900/40"
                >
                  <td className="p-3.5 font-medium text-slate-900 dark:text-zinc-100">
                    {PERMISSION_LABELS[key]}
                  </td>

                  {/* Super Admin: always full, never editable */}
                  <td className="p-3.5">
                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold text-xs">
                      <Check className="w-3.5 h-3.5" /> Full
                    </span>
                  </td>

                  {/* Dynamic Custom & Standard Editable Roles */}
                  {editableRoles.map((role) => {
                    const granted = !!permissionMatrix?.[role]?.[key];
                    return (
                      <td key={role} className="p-3.5">
                        <button
                          id={`permission-toggle-${role}-${key}`}
                          disabled={!isSuperAdmin}
                          onClick={() =>
                            updateRolePermission(role, key, !granted)
                          }
                          title={
                            isSuperAdmin
                              ? `${granted ? "Revoke" : "Grant"} "${PERMISSION_LABELS[key]}" for ${role}`
                              : "Only a Super Admin can modify this"
                          }
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                            granted
                              ? "bg-emerald-100/80 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800"
                              : "bg-slate-100 dark:bg-zinc-800/60 text-slate-500 dark:text-zinc-400 border-slate-300 dark:border-zinc-700"
                          } ${isSuperAdmin ? "hover:opacity-80 cursor-pointer" : "opacity-70 cursor-not-allowed"}`}
                        >
                          {granted ? (
                            <Check className="w-3 h-3" />
                          ) : (
                            <XIcon className="w-3 h-3" />
                          )}
                          {granted ? "Granted" : "None"}
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
            Viewing in read-only mode. Sign in as Super Admin to edit role
            permissions.
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
                <span className="font-semibold text-slate-900 dark:text-zinc-100 block">
                  Dark Mode Theme
                </span>
                <span className="text-slate-500 dark:text-zinc-400">
                  Toggle high-contrast dark palette
                </span>
              </div>
              <button
                id="settings-theme-toggle"
                onClick={() => setDarkMode(!darkMode)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                  darkMode
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-300 text-slate-800"
                }`}
              >
                {darkMode ? "Enabled" : "Disabled"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Super Admin Modal: Create Custom Role */}
      {isRoleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-slate-200 dark:bg-zinc-950 border border-slate-300 dark:border-zinc-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-300 dark:border-zinc-800 bg-slate-300/40 dark:bg-zinc-900/50">
              <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-indigo-500" />
                Define New Custom Role
              </h3>
              <button
                onClick={() => setIsRoleModalOpen(false)}
                className="p-1 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-zinc-200"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateRoleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300 mb-1">
                  Role Name / Title
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Quality Assurance, Regional Lead..."
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-zinc-100 focus:outline-hidden focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-zinc-300 mb-2">
                  Initial Capability Grants
                </label>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {Object.values(PERMISSION_KEYS).map((key) => (
                    <label
                      key={key}
                      className="flex items-center justify-between p-2 rounded-lg bg-slate-100 dark:bg-zinc-900 border border-slate-300/80 dark:border-zinc-800 text-xs cursor-pointer"
                    >
                      <span className="text-slate-800 dark:text-zinc-200 font-medium">
                        {PERMISSION_LABELS[key]}
                      </span>
                      <input
                        type="checkbox"
                        checked={!!initialPermissions[key]}
                        onChange={() => handleToggleInitialPermission(key)}
                        className="rounded-md border-zinc-700 text-indigo-600 focus:ring-indigo-500"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-300 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsRoleModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-zinc-300 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg text-xs transition shadow-xs"
                >
                  Save Custom Role
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
