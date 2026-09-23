package handlers

import (
	"fmt"
	"net/http"
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

	AssignedDept   string `json:"assigned_dept"`
	AssignedUserID *uint  `json:"assigned_user_id"`

	Priority   string `json:"priority"`
	Status     string `json:"status"`
	Notes      string `json:"notes"`
	TargetDate string `json:"target_date"`

	Vendors []CreateFeasibilityVendorInput `json:"vendors"`
}

type CreateFeasibilityVendorInput struct {
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

	AssignedDept   string `json:"assigned_dept"`
	AssignedUserID *uint  `json:"assigned_user_id"`

	Priority   string `json:"priority"`
	Status     string `json:"status"`
	Notes      string `json:"notes"`
	TargetDate string `json:"target_date"`
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
	searchQuery := strings.TrimSpace(c.Query("search"))
	statusFilter := c.Query("status")
	productFilter := c.Query("product")
	cityFilter := c.Query("city")

	query := database.DB.
		Preload("Client").
		Preload("AssignedUser").
		Preload("Vendors").
		Preload("Attachments").
		Preload("ConvertedProject")

	if searchQuery != "" {
		likeQuery := "%" + strings.ToLower(searchQuery) + "%"
		query = query.Where(
			"LOWER(feasibility_number) LIKE ? OR LOWER(product) LIKE ? OR LOWER(city) LIKE ? OR LOWER(requirement_details) LIKE ?",
			likeQuery, likeQuery, likeQuery, likeQuery,
		)
	}
	if statusFilter != "" {
		query = query.Where("status = ?", statusFilter)
	} else {
		// See the matching comment in projects.go's GetProjects.
		query = query.Where("status != ?", "archived")
	}
	if productFilter != "" {
		query = query.Where("product = ?", productFilter)
	}
	if cityFilter != "" {
		query = query.Where("city = ?", cityFilter)
	}

	var feasibilities []models.Feasibility
	if result := query.Order("created_at desc").Find(&feasibilities); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch feasibilities: " + result.Error.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"feasibilities": feasibilities})
}

// GetFeasibility fetches a single feasibility by ID
func GetFeasibility(c *gin.Context) {
	idParam := c.Param("id")

	var feasibility models.Feasibility
	if err := database.DB.
		Preload("Client").
		Preload("AssignedUser").
		Preload("Vendors").
		Preload("Attachments").
		Preload("ConvertedProject").
		First(&feasibility, idParam).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Feasibility not found"})
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

	// Auto-generate FeasibilityNumber if not provided
	feasNum := input.FeasibilityNumber
	if feasNum == "" {
		var maxNum int
		database.DB.Unscoped().Model(&models.Feasibility{}).
			Where("feasibility_number ~ '^FEA-[0-9]+$'").
			Select("COALESCE(MAX(CAST(SUBSTRING(feasibility_number FROM 5) AS INTEGER)), 100000)").
			Scan(&maxNum)
		feasNum = fmt.Sprintf("FEA-%06d", maxNum+1)
	}

	feasibility := models.Feasibility{
		FeasibilityNumber:  feasNum,
		ClientID:           &input.ClientID,
		Product:            input.Product,
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

	if feasibility.Priority == "" {
		feasibility.Priority = "normal"
	}
	if feasibility.Status == "" {
		feasibility.Status = "draft"
	}

	// Create feasibility first
	if result := database.DB.Omit("Client", "AssignedUser", "Vendors", "Attachments", "ConvertedProject").Create(&feasibility); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create feasibility: " + result.Error.Error()})
		return
	}

	// Create vendors if provided
	for _, v := range input.Vendors {
		vendor := models.FeasibilityVendor{
			FeasibilityID: feasibility.ID,
			VendorName:    v.VendorName,
			ContactPerson: v.ContactPerson,
			ContactEmail:  v.ContactEmail,
			ContactPhone:  v.ContactPhone,
			QuotationRef:  v.QuotationRef,
			Status:        "pending",
		}
		database.DB.Create(&vendor)
	}

	auditFeasibility(c, "created", feasibility.ID,
		fmt.Sprintf("Created feasibility %s (%s) for client %s", feasibility.FeasibilityNumber, feasibility.Product, client.CompanyName))

	// Reload with relations
	database.DB.
		Preload("Client").
		Preload("AssignedUser").
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

	updates := map[string]interface{}{}
	if input.FeasibilityNumber != "" {
		updates["feasibility_number"] = input.FeasibilityNumber
	}
	if input.ClientID != nil {
		updates["client_id"] = *input.ClientID
	}
	if input.Product != "" {
		updates["product"] = input.Product
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
	if input.AssignedDept != "" {
		updates["assigned_dept"] = input.AssignedDept
	}
	if input.AssignedUserID != nil {
		updates["assigned_user_id"] = *input.AssignedUserID
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
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update feasibility: " + err.Error()})
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

	now := time.Now()
	if err := database.DB.Model(&feasibility).Updates(map[string]interface{}{
		"status":         "archived",
		"archived_at":    now,
		"archived_by_id": callerID(c),
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

	vendor := models.FeasibilityVendor{
		FeasibilityID: feasibility.ID,
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

	if result := database.DB.Create(&vendor); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add vendor: " + result.Error.Error()})
		return
	}
	auditFeasibility(c, "vendor_added", feasibility.ID, fmt.Sprintf("Added vendor %s to %s", vendor.VendorName, feasibility.FeasibilityNumber))

	database.DB.Preload("Vendors").First(&feasibility, feasibility.ID)
	c.JSON(http.StatusCreated, gin.H{"message": "Vendor added successfully", "feasibility": feasibility})
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

	var vendor models.FeasibilityVendor
	if err := database.DB.Where("id = ? AND feasibility_id = ?", vendorIdParam, idParam).First(&vendor).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Vendor not found"})
		return
	}

	updates := map[string]interface{}{}
	if input.VendorName != "" {
		updates["vendor_name"] = input.VendorName
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
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update vendor: " + err.Error()})
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

	var vendor models.FeasibilityVendor
	if err := database.DB.Where("id = ? AND feasibility_id = ?", vendorIdParam, idParam).First(&vendor).Error; err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Vendor already deleted"})
		return
	}

	if err := database.DB.Delete(&vendor).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete vendor"})
		return
	}
	auditFeasibility(c, "vendor_removed", vendor.FeasibilityID, fmt.Sprintf("Removed vendor %s", vendor.VendorName))
	c.JSON(http.StatusOK, gin.H{"message": "Vendor deleted successfully"})
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
		var maxNum int
		tx.Unscoped().Model(&models.Project{}).
			Where("code ~ '^PRJ-[0-9]+$'").
			Select("COALESCE(MAX(CAST(SUBSTRING(code FROM 5) AS INTEGER)), 0)").
			Scan(&maxNum)
		project.Code = fmt.Sprintf("PRJ-%06d", maxNum+1)

		if err := tx.Create(&project).Error; err != nil {
			return err
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to convert feasibility: " + txErr.Error()})
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
func GetFeasibilityProducts(c *gin.Context) {
	products := []string{"DPLC", "Dark Fiber", "IPT", "IPT Mix", "Pure IPT"}
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
