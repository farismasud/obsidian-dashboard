# Obsidian Dashboard

High-end web dashboard for your local Obsidian vault. Inspired by [Rowboat](https://github.com/rowboatlabs/rowboat).

![Stack](https://img.shields.io/badge/Go-Gin-00ADD8?style=flat&logo=go) ![Stack](https://img.shields.io/badge/Next.js-16-black?style=flat&logo=next.js) ![Stack](https://img.shields.io/badge/shadcn%2Fui-Tailwind-8b5cf6?style=flat)

## Features

- **Dashboard** — vault stats, recent notes, folder breakdown
- **Projects** — card view of all notes in `Projects/` folder
- **Knowledge** — browse and read notes with rendered markdown + backlinks
- **Graph View** — interactive galaxy/constellation force graph with glowing nodes
- **Search** — full-text search across all notes
- **Dark / Light theme** toggle
- **Live reload** — vault changes in Obsidian reflect in the dashboard automatically (WebSocket)

## Tech Stack

| Layer | Tech |
|-------|------|
| API | Golang + Gin + gorilla/websocket |
| File watch | fsnotify |
| Markdown | goldmark |
| Frontend | Next.js 16 + shadcn/ui + Tailwind |
| Graph | react-force-graph-2d |
| Theme | next-themes |

## Setup

### Prerequisites
- Go 1.21+
- Node.js 18+
- An Obsidian vault at `~/Documents/Obsidian Vault/` (configurable via `VAULT_PATH` env)

### Run

**Terminal 1 — API:**
```bash
cd api
go run main.go
# Running on http://localhost:8080
```

**Terminal 2 — UI:**
```bash
cd web
npm install
npm run dev
# Running on http://localhost:3000
```

Open [localhost:3000](http://localhost:3000).

### Custom vault path
```bash
VAULT_PATH=/path/to/your/vault go run main.go
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/notes` | All notes with metadata |
| GET | `/api/note/*path` | Single note (rendered HTML) |
| GET | `/api/projects` | Notes in Projects/ folder |
| GET | `/api/graph` | Graph nodes + edges |
| GET | `/api/search?q=` | Full-text search |
| GET | `/api/stats` | Vault statistics |
| WS | `/ws` | Live vault change events |
