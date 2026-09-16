package models

import (
	"time"

	"gorm.io/gorm"
)

// --- User ------------------------------------------------------------------

type User struct {
	gorm.Model
	Name     string `json:"name"`
	Email    string `json:"email" gorm:"unique"`
	Password string `json:"-"`
	Role     string `json:"role"` // super_admin, admin, supervisor, staff

	Avatar     string `json:"avatar"`
	Department string `json:"department"`
	Title      string `json:"title"` // job title, e.g. "VP of Engineering"
	Phone      string `json:"phone"`
	Status     string `json:"status"` // active, deactivated

	// ManagerID is kept for backward compatibility with the existing
	// Register endpoint, which already binds it. It's superseded by the
	// two explicit hierarchy fields below for anything new — a Staff
	// member's Supervisor and their department's Admin are two distinct
	// people in this org chart, which a single ManagerID can't represent.
	ManagerID *uint `json:"manager_id,omitempty"`
	Manager   *User `json:"manager,omitempty" gorm:"foreignKey:ManagerID"`

	SupervisorID *uint `json:"supervisor_id,omitempty"`
	Supervisor   *User `json:"supervisor,omitempty" gorm:"foreignKey:SupervisorID"`

	AdminID *uint `json:"admin_id,omitempty"`
	// Field deliberately named AdminUser, not Admin — Project ALSO has a
	// field literally named Admin pointing at User via the same AdminID
	// pattern. GORM derives auto-migration constraint names from the
	// association's Go field name, and that exact-name collision caused
	// GORM to misattach Project's fk_projects_admin constraint onto
	// users.admin_id instead of projects.admin_id — so inserting a User
	// with a real admin_id (referencing another User) was being checked
	// against projects.id instead of users.id, failing for any admin_id
	// that wasn't also a valid project id. The json tag stays "admin" so
	// nothing on the API/frontend side needs to change.
	AdminUser *User `json:"admin,omitempty" gorm:"foreignKey:AdminID"`
}

// --- Attachments -------------------------------------------------------
//
// One real, FK-backed table per owner type (Project/Task/Ticket) rather
// than a single polymorphic table. A polymorphic design (one OwnerID +
// an OwnerType string) can't have a database-enforced foreign key, since
// a SQL FK can only ever point at one specific table — so nothing would
// stop an attachment from silently pointing at a project/task/ticket ID
// that no longer exists, and cascading deletes would have to be
// hand-written in application code instead of guaranteed by the
// database. AttachmentFields holds the columns all three have in common
// so the repetition is just the FK + relation, not the whole struct.

type AttachmentFields struct {
	Name         string    `json:"name"`
	Size         string    `json:"size"` // formatted, e.g. "4.2 MB" — matches existing frontend display format
	Type         string    `json:"type"` // "image", "pdf", "xlsx", "md", etc.
	URL          string    `json:"url"`
	UploadedByID *uint     `json:"uploaded_by_id"`
	UploadedBy   *User     `json:"uploaded_by,omitempty" gorm:"foreignKey:UploadedByID"`
	UploadedAt   time.Time `json:"uploaded_at"`
}

type ProjectAttachment struct {
	gorm.Model
	AttachmentFields
	ProjectID uint `json:"project_id" binding:"required"`
}

type TaskAttachment struct {
	gorm.Model
	AttachmentFields
	TaskID uint `json:"task_id" binding:"required"`
}

type TicketAttachment struct {
	gorm.Model
	AttachmentFields
	TicketID uint `json:"ticket_id" binding:"required"`
}

// --- Client ------------------------------------------------------------
//
// One client can have many projects over time — a client isn't scoped to
// a single engagement — so this is a real one-to-many via a ClientID
// foreign key on Project, not a many2many. A project belongs to exactly
// one client (or none, for internal work), which is what ClientID being
// a nullable *uint captures directly.

type Client struct {
	gorm.Model
	CompanyName   string `json:"company_name" binding:"required"`
	ContactPerson string `json:"contact_person"`
	Email         string `json:"email"`
	Phone         string `json:"phone"`
	Website       string `json:"website"`
	Industry      string `json:"industry"`
	Address       string `json:"address"`

	Projects []Project `json:"projects,omitempty" gorm:"foreignKey:ClientID"`
}

// --- Project -----------------------------------------------------------

type Project struct {
	gorm.Model
	Code        string `json:"code" gorm:"unique"` // e.g. "PRJ-ENG-01"
	Title       string `json:"title" binding:"required"`
	Description string `json:"description"`
	Department  string `json:"department"`
	Status      string `json:"status"`   // planning, active, on_hold, completed
	Priority    string `json:"priority"` // normal, critical

	StartDate string `json:"start_date"`
	DueDate   string `json:"due_date"`
	// Deadline is kept for backward compatibility with any existing rows
	// or code still reading it; DueDate is the field going forward.
	Deadline string `json:"deadline,omitempty"`

	OwnerID  *uint   `json:"owner_id"`
	Owner    *User   `json:"owner" gorm:"foreignKey:OwnerID"`
	AdminID  *uint   `json:"admin_id"`
	ClientID *uint   `json:"client_id"`
	Client   *Client `json:"client,omitempty" gorm:"foreignKey:ClientID"`
	// constraint:- deliberately disables GORM's auto-generated DB-level
	// foreign key constraint for this specific relationship. Two rounds
	// of trying to fix a constraint-naming collision by renaming the Go
	// association field (on User's own self-referential Admin/AdminID)
	// had NO effect on the actual generated constraint — same name, same
	// wrong table, every time — which means the collision isn't coming
	// from where that fix assumed. Rather than guess at GORM's internal
	// naming algorithm a third time, this sidesteps it entirely: no
	// constraint gets generated for Project->User here, so there's no
	// name for GORM to get wrong. The Go-level association (used for
	// Preload("Admin") etc.) is unaffected — only the raw DB constraint
	// is skipped. Access control for projects is already properly
	// enforced via Members/Supervisors below; this field is closer to
	// informational.
	Admin *User `json:"admin" gorm:"foreignKey:AdminID;constraint:-"`

	// Real many2many join tables — memberIds/supervisorIds gate who can
	// SEE this project (see filterProjectsForUser), so this is an
	// access-control decision. A comma-separated string of ids has no
	// referential integrity: delete a user and every project's member
	// list still lists their old id as inert text, with nothing flagging
	// the dangling reference. A join table gets a real foreign key,
	// ON DELETE CASCADE handled by the database, and "all projects Alex
	// is on" is a plain join instead of parsing a string.
	Members     []User `json:"members,omitempty" gorm:"many2many:project_members;"`
	Supervisors []User `json:"supervisors,omitempty" gorm:"many2many:project_supervisors;"`

	Progress         int  `json:"progress"`
	ProgressOverride bool `json:"progress_override"` // when true, Progress is manually pinned rather than computed from task completion

	BudgetHours float64 `json:"budget_hours"`
	SpentHours  float64 `json:"spent_hours"`

	IsPinned bool `json:"is_pinned"`

	// Comma-separated. Unlike Members/Supervisors, tags aren't an
	// access-control decision and don't reference another entity's
	// lifecycle — nothing "dangles" if a tag string has a typo, so the
	// lighter-weight representation (matching the existing Task.Labels
	// pattern) is appropriate here, not a reliability compromise.
	Tags string `json:"tags"`

	Attachments []ProjectAttachment `json:"attachments,omitempty" gorm:"foreignKey:ProjectID"`
}

// --- Checklist (Task) ---------------------------------------------------

type Checklist struct {
	gorm.Model
	TaskID        uint       `json:"task_id" binding:"required"`
	Title         string     `json:"title" binding:"required"`
	Completed     bool       `json:"completed"`
	CompletedByID *uint      `json:"completed_by_id,omitempty"`
	CompletedBy   *User      `json:"completed_by,omitempty" gorm:"foreignKey:CompletedByID"`
	CompletedAt   *time.Time `json:"completed_at,omitempty"`
}

// --- Task ----------------------------------------------------------------

type Task struct {
	gorm.Model
	TaskNumber  string `json:"task_number" gorm:"unique"` // e.g. "TSK-101"
	Title       string `json:"title" binding:"required"`
	Description string `json:"description"`
	Department  string `json:"department"`
	Status      string `json:"status"`   // new, todo, in_progress, on_hold, under_review, completed, closed
	Priority    string `json:"priority"` // low, normal, high, urgent, critical
	Labels      string `json:"labels"`   // comma-separated — descriptive only, not access-control, same reasoning as Project.Tags

	ProjectID *uint    `json:"project_id"`
	Project   *Project `json:"project,omitempty" gorm:"foreignKey:ProjectID"`

	AssigneeID *uint `json:"assignee_id"`
	Assignee   *User `json:"assignee,omitempty" gorm:"foreignKey:AssigneeID"`

	CreatorID *uint `json:"creator_id,omitempty"`
	Creator   *User `json:"creator,omitempty" gorm:"foreignKey:CreatorID"`

	// Deliberately NOT stored here: SupervisorID/AdminID. Denormalizing
	// them onto every task is exactly the kind of "two copies of the
	// truth that can silently disagree" that caused the role-demotion bug
	// earlier — if a person's org-chart supervisor changes, every task
	// they were ever assigned would still show the OLD supervisor unless
	// something remembers to bulk-update every historical row, and if
	// that update is ever missed there's no error, just quietly wrong
	// routing. Derive them at query/handler time from
	// Assignee.SupervisorID / Assignee.AdminID instead — there's only one
	// copy of the fact, so there's nothing to drift. If a point-in-time
	// snapshot is ever needed for audit purposes, that belongs in
	// AuditLog.Details as a snapshot string, not duplicated onto the live
	// routing record.

	Progress       int     `json:"progress"`
	StartDate      string  `json:"start_date"`
	DueDate        string  `json:"due_date"`
	EstimatedHours float64 `json:"estimated_hours"`
	ActualHours    float64 `json:"actual_hours"`

	IsPinned bool `json:"is_pinned"`

	ReviewStatus string `json:"review_status"` // none, submitted_for_review, supervisor_approved, admin_approved, reopened
	ReviewNotes  string `json:"review_notes"`

	Checklists []Checklist `json:"checklists,omitempty" gorm:"foreignKey:TaskID"`
	SubTasks   []SubTask   `json:"sub_tasks,omitempty" gorm:"foreignKey:TaskID"`
	Comments   []Comment   `json:"comments,omitempty" gorm:"foreignKey:TaskID"`

	Attachments []TaskAttachment `json:"attachments,omitempty" gorm:"foreignKey:TaskID"`

	// Real self-referential many2many rather than a comma-separated list
	// of task numbers: a dependency references another Task row's actual
	// lifecycle (if that task is deleted, a dangling "depends on TSK-103"
	// string would silently claim a relationship to nothing), so it gets
	// the same FK treatment as Members/Supervisors above.
	DependsOn []Task `json:"depends_on,omitempty" gorm:"many2many:task_dependencies;"`
}

// --- Ticket ----------------------------------------------------------------

type Ticket struct {
	gorm.Model
	TicketNumber string `json:"ticket_number"`
	Title        string `json:"title"`
	Description  string `json:"description"`
	Department   string `json:"department"`
	Category     string `json:"category"`
	Priority     string `json:"priority"` // low, normal, high, urgent, critical
	Severity     string `json:"severity"` // minor, moderate, major, critical — distinct axis from Priority
	Status       string `json:"status"`   // open, in_progress, escalated, resolved, closed

	// External customer contact info. This was entirely absent before —
	// a ticket system with no way to record who the actual requester is.
	RequesterName    string `json:"requester_name"`
	RequesterEmail   string `json:"requester_email"`
	RequesterCompany string `json:"requester_company"`

	ProjectID *uint    `json:"project_id,omitempty"`
	Project   *Project `json:"project,omitempty" gorm:"foreignKey:ProjectID"`

	AssignedToID *uint `gorm:"column:assigned_to_id" json:"assigned_to_id"`
	AssignedTo   *User `gorm:"foreignKey:AssignedToID" json:"assigned_to,omitempty"`

	// Same reasoning as Task above: SupervisorID/AdminID deliberately NOT
	// stored — derive from AssignedTo.SupervisorID / AssignedTo.AdminID.

	DueDate string `json:"due_date"`

	ResponseSlaMinutes   int        `json:"response_sla_minutes"`
	ResolutionSlaMinutes int        `json:"resolution_sla_minutes"`
	FirstResponseAt      *time.Time `json:"first_response_at,omitempty"`
	ResolvedAt           *time.Time `json:"resolved_at,omitempty"`
	ClosedAt             *time.Time `json:"closed_at,omitempty"`

	EscalationLevel  string `json:"escalation_level"` // none, supervisor, admin, super_admin
	EscalationReason string `json:"escalation_reason"`

	ResolutionSummary string `json:"resolution_summary"`

	Labels   string `json:"labels"` // comma-separated, same reasoning as Project.Tags / Task.Labels
	IsPinned bool   `json:"is_pinned"`

	Comments    []Comment          `json:"comments,omitempty" gorm:"foreignKey:TicketID"`
	Attachments []TicketAttachment `json:"attachments,omitempty" gorm:"foreignKey:TicketID"`
}

// --- SubTask ---------------------------------------------------------------

type SubTask struct {
	gorm.Model
	Title      string `json:"title" binding:"required"`
	Status     string `json:"status"`   // todo, in_progress, completed
	Priority   string `json:"priority"` // low, normal, high
	Deadline   string `json:"deadline"`
	TaskID     uint   `json:"task_id" binding:"required"`
	AssigneeID *uint  `json:"assignee_id"`
	Assignee   *User  `json:"assignee,omitempty" gorm:"foreignKey:AssigneeID"`

	EstimatedHours float64 `json:"estimated_hours"`
	ActualHours    float64 `json:"actual_hours"`
}

// --- Comment -----------------------------------------------------------
//
// Consolidates what the frontend currently splits across three
// overlapping concepts (task comments, ticket public comments, ticket
// internal-only notes, PLUS a separate "unified responses" array used by
// just one drawer) into a single model. Comment already correctly
// supports either a Task or a Ticket via the two nullable FKs below;
// IsInternal is the one addition needed to also cover the
// internal-note/public-reply distinction that ticket comments need.

type Comment struct {
	gorm.Model
	Content    string `json:"content" binding:"required"`
	UserID     uint   `json:"user_id" binding:"required"`
	User       User   `json:"user" gorm:"foreignKey:UserID"`
	TaskID     *uint  `json:"task_id"`     // Optional: Null if it belongs to a ticket
	TicketID   *uint  `json:"ticket_id"`   // Optional: Null if it belongs to a task
	IsInternal bool   `json:"is_internal"` // true = staff-only note, false = visible to the requester
}
