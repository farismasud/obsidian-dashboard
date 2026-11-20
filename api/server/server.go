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
