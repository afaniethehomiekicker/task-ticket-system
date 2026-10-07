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

type CreateTaskInput struct {
	Title        string     `json:"title" binding:"required"`
	Description  string     `json:"description"`
	Priority     string     `json:"priority"` // low, normal, high, critical
	StoryPoints  int        `json:"story_points"`
	ProjectID    uint       `json:"project_id" binding:"required"`
	TicketID     *uint      `json:"ticket_id"` // optional link to parent ticket
	AssigneeID   *uint      `json:"assignee_id"`
	DueDate      *time.Time `json:"due_date"`
	StartDate    *time.Time `json:"start_date"`
	DependsOnIDs []uint     `json:"depends_on_ids"` // task dependencies

	// Sent by the frontend's createTask; previously dropped.
	Labels         string  `json:"labels"` // comma-separated
	EstimatedHours float64 `json:"estimated_hours"`

	// Checklist items created with the task, in one step, so the assignee
	// receives the task complete (the create form had no way to add them).
	Checklist []string `json:"checklist"`

	// Private: only the people on the task (and their managers) see it.
	// Off by default: the whole department can view it (visibility.go).
	IsPrivate bool `json:"is_private"`
}

type UpdateTaskInput struct {
	// Required when the new status requires a reason (workflow catalog).
	StatusReason string     `json:"status_reason"`
	Title        string     `json:"title"`
	Description  string     `json:"description"`
	Priority     string     `json:"priority"`
	Status       string     `json:"status"`
	StoryPoints  int        `json:"story_points"`
	AssigneeID   *uint      `json:"assignee_id"`
	DueDate      *time.Time `json:"due_date"`
	StartDate    *time.Time `json:"start_date"`
	DependsOnIDs []uint     `json:"depends_on_ids"`

	// Optional fields the frontend edits; pointers so "not sent" and
	// "set to zero/false" stay distinguishable.
	Labels         *string  `json:"labels"`
	EstimatedHours *float64 `json:"estimated_hours"`
	ActualHours    *float64 `json:"actual_hours"`
	IsPinned       *bool    `json:"is_pinned"`
	// Private / department-visible. Only the creator, supervisors and
	// admins may change it (canSetPrivacy).
	IsPrivate *bool `json:"is_private"`
}

type TaskQueryParams struct {
	Status     string `form:"status"`
	Priority   string `form:"priority"`
	ProjectID  string `form:"project_id"`
	TicketID   string `form:"ticket_id"`
	AssigneeID string `form:"assigned_to_id"`
	Department string `form:"department"`
	Search     string `form:"search"`
	Page       int    `form:"page,default=1"`
	Limit      int    `form:"limit,default=20"`
	SortBy     string `form:"sort_by,default=created_at"`
	SortOrder  string `form:"sort_order,default=desc"`
	// Client: tasks whose project has this client (primary or linked).
	ClientID string `form:"client_id"`
	// The Tasks page's sort: due | priority | status | number. Pinned first.
	// When set, it replaces sort_by / sort_order.
	Sort string `form:"sort"`
	// "1": the person filter and the search also match sub-tasks (a task
	// is listed when one of its sub-tasks is that person's, or matches the
	// search) — the Tasks page with "show sub-tasks" on.
	Sub string `form:"sub"`
	// "1": the working set loaded at sign-in — unfinished tasks, tasks
	// finished in the last 30 days, and tasks the caller pinned.
	Working string `form:"working"`
}

// Sortable columns for GET /api/tasks (whitelist — see safeOrderClause).
var taskSortColumns = map[string]string{
	"created_at":  "tasks.created_at",
	"updated_at":  "tasks.updated_at",
	"due_date":    "tasks.due_date",
	"priority":    "tasks.priority",
	"status":      "tasks.status",
	"title":       "tasks.title",
	"task_number": "tasks.task_number",
}

// GetTasks returns paginated tasks with department-level privacy filtering
func GetTasks(c *gin.Context) {
	var params TaskQueryParams
	if err := c.ShouldBindQuery(&params); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	params.Page, params.Limit = clampPagination(params.Page, params.Limit)

	query := database.DB.
		Preload("Project").
		Preload("Ticket").
		Preload("Assignee").
		Preload("AssignedBy", userBasics).
		Preload("Creator").
		Preload("SubTasks.Assignee").
		Preload("SubTasks.AssignedBy", userBasics).
		// No comments in the list: they made the download grow with every
		// comment ever written. The task drawer loads them when it opens
		// (GET /api/tasks/:id/comments); GetTask still includes them.
		Preload("Dependencies")
	// The order is added below (sort, or sort_by / sort_order).

	// Checklist items must come back with the task or they vanish on refresh.
	if hasTaskRelation("Checklists") {
		query = query.Preload("Checklists")
	}

	// Visibility (see visibility.go): admins their department, supervisors their
	// own and their team's work, staff their own work. Applied here, in SQL, so
	// the API never returns what the UI would have hidden.
	query = applyTaskScope(query, viewerFrom(c))

	// Finished = a "done" or "cancelled" category in the status catalog.
	finished := statusKeysIn("task", "done", "cancelled")
	switch params.Status {
	case "":
		// See the matching comment in projects.go's GetProjects — same
		// reasoning, archived tasks stay reachable but out of the
		// default list.
		query = query.Where("tasks.status != ?", "archived")
	case "open": // not finished (dashboard drill-down)
		query = query.Where("tasks.status != ? AND tasks.status NOT IN ?", "archived", finished)
	case "overdue": // not finished and past the due date
		query = query.Where("tasks.status != ? AND tasks.status NOT IN ? AND tasks.due_date IS NOT NULL AND tasks.due_date < ?",
			"archived", finished, time.Now().Truncate(24*time.Hour))
	default:
		query = query.Where("tasks.status = ?", params.Status)
	}
	if params.Working == "1" {
		query = query.Where(fmt.Sprintf(`(tasks.status NOT IN ? OR tasks.updated_at >= ?
			OR EXISTS (SELECT 1 FROM pins WHERE pins.user_id = %d AND pins.record_type = 'task' AND pins.record_id = tasks.id))`,
			viewerFrom(c).ID), finished, time.Now().AddDate(0, 0, -30))
	}
	if params.Priority != "" {
		query = query.Where("tasks.priority = ?", params.Priority)
	}
	if params.ProjectID != "" {
		query = query.Where("tasks.project_id = ?", params.ProjectID)
	}
	if params.TicketID != "" {
		query = query.Where("tasks.ticket_id = ?", params.TicketID)
	}
	if id, err := strconv.Atoi(params.ClientID); err == nil && id > 0 {
		query = query.Where(`tasks.project_id IN (SELECT projects.id FROM projects WHERE projects.client_id = ? AND projects.deleted_at IS NULL
			UNION SELECT project_clients.project_id FROM project_clients WHERE project_clients.client_id = ?)`, id, id)
	}
	// Any role: the visibility scope above already limits what's returned.
	if d := strings.TrimSpace(params.Department); d != "" {
		query = query.Where("LOWER(TRIM(tasks.department)) = LOWER(?)", d)
	}

	// Person and search. With sub=1 (sub-tasks shown), a task also matches
	// through a live sub-task that is the person's and, when searching,
	// whose title matches (or whose parent's title / number does) — the
	// rule the Tasks page used in the browser.
	assigneeID, _ := strconv.Atoi(params.AssigneeID)
	search := strings.TrimSpace(params.Search)
	like := "%" + strings.ToLower(search) + "%"
	var parentConds []string
	var parentArgs []interface{}
	if assigneeID > 0 {
		parentConds = append(parentConds, "tasks.assignee_id = ?")
		parentArgs = append(parentArgs, assigneeID)
	}
	if search != "" {
		parentConds = append(parentConds, `(LOWER(tasks.title) LIKE ? OR LOWER(tasks.description) LIKE ?
			OR LOWER(tasks.task_number) LIKE ? OR LOWER(tasks.labels) LIKE ?)`)
		parentArgs = append(parentArgs, like, like, like, like)
	}
	if len(parentConds) > 0 {
		parentSQL := "(" + strings.Join(parentConds, " AND ") + ")"
		if params.Sub == "1" {
			subConds := []string{"st.task_id = tasks.id", "st.deleted_at IS NULL", "st.status != 'archived'"}
			var subArgs []interface{}
			if assigneeID > 0 {
				subConds = append(subConds, "st.assignee_id = ?")
				subArgs = append(subArgs, assigneeID)
			}
			if search != "" {
				subConds = append(subConds, "(LOWER(st.title) LIKE ? OR LOWER(tasks.title) LIKE ? OR LOWER(tasks.task_number) LIKE ?)")
				subArgs = append(subArgs, like, like, like)
			}
			query = query.Where("("+parentSQL+" OR EXISTS (SELECT 1 FROM sub_tasks st WHERE "+strings.Join(subConds, " AND ")+"))",
				append(parentArgs, subArgs...)...)
		} else {
			query = query.Where(parentSQL, parentArgs...)
		}
	}

	if params.Sort != "" {
		query = orderTasks(query, params.Sort, viewerFrom(c).ID)
	} else {
		query = query.Order(safeOrderClause(params.SortBy, params.SortOrder, taskSortColumns, "tasks.created_at"))
	}

	var total int64
	query.Model(&models.Task{}).Count(&total)

	offset := (params.Page - 1) * params.Limit
	query = query.Offset(offset).Limit(params.Limit)

	var tasks []models.Task
	if err := query.Find(&tasks).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch tasks"})
		return
	}

	redactTasks(c, tasks)         // internal notes only for view_internal_notes
	applySubtaskViews(c, tasks)   // subtask assignees get a reference view
	reduceProjectsToRef(c, tasks) // project as reference only (spec slide 14)
	c.JSON(http.StatusOK, gin.H{
		"tasks": tasks,
		"pagination": gin.H{
			"page":  params.Page,
			"limit": params.Limit,
			"total": total,
			"pages": (total + int64(params.Limit) - 1) / int64(params.Limit),
		},
	})
}

// orderTasks — the caller's pinned tasks first, then due (soonest; none
// last), priority, status (by key), or number (newest first, the default).
func orderTasks(q *gorm.DB, sort string, userID uint) *gorm.DB {
	q = q.Order(fmt.Sprintf(
		"(EXISTS (SELECT 1 FROM pins WHERE pins.user_id = %d AND pins.record_type = 'task' AND pins.record_id = tasks.id)) DESC",
		userID))
	switch sort {
	case "due":
		q = q.Order("tasks.due_date ASC NULLS LAST")
	case "priority":
		q = q.Order("CASE tasks.priority WHEN 'critical' THEN 5 WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC")
	case "status":
		q = q.Order("tasks.status ASC")
	}
	return q.Order("tasks.task_number DESC").Order("tasks.id DESC")
}

// GetTask returns a single task by ID
func GetTask(c *gin.Context) {
	id := c.Param("id")

	query := database.DB.
		Preload("Project").
		Preload("Ticket").
		Preload("Assignee").
		Preload("AssignedBy", userBasics).
		Preload("Creator").
		Preload("SubTasks.Assignee").
		Preload("SubTasks.AssignedBy", userBasics).
		Preload("Comments.User").
		Preload("Attachments").
		Preload("WorkLogs.User").
		Preload("Dependencies")

	if hasTaskRelation("Checklists") {
		query = query.Preload("Checklists")
	}

	var task models.Task
	if err := query.First(&task, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch task"})
		return
	}

	// Privacy check (department, project department, or explicit assignment).
	// A non-private task of the caller's department is readable as a whole
	// (read-only); someone assigned only a subtask gets the reference view.
	if !userCanAccessTask(c, &task) {
		switch {
		case taskInViewerDepts(viewerFrom(c), &task, nil):
			limitToDeptView(&task)
		case hasSubtaskAssignedIn(task.ID, viewerFrom(c).ID):
			limitToSubtaskView(&task, viewerFrom(c).ID)
		default:
			c.JSON(http.StatusForbidden, gin.H{"error": "Access denied: task belongs to different department"})
			return
		}
	}

	redactTask(c, &task) // internal notes only for view_internal_notes
	if task.AccessLevel == "" {
		v := viewerFrom(c)
		var sup *uint
		if v.Role == "supervisor" {
			sup = supervisorOf(task.AssigneeID)
		}
		if !taskVisibleTo(v, &task, sup) && hasRecordAccess("task", task.ID, v.ID) {
			task.AccessLevel = "granted"
		}
	}
	reduceProjectToRef(c, &task) // project as reference only (spec slide 14)
	c.JSON(http.StatusOK, gin.H{"task": task})
}

// CreateTask creates a new task
func CreateTask(c *gin.Context) {
	var input CreateTaskInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userIDVal, _ := c.Get("user_id")
	userDeptVal, _ := c.Get("user_department")
	currentUserID := userIDVal.(uint)
	currentUserDept := userDeptVal.(string)

	// Verify project exists
	var project models.Project
	if err := database.DB.First(&project, input.ProjectID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Project not found"})
		return
	}
	// Same visibility rule as reading the project: you can't add work to a
	// project you can't see.
	if !userCanAccessProject(c, &project) {
		c.JSON(http.StatusForbidden, gin.H{"error": "You don't have access to that project"})
		return
	}
	if msg := taskAssigneeRoleError(input.AssigneeID); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	if msg := assigneeError(input.AssigneeID); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	// Dependencies must be tasks the caller can access (task_dependencies.go).
	// Checked before anything is created, so a refusal leaves nothing behind.
	deps, depCode, depMsg := validateDependencies(c, 0, input.DependsOnIDs, nil)
	if depCode != 0 {
		c.JSON(depCode, gin.H{"error": depMsg})
		return
	}

	// Generate task number
	// Permanent ID from the atomic counter (spec slide 7) — "highest + 1"
	// could hand the same number to two records created together.
	taskNumber, idErr := models.NextID(database.DB, "TSK")
	if idErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to allocate a task ID"})
		return
	}

	// Department from project or user
	department := project.Department
	if department == "" {
		department = currentUserDept
	}

	task := models.Task{
		TaskNumber:  taskNumber,
		Title:       input.Title,
		Description: input.Description,
		Priority:    input.Priority,
		StoryPoints: input.StoryPoints,
		ProjectID:   &input.ProjectID,
		TicketID:    input.TicketID,
		AssigneeID:  input.AssigneeID,
		AssignedByID: func() *uint {
			if input.AssigneeID != nil {
				return &currentUserID
			}
			return nil
		}(),
		CreatorID:  &currentUserID,
		DueDate:    input.DueDate,
		StartDate:  input.StartDate,
		Department: department,
		Status:     "todo",
		IsPrivate:  input.IsPrivate,
	}

	if task.Priority == "" {
		task.Priority = "normal"
	}

	// Create task
	if err := database.DB.Create(&task).Error; err != nil {
		serverError(c, "Failed to create task", err)
		return
	}

	// Checklist items sent with the task.
	for idx, item := range input.Checklist {
		title := strings.TrimSpace(item)
		if title == "" {
			continue
		}
		if len(title) > 500 {
			title = title[:500]
		}
		_ = idx
		database.DB.Create(&models.ChecklistItem{TaskID: task.ID, Title: title})
	}

	// Optional columns from the frontend's create form. Written separately and
	// only where the column exists, so an un-migrated database still creates
	// the task instead of failing the whole request.
	extras := map[string]interface{}{}
	if input.Labels != "" && taskHasColumn("labels") {
		extras["labels"] = input.Labels
	}
	if input.EstimatedHours != 0 && taskHasColumn("estimated_hours") {
		extras["estimated_hours"] = input.EstimatedHours
	}
	if len(extras) > 0 {
		if err := database.DB.Model(&task).Updates(extras).Error; err != nil {
			log.Printf("tasks: failed to store optional fields on %s: %v", task.TaskNumber, err)
		}
	}

	// Add dependencies if provided (validated above)
	if len(deps) > 0 {
		database.DB.Model(&task).Association("Dependencies").Append(&deps)
	}

	utils.LogAudit(currentUserID, "created", "task", task.ID,
		fmt.Sprintf("Created task %s: %s", task.TaskNumber, task.Title), c.ClientIP(), c.Request.UserAgent())
	if task.AssigneeID != nil {
		notify(currentUserID, notice{"assignment", "New task: " + task.TaskNumber,
			fmt.Sprintf("%s assigned you %s: %s", actorName(currentUserID), task.TaskNumber, task.Title),
			"task", task.ID}, *task.AssigneeID)
	}

	// Reload with every relation the frontend's normalizeTask reads (see
	// taskWithRelations in task_workflow.go) — the client stores whatever
	// comes back here as the task.
	syncProjectStatusFromTasks(task.ProjectID, currentUserID)
	c.JSON(http.StatusCreated, gin.H{"message": "Task created successfully", "task": reloadFullTask(c, task)})
}

// UpdateTask updates an existing task
func UpdateTask(c *gin.Context) {
	id := c.Param("id")

	userIDVal, _ := c.Get("user_id")
	userRoleVal, _ := c.Get("user_role")
	currentUserID := userIDVal.(uint)
	currentUserRole, _ := userRoleVal.(string)

	var task models.Task
	if err := database.DB.First(&task, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch task"})
		return
	}

	// Privacy check. This used to test task.Project, which is never loaded
	// here (plain First, no Preload), so the condition was always false and
	// nothing was ever denied.
	if !userCanAccessTask(c, &task) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	var input UpdateTaskInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Private / department-visible. Checked before anything is logged or
	// saved. An unchanged value is a no-op (edit forms resend the current one).
	privacyChange := input.IsPrivate != nil && *input.IsPrivate != task.IsPrivate
	if privacyChange && !canSetPrivacy(viewerFrom(c), task.CreatorID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only the person who created this task, a supervisor or an admin can change whether it is private"})
		return
	}

	// Dependencies are checked BEFORE any field is saved, so a refused link
	// doesn't leave the rest of the edit half-applied (task_dependencies.go).
	var newDeps []models.Task
	if len(input.DependsOnIDs) > 0 {
		var code int
		var msg string
		newDeps, code, msg = validateDependencies(c, task.ID, input.DependsOnIDs, existingDependencyIDs(task.ID))
		if code != 0 {
			c.JSON(code, gin.H{"error": msg})
			return
		}
	}

	updates := map[string]interface{}{}
	if input.Title != "" {
		updates["title"] = input.Title
	}
	if input.Description != "" {
		updates["description"] = input.Description
	}
	if input.Priority != "" {
		updates["priority"] = input.Priority
	}
	// The edit form always submits the task's current status along with
	// whatever else changed, so an unchanged status must be a no-op. Otherwise
	// editing the title of a task that's in review (or done) would be rejected
	// by the review-workflow rules below even though nobody touched the status.
	if input.Status != "" && input.Status != task.Status {
		// Same rule as UpdateTaskStatus below: "archived" can only be
		// set via DeleteTask, which is permission-gated and stamps
		// ArchivedAt/ArchivedByID. This generic update endpoint has no
		// such restriction, so it must not accept it either.
		if input.Status == "archived" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Use the archive/delete action to archive a task"})
			return
		}
		if code, msg := taskStatusError(canApproveWork(currentUserRole), input.Status); code != 0 {
			c.JSON(code, gin.H{"error": msg})
			return
		}
		if msg := statusReasonError("task", input.Status, input.StatusReason); msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}
		// Recorded with previous -> new and the reason (spec slide 21).
		utils.LogAuditWithValues(currentUserID, "status_changed", "task", task.ID,
			statusChange(task.Status), statusChangeWithReason(input.Status, input.StatusReason),
			statusChangeDetails("task", task.Status, input.Status, input.StatusReason), c.ClientIP(), c.Request.UserAgent())
		updates["status"] = input.Status
		if input.Status == "done" && task.CompletedAt == nil {
			now := time.Now()
			updates["completed_at"] = now
		}
	}
	if input.StoryPoints > 0 {
		updates["story_points"] = input.StoryPoints
	}
	if input.AssigneeID != nil {
		// Reassigning is a matrix permission ("Reassign Tickets & Tasks" =
		// assign_tickets). This endpoint never checked it — it only looked
		// harmless because the frontend used to send camelCase keys the
		// backend ignored; now that assignee_id actually arrives, anyone with
		// access to the task could hand it to anyone else.
		changing := task.AssigneeID == nil || *task.AssigneeID != *input.AssigneeID
		if changing && !canAssignWork(currentUserRole) {
			// The assignee may still pass it to a colleague in their own
			// department (spec slide 20: transfers).
			if ok, msg := canTransferOwnWork(c, task.AssigneeID, input.AssigneeID); !ok {
				if msg == "" {
					msg = "You don't have permission to reassign tasks"
				}
				c.JSON(http.StatusForbidden, gin.H{"error": msg})
				return
			}
		}
		if changing {
			if msg := taskAssigneeRoleError(input.AssigneeID); msg != "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": msg})
				return
			}
		}
		if changing {
			if msg := assigneeError(input.AssigneeID); msg != "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": msg})
				return
			}
			utils.LogAuditWithValues(currentUserID, "transferred", "task", task.ID,
				map[string]interface{}{"assignee": assigneeLabel(task.AssigneeID)},
				map[string]interface{}{"assignee": assigneeLabel(input.AssigneeID)},
				fmt.Sprintf("Task %s transferred: %s -> %s", task.TaskNumber, assigneeLabel(task.AssigneeID), assigneeLabel(input.AssigneeID)),
				c.ClientIP(), c.Request.UserAgent())
			kind, verb := "assignment", "assigned you"
			if task.AssigneeID != nil && *task.AssigneeID == currentUserID {
				kind, verb = "transfer", "transferred to you"
			}
			notify(currentUserID, notice{kind, "Task " + task.TaskNumber + " is now yours",
				fmt.Sprintf("%s %s %s: %s", actorName(currentUserID), verb, task.TaskNumber, task.Title),
				"task", task.ID}, *input.AssigneeID)
		}
		updates["assignee_id"] = *input.AssigneeID
		if task.AssigneeID == nil || *task.AssigneeID != *input.AssigneeID {
			updates["assigned_by_id"] = currentUserID // who gave it to them
		}
	}
	if input.DueDate != nil {
		updates["due_date"] = *input.DueDate
	}
	if input.StartDate != nil {
		updates["start_date"] = *input.StartDate
	}
	if input.Labels != nil && taskHasColumn("labels") {
		updates["labels"] = *input.Labels
	}
	if input.EstimatedHours != nil && taskHasColumn("estimated_hours") {
		updates["estimated_hours"] = *input.EstimatedHours
	}
	if input.ActualHours != nil && taskHasColumn("actual_hours") {
		updates["actual_hours"] = *input.ActualHours
	}
	if input.IsPinned != nil && taskHasColumn("is_pinned") {
		updates["is_pinned"] = *input.IsPinned
	}
	if privacyChange {
		updates["is_private"] = *input.IsPrivate
	}

	before := task
	if len(updates) > 0 {
		if err := database.DB.Model(&task).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update task"})
			return
		}
	}

	// Update dependencies if provided (validated above)
	if len(newDeps) > 0 {
		database.DB.Model(&task).Association("Dependencies").Replace(&newDeps)
	}

	// Record exactly which fields changed, old -> new (status and assignee
	// changes have their own entries above).
	var after models.Task
	if err := database.DB.First(&after, task.ID).Error; err == nil {
		if oldV, newV, changed := fieldDiff(before, after, taskDiffFields); len(changed) > 0 {
			utils.LogAuditWithValues(currentUserID, "updated", "task", task.ID, oldV, newV,
				fmt.Sprintf("Updated task %s: %s", task.TaskNumber, strings.Join(changed, ", ")),
				c.ClientIP(), c.Request.UserAgent())
		}
	}

	// Full reload. This used to preload only Project/Assignee/Creator/
	// Dependencies; the frontend REPLACES its copy of the task with this
	// response, so every edit made the task's sub-tasks, comments and
	// checklist disappear from the UI until the next page reload.
	syncProjectStatusFromTasks(task.ProjectID, currentUserID)
	c.JSON(http.StatusOK, gin.H{"message": "Task updated successfully", "task": reloadFullTask(c, task)})
}

// DeleteTask archives a task — see the matching comment on DeleteProject
// in projects.go for why this replaces GORM soft-delete.
func DeleteTask(c *gin.Context) {
	id := c.Param("id")

	userIDVal, _ := c.Get("user_id")
	currentUserID := userIDVal.(uint)

	var task models.Task
	if err := database.DB.First(&task, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch task"})
		return
	}

	// Privacy check. This used to test task.Project, which is never loaded
	// here (plain First, no Preload), so the condition was always false and
	// nothing was ever denied.
	if !userCanAccessTask(c, &task) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// The archive_records matrix permission (see restore.go).
	if !canArchiveRecords(c) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Insufficient permissions to archive task"})
		return
	}

	// Archiving twice would overwrite pre_archive_status with "archived",
	// losing the status Restore needs.
	if task.Status == "archived" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Already archived"})
		return
	}

	now := time.Now()
	if err := database.DB.Model(&task).Updates(map[string]interface{}{
		"status":             "archived",
		"pre_archive_status": task.Status,
		"archived_at":        now,
		"archived_by_id":     currentUserID,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to archive task"})
		return
	}

	utils.LogAudit(currentUserID, "archived", "task", task.ID,
		fmt.Sprintf("Archived task %s: %s", task.TaskNumber, task.Title), c.ClientIP(), c.Request.UserAgent())

	syncProjectStatusFromTasks(task.ProjectID, viewerFrom(c).ID)
	c.JSON(http.StatusOK, gin.H{"message": "Task archived successfully"})
}

// UpdateTaskStatus updates just the status
func UpdateTaskStatus(c *gin.Context) {
	id := c.Param("id")

	userIDVal, _ := c.Get("user_id")
	userRoleVal, _ := c.Get("user_role")
	currentUserID := userIDVal.(uint)
	currentUserRole, _ := userRoleVal.(string)

	var task models.Task
	if err := database.DB.First(&task, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch task"})
		return
	}

	// Privacy check. This used to test task.Project, which is never loaded
	// here (plain First, no Preload), so the condition was always false and
	// nothing was ever denied.
	if !userCanAccessTask(c, &task) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	var input struct {
		Status string `json:"status" binding:"required"`
		Reason string `json:"reason"` // required for some statuses (catalog)
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// "archived" is deliberately not a valid status here — it's only reachable
	// through DeleteTask (permission-gated, stamps ArchivedAt/ArchivedByID).
	// in_review / done / closed are gated too: see taskStatusError.
	if code, msg := taskStatusError(canApproveWork(currentUserRole), input.Status); code != 0 {
		c.JSON(code, gin.H{"error": msg})
		return
	}
	if msg := statusReasonError("task", input.Status, input.Reason); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}

	// Capture BEFORE Updates(): GORM writes map-update values back into the
	// model struct, so task.Status is already the new value afterwards and the
	// audit log used to read "from X to X".
	oldStatus := task.Status

	updates := map[string]interface{}{
		"status": input.Status,
	}

	if statusCategory("task", input.Status) == "done" && task.CompletedAt == nil {
		now := time.Now()
		updates["completed_at"] = now
	}
	// Keep persisted progress in step with what the UI shows for these moves.
	if taskHasColumn("progress") {
		switch input.Status {
		case "done":
			updates["progress"] = 100
		case "todo":
			updates["progress"] = 0
		}
	}

	if err := database.DB.Model(&task).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update status"})
		return
	}

	utils.LogAuditWithValues(currentUserID, "status_changed", "task", task.ID,
		statusChange(oldStatus), statusChangeWithReason(input.Status, input.Reason),
		statusChangeDetails("task", oldStatus, input.Status, input.Reason), c.ClientIP(), c.Request.UserAgent())

	syncProjectStatusFromTasks(task.ProjectID, viewerFrom(c).ID)
	c.JSON(http.StatusOK, gin.H{"message": "Status updated successfully", "task": reloadFullTask(c, task)})
}
