package models

import (
	"gorm.io/gorm"
)

type User struct {
	gorm.Model
	Name     string `json:"name"`
	Email    string `json:"email" gorm:"unique"`
	Password string `json:"-"`
	Role     string `json:"role"` // Super Admin, Admin, Supervisor, Staff

	// Optional hierarchy mapping: tracks who manages this user
	ManagerID *uint `json:"manager_id,omitempty"`
	Manager   *User `json:"manager,omitempty" gorm:"foreignKey:ManagerID"`
}

type Project struct {
	gorm.Model
	Title       string `json:"title" binding:"required"`
	Description string `json:"description"`
	Status      string `json:"status"` // Active, Completed, Archived
	Deadline    string `json:"deadline"`
	OwnerID     uint   `json:"owner_id"` // References User ID who created/owns it
	Owner       User   `json:"owner" gorm:"foreignKey:OwnerID"`
}

type Task struct {
	gorm.Model
	Title       string `json:"title" binding:"required"`
	Description string `json:"description"`
	Status      string `json:"status"`   // New, To Do, In Progress, On Hold, Under Review, Completed, Closed
	Priority    string `json:"priority"` // Low, Normal, High, Urgent, Critical
	Labels      string `json:"labels"`   // Comma-separated or color-coded labels
	ProjectID   uint   `json:"project_id" binding:"required"`
	AssigneeID  uint   `json:"assignee_id"` // User ID of the assigned Staff/Supervisor/Admin
	Assignee    User   `json:"assignee" gorm:"foreignKey:AssigneeID"`
}

type Ticket struct {
	gorm.Model
	TicketNumber string `json:"ticket_number" gorm:"unique"`
	Title        string `json:"title" binding:"required"`
	Description  string `json:"description"`
	Category     string `json:"category"`    // e.g., Bug, Support, Feature Request
	Department   string `json:"department"`  // e.g., Engineering, IT, HR
	Status       string `json:"status"`      // Open, Assigned, In Progress, Pending, Escalated, Resolved, Closed, Reopened
	Priority     string `json:"priority"`    // Low, Normal, High, Urgent, Critical
	AssigneeID   uint   `json:"assignee_id"` // Admin, Supervisor, or Staff assigned
	Assignee     User   `json:"assignee" gorm:"foreignKey:AssigneeID"`
}
type SubTask struct {
	gorm.Model
	Title      string `json:"title" binding:"required"`
	Status     string `json:"status"`   // Pending, In Progress, Completed
	Priority   string `json:"priority"` // Low, Normal, High
	Deadline   string `json:"deadline"`
	TaskID     uint   `json:"task_id" binding:"required"`
	AssigneeID uint   `json:"assignee_id"`
}
type Comment struct {
	gorm.Model
	Content  string `json:"content" binding:"required"`
	UserID   uint   `json:"user_id" binding:"required"`
	User     User   `json:"user" gorm:"foreignKey:UserID"`
	TaskID   *uint  `json:"task_id"`   // Optional: Null if it belongs to a ticket
	TicketID *uint  `json:"ticket_id"` // Optional: Null if it belongs to a task
}
