package handlers

import (
	"errors"
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
