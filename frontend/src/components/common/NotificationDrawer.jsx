import React from 'react';
import { useApp } from '../../context/AppContext';
import { Bell, Check, Trash2, X, AlertTriangle, CheckCircle, Clock, MessageSquare, ArrowUpRight } from 'lucide-react';

export const NotificationDrawer = ({ open, onClose }) => {
  const { 
    userNotifications, 
    markNotificationAsRead, 
    markAllNotificationsAsRead,
    setSelectedTaskId,
    setSelectedTicketId,
    setSelectedProjectDetailId
  } = useApp();

  if (!open) return null;

  const handleItemClick = (notif) => {
    markNotificationAsRead(notif.id);
    if (notif.entityType === 'task') {
      setSelectedTaskId(notif.entityId);
      onClose();
    } else if (notif.entityType === 'ticket') {
      setSelectedTicketId(notif.entityId);
      onClose();
    } else if (notif.entityType === 'project') {
      setSelectedProjectDetailId(notif.entityId);
      onClose();
    }
  };

  const getIcon = (type) => {
    switch (type) {
      case 'escalation':
        return <AlertTriangle className="w-4 h-4 text-rose-500" />;
      case 'review':
        return <Clock className="w-4 h-4 text-purple-500" />;
      case 'assignment':
        return <ArrowUpRight className="w-4 h-4 text-indigo-500" />;
      case 'comment':
        return <MessageSquare className="w-4 h-4 text-blue-500" />;
      default:
        return <Bell className="w-4 h-4 text-slate-500 dark:text-zinc-400" />;
    }
  };

  return (
    <div 
      id="notification-drawer-backdrop" 
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <div 
        id="notification-drawer-container"
        className="w-full max-w-md bg-slate-200 dark:bg-zinc-950 h-full shadow-2xl border-l border-slate-300 dark:border-zinc-800 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-300 dark:border-zinc-800 bg-slate-300/40 dark:bg-zinc-900/50">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-base font-semibold text-slate-900 dark:text-zinc-100">Notifications</h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-300/60 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 font-medium">
              {userNotifications.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {userNotifications.some(n => !n.isRead) && (
              <button
                id="mark-all-read-btn"
                onClick={markAllNotificationsAsRead}
                className="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 hover:underline flex items-center gap-1 font-medium cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" /> Mark all read
              </button>
            )}
            <button
              id="close-notifications-btn"
              onClick={onClose}
              className="p-1 rounded-lg text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 hover:bg-slate-300/60 dark:hover:bg-zinc-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Notifications List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-300/50 dark:divide-zinc-800/60 p-2">
          {userNotifications.length === 0 ? (
            <div className="py-16 text-center text-slate-500 dark:text-zinc-400">
              <CheckCircle className="w-10 h-10 mx-auto mb-2 text-slate-400 dark:text-zinc-700" />
              <p className="text-sm font-medium text-slate-900 dark:text-zinc-200">All caught up!</p>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">No unread alerts or assignments for your account.</p>
            </div>
          ) : (
            userNotifications.map(notif => (
              <div
                key={notif.id}
                id={`notification-item-${notif.id}`}
                onClick={() => handleItemClick(notif)}
                className={`p-3.5 rounded-lg cursor-pointer transition flex items-start gap-3 relative ${
                  notif.isRead 
                    ? 'hover:bg-slate-300/50 dark:hover:bg-zinc-800/40 opacity-80' 
                    : 'bg-indigo-100/60 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-950/60'
                }`}
              >
                <div className="mt-0.5 p-2 rounded-md bg-slate-100 dark:bg-zinc-800 shadow-xs border border-slate-300 dark:border-zinc-700 shrink-0">
                  {getIcon(notif.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-semibold text-slate-900 dark:text-zinc-100 truncate">
                      {notif.title}
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-zinc-400 whitespace-nowrap ml-2">
                      {new Date(notif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-xs text-slate-800 dark:text-zinc-300 line-clamp-2">
                    {notif.message}
                  </p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[10px] uppercase font-mono tracking-wider text-indigo-600 dark:text-indigo-400">
                      {notif.entityType} #{notif.entityId}
                    </span>
                    {!notif.isRead && (
                      <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-300/40 dark:bg-zinc-950 border-t border-slate-300 dark:border-zinc-800 text-center text-xs text-slate-500 dark:text-zinc-400">
          Real-time activity stream & assignments
        </div>
      </div>
    </div>
  );
};