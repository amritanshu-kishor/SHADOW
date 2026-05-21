import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  Ban,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Flame,
  Loader2,
  Lock,
  Plus,
  Shield,
  Sparkles,
  Swords,
  Target,
  Trash2,
  Trophy,
  Zap
} from 'lucide-react';
import './styles.css';

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const todayIndex = (new Date().getDay() + 6) % 7;
const emptyState = {
  tasks: [],
  restrictedApps: [],
  streaks: [],
  penaltyMinutes: 0,
  activeSession: null,
  stats: {
    rank: 'E-Rank',
    totalXp: 0,
    todayTasks: 0,
    completedToday: 0,
    completionRate: 0,
    level: { level: 1, current: 0, needed: 120, percent: 0 }
  }
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'System request failed');
  }
  return response.json();
}

function App() {
  const [state, setState] = useState(emptyState);
  const [taskDraft, setTaskDraft] = useState({ title: '', minutes: 50, day: todayIndex });
  const [appDraft, setAppDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyAction, setBusyAction] = useState('');

  useEffect(() => {
    refreshState();
  }, []);

  const activeTask = useMemo(
    () => state.tasks.find((task) => task.id === state.activeSession?.taskId),
    [state.activeSession, state.tasks]
  );

  const todayTasks = state.tasks.filter((task) => task.day === todayIndex);
  const weekMinutes = state.tasks.reduce((sum, task) => sum + task.minutes, 0);
  const lockedApps = state.restrictedApps.map((app) => app.name);

  async function refreshState() {
    try {
      setError('');
      setState(await api('/api/state'));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  async function runAction(name, callback) {
    try {
      setBusyAction(name);
      setError('');
      setState(await callback());
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyAction('');
    }
  }

  function addTask(event) {
    event.preventDefault();
    if (!taskDraft.title.trim()) return;
    runAction('add-task', () => api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(taskDraft)
    }));
    setTaskDraft({ title: '', minutes: 50, day: todayIndex });
  }

  function toggleTask(id) {
    runAction(`toggle-${id}`, () => api(`/api/tasks/${id}/toggle`, { method: 'PATCH' }));
  }

  function deleteTask(id) {
    runAction(`delete-${id}`, () => api(`/api/tasks/${id}`, { method: 'DELETE' }));
  }

  function beginTask(id) {
    runAction(`focus-${id}`, () => api('/api/focus/start', {
      method: 'POST',
      body: JSON.stringify({ taskId: id })
    }));
  }

  function pauseFocus() {
    runAction('pause-focus', () => api('/api/focus/pause', { method: 'POST' }));
  }

  function applyPenalty() {
    runAction('end-day', () => api('/api/day/end', { method: 'POST' }));
  }

  function clearPenalty() {
    runAction('serve-penalty', () => api('/api/penalty/serve', {
      method: 'POST',
      body: JSON.stringify({ minutes: 30 })
    }));
  }

  function addRestrictedApp(event) {
    event.preventDefault();
    if (!appDraft.trim()) return;
    runAction('add-app', () => api('/api/restricted-apps', {
      method: 'POST',
      body: JSON.stringify({ name: appDraft })
    }));
    setAppDraft('');
  }

  function removeRestrictedApp(name) {
    runAction(`remove-${name}`, () => api(`/api/restricted-apps/${encodeURIComponent(name)}`, { method: 'DELETE' }));
  }

  if (loading) {
    return (
      <main className="loading-screen">
        <Loader2 className="spin" size={34} />
        <strong>Initializing System</strong>
      </main>
    );
  }

  return (
    <main className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Swords size={23} /></div>
          <div>
            <span>Student Hunter</span>
            <strong>Blue System</strong>
          </div>
        </div>
        <nav>
          <a className="active"><Target size={18} /> Quests</a>
          <a><Flame size={18} /> Streak Gate</a>
          <a><Shield size={18} /> Focus Lock</a>
          <a><Trophy size={18} /> Rank Path</a>
        </nav>
        <div className="sidebar-status">
          <Sparkles size={18} />
          <span>Backend online</span>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">System notification</p>
            <h1>Daily quests are active.</h1>
            <span className="subline">Clear the gate, protect your streak, level with evidence.</span>
          </div>
          <button className="ghost" disabled={busyAction === 'end-day'} onClick={applyPenalty}>
            <Clock3 size={18} />
            End Day Check
          </button>
        </header>

        {error && <div className="system-alert">{error}</div>}

        <section className="hero-grid">
          <div className="rank-panel system-window">
            <div className="rank-row">
              <div>
                <p className="eyebrow">Current rank</p>
                <h2>{state.stats.rank}</h2>
              </div>
              <div className="level-orb">Lv {state.stats.level.level}</div>
            </div>
            <div className="xp-bar"><span style={{ width: `${state.stats.level.percent}%` }} /></div>
            <p className="muted">{state.stats.level.current} / {state.stats.level.needed} XP toward next level</p>
          </div>
          <Stat icon={<Check />} label="Today" value={`${state.stats.completedToday}/${state.stats.todayTasks}`} accent="cyan" />
          <Stat icon={<Activity />} label="Completion" value={`${state.stats.completionRate}%`} accent="violet" />
          <Stat icon={<Zap />} label="Penalty" value={`${state.penaltyMinutes}m`} accent="red" />
        </section>

        <section className="content-grid">
          <div className="panel quests">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Weekly quest board</p>
                <h2>Custom missions</h2>
              </div>
              <CalendarDays size={22} />
            </div>

            <form className="task-form" onSubmit={addTask}>
              <input value={taskDraft.title} onChange={(event) => setTaskDraft({ ...taskDraft, title: event.target.value })} placeholder="Add a mission" maxLength="100" />
              <select value={taskDraft.day} onChange={(event) => setTaskDraft({ ...taskDraft, day: Number(event.target.value) })}>
                {days.map((day, index) => <option key={day} value={index}>{day}</option>)}
              </select>
              <input type="number" min="5" max="720" step="5" value={taskDraft.minutes} onChange={(event) => setTaskDraft({ ...taskDraft, minutes: Number(event.target.value) })} />
              <button disabled={busyAction === 'add-task'}><Plus size={18} /> Add</button>
            </form>

            <div className="week-tabs">
              {days.map((day, index) => (
                <span className={index === todayIndex ? 'today' : ''} key={day}>{day}</span>
              ))}
            </div>

            <div className="task-list">
              {state.tasks.map((task) => (
                <article className={`task ${task.completed ? 'done' : ''}`} key={task.id}>
                  <button className="check" disabled={busyAction === `toggle-${task.id}`} onClick={() => toggleTask(task.id)} aria-label="Toggle task">
                    {task.completed && <Check size={16} />}
                  </button>
                  <div>
                    <strong>{task.title}</strong>
                    <span>{days[task.day]} | {task.minutes} min | {task.xp} XP</span>
                  </div>
                  <button className="icon-btn" disabled={task.completed || busyAction === `focus-${task.id}`} onClick={() => beginTask(task.id)} title="Begin focus lock">
                    <Lock size={17} />
                  </button>
                  <button className="icon-btn danger" disabled={busyAction === `delete-${task.id}`} onClick={() => deleteTask(task.id)} title="Delete task">
                    <Trash2 size={17} />
                  </button>
                </article>
              ))}
            </div>
          </div>

          <div className="side-stack">
            <div className="panel metric-panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Weekly loadout</p>
                  <h2>{weekMinutes} minutes</h2>
                </div>
                <Trophy size={22} />
              </div>
              <div className="loadout-grid">
                <span>{state.stats.totalXp}<small>Total XP</small></span>
                <span>{todayTasks.length}<small>Today</small></span>
                <span>{state.tasks.length}<small>Quests</small></span>
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Contribution map</p>
                  <h2>Streak gate</h2>
                </div>
                <Flame size={22} />
              </div>
              <div className="heatmap">
                {state.streaks.map((cell) => <span className={`heat heat-${cell.value}`} title={cell.date} key={cell.date} />)}
              </div>
              <p className="muted">Darker cells mean more quests cleared that day.</p>
            </div>

            <div className="panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Focus lock</p>
                  <h2>Restricted apps</h2>
                </div>
                <Ban size={22} />
              </div>
              <form className="app-form" onSubmit={addRestrictedApp}>
                <input value={appDraft} onChange={(event) => setAppDraft(event.target.value)} placeholder="App path or website (http://... or C:\\path\\app.exe)" maxLength="180" />
                <button disabled={busyAction === 'add-app'} aria-label="Add restricted app"><Plus size={18} /></button>
              </form>
              <div className="restricted-list">
                {state.restrictedApps.map((app) => (
                  <button key={app.id} onClick={() => removeRestrictedApp(app.name)}>
                    <Ban size={14} /> {app.name} <small className="muted">{app.type ?? 'app'}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="panel penalty">
              <div>
                <p className="eyebrow">Penalty chamber</p>
                <h2>{state.penaltyMinutes ? `${state.penaltyMinutes} minutes owed` : 'No debt'}</h2>
                <p className="muted">Miss daily completion and tomorrow receives an extra 2-hour study debt.</p>
              </div>
              <button className="ghost" disabled={busyAction === 'serve-penalty'} onClick={clearPenalty}><ChevronRight size={18} /> Serve 30m</button>
            </div>
          </div>
        </section>
      </section>

      {activeTask && (
        <div className="focus-lock">
          <div className="lock-card">
            <Lock size={32} />
            <p className="eyebrow">Restricted mode active</p>
            <h2>{activeTask.title}</h2>
            <p>{lockedApps.length ? lockedApps.join(', ') : 'No restricted apps configured'} are locked while this task is active.</p>
            <div className="lock-actions">
              <button onClick={() => toggleTask(activeTask.id)}><Check size={18} /> Complete</button>
              <button className="ghost" onClick={pauseFocus}>Pause Lock</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Stat({ icon, label, value, accent }) {
  return (
    <div className={`stat ${accent}`}>
      <div>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
