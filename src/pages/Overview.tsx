/**
 * SIMPLE OVERVIEW — the at-a-glance home screen.
 * Per sump: how full, which pumps are working (tap to switch), how long to empty, and a one-line verdict.
 * Mine-wide: is it raining, will it continue, and a single rain control.
 * All numbers come from the same engine as the detailed screens.
 */
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/store';
import { useAllSumpViews } from '../ui/hooks';
import { SevPill } from '../ui/components';
import { dur, fmt0, fmtDate, simClock, SUMP_COLOR } from '../ui/format';
import { rainOutlook } from '../engine/rainfall';
import { pumpsNeeded, isRunning } from '../engine/pumps';
import type { Pump } from '../engine/types';
import { SEV_RANK, type Severity } from '../engine/alerts';

const RAIN_PRESETS = [
  { l: 'Dry', v: 0 }, { l: 'Light', v: 5 }, { l: 'Moderate', v: 15 }, { l: 'Heavy', v: 40 }, { l: 'Extreme', v: 80 },
];

function rainWord(i: number) {
  if (i <= 0) return { icon: '☀️', word: 'Not raining' };
  if (i < 7.5) return { icon: '🌦️', word: 'Light rain' };
  if (i < 35) return { icon: '🌧️', word: 'Moderate rain' };
  if (i < 60) return { icon: '🌧️', word: 'Heavy rain' };
  return { icon: '⛈️', word: 'Extreme rain' };
}

export default function Overview() {
  const s = useStore();
  const views = useAllSumpViews();
  const I = s.derived.live?.intensity ?? 0;
  const out = rainOutlook(s.rainfall, s.sim.t);
  const rw = rainWord(I);
  // how long it has been raining without a break (from simulated history)
  let sinceH: number | null = null;
  if (I > 0) {
    sinceH = s.sim.t;
    for (let i = s.history.length - 1; i >= 0; i--) if (s.history[i].rain <= 0) { sinceH = s.sim.t - s.history[i].t; break; }
  }
  const at = (h: number) => fmtDate(simClock(s.sim.startISO, s.sim.t + h));
  const continuity = !out.raining
    ? (out.startsInH != null ? `Rain expected in ${dur(out.startsInH)} (${at(out.startsInH)})` : `No rain expected in the next ${out.lookAheadH} h`)
    : out.continuous
      ? (out.manualIndefinite ? 'Continuous — keeps raining until you change it' : `Continuous — no break in the next ${out.lookAheadH} h`)
      : `Expected to stop in ${dur(out.stopsInH)} (${at(out.stopsInH!)})`;
  const manualVal = s.rainfall.mode === 'manual' ? s.rainfall.manualIntensity : I;

  return (
    <div>
      <div className="page-head">
        <div><h1>Overview</h1><p>Rain, pumps and time to empty for each sump — at a glance.</p></div>
        <div className="row">
          {!s.running
            ? <button className="primary" onClick={s.start}>▶ {s.sim.t > 0 ? 'Resume' : 'Start'} simulation</button>
            : <button onClick={s.pause}>❚❚ Pause</button>}
        </div>
      </div>

      <section className="glass ov-hero">
        <div className="row" style={{ gap: 18, alignItems: 'center' }}>
          <div className="ov-rain-icon" aria-hidden>{rw.icon}</div>
          <div>
            <div className="ov-big">{rw.word}{I > 0 && <span style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-secondary)' }}> · {I.toFixed(1)} mm/hr</span>}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: out.raining && out.continuous ? 'var(--st-critical)' : 'var(--text-secondary)', marginTop: 4 }}>{continuity}</div>
            <div className="muted small" style={{ marginTop: 4 }}>
              {sinceH != null && <>Raining for {dur(sinceH)} · </>}Last 24 h: {s.derived.rain24.toFixed(0)} mm · {s.rainfall.mode === 'timeline' ? 'Following the forecast storm' : 'Set manually'}
            </div>
          </div>
        </div>
        <div>
          <div className="spread" style={{ marginBottom: 6 }}><b>Set rainfall</b><span className="muted small">{manualVal.toFixed(0)} mm/hr</span></div>
          <input type="range" min={0} max={100} step={1} value={Math.min(100, manualVal)} aria-label="Rainfall intensity"
            onChange={(e) => s.setRainfall({ mode: 'manual', manualIntensity: Number(e.target.value), manualDurationH: null }, `Rainfall set to ${e.target.value} mm/hr (overview)`)} />
          <div className="row" style={{ marginTop: 10 }}>
            {RAIN_PRESETS.map((p) => (
              <button key={p.l} className={`small ${s.rainfall.mode === 'manual' && Math.abs(s.rainfall.manualIntensity - p.v) < 0.01 ? 'primary' : ''}`}
                onClick={() => s.setRainfall({ mode: 'manual', manualIntensity: p.v, manualDurationH: null }, `Rainfall set to ${p.l} (${p.v} mm/hr)`)}>{p.l}</button>
            ))}
            <button className={`small ${s.rainfall.mode === 'timeline' ? 'primary' : ''}`} onClick={() => s.setRainfall({ mode: 'timeline' }, 'Rainfall follows the forecast storm')}>Forecast storm</button>
          </div>
        </div>
      </section>

      <div className="ov-cards">
        {views.map((v) => <SumpCard key={v.id} v={v} />)}
      </div>
      <p className="muted small" style={{ marginTop: 14 }}>Simulated values — no live sensors connected. Tapping a pump changes the simulation only; it never operates a real pump. Times assume the rainfall shown above continues as set.</p>
    </div>
  );
}

function SumpCard({ v }: { v: ReturnType<typeof useAllSumpViews>[number] }) {
  const s = useStore();
  const at = (h: number) => fmtDate(simClock(s.sim.startISO, s.sim.t + h));
  const nav = useNavigate();
  const r = v.rates;
  const exp = s.derived.live?.expected.perSump[v.id];
  if (!r || !exp) return null;
  const running = v.pumps.filter((p) => isRunning(p, s.pumps, s.config, s.sim.pumpRun[p.id], s.sim.t));
  const out = Math.min(r.capActiveEff, v.V > 0 ? Infinity : r.qIn);
  const deficit = r.qIn - r.capActiveEff;
  let verdict: { cls: 'good' | 'hold' | 'bad'; text: string };
  if (!r.powerOn) verdict = { cls: 'bad', text: `⚡ Power failure — no pump can run${exp.timeToOverflow != null ? `. Overflow in ${dur(exp.timeToOverflow)}` : ''}` };
  else if (exp.timeToOverflow != null) verdict = { cls: 'bad', text: exp.timeToOverflow === 0 ? 'Overflowing now' : `Overflow in ${dur(exp.timeToOverflow)} — needs ≈ ${pumpsNeeded(Math.max(deficit, exp.peakQin - r.capActiveEff), s.config)} more pumps` };
  else if (v.V <= 1 && deficit <= 0) verdict = { cls: 'good', text: 'Empty — pumps are keeping up' };
  else if (deficit < 0) verdict = { cls: 'good', text: 'Emptying — pumps are ahead of the inflow' };
  else if (deficit === 0) verdict = { cls: 'hold', text: 'Holding level — inflow equals pumping' };
  else verdict = { cls: 'hold', text: `Filling slowly — stays below overflow for the next ${s.config.sim.predictionHorizonH} h` };

  // Badge on the same basis as the card (rain as currently set), escalated by the level thresholds.
  const lead = s.thresholds.overflowLeadH;
  const lv = v.levels;
  let badge: { sev: Severity; text: string } =
    !r.powerOn || exp.timeToOverflow === 0 ? { sev: 'emergency', text: exp.timeToOverflow === 0 ? 'Overflowing' : 'No power' }
    : exp.timeToOverflow != null && exp.timeToOverflow <= lead ? { sev: 'emergency', text: 'Overflow soon' }
    : exp.timeToOverflow != null ? { sev: 'critical', text: 'Will overflow' }
    : deficit > 0 ? { sev: 'warning', text: 'Filling' }
    : { sev: 'normal', text: 'Safe' };
  const lvSev: Severity = v.util >= lv.emergencyPct ? 'emergency' : v.util >= lv.criticalPct ? 'critical' : v.util >= lv.warnPct ? 'warning' : 'normal';
  if (SEV_RANK[lvSev] > SEV_RANK[badge.sev]) badge = { sev: lvSev, text: `${v.util.toFixed(0)} % full` };
  const tEmpty = exp.timeToEmpty;
  return (
    <section className={`glass ov-card bar-sev-${badge.sev}`}>
      <div className="head">
        <h2 style={{ cursor: 'pointer' }} onClick={() => nav(`/sump/${v.id}`)}><span className="swatch" style={{ background: SUMP_COLOR[v.id], width: 12, height: 12, borderRadius: 4 }} />{v.name}</h2>
        <SevPill s={badge.sev} text={badge.text} />
      </div>
      <div className="ov-body">
        <Gauge pct={v.util} color={SUMP_COLOR[v.id]} label={`${fmt0(v.V)} m³`} />
        <div>
          <div className="ov-stat">
            <div className="k">Pumps working</div>
            <div className="v">{running.length} <span style={{ fontSize: 15, color: 'var(--text-muted)', fontWeight: 600 }}>of {v.pumps.length}</span></div>
            <div className="chips" style={{ marginTop: 6 }}>
              {v.pumps.map((p) => <PumpChip key={p.id} p={p} running={running.includes(p)} />)}
              {v.pumps.length === 0 && <span className="muted small">No pumps assigned</span>}
            </div>
          </div>
          <div className="ov-stat">
            <div className="k">Time to empty</div>
            {tEmpty === 0 && v.V <= 1
              ? <div className="v ok">Already empty</div>
              : tEmpty != null
                ? <><div className="v">{dur(tEmpty)}</div><div className="s">by {at(tEmpty)}</div></>
                : <><div className="v err">Won’t empty</div><div className="s">{!r.powerOn ? 'No power to the pumps' : running.length === 0 ? 'No pump is running' : 'Rain brings water in faster than the pumps remove it'}</div></>}
          </div>
          <div className="s small muted">Water in <b style={{ color: 'var(--text-primary)' }}>{fmt0(r.qIn)}</b> · out <b style={{ color: 'var(--text-primary)' }}>{fmt0(out)}</b> m³/hr</div>
        </div>
      </div>
      <div className={`verdict ${verdict.cls}`}>{verdict.text}</div>
    </section>
  );
}

function PumpChip({ p, running }: { p: Pump; running: boolean }) {
  const setPumpStatus = useStore((st) => st.setPumpStatus);
  const cls = p.status === 'FAILED' ? 'failed' : p.status === 'MAINTENANCE' ? 'maint' : p.status === 'STANDBY' ? 'standby' : p.status === 'ON' ? 'on' : 'off';
  const label = p.status === 'FAILED' ? '✕' : p.status === 'MAINTENANCE' ? '🔧' : running ? '●' : p.status === 'ON' ? '◐' : '○';
  const canToggle = p.status !== 'FAILED' && p.status !== 'MAINTENANCE';
  return (
    <button className={`chip ${cls}`} disabled={!canToggle}
      title={`${p.tag}: ${p.status}${p.status === 'ON' && !running ? ' (not running — no power or daily hours used)' : ''}. ${canToggle ? 'Tap to switch ' + (p.status === 'ON' ? 'OFF' : 'ON') : 'Fix on the pump screen'}`}
      onClick={() => canToggle && setPumpStatus(p.id, p.status === 'ON' ? 'OFF' : 'ON')}>
      {label} {p.tag}
    </button>
  );
}

function Gauge({ pct, color, label }: { pct: number; color: string; label: string }) {
  const r = 50, c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct));
  return (
    <svg viewBox="0 0 120 120" width="120" height="120" role="img" aria-label={`Sump ${p.toFixed(0)} % full`}>
      <circle cx="60" cy="60" r={r} fill="rgba(255,255,255,0.5)" stroke="rgba(118,128,150,0.18)" strokeWidth="10" />
      <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
        strokeDasharray={`${(p / 100) * c} ${c}`} transform="rotate(-90 60 60)" style={{ transition: 'stroke-dasharray .4s ease' }} />
      <text x="60" y="58" textAnchor="middle" fontSize="24" fontWeight="700" fill="#111827">{p.toFixed(0)}%</text>
      <text x="60" y="77" textAnchor="middle" fontSize="9.5" fill="#6b7587">{label}</text>
    </svg>
  );
}
