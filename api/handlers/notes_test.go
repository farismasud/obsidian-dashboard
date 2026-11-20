package handlers

import (
	"testing"
	"time"

	"obsidian-dashboard/parser"
)

func TestToResponseModTimeIsUTC(t *testing.T) {
	jakarta := time.FixedZone("WIB", 7*3600)
	n := &parser.Note{Path: "a.md", ModTime: time.Date(2026, 11, 20, 16, 18, 33, 0, jakarta)}
	if got, want := toResponse(n).ModTime, "2026-11-20T09:18:33Z"; got != want {
		t.Fatalf("mod_time = %q, want %q (local wall clock must not be labelled UTC)", got, want)
	}
}
