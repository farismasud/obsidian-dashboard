# Dashboard Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One authenticated entry point usable from any device, a living 2D/3D graph, and a redesigned animated UI.

**Architecture:** The Go server (`127.0.0.1:8080`) gates everything with Basic Auth, serves `/api/*` + `/ws`, and reverse-proxies all other paths to Next.js (`127.0.0.1:3000`). A second loopback-only listener (`127.0.0.1:8081`, API only, no auth) serves Next.js server components. The browser only ever uses relative URLs.

**Tech Stack:** Go 1.25 + gin + gorilla/websocket + x/crypto/bcrypt; Next.js 16 (app router) + React 19 + Tailwind v4; react-force-graph-2d, react-force-graph-3d + three.

## Global Constraints
- Spec: `docs/superpowers/specs/2026-11-20-dashboard-revamp-design.md`.
- Repo is PUBLIC: never commit vault content, hashes, or passwords.
- Go and Next.js bind to `127.0.0.1` only.
- Auth fails closed: no readable `DASH_PASS_HASH_FILE` → server exits.
- Lockout: 5 failed logins per IP within 10 minutes → 429 for 10 minutes.
- All motion disabled under `prefers-reduced-motion: reduce`.
- Next.js 16 differs from older versions: check `web/node_modules/next/dist/docs/` before using an API you are unsure of.
- Code blocks headed `**File:** \`path\`` are complete file contents (create or overwrite).

---

### Task 1: Auth gate + public router (Go)

**Files:**
- Create: `api/server/auth.go`, `api/server/server.go`
- Test: `api/server/server_test.go`

**Interfaces:**
- Produces: `server.NewAuth(user string, passHash []byte) *Auth`, `(*Auth).Middleware(http.Handler) http.Handler`, `server.HashPassword(pw string) ([]byte, error)`, `server.APIEngine(v *parser.Vault, hub *handlers.Hub) *gin.Engine`, `server.Public(api http.Handler, next *url.URL, auth *Auth) http.Handler`.

- [ ] **Step 1: Write the failing tests**

**File:** `api/server/server_test.go`
```go
package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

var okHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })

func testAuth(t *testing.T) *Auth {
	t.Helper()
	h, err := bcrypt.GenerateFromPassword([]byte("s3cret"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	return NewAuth("faris", h)
}

func do(h http.Handler, path, user, pass string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodGet, path, nil)
	if user != "" || pass != "" {
		r.SetBasicAuth(user, pass)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestAuth(t *testing.T) {
	h := testAuth(t).Middleware(okHandler)

	w := do(h, "/", "", "")
	if w.Code != http.StatusUnauthorized || w.Header().Get("WWW-Authenticate") == "" {
		t.Fatalf("no creds: got %d, challenge %q", w.Code, w.Header().Get("WWW-Authenticate"))
	}
	if c := do(h, "/", "faris", "wrong").Code; c != http.StatusUnauthorized {
		t.Fatalf("wrong password: got %d", c)
	}
	if c := do(h, "/", "bob", "s3cret").Code; c != http.StatusUnauthorized {
		t.Fatalf("wrong user: got %d", c)
	}
	if c := do(h, "/", "faris", "s3cret").Code; c != http.StatusOK {
		t.Fatalf("valid creds: got %d", c)
	}
	if c := do(h, "/", "faris", "s3cret").Code; c != http.StatusOK {
		t.Fatalf("cached valid creds: got %d", c)
	}
}

func TestAuthLockout(t *testing.T) {
	a := testAuth(t)
	now := time.Unix(1_000_000, 0)
	a.now = func() time.Time { return now }
	h := a.Middleware(okHandler)

	for i := 0; i < 5; i++ {
		do(h, "/", "faris", "bad")
	}
	if c := do(h, "/", "faris", "s3cret").Code; c != http.StatusTooManyRequests {
		t.Fatalf("expected lockout 429, got %d", c)
	}
	now = now.Add(11 * time.Minute)
	if c := do(h, "/", "faris", "s3cret").Code; c != http.StatusOK {
		t.Fatalf("expected unlock after window, got %d", c)
	}
}

func TestPublicRouting(t *testing.T) {
	next := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, "next:"+r.URL.Path)
	}))
	defer next.Close()
	u, _ := url.Parse(next.URL)
	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "api:"+r.URL.Path) })
	h := Public(api, u, testAuth(t))

	cases := map[string]string{
		"/api/stats":        "api:/api/stats",
		"/ws":               "api:/ws",
		"/":                 "next:/",
		"/graph":            "next:/graph",
		"/_next/static/a.js": "next:/_next/static/a.js",
	}
	for path, want := range cases {
		if got := do(h, path, "faris", "s3cret").Body.String(); got != want {
			t.Errorf("%s: got %q, want %q", path, got, want)
		}
	}
	if c := do(h, "/api/stats", "", "").Code; c != http.StatusUnauthorized {
		t.Errorf("api must require auth, got %d", c)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && go test ./server/`
Expected: FAIL — `undefined: NewAuth`, `undefined: Public`.

- [ ] **Step 3: Implement**

**File:** `api/server/auth.go`
```go
package server

import (
	"crypto/sha256"
	"crypto/subtle"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// Auth is an HTTP Basic Auth gate with a per-IP lockout after repeated failures.
type Auth struct {
	user     string
	passHash []byte
	maxFails int
	window   time.Duration
	now      func() time.Time

	mu    sync.Mutex
	fails map[string]*failRecord
	good  map[[32]byte]time.Time // verified credential digests → expiry (avoids bcrypt per request)
}

type failRecord struct {
	count        int
	first        time.Time
	blockedUntil time.Time
}

func NewAuth(user string, passHash []byte) *Auth {
	return &Auth{
		user: user, passHash: passHash, maxFails: 5, window: 10 * time.Minute, now: time.Now,
		fails: map[string]*failRecord{}, good: map[[32]byte]time.Time{},
	}
}

// HashPassword returns a bcrypt hash suitable for DASH_PASS_HASH_FILE.
func HashPassword(pw string) ([]byte, error) {
	return bcrypt.GenerateFromPassword([]byte(pw), 12)
}

func (a *Auth) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		if a.blocked(ip) {
			http.Error(w, "too many failed logins, try again later", http.StatusTooManyRequests)
			return
		}
		user, pass, ok := r.BasicAuth()
		if ok && a.check(user, pass) {
			a.clear(ip)
			next.ServeHTTP(w, r)
			return
		}
		if ok {
			a.fail(ip)
		}
		w.Header().Set("WWW-Authenticate", `Basic realm="rnd-agent vault", charset="UTF-8"`)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
	})
}

func (a *Auth) check(user, pass string) bool {
	digest := sha256.Sum256([]byte(user + "\x00" + pass))
	now := a.now()
	a.mu.Lock()
	exp, cached := a.good[digest]
	a.mu.Unlock()
	if cached && now.Before(exp) {
		return true
	}
	userOK := subtle.ConstantTimeCompare([]byte(user), []byte(a.user)) == 1
	passOK := bcrypt.CompareHashAndPassword(a.passHash, []byte(pass)) == nil // always run: constant work
	if !userOK || !passOK {
		return false
	}
	a.mu.Lock()
	a.good[digest] = now.Add(time.Hour)
	a.mu.Unlock()
	return true
}

func (a *Auth) blocked(ip string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	rec := a.fails[ip]
	return rec != nil && a.now().Before(rec.blockedUntil)
}

func (a *Auth) fail(ip string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.now()
	rec := a.fails[ip]
	if rec == nil || now.Sub(rec.first) > a.window {
		rec = &failRecord{first: now}
		a.fails[ip] = rec
	}
	rec.count++
	if rec.count >= a.maxFails {
		rec.blockedUntil = now.Add(a.window)
		rec.count = 0
		rec.first = now
	}
}

func (a *Auth) clear(ip string) {
	a.mu.Lock()
	delete(a.fails, ip)
	a.mu.Unlock()
}

// clientIP trusts X-Forwarded-For only from loopback (Tailscale serve/funnel, SSH tunnel).
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			return strings.TrimSpace(strings.Split(xff, ",")[0])
		}
	}
	return host
}
```

**File:** `api/server/server.go`
```go
package server

import (
	"net/http"
	"net/http/httputil"
	"net/url"

	"obsidian-dashboard/handlers"
	"obsidian-dashboard/parser"

	"github.com/gin-gonic/gin"
)

// APIEngine serves /api/* and /ws without auth. Mount it behind Public, or on a loopback-only listener.
func APIEngine(v *parser.Vault, hub *handlers.Hub) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())
	api := r.Group("/api")
	{
		api.GET("/notes", handlers.GetNotes(v))
		api.GET("/note/*path", handlers.GetNote(v))
		api.GET("/projects", handlers.GetProjects(v))
		api.GET("/graph", handlers.GetGraph(v))
		api.GET("/graphify", handlers.GetGraphify(v))
		api.GET("/search", handlers.Search(v))
		api.GET("/stats", handlers.GetStats(v))
	}
	r.GET("/ws", hub.Handler())
	return r
}

// Public is the single authenticated entry point: API + WS, everything else proxied to Next.js.
func Public(api http.Handler, next *url.URL, auth *Auth) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/api/", api)
	mux.Handle("/ws", api)
	mux.Handle("/", httputil.NewSingleHostReverseProxy(next))
	return auth.Middleware(mux)
}
```

- [ ] **Step 4: Run tests** — `go test ./server/` will still fail to compile until Task 2 adds `handlers.GetGraphify`. Continue with Task 2, then run: `cd api && go test ./...` → PASS.

- [ ] **Step 5: Commit** (after Task 2 compiles): `git add api/server && git commit -m "feat(api): basic-auth gate and single-origin router"`

---

### Task 2: graphify communities endpoint + main wiring + watcher fix (Go)

**Files:**
- Create: `api/handlers/graphify.go`, `api/handlers/graphify_test.go`
- Modify (full rewrite): `api/main.go`

**Interfaces:**
- Consumes: Task 1 `server.*`.
- Produces: `GET /api/graphify` → `{ "available": bool, "communities": { "<note path, forward slashes>": { "id": int, "label": string } } }`.
- Env: `VAULT_PATH`, `ADDR` (default `127.0.0.1:8080`), `INTERNAL_ADDR` (default `127.0.0.1:8081`), `NEXT_URL` (default `http://127.0.0.1:3000`), `DASH_USER` (default `faris`), `DASH_PASS_HASH_FILE` (required).
- CLI: `obsidian-dashboard-api hash-password` reads one line from stdin, prints bcrypt hash.

- [ ] **Step 1: Write the failing test**

**File:** `api/handlers/graphify_test.go`
```go
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
```

- [ ] **Step 2: Run** `cd api && go test ./handlers/` → FAIL: `undefined: LoadGraphify`.

- [ ] **Step 3: Implement**

**File:** `api/handlers/graphify.go`
```go
package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"obsidian-dashboard/parser"

	"github.com/gin-gonic/gin"
)

type Community struct {
	ID    int    `json:"id"`
	Label string `json:"label"`
}

type GraphifyResponse struct {
	Available   bool                 `json:"available"`
	Communities map[string]Community `json:"communities"`
}

type graphifyFile struct {
	Nodes []struct {
		SourceFile    string `json:"source_file"`
		Community     *int   `json:"community"`
		CommunityName string `json:"community_name"`
	} `json:"nodes"`
}

func GetGraphify(v *parser.Vault) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, LoadGraphify(v.VaultPath))
	}
}

// LoadGraphify maps each vault note to the graphify community most of its extracted concepts belong to.
func LoadGraphify(vaultPath string) GraphifyResponse {
	resp := GraphifyResponse{Communities: map[string]Community{}}
	data, err := os.ReadFile(filepath.Join(vaultPath, "graphify-out", "graph.json"))
	if err != nil {
		return resp
	}
	var g graphifyFile
	if json.Unmarshal(data, &g) != nil {
		return resp
	}

	votes := map[string]map[int]int{}
	names := map[int]string{}
	for _, n := range g.Nodes {
		if n.Community == nil || !strings.HasSuffix(n.SourceFile, ".md") {
			continue
		}
		p := filepath.ToSlash(n.SourceFile)
		if votes[p] == nil {
			votes[p] = map[int]int{}
		}
		votes[p][*n.Community]++
		if n.CommunityName != "" {
			names[*n.Community] = n.CommunityName
		}
	}
	for p, counts := range votes {
		best, bestN := 0, -1
		for id, n := range counts {
			if n > bestN || (n == bestN && id < best) {
				best, bestN = id, n
			}
		}
		label := names[best]
		if label == "" {
			label = fmt.Sprintf("Community %d", best)
		}
		resp.Communities[p] = Community{ID: best, Label: label}
	}
	resp.Available = len(resp.Communities) > 0
	return resp
}
```

**File:** `api/main.go`
```go
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"obsidian-dashboard/handlers"
	"obsidian-dashboard/parser"
	"obsidian-dashboard/server"

	"github.com/fsnotify/fsnotify"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "hash-password" {
		line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
		pw := strings.TrimRight(line, "\r\n")
		if len(pw) < 12 {
			log.Fatal("password must be at least 12 characters")
		}
		h, err := server.HashPassword(pw)
		if err != nil {
			log.Fatal(err)
		}
		fmt.Println(string(h))
		return
	}

	home, _ := os.UserHomeDir()
	vaultPath := env("VAULT_PATH", filepath.Join(home, "Documents", "Obsidian Vault"))
	addr := env("ADDR", "127.0.0.1:8080")
	internalAddr := env("INTERNAL_ADDR", "127.0.0.1:8081")
	nextURL, err := url.Parse(env("NEXT_URL", "http://127.0.0.1:3000"))
	if err != nil {
		log.Fatalf("NEXT_URL: %v", err)
	}

	hashFile := os.Getenv("DASH_PASS_HASH_FILE")
	hash, err := os.ReadFile(hashFile)
	if hashFile == "" || err != nil || len(bytes.TrimSpace(hash)) == 0 {
		log.Fatalf("auth: DASH_PASS_HASH_FILE must point to a bcrypt hash (create one with `obsidian-dashboard-api hash-password`): %v", err)
	}
	auth := server.NewAuth(env("DASH_USER", "faris"), bytes.TrimSpace(hash))

	log.Printf("Loading vault: %s", vaultPath)
	vault := parser.NewVault(vaultPath)
	if err := vault.Load(); err != nil {
		log.Fatalf("Failed to load vault: %v", err)
	}
	log.Printf("Loaded %d notes", len(vault.Notes))

	hub := handlers.NewHub()
	go watchVault(vaultPath, vault, hub)

	api := server.APIEngine(vault, hub)
	go func() {
		log.Printf("Internal API (no auth, loopback only) on %s", internalAddr)
		log.Fatal(http.ListenAndServe(internalAddr, api))
	}()
	log.Printf("Public entry (auth) on %s → Next.js %s", addr, nextURL)
	log.Fatal(http.ListenAndServe(addr, server.Public(api, nextURL, auth)))
}

func watchVault(vaultPath string, vault *parser.Vault, hub *handlers.Hub) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("fsnotify error: %v", err)
		return
	}
	defer watcher.Close()

	addTree := func(root string) {
		_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return nil
			}
			if info.IsDir() {
				if strings.HasPrefix(info.Name(), ".") {
					return filepath.SkipDir
				}
				_ = watcher.Add(path)
			}
			return nil
		})
	}
	addTree(vaultPath)

	debounce := make(map[string]*time.Timer)
	reload := func(path string) {
		if t, ok := debounce[path]; ok {
			t.Stop()
		}
		debounce[path] = time.AfterFunc(300*time.Millisecond, func() {
			vault.ReloadFile(path)
			msg, _ := json.Marshal(map[string]string{"type": "reload", "path": path})
			hub.Broadcast(msg)
			log.Printf("Reloaded: %s", path)
		})
	}

	for {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			// New folders (e.g. Research/<topic>/ created by agents) must be watched too.
			if event.Has(fsnotify.Create) {
				if info, err := os.Stat(event.Name); err == nil && info.IsDir() && !strings.HasPrefix(info.Name(), ".") {
					addTree(event.Name)
					_ = filepath.Walk(event.Name, func(p string, fi os.FileInfo, err error) error {
						if err == nil && !fi.IsDir() && strings.HasSuffix(p, ".md") {
							reload(p)
						}
						return nil
					})
					continue
				}
			}
			if strings.HasSuffix(event.Name, ".md") {
				reload(event.Name)
			}
		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			log.Printf("watcher error: %v", err)
		}
	}
}
```

- [ ] **Step 4: Tidy and test**

Run: `cd api && go mod tidy && go vet ./... && go test ./...`
Expected: PASS for `handlers` and `server`. (`golang.org/x/crypto` moves to a direct dependency.)

- [ ] **Step 5: Commit**

```bash
git add api
git commit -m "feat(api): graphify communities endpoint, auth wiring, watch new folders"
```

---

### Task 3: Frontend foundation — fonts, tokens, motion, API client, live events

**Files:**
- Modify (full rewrite): `web/src/app/globals.css`, `web/src/app/layout.tsx`, `web/src/lib/api.ts`
- Create: `web/src/app/template.tsx`, `web/src/hooks/use-vault-events.ts`, `web/src/hooks/use-reduced-motion.ts`, `web/src/lib/format.ts`, `web/src/components/api-offline.tsx`, `web/src/components/brand-mark.tsx`
- Delete: `web/src/hooks/use-vault-ws.ts`
- Install: `react-force-graph-3d three` and dev `@types/three`

**Interfaces:**
- Produces: `api.*` (relative in browser, `API_URL` on server), `GraphifyInfo`, `useVaultEvents(listener)`, `useReducedMotion(): boolean`, `formatDate(iso)`, `relativeTime(iso)`, `<ApiOffline/>`, `<BrandMark className/>`, CSS utilities `.animate-enter` (stagger via `--i`), `.animate-page`, `.animate-fade`, `.animate-pop`, `.animate-slide-in`, `.surface`, `.hover-lift`, `.live-dot`, `.live-dot-ping`, `.heat-cell`, `.nav-indicator`, `.graph-tip`.

- [ ] **Step 1: Install deps**

Run: `cd web && npm install react-force-graph-3d three && npm install -D @types/three`

- [ ] **Step 2: Write files**

**File:** `web/src/app/globals.css`
```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, monospace;
  --font-heading: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
  --color-sidebar-ring: var(--sidebar-ring);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar: var(--sidebar);
  --color-chart-5: var(--chart-5);
  --color-chart-4: var(--chart-4);
  --color-chart-3: var(--chart-3);
  --color-chart-2: var(--chart-2);
  --color-chart-1: var(--chart-1);
  --color-ring: var(--ring);
  --color-input: var(--input);
  --color-border: var(--border);
  --color-destructive: var(--destructive);
  --color-accent-foreground: var(--accent-foreground);
  --color-accent: var(--accent);
  --color-muted-foreground: var(--muted-foreground);
  --color-muted: var(--muted);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-secondary: var(--secondary);
  --color-primary-foreground: var(--primary-foreground);
  --color-primary: var(--primary);
  --color-cyan: var(--cyan);
  --color-popover-foreground: var(--popover-foreground);
  --color-popover: var(--popover);
  --color-card-foreground: var(--card-foreground);
  --color-card: var(--card);
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
  --radius-3xl: calc(var(--radius) * 2.2);
  --radius-4xl: calc(var(--radius) * 2.6);
}

:root {
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --brand-from: #8b5cf6;
  --brand-to: #06b6d4;
  --background: oklch(0.985 0.004 285);
  --foreground: oklch(0.21 0.02 285);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.21 0.02 285);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.21 0.02 285);
  --primary: oklch(0.52 0.22 293);
  --primary-foreground: oklch(0.98 0.01 293);
  --cyan: oklch(0.6 0.12 210);
  --secondary: oklch(0.96 0.008 285);
  --secondary-foreground: oklch(0.25 0.02 285);
  --muted: oklch(0.955 0.008 285);
  --muted-foreground: oklch(0.5 0.02 285);
  --accent: oklch(0.95 0.015 293);
  --accent-foreground: oklch(0.25 0.03 293);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.21 0.02 285 / 10%);
  --input: oklch(0.21 0.02 285 / 14%);
  --ring: oklch(0.52 0.22 293 / 55%);
  --chart-1: oklch(0.52 0.22 293);
  --chart-2: oklch(0.6 0.12 210);
  --chart-3: oklch(0.65 0.18 350);
  --chart-4: oklch(0.7 0.15 160);
  --chart-5: oklch(0.75 0.15 80);
  --radius: 0.625rem;
  --sidebar: oklch(0.97 0.006 285);
  --sidebar-foreground: oklch(0.21 0.02 285);
  --sidebar-primary: oklch(0.52 0.22 293);
  --sidebar-primary-foreground: oklch(0.98 0.01 293);
  --sidebar-accent: oklch(0.94 0.012 293);
  --sidebar-accent-foreground: oklch(0.21 0.02 285);
  --sidebar-border: oklch(0.21 0.02 285 / 8%);
  --sidebar-ring: oklch(0.52 0.22 293 / 55%);
}

.dark {
  --brand-from: #a78bfa;
  --brand-to: #22d3ee;
  --background: oklch(0.145 0.012 285);
  --foreground: oklch(0.96 0.005 285);
  --card: oklch(0.185 0.014 285);
  --card-foreground: oklch(0.96 0.005 285);
  --popover: oklch(0.19 0.016 285);
  --popover-foreground: oklch(0.96 0.005 285);
  --primary: oklch(0.72 0.17 295);
  --primary-foreground: oklch(0.17 0.03 290);
  --cyan: oklch(0.82 0.12 205);
  --secondary: oklch(0.24 0.015 285);
  --secondary-foreground: oklch(0.96 0.005 285);
  --muted: oklch(0.235 0.012 285);
  --muted-foreground: oklch(0.7 0.02 285);
  --accent: oklch(0.26 0.03 290);
  --accent-foreground: oklch(0.96 0.005 285);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 8%);
  --input: oklch(1 0 0 / 12%);
  --ring: oklch(0.72 0.17 295 / 60%);
  --chart-1: oklch(0.72 0.17 295);
  --chart-2: oklch(0.82 0.12 205);
  --chart-3: oklch(0.72 0.18 350);
  --chart-4: oklch(0.78 0.15 160);
  --chart-5: oklch(0.82 0.14 80);
  --sidebar: oklch(0.13 0.012 285);
  --sidebar-foreground: oklch(0.96 0.005 285);
  --sidebar-primary: oklch(0.72 0.17 295);
  --sidebar-primary-foreground: oklch(0.17 0.03 290);
  --sidebar-accent: oklch(0.22 0.02 290);
  --sidebar-accent-foreground: oklch(0.96 0.005 285);
  --sidebar-border: oklch(1 0 0 / 7%);
  --sidebar-ring: oklch(0.72 0.17 295 / 60%);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
    -webkit-font-smoothing: antialiased;
    background-image: radial-gradient(1100px 520px at 18% -12%, color-mix(in oklch, var(--primary) 11%, transparent), transparent 62%),
      radial-gradient(900px 480px at 100% 0%, color-mix(in oklch, var(--cyan) 6%, transparent), transparent 60%);
    background-attachment: fixed;
  }
  html {
    @apply font-sans;
  }
}

/* ---------- surfaces ---------- */
.surface {
  border-radius: 1rem;
  border: 1px solid var(--border);
  background: color-mix(in oklch, var(--card) 72%, transparent);
  backdrop-filter: blur(12px);
}
.hover-lift {
  transition: transform 220ms var(--ease-out), border-color 220ms var(--ease-out), background-color 220ms var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .hover-lift:hover {
    transform: translateY(-2px);
    border-color: color-mix(in oklch, var(--primary) 38%, var(--border));
  }
}
.hover-lift:active {
  transform: scale(0.99);
}

/* ---------- motion ---------- */
@keyframes enter { from { opacity: 0; transform: translateY(8px); } }
@keyframes page { from { opacity: 0; transform: translateY(4px); } }
@keyframes fade { from { opacity: 0; } }
@keyframes pop { from { opacity: 0; transform: scale(0.97) translateY(-4px); } }
@keyframes slide-in { from { opacity: 0; transform: translateX(16px); } }
@keyframes ping { from { transform: scale(1); opacity: 0.8; } to { transform: scale(2.8); opacity: 0; } }
@keyframes cell-in { from { opacity: 0; transform: scale(0.6); } }

.animate-enter { animation: enter 420ms var(--ease-out) both; animation-delay: calc(var(--i, 0) * 45ms); }
.animate-page { animation: page 260ms var(--ease-out) both; }
.animate-fade { animation: fade 160ms ease-out both; }
.animate-pop { animation: pop 200ms var(--ease-out) both; }
.animate-slide-in { animation: slide-in 260ms var(--ease-out) both; }
.nav-indicator { transition: transform 320ms var(--ease-out), opacity 200ms var(--ease-out); }

.live-dot {
  position: relative;
  width: 7px;
  height: 7px;
  border-radius: 9999px;
  background: oklch(0.78 0.17 155);
  box-shadow: 0 0 8px oklch(0.78 0.17 155 / 70%);
}
.live-dot-ping::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: inherit;
  animation: ping 900ms var(--ease-out) both;
}

.heat-cell {
  background: color-mix(in oklch, var(--primary) calc(var(--lvl, 0) * 100%), var(--muted));
  animation: cell-in 320ms var(--ease-out) both;
}

.graph-tip {
  font: 500 12px/1.35 ui-sans-serif, system-ui, sans-serif;
  padding: 5px 9px;
  border-radius: 8px;
  background: rgba(17, 12, 34, 0.92);
  color: #ede9fe;
  border: 1px solid rgba(167, 139, 250, 0.35);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-delay: 0ms !important;
    transition-duration: 1ms !important;
  }
}

/* ---------- rendered markdown ---------- */
.prose { @apply text-foreground max-w-none text-[15px] leading-7; }
.prose h1 { @apply text-2xl font-semibold tracking-tight mb-4 mt-8 text-foreground; }
.prose h2 { @apply text-xl font-semibold tracking-tight mb-3 mt-7 text-foreground; }
.prose h3 { @apply text-base font-semibold mb-2 mt-5 text-foreground; }
.prose p { @apply mb-4 text-foreground/85; }
.prose ul { @apply list-disc pl-5 mb-4 space-y-1.5 marker:text-primary/70; }
.prose ol { @apply list-decimal pl-5 mb-4 space-y-1.5 marker:text-primary/70; }
.prose code { @apply bg-muted px-1.5 py-0.5 rounded-md text-[13px] font-mono text-primary; }
.prose pre { @apply bg-muted/70 border border-border p-4 rounded-xl mb-4 overflow-x-auto; }
.prose pre code { @apply bg-transparent p-0 text-foreground; }
.prose blockquote { @apply border-l-2 border-primary pl-4 text-muted-foreground mb-4; }
.prose a { @apply text-primary underline-offset-4 hover:underline; }
.prose strong { @apply font-semibold text-foreground; }
.prose hr { @apply border-border my-6; }
.prose table { @apply w-full border-collapse mb-4 text-sm; }
.prose th { @apply border border-border px-3 py-2 bg-muted font-medium text-left; }
.prose td { @apply border border-border px-3 py-2; }

/* ---------- scrollbar ---------- */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { @apply bg-border rounded-full; }
::-webkit-scrollbar-thumb:hover { @apply bg-muted-foreground/40; }
```

**File:** `web/src/app/layout.tsx`
```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Sidebar } from "@/components/sidebar";
import { CommandPalette } from "@/components/command-palette";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Second Brain · rnd-agent",
  description: "Knowledge graph and notes from the rnd-agent research vault",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`} suppressHydrationWarning>
      <body className="h-full">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <div className="flex h-full">
            <Sidebar />
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
          <CommandPalette />
        </ThemeProvider>
      </body>
    </html>
  );
}
```

**File:** `web/src/app/template.tsx`
```tsx
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-page h-full">{children}</div>;
}
```

**File:** `web/src/lib/api.ts`
```ts
// Server components call the loopback-only internal API; the browser uses same-origin relative URLs.
const BASE = typeof window === "undefined" ? (process.env.API_URL ?? "http://127.0.0.1:8081") : "";

export interface Note {
  path: string;
  title: string;
  folder: string;
  tags: string[];
  links: string[];
  backlinks: string[];
  frontmatter: Record<string, unknown>;
  mod_time: string;
  excerpt: string;
}

export interface NoteDetail extends Note {
  html_content: string;
  content: string;
}

export interface GraphNode {
  id: string;
  title: string;
  folder: string;
  group: string;
  link_count?: number;
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface GraphifyInfo {
  available: boolean;
  communities: Record<string, { id: number; label: string }>;
}

export interface Stats {
  total_notes: number;
  project_count: number;
  folders: Record<string, number>;
  last_modified: string;
  recent_notes: Note[];
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const api = {
  notes: (folder?: string) =>
    get<Note[] | null>(`/api/notes${folder ? `?folder=${encodeURIComponent(folder)}` : ""}`).then((r) => r ?? []),
  note: (path: string) => get<NoteDetail>(`/api/note/${encodeURIComponent(path)}`),
  projects: () => get<Note[] | null>("/api/projects").then((r) => r ?? []),
  graph: () => get<GraphData>("/api/graph"),
  graphify: () => get<GraphifyInfo>("/api/graphify"),
  search: (q: string) => get<Note[] | null>(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r ?? []),
  stats: () => get<Stats>("/api/stats"),
};
```

**File:** `web/src/hooks/use-vault-events.ts`
```ts
"use client";

import { useEffect, useRef } from "react";

export interface VaultEvent {
  type: string;
  path?: string;
}

type Listener = (e: VaultEvent) => void;

const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;

function connect() {
  if (socket || typeof window === "undefined") return;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
  socket = ws;
  ws.onmessage = (m) => {
    let e: VaultEvent;
    try {
      e = JSON.parse(m.data);
    } catch {
      return;
    }
    listeners.forEach((l) => l(e));
  };
  ws.onclose = () => {
    socket = null;
    if (listeners.size && !retry) {
      retry = setTimeout(() => {
        retry = null;
        connect();
      }, 3000);
    }
  };
}

/** Subscribe to live vault change events (one shared WebSocket per tab). */
export function useVaultEvents(listener: Listener) {
  const ref = useRef(listener);
  useEffect(() => {
    ref.current = listener;
  });
  useEffect(() => {
    const l: Listener = (e) => ref.current(e);
    listeners.add(l);
    connect();
    return () => {
      listeners.delete(l);
      if (!listeners.size) {
        socket?.close();
        socket = null;
      }
    };
  }, []);
}
```

**File:** `web/src/hooks/use-reduced-motion.ts`
```ts
"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}
```

**File:** `web/src/lib/format.ts`
```ts
export function formatDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

export function relativeTime(iso: string) {
  if (!iso) return "—";
  const secs = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, size] of STEPS) {
    if (Math.abs(secs) >= size) return rtf.format(Math.round(secs / size), unit);
  }
  return "just now";
}
```

**File:** `web/src/components/api-offline.tsx`
```tsx
export function ApiOffline() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="surface animate-enter max-w-sm p-6 text-center">
        <p className="text-sm font-medium">Vault API is offline</p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Check the <code className="font-mono text-primary">obsidian-api</code> service on the server.
        </p>
      </div>
    </div>
  );
}
```

**File:** `web/src/components/brand-mark.tsx`
```tsx
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="brand-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--brand-from)" />
          <stop offset="1" stopColor="var(--brand-to)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#brand-grad)" opacity="0.16" />
      <path d="M9 21 L15 10 L23 15 L19 23 Z M15 10 L19 23" stroke="url(#brand-grad)" strokeWidth="1.4" fill="none" strokeLinejoin="round" />
      <circle cx="9" cy="21" r="2.2" fill="url(#brand-grad)" />
      <circle cx="15" cy="10" r="2.7" fill="url(#brand-grad)" />
      <circle cx="23" cy="15" r="2" fill="url(#brand-grad)" />
      <circle cx="19" cy="23" r="1.8" fill="url(#brand-grad)" />
    </svg>
  );
}
```

- [ ] **Step 3: Delete old hook**: `git rm web/src/hooks/use-vault-ws.ts` (Task 4 replaces its only user, the sidebar).

- [ ] **Step 4: Build after Task 4** (sidebar + palette are referenced by layout). Commit with Task 4.

---

### Task 4: App shell — sidebar, command palette

**Files:**
- Modify (full rewrite): `web/src/components/sidebar.tsx`
- Create: `web/src/components/command-palette.tsx`

**Interfaces:**
- Consumes: `useVaultEvents`, `BrandMark`, `api.search`.
- Produces: `openCommandPalette()`, `<CommandPalette/>`.

**File:** `web/src/components/command-palette.tsx`
```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, CornerDownLeft, FileText, FolderKanban, LayoutDashboard, Network, Search } from "lucide-react";
import { api, type Note } from "@/lib/api";

const OPEN_EVENT = "open-command-palette";

export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

const PAGES = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Graph Galaxy", href: "/graph", icon: Network },
  { label: "Knowledge", href: "/knowledge", icon: BookOpen },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Search", href: "/search", icon: Search },
];

interface Item {
  key: string;
  label: string;
  hint: string;
  href: string;
  icon: React.ElementType;
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (!open || !term) return;
    let cancelled = false;
    const t = setTimeout(() => {
      api.search(term).then((r) => !cancelled && setNotes(r.slice(0, 8))).catch(() => {});
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open]);

  const items = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    const noteItems = term
      ? notes.map((n) => ({
          key: n.path,
          label: n.title,
          hint: n.folder === "root" ? "vault" : n.folder.replaceAll("\\", "/"),
          href: `/knowledge?note=${encodeURIComponent(n.path)}`,
          icon: FileText,
        }))
      : [];
    const pageItems = PAGES.filter((p) => !term || p.label.toLowerCase().includes(term)).map((p) => ({
      key: p.href,
      label: p.label,
      hint: "Page",
      href: p.href,
      icon: p.icon,
    }));
    return [...noteItems, ...pageItems];
  }, [q, notes]);

  function close() {
    setOpen(false);
    setQ("");
    setNotes([]);
    setActive(0);
  }

  function go(item?: Item) {
    if (!item) return;
    close();
    router.push(item.href);
  }

  if (!open) return null;

  return (
    <div
      className="animate-fade fixed inset-0 z-50 flex items-start justify-center bg-background/60 px-4 pt-[14vh] backdrop-blur-sm"
      onMouseDown={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        className="animate-pop w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-popover/95 shadow-2xl shadow-primary/10"
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search size={16} className="text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(items[active]);
              }
            }}
            placeholder="Search notes or jump to a page…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">ESC</kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto p-2">
          {items.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted-foreground">No results</li>}
          {items.map((item, i) => {
            const Icon = item.icon;
            const on = i === active;
            return (
              <li key={item.key}>
                <button
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(item)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    on ? "bg-primary/12 text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <Icon size={15} className={on ? "text-primary" : ""} />
                  <span className="flex-1 truncate">{item.label}</span>
                  <span className="max-w-40 truncate text-[11px] text-muted-foreground/70">{item.hint}</span>
                  {on && <CornerDownLeft size={13} className="text-muted-foreground" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
```

**File:** `web/src/components/sidebar.tsx`
```tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { BookOpen, Command, FolderKanban, LayoutDashboard, Network, Search } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { BrandMark } from "./brand-mark";
import { openCommandPalette } from "./command-palette";
import { cn } from "@/lib/utils";
import { useVaultEvents } from "@/hooks/use-vault-events";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/graph", label: "Graph Galaxy", icon: Network },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/search", label: "Search", icon: Search },
];

const ROW = 40; // h-9 (36px) + mb-1 (4px)

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [pulse, setPulse] = useState(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useVaultEvents(() => {
    setPulse((p) => p + 1);
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 400);
  });

  const activeIndex = NAV.findIndex(({ href }) => (href === "/" ? pathname === "/" : pathname.startsWith(href)));

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar/80 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-2.5 px-4">
        <BrandMark className="size-8" />
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight">Second Brain</p>
          <p className="text-[11px] text-muted-foreground">rnd-agent vault</p>
        </div>
      </div>

      <button
        onClick={openCommandPalette}
        className="mx-3 mb-3 flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        <Search size={13} />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="flex items-center gap-0.5 rounded border border-border px-1 font-mono text-[10px]">
          <Command size={10} />K
        </kbd>
      </button>

      <nav className="relative flex-1 px-3 py-2">
        <span
          aria-hidden
          className="nav-indicator absolute left-3 right-3 top-2 h-9 rounded-lg bg-primary/12 ring-1 ring-primary/25"
          style={{ transform: `translateY(${Math.max(activeIndex, 0) * ROW}px)`, opacity: activeIndex < 0 ? 0 : 1 }}
        />
        {NAV.map(({ href, label, icon: Icon }, i) => {
          const active = i === activeIndex;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative z-10 mb-1 flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors",
                active ? "font-medium text-foreground" : "text-sidebar-foreground/65 hover:text-foreground"
              )}
            >
              <Icon size={16} className={active ? "text-primary" : ""} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center justify-between border-t border-sidebar-border px-4 py-3">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span key={pulse} className={cn("live-dot", pulse > 0 && "live-dot-ping")} />
          Live
        </span>
        <ThemeToggle />
      </div>
    </aside>
  );
}
```

- [ ] **Step 1: Build**: `cd web && npm run build` → succeeds (graph page still uses the old graph-view until Task 7; the old file imports nothing removed).
- [ ] **Step 2: Commit**: `git add web && git commit -m "feat(web): design tokens, fixed fonts, motion system, sidebar and command palette"`

---

### Task 5: Dashboard page

**Files:**
- Create: `web/src/components/count-up.tsx`, `web/src/components/activity-heatmap.tsx`
- Modify (full rewrite): `web/src/app/page.tsx`

**File:** `web/src/components/count-up.tsx`
```tsx
"use client";

import { useEffect, useRef, useState } from "react";

export function CountUp({ value, duration = 900 }: { value: number; duration?: number }) {
  const [n, setN] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = value;
      setN(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(a + (value - a) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <span className="tabular-nums">{n}</span>;
}
```

**File:** `web/src/components/activity-heatmap.tsx`
```tsx
const WEEKS = 12;
const DAY = 86_400_000;

/** Notes per day (by last-modified date, UTC) for the last 12 weeks, GitHub-style. */
export function ActivityHeatmap({ dates }: { dates: string[] }) {
  const counts = new Map<string, number>();
  for (const d of dates) {
    const key = d.slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = today - (WEEKS * 7 - 1 + now.getUTCDay()) * DAY;
  const cells: { key: string; count: number }[] = [];
  for (let t = start; t <= today; t += DAY) {
    const key = new Date(t).toISOString().slice(0, 10);
    cells.push({ key, count: counts.get(key) ?? 0 });
  }
  const max = Math.max(1, ...cells.map((c) => c.count));
  const total = cells.reduce((s, c) => s + c.count, 0);

  return (
    <div>
      <div className="grid grid-flow-col grid-rows-7 gap-[3px]">
        {cells.map((c, i) => (
          <div
            key={c.key}
            title={`${c.key}: ${c.count} note${c.count === 1 ? "" : "s"}`}
            className="heat-cell size-3 rounded-[3px]"
            style={{ "--lvl": c.count ? 0.25 + 0.75 * (c.count / max) : 0, animationDelay: `${i * 5}ms` } as React.CSSProperties}
          />
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{total}</span> notes changed in the last {WEEKS} weeks
      </p>
    </div>
  );
}
```

**File:** `web/src/app/page.tsx`
```tsx
import Link from "next/link";
import { ArrowUpRight, Clock, FileText, FolderTree, Link2 } from "lucide-react";
import { api, type GraphData, type Note, type Stats } from "@/lib/api";
import { CountUp } from "@/components/count-up";
import { ActivityHeatmap } from "@/components/activity-heatmap";
import { ApiOffline } from "@/components/api-offline";
import { folderColor, topFolder } from "@/app/graph/graph-colors";
import { relativeTime } from "@/lib/format";

function StatCard({ icon: Icon, label, children, i, tint }: { icon: React.ElementType; label: string; children: React.ReactNode; i: number; tint: string }) {
  return (
    <div className="surface hover-lift animate-enter p-5" style={{ "--i": i } as React.CSSProperties}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <span className="grid size-8 place-items-center rounded-lg" style={{ background: `${tint}1f`, color: tint }}>
          <Icon size={16} />
        </span>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight">{children}</p>
    </div>
  );
}

function NoteCard({ note, i }: { note: Note; i: number }) {
  const color = folderColor(note.folder);
  return (
    <Link
      href={`/knowledge?note=${encodeURIComponent(note.path)}`}
      className="surface hover-lift animate-enter group block p-4"
      style={{ "--i": i } as React.CSSProperties}
    >
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="size-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
        <span className="truncate">{note.folder === "root" ? "vault" : note.folder.replaceAll("\\", "/")}</span>
        <span className="ml-auto shrink-0">{relativeTime(note.mod_time)}</span>
      </div>
      <p className="mt-2 line-clamp-1 font-medium transition-colors group-hover:text-primary">{note.title}</p>
      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{note.excerpt}</p>
    </Link>
  );
}

export default async function DashboardPage() {
  let stats: Stats;
  let notes: Note[];
  let graph: GraphData;
  try {
    [stats, notes, graph] = await Promise.all([api.stats(), api.notes(), api.graph()]);
  } catch {
    return <ApiOffline />;
  }

  const folders = Object.entries(stats.folders)
    .map(([f, n]) => [topFolder(f), n] as const)
    .reduce((m, [f, n]) => m.set(f, (m.get(f) ?? 0) + n), new Map<string, number>());
  const folderList = [...folders.entries()].sort((a, b) => b[1] - a[1]);
  const maxFolder = Math.max(1, ...folderList.map(([, n]) => n));

  return (
    <div className="mx-auto max-w-6xl p-8">
      <header className="animate-enter mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">rnd-agent · Second Brain</p>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Last activity {relativeTime(stats.last_modified)}</p>
        </div>
        <Link
          href="/graph"
          className="group inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/25 transition-transform hover:-translate-y-0.5 active:scale-[0.98]"
        >
          Open Graph Galaxy
          <ArrowUpRight size={16} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard i={0} icon={FileText} label="Notes" tint="#a78bfa"><CountUp value={stats.total_notes} /></StatCard>
        <StatCard i={1} icon={Link2} label="Connections" tint="#22d3ee"><CountUp value={graph.links.length} /></StatCard>
        <StatCard i={2} icon={FolderTree} label="Folders" tint="#f472b6"><CountUp value={folderList.length} /></StatCard>
        <StatCard i={3} icon={Clock} label="Last activity" tint="#34d399">
          <span className="text-xl">{relativeTime(stats.last_modified)}</span>
        </StatCard>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="surface animate-enter p-5 lg:col-span-2" style={{ "--i": 4 } as React.CSSProperties}>
          <h2 className="mb-4 text-sm font-medium">Activity</h2>
          <ActivityHeatmap dates={notes.map((n) => n.mod_time)} />
        </div>
        <div className="surface animate-enter p-5" style={{ "--i": 5 } as React.CSSProperties}>
          <h2 className="mb-4 text-sm font-medium">Folders</h2>
          <ul className="space-y-3">
            {folderList.map(([folder, count]) => (
              <li key={folder}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="capitalize">{folder === "root" ? "vault" : folder}</span>
                  <span className="tabular-nums text-muted-foreground">{count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full" style={{ width: `${(count / maxFolder) * 100}%`, background: folderColor(folder) }} />
                </div>
              </li>
            ))}
            {folderList.length === 0 && <li className="text-xs text-muted-foreground">No folders yet</li>}
          </ul>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="animate-enter mb-3 text-sm font-medium" style={{ "--i": 6 } as React.CSSProperties}>Recent notes</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {stats.recent_notes.map((note, i) => (
            <NoteCard key={note.path} note={note} i={i + 7} />
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 1:** Requires `web/src/app/graph/graph-colors.ts` from Task 7 — create that file first (it has no dependencies), then `npm run build`.
- [ ] **Step 2: Commit**: `git commit -am "feat(web): dashboard with counters, activity heatmap, recent notes"`

---

### Task 6: Knowledge, Projects, Search polish

**Files:**
- Modify (full rewrite): `web/src/app/knowledge/page.tsx`
- Modify (edits): `web/src/app/projects/page.tsx`, `web/src/app/search/page.tsx`

**File:** `web/src/app/knowledge/page.tsx`
```tsx
import Link from "next/link";
import { Clock, Command, Link2 } from "lucide-react";
import { api, type Note, type NoteDetail } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ApiOffline } from "@/components/api-offline";
import { folderColor } from "@/app/graph/graph-colors";
import { formatDate, relativeTime } from "@/lib/format";

function groupByFolder(notes: Note[]) {
  const groups: Record<string, Note[]> = {};
  for (const note of notes) {
    const key = note.folder === "root" ? "vault" : note.folder.replaceAll("\\", "/");
    (groups[key] ??= []).push(note);
  }
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
}

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ note?: string }> }) {
  const { note: notePath } = await searchParams;
  let notes: Note[];
  let active: NoteDetail | null = null;
  try {
    notes = await api.notes();
    if (notePath) active = await api.note(notePath);
  } catch {
    return <ApiOffline />;
  }
  const groups = groupByFolder(notes);
  const recent = [...notes].sort((a, b) => b.mod_time.localeCompare(a.mod_time)).slice(0, 6);

  return (
    <div className="flex h-full">
      <div className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-sidebar/40">
        <div className="flex h-14 items-center border-b border-border px-4">
          <h1 className="text-sm font-semibold">Knowledge</h1>
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">{notes.length}</span>
        </div>
        <ScrollArea className="flex-1">
          <div className="space-y-5 p-3">
            {groups.map(([folder, folderNotes]) => (
              <div key={folder}>
                <p className="mb-1 flex items-center gap-2 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  <span className="size-1.5 rounded-full" style={{ background: folderColor(folder) }} />
                  {folder}
                </p>
                {folderNotes.map((n) => {
                  const on = notePath === n.path;
                  return (
                    <Link
                      key={n.path}
                      href={`/knowledge?note=${encodeURIComponent(n.path)}`}
                      className={`block truncate rounded-md px-2 py-1.5 text-sm transition-colors ${
                        on ? "bg-primary/12 text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      {n.title}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      <div className="flex-1 overflow-y-auto">
        {active ? (
          <article key={active.path} className="animate-enter mx-auto max-w-3xl px-10 py-10">
            <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="size-2 rounded-full" style={{ background: folderColor(active.folder) }} />
              <span>{active.folder === "root" ? "vault" : active.folder.replaceAll("\\", "/")}</span>
              <span>·</span>
              <Clock size={11} />
              <span>{formatDate(active.mod_time)}</span>
            </div>
            <h1 className="mb-4 text-4xl font-semibold tracking-tight">{active.title}</h1>
            {active.tags.length > 0 && (
              <div className="mb-6 flex flex-wrap gap-1.5">
                {active.tags.map((t) => (
                  <Badge key={t} variant="outline" className="text-xs">#{t}</Badge>
                ))}
              </div>
            )}
            <div className="prose" dangerouslySetInnerHTML={{ __html: active.html_content }} />
            {active.backlinks.length > 0 && (
              <div className="mt-12 border-t border-border pt-6">
                <p className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <Link2 size={12} /> Backlinks ({active.backlinks.length})
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {active.backlinks.map((bp) => (
                    <Link key={bp} href={`/knowledge?note=${encodeURIComponent(bp)}`} className="surface hover-lift px-3 py-2 text-sm">
                      {notes.find((n) => n.path === bp)?.title ?? bp}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </article>
        ) : (
          <div className="mx-auto flex h-full max-w-3xl flex-col justify-center px-10 py-10">
            <p className="animate-enter text-xs font-medium uppercase tracking-[0.18em] text-primary">Knowledge</p>
            <h2 className="animate-enter mt-2 text-3xl font-semibold tracking-tight" style={{ "--i": 1 } as React.CSSProperties}>
              Pick a note, or jump anywhere
            </h2>
            <p className="animate-enter mt-2 flex items-center gap-1.5 text-sm text-muted-foreground" style={{ "--i": 2 } as React.CSSProperties}>
              Press
              <kbd className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 font-mono text-[11px]">
                <Command size={10} />K
              </kbd>
              to search {notes.length} notes.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {recent.map((n, i) => (
                <Link
                  key={n.path}
                  href={`/knowledge?note=${encodeURIComponent(n.path)}`}
                  className="surface hover-lift animate-enter p-4"
                  style={{ "--i": i + 3 } as React.CSSProperties}
                >
                  <p className="text-[11px] text-muted-foreground">{relativeTime(n.mod_time)}</p>
                  <p className="mt-1 line-clamp-1 font-medium">{n.title}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{n.excerpt}</p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Edits — `web/src/app/projects/page.tsx`:**
1. Replace the `ProjectCard` signature and outer elements so cards use the new surface + stagger:
   - `function ProjectCard({ note }: { note: Note })` → `function ProjectCard({ note, i }: { note: Note; i: number })`
   - `<Link href={...}>` → `<Link href={...} className="animate-enter block" style={{ "--i": i } as React.CSSProperties}>`
   - `<Card className="border-border/50 hover:border-primary/30 hover:bg-accent/20 transition-all cursor-pointer group h-full">` → `<Card className="surface hover-lift cursor-pointer group h-full">`
2. In the grid: `<ProjectCard key={p.path} note={p} />` → `<ProjectCard key={p.path} note={p} i={i} />` with `projects.map((p, i) => ...)`.
3. Header: wrap `<div className="mb-7">` → `<div className="mb-7 animate-enter">`.

**Edits — `web/src/app/search/page.tsx`:**
1. `<div className="mb-7">` → `<div className="mb-7 animate-enter">`.
2. `results.map((note) => (` → `results.map((note, i) => (`, and the `<Link ...>` gets `className="animate-enter block" style={{ "--i": i } as React.CSSProperties}`.
3. `<Card className="border-border/50 hover:border-primary/30 hover:bg-accent/20 transition-all cursor-pointer group">` → `<Card className="surface hover-lift cursor-pointer group">`.

- [ ] **Step 1:** `npm run build` → succeeds.
- [ ] **Step 2: Commit**: `git commit -am "feat(web): knowledge reader and empty state, animated project/search lists"`

---

### Task 7: Graph Galaxy — shared explorer, 2D, 3D

**Files:**
- Create: `web/src/app/graph/graph-colors.ts`, `graph-types.ts`, `graph-explorer.tsx`, `graph-2d.tsx`, `graph-3d.tsx`, `note-panel.tsx`
- Modify (full rewrite): `web/src/app/graph/page.tsx`
- Delete: `web/src/app/graph/graph-view.tsx`

**Interfaces:**
- `RenderProps` (graph-types.ts) is the contract between the explorer and both renderers.

**File:** `web/src/app/graph/graph-colors.ts`
```ts
export const FOLDER_COLORS: Record<string, string> = {
  Research: "#a78bfa",
  Projects: "#8b5cf6",
  Knowledge: "#22d3ee",
  Sessions: "#f59e0b",
  Journal: "#fbbf24",
  Claude: "#34d399",
  Agents: "#f472b6",
  Gemini: "#60a5fa",
  Antigravity: "#fb7185",
  Hermes: "#ec4899",
  "graphify-out": "#64748b",
  root: "#cbd5e1",
  vault: "#cbd5e1",
};

const PALETTE = ["#a78bfa", "#22d3ee", "#f472b6", "#34d399", "#fbbf24", "#60a5fa", "#fb7185", "#c084fc", "#2dd4bf", "#f97316"];

export const normPath = (p: string) => p.replaceAll("\\", "/");
export const topFolder = (folder: string) => normPath(folder).split("/")[0];

export function paletteColor(i: number) {
  return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];
}

export function folderColor(folder: string) {
  const top = topFolder(folder);
  if (FOLDER_COLORS[top]) return FOLDER_COLORS[top];
  let h = 0;
  for (const ch of top) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return paletteColor(h);
}

/** Blend a hex color toward a background hex (amount 0..1). */
export function mix(hex: string, bg: string, amount: number) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [p(hex), p(bg)];
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, "0")).join("")}`;
}
```

**File:** `web/src/app/graph/graph-types.ts`
```ts
export interface GNode {
  id: string;
  title: string;
  folder: string;
  group: string;
  link_count?: number;
  x?: number;
  y?: number;
  z?: number;
  __born?: number; // performance.now() when the node first appeared live
}

export interface GLink {
  source: string | GNode;
  target: string | GNode;
}

export interface GGraph {
  nodes: GNode[];
  links: GLink[];
}

export type GraphCommand = { kind: "zoomIn" | "zoomOut" | "fit"; seq: number } | null;

export interface RenderProps {
  data: GGraph;
  width: number;
  height: number;
  colorOf: (n: GNode) => string;
  highlight: Set<string> | null; // search/legend matches; null = no filter
  selectedId: string | null;
  onSelect: (n: GNode | null) => void;
  command: GraphCommand;
  dark: boolean;
  reducedMotion: boolean;
}

export const idOf = (end: string | GNode) => (typeof end === "string" ? end : end.id);

export function neighborMap(links: GLink[]) {
  const m = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    let s = m.get(a);
    if (!s) m.set(a, (s = new Set()));
    s.add(b);
  };
  for (const l of links) {
    const s = idOf(l.source);
    const t = idOf(l.target);
    add(s, t);
    add(t, s);
  }
  return m;
}
```

**File:** `web/src/app/graph/page.tsx`
```tsx
import { api, type GraphData, type GraphifyInfo } from "@/lib/api";
import { ApiOffline } from "@/components/api-offline";
import { GraphExplorer } from "./graph-explorer";

export default async function GraphPage() {
  let data: GraphData;
  let graphify: GraphifyInfo;
  try {
    [data, graphify] = await Promise.all([
      api.graph(),
      api.graphify().catch(() => ({ available: false, communities: {} })),
    ]);
  } catch {
    return <ApiOffline />;
  }
  return <GraphExplorer initialData={data} initialGraphify={graphify} />;
}
```

**File:** `web/src/app/graph/note-panel.tsx`
```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Link2, X } from "lucide-react";
import { api, type NoteDetail } from "@/lib/api";
import type { GNode } from "./graph-types";

export function NotePanel({ node, color, onClose }: { node: GNode; color: string; onClose: () => void }) {
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .note(node.id)
      .then((n) => !cancelled && setNote(n))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [node.id]);

  return (
    <aside className="animate-slide-in absolute bottom-4 right-4 top-4 z-30 flex w-[380px] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card/85 shadow-2xl backdrop-blur-xl">
      <header className="flex items-start gap-3 border-b border-border p-4">
        <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold leading-snug">{node.title}</h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {node.folder === "root" ? "vault" : node.folder.replaceAll("\\", "/")} · {node.link_count ?? 0} links
          </p>
        </div>
        <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          <X size={16} />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        {failed && <p className="text-sm text-muted-foreground">Could not load this note.</p>}
        {!note && !failed && (
          <div className="space-y-2">
            {[80, 95, 60, 90].map((w) => (
              <div key={w} className="h-3 animate-pulse rounded bg-muted" style={{ width: `${w}%` }} />
            ))}
          </div>
        )}
        {note && (
          <>
            {note.tags.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1">
                {note.tags.map((t) => (
                  <span key={t} className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] text-primary">#{t}</span>
                ))}
              </div>
            )}
            <div className="prose text-sm" dangerouslySetInnerHTML={{ __html: note.html_content }} />
            {note.backlinks.length > 0 && (
              <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Link2 size={12} /> {note.backlinks.length} backlink{note.backlinks.length === 1 ? "" : "s"}
              </p>
            )}
          </>
        )}
      </div>
      <footer className="border-t border-border p-3">
        <Link
          href={`/knowledge?note=${encodeURIComponent(node.id)}`}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-primary/12 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20"
        >
          Open note <ArrowUpRight size={14} />
        </Link>
      </footer>
    </aside>
  );
}
```

**File:** `web/src/app/graph/graph-explorer.tsx`
```tsx
"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Eye, Maximize2, Palette, Search, Sparkles, Square, X, ZoomIn, ZoomOut } from "lucide-react";
import { api, type GraphData, type GraphifyInfo } from "@/lib/api";
import { useVaultEvents } from "@/hooks/use-vault-events";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { folderColor, normPath, paletteColor, topFolder } from "./graph-colors";
import type { GGraph, GNode, GraphCommand, RenderProps } from "./graph-types";
import { NotePanel } from "./note-panel";

const Graph2D = dynamic(() => import("./graph-2d").then((m) => m.Graph2D), { ssr: false });
const Graph3D = dynamic(() => import("./graph-3d").then((m) => m.Graph3D), { ssr: false });

type Mode = "2d" | "3d";
type Scope = "all" | "core";
type ColorBy = "folder" | "community";

const isGraphify = (n: { folder: string }) => normPath(n.folder).startsWith("graphify-out");

function useStored<T extends string>(key: string, initial: T, allowed: readonly T[]) {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const s = localStorage.getItem(key) as T | null;
      if (s && allowed.includes(s)) setValue(s);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, v);
      } catch {}
    },
    [key]
  );
  return [value, set] as const;
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon: React.ElementType }[];
}) {
  return (
    <div className="flex items-center rounded-xl border border-border bg-card/70 p-1 text-xs backdrop-blur-md">
      {options.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition-colors ${
            value === v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Icon size={13} />
          {label}
        </button>
      ))}
    </div>
  );
}

export function GraphExplorer({ initialData, initialGraphify }: { initialData: GraphData; initialGraphify: GraphifyInfo }) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme !== "light";
  const reducedMotion = useReducedMotion();

  const [mode, setMode] = useStored<Mode>("graph.mode", "3d", ["2d", "3d"]);
  const [colorByPref, setColorBy] = useStored<ColorBy>("graph.colorBy", "folder", ["folder", "community"]);
  const [scope, setScope] = useState<Scope>("all");
  const [full, setFull] = useState<GraphData>(initialData);
  const [graphify, setGraphify] = useState<GraphifyInfo>(initialGraphify);
  const [query, setQuery] = useState("");
  const [legendPick, setLegendPick] = useState<string | null>(null);
  const [selected, setSelected] = useState<GNode | null>(null);
  const [command, setCommand] = useState<GraphCommand>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const stage = useRef<HTMLDivElement>(null);
  const nodeCache = useRef(new Map<string, GNode>());
  const bornAt = useRef(new Map<string, number>());

  const colorBy: ColorBy = graphify.available ? colorByPref : "folder";

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const update = () => setDims({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useVaultEvents(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(async () => {
      try {
        const [g, gi] = await Promise.all([api.graph(), api.graphify().catch(() => null)]);
        const now = performance.now();
        for (const n of g.nodes) if (!nodeCache.current.has(n.id)) bornAt.current.set(n.id, now);
        if (gi) setGraphify(gi);
        setFull(g);
      } catch {}
    }, 500);
  });

  // Keep node objects stable across refreshes so the simulation keeps positions.
  const data = useMemo<GGraph>(() => {
    const nodes: GNode[] = [];
    for (const n of full.nodes) {
      if (scope === "core" && isGraphify(n)) continue;
      let g = nodeCache.current.get(n.id);
      if (!g) {
        g = { ...n };
        nodeCache.current.set(n.id, g);
      } else {
        g.title = n.title;
        g.folder = n.folder;
        g.group = n.group;
        g.link_count = n.link_count;
      }
      g.__born = bornAt.current.get(n.id);
      nodes.push(g);
    }
    const ids = new Set(nodes.map((n) => n.id));
    const links = full.links.filter((l) => ids.has(l.source) && ids.has(l.target)).map((l) => ({ source: l.source, target: l.target }));
    return { nodes, links };
  }, [full, scope]);

  const counts = useMemo(() => ({ all: full.nodes.length, core: full.nodes.filter((n) => !isGraphify(n)).length }), [full]);

  const legendKey = useCallback(
    (n: GNode) => (colorBy === "community" ? graphify.communities[normPath(n.id)]?.label ?? "Unclustered" : topFolder(n.folder)),
    [colorBy, graphify]
  );

  const colorOf = useCallback(
    (n: GNode) => {
      if (colorBy === "community") {
        const c = graphify.communities[normPath(n.id)];
        return c ? paletteColor(c.id) : "#475569";
      }
      return folderColor(n.folder);
    },
    [colorBy, graphify]
  );

  const legend = useMemo(() => {
    const m = new Map<string, { color: string; count: number }>();
    for (const n of data.nodes) {
      const k = legendKey(n);
      const e = m.get(k);
      if (e) e.count++;
      else m.set(k, { color: colorOf(n), count: 1 });
    }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [data, legendKey, colorOf]);

  const highlight = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q && !legendPick) return null;
    const s = new Set<string>();
    for (const n of data.nodes) {
      if (q && !n.title.toLowerCase().includes(q)) continue;
      if (legendPick && legendKey(n) !== legendPick) continue;
      s.add(n.id);
    }
    return s;
  }, [data, query, legendPick, legendKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const cmd = (kind: NonNullable<GraphCommand>["kind"]) => setCommand((c) => ({ kind, seq: (c?.seq ?? 0) + 1 }));

  const props: RenderProps = {
    data,
    width: dims.w,
    height: dims.h,
    colorOf,
    highlight,
    selectedId: selected?.id ?? null,
    onSelect: setSelected,
    command,
    dark,
    reducedMotion,
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <h1 className="text-sm font-semibold">Graph Galaxy</h1>
        <span className="text-xs tabular-nums text-muted-foreground">
          {data.nodes.length} notes · {data.links.length} links
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "2d", label: "2D", icon: Square },
              { value: "3d", label: "3D", icon: Box },
            ]}
          />
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: "all", label: `All ${counts.all}`, icon: Sparkles },
              { value: "core", label: `Core ${counts.core}`, icon: Eye },
            ]}
          />
          {graphify.available && (
            <Segmented
              value={colorBy}
              onChange={(v) => {
                setColorBy(v);
                setLegendPick(null);
              }}
              options={[
                { value: "folder", label: "Folder", icon: Palette },
                { value: "community", label: "Community", icon: Sparkles },
              ]}
            />
          )}
        </div>
      </header>

      <div
        ref={stage}
        className="relative flex-1 overflow-hidden"
        style={{ background: dark ? "radial-gradient(ellipse at 50% 40%, #120d26 0%, #07060f 70%)" : "radial-gradient(ellipse at 50% 40%, #ffffff 0%, #f1f0f7 75%)" }}
      >
        {dims.w > 0 && dims.h > 0 && (mode === "3d" ? <Graph3D {...props} /> : <Graph2D {...props} />)}

        <div className="absolute left-4 top-4 z-20 flex w-72 items-center gap-2 rounded-xl border border-border bg-card/75 px-3 py-2 shadow-lg backdrop-blur-md">
          <Search size={14} className="shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a note in the graph…"
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button onClick={() => setQuery("")} aria-label="Clear search" className="text-muted-foreground hover:text-foreground">
              <X size={13} />
            </button>
          )}
        </div>

        {!selected && legend.length > 0 && (
          <div className="absolute bottom-4 left-4 z-20 max-h-64 w-56 overflow-y-auto rounded-xl border border-border bg-card/75 p-2 shadow-lg backdrop-blur-md">
            <p className="px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {colorBy === "community" ? "Communities" : "Folders"}
            </p>
            {legend.map(([key, { color, count }]) => {
              const on = legendPick === key;
              return (
                <button
                  key={key}
                  onClick={() => setLegendPick(on ? null : key)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-xs transition-colors ${
                    on ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  }`}
                >
                  <span className="size-2 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                  <span className="flex-1 truncate text-left">{key === "root" ? "vault" : key}</span>
                  <span className="tabular-nums text-[10px] opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="absolute bottom-4 z-20 flex flex-col gap-1 rounded-xl border border-border bg-card/75 p-1 shadow-lg backdrop-blur-md" style={{ right: selected ? 412 : 16 }}>
          {[
            { k: "zoomIn" as const, icon: ZoomIn, label: "Zoom in" },
            { k: "zoomOut" as const, icon: ZoomOut, label: "Zoom out" },
            { k: "fit" as const, icon: Maximize2, label: "Fit" },
          ].map(({ k, icon: Icon, label }) => (
            <button key={k} onClick={() => cmd(k)} title={label} aria-label={label} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <Icon size={15} />
            </button>
          ))}
        </div>

        {data.nodes.length < 5 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-20 z-10 text-center text-xs text-muted-foreground">
            The vault is still small — agents add notes to <code className="font-mono text-primary">Research/</code>; link them with{" "}
            <code className="font-mono text-primary">[[wikilinks]]</code> to grow the galaxy.
          </div>
        )}

        {selected && <NotePanel key={selected.id} node={selected} color={colorOf(selected)} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}
```

**File:** `web/src/app/graph/graph-2d.tsx`
```tsx
"use client";

import ForceGraph2D from "react-force-graph-2d";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { idOf, neighborMap, type GLink, type GNode, type RenderProps } from "./graph-types";

interface Star {
  x: number;
  y: number;
  r: number;
  base: number;
  phase: number;
  speed: number;
}

function makeStars(n: number): Star[] {
  return Array.from({ length: n }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: Math.random() * 1.1 + 0.3,
    base: Math.random() * 0.5 + 0.15,
    phase: Math.random() * Math.PI * 2,
    speed: Math.random() * 1.2 + 0.4,
  }));
}

function phaseOf(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (h % 628) / 100;
}

const easeOutBack = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FG = any;

export function Graph2D(p: RenderProps) {
  const fg = useRef<FG>(null);
  const hovered = useRef<string | null>(null);
  const fitted = useRef(false);
  const stars = useMemo(() => makeStars(240), []);
  const neighbors = useMemo(() => neighborMap(p.data.links), [p.data]);
  const font = useMemo(() => (typeof window === "undefined" ? "system-ui" : getComputedStyle(document.body).fontFamily), []);

  useEffect(() => {
    const g = fg.current;
    if (!g || !p.command) return;
    if (p.command.kind === "zoomIn") g.zoom(g.zoom() * 1.4, 400);
    if (p.command.kind === "zoomOut") g.zoom(g.zoom() / 1.4, 400);
    if (p.command.kind === "fit") g.zoomToFit(600, 60);
  }, [p.command]);

  useEffect(() => {
    const g = fg.current;
    const n = p.data.nodes.find((x) => x.id === p.selectedId);
    if (!g || !n || n.x == null || n.y == null) return;
    g.centerAt(n.x, n.y, 700);
    g.zoom(Math.max(g.zoom(), 2.4), 700);
  }, [p.selectedId, p.data]);

  const focusId = () => hovered.current ?? p.selectedId;
  const isFocusLink = (l: GLink) => {
    const f = focusId();
    return !!f && (idOf(l.source) === f || idOf(l.target) === f);
  };

  const onRenderFramePre = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const { width: W, height: H } = ctx.canvas;
      const dpr = window.devicePixelRatio || 1;
      const t = performance.now() / 1000;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0); // screen space: stars do not pan/zoom
      const g = ctx.createRadialGradient(W * 0.5, H * 0.42, 0, W * 0.5, H * 0.42, Math.max(W, H) * 0.7);
      g.addColorStop(0, p.dark ? "rgba(124, 58, 237, 0.16)" : "rgba(124, 58, 237, 0.06)");
      g.addColorStop(0.55, p.dark ? "rgba(8, 145, 178, 0.05)" : "rgba(8, 145, 178, 0.03)");
      g.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      if (p.dark) {
        ctx.fillStyle = "#c7d2fe";
        for (const s of stars) {
          ctx.globalAlpha = p.reducedMotion ? s.base : s.base * (0.55 + 0.45 * Math.sin(t * s.speed + s.phase));
          ctx.beginPath();
          ctx.arc(s.x * W, s.y * H, s.r * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    },
    [p.dark, p.reducedMotion, stars]
  );

  const nodeCanvasObject = useCallback(
    (node: object, ctx: CanvasRenderingContext2D, scale: number) => {
      const n = node as GNode & { x: number; y: number };
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) return;
      const color = p.colorOf(n);
      const deg = n.link_count ?? 0;
      const now = performance.now();
      const f = focusId();
      const isFocus = n.id === f;
      const isNeighbor = !!f && !!neighbors.get(f)?.has(n.id);
      const dimFilter = !!p.highlight && !p.highlight.has(n.id);
      const dimFocus = !!f && !isFocus && !isNeighbor;
      const pulse = p.reducedMotion ? 1 : 1 + 0.07 * Math.sin(now / 650 + phaseOf(n.id));
      const age = n.__born ? (now - n.__born) / 900 : 1;
      const born = age >= 1 ? 1 : easeOutBack(Math.max(0, age));
      const r = (3 + Math.sqrt(deg) * 1.7) * pulse * (isFocus ? 1.35 : 1) * (0.45 + 0.55 * born);

      ctx.save();
      ctx.globalAlpha = dimFilter ? 0.08 : dimFocus ? 0.2 : 1;

      const glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 3.4);
      glow.addColorStop(0, color + (isFocus ? "aa" : "4d"));
      glow.addColorStop(1, color + "00");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r * 3.4, 0, Math.PI * 2);
      ctx.fill();

      if (age < 1.6 && n.__born && !p.reducedMotion) {
        const ring = Math.min(1, age / 1.6);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 1 - ring;
        ctx.lineWidth = 1.5 / scale;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * (1 + ring * 5), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = dimFilter ? 0.08 : dimFocus ? 0.2 : 1;
      }

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath();
      ctx.arc(n.x - r * 0.3, n.y - r * 0.3, r * 0.32, 0, Math.PI * 2);
      ctx.fill();

      const showLabel = isFocus || isNeighbor || !!p.highlight?.has(n.id) || scale > 2.2 || (deg >= 6 && scale > 1.1);
      if (showLabel && !dimFilter) {
        const fs = 12 / scale; // constant 12px on screen
        ctx.font = `${isFocus ? 600 : 500} ${fs}px ${font}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const label = !isFocus && n.title.length > 28 ? n.title.slice(0, 26) + "…" : n.title;
        const y = n.y + r + 4 / scale;
        ctx.lineWidth = 3 / scale;
        ctx.strokeStyle = p.dark ? "rgba(7,6,15,0.85)" : "rgba(255,255,255,0.9)";
        ctx.strokeText(label, n.x, y);
        ctx.fillStyle = isFocus ? (p.dark ? "#ffffff" : "#4c1d95") : p.dark ? "rgba(226,232,240,0.9)" : "#1e293b";
        ctx.fillText(label, n.x, y);
      }
      ctx.restore();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.colorOf, p.highlight, p.selectedId, p.dark, p.reducedMotion, neighbors, font]
  );

  return (
    <ForceGraph2D
      ref={fg}
      width={p.width}
      height={p.height}
      graphData={p.data}
      backgroundColor="rgba(0,0,0,0)"
      autoPauseRedraw={false}
      onRenderFramePre={onRenderFramePre}
      nodeCanvasObject={nodeCanvasObject}
      nodePointerAreaPaint={(node, color, ctx) => {
        const n = node as GNode & { x: number; y: number };
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(n.x, n.y, 3 + Math.sqrt(n.link_count ?? 0) * 1.7 + 3, 0, Math.PI * 2);
        ctx.fill();
      }}
      linkColor={(l) =>
        isFocusLink(l as GLink)
          ? p.dark
            ? "rgba(196,181,253,0.9)"
            : "rgba(109,40,217,0.75)"
          : p.dark
            ? "rgba(148,163,184,0.13)"
            : "rgba(71,85,105,0.16)"
      }
      linkWidth={(l) => (isFocusLink(l as GLink) ? 1.6 : 0.6)}
      linkDirectionalParticles={p.reducedMotion ? 0 : 1}
      linkDirectionalParticleSpeed={0.0055}
      linkDirectionalParticleWidth={1.6}
      linkDirectionalParticleColor={(l) => p.colorOf((l as { source: GNode }).source)}
      onNodeHover={(node) => {
        hovered.current = (node as GNode | null)?.id ?? null;
        const canvas = document.querySelector<HTMLElement>(".force-graph-container canvas");
        if (canvas) canvas.style.cursor = node ? "pointer" : "grab";
      }}
      onNodeClick={(node) => p.onSelect(node as GNode)}
      onBackgroundClick={() => p.onSelect(null)}
      cooldownTicks={140}
      d3VelocityDecay={0.3}
      onEngineStop={() => {
        if (!fitted.current) {
          fitted.current = true;
          fg.current?.zoomToFit(600, 60);
        }
      }}
    />
  );
}
```

**File:** `web/src/app/graph/graph-3d.tsx`
```tsx
"use client";

import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { mix } from "./graph-colors";
import { idOf, neighborMap, type GLink, type GNode, type RenderProps } from "./graph-types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FG = any;

function makeStarfield(dark: boolean) {
  const count = 1800;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 1400 + Math.random() * 1400;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
    pos[i * 3 + 2] = r * Math.cos(ph);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: dark ? 0xc7d2fe : 0x7c3aed, size: 2.2, transparent: true, opacity: dark ? 0.75 : 0.25, depthWrite: false });
  return new THREE.Points(geo, mat);
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function Graph3D(p: RenderProps) {
  const fg = useRef<FG>(null);
  const fitted = useRef(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const neighbors = useMemo(() => neighborMap(p.data.links), [p.data]);
  const bg = p.dark ? "#07060f" : "#f4f3fa";

  // Scene setup: bloom, fog, starfield, auto-rotate that pauses while the user interacts.
  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    const bloom = new UnrealBloomPass(new THREE.Vector2(p.width, p.height), p.dark ? 1.15 : 0.35, 0.65, 0.08);
    g.postProcessingComposer().addPass(bloom);
    const scene = g.scene();
    scene.fog = new THREE.FogExp2(new THREE.Color(bg).getHex(), p.dark ? 0.0011 : 0.0007);
    const stars = makeStarfield(p.dark);
    scene.add(stars);

    const controls = g.controls();
    controls.autoRotate = !p.reducedMotion;
    controls.autoRotateSpeed = 0.55;
    let resume: ReturnType<typeof setTimeout> | undefined;
    const pause = () => {
      controls.autoRotate = false;
      clearTimeout(resume);
      if (!p.reducedMotion) resume = setTimeout(() => (controls.autoRotate = true), 8000);
    };
    controls.addEventListener("start", pause);
    return () => {
      controls.removeEventListener("start", pause);
      clearTimeout(resume);
      g.postProcessingComposer().removePass(bloom);
      scene.remove(stars);
      stars.geometry.dispose();
      (stars.material as THREE.Material).dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.dark, p.reducedMotion]);

  // Re-render once newborn highlights expire.
  useEffect(() => {
    if (!p.data.nodes.some((n) => n.__born)) return;
    const t = setTimeout(() => setTick((x) => x + 1), 3000);
    return () => clearTimeout(t);
  }, [p.data]);

  useEffect(() => {
    const g = fg.current;
    if (!g || !p.command) return;
    if (p.command.kind === "fit") {
      g.zoomToFit(800, 40);
      return;
    }
    const cam = g.camera().position;
    const k = p.command.kind === "zoomIn" ? 0.7 : 1.4;
    g.cameraPosition({ x: cam.x * k, y: cam.y * k, z: cam.z * k }, undefined, 500);
  }, [p.command]);

  useEffect(() => {
    const g = fg.current;
    const n = p.data.nodes.find((x) => x.id === p.selectedId);
    if (!g || !n || n.x == null || n.y == null || n.z == null) return;
    const dist = 110;
    const len = Math.hypot(n.x, n.y, n.z) || 1;
    const k = 1 + dist / len;
    g.cameraPosition({ x: n.x * k, y: n.y * k, z: n.z * k }, { x: n.x, y: n.y, z: n.z }, 1200);
  }, [p.selectedId, p.data]);

  const focus = hovered ?? p.selectedId;
  const isFocusLink = (l: GLink) => !!focus && (idOf(l.source) === focus || idOf(l.target) === focus);
  const now = typeof performance !== "undefined" ? performance.now() : 0;

  return (
    <ForceGraph3D
      ref={fg}
      width={p.width}
      height={p.height}
      graphData={p.data}
      backgroundColor={bg}
      controlType="orbit"
      showNavInfo={false}
      nodeRelSize={4}
      nodeResolution={16}
      nodeOpacity={0.95}
      nodeVal={(n) => {
        const g = n as GNode;
        const fresh = g.__born && now - g.__born < 3000 ? 2.5 : 1;
        return (1 + (g.link_count ?? 0) * 0.7) * fresh * (g.id === focus ? 1.8 : 1);
      }}
      nodeColor={(n) => {
        const g = n as GNode;
        const c = p.colorOf(g);
        if (g.__born && now - g.__born < 3000) return "#ffffff";
        const dimFilter = !!p.highlight && !p.highlight.has(g.id);
        const dimFocus = !!focus && g.id !== focus && !neighbors.get(focus)?.has(g.id);
        return dimFilter ? mix(c, bg, 0.85) : dimFocus ? mix(c, bg, 0.65) : c;
      }}
      nodeLabel={(n) => `<div class="graph-tip">${escapeHtml((n as GNode).title)}</div>`}
      linkColor={(l) => (isFocusLink(l as GLink) ? (p.dark ? "#c4b5fd" : "#6d28d9") : p.dark ? "#475569" : "#a8a3c4")}
      linkOpacity={0.28}
      linkWidth={(l) => (isFocusLink(l as GLink) ? 1.2 : 0)}
      linkDirectionalParticles={p.reducedMotion ? 0 : 2}
      linkDirectionalParticleSpeed={0.005}
      linkDirectionalParticleWidth={1.5}
      linkDirectionalParticleColor={(l) => p.colorOf((l as { source: GNode }).source)}
      onNodeHover={(n) => setHovered((n as GNode | null)?.id ?? null)}
      onNodeClick={(n) => p.onSelect(n as GNode)}
      onBackgroundClick={() => p.onSelect(null)}
      cooldownTicks={160}
      onEngineStop={() => {
        if (!fitted.current) {
          fitted.current = true;
          fg.current?.zoomToFit(800, 40);
        }
      }}
    />
  );
}
```

- [ ] **Step 1:** Delete `web/src/app/graph/graph-view.tsx`; `npm run build` → succeeds.
- [ ] **Step 2: Local visual check** (see Task 8 Step 1 for the local run): Graph 2D and 3D render, toggle persists after reload, click opens panel, Escape closes it, search dims non-matches.
- [ ] **Step 3: Commit**: `git commit -am "feat(web): living graph galaxy with 2D/3D toggle, note panel, live births, graphify communities"`

---

### Task 8: Local verification, then deploy to rnd-agent

- [ ] **Step 1: Run locally** (laptop, real vault, ports that do not clash with the SSH tunnel):

```powershell
cd api; go build -o $env:TEMP\dash-api.exe .
"local-dev-password-123" | & $env:TEMP\dash-api.exe hash-password | Set-Content $env:TEMP\dash.hash
$env:VAULT_PATH="$HOME\SecondBrain"; $env:DASH_PASS_HASH_FILE="$env:TEMP\dash.hash"
$env:ADDR="127.0.0.1:18080"; $env:INTERNAL_ADDR="127.0.0.1:18081"; $env:NEXT_URL="http://127.0.0.1:13000"
Start-Process $env:TEMP\dash-api.exe
cd ..\web; $env:API_URL="http://127.0.0.1:18081"; npm run build; npx next start -H 127.0.0.1 -p 13000
```
Open `http://127.0.0.1:18080` (user `faris`, password `local-dev-password-123`). Screenshot Dashboard, Knowledge, Graph 2D, Graph 3D with headless Brave (`--screenshot`, URL with `faris:local-dev-password-123@`).

- [ ] **Step 2: Push**: `git push -u origin feat/revamp`

- [ ] **Step 3: Server build**

```bash
cd ~/work/obsidian-dashboard && git fetch origin && git checkout feat/revamp && git pull --ff-only
cd api && go build -o ~/.local/bin/obsidian-dashboard-api .
cd ../web && npm ci --no-audit --no-fund && npm run build
mkdir -p ~/.config/obsidian-dashboard && chmod 700 ~/.config/obsidian-dashboard
```

- [ ] **Step 4: Password (user runs once, in Termius):**

```bash
read -rsp "Dashboard password (min 12 chars): " p; echo
printf '%s\n' "$p" | ~/.local/bin/obsidian-dashboard-api hash-password > ~/.config/obsidian-dashboard/pass.hash
unset p; chmod 600 ~/.config/obsidian-dashboard/pass.hash
```

- [ ] **Step 5: Units**

`~/.config/systemd/user/obsidian-api.service` `[Service]` adds:
```
Environment=DASH_PASS_HASH_FILE=%h/.config/obsidian-dashboard/pass.hash
Environment=ADDR=127.0.0.1:8080
Environment=INTERNAL_ADDR=127.0.0.1:8081
Environment=NEXT_URL=http://127.0.0.1:3000
```
`obsidian-web.service` `[Service]` adds `Environment=API_URL=http://127.0.0.1:8081`.
Then: `systemctl --user daemon-reload && systemctl --user restart obsidian-api obsidian-web`.
Verify: `curl -s -o /dev/null -w '%{http_code}' 127.0.0.1:8080/` → `401`; with `-u faris:<pw>` → `200`.

- [ ] **Step 6: Laptop tunnel**: in `~/.ssh/config` host `rnd-dash`, remove `LocalForward 3000 …` (keep 8080). Open `http://localhost:8080`.

- [ ] **Step 7: Tailscale HTTPS (tailnet only)**: user runs once `sudo tailscale set --operator=faris`; then `tailscale serve --bg 8080`. Public Funnel (`tailscale funnel --bg 8080`) only after IT approval.
