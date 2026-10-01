package handlers

import (
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/middleware"
	"task-ticket-backend/internal/models"
	"task-ticket-backend/internal/utils"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

var allowedRoles = map[string]bool{
	"super_admin": true,
	"admin":       true,
	"supervisor":  true,
	"staff":       true,
}

type AuthInput struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

type RegisterInput struct {
	Name         string `json:"name" binding:"required"`
	Email        string `json:"email" binding:"required,email"`
	Password     string `json:"password" binding:"required,min=8"`
	Role         string `json:"role" binding:"required"`
	Department   string `json:"department"`
	Title        string `json:"title"`
	Phone        string `json:"phone"`
	ManagerID    *uint  `json:"manager_id"`
	SupervisorID *uint  `json:"supervisor_id"`
}

type UpdateProfileInput struct {
	Name       string  `json:"name"`
	Phone      string  `json:"phone"`
	Title      string  `json:"title"`
	Department string  `json:"department"` // accepted but deliberately ignored: users can't move themselves between departments
	Avatar     *string `json:"avatar"`     // URL returned by POST /api/upload; "" clears it
}

type ChangePasswordInput struct {
	OldPassword string `json:"old_password" binding:"required"`
	NewPassword string `json:"new_password" binding:"required,min=8"`
}

// Register creates a new user
func Register(c *gin.Context) {
	var input RegisterInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	user := models.User{
		Name:       input.Name,
		Email:      input.Email,
		Password:   string(hashedPassword),
		Department: input.Department,
		Role:       "staff", // default role
		Status:     "active",
	}

	if err := database.DB.Create(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Email already exists or failed to create user"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "User registered successfully"})
}

// Login authenticates a user and returns a JWT
// dummyPasswordHash is compared against when a login names an unknown email
// (see Login).
var dummyPasswordHash, _ = bcrypt.GenerateFromPassword([]byte("not-a-real-password"), bcrypt.DefaultCost)

func Login(c *gin.Context) {
	var input AuthInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var user models.User
	if err := database.DB.Where("email = ?", input.Email).First(&user).Error; err != nil {
		// Spend the same time as a wrong password, so response timing
		// doesn't reveal which emails have accounts.
		bcrypt.CompareHashAndPassword(dummyPasswordHash, []byte(input.Password))
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(input.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		return
	}

	if user.Status != "active" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Account is disabled"})
		return
	}

	token, err := middleware.GenerateToken(&user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"token": token, "user": user})
}

// AdminLogin specifically logs in administrators.
//
// Two fixes applied here, stacked on top of each other:
//
//  1. Password is now verified BEFORE the role check, and both failure
//     paths return the exact same generic error. Previously the role
//     check ran first and returned a distinguishable message ("Admin
//     access required") before the password was ever checked — meaning
//     anyone could submit a real email with a garbage password and learn,
//     from the response alone, whether that account exists AND whether
//     it's admin-tier, with no valid password required. That's a
//     role-enumeration oracle through the login form itself.
//
//  2. Status is now checked at all. This function never looked at
//     user.Status previously — a deactivated Super Admin account could
//     still log in here and receive a fully valid token, even though the
//     regular Login handler above already correctly blocks this. The
//     Status check runs AFTER password verification succeeds, not
//     before — revealing "this account is disabled" only to someone who
//     has already proven they know the real password keeps this from
//     being a second oracle (a wrong-password guess never learns whether
//     the account is merely disabled vs. nonexistent vs. wrong-tier).
func AdminLogin(c *gin.Context) {
	var input AuthInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var user models.User
	if err := database.DB.Where("email = ?", input.Email).First(&user).Error; err != nil {
		// Same generic error as a wrong password below — don't reveal
		// whether this email exists at all.
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(input.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	// Password is correct from here on — safe to be specific.
	if user.Status != "active" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Account is disabled"})
		return
	}

	if user.Role != "super_admin" && user.Role != "admin" {
		// Deliberately the SAME message and status as a wrong password
		// above, not "Admin access required" — otherwise this branch
		// alone would tell a valid-password holder of a non-admin
		// account that their credentials were correct but their tier
		// wasn't, which is exactly the enumeration this rewrite closes.
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	token, err := middleware.GenerateToken(&user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"token": token, "user": user})
}

// GetCurrentUser returns the profile of the logged-in user
func GetCurrentUser(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var user models.User
	if err := database.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"user": user})
}

// UpdateCurrentUser updates the logged-in user's profile
func UpdateCurrentUser(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var input UpdateProfileInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if input.Avatar != nil && !validAvatarURL(*input.Avatar) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid avatar URL"})
		return
	}

	var user models.User
	if err := database.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	if input.Name != "" {
		user.Name = input.Name
	}
	if input.Phone != "" {
		user.Phone = input.Phone
	}
	if input.Title != "" {
		user.Title = input.Title
	}

	database.DB.Save(&user)

	// Avatar is written by column name because models.User wasn't visible
	// when this was added; the column is checked rather than assumed.
	if input.Avatar != nil {
		if !userHasAvatarColumn() {
			c.JSON(http.StatusInternalServerError, gin.H{"error": errNoAvatarColumn.Error()})
			return
		}
		if err := database.DB.Model(&models.User{}).Where("id = ?", userID).Update("avatar", *input.Avatar).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update avatar"})
			return
		}
		database.DB.First(&user, userID)
	}

	c.JSON(http.StatusOK, gin.H{"message": "Profile updated successfully", "user": user})
}

// ChangePassword allows the logged-in user to change their password
func ChangePassword(c *gin.Context) {
	userID, _ := c.Get("user_id")

	var input ChangePasswordInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var user models.User
	if err := database.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(input.OldPassword)); err != nil {
		// 400, not 401: a 401 means "your session is no longer valid" and
		// makes the app sign the user out.
		c.JSON(http.StatusBadRequest, gin.H{"error": "Your current password is incorrect"})
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(input.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to change password"})
		return
	}
	// Changing the password ends every other session (stolen or forgotten
	// logins stop working at once); this one continues with a fresh token.
	// Microsecond precision, the same the database stores, so the fresh
	// token below matches what the next request reads back.
	changedAt := time.Now().Truncate(time.Microsecond)
	user.PasswordChangedAt = &changedAt
	if err := database.DB.Model(&user).Updates(map[string]interface{}{
		"password":            string(hashedPassword),
		"password_changed_at": changedAt,
	}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to change password"})
		return
	}
	utils.LogAudit(user.ID, "password_changed", "user", user.ID, "Changed own password", c.ClientIP(), c.Request.UserAgent())

	token, err := middleware.GenerateToken(&user)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "Password changed. Please sign in again."})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Password changed successfully", "token": token})
}

// GetUsers fetches users with cross-database search filtering.
func GetUsers(c *gin.Context) {
	searchQuery := strings.TrimSpace(c.Query("search"))
	var users []models.User

	// The app loads this list once at startup with no query string, and every
	// user picker and the current-user lookup depend on it being complete. It
	// used to be capped at 20 unordered rows for BOTH that call and the
	// search-as-you-type call, so with more than 20 users some accounts were
	// silently missing. Typeahead keeps its small cap; the full list doesn't.
	db := database.DB.Order("id ASC")
	// ?status=archived for the Archive page; otherwise archived accounts are
	// left out (they're gone from the Team list but their names still
	// resolve through the directory).
	if st := strings.TrimSpace(c.Query("status")); st != "" {
		db = db.Where("status = ?", st)
	} else {
		db = db.Where("status <> ?", "archived")
	}
	// Department admins manage (and so list) only their own department's
	// accounts — same rule as middleware.ScopeUserManagement. The people
	// directory used by pickers is separate (directory.go).
	if v := viewerFrom(c); !v.seesEverything() {
		db = db.Where("LOWER(TRIM(department)) = LOWER(?)", v.Dept)
	}
	limit := 1000
	if searchQuery != "" {
		likeQuery := "%" + strings.ToLower(searchQuery) + "%"
		db = db.Where("LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(role) LIKE ?", likeQuery, likeQuery, likeQuery)
		limit = 20
	}

	if result := db.Limit(limit).Find(&users); result.Error != nil {
		serverError(c, "Something went wrong. Please try again.", result.Error)
		return
	}

	c.JSON(http.StatusOK, gin.H{"users": users})
}

func GetUser(c *gin.Context) {
	id := c.Param("id")
	var user models.User
	if err := database.DB.First(&user, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": user})
}

// callerMayManage reports whether the caller may create, promote, edit,
// deactivate or delete an account with the given role. Only a super_admin may
// touch super_admin accounts — otherwise anyone holding manage_users could
// promote themselves (or anyone else) to super_admin, or delete/disable the
// real super admins.
func callerMayManage(c *gin.Context, targetRole string) bool {
	if targetRole != "super_admin" {
		return true
	}
	roleVal, _ := c.Get("user_role")
	role, _ := roleVal.(string)
	return role == "super_admin"
}

// AdminCreateUser creates a new user (admin only).
//
// Was binding RegisterInput, the SAME struct /auth/register uses for public
// self-signup — whose Password field is `binding:"required,min=8"`. That's
// why "Add New Team Member" (which has no password field at all) always
// failed with "Field validation for 'Password' failed on the 'required'
// tag": there was no way to satisfy that requirement from this form.
//
// AdminCreateUserInput (optional Password) and generateTempPassword() —
// both already written, in user.go — were sitting unused right next to this
// bug, and the frontend (AppContext.jsx's createUser, TeamView.jsx's
// tempPasswordBanner) already expects exactly this flow: submit with no
// password, get one generated and shown back once. This wires the three
// pieces together instead of inventing a new design.
func AdminCreateUser(c *gin.Context) {
	var input AdminCreateUserInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if !roleIsValid(input.Role) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid role"})
		return
	}
	if !callerMayManage(c, input.Role) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only a super admin can create super admin accounts"})
		return
	}
	// Same avatar rule as every edit path. Creating accepted any URL, and the
	// user could then never be edited again: AdminUpdateUser rejected the
	// avatar the record already had.
	if !validAvatarURL(input.Avatar) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid avatar URL"})
		return
	}
	if !departmentIsKnown(input.Department) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unknown department"})
		return
	}
	setAdmin, adminVal, msg := resolveHierarchyLink(input.AdminID, 0, adminLinkRoles, "admin")
	if msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	setSup, supVal, msg := resolveHierarchyLink(input.SupervisorID, 0, supervisorLinkRoles, "supervisor")
	if msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	tier, msg := normalizeSupportTier(input.SupportTier, input.Department)
	if msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}

	plainPassword := input.Password
	generated := false
	if plainPassword == "" {
		var err error
		plainPassword, err = generateTempPassword()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate a temporary password"})
			return
		}
		generated = true
	} else if len(plainPassword) < 8 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Password must be at least 8 characters"})
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(plainPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	// Only the fields already proven to exist on this struct (the same set
	// the previous version of this function used successfully) go in the
	// literal. Avatar and SupervisorID are set just below via a map-based
	// Updates() call instead — the same technique UpdateUserProfile
	// (user.go) already uses for these two exact fields — so this doesn't
	// depend on guessing this project's exact Go struct field names.
	user := models.User{
		Name:       input.Name,
		Email:      input.Email,
		Password:   string(hashedPassword),
		Role:       input.Role,
		Department: input.Department,
		Title:      input.Title,
		Phone:       input.Phone,
		SupportTier: tier,
		Status:      "active",
	}

	if result := database.DB.Create(&user); result.Error != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Email already exists or invalid data"})
		return
	}

	extra := map[string]interface{}{}
	if input.Avatar != "" {
		extra["avatar"] = input.Avatar
	}
	// The Admin link lives in manager_id (see resolveHierarchyLink).
	if setAdmin && adminVal != nil {
		extra["manager_id"] = adminVal
	}
	if setSup && supVal != nil {
		extra["supervisor_id"] = supVal
	}
	if len(extra) > 0 {
		if err := database.DB.Model(&user).Updates(extra).Error; err != nil {
			log.Printf("users: created %s but failed to set avatar/reporting lines: %v", user.Email, err)
		}
		database.DB.First(&user, user.ID)
	}

	callerIDVal, _ := c.Get("user_id")
	callerID, _ := callerIDVal.(uint)
	utils.LogAudit(callerID, "created", "user", user.ID,
		fmt.Sprintf("Created user %s with role %s", user.Email, user.Role), c.ClientIP(), c.Request.UserAgent())

	response := gin.H{"message": "User created successfully", "user": user}
	// Only ever returned ONCE, on creation — never stored in plain text, and
	// never returned by any other endpoint. If the admin loses it, they use
	// AdminUpdateUser to set a new one, same as any forgotten password.
	if generated {
		response["temporary_password"] = plainPassword
	}
	c.JSON(http.StatusCreated, response)
}

// AdminUpdateUser updates a user (admin only)
func AdminUpdateUser(c *gin.Context) {
	id := c.Param("id")

	var input struct {
		Name         string  `json:"name"`
		Email        string  `json:"email"`
		Role         string  `json:"role"`
		Department   string  `json:"department"`
		Title        string  `json:"title"`
		Phone        string  `json:"phone"`
		Status       string  `json:"status"`
		// The user's Admin. Stored in manager_id; "admin_id" is what the
		// frontend sends, "manager_id" is accepted too. 0 clears it.
		AdminID      *uint   `json:"admin_id"`
		ManagerID    *uint   `json:"manager_id"`
		SupervisorID *uint   `json:"supervisor_id"` // 0 clears it
		Password     string  `json:"password"`      // admin reset; min 6 like every other password path
		Avatar       *string `json:"avatar"`
		SupportTier  *string `json:"support_tier"` // L1..L4, "" clears; CNOC only
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if input.Role != "" && !roleIsValid(input.Role) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid role"})
		return
	}
	if input.Avatar != nil && !validAvatarURL(*input.Avatar) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid avatar URL"})
		return
	}
	if input.Password != "" && len(input.Password) < 8 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Password must be at least 8 characters"})
		return
	}

	var target models.User
	if err := database.DB.First(&target, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}
	if !callerMayManage(c, target.Role) || !callerMayManage(c, input.Role) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only a super admin can manage super admin accounts"})
		return
	}

	// Same guards as UpdateUserRole, so this endpoint isn't a way around them.
	if code, msg := roleChangeError(c, target, input.Role); code != 0 {
		c.JSON(code, gin.H{"error": msg})
		return
	}
	if input.Status != "" && !validUserStatuses[input.Status] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid status (use active or inactive)"})
		return
	}
	// Same guard ToggleUserStatus has — this endpoint let you lock yourself out.
	if input.Status == "inactive" && callerID(c) == target.ID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "You can't deactivate your own account"})
		return
	}
	// Only a CHANGED department is checked against the managed list. Checking
	// it unconditionally made every edit of a user whose existing department
	// isn't in the list (e.g. the seeded super admin's "Management") fail,
	// even when the department wasn't being touched.
	if input.Department != "" && !strings.EqualFold(strings.TrimSpace(input.Department), strings.TrimSpace(target.Department)) &&
		!departmentIsKnown(input.Department) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unknown department"})
		return
	}
	adminIn := input.AdminID
	if adminIn == nil {
		adminIn = input.ManagerID
	}
	setAdmin, adminVal, msg := resolveHierarchyLink(adminIn, target.ID, adminLinkRoles, "admin")
	if msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	setSup, supVal, msg := resolveHierarchyLink(input.SupervisorID, target.ID, supervisorLinkRoles, "supervisor")
	if msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}

	// Tier follows the department the user will be in after this edit. Moving
	// someone out of CNOC clears their tier.
	finalDept := target.Department
	if input.Department != "" {
		finalDept = input.Department
	}
	tierSet := false
	var tierVal string
	if input.SupportTier != nil {
		t, msg := normalizeSupportTier(*input.SupportTier, finalDept)
		if msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}
		tierSet, tierVal = true, t
	} else if !isSupportDepartment(finalDept) && target.SupportTier != "" {
		tierSet, tierVal = true, ""
	}

	updates := map[string]interface{}{}
	if tierSet {
		updates["support_tier"] = tierVal
	}
	if input.Name != "" {
		updates["name"] = input.Name
	}
	if input.Email != "" {
		updates["email"] = input.Email
	}
	if input.Role != "" {
		updates["role"] = input.Role
	}
	if input.Department != "" {
		updates["department"] = input.Department
	}
	if input.Title != "" {
		updates["title"] = input.Title
	}
	if input.Phone != "" {
		updates["phone"] = input.Phone
	}
	if input.Status != "" {
		updates["status"] = input.Status
	}
	if setAdmin {
		updates["manager_id"] = adminVal // nil clears it
	}
	if setSup {
		updates["supervisor_id"] = supVal // nil clears it
	}
	if input.Password != "" {
		hashed, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
			return
		}
		updates["password"] = string(hashed)
		// An admin reset signs the user out everywhere (see AuthenticateJWT).
		updates["password_changed_at"] = time.Now().Truncate(time.Microsecond)
	}
	if input.Avatar != nil {
		if !userHasAvatarColumn() {
			c.JSON(http.StatusInternalServerError, gin.H{"error": errNoAvatarColumn.Error()})
			return
		}
		updates["avatar"] = *input.Avatar
	}

	if len(updates) > 0 {
		if err := database.DB.Model(&models.User{}).Where("id = ?", id).Updates(updates).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update user"})
			return
		}

		// Log which fields changed, never their values (a password hash or
		// email has no business in the audit trail), plus old -> new role.
		changed := make([]string, 0, len(updates))
		for k := range updates {
			changed = append(changed, k)
		}
		details := fmt.Sprintf("Updated user %s: fields %s", target.Email, strings.Join(changed, ", "))
		if input.Role != "" && input.Role != target.Role {
			details += fmt.Sprintf(" (role %s -> %s)", target.Role, input.Role)
		}
		callerIDVal, _ := c.Get("user_id")
		callerID, _ := callerIDVal.(uint)
		utils.LogAudit(callerID, "updated", "user", target.ID, details, c.ClientIP(), c.Request.UserAgent())
	}

	var user models.User
	database.DB.First(&user, id)
	c.JSON(http.StatusOK, gin.H{"user": user})
}

// AdminDeleteUser deletes a user (admin only)
func AdminDeleteUser(c *gin.Context) {
	id := c.Param("id")

	// Prevent self-deletion
	userIDVal, _ := c.Get("user_id")
	currentUserID := userIDVal.(uint)

	// Parse the ID to check for self-deletion
	var targetID uint
	if _, err := fmt.Sscanf(id, "%d", &targetID); err == nil {
		if currentUserID == targetID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot delete yourself"})
			return
		}
	}

	var target models.User
	if err := database.DB.First(&target, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}
	if !callerMayManage(c, target.Role) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only a super admin can delete super admin accounts"})
		return
	}

	if err := database.DB.Delete(&models.User{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete user"})
		return
	}

	utils.LogAudit(currentUserID, "deleted", "user", target.ID,
		fmt.Sprintf("Deleted user %s (%s)", target.Email, target.Role), c.ClientIP(), c.Request.UserAgent())

	c.JSON(http.StatusOK, gin.H{"message": "User deleted successfully"})
}

// ToggleUserStatus toggles a user's active/inactive status (admin only)
func ToggleUserStatus(c *gin.Context) {
	id := c.Param("id")

	var user models.User
	if err := database.DB.First(&user, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	callerIDVal, _ := c.Get("user_id")
	callerID, _ := callerIDVal.(uint)
	if callerID == user.ID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "You can't change your own status"})
		return
	}
	if !callerMayManage(c, user.Role) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only a super admin can change a super admin's status"})
		return
	}

	oldStatus := user.Status
	newStatus := "inactive"
	if user.Status == "inactive" {
		newStatus = "active"
	}

	if err := database.DB.Model(&user).Update("status", newStatus).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update status"})
		return
	}

	utils.LogAuditWithValues(callerID, "status_changed", "user", user.ID,
		statusChange(oldStatus), statusChange(newStatus),
		fmt.Sprintf("User %s status changed from %s to %s", user.Email, oldStatus, newStatus), c.ClientIP(), c.Request.UserAgent())

	user.Status = newStatus
	c.JSON(http.StatusOK, gin.H{"user": user})
}

// UpdateUserRole updates a user's role (admin only)
func UpdateUserRole(c *gin.Context) {
	id := c.Param("id")

	var input struct {
		Role string `json:"role" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if !roleIsValid(input.Role) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid role"})
		return
	}

	var target models.User
	if err := database.DB.First(&target, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}
	if !callerMayManage(c, target.Role) || !callerMayManage(c, input.Role) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only a super admin can assign or change the super admin role"})
		return
	}
	if code, msg := roleChangeError(c, target, input.Role); code != 0 {
		c.JSON(code, gin.H{"error": msg})
		return
	}
	oldRole := target.Role

	if err := database.DB.Model(&models.User{}).Where("id = ?", id).Update("role", input.Role).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update role"})
		return
	}

	callerIDVal, _ := c.Get("user_id")
	callerID, _ := callerIDVal.(uint)
	utils.LogAuditWithValues(callerID, "role_changed", "user", target.ID,
		map[string]string{"role": oldRole}, map[string]string{"role": input.Role},
		fmt.Sprintf("User %s role changed from %s to %s", target.Email, oldRole, input.Role), c.ClientIP(), c.Request.UserAgent())

	var user models.User
	database.DB.First(&user, id)
	c.JSON(http.StatusOK, gin.H{"user": user})
}

// GlobalSearch searches across projects, tasks, and tickets, scoped to what the
// caller is allowed to see. It previously searched every department's records
// for anyone logged in, bypassing the whole department privacy model: a staff
// member could type a keyword and read the titles and descriptions of every
// project, task and ticket in the company. It now applies the same
// visibility rules as the list endpoints, and each result set is capped.
func GlobalSearch(c *gin.Context) {
	keyword := strings.TrimSpace(c.Query("q"))
	if keyword == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Query parameter 'q' is required"})
		return
	}
	if r := []rune(keyword); len(r) > 100 {
		keyword = string(r[:100])
	}

	searchPattern := "%" + strings.ToLower(keyword) + "%"

	v := viewerFrom(c)

	const perTypeLimit = 50

	var projects []models.Project
	var tasks []models.Task
	var tickets []models.Ticket

	projectQ := database.DB.Where("(LOWER(title) LIKE ? OR LOWER(description) LIKE ?)", searchPattern, searchPattern)
	// tasks.labels wasn't a column until models.Task gained the field; this
	// query used to reference it unconditionally, which made the whole tasks
	// search error out (and the error was ignored, so it returned no tasks).
	taskQ := database.DB.Where("(LOWER(title) LIKE ? OR LOWER(description) LIKE ?)", searchPattern, searchPattern)
	if taskHasColumn("labels") {
		taskQ = database.DB.Where("(LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(labels) LIKE ?)", searchPattern, searchPattern, searchPattern)
	}
	ticketQ := database.DB.Where("(LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(ticket_number) LIKE ?)", searchPattern, searchPattern, searchPattern)

	// Same visibility rules as the list endpoints (see visibility.go).
	projectQ = applyProjectScope(projectQ, v)
	taskQ = applyTaskScope(taskQ, v)
	ticketQ = applyTicketScope(ticketQ, v)

	if err := projectQ.Limit(perTypeLimit).Find(&projects).Error; err != nil {
		log.Printf("search: projects query failed: %v", err)
	}
	if err := taskQ.Limit(perTypeLimit).Find(&tasks).Error; err != nil {
		log.Printf("search: tasks query failed: %v", err)
	}
	if err := ticketQ.Limit(perTypeLimit).Find(&tickets).Error; err != nil {
		log.Printf("search: tickets query failed: %v", err)
	}

	c.JSON(http.StatusOK, gin.H{
		"projects": projects,
		"tasks":    tasks,
		"tickets":  tickets,
	})
}
