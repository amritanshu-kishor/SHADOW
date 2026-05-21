import compression from 'compression';
import cors from 'cors';
import Database from 'better-sqlite3';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'shadow-system.sqlite'));
const app = express();
const port = Number(process.env.PORT || 3001);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    minutes INTEGER NOT NULL CHECK (minutes >= 5),
    day INTEGER NOT NULL CHECK (day BETWEEN 0 AND 6),
    xp INTEGER NOT NULL CHECK (xp >= 1),
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS restricted_apps (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS focus_sessions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed')),
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TEXT,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    date TEXT PRIMARY KEY,
    tasks_completed INTEGER NOT NULL DEFAULT 0,
    xp INTEGER NOT NULL DEFAULT 0,
    penalty_applied INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

ensureRestrictedAppColumns();
seedDatabase();

function ensureRestrictedAppColumns() {
  const cols = db.prepare("PRAGMA table_info(restricted_apps)").all().map((c) => c.name);
  try {
    if (!cols.includes('type')) {
      db.prepare("ALTER TABLE restricted_apps ADD COLUMN type TEXT NOT NULL DEFAULT 'app'").run();
    }
    if (!cols.includes('path')) {
      db.prepare("ALTER TABLE restricted_apps ADD COLUMN path TEXT").run();
    }
  } catch (err) {
    console.warn('Could not alter restricted_apps table:', err?.message ?? err);
  }
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true }));
app.use(compression());
app.use(express.json({ limit: '64kb' }));
app.use(morgan('tiny'));

const taskSchema = z.object({
  title: z.string().trim().min(1).max(100),
  minutes: z.coerce.number().int().min(5).max(720),
  day: z.coerce.number().int().min(0).max(6)
});

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, service: 'shadow-system', time: new Date().toISOString() });
});

app.get('/api/state', (_request, response) => {
  response.json(readState());
});

app.post('/api/tasks', (request, response) => {
  const task = taskSchema.parse(request.body);
  db.prepare('INSERT INTO tasks (id, title, minutes, day, xp) VALUES (?, ?, ?, ?, ?)').run(
    crypto.randomUUID(),
    task.title,
    task.minutes,
    task.day,
    xpForMinutes(task.minutes)
  );
  response.status(201).json(readState());
});

app.patch('/api/tasks/:id/toggle', (request, response) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(request.params.id);
  if (!task) return response.status(404).json({ error: 'Task not found' });

  const nextCompleted = task.completed ? 0 : 1;
  db.prepare('UPDATE tasks SET completed = ?, completed_at = ? WHERE id = ?').run(
    nextCompleted,
    nextCompleted ? new Date().toISOString() : null,
    request.params.id
  );

  if (nextCompleted) {
    addTodayActivity(1, task.xp);
    db.prepare("UPDATE focus_sessions SET status = 'completed', ended_at = CURRENT_TIMESTAMP WHERE task_id = ? AND status = 'active'").run(task.id);
  } else {
    addTodayActivity(-1, -task.xp);
  }

  response.json(readState());
});

app.delete('/api/tasks/:id', (request, response) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(request.params.id);
  response.json(readState());
});

app.post('/api/focus/start', (request, response) => {
  const { taskId } = z.object({ taskId: z.string().min(1) }).parse(request.body);
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
  if (!task) return response.status(404).json({ error: 'Task not found' });

  db.prepare("UPDATE focus_sessions SET status = 'paused', ended_at = CURRENT_TIMESTAMP WHERE status = 'active'").run();
  db.prepare('INSERT INTO focus_sessions (id, task_id, status) VALUES (?, ?, ?)').run(crypto.randomUUID(), taskId, 'active');
  response.json(readState());
});

app.post('/api/focus/pause', (_request, response) => {
  db.prepare("UPDATE focus_sessions SET status = 'paused', ended_at = CURRENT_TIMESTAMP WHERE status = 'active'").run();
  response.json(readState());
});

app.post('/api/day/end', (_request, response) => {
  const unfinished = todayTasks().filter((task) => !task.completed).length;
  if (unfinished > 0) {
    setPenalty(getPenalty() + 120);
    db.prepare(`
      INSERT INTO activity_log (date, tasks_completed, xp, penalty_applied)
      VALUES (?, 0, 0, 1)
      ON CONFLICT(date) DO UPDATE SET penalty_applied = 1
    `).run(dateKey());
  }
  response.json(readState());
});

app.post('/api/penalty/serve', (request, response) => {
  const { minutes } = z.object({ minutes: z.coerce.number().int().min(5).max(240).default(30) }).parse(request.body ?? {});
  setPenalty(Math.max(0, getPenalty() - minutes));
  response.json(readState());
});

app.post('/api/restricted-apps', (request, response) => {
  const bodySchema = z.object({ name: z.string().trim().min(1).max(180), type: z.enum(['app', 'local', 'url']).optional(), path: z.string().optional() });
  const { name, type, path: maybePath } = bodySchema.parse(request.body);

  // Auto-detect type when not provided
  let finalType = type;
  let finalPath = maybePath ?? null;
  if (!finalType) {
    const n = name.trim();
    if (/^https?:\/\//i.test(n)) {
      finalType = 'url';
      finalPath = null;
    } else if (/^[A-Za-z]:\\|\\|\.exe$/i.test(n) || n.includes('\\') || n.endsWith('.exe')) {
      finalType = 'local';
      finalPath = n;
    } else {
      finalType = 'app';
    }
  }

  db.prepare('INSERT OR IGNORE INTO restricted_apps (id, name, type, path) VALUES (?, ?, ?, ?)').run(crypto.randomUUID(), name.trim(), finalType, finalPath);
  response.status(201).json(readState());
});

app.delete('/api/restricted-apps/:name', (request, response) => {
  db.prepare('DELETE FROM restricted_apps WHERE name = ?').run(decodeURIComponent(request.params.name));
  response.json(readState());
});

const distPath = path.join(root, 'dist');
app.use(express.static(distPath));
app.get(/.*/, (_request, response) => {
  response.sendFile(path.join(distPath, 'index.html'));
});

app.use((error, _request, response, _next) => {
  if (error instanceof z.ZodError) {
    return response.status(400).json({ error: 'Validation failed', details: error.issues });
  }
  console.error(error);
  response.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
  console.log(`Shadow System listening on http://localhost:${port}`);
});

function seedDatabase() {
  const seedCount = db.prepare('SELECT COUNT(*) AS count FROM tasks').get().count;
  if (seedCount > 0) return;

  const today = todayIndex();
  const insertTask = db.prepare('INSERT INTO tasks (id, title, minutes, day, xp) VALUES (?, ?, ?, ?, ?)');
  [
    ['Daily dungeon: focused study', 90, today],
    ['Mana recovery: active revision', 45, today],
    ['Combat drill: problem set', 60, (today + 1) % 7],
    ['Weekly gate: mock test', 120, 5]
  ].forEach(([title, minutes, day]) => insertTask.run(crypto.randomUUID(), title, minutes, day, xpForMinutes(minutes)));

  const insertApp = db.prepare('INSERT OR IGNORE INTO restricted_apps (id, name) VALUES (?, ?)');
  ['Instagram', 'YouTube Shorts', 'Netflix', 'Steam', 'Discord'].forEach((name) => {
    insertApp.run(crypto.randomUUID(), name);
  });

  setPenalty(0);
}

function readState() {
  const tasks = db.prepare('SELECT id, title, minutes, day, xp, completed, created_at, completed_at FROM tasks ORDER BY day, created_at').all()
    .map((task) => ({ ...task, completed: Boolean(task.completed) }));
  const restrictedApps = db.prepare('SELECT id, name, type, path, created_at FROM restricted_apps ORDER BY name').all();
  const activeSession = db.prepare(`
    SELECT focus_sessions.id, focus_sessions.task_id AS taskId, focus_sessions.started_at AS startedAt, tasks.title
    FROM focus_sessions
    JOIN tasks ON tasks.id = focus_sessions.task_id
    WHERE focus_sessions.status = 'active'
    ORDER BY focus_sessions.started_at DESC
    LIMIT 1
  `).get() ?? null;

  const totalXp = tasks.filter((task) => task.completed).reduce((sum, task) => sum + task.xp, 0);
  const level = levelFromXp(totalXp);
  const todaysTasks = tasks.filter((task) => task.day === todayIndex());
  const completedToday = todaysTasks.filter((task) => task.completed).length;

  return {
    tasks,
    restrictedApps,
    activeSession,
    streaks: readStreaks(),
    penaltyMinutes: getPenalty(),
    stats: {
      totalXp,
      level,
      rank: rankForLevel(level.level),
      todayTasks: todaysTasks.length,
      completedToday,
      completionRate: tasks.length ? Math.round((tasks.filter((task) => task.completed).length / tasks.length) * 100) : 0
    }
  };
}

function todayTasks() {
  return db.prepare('SELECT * FROM tasks WHERE day = ?').all(todayIndex());
}

function addTodayActivity(tasksCompleted, xp) {
  db.prepare(`
    INSERT INTO activity_log (date, tasks_completed, xp)
    VALUES (?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      tasks_completed = MAX(0, tasks_completed + excluded.tasks_completed),
      xp = MAX(0, xp + excluded.xp)
  `).run(dateKey(), tasksCompleted, xp);
}

function readStreaks() {
  const rows = db.prepare('SELECT date, tasks_completed FROM activity_log WHERE date >= ? ORDER BY date').all(dateKey(-69));
  const byDate = new Map(rows.map((row) => [row.date, row.tasks_completed]));
  return Array.from({ length: 70 }, (_, index) => {
    const date = dateKey(index - 69);
    return { date, value: Math.min(4, byDate.get(date) ?? 0) };
  });
}

function getPenalty() {
  return Number(db.prepare("SELECT value FROM settings WHERE key = 'penaltyMinutes'").get()?.value ?? 0);
}

function setPenalty(minutes) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('penaltyMinutes', String(minutes));
}

function dateKey(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function todayIndex() {
  return (new Date().getDay() + 6) % 7;
}

function xpForMinutes(minutes) {
  return Math.max(25, Math.round(minutes * 1.55));
}

function levelFromXp(xp) {
  const level = Math.floor(Math.sqrt(xp / 120)) + 1;
  const currentFloor = 120 * (level - 1) ** 2;
  const nextFloor = 120 * level ** 2;
  return {
    level,
    current: xp - currentFloor,
    needed: nextFloor - currentFloor,
    percent: Math.min(100, Math.round(((xp - currentFloor) / (nextFloor - currentFloor)) * 100))
  };
}

function rankForLevel(level) {
  if (level >= 15) return 'National Rank';
  if (level >= 12) return 'S-Rank';
  if (level >= 8) return 'A-Rank';
  if (level >= 5) return 'B-Rank';
  if (level >= 3) return 'C-Rank';
  return 'E-Rank';
}

// Background enforcer: when a focus session is active, attempt to terminate local restricted apps
function enforceRestrictedApps() {
  try {
    const active = db.prepare("SELECT 1 FROM focus_sessions WHERE status = 'active' LIMIT 1").get();
    if (!active) return;

    const locals = db.prepare("SELECT id, name, type, path FROM restricted_apps WHERE type IN ('local','app')").all();
    if (!locals || locals.length === 0) return;

    exec('tasklist /FO CSV', (err, stdout) => {
      if (err || !stdout) return;
      const lines = stdout.split(/\r?\n/).filter(Boolean);
      // skip header
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const m = line.match(/^"([^"]+)","(\d+)","([^"]+)","?(\d+)"?,"([^"]+)"$/);
        if (!m) continue;
        const image = m[1];
        const pid = m[2];
        const imgLower = image.toLowerCase();

        locals.forEach((appEntry) => {
          const nameLower = (appEntry.path ?? appEntry.name).toLowerCase();
          const base = path.basename(appEntry.path ?? appEntry.name).toLowerCase();
          if (imgLower.includes(nameLower) || imgLower.includes(base) || base.includes(imgLower)) {
            // kill this pid
            exec(`taskkill /PID ${pid} /F`, (killErr) => {
              if (killErr) {
                // non-fatal
              } else {
                console.log(`Enforcer: terminated ${image} (pid ${pid}) for restriction ${appEntry.name}`);
              }
            });
          }
        });
      }
    });
  } catch (e) {
    // do not crash the server
    console.warn('Enforcer error', e?.message ?? e);
  }
}

// Run enforcer every 5s
setInterval(enforceRestrictedApps, 5000);
