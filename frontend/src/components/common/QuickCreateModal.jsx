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

import { CustomFieldInputs } from '../Clients/CustomFieldInputs';
import { isTaskAssignable } from '../../utils/permissions';
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
    searchAssignees,
    departments,
    clients,
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
  // Budget unit: some projects are planned in hours, others in days.
  const [prjBudgetUnit, setPrjBudgetUnit] = useState("hours");
  const [prjStartDate, setPrjStartDate] = useState("");
  const [prjDueDate, setPrjDueDate] = useState("");
  // A project can have several clients (spec slide 9). Selected options,
  // first = primary; projectClientId stays as the primary for validation.
  const [projectClients, setProjectClients] = useState([]);
  const projectClientId = projectClients[0]?.value || "";
  const [projectDepartment, setProjectDepartment] = useState("");
  const [projectType, setProjectType] = useState("general"); // 'general' or 'ticketing'
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
  // What the assignee needs to do: sent with the task in one step. The form
  // used to have no description or checklist, so tasks arrived title-only.
  const [taskDescription, setTaskDescription] = useState("");
  const [taskChecklist, setTaskChecklist] = useState([]);
  const [taskChecklistInput, setTaskChecklistInput] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");

  // Form states — Ticket
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketCategory, setTicketCategory] = useState(TICKET_CATEGORIES[0]);
  const [ticketPriority, setTicketPriority] = useState("normal");
  const [ticketProjectId, setTicketProjectId] = useState("");
  // The client this ticket is for (spec slide 19: a customer query becomes a
  // ticket).
  const [ticketClientId, setTicketClientId] = useState("");
  const [ticketClientName, setTicketClientName] = useState("");
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
  // Spec slide 8 fields + admin-defined extras.
  const [clientPersonName, setClientPersonName] = useState("");
  const [clientCnic, setClientCnic] = useState("");
  const [clientMobile, setClientMobile] = useState("");
  const [clientCity, setClientCity] = useState("");
  const [clientCustom, setClientCustom] = useState({});
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
  // Guards project/task/ticket submits against double-clicks while the
  // request is in flight (client/feasibility have their own flags above).
  const submittingRef = useRef(false);
  // Visible "Creating..." state + disabled button (the ref alone blocked a
  // second click internally but the button still looked clickable).
  const [isCreating, setIsCreating] = useState(false);

  if (!isOpen) return null;

  // Server-side Client/Company search
  const loadClientOptions = async (inputValue) => {
    // Nothing typed yet: offer the clients already linked to the user's own
    // work (their visible client list), so the box isn't just "No options".
    // Typing 2+ letters searches every client by name / ID.
    if ((inputValue || "").trim().length < 2) {
      return (clients || [])
        .filter((c) => c && c.status !== "archived")
        .slice(0, 20)
        .map((c) => ({
          value: c.id,
          label: `${c.companyName}${c.clientNumber ? ` (${c.clientNumber})` : ""}${c.city ? ` — ${c.city}` : ""}`,
        }));
    }
    try {
      // Was a raw fetch() with no Authorization header — every keystroke
      // in this search box hit /api/clients with no token attached,
      // failing with 401 on every single character typed.
      const res = await apiFetch(
        // Name / client-ID search (reference fields only) — every user can
        // find an existing client to link without seeing the client book.
        `/api/clients/lookup?search=${encodeURIComponent(inputValue)}`,
      );
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      const clientsList = data.clients || [];
      return clientsList.map((c) => ({
        value: c.id ?? c.ID,
        label: `${c.company_name}${c.client_number ? ` (${c.client_number})` : ""}${c.city ? ` — ${c.city}` : ""}`,
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
      // Added to the project's client list (not replacing earlier picks).
      setProjectClients((prev) => [...prev, { value: created.id, label: created.companyName }]);
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

  // Department options come from the managed Departments list (the
  // Departments screen / GET /api/departments), loaded at startup. This used
  // to be a hard-coded list of 8 names ("Engineering", "Sales", ...) that had
  // nothing to do with the departments actually set up in the system.
  const loadDepartmentOptions = async (inputValue) => {
    const q = (inputValue || "").toLowerCase();
    return (departments || [])
      .map(d => d.name)
      .filter(name => !q || name.toLowerCase().includes(q))
      .map(name => ({ value: name, label: name }));
  };


  // Assignee options for the CURRENT tab's department. It used to take
  // "project OR task OR ticket department" (whichever was set, from any tab),
  // search /api/users (403 for anyone without manage_users), and filter by
  // department only AFTER the server had already cut the list to 20 names.
  // Now the directory does the department filter server-side. With no
  // department picked, everyone the caller may see is offered.
  const assigneeDepartment =
    localTab === "task" ? taskDepartment :
    localTab === "ticket" ? ticketDepartment :
    localTab === "project" ? projectDepartment : "";

  const toAssigneeOption = (u) => ({
    value: u.id,
    label: `${u.name} (${u.role ? u.role.toUpperCase() : "USER"})${u.department ? ` · ${u.department}` : ""}`,
  });

  const loadAssigneeOptions = async (inputValue) => {
    try {
      const users = await searchAssignees({ search: inputValue || "", department: assigneeDepartment || "" });
      // Tasks and tickets go to staff / supervisors — admins assign, they aren't assigned.
      return users.filter((u) => !(localTab === "task" || localTab === "ticket") || isTaskAssignable(u)).map(toAssigneeOption);
    } catch (err) {
      // Offline fallback: the already-loaded people list, active only.
      const q = (inputValue || "").toLowerCase();
      return (allUsers || [])
        .filter(u => u.status === "active")
        .filter(u => !assigneeDepartment || (u.department || "").toLowerCase() === assigneeDepartment.toLowerCase())
        .filter(u => !q || (u.name || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q))
        .filter((u) => !(localTab === "task" || localTab === "ticket") || isTaskAssignable(u))
        .map(toAssigneeOption);
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
    setProjectClients([]);
    setProjectDepartment("");
    setProjectType("general");
    setShowNewClientForm(false);
    setNewClientName("");
    setNewClientContact("");
    setNewClientEmail("");
    setTaskTitle("");
    setTaskDescription("");
    setTaskChecklist([]);
    setTaskChecklistInput("");
    setTaskDueDate("");
    setTaskProjectId("");
    setTaskPriority("normal");
    setTaskDepartment("");
    setTaskAssigneeId("");
    setTicketSubject("");
    setTicketCategory(TICKET_CATEGORIES[0]);
    setTicketPriority("normal");
    setTicketProjectId("");
    setTicketClientId("");
    setTicketClientName("");
    setTicketDepartment("");
    setTicketAssigneeId("");
    setClientCompanyName("");
    setClientContactPerson("");
    setClientEmail("");
    setClientPhone("");
    setClientWebsite("");
    setClientIndustry("");
    setClientAddress("");
    setClientPersonName("");
    setClientCnic("");
    setClientMobile("");
    setClientCity("");
    setClientCustom({});
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
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsCreating(true);
    try {
      await submitForm();
    } finally {
      submittingRef.current = false;
      setIsCreating(false);
    }
  };

  const submitForm = async () => {
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
        ...(isSupportTT ? {} : { budgetValue: prjBudgetHours, budgetUnit: prjBudgetUnit }),
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
        department: projectDepartment || currentUser?.department || "",
        status: "planning",
        priority: "normal",
        clientId: projectClientId,
        clientIds: projectClients.map((o) => o.value),
        projectType, // 'general' or 'ticketing'
      };

      if (typeof createProject !== "function") return;
      // Awaited so the modal stays open (with the user's input intact) when
      // the save fails, instead of closing as if it had worked.
      const created = await createProject(newProject);
      if (!created) return;
    } else if (localTab === "task") {
      const resolvedProjectId = lockedProjectId || taskProjectId || null;

      const newTask = {
        title: taskTitle,
        priority: taskPriority,
        status: "todo",
        description: taskDescription.trim(),
        labels: [],
        subTasks: [],
        // Includes a checklist line still typed but not yet added.
        checklistItems: [...taskChecklist, taskChecklistInput].map((t) => t.trim()).filter(Boolean),
        comments: [],
        dueDate: taskDueDate || new Date().toISOString().split("T")[0],
        assignedToId: taskAssigneeId || null,
        projectId: resolvedProjectId,
        department: taskDepartment || currentUser?.department || "",
        progress: 0,
      };

      if (typeof createTask !== "function") return;
      const created = await createTask(newTask);
      if (!created) return;
    } else if (localTab === "ticket") {
      // Only what the backend reads. The SLA deadline is derived server-side
      // from the priority (see defaultSLAMinutes in ticket.go); the old
      // hard-coded 24 h dueDate, "open" status and requester fields were
      // never read by the backend. Severity is left to the backend default
      // (it was being set to the priority, which isn't a severity value).
      const newTicket = {
        title: ticketSubject,
        description: "",
        category: ticketCategory,
        priority: ticketPriority,
        department: ticketDepartment || currentUser?.department || "",
        projectId: ticketProjectId || null,
        clientId: ticketClientId || null,
        assignedToId: ticketAssigneeId || null,
      };

      if (typeof createTicket !== "function") return;
      const created = await createTicket(newTicket);
      if (!created) return;
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
        clientName: clientPersonName.trim(),
        cnic: clientCnic.trim(),
        mobile: clientMobile.trim(),
        city: clientCity.trim(),
        customFields: clientCustom,
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
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
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
                      isMulti
                      value={projectClients}
                      loadOptions={loadClientOptions}
                  noOptionsMessage={({ inputValue }) =>
                    (inputValue || "").trim().length < 2
                      ? "Type at least 2 letters to search all clients"
                      : "No client matches — check the spelling or add the client"}
                      onChange={(options) => setProjectClients(options || [])}
                      placeholder="Search and add one or more clients..."
                      styles={customStyles}
                    />
                    {projectClients.length > 1 && (
                      <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1">
                        {projectClients[0].label} is the primary client.
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
                  Budget
                </label>
                <div className="flex gap-2">
                  <input
                    id="prj-budget-input"
                    type="number"
                    min={0}
                    step="0.5"
                    value={prjBudgetHours}
                    onChange={(e) => setPrjBudgetHours(Number(e.target.value))}
                    className="flex-1 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                  />
                  <select
                    value={prjBudgetUnit}
                    onChange={(e) => setPrjBudgetUnit(e.target.value)}
                    className="px-3 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:outline-hidden"
                  >
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                  </select>
                </div>
                {prjBudgetUnit === "days" && (
                  <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1">= {(Number(prjBudgetHours) || 0) * 8} hours (8 h per day)</p>
                )}
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
                  disabled={isCreating}
                  className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isCreating ? 'Creating...' : 'Create Project'}
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
                  Description
                </label>
                <textarea
                  rows={3}
                  placeholder="What needs to be done, where, and any details the assignee needs..."
                  value={taskDescription}
                  onChange={(e) => setTaskDescription(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Checklist ({taskChecklist.length})
                </label>
                {taskChecklist.length > 0 && (
                  <ul className="mb-2 space-y-1">
                    {taskChecklist.map((item, idx) => (
                      <li key={idx} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-zinc-700 text-xs text-slate-800 dark:text-zinc-200">
                        <span className="min-w-0 truncate">☐ {item}</span>
                        <button type="button" onClick={() => setTaskChecklist((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-slate-400 hover:text-rose-600 cursor-pointer" title="Remove">✕</button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Add a checklist step and press Enter..."
                    value={taskChecklistInput}
                    onChange={(e) => setTaskChecklistInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const v = taskChecklistInput.trim();
                        if (v) { setTaskChecklist((prev) => [...prev, v]); setTaskChecklistInput(""); }
                      }
                    }}
                    className="flex-1 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                  />
                  <button type="button"
                    onClick={() => { const v = taskChecklistInput.trim(); if (v) { setTaskChecklist((prev) => [...prev, v]); setTaskChecklistInput(""); } }}
                    className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-300/70 hover:bg-slate-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-800 dark:text-zinc-200 cursor-pointer">
                    Add
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Due date
                </label>
                <input
                  type="date"
                  value={taskDueDate}
                  onChange={(e) => setTaskDueDate(e.target.value)}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
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
                {/* key: remount when the department changes, so cached
                    options from the previous department aren't shown. */}
                <AsyncSelect
                  key={`assignee-${taskDepartment || "all"}`}
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
                  disabled={isCreating}
                  className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isCreating ? 'Creating...' : 'Create Task'}
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

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                  Client (who raised it)
                </label>
                <AsyncSelect
                  cacheOptions
                  defaultOptions
                  isSearchable
                  isClearable
                  loadOptions={loadClientOptions}
                  noOptionsMessage={({ inputValue }) =>
                    (inputValue || "").trim().length < 2
                      ? "Type at least 2 letters to search all clients"
                      : "No client matches — check the spelling or add the client"}
                  onChange={(option) => {
                    setTicketClientId(option ? option.value : "");
                    setTicketClientName(option ? option.label : "");
                  }}
                  placeholder="Type 2+ letters of the client's name or ID..."
                  styles={customStyles}
                />
                {ticketClientName && (
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">Selected: {ticketClientName}</p>
                )}
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
                {/* key: remount when the department changes, so cached
                    options from the previous department aren't shown. */}
                <AsyncSelect
                  key={`assignee-${ticketDepartment || "all"}`}
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
                  disabled={isCreating}
                  className="px-5 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-xs cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isCreating ? 'Creating...' : 'Create Ticket'}
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

              {/* Spec slide 8: client name, CNIC (optional), mobile, city */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  ["Client name (person)", clientPersonName, setClientPersonName, "e.g. Muhammad Ali"],
                  ["CNIC (optional)", clientCnic, setClientCnic, "12345-1234567-1"],
                  ["Mobile", clientMobile, setClientMobile, "03xx-xxxxxxx"],
                  ["City", clientCity, setClientCity, "e.g. Mardan"],
                ].map(([label, val, setter, ph]) => (
                  <div key={label}>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">{label}</label>
                    <input type="text" value={val} placeholder={ph} onChange={(e) => setter(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 bg-slate-100 dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-hidden" />
                  </div>
                ))}
              </div>

              {/* Admin-defined extra fields */}
              <CustomFieldInputs values={clientCustom} onChange={setClientCustom} />

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
                  noOptionsMessage={({ inputValue }) =>
                    (inputValue || "").trim().length < 2
                      ? "Type at least 2 letters to search all clients"
                      : "No client matches — check the spelling or add the client"}
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