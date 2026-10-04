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

// StringList stores a list of strings in a Postgres jsonb column (always a
// JSON array, never null) and serialises as a normal JSON array. Used for a
// staff member's additional departments (User.ExtraDepartments).
type StringList []string

func (l StringList) Value() (driver.Value, error) {
	if l == nil {
		return "[]", nil
	}
	b, err := json.Marshal([]string(l))
	if err != nil {
		return nil, err
	}
	return string(b), nil
}

func (l *StringList) Scan(value interface{}) error {
	if value == nil {
		*l = StringList{}
		return nil
	}
	var b []byte
	switch v := value.(type) {
	case []byte:
		b = v
	case string:
		b = []byte(v)
	default:
		return errors.New("StringList: unsupported type")
	}
	if len(b) == 0 || string(b) == "null" {
		*l = StringList{}
		return nil
	}
	var out []string
	if err := json.Unmarshal(b, &out); err != nil {
		// Not an array (shouldn't happen — every write goes through Value):
		// treat as empty rather than failing every query that loads users.
		*l = StringList{}
		return nil
	}
	*l = StringList(out)
	return nil
}

// MarshalJSON always emits an array, so the frontend never sees null.
func (l StringList) MarshalJSON() ([]byte, error) {
	if l == nil {
		return []byte("[]"), nil
	}
	return json.Marshal([]string(l))
}
