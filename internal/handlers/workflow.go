package handlers

import (
	"fmt"
	"log"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
)

// Configurable status catalog — spec slide 21: "Configurable statuses, always
// with a recorded reason. Every status change records: Previous Status ->
// New Status, Changed By, Date/Time, and Comment/Reason where required."
//
//	GET  /api/workflow/statuses        everyone (drives every status dropdown)
//	POST /api/workflow/statuses        super_admin: add a status
//	PUT  /api/workflow/statuses/:id    super_admin: rename / enable / reason / order
//
// Status checks everywhere go through isValidStatus / statusNeedsReason /
// statusCategory, which read an in-memory copy refreshed on every change.

var validStatusCategories = map[string]bool{
	"open": true, "active": true, "waiting": true, "review": true, "done": true, "cancelled": true,
}

type defaultStatus struct {
	key, label, category string
	reason, system       bool
}

// Seeded once per (entity, key); existing rows are never overwritten, so the
// Super Admin's changes survive restarts.
var defaultStatuses = map[string][]defaultStatus{
	"ticket": {
		{"new", "New", "open", false, true},
		{"assigned", "Assigned", "open", false, true},
		{"acknowledged", "Acknowledged", "active", false, false},
		{"in_progress", "In Progress", "active", false, true},
		{"pending", "Pending", "waiting", true, false},
		{"waiting_client", "Waiting for Client", "waiting", true, false},
		{"waiting_vendor", "Waiting for Vendor", "waiting", true, false},
		{"blocked", "Blocked", "waiting", true, false},
		{"resolved", "Resolved", "done", true, true},
		{"closed", "Closed", "done", false, true},
		{"reopened", "Reopened", "active", true, true},
		{"cancelled", "Cancelled", "cancelled", true, false},
	},
	"task": {
		{"todo", "To Do", "open", false, true},
		{"acknowledged", "Acknowledged", "active", false, false},
		{"in_progress", "In Progress", "active", false, true},
		{"pending", "Pending", "waiting", true, false},
		{"waiting_client", "Waiting for Client", "waiting", true, false},
		{"waiting_vendor", "Waiting for Vendor", "waiting", true, false},
		{"blocked", "Blocked", "waiting", true, false},
		{"in_review", "In Review", "review", false, true},
		{"done", "Done", "done", false, true},
		{"cancelled", "Cancelled", "cancelled", true, false},
	},
}

// EnsureWorkflowStatuses seeds any missing default statuses. Called at startup.
func EnsureWorkflowStatuses() {
	for entity, list := range defaultStatuses {
		for i, d := range list {
			var n int64
			database.DB.Model(&models.WorkflowStatus{}).Where("entity = ? AND key = ?", entity, d.key).Count(&n)
			if n > 0 {
				continue
			}
			row := models.WorkflowStatus{
				Entity: entity, Key: d.key, Label: d.label, Category: d.category,
				ReasonRequired: d.reason, Enabled: true, SortOrder: (i + 1) * 10, System: d.system,
			}
			if err := database.DB.Create(&row).Error; err != nil {
				log.Printf("workflow statuses: seeding %s/%s failed: %v", entity, d.key, err)
			}
		}
	}
	reloadStatusCache()
}

// ---- in-memory copy -------------------------------------------------------------

var (
	statusMu    sync.RWMutex
	statusCache = map[string]map[string]models.WorkflowStatus{} // entity -> key -> row
)

func reloadStatusCache() {
	var rows []models.WorkflowStatus
	if err := database.DB.Find(&rows).Error; err != nil {
		log.Printf("workflow statuses: reload failed: %v", err)
		return
	}
	next := map[string]map[string]models.WorkflowStatus{}
	for _, r := range rows {
		if next[r.Entity] == nil {
			next[r.Entity] = map[string]models.WorkflowStatus{}
		}
		next[r.Entity][r.Key] = r
	}
	statusMu.Lock()
	statusCache = next
	statusMu.Unlock()
}

func statusDef(entity, key string) (models.WorkflowStatus, bool) {
	statusMu.RLock()
	defer statusMu.RUnlock()
	r, ok := statusCache[entity][key]
	return r, ok
}

// isValidStatus: the status exists in the catalog and is enabled.
// ("archived" is never valid here — only the archive action sets it.)
func isValidStatus(entity, key string) bool {
	r, ok := statusDef(entity, key)
	return ok && r.Enabled
}

func statusNeedsReason(entity, key string) bool {
	r, ok := statusDef(entity, key)
	return ok && r.ReasonRequired
}

func statusCategory(entity, key string) string {
	if r, ok := statusDef(entity, key); ok {
		return r.Category
	}
	return ""
}

func statusLabel(entity, key string) string {
	if r, ok := statusDef(entity, key); ok && r.Label != "" {
		return r.Label
	}
	return key
}

// statusReasonError returns a message when a reason is required but missing.
func statusReasonError(entity, key, reason string) string {
	if statusNeedsReason(entity, key) && strings.TrimSpace(reason) == "" {
		return fmt.Sprintf("A reason is required to set the status to %q", statusLabel(entity, key))
	}
	return ""
}

// statusChangeWithReason is statusChange plus the reason, for audit values.
func statusChangeWithReason(status, reason string) map[string]string {
	m := statusChange(status)
	if strings.TrimSpace(reason) != "" {
		m["reason"] = strings.TrimSpace(reason)
	}
	return m
}

// ---- endpoints ------------------------------------------------------------------

func GetWorkflowStatuses(c *gin.Context) {
	var rows []models.WorkflowStatus
	q := database.DB.Order("entity ASC, sort_order ASC, id ASC")
	if e := c.Query("entity"); e != "" {
		q = q.Where("entity = ?", e)
	}
	if err := q.Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load statuses"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"statuses": rows})
}

var statusKeyUnsafe = regexp.MustCompile(`[^a-z0-9]+`)

func CreateWorkflowStatus(c *gin.Context) {
	var input struct {
		Entity         string `json:"entity" binding:"required"`
		Label          string `json:"label" binding:"required"`
		Category       string `json:"category" binding:"required"`
		ReasonRequired bool   `json:"reason_required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "entity, label and category are required"})
		return
	}
	if input.Entity != "ticket" && input.Entity != "task" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "entity must be ticket or task"})
		return
	}
	if !validStatusCategories[input.Category] || input.Category == "review" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid category"})
		return
	}
	label := strings.TrimSpace(input.Label)
	key := strings.Trim(statusKeyUnsafe.ReplaceAllString(strings.ToLower(label), "_"), "_")
	if key == "" || len(key) > 50 || len(label) > 80 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid label"})
		return
	}
	if key == "archived" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "\"archived\" is reserved"})
		return
	}
	if _, exists := statusDef(input.Entity, key); exists {
		c.JSON(http.StatusConflict, gin.H{"error": "A status with that name already exists"})
		return
	}

	var maxOrder int
	database.DB.Model(&models.WorkflowStatus{}).Where("entity = ?", input.Entity).
		Select("COALESCE(MAX(sort_order), 0)").Scan(&maxOrder)
	row := models.WorkflowStatus{
		Entity: input.Entity, Key: key, Label: label, Category: input.Category,
		ReasonRequired: input.ReasonRequired, Enabled: true, SortOrder: maxOrder + 10,
	}
	if err := database.DB.Create(&row).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create status"})
		return
	}
	reloadStatusCache()
	utils.LogAuditWithValues(viewerFrom(c).ID, "created", "workflow_status", row.ID,
		map[string]interface{}{}, row,
		fmt.Sprintf("Added %s status %q (%s)", row.Entity, row.Label, row.Category),
		c.ClientIP(), c.Request.UserAgent())
	c.JSON(http.StatusCreated, gin.H{"status": row})
}

func UpdateWorkflowStatus(c *gin.Context) {
	var row models.WorkflowStatus
	if err := database.DB.First(&row, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Status not found"})
		return
	}
	var input struct {
		Label          *string `json:"label"`
		Category       *string `json:"category"`
		ReasonRequired *bool   `json:"reason_required"`
		Enabled        *bool   `json:"enabled"`
		SortOrder      *int    `json:"sort_order"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	before := row
	updates := map[string]interface{}{}
	if input.Label != nil {
		l := strings.TrimSpace(*input.Label)
		if l == "" || len(l) > 80 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid label"})
			return
		}
		updates["label"] = l
	}
	if input.Category != nil && *input.Category != row.Category {
		if row.System {
			c.JSON(http.StatusBadRequest, gin.H{"error": "The category of a built-in status can't be changed"})
			return
		}
		if !validStatusCategories[*input.Category] || *input.Category == "review" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid category"})
			return
		}
		updates["category"] = *input.Category
	}
	if input.ReasonRequired != nil {
		updates["reason_required"] = *input.ReasonRequired
	}
	if input.Enabled != nil && *input.Enabled != row.Enabled {
		if row.System && !*input.Enabled {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Built-in statuses the workflow relies on can't be disabled"})
			return
		}
		updates["enabled"] = *input.Enabled
	}
	if input.SortOrder != nil {
		updates["sort_order"] = *input.SortOrder
	}
	if len(updates) == 0 {
		c.JSON(http.StatusOK, gin.H{"status": row})
		return
	}
	if err := database.DB.Model(&row).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update status"})
		return
	}
	database.DB.First(&row, row.ID)
	reloadStatusCache()
	utils.LogAuditWithValues(viewerFrom(c).ID, "updated", "workflow_status", row.ID, before, row,
		fmt.Sprintf("Updated %s status %q", row.Entity, row.Label),
		c.ClientIP(), c.Request.UserAgent())
	c.JSON(http.StatusOK, gin.H{"status": row})
}

// sortedStatusKeys is used in error messages.
func sortedStatusKeys(entity string) []string {
	statusMu.RLock()
	defer statusMu.RUnlock()
	keys := make([]string, 0, len(statusCache[entity]))
	for k, r := range statusCache[entity] {
		if r.Enabled {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	return keys
}

// statusChangeDetails is the audit text for a status change, with labels and
// the reason: `Status: In Progress -> Waiting for Client (reason: ...)`.
func statusChangeDetails(entity, from, to, reason string) string {
	d := fmt.Sprintf("Status: %s -> %s", statusLabel(entity, from), statusLabel(entity, to))
	if r := strings.TrimSpace(reason); r != "" {
		d += " (reason: " + r + ")"
	}
	return d
}

// statusKeysIn lists every status key (enabled or not — existing records may
// still carry a disabled one) whose category is one of cats. Used for counts
// and filters, so reports follow the catalog instead of fixed lists.
func statusKeysIn(entity string, cats ...string) []string {
	want := map[string]bool{}
	for _, c := range cats {
		want[c] = true
	}
	statusMu.RLock()
	defer statusMu.RUnlock()
	var keys []string
	for k, r := range statusCache[entity] {
		if want[r.Category] {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	if len(keys) == 0 {
		keys = []string{"__none__"} // keep "IN ?" valid SQL
	}
	return keys
}

// statusKeysClosedOrArchived: finished, cancelled, or archived.
func statusKeysClosedOrArchived(entity string) []string {
	return append(statusKeysIn(entity, "done", "cancelled"), "archived")
}
