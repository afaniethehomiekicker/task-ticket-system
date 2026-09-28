package models

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
)

// JSONMap stores a flexible set of values in a Postgres jsonb column and
// serialises as a normal JSON object in API responses. Used for client custom
// fields (spec slide 8: additional client attributes, no schema change).
type JSONMap map[string]interface{}

func (m JSONMap) Value() (driver.Value, error) {
	if m == nil {
		return "{}", nil
	}
	b, err := json.Marshal(m)
	if err != nil {
		return nil, err
	}
	return string(b), nil
}

func (m *JSONMap) Scan(value interface{}) error {
	if value == nil {
		*m = JSONMap{}
		return nil
	}
	var b []byte
	switch v := value.(type) {
	case []byte:
		b = v
	case string:
		b = []byte(v)
	default:
		return errors.New("JSONMap: unsupported type")
	}
	if len(b) == 0 {
		*m = JSONMap{}
		return nil
	}
	out := JSONMap{}
	if err := json.Unmarshal(b, &out); err != nil {
		return err
	}
	*m = out
	return nil
}
