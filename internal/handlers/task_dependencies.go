package handlers

import (
	"net/http"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
)

// Task dependencies ("this task depends on that one").
//
// Three endpoints link tasks: POST /api/tasks (depends_on_ids),
// PUT /api/tasks/:id (depends_on_ids) and POST /api/tasks/:id/dependencies.
// They only checked access to the task being edited, never to the task being
// linked, and every task response preloaded its dependencies as FULL task
// rows. So anyone could link task 1, 2, 3, ... to a task of their own and read
// every task in the company from the response. Nothing stopped circular
// links (A -> B -> A) either.
//
// Now:
//   - validateDependencies: a new link must point at a task the caller can
//     access, and must not create a cycle.
//   - dependencyRefs: responses carry dependencies as references only
//     (id, number, title, status — all the task drawer shows), and a
//     dependency the viewer can't access shows its number but no title or
//     status. That also covers links made before this fix.

// maxDependencies caps how many tasks one task can depend on.
const maxDependencies = 50

// validateDependencies checks the tasks `ids` before `taskID` is linked to
// them. taskID is 0 when the task is being created. `existing` holds ids
// already linked to the task: those were accepted earlier, so re-sending them
// (e.g. a full replace) doesn't need fresh access to them. Returns the tasks
// to link; when code is non-zero the request must be refused.
func validateDependencies(c *gin.Context, taskID uint, ids []uint, existing map[uint]bool) ([]models.Task, int, string) {
	seen := map[uint]bool{}
	unique := make([]uint, 0, len(ids))
	for _, id := range ids {
		if id == 0 {
			return nil, http.StatusBadRequest, "Dependency task not found"
		}
		if taskID != 0 && id == taskID {
			return nil, http.StatusBadRequest, "A task cannot depend on itself"
		}
		if !seen[id] {
			seen[id] = true
			unique = append(unique, id)
		}
	}
	if len(unique) == 0 {
		return nil, 0, ""
	}
	if len(unique) > maxDependencies {
		return nil, http.StatusBadRequest, "A task can depend on at most 50 other tasks"
	}

	var deps []models.Task
	if err := database.DB.Where("id IN ?", unique).Find(&deps).Error; err != nil {
		return nil, http.StatusInternalServerError, "Failed to load dependency tasks"
	}
	if len(deps) != len(unique) {
		return nil, http.StatusBadRequest, "Dependency task not found"
	}
	for i := range deps {
		if existing[deps[i].ID] {
			continue
		}
		if !userCanAccessTask(c, &deps[i]) {
			return nil, http.StatusForbidden, "You can only add dependencies on tasks you have access to"
		}
	}

	// A brand-new task has nothing depending on it yet, so it can't close a
	// loop. For an existing one: if any new dependency already (directly or
	// through others) depends on this task, linking would make a cycle.
	if taskID != 0 && reachesTask(unique, taskID) {
		return nil, http.StatusBadRequest, "That would create a circular dependency"
	}
	return deps, 0, ""
}

// reachesTask reports whether `target` is reachable from any of `start` by
// following "depends on" links.
func reachesTask(start []uint, target uint) bool {
	visited := map[uint]bool{}
	frontier := append([]uint(nil), start...)
	for len(frontier) > 0 && len(visited) < 10000 {
		var batch []uint
		for _, id := range frontier {
			if id == target {
				return true
			}
			if !visited[id] {
				visited[id] = true
				batch = append(batch, id)
			}
		}
		if len(batch) == 0 {
			break
		}
		var next []uint
		database.DB.Table("task_dependencies").Where("task_id IN ?", batch).Pluck("depends_on_id", &next)
		frontier = next
	}
	return false
}

// existingDependencyIDs returns the ids a task currently depends on.
func existingDependencyIDs(taskID uint) map[uint]bool {
	var ids []uint
	database.DB.Table("task_dependencies").Where("task_id = ?", taskID).Pluck("depends_on_id", &ids)
	out := make(map[uint]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	return out
}

// dependencyRefs cuts preloaded dependencies down to reference fields. Tasks
// the viewer can't access keep only their id and number. `cache` remembers
// access answers across one response (pass nil for a single task).
func dependencyRefs(c *gin.Context, deps []models.Task, cache map[uint]bool) []models.Task {
	if len(deps) == 0 {
		return deps
	}
	everything := viewerFrom(c).seesEverything()
	out := make([]models.Task, 0, len(deps))
	for i := range deps {
		d := &deps[i]
		visible := everything
		if !visible {
			if v, ok := cache[d.ID]; ok {
				visible = v
			} else {
				visible = userCanAccessTask(c, d)
				if cache != nil {
					cache[d.ID] = visible
				}
			}
		}
		var ref models.Task
		ref.ID = d.ID
		ref.TaskNumber = d.TaskNumber
		if visible {
			ref.Title = d.Title
			ref.Status = d.Status
		} else {
			ref.Title = "Restricted task"
			ref.AccessLevel = "restricted"
		}
		out = append(out, ref)
	}
	return out
}
