package handlers

import (
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
)

// SLA & escalation — spec slide 22:
//
//	"SLA breach triggers an automatic escalation chain"
//	Example SLA (fully configurable): Critical 30 min · High 1 h · Normal 4 h
//	Escalation chain: Staff -> Department Head -> Department Admin -> Super Admin
//	"System tracks: start time, SLA deadline, remaining time, acknowledged?,
//	 work started?, breached?"
//	"Critical Ticket TKT-000123 has exceeded SLA."
//
//	GET /api/workflow/sla        everyone (drawers show the targets)
//	PUT /api/workflow/sla/:id    super_admin (slide 5: Super Admin configures SLA)
//
// StartSLAMonitor runs in the background: once a ticket that isn't finished
// passes its SLA deadline it's escalated to the department head; if it's still
// open one escalation step later, to the department admin; one step after
// that, to the super admin. Each step is recorded on the ticket and in its
// timeline as done by the system.

// Seeded once; the Super Admin's edits are never overwritten. Low isn't in the
// spec's example — 24 h is a placeholder.
var defaultSLAPolicies = []models.SLAPolicy{
	{Priority: "critical", ResolutionMinutes: 30, EscalationStepMinutes: 30},
	{Priority: "high", ResolutionMinutes: 60, EscalationStepMinutes: 60},
	{Priority: "normal", ResolutionMinutes: 240, EscalationStepMinutes: 120},
	{Priority: "low", ResolutionMinutes: 1440, EscalationStepMinutes: 480},
}

// EnsureSLAPolicies seeds any missing priority. Called at startup.
func EnsureSLAPolicies() {
	for _, d := range defaultSLAPolicies {
		var n int64
		database.DB.Model(&models.SLAPolicy{}).Where("priority = ?", d.Priority).Count(&n)
		if n == 0 {
			p := d
			if err := database.DB.Create(&p).Error; err != nil {
				log.Printf("sla: seeding %s failed: %v", d.Priority, err)
			}
		}
	}
}

// slaPolicyFor returns the policy for a priority, falling back to the seeded
// defaults if the table can't be read.
func slaPolicyFor(priority string) (models.SLAPolicy, bool) {
	var p models.SLAPolicy
	if err := database.DB.Where("priority = ?", priority).First(&p).Error; err == nil {
		return p, true
	}
	for _, d := range defaultSLAPolicies {
		if d.Priority == priority {
			return d, true
		}
	}
	return models.SLAPolicy{}, false
}

func GetSLAPolicies(c *gin.Context) {
	var rows []models.SLAPolicy
	database.DB.Order("resolution_minutes ASC").Find(&rows)
	c.JSON(http.StatusOK, gin.H{"policies": rows})
}

func UpdateSLAPolicy(c *gin.Context) {
	var p models.SLAPolicy
	if err := database.DB.First(&p, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "SLA policy not found"})
		return
	}
	var input struct {
		ResolutionMinutes     *int `json:"resolution_minutes"`
		EscalationStepMinutes *int `json:"escalation_step_minutes"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	before := p
	updates := map[string]interface{}{}
	const maxMinutes = 60 * 24 * 90 // 90 days
	if input.ResolutionMinutes != nil {
		if *input.ResolutionMinutes < 1 || *input.ResolutionMinutes > maxMinutes {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Resolution time must be between 1 minute and 90 days"})
			return
		}
		updates["resolution_minutes"] = *input.ResolutionMinutes
	}
	if input.EscalationStepMinutes != nil {
		if *input.EscalationStepMinutes < 1 || *input.EscalationStepMinutes > maxMinutes {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Escalation step must be between 1 minute and 90 days"})
			return
		}
		updates["escalation_step_minutes"] = *input.EscalationStepMinutes
	}
	if len(updates) > 0 {
		if err := database.DB.Model(&p).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update SLA policy"})
			return
		}
		database.DB.First(&p, p.ID)
		utils.LogAuditWithValues(viewerFrom(c).ID, "updated", "sla_policy", p.ID, before, p,
			fmt.Sprintf("Updated %s SLA: resolve in %d min, escalate every %d min", p.Priority, p.ResolutionMinutes, p.EscalationStepMinutes),
			c.ClientIP(), c.Request.UserAgent())
	}
	c.JSON(http.StatusOK, gin.H{"policy": p})
}

// ---- escalation monitor ---------------------------------------------------------

// The chain after the assigned staff member (slide 22). Values match the
// manual escalation levels, so both show the same way.
var escalationChain = []struct{ level, label string }{
	{"supervisor", "Department Head"},
	{"admin", "Department Admin"},
	{"super_admin", "Super Admin"},
}

// StartSLAMonitor checks for breached tickets once a minute. Call once at
// startup.
func StartSLAMonitor() {
	go func() {
		// Small delay so startup (migrations, seeding) finishes first.
		time.Sleep(15 * time.Second)
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			runSLAEscalations(time.Now())
			<-ticker.C
		}
	}()
}

func runSLAEscalations(now time.Time) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("sla monitor: recovered from panic: %v", r)
		}
	}()
	var tickets []models.Ticket
	err := database.DB.
		Where("sla_deadline IS NOT NULL AND sla_deadline < ?", now).
		Where("auto_escalation_step < ?", len(escalationChain)).
		Where("status NOT IN ?", statusKeysClosedOrArchived("ticket")).
		Find(&tickets).Error
	if err != nil {
		log.Printf("sla monitor: query failed: %v", err)
		return
	}
	for i := range tickets {
		escalateIfDue(&tickets[i], now)
	}
}

func escalateIfDue(t *models.Ticket, now time.Time) {
	// A resolved ticket isn't escalated even if "resolved" was re-categorised.
	if statusCategory("ticket", t.Status) == "done" || statusCategory("ticket", t.Status) == "cancelled" {
		return
	}
	policy, ok := slaPolicyFor(t.Priority)
	if !ok {
		return
	}
	step := t.AutoEscalationStep
	// Step n is due at deadline + n * step minutes.
	due := t.SLADeadline.Add(time.Duration(step*policy.EscalationStepMinutes) * time.Minute)
	if now.Before(due) {
		return
	}
	next := escalationChain[step]
	prio := t.Priority
	if prio != "" {
		prio = strings.ToUpper(prio[:1]) + prio[1:]
	}
	reason := fmt.Sprintf("%s Ticket %s has exceeded SLA. Escalated to %s.", prio, t.TicketNumber, next.label)
	updates := map[string]interface{}{
		"auto_escalation_step": step + 1,
		"escalation_level":     next.level,
		"escalation_reason":    reason,
		"escalated_at":         now,
		"escalated_by_id":      nil, // the system, not a person
	}
	// Only if still at this step — another instance may have just done it.
	res := database.DB.Model(&models.Ticket{}).
		Where("id = ? AND auto_escalation_step = ?", t.ID, step).
		Updates(updates)
	if res.Error != nil {
		log.Printf("sla monitor: escalating %s failed: %v", t.TicketNumber, res.Error)
		return
	}
	if res.RowsAffected == 0 {
		return
	}
	oldLevel := t.EscalationLevel
	if oldLevel == "" {
		oldLevel = "none"
	}
	utils.LogAuditWithValues(0, "escalated", "ticket", t.ID,
		map[string]interface{}{"escalation_level": oldLevel},
		map[string]interface{}{"escalation_level": next.level, "reason": reason},
		reason, "", "sla-monitor")
	log.Printf("sla monitor: %s", reason)
	// Who hears about it at each step (slide 22's chain): the assignee on the
	// first breach, then the department head, department admin, super admin.
	var to []uint
	switch step {
	case 0:
		if t.AssignedToID != nil {
			to = append(to, *t.AssignedToID)
		}
		to = append(to, supervisorOfUser(t.AssignedToID)...)
		if len(to) == 0 || (t.AssignedToID != nil && len(to) == 1) {
			to = append(to, departmentAdmins(t.Department)...)
		}
	case 1:
		to = departmentAdmins(t.Department)
	default:
		to = superAdmins()
	}
	// A ticket routed to another department still belongs to the department
	// that raised it — they own the customer — so its admins hear about the
	// breach too (they used to hear nothing once the ticket had left).
	if step < 2 && isAwayFromOrigin(t) {
		to = append(to, departmentAdmins(t.OriginDepartment)...)
	}
	kind := "escalation"
	if step == 0 {
		kind = "sla_breach"
	}
	notify(0, notice{kind, "SLA breached: " + t.TicketNumber, reason, "ticket", t.ID}, to...)
}

// ---- tracking on status changes -----------------------------------------------

// applySLATracking stamps "acknowledged" and "work started" the first time a
// ticket reaches them (slide 22: acknowledged? work started?).
func applySLATracking(t *models.Ticket, status string, updates map[string]interface{}, now time.Time) {
	cat := statusCategory("ticket", status)
	if t.AcknowledgedAt == nil && cat != "" && cat != "open" {
		updates["acknowledged_at"] = now
	}
	if t.WorkStartedAt == nil && cat == "active" && status != "acknowledged" {
		updates["work_started_at"] = now
	}
}

// slaMinutesForPriority is the resolution time for a new ticket.
func slaMinutesForPriority(priority string) int {
	if p, ok := slaPolicyFor(priority); ok && p.ResolutionMinutes > 0 {
		return p.ResolutionMinutes
	}
	return 240
}
