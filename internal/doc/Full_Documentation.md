# APEX CORE — Complete Application Documentation

## I. Application

### Dashboard

- Real-time overview of workload: tasks and tickets assigned to the user, pinned projects,
  recent activity, and key service-level indicators.
- Quick-create shortcut for new tasks, tickets, clients, and projects from a single modal.
- Global search across the whole system (users, projects, tasks, tickets) from anywhere.

### Projects

- A project groups related tasks under one program of work, optionally tied to a client.
- Fields: code, title, description, department, status (planning / active / on hold /
  completed), priority, start/due dates, budgeted and spent hours, tags, members,
  supervisors, owner, admin.
- Projects can be **pinned** for quick access.
- Progress is computed automatically from the completion state of the included tasks.

### Tasks

- Individual pieces of work, optionally belonging to a project, assigned to a specific person.
- Fields: task number, title, description, department, status, priority, progress, dates,
  estimated vs. actual hours, labels, dependencies, checklist items, subtasks.
- **Status lifecycle:** new → todo → in progress → under review → completed (with a
  review/approval step), plus on hold.
- **Review workflow:** a worker submits finished work; the worker's supervisor (or the
  department admin, or any reviewer the organization allows) approves it, or reopens it with
  notes. Work cannot silently reach "completed" without going through this step.
- **Checklist items** can be marked done; task progress tracks the share of completed items.
- **Subtasks** break a task into smaller tracked pieces, each assignable.
- **Comments** allow ongoing discussion on the task record.
- **Dependencies** let a task declare it depends on other tasks, so ordering is visible.

### Kanban Board

- Visual drag-and-drop (or step-based) view of tasks organized by status column.
- Same filtering, priority, and label handling as the task list; a fast way to move work
  through its lifecycle.

### Tickets (Customer Support)

- Requests from external customers (or internal requests filed like tickets).
- Fields: ticket number, title, description, category, department, priority, severity,
  status, requester name/email/company, assignee, due date, labels, linked project.
- **SLA tracking:** each ticket carries a response SLA (how long until first response) and
  resolution SLA (how long until resolution). The ticket stores actual first-response,
  resolved, and closed timestamps. If the due time has passed and the ticket is still open,
  it is flagged as **breached**.
- **Status lifecycle:** open → in progress (→ escalated) → resolved → closed.
- **Escalation:** a ticket can be escalated to a supervisor/admin level with an explicit
  reason; escalation is a one-way action that records the level and reason.
- **Resolution summary:** when a ticket is resolved, the person resolving it records the
  summary; reopening/closing preserves it.
- **Communication model:**
  - Public responses shown to the customer.
  - Internal notes visible only to the support team.
    Both are stored on the same ticket timeline with clear labeling.

### Clients (Company Profiles)

- A client profile holds company name, contact person, email, phone, website, industry, and
  address. Projects can be attached to a client.
- Only Admin / Super Admin can create, edit, or delete client profiles.

### Team (People & Organization)

- Directory of every user account with role, department, title, phone, status, avatar.
- Organization-hierarchy mapping: each user may reference a supervisor and a department admin.
- Staff can edit their own profile (name, title, phone, department, avatar) and change their
  password. Admins manage the people in their scope.

### Reports

- **System Report:** counts and summaries across the system — tasks by status, tasks by
  priority, tickets by status, ticket SLA adherence (on-time vs breached), resolved/closed
  task counts, per-department breakdowns.
- Chart views (doughnut/bar) plus a data table, with CSV export.

### Audit & Governance Logs

- Immutable-like timeline of important actions: who did what to which record and when,
  including escalations, review submissions, approvals, deactivations, and settings changes.
- Viewable only by Admin / Super Admin. Exportable to CSV.

### Settings

- Permission-matrix management for custom roles (role keys, allowed modules).
- Add users into the system (name, email, role, department, hierarchy links).
- System/service-level preferences storage.

### Notifications

- Assigned/urgent tickets, review requests, escalations, and system notices surface in a
  notification drawer, per recipient.

---

## II. Roles & Permissions

Four built-in roles control what each person can see and do:

| Role        | What they can do                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Super Admin | Full access to every module, every record, audit logs, settings, permission matrix, client management.                                      |
| Admin       | Department-scoped management: their department's projects/tasks/tickets, people they manage, client and project administration, audit logs. |
| Supervisor  | The tasks/tickets they supervise or that are assigned to them, review/approve work from their team, escalate tickets.                       |
| Staff       | The tasks and tickets assigned to them; comment; update checklist and progress; submit work for review.                                     |

Practical consequences:

- A **Staff** member sees only records assigned to them.
- A **Supervisor** sees records they were assigned or that they supervise, and can approve or
  reopen submitted work.
- An **Admin / Super Admin** sees their department's full workload plus the governance modules.
- Role and email cannot be changed through the ordinary profile endpoint — role changes are
  an administrative/controlled action.

---

## III. Data Model (Main Record Types)

| Record         | Purpose                                                    | Key relationships                                                                                                 |
| -------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| User           | An account with a role, department, title, avatar, status. | Has supervisor, admin, manager references.                                                                        |
| Client         | An external company profile.                               | Owns projects.                                                                                                    |
| Project        | A program of work, optionally for a client.                | Belongs to client; many users as members/supervisors; many tasks.                                                 |
| Task           | A unit of work.                                            | Belongs to project (optional); assignee; creator; checklist items; subtasks; comments; attachments; dependencies. |
| Checklist item | A to-do within a task.                                     | Belongs to one task.                                                                                              |
| SubTask        | A tracked sub-piece of a task.                             | Belongs to one task; optional assignee.                                                                           |
| Ticket         | A customer request.                                        | Optional project; assignee; comments; attachments; SLA fields; escalation fields.                                 |
| Comment        | A discussion entry (public or internal).                   | Belongs to exactly one task OR one ticket; author user.                                                           |
| Audit Log      | A governance trail entry.                                  | References an actor user and an affected record.                                                                  |

All records carry creation and last-update timestamps. Deletes are soft where appropriate so
history and references remain intact.

---

## IV. Key Workflows

### Task lifecycle with review

1. Task created (number auto-assigned) and assigned to a person.
2. Worker moves it through new → todo → in progress, updating progress and checklist items.
3. Worker submits the task for review with notes.
4. A reviewer (supervisor/admin) approves it — completing the task — or reopens it for changes.
5. Completed tasks show as done across dashboards and reports.

### Build a task that reports to a project

Creating a task linked to a project means its completion state feeds the project's
auto-computed progress, so project reporting stays truthful without manual updates.

### Customer ticket from receipt to close

1. Ticket created (number auto-assigned) with requester identity, severity, and SLA deadlines.
2. Agent updates status, posts public responses and internal notes on the same timeline.
3. Breach gets flagged if response/resolution time passes while the ticket is unresolved.
4. Serious issues are escalated with level + reason.
5. On resolution the agent records a resolution summary; then the ticket is closed. Timestamps
   are stored automatically the first time the ticket reaches each state.

### Adding a user

Admins create accounts with name, email, role, department, and hierarchy links. The created
person can sign in immediately. Their role determines everything they can see afterwards.

### Managing clients and projects (admin-only)

- Create a client profile.
- Create a project on top of that client; add members and supervisors.
- Tasks created under the project inherit its reporting context.

---
