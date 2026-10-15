package models

import (
	"time"

	"gorm.io/gorm"
)

// Client CRM — change history shared by client products & services and the
// per-client IP Plan / Transmission Plan sheets.
//
// One row per changed field (or one row for a create / remove), so the
// history reads "VLAN ID: 120 → 140, by Ali, 08/10 14:02, TKT-100231".
// Rows are never edited or deleted: removing a plan row is itself a
// "removed" entry, and the old values stay here for good.
//
// Secret fields (Transmission Plan passwords) are never written here, not
// even encrypted: the history only says that the password changed.
type ClientRecordChange struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	CreatedAt time.Time `gorm:"index" json:"created_at"`

	ClientID   uint   `gorm:"not null;index:idx_client_change_record,priority:1" json:"client_id"`
	RecordType string `gorm:"size:30;not null;index:idx_client_change_record,priority:2" json:"record_type"` // service | ip_plan | transmission_plan
	RecordID   uint   `gorm:"not null;index:idx_client_change_record,priority:3" json:"record_id"`

	Action   string `gorm:"size:20;not null" json:"action"` // created | updated | removed | restored
	Field    string `gorm:"size:60" json:"field"`           // empty for created / removed / restored
	OldValue string `gorm:"type:text" json:"old_value"`
	NewValue string `gorm:"type:text" json:"new_value"`

	// The ticket that authorized the change. Required for plan changes;
	// optional for services. The number is kept as written at the time.
	TicketID     *uint  `gorm:"index" json:"ticket_id,omitempty"`
	TicketNumber string `gorm:"size:40" json:"ticket_number"`

	ChangedByID   uint   `gorm:"not null;index" json:"changed_by_id"`
	ChangedByName string `gorm:"size:150" json:"changed_by_name"`
}

// ClientService — one product / service a client gets from us (spec: Client
// Products and Services). A client can have many. Never deleted: a service
// that ends is set to "closed" and stays in the client's history.
type ClientService struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
	ServiceNumber string    `gorm:"size:20;index" json:"service_number"` // SVC-000001, permanent

	ClientID uint `gorm:"not null;index" json:"client_id"`

	Product  string `gorm:"size:100;not null" json:"product"`  // IPT, DPLC, Dark Fiber, Hosting, …
	Location string `gorm:"size:255" json:"location"`          // service location / site
	Capacity string `gorm:"size:100" json:"capacity"`          // capacity or package

	// Vendor from the shared vendor list (a typed new name is added to it).
	// VendorName is kept as written, so the service still reads right if
	// the vendor is renamed or archived later.
	VendorID   *uint  `gorm:"index" json:"vendor_id"`
	VendorName string `gorm:"size:150" json:"vendor_name"`
	// through_us: the vendor's service is provided through our company.
	// direct: the client buys it directly from the vendor.
	// Empty when there's no vendor (our own network).
	Arrangement string `gorm:"size:20" json:"arrangement"`

	ActivationDate *time.Time `json:"activation_date"`
	Status         string     `gorm:"size:20;not null;default:'pending';index" json:"status"` // pending | active | suspended | closed
	ClosedAt       *time.Time `json:"closed_at"`

	TicketID     *uint  `gorm:"index" json:"ticket_id"` // related ticket (optional)
	TicketNumber string `gorm:"size:40" json:"ticket_number"`

	Notes string `gorm:"type:text" json:"notes"`

	CreatedByID *uint `json:"created_by_id"`
	UpdatedByID *uint `json:"updated_by_id"`
}

func (s *ClientService) BeforeCreate(tx *gorm.DB) error {
	if s.ServiceNumber == "" {
		id, err := NextID(tx, "SVC")
		if err != nil {
			return err
		}
		s.ServiceNumber = id
	}
	return nil
}

// ClientPlanRow — one row of a client's IP Plan or Transmission Plan sheet
// (client CRM steps 3–4). Both sheets share this table: PlanType says which,
// and Data holds the sheet's columns (field key → text), defined in
// handlers/client_plans.go.
//
// Every change goes through one save that names a ticket of the client; the
// row keeps the last change's ticket / person / time (the sheet's "Ticket ID
// | Date & Time | Updated By" columns), and the full story is in
// ClientRecordChange. Rows are never deleted: "removed" rows stay, hidden by
// default, and can be restored.
//
// Version goes up on every change, so two people editing the same sheet
// can't silently overwrite each other (the second save is refused).
type ClientPlanRow struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	ClientID uint   `gorm:"not null;index:idx_client_plan_rows,priority:1" json:"client_id"`
	PlanType string `gorm:"size:20;not null;index:idx_client_plan_rows,priority:2" json:"plan_type"` // ip | bgp | transmission

	// The client service this row belongs to (required on the IP and BGP
	// plans). Kept even if the service is later closed.
	ServiceID *uint `gorm:"index" json:"service_id"`

	Data JSONMap `gorm:"type:jsonb" json:"data"`
	// Encrypted secret column of the sheet (Transmission Plan password),
	// see utils/secretbox.go. Never sent to the browser with the row.
	Secret string `gorm:"type:text" json:"-"`

	// Versions: editing a row never overwrites it. The old row is kept
	// (Removed + SupersededByID, shown struck through) and the edited copy
	// is a new row with the same LineageID, listed right below it. A row's
	// LineageID is the id of its first version (nil on that first version);
	// the history is recorded against the lineage, so it covers every
	// version.
	LineageID      *uint `gorm:"index" json:"lineage_id"`
	SupersededByID *uint `json:"superseded_by_id"`

	Removed   bool       `gorm:"not null;default:false" json:"removed"`
	RemovedAt *time.Time `json:"removed_at"`
	Version   int        `gorm:"not null;default:1" json:"version"`

	// Last change.
	TicketID      *uint  `gorm:"index" json:"ticket_id"`
	TicketNumber  string `gorm:"size:40" json:"ticket_number"`
	CreatedByID   uint   `json:"created_by_id"`
	UpdatedByID   uint   `json:"updated_by_id"`
	UpdatedByName string `gorm:"size:150" json:"updated_by_name"`
}

// PlanColumnLabel — a column title of a plan sheet renamed by the Super
// Admin (the sheet's header row). One row per plan + column; no row means
// the built-in title.
type PlanColumnLabel struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	UpdatedAt   time.Time `json:"updated_at"`
	PlanType    string    `gorm:"size:20;not null;uniqueIndex:idx_plan_column_label" json:"plan_type"`
	FieldKey    string    `gorm:"size:60;not null;uniqueIndex:idx_plan_column_label" json:"field_key"`
	Label       string    `gorm:"size:100;not null" json:"label"`
	UpdatedByID uint      `json:"updated_by_id"`
}
