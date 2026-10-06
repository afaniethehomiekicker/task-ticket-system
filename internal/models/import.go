package models

import (
	"fmt"
	"time"

	"gorm.io/gorm"
)

// ImportBatch is one spreadsheet import of clients or vendors. Every record
// it created points back to it (Client.ImportBatchID / Vendor.ImportBatchID),
// so an import can always be traced — who ran it, when, from which file —
// and found again as a group.
//
// IdempotencyKey makes a commit safe to retry: the browser sends the same key
// again if the connection drops before the answer arrives, and the server
// returns the stored Result instead of importing the rows a second time.
type ImportBatch struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	CreatedAt      time.Time `json:"created_at"`
	EntityType     string    `gorm:"size:20;not null;index" json:"entity_type"` // client | vendor
	CreatedByID    uint      `gorm:"not null;uniqueIndex:uniq_import_batch_key,priority:1" json:"created_by_id"`
	IdempotencyKey string    `gorm:"size:64;not null;uniqueIndex:uniq_import_batch_key,priority:2" json:"-"`
	FileName       string    `gorm:"size:255" json:"file_name"`
	TotalRows      int       `json:"total_rows"`
	CreatedCount   int       `json:"created_count"`
	SkippedCount   int       `json:"skipped_count"`
	// The full response sent for this import (per-row results), replayed
	// when the same key is sent again.
	Result string `gorm:"type:jsonb;not null;default:'{}'" json:"-"`
}

// NextIDRange reserves n consecutive permanent IDs for a prefix in one
// statement and returns the first number. Used inside the import transaction:
// if the import rolls back, so does the counter, so no numbers are lost.
func NextIDRange(tx *gorm.DB, prefix string, n int) (int64, error) {
	if n <= 0 {
		return 0, fmt.Errorf("NextIDRange: n must be positive, got %d", n)
	}
	var last int64
	err := tx.Raw(`INSERT INTO id_counters (prefix, last) VALUES (?, ?)
		ON CONFLICT (prefix) DO UPDATE SET last = id_counters.last + EXCLUDED.last
		RETURNING last`, prefix, n).Scan(&last).Error
	if err != nil {
		return 0, err
	}
	return last - int64(n) + 1, nil
}

// FormatID renders a permanent ID the same way NextID does, e.g. CL-000042.
func FormatID(prefix string, n int64) string {
	return fmt.Sprintf("%s-%06d", prefix, n)
}
