package handlers

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadGraphify(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "graphify-out"), 0o755); err != nil {
		t.Fatal(err)
	}
	if r := LoadGraphify(dir); r.Available {
		t.Fatal("missing graph.json must report unavailable")
	}

	js := `{"nodes":[
	 {"source_file":"Research/a.md","community":1,"community_name":"Agents"},
	 {"source_file":"Research/a.md","community":1,"community_name":"Agents"},
	 {"source_file":"Research/a.md","community":2,"community_name":"LLMs"},
	 {"source_file":"b.md","community":2,"community_name":"LLMs"},
	 {"source_file":"code.py","community":3},
	 {"source_file":"c.md"}]}`
	if err := os.WriteFile(filepath.Join(dir, "graphify-out", "graph.json"), []byte(js), 0o644); err != nil {
		t.Fatal(err)
	}

	r := LoadGraphify(dir)
	if !r.Available {
		t.Fatal("expected available")
	}
	if got := r.Communities["Research/a.md"]; got.ID != 1 || got.Label != "Agents" {
		t.Errorf("Research/a.md: got %+v, want majority community 1 Agents", got)
	}
	if got := r.Communities["b.md"]; got.ID != 2 || got.Label != "LLMs" {
		t.Errorf("b.md: got %+v", got)
	}
	if _, ok := r.Communities["code.py"]; ok {
		t.Error("non-markdown sources must be skipped")
	}
	if _, ok := r.Communities["c.md"]; ok {
		t.Error("nodes without a community must be skipped")
	}
}
