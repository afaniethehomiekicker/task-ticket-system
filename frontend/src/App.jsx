import React, { useEffect } from "react";
import { AppProvider, useAppSelector } from "./context/AppContext";
import { Sidebar } from "./components/layout/Sidebar";
import { Navbar } from "./components/layout/Navbar";
import { DashboardView } from "./components/dashboard/DashboardView";
import { ProjectsView } from "./components/projects/ProjectsView";
import { KanbanBoardView } from "./components/kanban/KanbanBoardView";
import { TasksView } from "./components/tasks/TasksView";
import { TicketsView } from "./components/tickets/TicketsView";
import { FeasibilitiesView } from "./components/feasibilities/FeasibilitiesView";
import { TeamView } from "./components/team/TeamView";
import { ReportsView } from "./components/reports/ReportsView";
import { AuditLogsView } from "./components/audit/AuditLogsView";
import { SettingsView } from "./components/settings/SettingsView";
import { GlobalSearchModal } from "./components/common/GlobalSearchModal";
import { QuickCreateModal } from "./components/common/QuickCreateModal";
import { QuickCreateTypePicker } from "./components/common/Quickcreatetypepicker";
import { Login } from "./components/auth/login";
import { AdminLogin } from "./components/auth/Adminlogin";
import { Profile } from "./components/profile/profile";
import { TaskEditModal } from "./components/tasks/TaskEditModal";
import { ProjectEditModal } from "./components/projects/ProjectEditModal";
import { TicketEditModal } from "./components/tickets/TicketEditModal";
import { TaskDetailDrawer } from "./components/tasks/TaskDetailDrawer";
import { TicketDetailDrawer } from "./components/tickets/TicketDetailDrawer";
import { ProjectDetailModal } from "./components/projects/ProjectDetailModal";
import { FeasibilityDetailDrawer } from "./components/feasibilities/FeasibilityDetailDrawer";
import { ClientsView } from "./components/Clients/Clientsview";
import { DepartmentsView } from "./components/departments/DepartmentsView";
import { VendorsView } from "./components/vendors/VendorsView";
import { ArchiveView } from "./components/archive/ArchiveView";
const AppContent = () => {
  const {
    activeTab, quickCreateOpen, setQuickCreateOpen, currentUser, authToken, dataLoaded,
    setSelectedTaskId, setSelectedTicketId, setSelectedProjectDetailId, setSelectedFeasibilityId,
  } = useAppSelector(s => ({ activeTab: s.activeTab, quickCreateOpen: s.quickCreateOpen, setQuickCreateOpen: s.setQuickCreateOpen, currentUser: s.currentUser, authToken: s.authToken, dataLoaded: s.dataLoaded, setSelectedTaskId: s.setSelectedTaskId, setSelectedTicketId: s.setSelectedTicketId, setSelectedProjectDetailId: s.setSelectedProjectDetailId, setSelectedFeasibilityId: s.setSelectedFeasibilityId }));

  // Detail windows are app-level now; changing page closes whichever is
  // open so it doesn't sit on top of the new page.
  useEffect(() => {
    setSelectedTaskId?.(null);
    setSelectedTicketId?.(null);
    setSelectedProjectDetailId?.(null);
    setSelectedFeasibilityId?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Dedicated Super Admin portal — a real, separate URL path
  // (/admin-login), checked directly against window.location.pathname
  // since this app has no router at all (App.jsx does state-based tab
  // switching only). This is the minimal way to get a genuinely distinct
  // URL without adding a full routing dependency for one static route —
  // worth revisiting with real routing (e.g. react-router) if more paths
  // like this are needed later.
  if (window.location.pathname === "/admin-login") {
    if (currentUser) {
      // Already authenticated — no reason to show the login form again;
      // a full navigation (not SPA state) keeps the URL bar and app
      // state from disagreeing with each other.
      window.location.href = "/";
      return null;
    }
    return <AdminLogin />;
  }

  // If the user is not authenticated, render only the Login page. A
  // returning user with a stored session token still needs the initial
  // backend fetch to finish before their currentUser can be resolved
  // (identity now lives only in the token + backend, not a local cache),
  // so a brief loader is shown instead of flashing the login screen.
  if (!currentUser) {
    if (authToken && !dataLoaded) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-900">
          <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full" />
        </div>
      );
    }
    return <Login />;
  }

  const renderActiveView = () => {
    switch (activeTab) {
      case "dashboard":
        return <DashboardView />;
      case "projects":
        return <ProjectsView />;
      case "kanban":
        return <KanbanBoardView />;
      case "tasks":
        return <TasksView />;
      case "tickets":
        return <TicketsView />;
      case "feasibilities":
        return <FeasibilitiesView />;
      case "clients":
        return <ClientsView />;
      case "vendors":
        return <VendorsView />;
      case "departments":
        return <DepartmentsView />;
      case "team":
        return <TeamView />;
      case "reports":
        return <ReportsView />;
      case "audit":
        return <AuditLogsView />;
      case "archive":
        return <ArchiveView />;
      case "settings":
        return <SettingsView />;
      case "profile":
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
        <main className="flex-1 overflow-y-auto p-4 md:p-5 xl:p-8">
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
      {/* Detail windows live here, once, so they open from any page — the
          dashboard, the Client 360 view, search — not only from inside
          their own list page (clicking a task on the dashboard did nothing). */}
      <TaskDetailDrawer />
      <TicketDetailDrawer />
      <ProjectDetailModal />
      <FeasibilityDetailDrawer />
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