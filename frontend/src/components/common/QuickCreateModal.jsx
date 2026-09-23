import React, { useState, useEffect, useRef } from "react";
import { useApp } from "../../context/AppContext";

import AsyncSelect from "react-select/async";

const TICKET_CATEGORIES = [
  "Technical Support",
  "Bug Report",
  "Feature Request",
  "Billing & Account",
  "General Inquiry",
  "Generic",
];

export const QuickCreateModal = ({ isOpen, onClose }) => {
  const {
    createProject,
    createTask,
    createTicket,
    createClient,
    createFeasibility,
    quickCreateConfig,
    visibleProjects,
    currentUser,
    allUsers,
    apiFetch,
  } = useApp() || {};

  const [localTab, setLocalTab] = useState(quickCreateConfig?.tab || "project");
  const [openNonce, setOpenNonce] = useState(0);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    const justOpened = isOpen && !wasOpenRef.current;

    if (justOpened) {
      setLocalTab(quickCreateConfig?.tab || "project");
      // Was never synced from config at all — QuickCreateTypePicker's
      // "Support / TT" option passed projectType through (once
      // openQuickCreate itself was fixed to stop dropping it), but this
      // modal's own local projectType state stayed hardcoded at
      // "general" regardless, requiring the user to manually re-select
      // it every time from the dropdown inside the form.
      setProjectType(quickCreateConfig?.projectType || "general");
      setOpenNonce((n) => n + 1);
    }

    wasOpenRef.current = isOpen;
  }, [isOpen, quickCreateConfig?.tab, quickCreateConfig?.projectType]);

  const lockedProjectId = quickCreateConfig?.lockedProjectId || null;
  const lockedProject = lockedProjectId
    ? visibleProjects?.find((p) => p.id === lockedProjectId)
    : null;

  // Form states — Project
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [prjBudgetHours, setPrjBudgetHours] = useState(40);
  const [prjStartDate, setPrjStartDate] = useState("");
  const [prjDueDate, setPrjDueDate] = useState("");
  const [projectClientId, setProjectClientId] = useState("");
  const [projectDepartment, setProjectDepartment] = useState("");
  const [projectType, setProjectType] = useState("general"); // 'general' or 'ticketing'
  const [selectedClientName, setSelectedClientName] = useState("");
  const [showNewClientForm, setShowNewClientForm] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientContact, setNewClientContact] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");
  const [clientPickerNonce, setClientPickerNonce] = useState(0);
  const [isCreatingClient, setIsCreatingClient] = useState(false);

  // Form states — Task
  const [taskTitle, setTaskTitle] = useState("");
  const [taskProjectId, setTaskProjectId] = useState("");
  const [taskPriority, setTaskPriority] = useState("normal");
  const [taskDepartment, setTaskDepartment] = useState("");
  const [taskAssigneeId, setTaskAssigneeId] = useState("");

  // Form states — Ticket
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketCategory, setTicketCategory] = useState(TICKET_CATEGORIES[0]);
  const [ticketPriority, setTicketPriority] = useState("normal");
  const [ticketProjectId, setTicketProjectId] = useState("");
  const [ticketDepartment, setTicketDepartment] = useState("");
  const [ticketAssigneeId, setTicketAssigneeId] = useState("");

  // Form states — standalone Client tab.
  const [clientCompanyName, setClientCompanyName] = useState("");
  const [clientContactPerson, setClientContactPerson] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientWebsite, setClientWebsite] = useState("");
  const [clientIndustry, setClientIndustry] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [isSubmittingClient, setIsSubmittingClient] = useState(false);

  // Form states — Feasibility. Product list matches FeasibilitiesView.jsx's
  // own PRODUCTS constant, kept in sync manually since there's no shared
  // source for it yet.
  const FEASIBILITY_PRODUCTS = ["DPLC", "Dark Fiber", "IPT", "IPT Mix", "Pure IPT"];
  const [feasProduct, setFeasProduct] = useState(FEASIBILITY_PRODUCTS[0]);
  const [feasCapacity, setFeasCapacity] = useState("");
  const [feasFromLocation, setFeasFromLocation] = useState("");
  const [feasToLocation, setFeasToLocation] = useState("");
  const [feasCity, setFeasCity] = useState("");
  const [feasClientId, setFeasClientId] = useState("");
  const [feasSelectedClientName, setFeasSelectedClientName] = useState("");
  const [feasRequirementDetails, setFeasRequirementDetails] = useState("");
  const [feasPriority, setFeasPriority] = useState("normal");
  const [feasTargetDate, setFeasTargetDate] = useState("");
  const [isSubmittingFeasibility, setIsSubmittingFeasibility] = useState(false);

  if (!isOpen) return null;

  // Server-side Client/Company search
  const loadClientOptions = async (inputValue) => {
    try {
      // Was a raw fetch() with no Authorization header — every keystroke
      // in this search box hit /api/clients with no token attached,
      // failing with 401 on every single character typed.
      const res = await apiFetch(
        `/api/clients?search=${encodeURIComponent(inputValue)}`,
      );
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      const clientsList = data.clients || [];
      return clientsList.map((c) => ({
        value: c.id ?? c.ID,
        label: `${c.company_name}${c.contact_person ? ` — ${c.contact_person}` : ""}`,
      }));
    } catch (err) {
      return [];
    }
  };

  const handleQuickAddClient = async (e) => {
    e.preventDefault();
    if (!newClientName.trim() || typeof createClient !== "function") return;

    setIsCreatingClient(true);
    const created = await createClient({
      companyName: newClientName.trim(),
      contactPerson: newClientContact.trim(),
      email: newClientEmail.trim(),
    });
    setIsCreatingClient(false);

    if (created) {
      setProjectClientId(created.id);
      setSelectedClientName(created.companyName);
      setShowNewClientForm(false);
      setNewClientName("");
      setNewClientContact("");
      setNewClientEmail("");
      setClientPickerNonce((n) => n + 1);
    } else {
      alert("Could not create the client. Please try again.");
    }
  };

  // Server-side Project Search
  const loadProjectOptions = async (inputValue) => {
    try {
      // Same fix as loadClientOptions above.
      const res = await apiFetch(
        `/api/projects?search=${encodeURIComponent(inputValue)}`,
      );
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      const prjs = data.projects || [];
      return [
        { value: "", label: "No Project (Unassigned)" },
        ...prjs.map((p) => ({
          value: p.id || p.ID,
          label: `${p.code || "PRJ"} — ${p.title}`,
        })),
      ];
    } catch (err) {
      const filtered = (visibleProjects || []).filter(
        (p) =>
          p.title?.toLowerCase().includes(inputValue.toLowerCase()) ||
          p.code?.toLowerCase().includes(inputValue.toLowerCase()),
      );
      return [
        { value: "", label: "No Project (Unassigned)" },
        ...filtered.map((p) => ({
          value: p.id,
          label: `${p.code} — ${p.title}`,
        })),
      ];
    }
  };

  // NOT actually a cascade from the selected Client — Department is an
  // internal-org concept (which team handles the work), unrelated to
  // which Client a project is for, so there's no real dependency here to
  // begin with. This returns a flat, hardcoded list because Department
  // isn't a real backend entity yet (no /api/departments exists) — this
  // is a stopgap until it is, not a working cascade. Previously gated
  // behind "a client must be picked first," which implied a dependency
  // that doesn't actually exist and just made department-picking
  // pointlessly blocked on an unrelated field.
  const loadDepartmentOptions = async (inputValue) => {
    try {
      const departments = [
        "Technical",
        "Customer Success", 
        "Feasibility",
        "Engineering",
        "Support",
        "Sales",
        "Operations",
        "Administration"
      ];
      return departments
        .filter(d => d.toLowerCase().includes(inputValue.toLowerCase()))
        .map(d => ({ value: d, label: d }));
    } catch (err) {
      return [];
    }
  };

  // Cascading: Load Assignees based on selected Department
  const loadAssigneeOptions = async (inputValue) => {
    const dept = projectDepartment || taskDepartment || ticketDepartment;
    if (!dept) return [];
    try {
      // Same fix as loadClientOptions/loadProjectOptions above.
      const res = await apiFetch(`/api/users?search=${encodeURIComponent(inputValue)}`);
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      const users = data.users || [];
      // Filter users by department
      return users
        .filter(u => !dept || u.department === dept)
        .map(u => ({
          value: u.id || u.ID,
          label: `${u.name} (${u.role ? u.role.toUpperCase() : "USER"})`,
        }));
    } catch (err) {
      // Fallback to local users
      return (allUsers || [])
        .filter(u => !dept || u.department === dept)
        .map(u => ({
          value: u.id,
          label: `${u.name} (${u.role ? u.role.toUpperCase() : "USER"})`,
        }));
    }
  };

  const customStyles = {
    control: (base, state) => ({
      ...base,
      backgroundColor: "rgba(24, 24, 27, 0.8)",
      borderColor: state.isFocused ? "#6366f1" : "#3f3f46",
      borderRadius: "0.5rem",
      padding: "2px",
      fontSize: "0.875rem",
      boxShadow: "none",
      "&:hover": { borderColor: "#6366f1" },
    }),
    menu: (base) => ({
      ...base,
      backgroundColor: "#18181b",
      border: "1px solid #3f3f46",
      borderRadius: "0.5rem",
      zIndex: 60,
      fontSize: "0.875rem",
    }),
    option: (base, state) => ({
      ...base,
      backgroundColor: state.isFocused ? "#3f3f46" : "#18181b",
      color: "#f4f4f5",
      cursor: "pointer",
    }),
    singleValue: (base) => ({ ...base, color: "#f4f4f5" }),
    input: (base) => ({ ...base, color: "#f4f4f5" }),
    placeholder: (base) => ({ ...base, color: "#a1a1aa" }),
  };

  const resetAllFields = () => {
    setProjectName("");
    setProjectDescription("");
    setPrjBudgetHours(40);
    setPrjStartDate("");
    setPrjDueDate("");
    setProjectClientId("");
    setProjectDepartment("");
    setProjectType("general");
    setSelectedClientName("");
    setShowNewClientForm(false);
    setNewClientName("");
    setNewClientContact("");
    setNewClientEmail("");
    setTaskTitle("");
    setTaskProjectId("");
    setTaskPriority("normal");
    setTaskDepartment("");
    setTaskAssigneeId("");
    setTicketSubject("");
    setTicketCategory(TICKET_CATEGORIES[0]);
    setTicketPriority("normal");
    setTicketProjectId("");
    setTicketDepartment("");
    setTicketAssigneeId("");
    setClientCompanyName("");
    setClientContactPerson("");
    setClientEmail("");
    setClientPhone("");
    setClientWebsite("");
    setClientIndustry("");
    setClientAddress("");
    setFeasProduct(FEASIBILITY_PRODUCTS[0]);
    setFeasCapacity("");
    setFeasFromLocation("");
    setFeasToLocation("");
    setFeasCity("");
    setFeasClientId("");
    setFeasSelectedClientName("");
    setFeasRequirementDetails("");
    setFeasPriority("normal");
    setFeasTargetDate("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (localTab === "project") {
      if (!projectClientId) {
        alert(
          "Validation Error: A project must be built on top of a client or company profile.",
        );
        return;
      }

      // For "Support/TT" type, strip budgetHours
      const isSupportTT = projectType === 'ticketing';
      const newProject = {
        title: projectName,
        description: projectDescription,
        budgetHours: isSupportTT ? undefined : prjBudgetHours,
        startDate: prjStartDate || new Date().toISOString().split("T")[0],
        dueDate: prjDueDate || new Date().toISOString().split("T")[0],
        // No client-generated code anymore — it was
        // `PRJ-${Date.now().toString().slice(-4)}`, the last 4 digits of
        // a millisecond timestamp, which repeats every 10 seconds. Two
        // people creating projects within that window — routine usage,
        // not a rare race — would collide on the backend's unique index
        // and one would fail outright. The backend now auto-generates a
        // real, collision-free code (PRJ-000001 style) when this field
        // is omitted, matching how Task/Ticket numbers already work.
        department: projectDepartment || currentUser?.department || "Engineering",
        status: "planning",
        priority: "normal",
        clientId: projectClientId,
        projectType, // 'general' or 'ticketing'
      };

      if (typeof createProject === "function") {
        createProject(newProject);
      }
    } else if (localTab === "task") {
      const resolvedProjectId = lockedProjectId || taskProjectId || null;

      const newTask = {
        title: taskTitle,
        priority: taskPriority,
        status: "todo",
        description: "",
        labels: [],
        subTasks: [],
        checklists: [],
        comments: [],
        dueDate: new Date().toISOString().split("T")[0],
        assignedToId: taskAssigneeId || null,
        projectId: resolvedProjectId,
        department: taskDepartment || currentUser?.department || "",
        progress: 0,
      };

      if (typeof createTask === "function") {
        createTask(newTask);
      }
    } else if (localTab === "ticket") {
      const newTicket = {
        title: ticketSubject,
        description: "",
        category: ticketCategory,
        priority: ticketPriority,
        severity: ticketPriority,
        department: ticketDepartment || currentUser?.department || "Support",
        requesterName: currentUser?.name || "Internal Requester",
        requesterEmail: currentUser?.email || "",
        requesterCompany: "",
        status: "open",
        projectId: ticketProjectId || null,
        assignedToId: ticketAssigneeId || null,
        escalationLevel: "none",
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        projectType: 'ticketing', // Tickets are always ticketing type
      };

      if (typeof createTicket === "function") {
        createTicket(newTicket);
      }
    } else if (localTab === "client") {
      if (!clientCompanyName.trim()) return;
      if (typeof createClient !== "function") return;

      setIsSubmittingClient(true);
      const created = await createClient({
        companyName: clientCompanyName.trim(),
        contactPerson: clientContactPerson.trim(),
        email: clientEmail.trim(),
        phone: clientPhone.trim(),
        website: clientWebsite.trim(),
        industry: clientIndustry.trim(),
        address: clientAddress.trim(),
      });
      setIsSubmittingClient(false);

      if (!created) return;
    } else if (localTab === "feasibility") {
      if (!feasProduct) return;
      if (typeof createFeasibility !== "function") return;

      setIsSubmittingFeasibility(true);
      const created = await createFeasibility({
        product: feasProduct,
        capacity: feasCapacity.trim(),
        fromLocation: feasFromLocation.trim(),
        toLocation: feasToLocation.trim(),
        city: feasCity.trim(),
        clientId: feasClientId || null,
        requirementDetails: feasRequirementDetails.trim(),
        priority: feasPriority,
        targetDate: feasTargetDate || "",
      });
      setIsSubmittingFeasibility(false);

      if (!created) return;
    }

    resetAllFields();
    onClose();
  };

  const tabLabel = {
    project: "New Project",
    task: "New Task",
    ticket: "New Ticket",
    client: "New Client",
    feasibility: "New Feasibility",
  }[localTab];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div
        key={openNonce}
        className="bg-slate-200 dark:bg-zinc-950 rounded-xl shadow-xl w-full max-w-lg overflow-hidden border border-slate-300 dark:border-zinc-800"
      >
        <div className="px-5 py-3.5 border-b border-slate-300 dark:border-zinc-800 bg-slate-300/40 dark:bg-zinc-900/50">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
            {tabLabel}
          </h3>
          {localTab === "task" && lockedProject && (
            <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
              Will be added to{" "}
              <span className="font-medium text-indigo-600 dark:text-indigo-400">
                {lockedProject.code}
              </span>{" "}
              — {lockedProject.title}
            </p>
          )}
        </div>

        <div className="p-6">
          {localTab === "project" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider">
                    1. Select Client / Company *
                  </label>
                  {!showNewClientForm && (
                    <button
                      type="button"
                      onClick={() => setShowNewClientForm(true)}
                      className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      + New Client
                    </button>
                  )}
                </div>

                {!showNewClientForm ? (
                  <>
                    <AsyncSelect
                      key={clientPickerNonce}
                      cacheOptions
                      defaultOptions
                      isSearchable
                      loadOptions={loadClientOptions}
                      onChange={(option) => {
                        setProjectClientId(option ? option.value : "");
                        setSelectedClientName(option ? option.label : "");
                      }}
                      placeholder="Type to search client or company..."
                      styles={customStyles}
                    />
                    {selectedClientName && (
                      <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">
                        Selected: {selectedClientName}
                      </p>
                    )}
                  </>
                ) : (
                  <div className="p-3 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 space-y-2.5">
                    <input
                      type="text"
                      placeholder="Company name *"
                      value={newClientName}
                      onChange={(e) => setNewClientName(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                    />
                    <input
                      type="text"
                      placeholder="Contact person"
                      value={newClientContact}
                      onChange={(e) => setNewClientContact(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                    />
                    <input
                      type="email"
                      placeholder="Email"
                      value={newClientEmail}
                      onChange={(e) => setNewClientEmail(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                    />
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setShowNewClientForm(false)}
                        className="px-3 py-1.5 text-xs text-slate-600 dark:text-zinc-400 hover:bg-slate-200 dark:hover:bg-zinc-800 rounded-lg"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleQuickAddClient}
                        disabled={!newClientName.trim() || isCreatingClient}
                        className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg"
                      >
                        {isCreatingClient ? "Creating..." : "Create & Select"}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Project Name
                </label>
                <input
                  type="text"
                  placeholder="Enter project name..."
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  required
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Description <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={3}
                  placeholder="Describe the project scope, goals, and deliverables..."
                  value={projectDescription}
                  onChange={(e) => setProjectDescription(e.target.value)}
                  required
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Project Type
                </label>
                <select
                  value={projectType}
                  onChange={(e) => setProjectType(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                >
                  <option value="general">General Project</option>
                  <option value="ticketing">Support / TT</option>
                </select>
              </div>

              {projectType === 'general' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text zinc-300 uppercase tracking-wider mb-1.5">
                  Budget (Hours)
                </label>
                <input
                  id="prj-budget-input"
                  type="number"
                  min={1}
                  max={5000}
                  value={prjBudgetHours}
                  onChange={(e) => setPrjBudgetHours(Number(e.target.value))}
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                />
              </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Department
                </label>
                <AsyncSelect
                  cacheOptions
                  defaultOptions
                  isSearchable
                  loadOptions={loadDepartmentOptions}
                  onChange={(option) => setProjectDepartment(option ? option.value : "")}
                  placeholder="Select department..."
                  styles={customStyles}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Initial Timeline
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <span className="text-xs text-slate-500 dark:text-zinc-400 mb-1 block">
                      Start Date
                    </span>
                    <input
                      id="prj-start-date-input"
                      type="date"
                      value={prjStartDate}
                      onChange={(e) => setPrjStartDate(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                    />
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 dark:text-zinc-400 mb-1 block">
                      Due Date
                    </span>
                    <input
                      id="prj-due-date-input"
                      type="date"
                      value={prjDueDate}
                      onChange={(e) => setPrjDueDate(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-300 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-zinc-300 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  id="submit-create-project-btn"
                  type="submit"
                  className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs cursor-pointer"
                >
                  Create Project
                </button>
              </div>
            </form>
          )}

          {localTab === "task" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Task Title
                </label>
                <input
                  type="text"
                  placeholder="Enter task description..."
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  required
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Project (Searchable)
                </label>
                {lockedProjectId ? (
                  <div className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-800 bg-slate-100 dark:bg-zinc-900/60 text-sm text-slate-700 dark:text-zinc-300">
                    {lockedProject
                      ? `${lockedProject.code} — ${lockedProject.title}`
                      : "Current Project"}
                  </div>
                ) : (
                  <AsyncSelect
                    cacheOptions
                    defaultOptions
                    isSearchable
                    loadOptions={loadProjectOptions}
                    onChange={(option) =>
                      setTaskProjectId(option ? option.value : "")
                    }
                    placeholder="Search project by name or code..."
                    styles={customStyles}
                  />
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Department
                </label>
                <AsyncSelect
                  cacheOptions
                  defaultOptions
                  isSearchable
                  loadOptions={loadDepartmentOptions}
                  onChange={(option) => setTaskDepartment(option ? option.value : "")}
                  placeholder="Select department..."
                  styles={customStyles}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Assignee
                </label>
                <AsyncSelect
                  cacheOptions
                  defaultOptions
                  isSearchable
                  loadOptions={loadAssigneeOptions}
                  onChange={(option) => setTaskAssigneeId(option ? option.value : "")}
                  placeholder="Select assignee..."
                  styles={customStyles}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Priority
                </label>
                <select
                  value={taskPriority}
                  onChange={(e) => setTaskPriority(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                  <option value="critical">Critical</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-300 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-zinc-300 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs cursor-pointer"
                >
                  Create Task
                </button>
              </div>
            </form>
          )}

          {localTab === "ticket" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Subject
                </label>
                <input
                  type="text"
                  placeholder="Brief summary of the issue or request..."
                  value={ticketSubject}
                  onChange={(e) => setTicketSubject(e.target.value)}
                  required
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                    Category
                  </label>
                  <select
                    value={ticketCategory}
                    onChange={(e) => setTicketCategory(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                  >
                    {TICKET_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                    Priority
                  </label>
                  <select
                    value={ticketPriority}
                    onChange={(e) => setTicketPriority(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Department
                </label>
                <AsyncSelect
                  cacheOptions
                  defaultOptions
                  isSearchable
                  loadOptions={loadDepartmentOptions}
                  onChange={(option) => setTicketDepartment(option ? option.value : "")}
                  placeholder="Select department..."
                  styles={customStyles}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Assignee
                </label>
                <AsyncSelect
                  cacheOptions
                  defaultOptions
                  isSearchable
                  loadOptions={loadAssigneeOptions}
                  onChange={(option) => setTicketAssigneeId(option ? option.value : "")}
                  placeholder="Select assignee..."
                  styles={customStyles}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Select Project (Searchable)
                </label>
                <AsyncSelect
                  cacheOptions
                  defaultOptions
                  isSearchable
                  loadOptions={loadProjectOptions}
                  onChange={(option) =>
                    setTicketProjectId(option ? option.value : "")
                  }
                  placeholder="Search project by name or code..."
                  styles={customStyles}
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-300 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-zinc-300 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-xs cursor-pointer"
                >
                  Create Ticket
                </button>
              </div>
            </form>
          )}

          {localTab === "client" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Company Name *
                </label>
                <input
                  type="text"
                  placeholder="Acme Corporation"
                  value={clientCompanyName}
                  onChange={(e) => setClientCompanyName(e.target.value)}
                  required
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                    Contact Person
                  </label>
                  <input
                    type="text"
                    placeholder="Jane Doe"
                    value={clientContactPerson}
                    onChange={(e) => setClientContactPerson(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                    Email
                  </label>
                  <input
                    type="email"
                    placeholder="jane@acme.com"
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                    Phone Number
                  </label>
                  <input
                    type="text"
                    placeholder="+1 (555) 000-0000"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                    Website URL
                  </label>
                  <input
                    type="text"
                    placeholder="https://acme.com"
                    value={clientWebsite}
                    onChange={(e) => setClientWebsite(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Industry
                </label>
                <input
                  type="text"
                  placeholder="e.g. Financial Services, Manufacturing..."
                  value={clientIndustry}
                  onChange={(e) => setClientIndustry(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Address
                </label>
                <textarea
                  rows={2}
                  placeholder="Street, city, state, postal code..."
                  value={clientAddress}
                  onChange={(e) => setClientAddress(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-300 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-zinc-300 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingClient}
                  className="px-5 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-60 disabled:cursor-not-allowed rounded-lg shadow-xs cursor-pointer"
                >
                  {isSubmittingClient ? "Creating..." : "Create Client"}
                </button>
              </div>
            </form>
          )}

          {localTab === "feasibility" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                    Product *
                  </label>
                  <select
                    value={feasProduct}
                    onChange={(e) => setFeasProduct(e.target.value)}
                    required
                    className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                  >
                    {FEASIBILITY_PRODUCTS.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                    Capacity
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 100 Mbps, 1 Gbps..."
                    value={feasCapacity}
                    onChange={(e) => setFeasCapacity(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                    From Location
                  </label>
                  <input
                    type="text"
                    placeholder="Origin site or address"
                    value={feasFromLocation}
                    onChange={(e) => setFeasFromLocation(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                    To Location
                  </label>
                  <input
                    type="text"
                    placeholder="Destination site or address"
                    value={feasToLocation}
                    onChange={(e) => setFeasToLocation(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                    City
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Karachi"
                    value={feasCity}
                    onChange={(e) => setFeasCity(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                    Priority
                  </label>
                  <select
                    value={feasPriority}
                    onChange={(e) => setFeasPriority(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Client
                </label>
                <AsyncSelect
                  cacheOptions
                  defaultOptions
                  isSearchable
                  isClearable
                  loadOptions={loadClientOptions}
                  onChange={(option) => {
                    setFeasClientId(option ? option.value : "");
                    setFeasSelectedClientName(option ? option.label : "");
                  }}
                  placeholder="Type to search client or company..."
                  styles={customStyles}
                />
                {feasSelectedClientName && (
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">
                    Selected: {feasSelectedClientName}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                    Target Date
                  </label>
                  <input
                    type="date"
                    value={feasTargetDate}
                    onChange={(e) => setFeasTargetDate(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Requirement Details
                </label>
                <textarea
                  rows={3}
                  placeholder="Describe the connectivity or feasibility requirement..."
                  value={feasRequirementDetails}
                  onChange={(e) => setFeasRequirementDetails(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-300 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-zinc-300 hover:bg-slate-300/60 dark:hover:bg-zinc-800 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingFeasibility}
                  className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed rounded-lg shadow-xs cursor-pointer"
                >
                  {isSubmittingFeasibility ? "Creating..." : "Create Feasibility"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};