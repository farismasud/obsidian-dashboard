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
