package models

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
)

// Vendor — the shared vendor master (spec slides 30-31: "Vendors" is a core
// entity and has its own menu entry). Every vendor row on a feasibility links
// to one of these, so a vendor's contacts live in one place and its whole
// track record (feasible / not feasible / pending) can be seen at a glance.
//
// Like every core entity it has a permanent ID (VEN-000001) and is never
// hard-deleted: archiving removes it from pickers but keeps its history.
type Vendor struct {
	gorm.Model
	VendorNumber  string `json:"vendor_number" gorm:"size:20;index"`
	Name          string `json:"name" gorm:"size:150;not null"`
	ContactPerson string `json:"contact_person"`
	Phone         string `json:"phone"`
	Email         string `json:"email"`
	// Areas covered and services offered, comma-separated free text
	// (e.g. "Islamabad, Lahore" / "DPLC, Dark Fiber, IPT").
	Cities   string `json:"cities"`
	Services string `json:"services"`
	Notes    string `json:"notes"`
	// active | archived
	Status       string     `json:"status" gorm:"size:20;default:'active';index"`
	ArchivedAt   *time.Time `json:"archived_at,omitempty"`
	ArchivedByID *uint      `json:"archived_by_id,omitempty"`
	CreatedByID  *uint      `json:"created_by_id,omitempty"`
}

func (v *Vendor) BeforeCreate(tx *gorm.DB) error {
	v.Name = strings.TrimSpace(v.Name)
	if v.Name == "" {
		return errors.New("vendor name is required")
	}
	if v.Status == "" {
		v.Status = "active"
	}
	if v.VendorNumber == "" {
		id, err := NextID(tx, "VEN")
		if err != nil {
			return err
		}
		v.VendorNumber = id
	}
	return nil
}

// ErrVendorArchived is returned when a feasibility tries to use an archived
// vendor. Restore it from Vendors first.
var ErrVendorArchived = errors.New("vendor is archived")

// FindVendorByName returns the vendor with this name (case and surrounding
// spaces ignored), archived ones included, or nil.
func FindVendorByName(tx *gorm.DB, name string) (*Vendor, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, nil
	}
	var v Vendor
	err := tx.Where("LOWER(TRIM(name)) = LOWER(?)", name).Order("id ASC").Take(&v).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

// ResolveVendor finds the master vendor a feasibility row should link to:
// by id when one was picked, otherwise by name — creating the vendor when the
// name is new, so the master list stays complete without anyone having to
// add vendors twice. Archived vendors are refused (ErrVendorArchived).
func ResolveVendor(tx *gorm.DB, id *uint, name string, createdByID *uint) (*Vendor, error) {
	db := tx.Session(&gorm.Session{NewDB: true})

	if id != nil && *id != 0 {
		var v Vendor
		if err := db.First(&v, *id).Error; err != nil {
			return nil, fmt.Errorf("vendor not found")
		}
		if v.Status == "archived" {
			return nil, fmt.Errorf("%s: %w", v.Name, ErrVendorArchived)
		}
		return &v, nil
	}

	existing, err := FindVendorByName(db, name)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		if existing.Status == "archived" {
			return nil, fmt.Errorf("%s: %w", existing.Name, ErrVendorArchived)
		}
		return existing, nil
	}
	if strings.TrimSpace(name) == "" {
		return nil, errors.New("vendor name is required")
	}

	v := Vendor{Name: name, CreatedByID: createdByID}
	if err := db.Create(&v).Error; err != nil {
		// Someone else created the same name a moment ago (unique index).
		if again, _ := FindVendorByName(db, name); again != nil {
			return again, nil
		}
		return nil, err
	}
	return &v, nil
}

// BeforeCreate links a new feasibility vendor row to the vendor master,
// whichever code path creates it (add vendor, create feasibility with
// vendors, ...). Contact details left blank are filled from the master.
func (fv *FeasibilityVendor) BeforeCreate(tx *gorm.DB) error {
	v, err := ResolveVendor(tx, fv.VendorID, fv.VendorName, nil)
	if err != nil {
		return err
	}
	fv.VendorID = &v.ID
	fv.VendorName = v.Name
	if strings.TrimSpace(fv.ContactPerson) == "" {
		fv.ContactPerson = v.ContactPerson
	}
	if strings.TrimSpace(fv.ContactPhone) == "" {
		fv.ContactPhone = v.Phone
	}
	if strings.TrimSpace(fv.ContactEmail) == "" {
		fv.ContactEmail = v.Email
	}
	return nil
}
