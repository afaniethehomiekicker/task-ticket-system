import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Sidebar } from './components/layout/Sidebar';
import { Navbar } from './components/layout/Navbar';
import { DashboardView } from './components/dashboard/DashboardView';
import { ProjectsView } from './components/projects/ProjectsView';
import { KanbanBoardView } from './components/kanban/KanbanBoardView';
import { TasksView } from './components/tasks/TasksView';
import { TicketsView } from './components/tickets/TicketsView';
import { TeamView } from './components/team/TeamView';
import { ReportsView } from './components/reports/ReportsView';
import { AuditLogsView } from './components/audit/AuditLogsView';
import { SettingsView } from './components/settings/SettingsView';
import { GlobalSearchModal } from './components/common/GlobalSearchModal';
import { QuickCreateModal } from './components/common/QuickCreateModal';
import { QuickCreateTypePicker } from './components/common/Quickcreatetypepicker';
import { Login } from './components/auth/login';
import { AdminLogin } from './components/auth/Adminlogin';
import { Profile } from './components/profile/profile';
import { TaskEditModal } from './components/tasks/TaskEditModal';
import { ProjectEditModal } from './components/projects/ProjectEditModal';
import { TicketEditModal } from './components/tickets/TicketEditModal';
import { ClientsView } from './components/Clients/Clientsview';

const AppContent = () => {
  const { activeTab, quickCreateOpen, setQuickCreateOpen, currentUser } = useApp();

  // Dedicated Super Admin portal — a real, separate URL path
  // (/admin-login), checked directly against window.location.pathname
  // since this app has no router at all (App.jsx does state-based tab
  // switching only). This is the minimal way to get a genuinely distinct
  // URL without adding a full routing dependency for one static route —
  // worth revisiting with real routing (e.g. react-router) if more paths
  // like this are needed later.
  if (window.location.pathname === '/admin-login') {
    if (currentUser) {
      // Already authenticated — no reason to show the login form again;
      // a full navigation (not SPA state) keeps the URL bar and app
      // state from disagreeing with each other.
      window.location.href = '/';
      return null;
    }
    return <AdminLogin />;
  }

  // If the user is not authenticated, render only the Login page
  if (!currentUser) {
    return <Login />;
  }

  const renderActiveView = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardView />;
      case 'projects':
        return <ProjectsView />;
      case 'kanban':
        return <KanbanBoardView />;
      case 'tasks':
        return <TasksView />;
      case 'tickets':
        return <TicketsView />;
      case 'clients':
        return <ClientsView />;
      case 'team':
        return <TeamView />;
      case 'reports':
        return <ReportsView />;
      case 'audit':
        return <AuditLogsView />;
      case 'settings':
        return <SettingsView />;
      case 'profile':
        return <Profile />;
      default:
        return <DashboardView />;
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans">
      {/* Structural Desktop Sidebar */}
      <Sidebar />

      {/* Main Content Workspace */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Top Navbar with Quick Search, Create, Switcher */}
        <Navbar />

        {/* Scrollable Viewport Canvas */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          {renderActiveView()}
        </main>
      </div>

      {/* Global Modals */}
      <GlobalSearchModal />
      <QuickCreateTypePicker />
      <QuickCreateModal 
        isOpen={quickCreateOpen} 
        onClose={() => setQuickCreateOpen(false)} 
      />
      <TaskEditModal />
      <ProjectEditModal />
      <TicketEditModal />
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}