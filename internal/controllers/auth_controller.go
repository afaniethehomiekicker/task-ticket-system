package controllers

import (
	"net/http"
	"os"

	"devissues/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type RegisterInput struct {
	Name         string `json:"name" binding:"required"`
	Username     string `json:"username" binding:"required"`
	Email        string `json:"email" binding:"required,email"`
	Password     string `json:"password" binding:"required,min=6"`
	Role         string `json:"role"`
	Technologies string `json:"technologies"`
}

func Register(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
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

		role := "Developer"
		if input.Role != "" {
			role = input.Role
		}

		user := models.User{
			Name:         input.Name,
			Username:     input.Username,
			Email:        input.Email,
			Password:     string(hashedPassword),
			Role:         role,
			Technologies: input.Technologies,
			Status:       "Active",
		}

		if result := db.Create(&user); result.Error != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Username or Email already exists"})
			return
		}

		c.JSON(http.StatusCreated, gin.H{
			"message": "User registered successfully!",
			"user": gin.H{
				"id":           user.ID,
				"name":         user.Name,
				"username":     user.Username,
				"email":        user.Email,
				"role":         user.Role,
				"technologies": user.Technologies,
			},
		})
	}
}

type LoginInput struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

func Login(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var input LoginInput

		// Validate incoming JSON
		if err := c.ShouldBindJSON(&input); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		var user models.User
		// Find user by email
		if result := db.Where("email = ?", input.Email).First(&user); result.Error != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
			return
		}

		// Check password match using bcrypt
		err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(input.Password))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
			return
		}

		// Generate JWT Token
		secret := os.Getenv("JWT_SECRET")
		if secret == "" {
			secret = "fallback_secret"
		}

		token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"user_id": user.ID,
			"email":   user.Email,
			"role":    user.Role,
		})

		tokenString, err := token.SignedString([]byte(secret))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
			return
		}

		// Return success response with the token
		c.JSON(http.StatusOK, gin.H{
			"message": "Login successful!",
			"token":   tokenString,
			"user": gin.H{
				"id":       user.ID,
				"name":     user.Name,
				"username": user.Username,
				"email":    user.Email,
				"role":     user.Role,
			},
		})
	}
}
