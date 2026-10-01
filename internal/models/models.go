package models

import (
	"time"

	"gorm.io/gorm"
)

// --- Feasibility -----------------------------------------------------------

type FeasibilityVendor struct {
	gorm.Model
	FeasibilityID uint         `json:"feasibility_id" binding:"required"`
	Feasibility   *Feasibility `json:"feasibility,omitempty" gorm:"foreignKey:FeasibilityID"`
	// The vendor in the vendor master (spec slides 30-31: Vendors). Filled
	// in automatically on create (see vendor.go). VendorName keeps the name
	// as it was on this feasibility, so history reads correctly even if the
	// master record is renamed later.
	VendorID      *uint        `json:"vendor_id,omitempty" gorm:"index"`
	VendorName    string       `json:"vendor_name" binding:"required"`
	Status        string       `json:"status"`
	ResponseNotes string       `json:"response_notes"`
	ContactPerson string       `json:"contact_person"`
	ContactEmail  string       `json:"contact_email"`
	ContactPhone  string       `json:"contact_phone"`
	QuotationRef  string       `json:"quotation_ref"`
	EvidenceURLs  string       `json:"evidence_urls"`
	RespondedAt   *time.Time   `json:"responded_at,omitempty"`
	// Withdrawn instead of deleted: the vendor stays on the feasibility with
	// its quotes / responses, greyed out, and can be reinstated.
	Withdrawn     bool       `json:"withdrawn"`
	WithdrawnAt   *time.Time `json:"withdrawn_at,omitempty"`
	WithdrawnByID *uint      `json:"withdrawn_by_id,omitempty"`
}

type FeasibilityAttachment struct {
	gorm.Model
	FeasibilityID uint      `json:"feasibility_id" binding:"required"`
	Name          string    `json:"name"`
	Size          string    `json:"size"`
	Type          string    `json:"type"`
	URL           string    `json:"url"`
	UploadedByID  *uint     `json:"uploaded_by_id"`
	UploadedBy    *User     `json:"uploaded_by,omitempty" gorm:"foreignKey:UploadedByID"`
	UploadedAt    time.Time `json:"uploaded_at"`
}

type Feasibility struct {
	gorm.Model
	FeasibilityNumber string `json:"feasibility_number" gorm:"unique"`

	ClientID *uint   `json:"client_id"`
	Client   *Client `json:"client,omitempty" gorm:"foreignKey:ClientID"`

	Product            string `json:"product" binding:"required"`
	Capacity           string `json:"capacity"`
	FromLocation       string `json:"from_location"`
	ToLocation         string `json:"to_location"`
	City               string `json:"city"`
	RequirementDetails string `json:"requirement_details"`

	AssignedDept   string `json:"assigned_dept"`
	AssignedUserID *uint  `json:"assigned_user_id"`
	AssignedUser   *User  `json:"assigned_user,omitempty" gorm:"foreignKey:AssignedUserID"`

	// Who raised it (e.g. sales / CNOC). The creator can always see and
	// follow up on their own request. Empty on records created before this
	// was recorded.
	CreatedByID *uint `json:"created_by_id,omitempty" gorm:"index"`
	CreatedBy   *User `json:"created_by,omitempty" gorm:"foreignKey:CreatedByID"`

	Priority string `json:"priority"`
	Status   string `json:"status"` // draft, in_progress, feasible, not_feasible, converted, cancelled, archived
	Notes    string `json:"notes"`

	TargetDate  string     `json:"target_date"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`

	// See the matching comment on Project.ArchivedAt further up this file.
	ArchivedAt   *time.Time `json:"archived_at,omitempty"`
	ArchivedByID *uint      `json:"archived_by_id,omitempty"`
	PreArchiveStatus string     `json:"pre_archive_status,omitempty"` // status before archiving; Restore returns to it

	ConvertedProjectID *uint      `json:"converted_project_id,omitempty"`
	ConvertedProject   *Project   `json:"converted_project,omitempty" gorm:"foreignKey:ConvertedProjectID"`
	ConvertedAt        *time.Time `json:"converted_at,omitempty"`

	Vendors     []FeasibilityVendor     `json:"vendors,omitempty" gorm:"foreignKey:FeasibilityID"`
	Attachments []FeasibilityAttachment `json:"attachments,omitempty" gorm:"foreignKey:FeasibilityID"`
}

// --- User ----------------------------------------------------------------

type User struct {
	gorm.Model
	// Permanent ID, USR-000001 (spec slide 7). Set automatically on create.
	UserNumber string `json:"user_number" gorm:"size:20;index"`
	Name         string     `json:"name"`
	Email        string     `json:"email" gorm:"uniqueIndex"`
	Password     string     `json:"-"`
	Role         string     `json:"role" gorm:"default:'staff'"` // super_admin, admin, supervisor, staff
	Department   string     `json:"department"`                  // e.g. "Technical", "Support", "Feasibility"
	SupportTier  string     `gorm:"size:4" json:"support_tier,omitempty"` // CNOC support tier: L1..L4 (empty outside CNOC)
	Title        string     `json:"title"`                       // job title
	Phone        string     `json:"phone"`
	Avatar       string     `json:"avatar"`
	Status       string     `json:"status" gorm:"default:'active'"` // active, inactive
	// Archive instead of delete (spec slides 4/29: nothing is permanently
	// deleted). An archived user can't sign in and isn't offered as an
	// assignee, but their name stays on everything they did.
	ArchivedAt       *time.Time `json:"archived_at,omitempty"`
	ArchivedByID     *uint      `json:"archived_by_id,omitempty"`
	PreArchiveStatus string     `json:"pre_archive_status,omitempty"`
	ManagerID    *uint      `json:"manager_id,omitempty"`
	Manager      *User      `json:"manager,omitempty" gorm:"foreignKey:ManagerID"`
	SupervisorID *uint      `json:"supervisor_id,omitempty"`
	Supervisor   *User      `json:"supervisor,omitempty" gorm:"foreignKey:SupervisorID"`
	// Set whenever the password changes; sessions issued before it stop
	// working (see middleware.AuthenticateJWT).
	PasswordChangedAt *time.Time `json:"-"`
	LastLoginAt  *time.Time `json:"last_login_at,omitempty"`
}

// --- Client --------------------------------------------------------------

type Client struct {
	gorm.Model
	// Auto-generated on create (see CreateClient in client.go), matching
	// the same permanent-ID pattern already used for Task/Ticket/
	// Feasibility — this was the one major entity still missing it.
	ClientNumber  string `json:"client_number" gorm:"uniqueIndex"`
	CompanyName   string `json:"company_name" binding:"required"`
	// Spec slide 8 fields: the client (person) name, CNIC (optional) and a
	// mobile number separate from the telephone.
	ClientName    string `json:"client_name"`
	CNIC          string `json:"cnic"`
	Mobile        string `json:"mobile"`
	// Values for the admin-defined extra fields (ClientField), keyed by the
	// field's key. Slide 8: "Additional fields should be configurable later by
	// an authorized Admin — no schema change required".
	CustomFields  JSONMap `json:"custom_fields" gorm:"type:jsonb;default:'{}'"`
	ContactPerson string `json:"contact_person"`
	Email         string `json:"email"`
	Phone         string `json:"phone"`
	Website       string `json:"website"`
	Industry      string `json:"industry"`
	Address       string `json:"address"`
	City          string `json:"city"`
	Country       string `json:"country"`
	Notes         string `json:"notes"`
	Status        string `json:"status" gorm:"default:'active'"` // active, inactive, archived

	// Who created the client record. The creator can always see it (e.g. a
	// staff member who added it inline while raising a feasibility). Empty
	// on records created before this was recorded.
	CreatedByID *uint `json:"created_by_id,omitempty" gorm:"index"`

	// Set per response, never stored: "reference" means the caller sees this
	// client only because of related work (a project / ticket / feasibility
	// they can see), so they get the name and ID but no contact details.
	AccessLevel string `gorm:"-" json:"access_level,omitempty"`

	// See the matching comment on Project.ArchivedAt further down this
	// file — same reasoning: Client is one of the six entities the spec
	// explicitly names as "never permanently deleted."
	ArchivedAt   *time.Time `json:"archived_at,omitempty"`
	ArchivedByID *uint      `json:"archived_by_id,omitempty"`
	PreArchiveStatus string     `json:"pre_archive_status,omitempty"` // status before archiving; Restore returns to it
}

// --- Project -------------------------------------------------------------

// ProjectType distinguishes between general project work and ticketing projects
type ProjectType string

const (
	ProjectTypeGeneral   ProjectType = "general"
	ProjectTypeTicketing ProjectType = "ticketing"
)

type Project struct {
	gorm.Model
	Code        string      `json:"code" gorm:"uniqueIndex"`
	Title       string      `json:"title" binding:"required"`
	Description string      `json:"description"`
	Type        ProjectType `json:"type" gorm:"type:varchar(20);default:'general'"` // general, ticketing
	Department  string      `json:"department"`                                     // owning department
	Status      string      `json:"status" gorm:"default:'planning'"`               // planning, active, on_hold, completed, cancelled, archived

	// Archiving replaces hard-delete for this entity (see DeleteProject in
	// projects.go): "delete" sets Status to "archived" and stamps these
	// two fields, rather than calling GORM's Delete(), which would soft-
	// delete via DeletedAt and hide the record from every default query.
	// The spec is explicit that nothing should become invisible to
	// authorized management — an archived project must still be
	// reachable (GET /projects/:id always works; GET /projects only
	// excludes it when no status filter is given). ArchivedAt/ArchivedByID
	// are visible fields for the same reason CompletedAt is a visible
	// field below, rather than something buried only in the audit log.
	ArchivedAt   *time.Time `json:"archived_at,omitempty"`
	ArchivedByID *uint      `json:"archived_by_id,omitempty"`
	PreArchiveStatus string     `json:"pre_archive_status,omitempty"` // status before archiving; Restore returns to it
	Priority     string     `json:"priority" gorm:"default:'normal'"` // low, normal, high, critical
	StartDate    *time.Time `json:"start_date"`
	DueDate      *time.Time `json:"due_date"`
	CompletedAt  *time.Time `json:"completed_at,omitempty"`

	// Primary client (the first one linked) — kept for everything that shows
	// "the" client of a project. The full set is Clients (spec slide 9: a
	// project can belong to more than one client, a client can have many
	// projects).
	ClientID *uint    `json:"client_id"`
	Client   *Client  `json:"client,omitempty" gorm:"foreignKey:ClientID"`
	Clients  []Client `json:"clients,omitempty" gorm:"many2many:project_clients;"`
	OwnerID  *uint   `json:"owner_id"`
	Owner    *User   `json:"owner,omitempty" gorm:"foreignKey:OwnerID"`
	AdminID  *uint   `json:"admin_id"`
	Admin    *User   `json:"admin,omitempty" gorm:"foreignKey:AdminID"`

	Progress    int     `json:"progress" gorm:"default:0"` // 0-100
	// Filled per response from the project's tasks (not stored): how many
	// tasks count towards progress, and how many are finished.
	TasksTotal int `gorm:"-" json:"tasks_total"`
	TasksDone  int `gorm:"-" json:"tasks_done"`
	BudgetHours float64 `json:"budget_hours"`
	// The budget as entered: BudgetValue in BudgetUnit ("hours" | "days").
	// BudgetHours above is always the same budget in hours (1 day = 8 h), so
	// reports and totals stay comparable whichever unit was used.
	BudgetValue float64 `json:"budget_value"`
	BudgetUnit  string  `json:"budget_unit" gorm:"size:10;default:'hours'"`
	SpentHours  float64 `json:"spent_hours"`

	// Relationships
	Members     []User   `json:"members,omitempty" gorm:"many2many:project_members;"`
	Supervisors []User   `json:"supervisors,omitempty" gorm:"many2many:project_supervisors;"`
	Tasks       []Task   `json:"tasks,omitempty" gorm:"foreignKey:ProjectID"`
	Tickets     []Ticket `json:"tickets,omitempty" gorm:"foreignKey:ProjectID"`
}

// --- Ticket --------------------------------------------------------------

type Ticket struct {
	gorm.Model
	TicketNumber string `json:"ticket_number" gorm:"uniqueIndex"`
	Title        string `json:"title" binding:"required"`
	Description  string `json:"description"`
	Category     string `json:"category"`                    // incident, request, problem, change
	Status       string `json:"status" gorm:"default:'new'"` // new, assigned, in_progress, pending, resolved, closed, cancelled, archived

	// See the matching comment on Project.ArchivedAt in this file —
	// same reasoning, same "delete" behavior, applied consistently.
	ArchivedAt   *time.Time `json:"archived_at,omitempty"`
	ArchivedByID *uint      `json:"archived_by_id,omitempty"`
	PreArchiveStatus string     `json:"pre_archive_status,omitempty"` // status before archiving; Restore returns to it
	Priority     string     `json:"priority" gorm:"default:'normal'"` // low, normal, high, critical
	Severity     string     `json:"severity"`                         // minor, major, critical
	Source       string     `json:"source"`                           // email, phone, portal, chat

	// SLA Tracking
	SLADeadline     *time.Time `json:"sla_deadline"`
	FirstResponseAt *time.Time `json:"first_response_at"`
	// Spec slide 22: "System tracks: start time, SLA deadline, remaining
	// time, acknowledged?, work started?, breached?"
	AcknowledgedAt *time.Time `json:"acknowledged_at,omitempty"` // first move out of "open" statuses
	WorkStartedAt  *time.Time `json:"work_started_at,omitempty"` // first move into active work
	// Automatic escalation after an SLA breach: 0 = none, 1 = department
	// head, 2 = department admin, 3 = super admin (see sla.go).
	AutoEscalationStep int `json:"auto_escalation_step"`

	// CNOC flow (spec slide 19). OriginDepartment is where the ticket came
	// from (the creator's department, e.g. CNOC); "Return" sends it back
	// there. ReturnedByID / ReturnedFromDept remember who handed it back, so
	// "client says not resolved" reopens it straight to them — "the loop is
	// fully tracked, not restarted".
	OriginDepartment string `json:"origin_department"`
	ReturnedByID     *uint  `json:"returned_by_id,omitempty"`
	ReturnedFromDept string `json:"returned_from_dept,omitempty"`
	ResolvedAt      *time.Time `json:"resolved_at"`
	ClosedAt        *time.Time `json:"closed_at"`

	// Written by UpdateTicketStatus ("resolution_summary") and EscalateTicket,
	// and read by the frontend's normalizeTicket — previously not on this
	// struct at all. ADDITIVE, same migration note as Task above.
	ResolutionSummary string     `json:"resolution_summary"`
	EscalationLevel   string     `json:"escalation_level"`
	EscalationReason  string     `json:"escalation_reason"`
	EscalatedAt       *time.Time `json:"escalated_at,omitempty"`
	EscalatedByID     *uint      `json:"escalated_by_id,omitempty"`
	IsPinned          bool       `json:"is_pinned"`

	// Department-level ownership (for privacy filtering)
	Department   string `json:"department"` // e.g. "Technical", "Support"
	AssignedToID *uint  `json:"assigned_to_id"`
	AssignedTo   *User  `json:"assigned_to,omitempty" gorm:"foreignKey:AssignedToID"`
	// Who gave the work to its current assignee — set on every assign,
	// reassign, transfer, route, return and reopen.
	AssignedByID *uint `json:"assigned_by_id,omitempty"`
	AssignedBy   *User `json:"assigned_by,omitempty" gorm:"foreignKey:AssignedByID"`
	CreatedByID  *uint  `json:"created_by_id"`
	CreatedBy    *User  `json:"created_by,omitempty" gorm:"foreignKey:CreatedByID"`

	// Project linkage (optional - for ticketing projects)
	ProjectID *uint    `json:"project_id"`
	Project   *Project `json:"project,omitempty" gorm:"foreignKey:ProjectID"`

	ClientID *uint   `json:"client_id"`
	Client   *Client `json:"client,omitempty" gorm:"foreignKey:ClientID"`

	// Relationships
	Comments    []Comment    `json:"comments,omitempty" gorm:"foreignKey:TicketID"`
	Attachments []Attachment `json:"attachments,omitempty" gorm:"foreignKey:TicketID"`
	Tasks       []Task       `json:"tasks,omitempty" gorm:"foreignKey:TicketID"`
	WorkLogs    []WorkLog    `json:"work_logs,omitempty" gorm:"foreignKey:TicketID"`
}

// --- Task ----------------------------------------------------------------

type Task struct {
	gorm.Model
	TaskNumber  string `json:"task_number" gorm:"uniqueIndex"`
	Title       string `json:"title" binding:"required"`
	Description string `json:"description"`
	Status      string `json:"status" gorm:"default:'todo'"` // todo, in_progress, in_review, done, blocked, cancelled, archived

	// See the matching comment on Project.ArchivedAt in this file.
	ArchivedAt   *time.Time `json:"archived_at,omitempty"`
	ArchivedByID *uint      `json:"archived_by_id,omitempty"`
	PreArchiveStatus string     `json:"pre_archive_status,omitempty"` // status before archiving; Restore returns to it
	Priority     string     `json:"priority" gorm:"default:'normal'"` // low, normal, high, critical
	StoryPoints  int        `json:"story_points"`

	// Dates
	StartDate   *time.Time `json:"start_date"`
	DueDate     *time.Time `json:"due_date"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`

	// Ownership
	ProjectID *uint    `json:"project_id"`
	Project   *Project `json:"project,omitempty" gorm:"foreignKey:ProjectID"`

	TicketID *uint   `json:"ticket_id"` // optional link to parent ticket
	Ticket   *Ticket `json:"ticket,omitempty" gorm:"foreignKey:TicketID"`

	AssigneeID *uint `json:"assignee_id"`
	Assignee   *User `json:"assignee,omitempty" gorm:"foreignKey:AssigneeID"`
	// Who gave the work to its current assignee — set on every assign,
	// reassign, transfer, route, return and reopen.
	AssignedByID *uint `json:"assigned_by_id,omitempty"`
	AssignedBy   *User `json:"assigned_by,omitempty" gorm:"foreignKey:AssignedByID"`
	CreatorID  *uint `json:"creator_id"`
	Creator    *User `json:"creator,omitempty" gorm:"foreignKey:CreatorID"`

	// Department (derived from project or assignee for privacy)
	Department string `json:"department"`

	// Fields the frontend reads (normalizeTask) and that handlers already
	// reference by column name (checklist progress, global search) but which
	// were missing from this struct — so AutoMigrate never created them.
	// ADDITIVE: run migrations_tasks_tickets.sql first if you don't rely on
	// AutoMigrate, otherwise every Task query fails on the missing columns.
	Progress       int     `json:"progress" gorm:"default:0"` // 0-100, from checklist completion / approval
	Labels         string  `json:"labels"`                    // comma-separated
	EstimatedHours float64 `json:"estimated_hours"`
	ActualHours    float64 `json:"actual_hours"`
	IsPinned       bool    `json:"is_pinned"`

	// Review workflow state read by the task drawer: "none" (default),
	// "submitted_for_review", "approved", "reopened".
	ReviewStatus string `json:"review_status" gorm:"default:'none'"`
	ReviewNotes  string `json:"review_notes"`

	// Relationships
	Checklists   []ChecklistItem `json:"checklists,omitempty" gorm:"foreignKey:TaskID"`
	SubTasks     []SubTask       `json:"sub_tasks,omitempty" gorm:"foreignKey:TaskID"`
	Comments     []Comment       `json:"comments,omitempty" gorm:"foreignKey:TaskID"`
	Attachments  []Attachment    `json:"attachments,omitempty" gorm:"foreignKey:TaskID"`
	WorkLogs     []WorkLog       `json:"work_logs,omitempty" gorm:"foreignKey:TaskID"`
	Dependencies []Task          `json:"dependencies,omitempty" gorm:"many2many:task_dependencies;joinForeignKey:TaskID;joinReferences:DependsOnID"`

	// AccessLevel is set per response, never stored: "subtask" means the
	// caller can see this task only because they're assigned one of its
	// subtasks, so they get a reference view (see limitToSubtaskView).
	AccessLevel string `gorm:"-" json:"access_level,omitempty"`
}

// --- SubTask -------------------------------------------------------------

type SubTask struct {
	gorm.Model
	// Permanent ID, STK-000001 (spec slide 7). Set automatically on create.
	SubtaskNumber string `json:"subtask_number" gorm:"size:20;index"`
	Title          string  `json:"title" binding:"required"`
	Status         string  `json:"status" gorm:"default:'todo'"`     // todo, in_progress, done, archived
	Priority       string  `json:"priority" gorm:"default:'normal'"` // low, normal, high
	Deadline       string  `json:"deadline"`
	TaskID         uint    `json:"task_id" binding:"required"`
	Task           *Task   `json:"task,omitempty" gorm:"foreignKey:TaskID"`
	AssigneeID     *uint   `json:"assignee_id"`
	Assignee       *User   `json:"assignee,omitempty" gorm:"foreignKey:AssigneeID"`
	// Who gave the work to its current assignee — set on every assign,
	// reassign, transfer, route, return and reopen.
	AssignedByID *uint `json:"assigned_by_id,omitempty"`
	AssignedBy   *User `json:"assigned_by,omitempty" gorm:"foreignKey:AssignedByID"`
	EstimatedHours float64 `json:"estimated_hours"`
	ActualHours    float64 `json:"actual_hours"`
	Order          int     `json:"order" gorm:"default:0"`

	// See the matching comment on Project.ArchivedAt further down this
	// file — Subtask is explicitly named alongside Client/Project/
	// Ticket/Task/Feasibility in the spec's "never permanently deleted"
	// list.
	ArchivedAt   *time.Time `json:"archived_at,omitempty"`
	ArchivedByID *uint      `json:"archived_by_id,omitempty"`
}

// --- ChecklistItem -------------------------------------------------------

type ChecklistItem struct {
	gorm.Model
	TaskID        uint       `json:"task_id" binding:"required"`
	Task          *Task      `json:"task,omitempty" gorm:"foreignKey:TaskID"`
	Title         string     `json:"title" binding:"required"`
	Completed     bool       `json:"completed"`
	CompletedByID *uint      `json:"completed_by_id,omitempty"`
	CompletedBy   *User      `json:"completed_by,omitempty" gorm:"foreignKey:CompletedByID"`
	CompletedAt   *time.Time `json:"completed_at,omitempty"`
}

// --- Comment -------------------------------------------------------------

type Comment struct {
	gorm.Model
	Content    string `json:"content" binding:"required"`
	IsInternal bool   `json:"is_internal"` // true = staff only, false = visible to client
	UserID     uint   `json:"user_id" binding:"required"`
	User       *User  `json:"user,omitempty" gorm:"foreignKey:UserID"`

	// Polymorphic: either Ticket or Task (one will be set)
	TicketID *uint   `json:"ticket_id"`
	Ticket   *Ticket `json:"ticket,omitempty" gorm:"foreignKey:TicketID"`
	TaskID   *uint   `json:"task_id"`
	Task     *Task   `json:"task,omitempty" gorm:"foreignKey:TaskID"`
}

// --- Attachment ----------------------------------------------------------

type Attachment struct {
	gorm.Model
	Name         string `json:"name"`
	Size         int64  `json:"size"`
	MimeType     string `json:"mime_type"`
	URL          string `json:"url"`
	UploadedByID uint   `json:"uploaded_by_id"`
	UploadedBy   *User  `json:"uploaded_by,omitempty" gorm:"foreignKey:UploadedByID"`

	TicketID  *uint    `json:"ticket_id"`
	Ticket    *Ticket  `json:"ticket,omitempty" gorm:"foreignKey:TicketID"`
	TaskID    *uint    `json:"task_id"`
	Task      *Task    `json:"task,omitempty" gorm:"foreignKey:TaskID"`
	ProjectID *uint    `json:"project_id"`
	Project   *Project `json:"project,omitempty" gorm:"foreignKey:ProjectID"`
}

// --- WorkLog (Time Tracking) --------------------------------------------

type WorkLog struct {
	gorm.Model
	UserID      uint      `json:"user_id" binding:"required"`
	User        *User     `json:"user,omitempty" gorm:"foreignKey:UserID"`
	Hours       float64   `json:"hours" binding:"required,min=0"`
	Date        time.Time `json:"date" binding:"required"`
	Description string    `json:"description"`

	TicketID  *uint    `json:"ticket_id"`
	Ticket    *Ticket  `json:"ticket,omitempty" gorm:"foreignKey:TicketID"`
	TaskID    *uint    `json:"task_id"`
	Task      *Task    `json:"task,omitempty" gorm:"foreignKey:TaskID"`
	ProjectID *uint    `json:"project_id"`
	Project   *Project `json:"project,omitempty" gorm:"foreignKey:ProjectID"`
}

// --- Role & Permission Matrix --------------------------------------------

type Role struct {
	gorm.Model
	Key       string `json:"key" gorm:"uniqueIndex"`
	Label     string `json:"label"`
	IsBuiltIn bool   `json:"is_built_in"`
}

// Department is a real, admin-managed record — spec: "Departments are
// dynamic — not hard-coded." Unlike Role, there's no IsBuiltIn/protection
// flag: nothing in this codebase's logic branches on a specific
// department's name the way permission checks branch on specific role
// keys, so there's no special set that needs protecting from deletion —
// only "is this name currently in use" matters (see department.go).
type Department struct {
	gorm.Model
	// Permanent ID, DEP-000001 (spec slide 7). Set automatically on create.
	DeptNumber string `json:"dept_number" gorm:"size:20;index"`
	Name        string `json:"name" gorm:"uniqueIndex"`
	Description string `json:"description"`
	// active | archived. Archived departments leave every dropdown but keep
	// their name and DEP- ID, so restoring reconnects all records using them.
	Status       string     `json:"status" gorm:"size:20;default:'active'"`
	ArchivedAt   *time.Time `json:"archived_at,omitempty"`
	ArchivedByID *uint      `json:"archived_by_id,omitempty"`
}

type RolePermission struct {
	gorm.Model
	RoleKey       string `json:"role_key" gorm:"uniqueIndex:idx_role_permission"`
	PermissionKey string `json:"permission_key" gorm:"uniqueIndex:idx_role_permission"`
	Granted       bool   `json:"granted"`
}

// RecordAccess is an explicit, per-record access grant — the spec's
// "record-level permission" layer (slide 16): "A Legal Admin can pull in a
// Technical staff member for one Task — without granting access to the rest
// of the Project" (slide 6). One row = one person may see and work on one
// record. RecordType is currently "task" (projects already have their member
// list as the per-project grant).
//
// Revoking removes the row; the audit trail keeps the history of every
// grant and revoke.
type RecordAccess struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	CreatedAt   time.Time `json:"created_at"`
	RecordType  string    `gorm:"size:20;not null;uniqueIndex:idx_record_access" json:"record_type"`
	RecordID    uint      `gorm:"not null;uniqueIndex:idx_record_access" json:"record_id"`
	UserID      uint      `gorm:"not null;uniqueIndex:idx_record_access;index" json:"user_id"`
	User        *User     `gorm:"foreignKey:UserID" json:"user,omitempty"`
	GrantedByID uint      `json:"granted_by_id"`
	GrantedBy   *User     `gorm:"foreignKey:GrantedByID" json:"granted_by,omitempty"`
}

// WorkflowStatus is one entry in the configurable status catalog (spec slide
// 21: "Configurable statuses, always with a recorded reason"). The Super
// Admin can rename, enable/disable, require a reason for, reorder and add
// statuses — no code change. Entity is "ticket" or "task".
//
// Category drives behaviour instead of hard-coded keys:
//
//	open      not started (new, assigned, to do)
//	active    being worked on (acknowledged, in progress, reopened)
//	waiting   paused on someone else (pending, waiting for client/vendor, blocked)
//	review    awaiting approval (tasks: in review)
//	done      finished (resolved, closed, done)
//	cancelled stopped without finishing
//
// System statuses are ones the workflow code relies on (e.g. "new",
// "resolved", "in_review", "done"): their key and category are fixed and they
// can't be disabled; their label can still be changed.
type WorkflowStatus struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
	Entity         string    `gorm:"size:20;not null;uniqueIndex:idx_workflow_status" json:"entity"`
	Key            string    `gorm:"size:50;not null;uniqueIndex:idx_workflow_status" json:"key"`
	Label          string    `gorm:"size:80;not null" json:"label"`
	Category       string    `gorm:"size:20;not null" json:"category"`
	ReasonRequired bool      `json:"reason_required"`
	Enabled        bool      `json:"enabled"`
	SortOrder      int       `json:"sort_order"`
	System         bool      `json:"system"`
}

// SLAPolicy is the configurable SLA per ticket priority (spec slide 22:
// "Example SLA (fully configurable)": Critical 30 min, High 1 h, Normal 4 h).
// ResolutionMinutes sets a new ticket's SLA deadline. EscalationStepMinutes
// is the wait between automatic escalation steps once the SLA is breached:
// department head at the deadline, department admin one step later, super
// admin one step after that.
type SLAPolicy struct {
	ID                    uint      `gorm:"primaryKey" json:"id"`
	UpdatedAt             time.Time `json:"updated_at"`
	Priority              string    `gorm:"size:20;uniqueIndex;not null" json:"priority"`
	ResolutionMinutes     int       `json:"resolution_minutes"`
	EscalationStepMinutes int       `json:"escalation_step_minutes"`
}

// ClientField defines one admin-configurable extra client attribute (spec
// slide 8). Values live in Client.CustomFields under Key.
//
//	FieldType: text | number | date | select
//	Options:   for select — one option per line
type ClientField struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	Key       string    `gorm:"size:60;uniqueIndex;not null" json:"key"`
	Label     string    `gorm:"size:100;not null" json:"label"`
	FieldType string    `gorm:"size:20;not null" json:"field_type"`
	Options   string    `json:"options"`
	Required  bool      `json:"required"`
	Enabled   bool      `json:"enabled"`
	SortOrder int       `json:"sort_order"`
}

// Notification is one alert for one person (spec slide 27: in-app is the
// primary channel; email for assignments, SLA breaches and transfers).
// Created by the server whenever something happens to someone — they used to
// exist only in the sender's own browser, so the recipient never saw them.
type Notification struct {
	ID         uint       `gorm:"primaryKey" json:"id"`
	CreatedAt  time.Time  `json:"created_at"`
	UserID     uint       `gorm:"not null;index:idx_notif_user_read" json:"user_id"` // recipient
	ActorID    *uint      `json:"actor_id,omitempty"`                               // who caused it (nil = system)
	Actor      *User      `json:"actor,omitempty" gorm:"foreignKey:ActorID"`
	Type       string     `gorm:"size:30" json:"type"` // assignment, transfer, routed, returned, reopened, sla_breach, escalation, review, review_result, access
	Title      string     `gorm:"size:200" json:"title"`
	Message    string     `json:"message"`
	EntityType string     `gorm:"size:20" json:"entity_type"` // task, ticket, project, feasibility, client
	EntityID   uint       `json:"entity_id"`
	ReadAt     *time.Time `gorm:"index:idx_notif_user_read" json:"read_at"`
}

// Pin — one person pinning one record (spec slide 28: "Pinned Items"). Pins
// used to be a single flag on the record, shared by everyone (and for
// projects not saved at all), so one person pinning something pinned it for
// the whole company.
type Pin struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	CreatedAt  time.Time `json:"created_at"`
	UserID     uint      `gorm:"not null;uniqueIndex:idx_pin" json:"user_id"`
	RecordType string    `gorm:"size:20;not null;uniqueIndex:idx_pin" json:"record_type"` // project | task | ticket | feasibility | client
	RecordID   uint      `gorm:"not null;uniqueIndex:idx_pin" json:"record_id"`
}

// Document is one uploaded file (spec slide 27: "Upload PDFs, images,
// screenshots, network diagrams, and supporting documents — tracked with who
// uploaded it, when, on which record, with version history"; slide 25:
// evidence per feasibility vendor).
//
// Files live outside the public /uploads folder and are only served through
// an access-checked download, so nobody can open a document for a record they
// can't see. Uploading a new version keeps the old ones (same GroupID).
// Removing a document archives it; the file is kept.
type Document struct {
	ID           uint       `gorm:"primaryKey" json:"id"`
	CreatedAt    time.Time  `json:"created_at"`
	RecordType   string     `gorm:"size:20;not null;index:idx_doc_record" json:"record_type"` // ticket | task | project | feasibility | vendor
	RecordID     uint       `gorm:"not null;index:idx_doc_record" json:"record_id"`
	GroupID      uint       `gorm:"index" json:"group_id"` // first version's id
	Version      int        `json:"version"`
	Name         string     `gorm:"size:255" json:"name"`
	MimeType     string     `gorm:"size:120" json:"mime_type"`
	Size         int64      `json:"size"`
	StoragePath  string     `json:"-"`
	Note         string     `gorm:"size:500" json:"note"`
	UploadedByID uint       `json:"uploaded_by_id"`
	UploadedBy   *User      `json:"uploaded_by,omitempty" gorm:"foreignKey:UploadedByID"`
	ArchivedAt   *time.Time `json:"archived_at,omitempty"`
	ArchivedByID *uint      `json:"archived_by_id,omitempty"`
}
