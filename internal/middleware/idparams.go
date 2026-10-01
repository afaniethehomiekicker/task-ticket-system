package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// NumericIDParams rejects any request whose ID path parameters (":id",
// ":userId", ":vendorId", ":subtaskId", ":depId", ... — any name that is "id"
// or ends in "Id"/"ID") are not plain positive integers.
//
// Why this matters: the handlers look records up with
// database.DB.First(&row, c.Param("id")). When GORM is handed a STRING that
// is not a number, it does not treat it as a primary key — it pastes it into
// the query as a raw WHERE condition. So a request such as
//
//	GET /api/tasks/1%20AND%20(SELECT%20...)
//
// ran attacker-written SQL (blind SQL injection, enough to read password
// hashes out of the users table one character at a time). Checking every ID
// here, once, closes all ~80 of those call sites without touching them, and
// covers any route added later as long as it sits under /api.
//
// String parameters such as ":key" and ":permissionKey" (role keys) are left
// alone; their handlers already use them only as bound "?" arguments.
func NumericIDParams() gin.HandlerFunc {
	return func(c *gin.Context) {
		for _, p := range c.Params {
			if !isIDParamName(p.Key) {
				continue
			}
			if !isPositiveInt(p.Value) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid id"})
				c.Abort()
				return
			}
		}
		c.Next()
	}
}

func isIDParamName(name string) bool {
	return name == "id" || strings.HasSuffix(name, "Id") || strings.HasSuffix(name, "ID")
}

// isPositiveInt: 1-18 ASCII digits, no leading zero. 18 digits stays inside
// int64/uint64, so nothing downstream can overflow.
func isPositiveInt(s string) bool {
	if len(s) == 0 || len(s) > 18 || s[0] == '0' {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}
