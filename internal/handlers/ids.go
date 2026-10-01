package handlers

import (
	"fmt"
	"log"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"
)

// EnsureIDCounters prepares the permanent-ID counters (spec slide 7).
// Called at startup, idempotent:
//
//  1. Each counter starts at the highest number already used for its prefix
//     (archived / soft-deleted rows included), so no existing ID is ever
//     reused and existing IDs never change — new records simply continue
//     after them. On a fresh database everything starts at 000001.
//  2. Users, departments and sub-tasks created before these IDs existed get
//     theirs now, in creation order.
//  3. Unique indexes guard every ID column (non-empty values only).
func EnsureIDCounters() {
	type source struct{ prefix, table, column string }
	sources := []source{
		{"CL", "clients", "client_number"},
		{"PRJ", "projects", "code"},
		{"TKT", "tickets", "ticket_number"},
		{"TSK", "tasks", "task_number"},
		{"FEA", "feasibilities", "feasibility_number"},
		{"STK", "sub_tasks", "subtask_number"},
		{"USR", "users", "user_number"},
		{"DEP", "departments", "dept_number"},
		{"VEN", "vendors", "vendor_number"},
	}
	for _, s := range sources {
		pattern := "^" + s.prefix + "-[0-9]+$"
		var maxNum int64
		// The start position is built into the SQL (Postgres won't take it as
		// a bind parameter); it comes from the fixed prefix, never user input.
		q := fmt.Sprintf(`SELECT COALESCE(MAX(CAST(SUBSTRING(%s FROM %d) AS BIGINT)), 0) FROM %s WHERE %s ~ ?`,
			s.column, len(s.prefix)+2, s.table, s.column)
		if err := database.DB.Raw(q, pattern).Scan(&maxNum).Error; err != nil {
			log.Printf("ids: reading highest %s number failed: %v", s.prefix, err)
			continue
		}
		// Raise the counter to the existing maximum (never lower it).
		if err := database.DB.Exec(`INSERT INTO id_counters (prefix, last) VALUES (?, ?)
			ON CONFLICT (prefix) DO UPDATE SET last = GREATEST(id_counters.last, EXCLUDED.last)`,
			s.prefix, maxNum).Error; err != nil {
			log.Printf("ids: seeding %s counter failed: %v", s.prefix, err)
		}
	}

	backfill := func(prefix, table, column string) {
		var ids []uint
		database.DB.Table(table).Where(column+" IS NULL OR "+column+" = ''").Order("id ASC").Pluck("id", &ids)
		for _, id := range ids {
			num, err := models.NextID(database.DB, prefix)
			if err != nil {
				log.Printf("ids: %s for %s #%d failed: %v", prefix, table, id, err)
				return
			}
			database.DB.Table(table).Where("id = ?", id).Update(column, num)
		}
		if len(ids) > 0 {
			log.Printf("ids: gave %d existing %s their %s- IDs", len(ids), table, prefix)
		}
	}
	backfill("USR", "users", "user_number")
	backfill("DEP", "departments", "dept_number")
	backfill("STK", "sub_tasks", "subtask_number")
	backfill("VEN", "vendors", "vendor_number")

	for _, s := range sources {
		idx := "uniq_" + s.table + "_" + s.column
		if err := database.DB.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS ` + idx + ` ON ` + s.table +
			` (` + s.column + `) WHERE ` + s.column + ` <> ''`).Error; err != nil {
			log.Printf("ids: unique index on %s.%s failed: %v", s.table, s.column, err)
		}
	}
}

// BackfillAssignedByAndBudget fills fields added later on existing records
// (idempotent): "assigned by" defaults to the record's creator where it
// already has an assignee, and a project's entered budget defaults to its
// hours.
func BackfillAssignedByAndBudget() {
	database.DB.Exec(`UPDATE tasks SET assigned_by_id = creator_id
		WHERE assigned_by_id IS NULL AND assignee_id IS NOT NULL AND creator_id IS NOT NULL`)
	database.DB.Exec(`UPDATE tickets SET assigned_by_id = created_by_id
		WHERE assigned_by_id IS NULL AND assigned_to_id IS NOT NULL AND created_by_id IS NOT NULL`)
	database.DB.Exec(`UPDATE projects SET budget_value = budget_hours, budget_unit = 'hours'
		WHERE (budget_value IS NULL OR budget_value = 0) AND budget_hours > 0`)
	database.DB.Exec(`UPDATE projects SET budget_unit = 'hours' WHERE budget_unit IS NULL OR budget_unit = ''`)
}
