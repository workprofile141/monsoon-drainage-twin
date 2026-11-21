import { useEffect, useRef, lazy, Suspense, useState } from 'react';
import { HashRouter, NavLink, Route, Routes, useLocation, Navigate } from 'react-router-dom';
import { useStore } from './store/store';
import { Seg, SimLabel, SevPill, NumInput } from './ui/components';
import { fmtDate, simClock, fmtT, fmt1 } from './ui/format';
import { SEV_RANK, type Severity } from './engine/alerts';
import Dashboard from './pages/Dashboard';
import Overview from './pages/Overview';
import SumpPage from './pages/SumpPage';
import RainfallPage from './pages/Rainfall';
import PumpsPage from './pages/Pumps';
import ScenariosPage from './pages/Scenarios';
import AlertsPage from './pages/Alerts';
import AnalyticsPage from './pages/Analytics';
import ConfigPage from './pages/Config';
import ValidationPage from './pages/Validation';
import ReportsPage from './pages/Reports';
import IntegrationPage from './pages/Integration';

const TwinPage = lazy(() => import('./pages/Twin'));
const TwinHome = lazy(() => import('./pages/TwinHome'));

/** The simulation clock lives here — above the router — so navigation never resets it. */
function SimulationLoop() {
  const last = useRef(performance.now());
  useEffect(() => {
    useStore.getState().recompute();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(1000, now - last.current);
      last.current = now;
      useStore.getState().tick(dt);
    }, 100);
    return () => clearInterval(id);
  }, []);
  return null;
}

function NavRecorder() {
  const loc = useLocation();
  useEffect(() => { useStore.getState().recordNav(loc.pathname); }, [loc.pathname]);
  return null;
}

const SIMPLE_SPEEDS = [{ v: 1, l: 'Real time' }, { v: 300, l: 'Fast' }, { v: 3600, l: 'Very fast' }];

function SimBar() {
  const s = useStore();
  const [more, setMore] = useState(false);
  const I = s.derived.live?.intensity ?? 0;
  const worst = s.derived.alerts.reduce<Severity>((w, a) => (SEV_RANK[a.severity] > SEV_RANK[w] && a.category === 'operational' ? a.severity : w), 'normal');
  const nOp = s.derived.alerts.filter((a) => a.category === 'operational').length;
  return (
    <header className="topbar">
      <div>
        <div className="clock">{fmtDate(simClock(s.sim.startISO, s.sim.t))}</div>
        <div className="muted small">{fmtT(s.sim.t)} · {s.running ? <span className="ok">● running</span> : <span>paused</span>}</div>
      </div>
      <div className="row">
        {!s.running
          ? <button className="primary" onClick={s.start}>{s.sim.t > 0 ? '▶ Resume' : '▶ Start'}</button>
          : <button onClick={s.pause}>❚❚ Pause</button>}
        <button onClick={() => { if (confirm('Reset the simulation? The current run is archived in history.')) s.reset(true); }}>⟲ Reset</button>
      </div>
      <Seg value={SIMPLE_SPEEDS.some((x) => x.v === s.speed) ? s.speed : -1} onChange={s.setSpeed} options={SIMPLE_SPEEDS} />
      <div className="row"><span style={{ fontSize: 18 }}>{I > 0 ? '🌧️' : '☀️'}</span><b className="num">{fmt1(I)}</b><span className="muted small">mm/hr</span></div>
      <button className="small" onClick={() => setMore(!more)} aria-expanded={more}>{more ? 'Less ▴' : 'More controls ▾'}</button>
      <div className="row" style={{ marginLeft: 'auto' }}>
        <NavLink to="/alerts" style={{ textDecoration: 'none' }}><SevPill s={worst} text={nOp ? `${nOp} alert${nOp > 1 ? 's' : ''}` : 'All clear'} /></NavLink>
        <SimLabel />
      </div>
      {more && (
        <div className="row" style={{ width: '100%', gap: 16, paddingTop: 6, borderTop: '1px solid var(--hairline)' }}>
          <div className="row"><span className="muted small">Speed</span>
            <Seg value={s.speed} onChange={s.setSpeed} options={[1, 60, 300, 900, 3600, 14400].map((v) => ({ v, l: v === 1 ? '1×' : v < 3600 ? `${v / 60} min/s` : `${v / 3600} h/s` }))} />
          </div>
          <div className="row"><span className="muted small">Δt</span>
            <Seg value={s.config.sim.dtMinutes} onChange={(m) => s.setDt(m)} options={[1, 5, 15].map((v) => ({ v: v as 1 | 5 | 15, l: `${v} min` }))} />
          </div>
          <div className="row"><span className="muted small">Fast-forward</span>
            {[1, 6, 24].map((h) => <button key={h} className="small" onClick={() => s.fastForward(h)}>+{h} h</button>)}
          </div>
          <div className="row"><span className="muted small">Rain now</span>
            <NumInput value={s.rainfall.mode === 'manual' ? s.rainfall.manualIntensity : I} min={0} max={500} width={70}
              onCommit={(v) => s.setRainfall({ mode: 'manual', manualIntensity: v }, `Live rainfall set to ${v} mm/hr (manual)`)} /><span className="muted small">mm/hr</span>
            <button className="small" onClick={() => s.addRainEvent({ label: 'Sudden extreme rainfall', startH: s.sim.t, durationH: 2, intensity: 80 })}>⚡ Cloudburst</button>
          </div>
        </div>
      )}
    </header>
  );
}

const MAIN_NAV: [string, string][] = [['/', '⛏️  Sump digital twin'], ['/overview', '🏠  Overview'], ['/twin', '🧊  All sumps 3D'], ['/sump/A', '💧  Nilkanth A'], ['/sump/B', '💧  Nilkanth B'], ['/sump/C', '💧  KNR C'], ['/sump/D', '💧  Departmental D']];
const MORE_NAV: ([string, string] | string)[] = [
  'Controls', ['/rainfall', 'Rainfall simulator'], ['/pumps', 'Pump management'], ['/scenarios', 'What-if scenarios'],
  'Monitoring', ['/detailed', 'Detailed dashboard'], ['/alerts', 'Alerts & thresholds'], ['/analytics', 'Analytics'], ['/reports', 'Reports'],
  'Engineering', ['/config', 'Configuration & data'], ['/validation', 'Validation'], ['/integration', 'Sensors & readings'],
];

function Sidebar() {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('nav-more') === '1'; } catch { return false; } });
  const loc = useLocation();
  const inMore = MORE_NAV.some((n) => typeof n !== 'string' && n[0] === loc.pathname);
  const show = open || inMore;
  const toggle = () => { const v = !show; setOpen(v); try { localStorage.setItem('nav-more', v ? '1' : '0'); } catch { /* ignore */ } };
  return (
    <aside className="sidebar">
      <div className="brand">Monsoon Twin<small>Mine drainage · 4 sumps</small></div>
      <nav className="nav">
        {MAIN_NAV.map((n) => <NavLink key={n[0]} to={n[0]} end={n[0] === '/'}>{n[1]}</NavLink>)}
        <button className="nav-toggle" onClick={toggle} aria-expanded={show}>{show ? '▾' : '▸'} More tools</button>
        {show && MORE_NAV.map((n, i) => typeof n === 'string'
          ? <div key={i} className="sep" style={{ paddingTop: 8 }}>{n}</div>
          : <NavLink key={n[0]} to={n[0]}>{n[1]}</NavLink>)}
      </nav>
      <p className="muted small" style={{ padding: '14px 12px' }}>Advisory only — never operates real pumps.</p>
    </aside>
  );
}

export default function App() {
  return (
    <HashRouter>
      <SimulationLoop />
      <NavRecorder />
      <div className="app">
        <Sidebar />
        <SimBar />
        <main className="main">
          <Suspense fallback={<div className="muted">Loading 3D engine…</div>}>
            <Routes>
              <Route path="/" element={<TwinHome />} />
              <Route path="/overview" element={<Overview />} />
              <Route path="/detailed" element={<Dashboard />} />
              <Route path="/sump/:id" element={<SumpPage />} />
              <Route path="/twin" element={<TwinPage />} />
              <Route path="/rainfall" element={<RainfallPage />} />
              <Route path="/pumps" element={<PumpsPage />} />
              <Route path="/scenarios" element={<ScenariosPage />} />
              <Route path="/alerts" element={<AlertsPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/config" element={<ConfigPage />} />
              <Route path="/validation" element={<ValidationPage />} />
              <Route path="/integration" element={<IntegrationPage />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </HashRouter>
  );
}
