package handlers

import (
	"errors"
	"log"
	"net/http"
	"strings"

	"task-ticket-backend/internal/database"
	"task-ticket-backend/internal/middleware"
	"task-ticket-backend/internal/models"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

// Allowed role values. Kept as a single source of truth here so Register
// can reject typos/garbage roles up front rather than silently creating a
// user whose role string matches nothing in the permission system.
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

// Password is intentionally NOT binding:"required" here. Gin's validator
// treats an empty string as failing "required", which would short-circuit
// with a 400 (Bad Request) from ShouldBindJSON before Login's own logic
// ever runs — but the spec calls for 401 (Unauthorized) on an empty
// password, same as any other invalid credential. So the empty-string
// case is checked explicitly, below, and answered with 401 like every
// other wrong-credential path.
type LoginInput struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password"`
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

// authenticateUser looks up a user by email and verifies the password —
// shared by Login and AdminLogin so the actual credential-checking logic
// (and its "one generic error for every failure mode" discipline) exists
// in exactly one place rather than being duplicated and risking drift.
func authenticateUser(email, password string) (*models.User, error) {
	if strings.TrimSpace(password) == "" {
		return nil, errors.New("invalid credentials")
	}

	var user models.User
	if result := database.DB.Where("email = ?", email).First(&user); result.Error != nil {
		return nil, errors.New("invalid credentials")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(password)); err != nil {
		return nil, errors.New("invalid credentials")
	}

	return &user, nil
}

// Login user. Every invalid-credential path — unknown email, empty
// password, wrong password — returns the SAME 401 with the SAME generic
// message. Deliberately not distinguishing "email not found" from "wrong
// password" in the response prevents user enumeration.
//
// On success, issues a signed JWT (see middleware.GenerateToken) rather
// than just returning user data. Every protected route now requires this
// token via AuthenticateJWT — the frontend must attach it as
// "Authorization: Bearer <token>" on every subsequent request.
func Login(c *gin.Context) {
	var input LoginInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, err := authenticateUser(input.Email, input.Password)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		return
	}

	token, genErr := middleware.GenerateToken(user.ID, user.Role)
	if genErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate session token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Login successful",
		"token":   token,
		"user": gin.H{
			"id":    user.ID,
			"name":  user.Name,
			"email": user.Email,
			"role":  user.Role,
		},
	})
}

// AdminLogin is the dedicated Super Admin portal's login endpoint (POST
// /api/auth/admin-login) — a genuinely separate entry point, not just the
// regular Login with a different label. It reuses the exact same
// credential verification as Login (authenticateUser), with one
// additional gate: the account must actually be super_admin.
//
// A correct password for a real, non-super-admin account gets the EXACT
// SAME generic "invalid username or password" response as a wrong
// password would on an unknown email — this portal never reveals whether
// an email exists or what role it holds to anyone probing it. Without
// that, a subtly different error message ("wrong password" vs "not
// authorized") would let someone fish for which accounts are Super
// Admins just by trying emails here.
func AdminLogin(c *gin.Context) {
	var input LoginInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, err := authenticateUser(input.Email, input.Password)
	if err != nil || user.Role != "super_admin" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid username or password"})
		return
	}

	token, genErr := middleware.GenerateToken(user.ID, user.Role)
	if genErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate session token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Login successful",
		"token":   token,
		"user": gin.H{
			"id":    user.ID,
			"name":  user.Name,
			"email": user.Email,
			"role":  user.Role,
		},
	})
}

// GetUsers fetches users with cross-database search filtering.
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

// SeedDemoUsers creates the full demo org chart if it doesn't already
// exist. Call ONCE at application startup — see main.go.
//
// This replaces an earlier 6-person list that didn't match the intended
// org structure at all: it included a "Jonathan Davis" as an internal
// Admin, when Jonathan Davis was only ever meant to be an external ticket
// requester, never a system user — and it assigned Marcus Sterling and
// Liam Chen roles that didn't match their actual positions (Marcus is VP
// of Engineering / admin, not staff; Liam is Customer Success staff, not
// supervisor). That mismatch is exactly what caused a real admin's role
// to get silently overwritten during the merge era — now that this
// seeder is the ONLY source of truth (no more frontend seed data to
// collide with), it needs to be correct outright.
//
// Users are created in dependency order — Admins first, then Supervisors
// (referencing their Admin's id), then Staff (referencing both) — since
// SupervisorID/AdminID are real foreign keys that need the referenced
// row to already have an id.
func SeedDemoUsers() {
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte("password123"), bcrypt.DefaultCost)
	if err != nil {
		return
	}

	getOrCreate := func(u models.User) models.User {
		var existing models.User
		if err := database.DB.Where("LOWER(email) = LOWER(?)", u.Email).First(&existing).Error; err == nil {
			return existing
		}
		u.Password = string(hashedPassword)
		u.Status = "active"
		if err := database.DB.Create(&u).Error; err != nil {
			// Log and return whatever we have (ID stays 0) rather than
			// silently pretending this succeeded. A caller further down
			// this function that takes &u.ID for a SupervisorID/AdminID
			// will get a visibly-broken 0 reference instead of this
			// failure disappearing without a trace and cascading into a
			// second, harder-to-diagnose FK violation on some other user.
			log.Printf("Failed to seed user %s: %v\n", u.Email, err)
		}
		return u
	}

	getOrCreate(models.User{
		Name: "Eleanor Vance", Email: "eleanor.vance@apexcore.io", Role: "super_admin",
		Department: "Operations", Title: "Chief Operating Officer & Super Admin", Phone: "+1 (555) 019-2834",
		Avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
	})

	marcus := getOrCreate(models.User{
		Name: "Marcus Sterling", Email: "marcus.sterling@apexcore.io", Role: "admin",
		Department: "Engineering", Title: "VP of Engineering", Phone: "+1 (555) 014-9921",
		Avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
	})

	sarah := getOrCreate(models.User{
		Name: "Sarah Jenkins", Email: "sarah.jenkins@apexcore.io", Role: "admin",
		Department: "Customer Success", Title: "Head of Customer Success", Phone: "+1 (555) 018-4422",
		Avatar: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80",
	})

	david := getOrCreate(models.User{
		Name: "David Kim", Email: "david.kim@apexcore.io", Role: "supervisor",
		Department: "Engineering", Title: "Lead Architect & Tech Supervisor", Phone: "+1 (555) 016-7731",
		Avatar:  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80",
		AdminID: &marcus.ID,
	})

	elena := getOrCreate(models.User{
		Name: "Elena Rostova", Email: "elena.rostova@apexcore.io", Role: "supervisor",
		Department: "Customer Success", Title: "Support Operations Supervisor", Phone: "+1 (555) 012-3390",
		Avatar:  "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80",
		AdminID: &sarah.ID,
	})

	getOrCreate(models.User{
		Name: "Alex Rivera", Email: "alex.rivera@apexcore.io", Role: "staff",
		Department: "Engineering", Title: "Senior Frontend Engineer", Phone: "+1 (555) 011-8822",
		Avatar:       "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150&auto=format&fit=crop&q=80",
		SupervisorID: &david.ID, AdminID: &marcus.ID,
	})

	getOrCreate(models.User{
		Name: "Chloe Bennett", Email: "chloe.bennett@apexcore.io", Role: "staff",
		Department: "Engineering", Title: "Distributed Systems Engineer", Phone: "+1 (555) 015-1100",
		Avatar:       "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80",
		SupervisorID: &david.ID, AdminID: &marcus.ID,
	})

	getOrCreate(models.User{
		Name: "Liam Chen", Email: "liam.chen@apexcore.io", Role: "staff",
		Department: "Customer Success", Title: "Tier 2 Technical Support Specialist", Phone: "+1 (555) 017-9944",
		Avatar:       "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80",
		SupervisorID: &elena.ID, AdminID: &sarah.ID,
	})

	getOrCreate(models.User{
		Name: "Maya Patel", Email: "maya.patel@apexcore.io", Role: "staff",
		Department: "Customer Success", Title: "SLA Escalation Specialist", Phone: "+1 (555) 013-6622",
		Avatar:       "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80",
		SupervisorID: &elena.ID, AdminID: &sarah.ID,
	})
}
