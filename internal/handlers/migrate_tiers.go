package handlers

import (
	"fmt"
	"log"
	"regexp"
	"strings"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"gorm.io/gorm"
)

// MigrateLevelDepartmentsToTiers turns "Level1".."Level4" departments into
// CNOC support tiers (L1..L4). Called once at startup; idempotent — when no
// Level department is left it does nothing.
//
// Why: the spec treats L1/L2/L3 as support tiers INSIDE CNOC / Support (a
// ticket is escalated L1 -> L2 within the department), not as separate
// departments. As separate departments, an L1 agent could only see L1
// colleagues, and escalating meant moving the ticket to another department.
//
// For every department whose name is "Level<N>" / "Level <N>" / "L<N>"
// (N = 1..4, any case), in one transaction:
//   - users in it      -> department = CNOC, support_tier = L<N>
//   - projects, tasks, tickets in it -> department = CNOC
//   - feasibilities assigned to it   -> assigned_dept = CNOC
//   - the Level department itself is deleted
//
// CNOC is the existing department whose name starts with "CNOC" (any case);
// if there isn't one, "CNOC" is created. Each moved user gets an audit entry.
func MigrateLevelDepartmentsToTiers() {
	levelName := regexp.MustCompile(`(?i)^\s*l(?:evel)?\s*([1-4])\s*$`)

	var depts []models.Department
	if err := database.DB.Find(&depts).Error; err != nil {
		log.Printf("tier migration: could not read departments: %v", err)
		return
	}

	type levelDept struct {
		dept models.Department
		tier string
	}
	type movedUser struct {
		id        uint
		from, tier string
	}
	var moved []movedUser
	var levels []levelDept
	var cnoc *models.Department
	for i := range depts {
		if m := levelName.FindStringSubmatch(depts[i].Name); m != nil {
			levels = append(levels, levelDept{depts[i], "L" + m[1]})
			continue
		}
		if cnoc == nil && isSupportDepartment(depts[i].Name) {
			cnoc = &depts[i]
		}
	}
	if len(levels) == 0 {
		return
	}

	err := database.DB.Transaction(func(tx *gorm.DB) error {
		if cnoc == nil {
			created := models.Department{Name: "CNOC", Description: "Customer Network Operations Center (support, tiers L1-L4)"}
			if err := tx.Create(&created).Error; err != nil {
				return fmt.Errorf("create CNOC department: %w", err)
			}
			cnoc = &created
		}
		target := cnoc.Name

		for _, l := range levels {
			name := l.dept.Name

			var movedUsers []models.User
			if err := tx.Select("id").Where("LOWER(department) = LOWER(?)", name).Find(&movedUsers).Error; err != nil {
				return err
			}
			if err := tx.Model(&models.User{}).Where("LOWER(department) = LOWER(?)", name).
				Updates(map[string]interface{}{"department": target, "support_tier": l.tier}).Error; err != nil {
				return fmt.Errorf("move users from %s: %w", name, err)
			}
			for _, table := range []interface{}{&models.Project{}, &models.Task{}, &models.Ticket{}} {
				if err := tx.Model(table).Where("LOWER(department) = LOWER(?)", name).Update("department", target).Error; err != nil {
					return fmt.Errorf("move records from %s: %w", name, err)
				}
			}
			if err := tx.Model(&models.Feasibility{}).Where("LOWER(assigned_dept) = LOWER(?)", name).Update("assigned_dept", target).Error; err != nil {
				return fmt.Errorf("move feasibilities from %s: %w", name, err)
			}
			if err := tx.Delete(&l.dept).Error; err != nil {
				return fmt.Errorf("remove department %s: %w", name, err)
			}

			for _, u := range movedUsers {
				moved = append(moved, movedUser{u.ID, name, l.tier})
			}
			log.Printf("tier migration: %q -> %s tier %s (%d users)", name, target, l.tier, len(movedUsers))
		}
		return nil
	})
	if err != nil {
		log.Printf("tier migration FAILED, nothing was changed: %v", err)
		return
	}

	// Audit entries are written only after the transaction has committed: in
	// Postgres a single failed insert inside a transaction aborts all of it,
	// and a system change has no acting user (audit_logs.user_id has a
	// foreign key to users). Each entry is attributed to the moved user.
	for _, m := range moved {
		entry := models.AuditLog{
			UserID:       utils.Actor(m.id),
			Action:       "updated",
			ResourceType: "user",
			ResourceID:   m.id,
			OldValues:    fmt.Sprintf(`{"department": %q}`, m.from),
			NewValues:    fmt.Sprintf(`{"department": %q, "support_tier": %q}`, cnoc.Name, m.tier),
			Details:      fmt.Sprintf("System migration: moved from department %q to %s as support tier %s", m.from, cnoc.Name, m.tier),
		}
		if err := database.DB.Create(&entry).Error; err != nil {
			log.Printf("tier migration: audit entry for user %d failed: %v", m.id, err)
		}
	}

	names := make([]string, 0, len(levels))
	for _, l := range levels {
		names = append(names, l.dept.Name)
	}
	log.Printf("tier migration: done (%s -> %s)", strings.Join(names, ", "), cnoc.Name)
}
