import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { 
  Search, Plus, Bell, Moon, Sun, LogOut 
} from 'lucide-react';
import { RoleBadge } from '../common/Badge';
import { NotificationDrawer } from '../common/NotificationDrawer';

export const Navbar = () => {
  const { 
    currentUser, 
    setCurrentUserId, 
    darkMode, 
    setDarkMode, 
    setQuickCreatePickerOpen, 
    setGlobalSearchOpen,
    unreadNotificationCount,
    setActiveTab
  } = useApp();

  const [notifDrawerOpen, setNotifDrawerOpen] = useState(false);

  // Was: falls through to setQuickCreateOpen(true) whenever
  // onOpenQuickCreate wasn't passed as a prop — which App.jsx never
  // actually did, so this always opened the modal hardcoded to the
  // Project tab regardless of what the user might actually want to
  // create. Now opens the type picker instead, same as Sidebar's button.
  const handleQuickCreateClick = () => {
    setQuickCreatePickerOpen(true);
  };

  const handleLogout = () => {
    setCurrentUserId(null);
  };

  return (
    <>
      <header 
        id="app-navbar" 
        className="sticky top-0 z-30 flex items-center justify-between h-16 px-4 md:px-6 bg-slate-200/95 dark:bg-black/95 backdrop-blur-md border-b border-slate-300 dark:border-zinc-800 transition-colors"
      >
        {/* Left: Global Search trigger button */}
        <div className="flex items-center gap-3 flex-1 max-w-md">
          <button
            id="nav-global-search-trigger"
            onClick={() => setGlobalSearchOpen(true)}
            className="flex items-center justify-between w-full max-w-xs md:max-w-sm px-3.5 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900/60 text-slate-500 hover:text-slate-700 dark:hover:text-zinc-200 text-sm transition"
          >
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4" />
              <span className="hidden sm:inline text-xs">Search projects, tasks, tickets...</span>
              <span className="sm:hidden text-xs">Search...</span>
            </div>
            <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono bg-slate-200 dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded text-slate-600 dark:text-zinc-300 shadow-2xs">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Right: Actions, Notifications, Profile, Logout */}
        <div className="flex items-center gap-2 md:gap-3">
          {/* Quick Create Button */}
          <button
            id="nav-quick-create-btn"
            onClick={handleQuickCreateClick}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-lg shadow-xs transition"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden md:inline">Quick Create</span>
          </button>

          {/* Theme Toggle */}
          <button
            id="nav-theme-toggle"
            onClick={() => setDarkMode(!darkMode)}
            className="p-2 rounded-lg text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-slate-300/60 dark:hover:bg-zinc-900 transition"
            title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Notifications Trigger */}
          <button
            id="nav-notifications-trigger"
            onClick={() => setNotifDrawerOpen(true)}
            className="relative p-2 rounded-lg text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-slate-300/60 dark:hover:bg-zinc-900 transition"
          >
            <Bell className="w-4 h-4" />
            {unreadNotificationCount > 0 && (
              <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
              </span>
            )}
          </button>

          {/* Profile Link Button */}
          <button
            id="nav-profile-btn"
            onClick={() => setActiveTab('profile')}
            className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-800 hover:bg-slate-300/50 dark:hover:bg-zinc-900 transition"
            title="Go to Profile"
          >
            <img
              src={currentUser.avatar}
              alt={currentUser.name}
              className="w-7 h-7 rounded-full object-cover ring-1 ring-slate-400 dark:ring-zinc-700"
            />
            <div className="hidden lg:block text-left">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-900 dark:text-zinc-100 truncate max-w-[110px]">
                  {currentUser.name}
                </span>
                <RoleBadge role={currentUser.role} size="xs" />
              </div>
              <span className="text-[10px] text-slate-500 dark:text-zinc-400 block truncate max-w-[130px]">
                {currentUser.department}
              </span>
            </div>
          </button>

          {/* Logout Button */}
          <button
            id="nav-logout-btn"
            onClick={handleLogout}
            className="p-2 rounded-lg text-slate-600 hover:text-rose-600 dark:text-zinc-400 dark:hover:text-rose-400 hover:bg-slate-300/60 dark:hover:bg-zinc-900 transition"
            title="Log out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Slide-out notification drawer */}
      <NotificationDrawer open={notifDrawerOpen} onClose={() => setNotifDrawerOpen(false)} />
    </>
  );
};