package models

import (
	"fmt"

	"gorm.io/gorm"
)

// Permanent IDs — spec slide 7: "Every major object gets a permanent,
// auto-generated ID ... The ID never changes. Even if a record is
// transferred, renamed, completed, cancelled, or archived."
//
//	CL-000001 client       PRJ-000001 project     TKT-000001 ticket
//	TSK-000001 task        STK-000001 subtask     FEA-000001 feasibility
//	USR-000001 user        DEP-000001 department  VEN-000001 vendor
//
// Numbers come from IDCounter, one row per prefix, incremented atomically
// in the database. The old "highest existing number + 1" approach let two
// records created at the same moment get the same number, so one of them
// failed on the unique index.
type IDCounter struct {
	Prefix string `gorm:"primaryKey;size:10"`
	Last   int64  `gorm:"not null"`
}

// NextID returns the next permanent ID for a prefix, e.g. "TKT-000042".
// Safe under concurrency: the counter row is updated in one statement.
func NextID(tx *gorm.DB, prefix string) (string, error) {
	var last int64
	err := tx.Raw(`INSERT INTO id_counters (prefix, last) VALUES (?, 1)
		ON CONFLICT (prefix) DO UPDATE SET last = id_counters.last + 1
		RETURNING last`, prefix).Scan(&last).Error
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s-%06d", prefix, last), nil
}

// Create hooks: any user, department or subtask created without an ID gets
// one — whichever code path creates it.

func (u *User) BeforeCreate(tx *gorm.DB) error {
	if u.UserNumber == "" {
		id, err := NextID(tx, "USR")
		if err != nil {
			return err
		}
		u.UserNumber = id
	}
	return nil
}

func (d *Department) BeforeCreate(tx *gorm.DB) error {
	if d.DeptNumber == "" {
		id, err := NextID(tx, "DEP")
		if err != nil {
			return err
		}
		d.DeptNumber = id
	}
	return nil
}

func (s *SubTask) BeforeCreate(tx *gorm.DB) error {
	if s.SubtaskNumber == "" {
		id, err := NextID(tx, "STK")
		if err != nil {
			return err
		}
		s.SubtaskNumber = id
	}
	return nil
}
