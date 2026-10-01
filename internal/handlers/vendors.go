package handlers

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
)

// Vendor master — spec slides 30-31 ("Vendors" in the main navigation, a core
// entity with its own ID, audit trail and no hard delete) and 25 (each
// feasibility checks several vendors independently).
//
//	GET    /api/vendors               list (+ ?status=archived, ?search=) with track record
//	GET    /api/vendors/:id           one vendor + its feasibilities the caller may see
//	POST   /api/vendors               manage_vendors
//	PUT    /api/vendors/:id           manage_vendors
//	DELETE /api/vendors/:id           manage_vendors — archives
//	PATCH  /api/vendors/:id/restore   manage_vendors
//
// Everyone signed in can read the list: feasibility staff pick vendors from
// it. Vendors added to a feasibility by name are put on the list
// automatically (models.FeasibilityVendor.BeforeCreate), so nobody has to
// enter a vendor twice.

type vendorStats struct {
	Total       int64 `json:"total"`
	Feasible    int64 `json:"feasible"`
	NotFeasible int64 `json:"not_feasible"`
	Pending     int64 `json:"pending"`
}

type vendorView struct {
	models.Vendor
	Stats vendorStats `json:"stats"`
}

// vendorStatsFor counts each vendor's (non-withdrawn) feasibility rows by
// outcome. Company-wide counts: the track record is the point of the master
// list, and counts reveal nothing about any single feasibility.
func vendorStatsFor(ids []uint) map[uint]vendorStats {
	out := map[uint]vendorStats{}
	if len(ids) == 0 {
		return out
	}
	type row struct {
		VendorID uint
		Status   string
		N        int64
	}
	var rows []row
	database.DB.Model(&models.FeasibilityVendor{}).
		Select("vendor_id, status, COUNT(*) AS n").
		Where("vendor_id IN ? AND withdrawn = ?", ids, false).
		Group("vendor_id, status").Scan(&rows)
	for _, r := range rows {
		st := out[r.VendorID]
		st.Total += r.N
		switch r.Status {
		case "feasible":
			st.Feasible += r.N
		case "not_feasible":
			st.NotFeasible += r.N
		default:
			st.Pending += r.N
		}
		out[r.VendorID] = st
	}
	return out
}

func GetVendors(c *gin.Context) {
	q := database.DB.Model(&models.Vendor{}).Order("LOWER(name) ASC")
	if c.Query("status") == "archived" {
		q = q.Where("status = ?", "archived")
	} else {
		q = q.Where("status <> ?", "archived")
	}
	if s := strings.TrimSpace(c.Query("search")); s != "" {
		if r := []rune(s); len(r) > 100 {
			s = string(r[:100])
		}
		like := "%" + strings.ToLower(s) + "%"
		q = q.Where("(LOWER(name) LIKE ? OR LOWER(vendor_number) LIKE ? OR LOWER(cities) LIKE ? OR LOWER(services) LIKE ? OR LOWER(contact_person) LIKE ?)",
			like, like, like, like, like)
	}
	var vendors []models.Vendor
	if err := q.Limit(1000).Find(&vendors).Error; err != nil {
		log.Printf("vendors: list failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load vendors"})
		return
	}
	ids := make([]uint, 0, len(vendors))
	for _, v := range vendors {
		ids = append(ids, v.ID)
	}
	stats := vendorStatsFor(ids)
	out := make([]vendorView, 0, len(vendors))
	for _, v := range vendors {
		out = append(out, vendorView{Vendor: v, Stats: stats[v.ID]})
	}
	c.JSON(http.StatusOK, gin.H{"vendors": out})
}

// vendorHistoryRow is one feasibility this vendor was checked for.
type vendorHistoryRow struct {
	FeasibilityID     uint       `json:"feasibility_id"`
	FeasibilityNumber string     `json:"feasibility_number"`
	Product           string     `json:"product"`
	City              string     `json:"city"`
	ClientName        string     `json:"client_name"`
	FeasibilityStatus string     `json:"feasibility_status"`
	VendorStatus      string     `json:"vendor_status"`
	Withdrawn         bool       `json:"withdrawn"`
	RespondedAt       *time.Time `json:"responded_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
}

func GetVendor(c *gin.Context) {
	var v models.Vendor
	if err := database.DB.First(&v, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Vendor not found"})
		return
	}

	// History: only feasibilities the caller is allowed to see (same rules
	// as the Feasibilities list).
	var history []vendorHistoryRow
	q := database.DB.Table("feasibility_vendors").
		Select(`feasibilities.id AS feasibility_id, feasibilities.feasibility_number, feasibilities.product,
			feasibilities.city, COALESCE(clients.company_name, '') AS client_name,
			feasibilities.status AS feasibility_status, feasibility_vendors.status AS vendor_status,
			feasibility_vendors.withdrawn, feasibility_vendors.responded_at, feasibility_vendors.created_at`).
		Joins("JOIN feasibilities ON feasibilities.id = feasibility_vendors.feasibility_id AND feasibilities.deleted_at IS NULL").
		Joins("LEFT JOIN clients ON clients.id = feasibilities.client_id").
		Where("feasibility_vendors.vendor_id = ? AND feasibility_vendors.deleted_at IS NULL", v.ID).
		Order("feasibility_vendors.created_at DESC").
		Limit(500)
	q = applyFeasibilityScope(q, viewerFrom(c))
	if err := q.Scan(&history).Error; err != nil {
		log.Printf("vendors: history for %d failed: %v", v.ID, err)
		history = []vendorHistoryRow{}
	}
	if history == nil {
		history = []vendorHistoryRow{}
	}

	stats := vendorStatsFor([]uint{v.ID})[v.ID]
	c.JSON(http.StatusOK, gin.H{"vendor": vendorView{Vendor: v, Stats: stats}, "history": history})
}

type vendorInput struct {
	Name          *string `json:"name"`
	ContactPerson *string `json:"contact_person"`
	Phone         *string `json:"phone"`
	Email         *string `json:"email"`
	Cities        *string `json:"cities"`
	Services      *string `json:"services"`
	Notes         *string `json:"notes"`
}

// clean trims every field that was sent and checks lengths / the email.
func (in *vendorInput) clean() string {
	limits := []struct {
		p     **string
		label string
		max   int
	}{
		{&in.Name, "Name", 150}, {&in.ContactPerson, "Contact person", 150},
		{&in.Phone, "Phone", 50}, {&in.Email, "Email", 150},
		{&in.Cities, "Cities", 500}, {&in.Services, "Services", 500},
		{&in.Notes, "Notes", 4000},
	}
	for _, l := range limits {
		if *l.p == nil {
			continue
		}
		t := strings.TrimSpace(**l.p)
		*l.p = &t
		if len([]rune(t)) > l.max {
			return fmt.Sprintf("%s is too long (max %d characters)", l.label, l.max)
		}
	}
	if in.Email != nil && *in.Email != "" {
		if _, err := mail.ParseAddress(*in.Email); err != nil {
			return "Email address is not valid"
		}
	}
	return ""
}

func strOr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// nameTakenBy returns the vendor (other than exceptID) already using name.
func nameTakenBy(name string, exceptID uint) *models.Vendor {
	v, err := models.FindVendorByName(database.DB, name)
	if err != nil || v == nil || v.ID == exceptID {
		return nil
	}
	return v
}

func CreateVendor(c *gin.Context) {
	var in vendorInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	if msg := in.clean(); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	if strOr(in.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Vendor name is required"})
		return
	}
	if other := nameTakenBy(*in.Name, 0); other != nil {
		msg := fmt.Sprintf("%s already exists (%s)", other.Name, other.VendorNumber)
		if other.Status == "archived" {
			msg += " — it is archived; restore it from the Archived tab"
		}
		c.JSON(http.StatusConflict, gin.H{"error": msg})
		return
	}

	uid := callerID(c)
	v := models.Vendor{
		Name:          *in.Name,
		ContactPerson: strOr(in.ContactPerson),
		Phone:         strOr(in.Phone),
		Email:         strOr(in.Email),
		Cities:        strOr(in.Cities),
		Services:      strOr(in.Services),
		Notes:         strOr(in.Notes),
		CreatedByID:   &uid,
	}
	if err := database.DB.Create(&v).Error; err != nil {
		log.Printf("vendors: create failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create vendor"})
		return
	}
	utils.LogAudit(uid, "created", "vendor", v.ID,
		fmt.Sprintf("Created vendor %s (%s)", v.Name, v.VendorNumber), c.ClientIP(), c.Request.UserAgent())
	c.JSON(http.StatusCreated, gin.H{"vendor": vendorView{Vendor: v}})
}

func UpdateVendor(c *gin.Context) {
	var v models.Vendor
	if err := database.DB.First(&v, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Vendor not found"})
		return
	}
	var in vendorInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	if msg := in.clean(); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}

	updates := map[string]interface{}{}
	if in.Name != nil {
		if *in.Name == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Vendor name can't be empty"})
			return
		}
		if other := nameTakenBy(*in.Name, v.ID); other != nil {
			c.JSON(http.StatusConflict, gin.H{"error": fmt.Sprintf("Another vendor is already called %s (%s)", other.Name, other.VendorNumber)})
			return
		}
		updates["name"] = *in.Name
	}
	set := func(col string, p *string) {
		if p != nil {
			updates[col] = *p
		}
	}
	set("contact_person", in.ContactPerson)
	set("phone", in.Phone)
	set("email", in.Email)
	set("cities", in.Cities)
	set("services", in.Services)
	set("notes", in.Notes)

	if len(updates) == 0 {
		c.JSON(http.StatusOK, gin.H{"vendor": vendorView{Vendor: v, Stats: vendorStatsFor([]uint{v.ID})[v.ID]}})
		return
	}

	before := v
	if err := database.DB.Model(&v).Updates(updates).Error; err != nil {
		log.Printf("vendors: update %d failed: %v", v.ID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update vendor"})
		return
	}
	database.DB.First(&v, v.ID)

	keys := []string{"name", "contact_person", "phone", "email", "cities", "services", "notes"}
	oldVals, newVals, changed := fieldDiff(before, v, keys)
	if len(changed) > 0 {
		utils.LogAuditWithValues(callerID(c), "updated", "vendor", v.ID, oldVals, newVals,
			fmt.Sprintf("Updated vendor %s: %s", v.VendorNumber, strings.Join(changed, ", ")),
			c.ClientIP(), c.Request.UserAgent())
	}
	c.JSON(http.StatusOK, gin.H{"vendor": vendorView{Vendor: v, Stats: vendorStatsFor([]uint{v.ID})[v.ID]}})
}

// ArchiveVendor — DELETE /api/vendors/:id. Nothing is hard-deleted (slide
// 29): the vendor leaves the pickers, keeps its ID and history, and can be
// restored. Rows already on feasibilities are untouched.
func ArchiveVendor(c *gin.Context) {
	var v models.Vendor
	if err := database.DB.First(&v, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Vendor not found"})
		return
	}
	if v.Status == "archived" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Already archived"})
		return
	}
	uid := callerID(c)
	now := time.Now()
	if err := database.DB.Model(&v).Updates(map[string]interface{}{
		"status": "archived", "archived_at": now, "archived_by_id": uid,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to archive vendor"})
		return
	}
	utils.LogAuditWithValues(uid, "archived", "vendor", v.ID,
		statusChange("active"), statusChange("archived"),
		fmt.Sprintf("Archived vendor %s (%s)", v.Name, v.VendorNumber), c.ClientIP(), c.Request.UserAgent())
	c.JSON(http.StatusOK, gin.H{"message": "Vendor archived"})
}

func RestoreVendor(c *gin.Context) {
	var v models.Vendor
	if err := database.DB.First(&v, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Vendor not found"})
		return
	}
	if v.Status != "archived" {
		notArchived(c)
		return
	}
	if err := database.DB.Model(&v).Updates(map[string]interface{}{
		"status": "active", "archived_at": nil, "archived_by_id": nil,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to restore vendor"})
		return
	}
	utils.LogAuditWithValues(callerID(c), "restored", "vendor", v.ID,
		statusChange("archived"), statusChange("active"),
		fmt.Sprintf("Restored vendor %s (%s)", v.Name, v.VendorNumber), c.ClientIP(), c.Request.UserAgent())
	c.JSON(http.StatusOK, gin.H{"message": "Vendor restored"})
}

// vendorErrorMessage turns a vendor-link failure from the create hook into a
// message for the person adding the vendor to a feasibility.
func vendorErrorMessage(err error) (string, bool) {
	if errors.Is(err, models.ErrVendorArchived) {
		return strings.TrimSuffix(err.Error(), ": "+models.ErrVendorArchived.Error()) +
			" is archived in Vendors. Restore it there first, or pick another vendor.", true
	}
	if err != nil && (err.Error() == "vendor not found" || err.Error() == "vendor name is required") {
		return strings.ToUpper(err.Error()[:1]) + err.Error()[1:], true
	}
	return "", false
}

// EnsureVendorMaster runs at startup (idempotent):
//   - one active-or-archived vendor per name (unique, case-insensitive),
//   - every existing feasibility vendor row that was typed in before the
//     master list existed gets linked to a master vendor (created from its
//     name, with the contact details from its most recent row).
func EnsureVendorMaster() {
	if err := database.DB.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_vendors_name
		ON vendors (LOWER(TRIM(name))) WHERE deleted_at IS NULL`).Error; err != nil {
		log.Printf("vendors: unique name index failed: %v", err)
	}

	var names []string
	database.DB.Model(&models.FeasibilityVendor{}).Unscoped().
		Where("vendor_id IS NULL AND TRIM(vendor_name) <> ''").
		Distinct("vendor_name").Pluck("vendor_name", &names)

	linked := 0
	for _, n := range names {
		v, err := models.FindVendorByName(database.DB, n)
		if err != nil {
			log.Printf("vendors: looking up %q failed: %v", n, err)
			continue
		}
		if v == nil {
			// Seed contacts from the newest row that has any.
			var latest models.FeasibilityVendor
			database.DB.Unscoped().Where("LOWER(TRIM(vendor_name)) = LOWER(TRIM(?))", n).
				Order("(COALESCE(contact_person, '') <> '' OR COALESCE(contact_phone, '') <> '' OR COALESCE(contact_email, '') <> '') DESC, updated_at DESC").
				Take(&latest)
			nv := models.Vendor{
				Name:          n,
				ContactPerson: latest.ContactPerson,
				Phone:         latest.ContactPhone,
				Email:         latest.ContactEmail,
			}
			if err := database.DB.Create(&nv).Error; err != nil {
				if again, _ := models.FindVendorByName(database.DB, n); again != nil {
					v = again
				} else {
					log.Printf("vendors: creating %q failed: %v", n, err)
					continue
				}
			} else {
				v = &nv
			}
		}
		res := database.DB.Model(&models.FeasibilityVendor{}).Unscoped().
			Where("vendor_id IS NULL AND vendor_name = ?", n).
			Update("vendor_id", v.ID)
		linked += int(res.RowsAffected)
	}
	if linked > 0 {
		log.Printf("vendors: linked %d existing feasibility vendor rows to the vendor master", linked)
	}
}

// archivedVendorMessage reports, before a feasibility is saved, a vendor that
// is archived in the master list ("" when it is fine or new).
func archivedVendorMessage(id *uint, name string) string {
	var v *models.Vendor
	if id != nil && *id != 0 {
		var byID models.Vendor
		if database.DB.First(&byID, *id).Error != nil {
			return "Vendor not found"
		}
		v = &byID
	} else {
		v, _ = models.FindVendorByName(database.DB, name)
	}
	if v != nil && v.Status == "archived" {
		return v.Name + " is archived in Vendors. Restore it there first, or pick another vendor."
	}
	return ""
}

// duplicateVendorMessage reports a vendor that is already on this
// feasibility ("" when it isn't).
func duplicateVendorMessage(feasibilityID uint, id *uint, name string) string {
	var v *models.Vendor
	if id != nil && *id != 0 {
		var byID models.Vendor
		if database.DB.First(&byID, *id).Error == nil {
			v = &byID
		}
	} else {
		v, _ = models.FindVendorByName(database.DB, name)
	}
	if v == nil {
		return "" // a new vendor can't be on it yet
	}
	var row models.FeasibilityVendor
	if database.DB.Where("feasibility_id = ? AND vendor_id = ?", feasibilityID, v.ID).Take(&row).Error != nil {
		return ""
	}
	if row.Withdrawn {
		return v.Name + " was withdrawn from this feasibility. Reinstate it instead of adding it again."
	}
	return v.Name + " is already on this feasibility."
}
