package handlers

import (
	"strings"
	"testing"
)

// Unit tests for the import helpers that don't need a database. The full
// import (dry run, commit, retries, concurrency) was tested end to end
// against PostgreSQL; see the notes in import.go.

func TestImportText(t *testing.T) {
	cases := map[string]string{
		"  Acme Ltd \n": "Acme Ltd",
		"nul\x00byte":   "nulbyte",
		"bad\xffutf8":   "badutf8",
		"پاک نیٹ ورکس":  "پاک نیٹ ورکس",
		"":              "",
	}
	for in, want := range cases {
		if got := importText(in); got != want {
			t.Errorf("importText(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestImportNameKey(t *testing.T) {
	if importNameKey("  ACME   Networks\tLtd ") != importNameKey("acme networks ltd") {
		t.Error("names differing only in case and spacing should match")
	}
	if importNameKey("Acme") == importNameKey("Acme Ltd") {
		t.Error("different names must not match")
	}
}

func TestCheckLengths(t *testing.T) {
	name, notes := "  Vendor  ", "ok"
	long := strings.Repeat("a", 151)
	probs := checkLengths([]fieldCheck{{&name, "Name", 150}, {&notes, "Notes", 10}})
	if len(probs) != 0 || name != "Vendor" {
		t.Fatalf("unexpected: %v %q", probs, name)
	}
	probs = checkLengths([]fieldCheck{{&long, "Name", 150}})
	if len(probs) != 1 {
		t.Fatalf("expected one problem for a 151-character name, got %v", probs)
	}
	// Limits count characters, not bytes: 150 Urdu letters are allowed.
	urdu := strings.Repeat("پ", 150)
	if probs := checkLengths([]fieldCheck{{&urdu, "Name", 150}}); len(probs) != 0 {
		t.Errorf("150 multi-byte characters should pass, got %v", probs)
	}
}

func TestImportEmailOK(t *testing.T) {
	for _, ok := range []string{"", "a@b.pk", "first.last@example.com"} {
		if !importEmailOK(ok) {
			t.Errorf("%q should be accepted", ok)
		}
	}
	for _, bad := range []string{"not-an-email", "Name <a@b.pk>", "a@", "a b@c.pk"} {
		if importEmailOK(bad) {
			t.Errorf("%q should be rejected", bad)
		}
	}
}

func TestSummarizeAndRowNumber(t *testing.T) {
	resp := summarize([]importRowResult{
		{Status: importReady}, {Status: importReady}, {Status: importDuplicate}, {Status: importError},
	}, true)
	if resp.Summary.Total != 4 || resp.Summary.Ready != 2 || resp.Summary.Duplicate != 1 || resp.Summary.Error != 1 {
		t.Errorf("unexpected summary %+v", resp.Summary)
	}
	if rowNumber(0, 0) != 2 || rowNumber(17, 3) != 17 {
		t.Error("rowNumber should use the given row, or position + 2")
	}
	if plural(1, "client") != "1 client" || plural(3, "vendor") != "3 vendors" {
		t.Error("plural")
	}
}
