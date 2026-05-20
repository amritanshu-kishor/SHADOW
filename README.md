# Shadow System

A full-stack student productivity system inspired by Solo Leveling-style progression. It turns weekly study work into quests, XP, ranks, streaks, penalties, and focus-lock sessions.

## Features

- Weekly custom quest board with day, duration, XP, completion, and deletion
- Solo Leveling-inspired rank and level progression
- GitHub-style streak heatmap backed by activity history
- Daily penalty mechanic: unfinished daily quests add 120 minutes of study debt
- Focus lock mode with a configurable restricted-app list
- Express API with SQLite persistence
- Production build served from the backend
- Blue system-window UI theme

## Tech Stack

- React
- Vite
- Express
- SQLite via `better-sqlite3`
- Zod validation
- Helmet, CORS, compression, and Morgan middleware

## Getting Started

Install dependencies:

```bash
npm install
```

Run frontend and backend in development:

```bash
npm run dev
```

Development URLs:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3001`

Build and run production mode:

```bash
npm run build
npm start
```

Production URL:

- App and API: `http://localhost:3001`

## Environment

Copy `.env.example` to `.env` if you want to override defaults:

```bash
PORT=3001
CLIENT_ORIGIN=http://localhost:5173
```

The SQLite database is created automatically in `data/shadow-system.sqlite` on first backend startup. The `data/` directory is intentionally ignored by Git.

## API Overview

- `GET /api/health` - backend health check
- `GET /api/state` - full app state
- `POST /api/tasks` - create a task
- `PATCH /api/tasks/:id/toggle` - complete or reopen a task
- `DELETE /api/tasks/:id` - delete a task
- `POST /api/focus/start` - start focus lock for a task
- `POST /api/focus/pause` - pause active focus lock
- `POST /api/day/end` - apply daily completion check and penalty
- `POST /api/penalty/serve` - reduce penalty debt
- `POST /api/restricted-apps` - add restricted app
- `DELETE /api/restricted-apps/:name` - remove restricted app

## Repository Notes

Generated and local-only files are ignored:

- `node_modules/`
- `dist/`
- `data/`
- `.env`
- logs, caches, editor files, and OS metadata

## Production Roadmap

The current focus-lock system stores restricted apps and activates a blocking state in the app. True OS-level app blocking requires a platform-specific layer, such as:

- Desktop helper service for Windows/macOS/Linux
- Browser extension for web distractions
- Mobile device-management integration for phones

The backend is already structured so that native blocker layer can call into the same focus-session and restricted-app APIs.
