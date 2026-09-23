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
	VendorName    string       `json:"vendor_name" binding:"required"`
	Status        string       `json:"status"`
	ResponseNotes string       `json:"response_notes"`
	ContactPerson string       `json:"contact_person"`
	ContactEmail  string       `json:"contact_email"`
	ContactPhone  string       `json:"contact_phone"`
	QuotationRef  string       `json:"quotation_ref"`
	EvidenceURLs  string       `json:"evidence_urls"`
	RespondedAt   *time.Time   `json:"responded_at,omitempty"`
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

	Priority string `json:"priority"`
	Status   string `json:"status"` // draft, in_progress, feasible, not_feasible, converted, cancelled, archived
	Notes    string `json:"notes"`

	TargetDate  string     `json:"target_date"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`

	// See the matching comment on Project.ArchivedAt further up this file.
	ArchivedAt   *time.Time `json:"archived_at,omitempty"`
	ArchivedByID *uint      `json:"archived_by_id,omitempty"`
	ArchivedBy   *User      `json:"archived_by,omitempty" gorm:"foreignKey:ArchivedByID"`

	ConvertedProjectID *uint      `json:"converted_project_id,omitempty"`
	ConvertedProject   *Project   `json:"converted_project,omitempty" gorm:"foreignKey:ConvertedProjectID"`
	ConvertedAt        *time.Time `json:"converted_at,omitempty"`

	Vendors     []FeasibilityVendor     `json:"vendors,omitempty" gorm:"foreignKey:FeasibilityID"`
	Attachments []FeasibilityAttachment `json:"attachments,omitempty" gorm:"foreignKey:FeasibilityID"`
}

// --- User ----------------------------------------------------------------

type User struct {
	gorm.Model
	Name         string     `json:"name"`
	Email        string     `json:"email" gorm:"uniqueIndex"`
	Password     string     `json:"-"`
	Role         string     `json:"role" gorm:"default:'staff'"` // super_admin, admin, supervisor, staff
	Department   string     `json:"department"`                  // e.g. "Technical", "Support", "Feasibility"
	Title        string     `json:"title"`                       // job title
	Phone        string     `json:"phone"`
	Avatar       string     `json:"avatar"`
	Status       string     `json:"status" gorm:"default:'active'"` // active, inactive
	ManagerID    *uint      `json:"manager_id,omitempty"`
	Manager      *User      `json:"manager,omitempty" gorm:"foreignKey:ManagerID"`
	SupervisorID *uint      `json:"supervisor_id,omitempty"`
	Supervisor   *User      `json:"supervisor,omitempty" gorm:"foreignKey:SupervisorID"`
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

	// See the matching comment on Project.ArchivedAt further down this
	// file — same reasoning: Client is one of the six entities the spec
	// explicitly names as "never permanently deleted."
	ArchivedAt   *time.Time `json:"archived_at,omitempty"`
	ArchivedByID *uint      `json:"archived_by_id,omitempty"`
	ArchivedBy   *User      `json:"archived_by,omitempty" gorm:"foreignKey:ArchivedByID"`
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
	ArchivedBy   *User      `json:"archived_by,omitempty" gorm:"foreignKey:ArchivedByID"`
	Priority     string     `json:"priority" gorm:"default:'normal'"` // low, normal, high, critical
	StartDate    *time.Time `json:"start_date"`
	DueDate      *time.Time `json:"due_date"`
	CompletedAt  *time.Time `json:"completed_at,omitempty"`

	ClientID *uint   `json:"client_id"`
	Client   *Client `json:"client,omitempty" gorm:"foreignKey:ClientID"`
	OwnerID  *uint   `json:"owner_id"`
	Owner    *User   `json:"owner,omitempty" gorm:"foreignKey:OwnerID"`
	AdminID  *uint   `json:"admin_id"`
	Admin    *User   `json:"admin,omitempty" gorm:"foreignKey:AdminID"`

	Progress    int     `json:"progress" gorm:"default:0"` // 0-100
	BudgetHours float64 `json:"budget_hours"`
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
	ArchivedBy   *User      `json:"archived_by,omitempty" gorm:"foreignKey:ArchivedByID"`
	Priority     string     `json:"priority" gorm:"default:'normal'"` // low, normal, high, critical
	Severity     string     `json:"severity"`                         // minor, major, critical
	Source       string     `json:"source"`                           // email, phone, portal, chat

	// SLA Tracking
	SLADeadline     *time.Time `json:"sla_deadline"`
	FirstResponseAt *time.Time `json:"first_response_at"`
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
	ArchivedBy   *User      `json:"archived_by,omitempty" gorm:"foreignKey:ArchivedByID"`
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
}

// --- SubTask -------------------------------------------------------------

type SubTask struct {
	gorm.Model
	Title          string  `json:"title" binding:"required"`
	Status         string  `json:"status" gorm:"default:'todo'"`     // todo, in_progress, done, archived
	Priority       string  `json:"priority" gorm:"default:'normal'"` // low, normal, high
	Deadline       string  `json:"deadline"`
	TaskID         uint    `json:"task_id" binding:"required"`
	Task           *Task   `json:"task,omitempty" gorm:"foreignKey:TaskID"`
	AssigneeID     *uint   `json:"assignee_id"`
	Assignee       *User   `json:"assignee,omitempty" gorm:"foreignKey:AssigneeID"`
	EstimatedHours float64 `json:"estimated_hours"`
	ActualHours    float64 `json:"actual_hours"`
	Order          int     `json:"order" gorm:"default:0"`

	// See the matching comment on Project.ArchivedAt further down this
	// file — Subtask is explicitly named alongside Client/Project/
	// Ticket/Task/Feasibility in the spec's "never permanently deleted"
	// list.
	ArchivedAt   *time.Time `json:"archived_at,omitempty"`
	ArchivedByID *uint      `json:"archived_by_id,omitempty"`
	ArchivedBy   *User      `json:"archived_by,omitempty" gorm:"foreignKey:ArchivedByID"`
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
	Name        string `json:"name" gorm:"uniqueIndex"`
	Description string `json:"description"`
}

type RolePermission struct {
	gorm.Model
	RoleKey       string `json:"role_key" gorm:"uniqueIndex:idx_role_permission"`
	PermissionKey string `json:"permission_key" gorm:"uniqueIndex:idx_role_permission"`
	Granted       bool   `json:"granted"`
}
