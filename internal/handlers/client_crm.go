package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/middleware"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Client CRM foundation (step 1): the pieces client products & services and
// the IP Plan / Transmission Plan sheets are built on.
//
// Permissions (Settings → permission matrix; the Super Admin always has all):
//
//	manage_client_services  add / edit / close a client's products & services
//	view_network_plans      see a client's IP Plan and Transmission Plan
//	edit_network_plans      add / change / remove plan rows
//	view_plan_passwords     reveal Transmission Plan passwords
//
// Everything also needs FULL access to the client (client_access.go): the
// same rule as the Client 360 view.
//
// Ticket rule: every plan change names a ticket of THAT client — open or
// closed, but not archived (resolveClientTicket). The server refuses a plan
// change without one.
//
// History: every change is written to client_record_changes (one row per
// changed field), never edited or deleted (writeClientChanges).
//
//	GET /api/clients/:id/ticket-options?q=   tickets of the client, for the ticket picker
//	GET /api/clients/:id/ticket-check?ref=   is this a valid ticket for the client?
//	GET /api/clients/:id/changes             change history (filters: record_type, record_id, before_id, limit)
//	GET /api/clients/:id/crm-access          what the caller may do here (for the UI)

// Record types in client_record_changes.
const (
	crmRecordService          = "service"
	crmRecordIPPlan           = "ip_plan"
	crmRecordTransmissionPlan = "transmission_plan"
	crmRecordBGPPlan          = "bgp_plan"
	crmRecordClientTxPlan     = "client_transmission_plan"
)

var crmRecordTypes = map[string]bool{
	crmRecordService:          true,
	crmRecordIPPlan:           true,
	crmRecordTransmissionPlan: true,
	crmRecordBGPPlan:          true,
	crmRecordClientTxPlan:     true,
}

// Shown in the history instead of a secret's value.
const maskedSecret = "••••••"

// ---- permissions -----------------------------------------------------------

func crmCan(c *gin.Context, permission string) bool {
	return middleware.HasPermission(viewerFrom(c).Role, permission) // super_admin: always true
}

func canManageClientServices(c *gin.Context) bool { return crmCan(c, "manage_client_services") }
func canViewNetworkPlans(c *gin.Context) bool     { return crmCan(c, "view_network_plans") }
func canEditNetworkPlans(c *gin.Context) bool {
	// Editing a plan you can't see makes no sense: both are required.
	return crmCan(c, "edit_network_plans") && canViewNetworkPlans(c)
}
func canViewPlanPasswords(c *gin.Context) bool {
	return crmCan(c, "view_plan_passwords") && canViewNetworkPlans(c)
}

// loadCRMClient loads the client named by the :id route parameter and checks
// the caller has full access to it. On failure it has already answered.
func loadCRMClient(c *gin.Context) (*models.Client, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid client id"})
		return nil, false
	}
	var client models.Client
	if err := database.DB.First(&client, uint(id)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Client not found"})
		return nil, false
	}
	if clientAccessFor(c, &client) != "full" {
		c.JSON(http.StatusForbidden, gin.H{"error": "You need full access to this client"})
		return nil, false
	}
	return &client, true
}

// ---- ticket rule -------------------------------------------------------------

// resolveClientTicket finds the ticket a change refers to. ref is a ticket
// number ("TKT-100231", any case) or a numeric ticket id. It must belong to
// the client and must not be archived; open and closed tickets both count.
// Returns the ticket, or a message for the user.
func resolveClientTicket(clientID uint, ref string) (*models.Ticket, string) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil, "A ticket is required for this change"
	}
	if len(ref) > 60 {
		return nil, "That ticket ID is not valid"
	}
	var t models.Ticket
	q := database.DB.Select("id", "ticket_number", "title", "status", "client_id")
	if n, err := strconv.ParseUint(ref, 10, 64); err == nil {
		q = q.Where("id = ? OR UPPER(ticket_number) = ?", n, strings.ToUpper(ref))
	} else {
		q = q.Where("UPPER(ticket_number) = ?", strings.ToUpper(ref))
	}
	if err := q.First(&t).Error; err != nil {
		return nil, "Ticket " + ref + " was not found"
	}
	if t.ClientID == nil || *t.ClientID != clientID {
		return nil, "Ticket " + t.TicketNumber + " belongs to a different client"
	}
	if t.Status == "archived" {
		return nil, "Ticket " + t.TicketNumber + " is archived and can't authorize changes"
	}
	return &t, ""
}

type clientTicketOption struct {
	ID           uint   `json:"id"`
	TicketNumber string `json:"ticket_number"`
	Title        string `json:"title"`
	Status       string `json:"status"`
}

// GetClientTicketOptions lists the client's tickets for the ticket picker
// (newest first, open ones first). Only tickets the caller can see are
// listed; any valid ticket number can still be typed in.
func GetClientTicketOptions(c *gin.Context) {
	client, ok := loadCRMClient(c)
	if !ok {
		return
	}
	q := database.DB.Model(&models.Ticket{}).
		Select("tickets.id, tickets.ticket_number, tickets.title, tickets.status").
		Where("tickets.client_id = ? AND tickets.status <> ?", client.ID, "archived")
	if s := strings.TrimSpace(c.Query("q")); s != "" {
		if r := []rune(s); len(r) > 100 {
			s = string(r[:100])
		}
		like := "%" + strings.ToLower(s) + "%"
		q = q.Where("(LOWER(tickets.ticket_number) LIKE ? OR LOWER(tickets.title) LIKE ?)", like, like)
	}
	q = applyTicketScope(q, viewerFrom(c))
	var out []clientTicketOption
	if err := q.Order("CASE WHEN tickets.status IN ('resolved', 'closed', 'cancelled') THEN 1 ELSE 0 END, tickets.created_at DESC").
		Limit(30).Scan(&out).Error; err != nil {
		serverError(c, "Failed to load the client's tickets", err)
		return
	}
	if out == nil {
		out = []clientTicketOption{}
	}
	c.JSON(http.StatusOK, gin.H{"tickets": out})
}

// CheckClientTicket validates a typed ticket reference, so the plan sheets
// can tell the user before they save.
func CheckClientTicket(c *gin.Context) {
	client, ok := loadCRMClient(c)
	if !ok {
		return
	}
	t, msg := resolveClientTicket(client.ID, c.Query("ref"))
	if msg != "" {
		c.JSON(http.StatusOK, gin.H{"valid": false, "error": msg})
		return
	}
	c.JSON(http.StatusOK, gin.H{"valid": true, "ticket": clientTicketOption{
		ID: t.ID, TicketNumber: t.TicketNumber, Title: t.Title, Status: t.Status,
	}})
}

// ---- change history ------------------------------------------------------------

// fieldChange is one changed field. Values are already formatted for display.
type fieldChange struct {
	Field string
	Old   string
	New   string
}

// diffFields compares two field → value maps (same keys) in the given order
// and returns what changed. Secret fields come back masked.
func diffFields(order []string, before, after map[string]string, secret map[string]bool) []fieldChange {
	var out []fieldChange
	for _, f := range order {
		o, n := before[f], after[f]
		if o == n {
			continue
		}
		if secret[f] {
			o, n = maskIfSet(o), maskIfSet(n)
			if o == n { // e.g. one password replaced by another
				o, n = maskedSecret, maskedSecret+" (changed)"
			}
		}
		out = append(out, fieldChange{Field: f, Old: o, New: n})
	}
	return out
}

func maskIfSet(v string) string {
	if v == "" {
		return ""
	}
	return maskedSecret
}

// crmActor is who made a change, captured once per request.
type crmActor struct {
	ID   uint
	Name string
}

func crmActorFrom(c *gin.Context) crmActor {
	v := viewerFrom(c)
	a := crmActor{ID: v.ID}
	var u models.User
	if err := database.DB.Unscoped().Select("id", "name").First(&u, v.ID).Error; err == nil {
		a.Name = u.Name
	}
	return a
}

// writeClientChanges stores history rows inside the caller's transaction, so
// a change and its history are saved together or not at all. For "created",
// "removed" and "restored" pass one fieldChange with an empty Field (its
// New / Old can carry a one-line summary of the row).
func writeClientChanges(tx *gorm.DB, clientID uint, recordType string, recordID uint, action string,
	changes []fieldChange, ticket *models.Ticket, actor crmActor) error {
	if len(changes) == 0 {
		return nil
	}
	rows := make([]models.ClientRecordChange, 0, len(changes))
	for _, ch := range changes {
		row := models.ClientRecordChange{
			ClientID:      clientID,
			RecordType:    recordType,
			RecordID:      recordID,
			Action:        action,
			Field:         ch.Field,
			OldValue:      ch.Old,
			NewValue:      ch.New,
			ChangedByID:   actor.ID,
			ChangedByName: actor.Name,
		}
		if ticket != nil {
			id := ticket.ID
			row.TicketID = &id
			row.TicketNumber = ticket.TicketNumber
		}
		rows = append(rows, row)
	}
	return tx.Create(&rows).Error
}

// GetClientChanges returns the client's change history, newest first.
// Filters: record_type (service | ip_plan | bgp_plan | transmission_plan), record_id,
// before_id (paging: ids lower than this), limit (default 100, max 500).
// Plan history needs view_network_plans; without it only service changes
// are returned.
func GetClientChanges(c *gin.Context) {
	client, ok := loadCRMClient(c)
	if !ok {
		return
	}
	q := database.DB.Model(&models.ClientRecordChange{}).Where("client_id = ?", client.ID)

	if rt := c.Query("record_type"); rt != "" {
		if !crmRecordTypes[rt] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Unknown record type"})
			return
		}
		if rt != crmRecordService && !canViewNetworkPlans(c) {
			c.JSON(http.StatusForbidden, gin.H{"error": "You don't have access to this client's network plans"})
			return
		}
		q = q.Where("record_type = ?", rt)
	} else if !canViewNetworkPlans(c) {
		q = q.Where("record_type = ?", crmRecordService)
	}
	if rid := c.Query("record_id"); rid != "" {
		n, err := strconv.ParseUint(rid, 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid record id"})
			return
		}
		q = q.Where("record_id = ?", n)
	}
	if b := c.Query("before_id"); b != "" {
		n, err := strconv.ParseUint(b, 10, 64)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid before_id"})
			return
		}
		q = q.Where("id < ?", n)
	}
	limit := 100
	if l, err := strconv.Atoi(c.Query("limit")); err == nil && l > 0 {
		limit = l
		if limit > 500 {
			limit = 500
		}
	}

	var rows []models.ClientRecordChange
	if err := q.Order("id DESC").Limit(limit + 1).Find(&rows).Error; err != nil {
		serverError(c, "Failed to load the change history", err)
		return
	}
	more := len(rows) > limit
	if more {
		rows = rows[:limit]
	}
	if rows == nil {
		rows = []models.ClientRecordChange{}
	}
	c.JSON(http.StatusOK, gin.H{"changes": rows, "has_more": more})
}

// secretsConfigured: the server can store / show plan passwords
// (PLAN_SECRET_KEY, see utils/secretbox.go).
func secretsConfigured() bool { return utils.SecretsAvailable() }

// GetClientCRMAccess tells the frontend what the caller may do on this
// client's CRM sections (the buttons it shows; the server checks again).
func GetClientCRMAccess(c *gin.Context) {
	if _, ok := loadCRMClient(c); !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"manage_services":      canManageClientServices(c),
		"view_plans":           canViewNetworkPlans(c),
		"edit_plans":           canEditNetworkPlans(c),
		"view_passwords":       canViewPlanPasswords(c),
		"password_storage_set": canViewNetworkPlans(c) && secretsConfigured(),
	})
}
