package database

import (
	"log"
	"time"

	"task-ticket-backend/internal/models"

	"gorm.io/gorm"
)

// --- Shared lookup helpers ---------------------------------------------

func getUserIDByEmail(email string) *uint {
	var user models.User
	if err := DB.Where("LOWER(email) = LOWER(?)", email).First(&user).Error; err != nil {
		return nil
	}
	id := user.ID
	return &id
}

func getProjectIDByCode(code string) *uint {
	var project models.Project
	if err := DB.Where("code = ?", code).First(&project).Error; err != nil {
		return nil
	}
	id := project.ID
	return &id
}

// userRefsFromIDs turns a list of *uint into []models.User with only the
// ID populated. That's sufficient for GORM's Association.Append/Replace to
// create the join-table rows — a non-zero primary key is treated as
// "link to this existing row", not "create a new one", so there's no need
// to re-fetch each full user record.
func userRefsFromIDs(ids ...*uint) []models.User {
	var users []models.User
	for _, id := range ids {
		if id != nil {
			users = append(users, models.User{Model: gorm.Model{ID: *id}})
		}
	}
	return users
}

func parseTimeOrNil(s string) *time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return nil
	}
	return &t
}

// --- Projects ------------------------------------------------------------

// SeedDemoProjects creates the demo project set if none exist yet. Must
// run AFTER SeedDemoUsers — every owner/admin/member/supervisor here is
// resolved by looking up a real seeded user's id by email, so if the
// users aren't there yet, this silently skips rather than seeding
// projects with broken/nil ownership.
func SeedDemoProjects() {
	var count int64
	DB.Model(&models.Project{}).Count(&count)
	if count > 0 {
		log.Println("Demo projects already exist. Skipping seed.")
		return
	}

	marcusID := getUserIDByEmail("marcus.sterling@apexcore.io")
	sarahID := getUserIDByEmail("sarah.jenkins@apexcore.io")
	davidID := getUserIDByEmail("david.kim@apexcore.io")
	elenaID := getUserIDByEmail("elena.rostova@apexcore.io")
	alexID := getUserIDByEmail("alex.rivera@apexcore.io")
	chloeID := getUserIDByEmail("chloe.bennett@apexcore.io")
	liamID := getUserIDByEmail("liam.chen@apexcore.io")
	mayaID := getUserIDByEmail("maya.patel@apexcore.io")

	if marcusID == nil || sarahID == nil {
		log.Println("Demo users not found — skipping project seed. Ensure SeedDemoUsers runs first.")
		return
	}

	type seedProject struct {
		project       models.Project
		memberIDs     []*uint
		supervisorIDs []*uint
	}

	seeds := []seedProject{
		{
			project: models.Project{
				Code:        "PRJ-ENG-01",
				Title:       "NextGen Cloud Architecture & Microservices",
				Description: "Migration of core monolithic services to decoupled containerized microservices with zero-downtime deployment pipelines and strict sub-50ms latency SLAs.",
				Department:  "Engineering",
				Status:      "active",
				Priority:    "critical",
				StartDate:   "2026-07-01",
				DueDate:     "2026-10-31",
				OwnerID:     marcusID,
				AdminID:     marcusID,
				Progress:    68,
				BudgetHours: 420,
				SpentHours:  290,
				IsPinned:    true,
				Tags:        "Architecture,Kubernetes,Cloud Migration",
			},
			memberIDs:     []*uint{davidID, alexID, chloeID},
			supervisorIDs: []*uint{davidID},
		},
		{
			project: models.Project{
				Code:        "PRJ-ENG-02",
				Title:       "Enterprise Single Sign-On (SSO) & SCIM Protocol",
				Description: "Implement SAML 2.0, Okta, Azure AD, and Google Workspace automated directory syncing for Tier-1 corporate clients.",
				Department:  "Engineering",
				Status:      "active",
				Priority:    "high",
				StartDate:   "2026-08-01",
				DueDate:     "2026-09-15",
				OwnerID:     marcusID,
				AdminID:     marcusID,
				Progress:    45,
				BudgetHours: 180,
				SpentHours:  78,
				IsPinned:    false,
				Tags:        "Security,Identity,SSO",
			},
			memberIDs:     []*uint{davidID, alexID},
			supervisorIDs: []*uint{davidID},
		},
		{
			project: models.Project{
				Code:        "PRJ-CS-01",
				Title:       "24/7 Global Incident Response & VIP SLA System",
				Description: "Revamping enterprise customer triage matrix, automated escalation routing, and multi-tier on-call escalation procedures.",
				Department:  "Customer Success",
				Status:      "active",
				Priority:    "urgent",
				StartDate:   "2026-06-15",
				DueDate:     "2026-09-30",
				OwnerID:     sarahID,
				AdminID:     sarahID,
				Progress:    82,
				BudgetHours: 250,
				SpentHours:  205,
				IsPinned:    true,
				Tags:        "Customer Experience,SLA,Triage",
			},
			memberIDs:     []*uint{elenaID, liamID, mayaID},
			supervisorIDs: []*uint{elenaID},
		},
		{
			project: models.Project{
				Code:        "PRJ-CS-02",
				Title:       "Self-Service Knowledge Base & Automated Chatbot",
				Description: "AI-assisted solution library and interactive diagnostic guides to reduce repetitive Level-1 ticket volume by 35%.",
				Department:  "Customer Success",
				Status:      "planning",
				Priority:    "normal",
				StartDate:   "2026-09-01",
				DueDate:     "2026-12-15",
				OwnerID:     sarahID,
				AdminID:     sarahID,
				Progress:    15,
				BudgetHours: 160,
				SpentHours:  24,
				IsPinned:    false,
				Tags:        "Knowledge Base,Automation",
			},
			memberIDs:     []*uint{elenaID, mayaID},
			supervisorIDs: []*uint{elenaID},
		},
	}

	for _, s := range seeds {
		proj := s.project
		if err := DB.Omit("Owner", "Admin", "Members", "Supervisors").Create(&proj).Error; err != nil {
			log.Printf("Failed to seed project %s: %v\n", proj.Code, err)
			continue
		}

		if members := userRefsFromIDs(s.memberIDs...); len(members) > 0 {
			DB.Model(&proj).Association("Members").Append(&members)
		}
		if supervisors := userRefsFromIDs(s.supervisorIDs...); len(supervisors) > 0 {
			DB.Model(&proj).Association("Supervisors").Append(&supervisors)
		}
	}

	log.Println("Demo projects seeded successfully.")
}

// --- Tasks -----------------------------------------------------------------

// SeedDemoTasks creates the demo task set if none exist yet. Must run
// AFTER SeedDemoProjects (tasks link to a project by id) and
// SeedDemoUsers (tasks link to an assignee/creator by id).
func SeedDemoTasks() {
	var count int64
	DB.Model(&models.Task{}).Count(&count)
	if count > 0 {
		log.Println("Demo tasks already exist. Skipping seed.")
		return
	}

	eng01 := getProjectIDByCode("PRJ-ENG-01")
	cs01 := getProjectIDByCode("PRJ-CS-01")

	if eng01 == nil || cs01 == nil {
		log.Println("Demo projects not found — skipping task seed. Ensure SeedDemoProjects runs first.")
		return
	}

	alexID := getUserIDByEmail("alex.rivera@apexcore.io")
	chloeID := getUserIDByEmail("chloe.bennett@apexcore.io")
	davidID := getUserIDByEmail("david.kim@apexcore.io")
	marcusID := getUserIDByEmail("marcus.sterling@apexcore.io")
	liamID := getUserIDByEmail("liam.chen@apexcore.io")
	mayaID := getUserIDByEmail("maya.patel@apexcore.io")
	elenaID := getUserIDByEmail("elena.rostova@apexcore.io")

	tasks := []models.Task{
		{
			TaskNumber:     "TSK-101",
			Title:          "Implement OAuth2 PKCE Flow for Mobile & Single Page Apps",
			Description:    "Upgrade the authorization server to support PKCE-compliant token exchanges to prevent auth-code interception attacks.",
			Department:     "Engineering",
			Status:         "in_progress",
			Priority:       "urgent",
			Labels:         "Security,Auth,API",
			ProjectID:      eng01,
			AssigneeID:     alexID,
			CreatorID:      davidID,
			Progress:       60,
			StartDate:      "2026-08-10",
			DueDate:        "2026-08-22",
			EstimatedHours: 24,
			ActualHours:    16,
			IsPinned:       true,
			ReviewStatus:   "none",
		},
		{
			TaskNumber:     "TSK-102",
			Title:          "Database Sharding & Read-Replica Load Balancing",
			Description:    "Configure multi-region read replicas with automatic connection routing to handle a 3x traffic surge during upcoming marketing launches.",
			Department:     "Engineering",
			Status:         "under_review",
			Priority:       "critical",
			Labels:         "Database,Postgres,Infrastructure",
			ProjectID:      eng01,
			AssigneeID:     chloeID,
			CreatorID:      marcusID,
			Progress:       95,
			StartDate:      "2026-08-01",
			DueDate:        "2026-08-19",
			EstimatedHours: 40,
			ActualHours:    38,
			ReviewStatus:   "submitted_for_review",
			ReviewNotes:    "Stress test reports and Grafana dashboards attached in run logs.",
		},
		{
			TaskNumber:     "TSK-103",
			Title:          "Audit & Streamline Customer SLA Escalation Rules",
			Description:    "Configure automated notification triggers when high-severity tickets remain unassigned for more than 15 minutes.",
			Department:     "Customer Success",
			Status:         "in_progress",
			Priority:       "high",
			Labels:         "SLA,Escalation,Triage",
			ProjectID:      cs01,
			AssigneeID:     liamID,
			CreatorID:      elenaID,
			Progress:       50,
			StartDate:      "2026-08-12",
			DueDate:        "2026-08-25",
			EstimatedHours: 18,
			ActualHours:    9,
			ReviewStatus:   "none",
		},
		{
			TaskNumber:     "TSK-104",
			Title:          "Design VIP Client Rapid-Response Dashboard",
			Description:    "Create real-time queue monitors showing SLA countdown meters for Fortune 500 accounts.",
			Department:     "Customer Success",
			Status:         "todo",
			Priority:       "normal",
			Labels:         "Dashboard,VIP,Analytics",
			ProjectID:      cs01,
			AssigneeID:     mayaID,
			CreatorID:      elenaID,
			Progress:       0,
			StartDate:      "2026-08-18",
			DueDate:        "2026-08-28",
			EstimatedHours: 20,
			ReviewStatus:   "none",
		},
		{
			TaskNumber:     "TSK-105",
			Title:          "Automated CI/CD Vulnerability Scanning Pipeline",
			Description:    "Integrate container scanning and dependency CVE checkers into GitHub Actions deployment pipeline.",
			Department:     "Engineering",
			Status:         "completed",
			Priority:       "high",
			Labels:         "DevOps,Security,CI/CD",
			ProjectID:      eng01,
			AssigneeID:     davidID,
			CreatorID:      marcusID,
			Progress:       100,
			StartDate:      "2026-07-20",
			DueDate:        "2026-08-10",
			EstimatedHours: 16,
			ActualHours:    14.5,
			ReviewStatus:   "admin_approved",
		},
	}

	for _, t := range tasks {
		task := t
		if err := DB.Omit("Assignee", "Creator", "Project", "Checklists", "SubTasks", "Comments", "Attachments", "DependsOn").Create(&task).Error; err != nil {
			log.Printf("Failed to seed task %s: %v\n", task.TaskNumber, err)
			continue
		}

		// One representative checklist per task with real progress, so
		// the review workflow / checklist UI has something to show
		// immediately rather than every seeded task looking empty.
		if task.TaskNumber == "TSK-101" {
			DB.Create(&models.Checklist{TaskID: task.ID, Title: "Generate code_verifier and code_challenge hashes", Completed: true, CompletedByID: alexID, CompletedAt: parseTimeOrNil("2026-08-12T14:00:00Z")})
			DB.Create(&models.Checklist{TaskID: task.ID, Title: "Update client callback token exchange endpoint", Completed: true, CompletedByID: alexID, CompletedAt: parseTimeOrNil("2026-08-14T11:30:00Z")})
			DB.Create(&models.Checklist{TaskID: task.ID, Title: "Add unit tests for expired challenge tokens", Completed: false})
			DB.Create(&models.Checklist{TaskID: task.ID, Title: "Conduct end-to-end sandbox verification", Completed: false})
		}
	}

	log.Println("Demo tasks seeded successfully.")
}

// --- Tickets -----------------------------------------------------------

// SeedDemoTickets creates the demo ticket set if none exist yet. Must run
// AFTER SeedDemoProjects and SeedDemoUsers.
func SeedDemoTickets() {
	var count int64
	DB.Model(&models.Ticket{}).Count(&count)
	if count > 0 {
		log.Println("Demo tickets already exist. Skipping seed.")
		return
	}

	eng01 := getProjectIDByCode("PRJ-ENG-01")
	eng02 := getProjectIDByCode("PRJ-ENG-02")

	alexID := getUserIDByEmail("alex.rivera@apexcore.io")
	liamID := getUserIDByEmail("liam.chen@apexcore.io")
	mayaID := getUserIDByEmail("maya.patel@apexcore.io")

	tickets := []models.Ticket{
		{
			TicketNumber:         "TCK-1041",
			Title:                "Intermittent 504 Gateway Timeouts on Bulk Export API",
			Description:          "Customer reports that generating CSV exports with > 100,000 records times out after 60 seconds with an Nginx 504 error.",
			Department:           "Engineering",
			Category:             "Bug",
			Priority:             "critical",
			Severity:             "critical",
			Status:               "in_progress",
			RequesterName:        "Jonathan Davis",
			RequesterEmail:       "j.davis@acmecorp.com",
			RequesterCompany:     "Acme Global Corp",
			ProjectID:            eng01,
			AssignedToID:         alexID,
			DueDate:              "2026-08-18T18:00:00Z",
			ResponseSlaMinutes:   30,
			ResolutionSlaMinutes: 240,
			FirstResponseAt:      parseTimeOrNil("2026-08-18T00:45:00Z"),
			EscalationLevel:      "none",
			Labels:               "API,Performance,Tier-1-VIP",
			IsPinned:             true,
		},
		{
			TicketNumber:         "TCK-1042",
			Title:                "SAML SSO Assertion Validation Error with Okta IdP",
			Description:          `Enterprise users receiving "Invalid Audience Restriction" when trying to sign in via Okta organization portal.`,
			Department:           "Engineering",
			Category:             "Integration",
			Priority:             "urgent",
			Severity:             "major",
			Status:               "escalated",
			RequesterName:        "Rachel Green",
			RequesterEmail:       "rachel.g@starkindustries.org",
			RequesterCompany:     "Stark Industries",
			ProjectID:            eng02,
			AssignedToID:         alexID,
			DueDate:              "2026-08-19T12:00:00Z",
			ResponseSlaMinutes:   60,
			ResolutionSlaMinutes: 480,
			FirstResponseAt:      parseTimeOrNil("2026-08-17T14:20:00Z"),
			EscalationLevel:      "supervisor",
			EscalationReason:     "Requires entity ID certificate re-validation on IdP metadata.",
			Labels:               "SSO,Okta,Security",
		},
		{
			TicketNumber:         "TCK-1043",
			Title:                "Billing Overcharge Inquiry for Additional Seat Licenses",
			Description:          "Invoice #INV-2026-089 contains charges for 50 inactive seats that were decommissioned in July.",
			Department:           "Customer Success",
			Category:             "Billing",
			Priority:             "normal",
			Severity:             "moderate",
			Status:               "in_progress",
			RequesterName:        "Marcus Wright",
			RequesterEmail:       "m.wright@nexusventures.com",
			RequesterCompany:     "Nexus Ventures",
			AssignedToID:         liamID,
			DueDate:              "2026-08-20T16:00:00Z",
			ResponseSlaMinutes:   120,
			ResolutionSlaMinutes: 1440,
			FirstResponseAt:      parseTimeOrNil("2026-08-16T11:00:00Z"),
			EscalationLevel:      "none",
			Labels:               "Billing,Refund-Request",
		},
		{
			TicketNumber:         "TCK-1044",
			Title:                "Custom Webhook Event Payload Request",
			Description:          "Client requesting addition of actor_id and timestamp_epoch fields to the project.updated webhook payload.",
			Department:           "Customer Success",
			Category:             "Feature Request",
			Priority:             "low",
			Severity:             "minor",
			Status:               "resolved",
			RequesterName:        "Sophia Lin",
			RequesterEmail:       "sophia@bytecraft.io",
			RequesterCompany:     "Bytecraft Labs",
			AssignedToID:         mayaID,
			DueDate:              "2026-08-24T18:00:00Z",
			ResponseSlaMinutes:   240,
			ResolutionSlaMinutes: 2880,
			FirstResponseAt:      parseTimeOrNil("2026-08-14T09:30:00Z"),
			ResolvedAt:           parseTimeOrNil("2026-08-16T15:00:00Z"),
			ResolutionSummary:    "Added custom metadata mapper to webhook settings v2.1. Client confirmed operational.",
			EscalationLevel:      "none",
			Labels:               "Webhooks,API-Docs",
		},
	}

	for _, t := range tickets {
		ticket := t
		if err := DB.Omit("AssignedTo", "Project").Create(&ticket).Error; err != nil {
			log.Printf("Failed to seed ticket %s: %v\n", ticket.TicketNumber, err)
		}
	}

	log.Println("Demo tickets seeded successfully.")
}
