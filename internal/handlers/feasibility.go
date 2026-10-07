package handlers

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// This file's handlers never read the caller, so nothing they did was audited
// and archived records had no "archived by". auditFeasibility records the
// action against the real user.
func callerID(c *gin.Context) uint {
	idVal, _ := c.Get("user_id")
	id, _ := idVal.(uint)
	return id
}

func auditFeasibility(c *gin.Context, action string, id uint, details string) {
	utils.LogAudit(callerID(c), action, "feasibility", id, details, c.ClientIP(), c.Request.UserAgent())
}

// Statuses PUT /feasibilities/:id may set. "converted" only comes from the
// convert action and "archived" only from the archive action.
func validFeasibilityStatus(s string) bool {
	switch s {
	case "draft", "in_progress", "feasible", "not_feasible", "cancelled":
		return true
	}
	return false
}

func validVendorStatus(s string) bool {
	switch s {
	case "pending", "feasible", "not_feasible", "waiting_response":
		return true
	}
	return false
}

type CreateFeasibilityInput struct {
	FeasibilityNumber string `json:"feasibility_number"`

	ClientID uint `json:"client_id" binding:"required"`

	Product            string `json:"product" binding:"required"`
	Capacity           string `json:"capacity"`
	FromLocation       string `json:"from_location"`
	ToLocation         string `json:"to_location"`
	City               string `json:"city"`
	RequirementDetails string `json:"requirement_details"`
	Subject            string `json:"subject"` // optional

	AssignedDept   string `json:"assigned_dept"`
	AssignedUserID *uint  `json:"assigned_user_id"`

	Priority   string `json:"priority"`
	Status     string `json:"status"`
	Notes      string `json:"notes"`
	TargetDate string `json:"target_date"`

	Vendors []CreateFeasibilityVendorInput `json:"vendors"`
}

type CreateFeasibilityVendorInput struct {
	// From the vendor master (vendor_id), or by name: a new name is added to
	// the master automatically (see models/vendor.go).
	VendorID      *uint  `json:"vendor_id"`
	VendorName    string `json:"vendor_name" binding:"required"`
	ContactPerson string `json:"contact_person"`
	ContactEmail  string `json:"contact_email"`
	ContactPhone  string `json:"contact_phone"`
	QuotationRef  string `json:"quotation_ref"`
}

type UpdateFeasibilityInput struct {
	FeasibilityNumber string `json:"feasibility_number"`

	ClientID *uint `json:"client_id"`

	Product            string `json:"product"`
	Capacity           string `json:"capacity"`
	FromLocation       string `json:"from_location"`
	ToLocation         string `json:"to_location"`
	City               string `json:"city"`
	RequirementDetails string `json:"requirement_details"`
	// Pointer so the optional subject can be cleared ("" = remove it).
	Subject *string `json:"subject"`

	AssignedDept   string `json:"assigned_dept"`
	AssignedUserID *uint  `json:"assigned_user_id"`

	Priority   string `json:"priority"`
	Status     string `json:"status"`
	Notes      string `json:"notes"`
	TargetDate string `json:"target_date"`
}

// Limits for the free-text product (a product not in the standard list can
// be typed in) and the optional subject.
const (
	maxFeasibilityProductLen = 100
	maxFeasibilitySubjectLen = 200
)

// cleanFeasibilityText trims a value and checks its length.
func cleanFeasibilityText(v string, max int, field string) (string, string) {
	v = strings.TrimSpace(v)
	if len([]rune(v)) > max {
		return "", fmt.Sprintf("%s can be at most %d characters", field, max)
	}
	return v, ""
}

// FeasibilityID was previously required in the JSON body, but this struct
// is only ever bound in AddFeasibilityVendor, which loads the feasibility
// from the URL's :id param and never reads input.FeasibilityID at all — it
// was dead weight, redundant with the URL, and duplicating it into every
// caller's body served no purpose except rejecting any request that
// didn't happen to also repeat the id there. That's exactly what was
// happening: the vendor-add form sends vendor_name/contact_*/quotation_ref
// only (the id is already in the URL, same as every other nested-resource
// endpoint in this file), so every add-vendor request failed with
// "Field validation for 'FeasibilityID' failed on the 'required' tag."
type CreateFeasibilityVendorInputDirect struct {
	// Picked from the vendor master (vendor_id), or typed: an unknown name is
	// added to the master automatically (see models/vendor.go).
	VendorID      *uint  `json:"vendor_id"`
	VendorName    string `json:"vendor_name" binding:"required"`
	ContactPerson string `json:"contact_person"`
	ContactEmail  string `json:"contact_email"`
	ContactPhone  string `json:"contact_phone"`
	QuotationRef  string `json:"quotation_ref"`
	Status        string `json:"status"`
	ResponseNotes string `json:"response_notes"`
	EvidenceURLs  string `json:"evidence_urls"`
}

type UpdateFeasibilityVendorInput struct {
	VendorID      *uint  `json:"vendor_id"`
	VendorName    string `json:"vendor_name"`
	ContactPerson string `json:"contact_person"`
	ContactEmail  string `json:"contact_email"`
	ContactPhone  string `json:"contact_phone"`
	QuotationRef  string `json:"quotation_ref"`
	Status        string `json:"status"`
	ResponseNotes string `json:"response_notes"`
	EvidenceURLs  string `json:"evidence_urls"`
}

type ConvertFeasibilityInput struct {
	ProjectTitle       string `json:"project_title" binding:"required"`
	ProjectDescription string `json:"project_description"`
	ProjectDepartment  string `json:"project_department"`
	ProjectPriority    string `json:"project_priority"`
	OwnerID            *uint  `json:"owner_id"`
	AdminID            *uint  `json:"admin_id"`
}

// GetFeasibilities fetches all feasibility records
func GetFeasibilities(c *gin.Context) {
	v := viewerFrom(c)
	query := database.DB.
		Preload("Client").
		Preload("AssignedUser").
		Preload("CreatedBy").
		Preload("Vendors").
		Preload("Attachments").
		Preload("ConvertedProject")

	// Only what the caller may see (see feasibilityScopeClause), then the
	// Feasibilities page's filters.
	query = applyFeasibilityFilters(c, applyFeasibilityScope(query, v))

	// Paged when ?page= is given (the Feasibilities page asks for one page
	// at a time). Without it, everything, as before.
	_, paged := c.GetQuery("page")
	var total int64
	var page, limit int
	if paged {
		page, _ = strconv.Atoi(c.Query("page"))
		limit, _ = strconv.Atoi(c.DefaultQuery("limit", "50"))
		page, limit = clampPagination(page, limit)
		query.Session(&gorm.Session{}).Model(&models.Feasibility{}).Count(&total)
		query = query.Offset((page - 1) * limit).Limit(limit)
	}

	var feasibilities []models.Feasibility
	if result := orderFeasibilities(query, c.Query("sort"), v.ID).Find(&feasibilities); result.Error != nil {
		serverError(c, "Failed to fetch feasibilities", result.Error)
		return
	}
	if !paged {
		c.JSON(http.StatusOK, gin.H{"feasibilities": feasibilities})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"feasibilities": feasibilities,
		"pagination": gin.H{
			"page":  page,
			"limit": limit,
			"total": total,
			"pages": (total + int64(limit) - 1) / int64(limit),
		},
	})
}

// applyFeasibilityFilters — the Feasibilities page's filters:
//
//	search       number, product, city, requirement, subject, client name
//	status       a status; "pending" = draft or in progress; default all but archived
//	product, city, assigned_user_id, client_id
//	vendor       a vendor on the feasibility (by name, any case)
func applyFeasibilityFilters(c *gin.Context, q *gorm.DB) *gorm.DB {
	if search := strings.TrimSpace(c.Query("search")); search != "" {
		like := "%" + strings.ToLower(search) + "%"
		q = q.Where(`(LOWER(feasibilities.feasibility_number) LIKE ? OR LOWER(feasibilities.product) LIKE ?
			OR LOWER(feasibilities.city) LIKE ? OR LOWER(feasibilities.requirement_details) LIKE ?
			OR LOWER(feasibilities.subject) LIKE ?
			OR EXISTS (SELECT 1 FROM clients WHERE clients.id = feasibilities.client_id
				AND clients.deleted_at IS NULL AND LOWER(clients.company_name) LIKE ?))`,
			like, like, like, like, like, like)
	}
	switch status := c.Query("status"); status {
	case "":
		// See the matching comment in projects.go's GetProjects.
		q = q.Where("feasibilities.status != ?", "archived")
	case "pending":
		q = q.Where("feasibilities.status IN ?", []string{"draft", "in_progress"})
	default:
		q = q.Where("feasibilities.status = ?", status)
	}
	if product := c.Query("product"); product != "" {
		q = q.Where("feasibilities.product = ?", product)
	}
	if city := c.Query("city"); city != "" {
		q = q.Where("feasibilities.city = ?", city)
	}
	if id, err := strconv.Atoi(c.Query("assigned_user_id")); err == nil && id > 0 {
		q = q.Where("feasibilities.assigned_user_id = ?", id)
	}
	if id, err := strconv.Atoi(c.Query("client_id")); err == nil && id > 0 {
		q = q.Where("feasibilities.client_id = ?", id)
	}
	if vendor := strings.TrimSpace(c.Query("vendor")); vendor != "" {
		q = q.Where(`EXISTS (SELECT 1 FROM feasibility_vendors fv WHERE fv.feasibility_id = feasibilities.id
			AND fv.deleted_at IS NULL AND LOWER(fv.vendor_name) = LOWER(?))`, vendor)
	}
	return q
}

// orderFeasibilities — the caller's pinned feasibilities first, then the
// page's sort: target_date (soonest; none first, as the page always did),
// priority (critical first), status, or created (newest, the default).
func orderFeasibilities(q *gorm.DB, sort string, userID uint) *gorm.DB {
	// userID is the caller's numeric id from the token (formatted as a number,
	// so nothing user-typed reaches the SQL). GORM's Order() drops bound
	// expressions, hence the plain string.
	q = q.Order(fmt.Sprintf(
		"(EXISTS (SELECT 1 FROM pins WHERE pins.user_id = %d AND pins.record_type = 'feasibility' AND pins.record_id = feasibilities.id)) DESC",
		userID))
	switch sort {
	case "target_date":
		q = q.Order("NULLIF(feasibilities.target_date, '') ASC NULLS FIRST")
	case "priority":
		q = q.Order("CASE feasibilities.priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC")
	case "status":
		q = q.Order(`CASE feasibilities.status WHEN 'converted' THEN 6 WHEN 'feasible' THEN 5 WHEN 'in_progress' THEN 4
			WHEN 'not_feasible' THEN 3 WHEN 'draft' THEN 2 WHEN 'cancelled' THEN 1 ELSE 0 END DESC`)
	}
	// Newest first breaks ties (and is the "created" sort); id keeps paging stable.
	return q.Order("feasibilities.created_at DESC").Order("feasibilities.id DESC")
}

// GetFeasibilitySummary — GET /api/feasibilities/summary
//
// What other screens need now that the full list isn't loaded in the
// browser: counts (sidebar badge, dashboard "Pending"), the caller's pinned
// feasibilities (dashboard), and the values for the page's filter lists.
// Same visibility rules as the list.
func GetFeasibilitySummary(c *gin.Context) {
	v := viewerFrom(c)
	scoped := func() *gorm.DB {
		return applyFeasibilityScope(database.DB.Model(&models.Feasibility{}), v).
			Where("feasibilities.status != ?", "archived")
	}

	var total, pending int64
	scoped().Count(&total)
	scoped().Where("feasibilities.status IN ?", []string{"draft", "in_progress"}).Count(&pending)

	var cities []string
	scoped().Where("TRIM(feasibilities.city) <> ''").Distinct("feasibilities.city").
		Order("feasibilities.city").Pluck("feasibilities.city", &cities)

	var vendors []string
	database.DB.Model(&models.FeasibilityVendor{}).
		Where("feasibility_id IN (?)", scoped().Select("feasibilities.id")).
		Where("TRIM(vendor_name) <> ''").
		Distinct("vendor_name").Order("vendor_name").Pluck("vendor_name", &vendors)

	type clientOpt struct {
		ID          uint   `json:"id"`
		CompanyName string `json:"company_name"`
	}
	var clients []clientOpt
	database.DB.Model(&models.Client{}).
		Where("id IN (?)", scoped().Where("feasibilities.client_id IS NOT NULL").Select("feasibilities.client_id")).
		Order("company_name").Select("id", "company_name").Scan(&clients)

	var pinned []models.Feasibility
	scoped().
		Where("feasibilities.id IN (?)", database.DB.Model(&models.Pin{}).
			Where("user_id = ? AND record_type = ?", v.ID, "feasibility").Select("record_id")).
		Select("feasibilities.id", "feasibilities.feasibility_number", "feasibilities.product",
			"feasibilities.capacity", "feasibilities.status").
		Order("feasibilities.created_at DESC").Limit(20).Find(&pinned)

	c.JSON(http.StatusOK, gin.H{
		"total":   total,
		"pending": pending,
		"cities":  cities,
		"vendors": vendors,
		"clients": clients,
		"pinned":  pinned,
	})
}

// GetFeasibility fetches a single feasibility by ID
func GetFeasibility(c *gin.Context) {
	idParam := c.Param("id")

	var feasibility models.Feasibility
	if err := database.DB.
		Preload("Client").
		Preload("AssignedUser").
		Preload("CreatedBy").
		Preload("Vendors").
		Preload("Attachments").
		Preload("ConvertedProject").
		First(&feasibility, idParam).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Feasibility not found"})
		return
	}
	if !userCanAccessFeasibility(c, &feasibility) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"feasibility": feasibility})
}

// CreateFeasibility creates a new feasibility record with optional vendors
func CreateFeasibility(c *gin.Context) {
	var input CreateFeasibilityInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if input.Status != "" && !validFeasibilityStatus(input.Status) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid feasibility status"})
		return
	}
	// Report a missing client as a validation error rather than a foreign-key
	// failure from the insert.
	var client models.Client
	if err := database.DB.First(&client, input.ClientID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Client not found"})
		return
	}

	if msg := assigneeError(input.AssignedUserID); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	if !departmentIsKnown(input.AssignedDept) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unknown department"})
		return
	}

	// Auto-generate FeasibilityNumber if not provided
	feasNum := input.FeasibilityNumber
	if feasNum == "" {
		// Permanent ID from the atomic counter (spec slide 7).
		nextID, idErr := models.NextID(database.DB, "FEA")
		if idErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to allocate a feasibility ID"})
			return
		}
		feasNum = nextID
	}

	product, msg := cleanFeasibilityText(input.Product, maxFeasibilityProductLen, "Product")
	if msg == "" && product == "" {
		msg = "Product is required"
	}
	subject, subjMsg := cleanFeasibilityText(input.Subject, maxFeasibilitySubjectLen, "Subject")
	if msg == "" {
		msg = subjMsg
	}
	if msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}

	feasibility := models.Feasibility{
		FeasibilityNumber:  feasNum,
		ClientID:           &input.ClientID,
		Product:            product,
		Subject:            subject,
		Capacity:           input.Capacity,
		FromLocation:       input.FromLocation,
		ToLocation:         input.ToLocation,
		City:               input.City,
		RequirementDetails: input.RequirementDetails,
		AssignedDept:       input.AssignedDept,
		AssignedUserID:     input.AssignedUserID,
		Priority:           input.Priority,
		Status:             input.Status,
		Notes:              input.Notes,
		TargetDate:         input.TargetDate,
	}
	creator := callerID(c)
	if creator != 0 {
		feasibility.CreatedByID = &creator
	}

	if feasibility.Priority == "" {
		feasibility.Priority = "normal"
	}
	if feasibility.Status == "" {
		feasibility.Status = "draft"
	}

	// Create feasibility first
	// Vendors must not be archived in the vendor master. Checked before
	// anything is saved so a bad vendor doesn't leave a half-made feasibility.
	for _, v := range input.Vendors {
		if msg := archivedVendorMessage(v.VendorID, v.VendorName); msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}
	}

	if result := database.DB.Omit("Client", "AssignedUser", "CreatedBy", "Vendors", "Attachments", "ConvertedProject").Create(&feasibility); result.Error != nil {
		serverError(c, "Failed to create feasibility", result.Error)
		return
	}

	// Create vendors if provided
	for _, v := range input.Vendors {
		vendor := models.FeasibilityVendor{
			FeasibilityID: feasibility.ID,
			VendorID:      v.VendorID,
			VendorName:    v.VendorName,
			ContactPerson: v.ContactPerson,
			ContactEmail:  v.ContactEmail,
			ContactPhone:  v.ContactPhone,
			QuotationRef:  v.QuotationRef,
			Status:        "pending",
		}
		if err := database.DB.Create(&vendor).Error; err != nil {
			log.Printf("feasibility %s: adding vendor %q failed: %v", feasibility.FeasibilityNumber, v.VendorName, err)
		}
	}

	auditFeasibility(c, "created", feasibility.ID,
		fmt.Sprintf("Created feasibility %s (%s) for client %s", feasibility.FeasibilityNumber, feasibility.Product, client.CompanyName))

	// Reload with relations
	database.DB.
		Preload("Client").
		Preload("AssignedUser").
		Preload("CreatedBy").
		Preload("Vendors").
		Preload("Attachments").
		Preload("ConvertedProject").
		First(&feasibility, feasibility.ID)

	c.JSON(http.StatusCreated, gin.H{"message": "Feasibility created successfully", "feasibility": feasibility})
}

// UpdateFeasibility updates an existing feasibility
func UpdateFeasibility(c *gin.Context) {
	idParam := c.Param("id")

	var input UpdateFeasibilityInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var feasibility models.Feasibility
	if err := database.DB.First(&feasibility, idParam).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Feasibility not found"})
		return
	}
	// Anyone who can see it can work on it (assignee, creator, supervisor of
	// the assignee, department admin) — this used to be open to everyone.
	if !userCanAccessFeasibility(c, &feasibility) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	updates := map[string]interface{}{}
	// FEA- numbers are permanent IDs (spec) — they could be edited here.
	if input.FeasibilityNumber != "" && input.FeasibilityNumber != feasibility.FeasibilityNumber {
		c.JSON(http.StatusBadRequest, gin.H{"error": "The feasibility number can't be changed"})
		return
	}
	if input.ClientID != nil {
		updates["client_id"] = *input.ClientID
	}
	if strings.TrimSpace(input.Product) != "" {
		product, msg := cleanFeasibilityText(input.Product, maxFeasibilityProductLen, "Product")
		if msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}
		updates["product"] = product
	}
	if input.Subject != nil {
		subject, msg := cleanFeasibilityText(*input.Subject, maxFeasibilitySubjectLen, "Subject")
		if msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}
		updates["subject"] = subject
	}
	if input.Capacity != "" {
		updates["capacity"] = input.Capacity
	}
	if input.FromLocation != "" {
		updates["from_location"] = input.FromLocation
	}
	if input.ToLocation != "" {
		updates["to_location"] = input.ToLocation
	}
	if input.City != "" {
		updates["city"] = input.City
	}
	if input.RequirementDetails != "" {
		updates["requirement_details"] = input.RequirementDetails
	}
	// Changing who (or which department) handles it is a reassignment: it
	// needs "Reassign Tickets & Tasks", the same rule as tasks and tickets.
	// assigned_user_id 0 clears the assignee.
	deptChanging := input.AssignedDept != "" && !strings.EqualFold(strings.TrimSpace(input.AssignedDept), strings.TrimSpace(feasibility.AssignedDept))
	var newAssignee *uint
	assigneeChanging := false
	if input.AssignedUserID != nil {
		if *input.AssignedUserID != 0 {
			newAssignee = input.AssignedUserID
		}
		assigneeChanging = (feasibility.AssignedUserID == nil) != (newAssignee == nil) ||
			(feasibility.AssignedUserID != nil && newAssignee != nil && *feasibility.AssignedUserID != *newAssignee)
	}
	if (deptChanging || assigneeChanging) && !canAssignWork(viewerFrom(c).Role) {
		c.JSON(http.StatusForbidden, gin.H{"error": "You don't have permission to reassign feasibilities"})
		return
	}
	if deptChanging {
		if !departmentIsKnown(input.AssignedDept) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Unknown department"})
			return
		}
		updates["assigned_dept"] = input.AssignedDept
	}
	if assigneeChanging {
		if msg := assigneeError(newAssignee); msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}
		if newAssignee == nil {
			updates["assigned_user_id"] = nil
		} else {
			updates["assigned_user_id"] = *newAssignee
		}
	}
	if input.Priority != "" {
		updates["priority"] = input.Priority
	}
	if input.Status != "" {
		// "archived" deliberately excluded — only DeleteFeasibility's
		// permission-gated path can set it (same rule as Task/Ticket).
		// Also blocks the pre-existing hole where this endpoint could
		// set status: "converted" directly, bypassing
		// ConvertFeasibilityToProject's "must have a feasible vendor"
		// check and leaving a Feasibility marked converted with no
		// ConvertedProjectID — that's a real inconsistent state, not
		// just an archiving concern, but it's the same fix.
		if input.Status == "archived" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Use the archive/delete action to archive a feasibility"})
			return
		}
		if input.Status == "converted" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Use the convert-to-project action to mark a feasibility converted"})
			return
		}
		// Any other string used to be accepted. An unchanged status is a no-op
		// (edit forms resend the current one, which may be "converted").
		if input.Status != feasibility.Status {
			if !validFeasibilityStatus(input.Status) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid feasibility status"})
				return
			}
			updates["status"] = input.Status
		}
	}
	if input.Notes != "" {
		updates["notes"] = input.Notes
	}
	if input.TargetDate != "" {
		updates["target_date"] = input.TargetDate
	}

	if len(updates) > 0 {
		// Captured BEFORE Updates(): GORM writes map values back into the model.
		oldStatus := feasibility.Status
		if err := database.DB.Model(&feasibility).Updates(updates).Error; err != nil {
			serverError(c, "Failed to update feasibility", err)
			return
		}
		details := fmt.Sprintf("Updated feasibility %s", feasibility.FeasibilityNumber)
		if newStatus, ok := updates["status"]; ok {
			details += fmt.Sprintf(": status %s -> %v", oldStatus, newStatus)
			utils.LogAuditWithValues(callerID(c), "status_changed", "feasibility", feasibility.ID,
				statusChange(oldStatus), statusChange(fmt.Sprint(newStatus)), details, c.ClientIP(), c.Request.UserAgent())
		} else {
			auditFeasibility(c, "updated", feasibility.ID, details)
		}
	}

	database.DB.
		Preload("Client").
		Preload("AssignedUser").
		Preload("CreatedBy").
		Preload("Vendors").
		Preload("Attachments").
		Preload("ConvertedProject").
		First(&feasibility, idParam)

	c.JSON(http.StatusOK, gin.H{"message": "Feasibility updated successfully", "feasibility": feasibility})
}

// DeleteFeasibility archives a feasibility — see the matching comment on
// DeleteProject in projects.go for why this replaces GORM soft-delete.
// It now records who archived it and audits the action (ArchivedByID was
// left nil and nothing was logged).
func DeleteFeasibility(c *gin.Context) {
	idParam := c.Param("id")

	var feasibility models.Feasibility
	if err := database.DB.First(&feasibility, idParam).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Feasibility already deleted"})
		return
	}
	if !userCanAccessFeasibility(c, &feasibility) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Archiving twice would overwrite pre_archive_status with "archived",
	// losing the status Restore needs.
	if feasibility.Status == "archived" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Already archived"})
		return
	}

	now := time.Now()
	if err := database.DB.Model(&feasibility).Updates(map[string]interface{}{
		"status":             "archived",
		"pre_archive_status": feasibility.Status,
		"archived_at":        now,
		"archived_by_id":     callerID(c),
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to archive feasibility"})
		return
	}
	auditFeasibility(c, "archived", feasibility.ID, fmt.Sprintf("Archived feasibility %s", feasibility.FeasibilityNumber))
	c.JSON(http.StatusOK, gin.H{"message": "Feasibility archived successfully"})
}

// --- Vendor endpoints ---

// AddFeasibilityVendor adds a vendor to an existing feasibility
func AddFeasibilityVendor(c *gin.Context) {
	idParam := c.Param("id")

	var input CreateFeasibilityVendorInputDirect
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var feasibility models.Feasibility
	if err := database.DB.First(&feasibility, idParam).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Feasibility not found"})
		return
	}
	if !userCanAccessFeasibility(c, &feasibility) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	vendor := models.FeasibilityVendor{
		FeasibilityID: feasibility.ID,
		VendorID:      input.VendorID,
		VendorName:    input.VendorName,
		ContactPerson: input.ContactPerson,
		ContactEmail:  input.ContactEmail,
		ContactPhone:  input.ContactPhone,
		QuotationRef:  input.QuotationRef,
		Status:        input.Status,
		ResponseNotes: input.ResponseNotes,
		EvidenceURLs:  input.EvidenceURLs,
	}

	if vendor.Status == "" {
		vendor.Status = "pending"
	}
	if !validVendorStatus(vendor.Status) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid vendor status"})
		return
	}

	// The same vendor only once per feasibility (a withdrawn one can be
	// reinstated instead of added again).
	if msg := duplicateVendorMessage(feasibility.ID, input.VendorID, input.VendorName); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}

	if result := database.DB.Create(&vendor); result.Error != nil {
		if msg, ok := vendorErrorMessage(result.Error); ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}
		log.Printf("feasibility %s: adding vendor failed: %v", feasibility.FeasibilityNumber, result.Error)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add vendor"})
		return
	}
	auditFeasibility(c, "vendor_added", feasibility.ID, fmt.Sprintf("Added vendor %s to %s", vendor.VendorName, feasibility.FeasibilityNumber))

	database.DB.Preload("Vendors").First(&feasibility, feasibility.ID)
	// "vendor" is the one just created; "feasibility" carries the full,
	// current vendor list. The frontend used to look for "vendor", didn't
	// find it, and fell back to appending the first vendor again.
	c.JSON(http.StatusCreated, gin.H{"message": "Vendor added successfully", "vendor": vendor, "feasibility": feasibility})
}

// UpdateFeasibilityVendor updates a vendor's status/response/evidence
func UpdateFeasibilityVendor(c *gin.Context) {
	idParam := c.Param("id")
	vendorIdParam := c.Param("vendorId")

	var input UpdateFeasibilityVendorInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var parent models.Feasibility
	if err := database.DB.First(&parent, idParam).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Feasibility not found"})
		return
	}
	if !userCanAccessFeasibility(c, &parent) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	var vendor models.FeasibilityVendor
	if err := database.DB.Where("id = ? AND feasibility_id = ?", vendorIdParam, idParam).First(&vendor).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Vendor not found"})
		return
	}

	updates := map[string]interface{}{}
	// Changing which vendor this row is: re-link it to the vendor master.
	nameChanged := input.VendorName != "" && !strings.EqualFold(strings.TrimSpace(input.VendorName), strings.TrimSpace(vendor.VendorName))
	idChanged := input.VendorID != nil && *input.VendorID != 0 && (vendor.VendorID == nil || *vendor.VendorID != *input.VendorID)
	if nameChanged || idChanged {
		var pickID *uint
		if idChanged {
			pickID = input.VendorID
		}
		uid := callerID(c)
		master, err := models.ResolveVendor(database.DB, pickID, input.VendorName, &uid)
		if err != nil {
			if msg, ok := vendorErrorMessage(err); ok {
				c.JSON(http.StatusBadRequest, gin.H{"error": msg})
				return
			}
			log.Printf("feasibility vendor %d: re-linking failed: %v", vendor.ID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update vendor"})
			return
		}
		updates["vendor_id"] = master.ID
		updates["vendor_name"] = master.Name
	}
	if input.ContactPerson != "" {
		updates["contact_person"] = input.ContactPerson
	}
	if input.ContactEmail != "" {
		updates["contact_email"] = input.ContactEmail
	}
	if input.ContactPhone != "" {
		updates["contact_phone"] = input.ContactPhone
	}
	if input.QuotationRef != "" {
		updates["quotation_ref"] = input.QuotationRef
	}
	if input.Status != "" {
		if !validVendorStatus(input.Status) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid vendor status"})
			return
		}
		updates["status"] = input.Status
	}
	if input.ResponseNotes != "" {
		updates["response_notes"] = input.ResponseNotes
	}
	if input.EvidenceURLs != "" {
		updates["evidence_urls"] = input.EvidenceURLs
	}

	// If status changed to feasible/not_feasible, stamp responded_at
	if input.Status == "feasible" || input.Status == "not_feasible" {
		now := time.Now()
		updates["responded_at"] = now
	}

	if len(updates) > 0 {
		oldVendorStatus := vendor.Status
		if err := database.DB.Model(&vendor).Updates(updates).Error; err != nil {
			serverError(c, "Failed to update vendor", err)
			return
		}
		if newStatus, ok := updates["status"]; ok && fmt.Sprint(newStatus) != oldVendorStatus {
			utils.LogAuditWithValues(callerID(c), "vendor_status_changed", "feasibility", vendor.FeasibilityID,
				statusChange(oldVendorStatus), statusChange(fmt.Sprint(newStatus)),
				fmt.Sprintf("Vendor %s: %s -> %v", vendor.VendorName, oldVendorStatus, newStatus), c.ClientIP(), c.Request.UserAgent())
		} else {
			auditFeasibility(c, "vendor_updated", vendor.FeasibilityID, fmt.Sprintf("Updated vendor %s", vendor.VendorName))
		}
	}

	database.DB.First(&vendor, vendor.ID)
	c.JSON(http.StatusOK, gin.H{"message": "Vendor updated successfully", "vendor": vendor})
}

// DeleteFeasibilityVendor removes a vendor
func DeleteFeasibilityVendor(c *gin.Context) {
	idParam := c.Param("id")
	vendorIdParam := c.Param("vendorId")

	var parent models.Feasibility
	if err := database.DB.First(&parent, idParam).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Feasibility not found"})
		return
	}
	if !userCanAccessFeasibility(c, &parent) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	var vendor models.FeasibilityVendor
	if err := database.DB.Where("id = ? AND feasibility_id = ?", vendorIdParam, idParam).First(&vendor).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Vendor already deleted"})
		return
	}

	// Withdrawn, not deleted: the vendor stays on the feasibility with its
	// quotes / responses (greyed out) and can be reinstated.
	now := time.Now()
	by := callerID(c)
	if err := database.DB.Model(&vendor).Updates(map[string]interface{}{
		"withdrawn": true, "withdrawn_at": now, "withdrawn_by_id": by,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to withdraw vendor"})
		return
	}
	auditFeasibility(c, "vendor_withdrawn", vendor.FeasibilityID, fmt.Sprintf("Withdrew vendor %s (kept, can be reinstated)", vendor.VendorName))
	c.JSON(http.StatusOK, gin.H{"message": "Vendor withdrawn"})
}

// ConvertFeasibilityToProject converts a feasible feasibility into a Project
func ConvertFeasibilityToProject(c *gin.Context) {
	idParam := c.Param("id")

	var input ConvertFeasibilityInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var feasibility models.Feasibility
	if err := database.DB.
		Preload("Client").
		Preload("Vendors").
		First(&feasibility, idParam).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Feasibility not found"})
		return
	}
	if !userCanAccessFeasibility(c, &feasibility) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	if feasibility.Status == "archived" || feasibility.Status == "cancelled" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "An archived or cancelled feasibility can't be converted"})
		return
	}

	// Check if already converted
	if feasibility.ConvertedProjectID != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "This feasibility has already been converted to a project"})
		return
	}

	// Must have at least one feasible vendor
	hasFeasible := false
	for _, v := range feasibility.Vendors {
		if v.Status == "feasible" {
			hasFeasible = true
			break
		}
	}
	if !hasFeasible {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot convert: no vendor marked as feasible"})
		return
	}

	// The project belongs to the caller's department unless one is named, and
	// the caller owns it unless someone else is — both are what let a
	// department admin see the project they just created (visibility.go).
	department := strings.TrimSpace(input.ProjectDepartment)
	if department == "" {
		deptVal, _ := c.Get("user_department")
		department, _ = deptVal.(string)
	}
	if v := viewerFrom(c); v.isDeptAdmin() && !sameDept(v.Dept, department) {
		c.JSON(http.StatusForbidden, gin.H{"error": "You can only convert into a project in your own department"})
		return
	}
	ownerID := input.OwnerID
	if ownerID == nil {
		me := callerID(c)
		ownerID = &me
	}

	now := time.Now()
	project := models.Project{
		Title:       input.ProjectTitle,
		Description: input.ProjectDescription,
		Department:  department,
		Status:      "planning",
		Priority:    input.ProjectPriority,
		StartDate:   &now,
		ClientID:    feasibility.ClientID,
		OwnerID:     ownerID,
		AdminID:     input.AdminID,
		Progress:    0,
	}

	if project.Priority == "" {
		project.Priority = "normal"
	}

	// Captured BEFORE the transaction: Updates() writes the new status back
	// into the model, so feasibility.Status is "converted" afterwards.
	oldFeasibilityStatus := feasibility.Status

	txErr := database.DB.Transaction(func(tx *gorm.DB) error {
		// The code used to be derived from the feasibility number
		// (FEA-100002 -> PRJ-100002), a number space shared with the
		// auto-generated project codes, so a conversion could collide with an
		// existing project and fail. Use the same max+1 numbering as
		// CreateProject.
		// Permanent ID from the atomic counter (spec slide 7).
		code, idErr := models.NextID(tx, "PRJ")
		if idErr != nil {
			return idErr
		}
		project.Code = code

		if err := tx.Create(&project).Error; err != nil {
			return err
		} // Link the feasibility's client in the project's client list too
		// (slide 9: projects can have several clients).
		if project.ClientID != nil {
			if err := setProjectClients(tx, &project, []uint{*project.ClientID}); err != nil {
				return err
			}
		}

		// Link feasibility to project
		convertedAt := time.Now()
		if err := tx.Model(&feasibility).Updates(map[string]interface{}{
			"converted_project_id": project.ID,
			"converted_at":         convertedAt,
			"status":               "converted",
			"completed_at":         convertedAt,
		}).Error; err != nil {
			return err
		}

		// NOTE: there used to be an audit-log insert here, inside the
		// transaction, with UserID 0 (no such user) and empty jsonb columns.
		// That insert always failed, and a failed statement aborts a Postgres
		// transaction — so the whole conversion was rolled back (or the commit
		// failed) and "Convert to project" could never succeed. The audit entry
		// is written after the commit instead, with the real user.
		return nil
	})

	if txErr != nil {
		serverError(c, "Failed to convert feasibility", txErr)
		return
	}

	utils.LogAuditWithValues(callerID(c), "converted", "feasibility", feasibility.ID,
		statusChange(oldFeasibilityStatus), statusChange("converted"),
		fmt.Sprintf("Converted feasibility %s to project %s (%s)", feasibility.FeasibilityNumber, project.Code, project.Title),
		c.ClientIP(), c.Request.UserAgent())
	utils.LogAudit(callerID(c), "created", "project", project.ID,
		fmt.Sprintf("Created project %s from feasibility %s", project.Code, feasibility.FeasibilityNumber), c.ClientIP(), c.Request.UserAgent())

	// Reload
	database.DB.
		Preload("Client").
		Preload("AssignedUser").
		Preload("CreatedBy").
		Preload("Vendors").
		Preload("Attachments").
		Preload("ConvertedProject").
		First(&feasibility, feasibility.ID)

	c.JSON(http.StatusOK, gin.H{
		"message":     "Feasibility converted to project successfully",
		"feasibility": feasibility,
		"project":     project,
	})
}

// GetFeasibilityProducts returns the list of valid products (for dropdowns)
// — the standard ones, then any other product typed in on a feasibility.
func GetFeasibilityProducts(c *gin.Context) {
	products := []string{"DPLC", "Dark Fiber", "IPT", "IPT Mix", "Pure IPT"}
	var custom []string
	database.DB.Model(&models.Feasibility{}).
		Where("TRIM(product) <> ''").
		Distinct("product").Order("product").Pluck("product", &custom)
	for _, p := range custom {
		known := false
		for _, s := range products {
			if strings.EqualFold(strings.TrimSpace(p), s) {
				known = true
				break
			}
		}
		if !known {
			products = append(products, strings.TrimSpace(p))
		}
	}
	c.JSON(http.StatusOK, gin.H{"products": products})
}

// GetFeasibilityVendorStatuses returns valid vendor statuses
func GetFeasibilityVendorStatuses(c *gin.Context) {
	statuses := []string{"pending", "feasible", "not_feasible", "waiting_response"}
	c.JSON(http.StatusOK, gin.H{"statuses": statuses})
}

// GetFeasibilityStatuses returns valid feasibility statuses
func GetFeasibilityStatuses(c *gin.Context) {
	statuses := []string{"draft", "in_progress", "feasible", "not_feasible", "converted", "cancelled", "archived"}
	c.JSON(http.StatusOK, gin.H{"statuses": statuses})
}

// ReinstateFeasibilityVendor brings a withdrawn vendor back.
func ReinstateFeasibilityVendor(c *gin.Context) {
	var parent models.Feasibility
	if err := database.DB.First(&parent, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Feasibility not found"})
		return
	}
	if !userCanAccessFeasibility(c, &parent) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}
	var vendor models.FeasibilityVendor
	if err := database.DB.Where("id = ? AND feasibility_id = ?", c.Param("vendorId"), parent.ID).First(&vendor).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Vendor not found"})
		return
	}
	if err := database.DB.Model(&vendor).Updates(map[string]interface{}{
		"withdrawn": false, "withdrawn_at": nil, "withdrawn_by_id": nil,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reinstate vendor"})
		return
	}
	utils.LogAudit(callerID(c), "vendor_reinstated", "feasibility", parent.ID,
		fmt.Sprintf("Reinstated vendor %s on %s", vendor.VendorName, parent.FeasibilityNumber), c.ClientIP(), c.Request.UserAgent())
	database.DB.First(&vendor, vendor.ID)
	c.JSON(http.StatusOK, gin.H{"message": "Vendor reinstated", "vendor": vendor})
}
