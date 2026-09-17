package handlers

import (
	"crypto/rand"
	"encoding/base64"
	"net/http"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

// AdminCreateUserInput is used by the admin-only "add a new member" flow —
// distinct from the public /auth/register endpoint, which has no way to
// set department/title/phone/avatar/hierarchy links, and isn't meant for
// one person to create an account on someone else's behalf in the first
// place (it's a public self-signup endpoint).
type AdminCreateUserInput struct {
	Name         string `json:"name" binding:"required"`
	Email        string `json:"email" binding:"required,email"`
	Password     string `json:"password"` // optional — a temp password is generated if omitted
	Role         string `json:"role" binding:"required"`
	Department   string `json:"department"`
	Title        string `json:"title"`
	Phone        string `json:"phone"`
	Avatar       string `json:"avatar"`
	SupervisorID *uint  `json:"supervisor_id"`
	AdminID      *uint  `json:"admin_id"`
}

func generateTempPassword() (string, error) {
	bytes := make([]byte, 9)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

// AdminCreateUser lets an Admin/Super Admin add a new team member directly,
// with role and hierarchy (Supervisor/Admin) links set at creation time —
// this is what actually fulfills "Admins can add new members and assign
// them to specific Supervisors/Admins." Restricted to adminGroup in
// routes.go (AuthenticateJWT + AuthorizeRole) — deliberately not built on
// top of the public /auth/register endpoint.
func AdminCreateUser(c *gin.Context) {
	var input AdminCreateUserInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if !allowedRoles[input.Role] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid role. Must be one of: super_admin, admin, supervisor, staff"})
		return
	}

	plainPassword := input.Password
	generatedPassword := false
	if plainPassword == "" {
		var err error
		plainPassword, err = generateTempPassword()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate a temporary password"})
			return
		}
		generatedPassword = true
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(plainPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	user := models.User{
		Name:         input.Name,
		Email:        input.Email,
		Password:     string(hashedPassword),
		Role:         input.Role,
		Department:   input.Department,
		Title:        input.Title,
		Phone:        input.Phone,
		Avatar:       input.Avatar,
		Status:       "active",
		SupervisorID: input.SupervisorID,
		AdminID:      input.AdminID,
	}

	if result := database.DB.Create(&user); result.Error != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Email already exists or invalid data"})
		return
	}

	response := gin.H{
		"message": "User created successfully",
		"user":    user,
	}
	// The plaintext temp password is returned ONLY this once, and only
	// when the admin didn't supply one — there is no way to retrieve it
	// again afterward (only the bcrypt hash is ever stored). The admin is
	// responsible for relaying it to the new hire out of band.
	if generatedPassword {
		response["temporary_password"] = plainPassword
	}

	c.JSON(http.StatusCreated, response)
}

// UpdateUserProfileInput covers every field either a self-edit or an
// admin edit might touch. Pointers, not plain values — so "field not
// present in the request" (nil) is distinguishable from "field present
// but explicitly empty." Role and Email are deliberately ABSENT from this
// struct entirely: this is "the ordinary profile endpoint" the docs
// describe, and role/email changes are kept out of it unconditionally,
// for anyone, admin included.
type UpdateUserProfileInput struct {
	Name         *string `json:"name"`
	Title        *string `json:"title"`
	Phone        *string `json:"phone"`
	Department   *string `json:"department"`
	Avatar       *string `json:"avatar"`
	Password     *string `json:"password"`
	SupervisorID *uint   `json:"supervisor_id"`
	AdminID      *uint   `json:"admin_id"`
	Status       *string `json:"status"`
}

// UpdateUserProfile is the "ordinary profile endpoint" — PUT /api/users/:id.
// Behavior depends on WHO is calling, determined from the verified JWT
// claims AuthenticateJWT already set on the context (c.Get("userID") /
// c.Get("userRole")) — never from anything the client claims about
// itself in the request body. That's the same principle rbac.go was
// fixed around earlier: authorization reads a verified value, not a
// client-supplied one.
//
//   - Editing your OWN record, and you're NOT Admin/Super Admin: only
//     Name/Title/Phone/Avatar/Password may change. Department,
//     SupervisorID, AdminID, and Status are silently ignored — those are
//     organizational facts a staff member doesn't get to self-assign.
//   - Editing someone ELSE'S record: requires Admin/Super Admin tier, and
//     adds Department/SupervisorID/AdminID/Status to what's allowed —
//     this is how an admin moves someone to a different supervisor after
//     the fact, not just at creation time.
//   - Role and Email are excluded from this struct entirely and cannot be
//     changed through this endpoint by anyone, admin included.
func UpdateUserProfile(c *gin.Context) {
	targetIDParam := c.Param("id")

	callerIDRaw, _ := c.Get("userID")
	callerRoleRaw, _ := c.Get("userRole")
	callerID, _ := callerIDRaw.(uint)
	callerRole, _ := callerRoleRaw.(string)

	var target models.User
	if err := database.DB.First(&target, targetIDParam).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	isSelf := callerID == target.ID
	isAdminTier := callerRole == "admin" || callerRole == "super_admin"

	if !isSelf && !isAdminTier {
		c.JSON(http.StatusForbidden, gin.H{"error": "You can only edit your own profile"})
		return
	}

	var input UpdateUserProfileInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]interface{}{}

	// Fields any authorized caller (self OR admin) may set.
	if input.Name != nil {
		updates["name"] = *input.Name
	}
	if input.Title != nil {
		updates["title"] = *input.Title
	}
	if input.Phone != nil {
		updates["phone"] = *input.Phone
	}
	if input.Avatar != nil {
		updates["avatar"] = *input.Avatar
	}
	if input.Password != nil && *input.Password != "" {
		hashed, err := bcrypt.GenerateFromPassword([]byte(*input.Password), bcrypt.DefaultCost)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
			return
		}
		updates["password"] = string(hashed)
	}

	// Fields ONLY an admin-tier caller may set — including when editing
	// their OWN record, since "I am an Admin editing myself" doesn't
	// change the sensitivity of these fields.
	if isAdminTier {
		if input.Department != nil {
			updates["department"] = *input.Department
		}
		if input.SupervisorID != nil {
			updates["supervisor_id"] = *input.SupervisorID
		}
		if input.AdminID != nil {
			updates["admin_id"] = *input.AdminID
		}
		if input.Status != nil {
			updates["status"] = *input.Status
		}
	}

	if len(updates) > 0 {
		database.DB.Model(&target).Updates(updates)
	}
	database.DB.First(&target, targetIDParam)

	c.JSON(http.StatusOK, gin.H{"message": "Profile updated successfully", "user": target})
}
