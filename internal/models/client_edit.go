package models

import "time"

// ClientEditRequest — a user whose 30-minute window to edit a client they
// created has closed asks a Super Admin / Admin for more time. Approving it
// lets that user edit that one client until ExpiresAt.
//
// Status: pending -> approved | rejected.
type ClientEditRequest struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	ClientID    uint      `gorm:"not null;index:idx_client_edit_req_client_user,priority:1" json:"client_id"`
	RequesterID uint      `gorm:"not null;index:idx_client_edit_req_client_user,priority:2;index" json:"requester_id"`
	Reason      string    `gorm:"type:text" json:"reason"`
	Status      string    `gorm:"size:20;not null;default:'pending';index" json:"status"`

	DecidedByID  *uint      `json:"decided_by_id,omitempty"`
	DecidedAt    *time.Time `json:"decided_at,omitempty"`
	DecisionNote string     `gorm:"type:text" json:"decision_note,omitempty"`
	// How long the approval lasts, and when it ends (approved only).
	AccessMinutes int        `json:"access_minutes,omitempty"`
	ExpiresAt     *time.Time `gorm:"index" json:"expires_at,omitempty"`
}

// SeedMarker records that a one-time setup step has run, so it is not
// repeated on the next start — e.g. the two client roles are created once,
// and stay deleted if a super admin removes them.
type SeedMarker struct {
	Key       string    `gorm:"primaryKey;size:100" json:"key"`
	CreatedAt time.Time `json:"created_at"`
}
