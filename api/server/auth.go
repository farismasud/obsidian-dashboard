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
