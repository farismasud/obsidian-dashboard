# Obsidian Dashboard Revamp — Design

Date: 2026-11-20 · Status: approved

## Goal
Make the dashboard usable from any device and make it look and feel alive:
a single authenticated public entry point, a living 2D/3D knowledge graph,
and a redesigned, animated UI.

## 1. Architecture & access
- The Go server is the only entry point (`127.0.0.1:8080`):
  - `/api/*` and `/ws` → existing handlers.
  - everything else → reverse proxy (`net/http/httputil.ReverseProxy`) to Next.js on `127.0.0.1:3000`.
- Next.js listens on `127.0.0.1:3000` only. Browser code uses relative URLs (`/api/...`, `/ws`);
  server components keep calling `API_URL` (default `http://127.0.0.1:8080`).
- The CORS middleware is removed (same origin).
- **Auth: HTTP Basic Auth gate** in Go, in front of all routes (pages, API, WS).
  - One credential pair. Username from `DASH_USER` (default `faris`), password checked against
    a bcrypt hash read from the file at `DASH_PASS_HASH_FILE` (e.g. `~/.config/obsidian-dashboard/pass.hash`, mode 600).
    The password is deliberately not the Linux account password.
  - If the hash file is missing, the server refuses to start (fail closed).
  - Constant-time username compare; bcrypt compare for password.
  - Rate limit: after 5 failed attempts from one IP within 10 minutes, that IP gets `429` for 10 minutes.
    Client IP from `X-Forwarded-For` only when the request comes from loopback (Tailscale serve/funnel and the SSH tunnel both arrive on loopback).
  - A small CLI mode `obsidian-dashboard-api hash-password` reads a password from stdin and prints the bcrypt hash.
- Exposure: Tailscale Funnel → `https://rnd-agent.<tailnet>.ts.net` → `127.0.0.1:8080`.
  Funnel is switched on only after IT approval. Until then: Tailscale serve (tailnet only) and the SSH tunnel (`ssh -N rnd-dash`, forwards 8080).

## 2. Graph Galaxy
- Toggle **2D / 3D**, remembered in `localStorage`.
- **3D** (`react-force-graph-3d`): slow auto-rotate that pauses on user interaction, bloom glow,
  directional particles along links, camera fly-to on node click, distance fog.
- **2D** (`react-force-graph-2d`): screen-space starfield with twinkle (not affected by pan/zoom),
  subtle node pulse, link particles, hover highlights neighbors and dims the rest,
  labels sized in screen pixels (no giant labels at high zoom).
- Shared for both modes:
  - Click a node → side panel with note preview (title, folder, tags, excerpt/rendered HTML, backlinks) and an "Open" link; no page navigation.
  - **Live updates**: on WS `reload`, refetch graph and merge in place; new nodes play a "birth" animation.
  - **Color by Folder or graphify Community.** New endpoint `GET /api/graphify` returns
    `{ available: bool, communities: { [notePath]: { id, label } } }` built from `graphify-out/graph.json`
    (maps graphify nodes to vault note paths via their source file). The Community option is shown only when `available`.
  - Core-mode count comes from data (no hardcoded `36`).
- `prefers-reduced-motion`: no auto-rotate, no particles, no pulse.

## 3. App-wide UI
- Fix fonts: Geist Sans + Geist Mono via `next/font` (current UI falls back to Times).
- Color system: dark-first, near-black background with violet primary and cyan accent, matching graph colors; light theme kept.
- Brand mark replacing the plain "O" box; clear type hierarchy (title / body / meta).
- Motion: page enter transition, staggered card entrance, animated stat counters,
  sliding active indicator in the sidebar, pulsing "live" dot when the vault changes.
- Dashboard: stat cards redesigned, 12-week activity heatmap (notes per day by `mod_time`), recent notes, folder bars.
- Knowledge: useful empty state (recent notes + quick search) instead of a blank pane.
- **Ctrl/Cmd+K** command palette: search notes and jump to pages.
- Respect `prefers-reduced-motion` everywhere.

## Out of scope
Per-user accounts, editing notes from the web, mobile-specific layouts.

## Testing
- `go test ./...`: router sends `/api/*` to handlers and other paths to the proxy;
  auth rejects missing/wrong credentials, accepts correct ones; rate limiter blocks after 5 failures.
- `npm run build` passes (type check + lint as part of build).
- Visual check with headless browser screenshots of Dashboard, Knowledge, Graph 2D, Graph 3D.

## Rollout
Develop on the laptop against a local vault (never committed; the repo is public).
Commit and push to `farismasud/obsidian-dashboard`, then on `rnd-agent`: pull, build, update systemd units
(API gets auth env, web binds 127.0.0.1), restart. Tunnel config switches to port 8080 only.
