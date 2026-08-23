package models

import "gorm.io/gorm"

type Comment struct {
	gorm.Model
	Content string `json:"content" binding:"required"`
	IssueID uint   `json:"issue_id"`
	UserID  uint   `json:"user_id"`
	User    User   `json:"user,omitempty"`
}

type Solution struct {
	gorm.Model
	Description string `json:"description" binding:"required"`
	CodeSnippet string `json:"code_snippet"`
	IsAccepted  bool   `json:"is_accepted" gorm:"default:false"`
	IssueID     uint   `json:"issue_id"`
	UserID      uint   `json:"user_id"`
	User        User   `json:"user,omitempty"`
}

type Bookmark struct {
	gorm.Model
	UserID  uint  `json:"user_id" gorm:"uniqueIndex:idx_user_issue"`
	IssueID uint  `json:"issue_id" gorm:"uniqueIndex:idx_user_issue"`
	Issue   Issue `json:"issue,omitempty"`
}

type Reaction struct {
	gorm.Model
	UserID   uint   `json:"user_id"`
	Target   string `json:"target"` // "issue", "comment", "solution"
	TargetID uint   `json:"target_id"`
	Type     string `json:"type"` // "like", "helpful", "useful"
}

type ReputationHistory struct {
	gorm.Model
	UserID uint   `json:"user_id"`
	Points int    `json:"points"`
	Reason string `json:"reason"`
}

type Badge struct {
	gorm.Model
	Name        string `json:"name"`
	Description string `json:"description"`
	UserID      uint   `json:"user_id"`
}

type Activity struct {
	gorm.Model
	UserID      uint   `json:"user_id"`
	User        User   `json:"user,omitempty"`
	Description string `json:"description"`
}

type Report struct {
	gorm.Model
	UserID   uint   `json:"user_id"`
	Target   string `json:"target"`
	TargetID uint   `json:"target_id"`
	Reason   string `json:"reason"`
	Status   string `json:"status" gorm:"default:'Pending'"`
}
