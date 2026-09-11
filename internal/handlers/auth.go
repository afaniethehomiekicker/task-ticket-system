package handlers

import (
	"net/http"
	"strings"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

// Allowed role values. Kept as a single source of truth here so Register
// can reject typos/garbage roles up front rather than silently creating a
// user whose role string matches nothing in the permission system.
//
// NOTE: these are snake_case to match both the frontend's role checks
// (currentUser.role === 'super_admin', etc.) and SeedDemoUsers below.
// seed.go's SeedSuperAdmin currently seeds "Super Admin" (Title Case) and
// routes.go's middleware.AuthorizeRole("Super Admin", "Admin") checks
// against that same Title Case scheme — those two need to be updated to
// snake_case as well, or every demo/self-registered user with a
// snake_case role will silently fail admin-route authorization. Flagging
// rather than changing them here since I don't have middleware/authorize.go
// and don't want to guess its comparison logic.
var allowedRoles = map[string]bool{
	"super_admin": true,
	"admin":       true,
	"supervisor":  true,
	"staff":       true,
}

type RegisterInput struct {
	Name      string `json:"name" binding:"required"`
	Email     string `json:"email" binding:"required,email"`
	Password  string `json:"password" binding:"required,min=6"`
	Role      string `json:"role" binding:"required"` // super_admin, admin, supervisor, staff
	ManagerID *uint  `json:"manager_id"`
}

type LoginInput struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

// Register a new user with a specific role
func Register(c *gin.Context) {
	var input RegisterInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if !allowedRoles[input.Role] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid role. Must be one of: super_admin, admin, supervisor, staff"})
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	user := models.User{
		Name:      input.Name,
		Email:     input.Email,
		Password:  string(hashedPassword),
		Role:      input.Role,
		ManagerID: input.ManagerID,
	}

	if result := database.DB.Create(&user); result.Error != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Email already exists or invalid data"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "User registered successfully",
		"user_id": user.ID,
		"email":   user.Email,
		"role":    user.Role,
	})
}

// Login user
func Login(c *gin.Context) {
	var input LoginInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var user models.User
	if result := database.DB.Where("email = ?", input.Email).First(&user); result.Error != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(input.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Login successful",
		"user": gin.H{
			"id":    user.ID,
			"name":  user.Name,
			"email": user.Email,
			"role":  user.Role,
		},
	})
}

// GetUsers fetches users with cross-database search filtering.
//
// Seeding used to happen here (seedDemoUsers() was called on every
// request) — that's been removed. Seeding demo data has nothing to do
// with fetching users, and running a check-then-insert loop on every GET
// is both a performance anti-pattern and a genuine race condition: two
// concurrent requests can both see "user doesn't exist yet" before either
// INSERT commits, and both insert, producing real duplicate rows in the
// database (same email, different IDs) that no amount of frontend
// deduplication can fully paper over. See SeedDemoUsers below — call that
// once at application startup instead, the same way SeedSuperAdmin is
// already called in seed.go.
func GetUsers(c *gin.Context) {
	searchQuery := strings.TrimSpace(c.Query("search"))
	var users []models.User

	db := database.DB
	if searchQuery != "" {
		likeQuery := "%" + strings.ToLower(searchQuery) + "%"
		db = db.Where("LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(role) LIKE ?", likeQuery, likeQuery, likeQuery)
	}

	if result := db.Limit(20).Find(&users); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"users": users})
}

// SeedDemoUsers creates the fixed set of demo accounts if they don't
// already exist. Intended to be called ONCE at application startup
// (alongside database.SeedSuperAdmin()) — NOT from within a request
// handler. The existence check here is a courtesy for repeated dev
// restarts against a persistent database, not a substitute for a real
// uniqueness guarantee: add a unique index on User.Email at the model/DB
// level (e.g. a GORM `gorm:"uniqueIndex"` tag) so a duplicate INSERT is
// rejected outright even if two processes/replicas call this
// concurrently on a fresh database.
func SeedDemoUsers() {
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte("password123"), bcrypt.DefaultCost)
	if err != nil {
		return
	}

	demoUsers := []models.User{
		{Name: "Eleanor Vance", Email: "eleanor.vance@apexcore.io", Password: string(hashedPassword), Role: "super_admin"},
		{Name: "Jonathan Davis", Email: "jonathan.davis@apexcore.io", Password: string(hashedPassword), Role: "admin"},
		{Name: "Liam Chen", Email: "liam.chen@apexcore.io", Password: string(hashedPassword), Role: "supervisor"},
		{Name: "Marcus Sterling", Email: "marcus.sterling@apexcore.io", Password: string(hashedPassword), Role: "staff"},
		{Name: "Maya Patel", Email: "maya.patel@apexcore.io", Password: string(hashedPassword), Role: "staff"},
		{Name: "Alex Rivera", Email: "alex.rivera@apexcore.io", Password: string(hashedPassword), Role: "staff"},
	}

	for _, u := range demoUsers {
		var existing models.User
		if err := database.DB.Where("LOWER(email) = LOWER(?)", u.Email).First(&existing).Error; err != nil {
			database.DB.Create(&u)
		}
	}
}
