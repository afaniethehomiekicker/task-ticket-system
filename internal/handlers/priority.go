package handlers

import (
	"log"
	"strings"

	"task-ticket-backend/internal/database"
)

// Work priorities for tasks and sub-tasks: low, normal, high, critical — the
// same four tickets use (see validTicketPriority). "Urgent" was offered on
// tasks only and overlapped with Critical; it has been removed.

var workPriorities = map[string]bool{"low": true, "normal": true, "high": true, "critical": true}

// normalizeWorkPriority cleans a submitted task / sub-task priority. Empty
// means "normal". A browser still open on the old screens may send "urgent":
// that becomes "critical". ok=false for anything else.
func normalizeWorkPriority(p string) (string, bool) {
	p = strings.ToLower(strings.TrimSpace(p))
	switch p {
	case "":
		return "normal", true
	case "urgent":
		return "critical", true
	}
	return p, workPriorities[p]
}

const invalidWorkPriorityMsg = "Invalid priority (use low, normal, high or critical)"

// MigrateUrgentPriority turns every existing "urgent" task, sub-task and
// ticket into "critical". Idempotent; called at startup.
func MigrateUrgentPriority() {
	for _, table := range []string{"tasks", "sub_tasks", "tickets"} {
		if err := database.DB.Exec("UPDATE " + table + " SET priority = 'critical' WHERE priority = 'urgent'").Error; err != nil {
			log.Printf("priority migration (%s): %v", table, err)
		}
	}
}
