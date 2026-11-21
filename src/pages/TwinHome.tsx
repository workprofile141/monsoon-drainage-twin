/**
 * Primary screen: immersive 3D digital twin of a mine sump, with LIVE and PREDICTION modes.
 * Live      → the global simulation store (no sensor feed connected; manual readings shown as MEASURED).
 * Prediction→ the sandbox in predictionStore (same advance()/simulate() engine, copied from live).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, ReferenceLine, Tooltip, CartesianGrid } from 'recharts';
import { useStore } from '../store/store';
import { usePrediction, PRESETS, rainFnOf } from '../store/predictionStore';
import { MineScene, type TwinFeed } from '../twin3d/MineScene';
import { buildMineModel, defaultLayers, type TwinConfig, type LithoLayer } from '../engine/mine';
import { levelAtVolume, levelAtPct } from '../engine/geometry';
import { sumpRates } from '../engine/balance';
import { effectiveCapacity, isRunning } from '../engine/pumps';
import { levelsFor, type SumpPrediction } from '../engine/prediction';
import { SUMP_IDS, type SumpId, type PumpStatus, type Ctx, type SimState } from '../engine/types';
import { NumInput, Seg } from '../ui/components';
import { dur, fmt0, fmt1, fmtDate, simClock } from '../ui/format';

type Mode = 'live' | 'predict';
type Tag = 'MEASURED' | 'CALCULATED' | 'ASSUMED' | 'PREDICTED' | 'INPUT' | 'SIMULATED';
const TAG_STYLE: Record<Tag, string> = { MEASURED: '#15803d', CALCULATED: '#1d6fd1', ASSUMED: '#a16207', PREDICTED: '#7c3aed', INPUT: '#475569', SIMULATED: '#7c3aed' };
const TAG_TIP: Record<Tag, string> = {
  MEASURED: 'From a manual reading (no live sensor connected)', CALCULATED: 'Computed by the hydraulic engine from inputs',
  ASSUMED: 'Assumed default — no site data supplied; editable', PREDICTED: 'Forward simulation result',
  INPUT: 'Operator / configuration input', SIMULATED: 'Simulation state (no sensor feed connected)',
};
const T = ({ t }: { t: Tag }) => <span title={TAG_TIP[t]} style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.05em', color: TAG_STYLE[t], border: `1px solid ${TAG_STYLE[t]}55`, borderRadius: 5, padding: '0 4px' }}>{t}</span>;

type Risk = { sev: 'normal' | 'warning' | 'critical' | 'emergency'; label: string; why: string };

export default function TwinHome() {
  const s = useStore();
  const pred = usePrediction();
  const [mode, setMode] = useState<Mode>('live');
  const [labels, setLabels] = useState(true);
  const [settings, setSettings] = useState(false);
  const tc = s.twin;
  const id = tc.sumpId;
  const model = useMemo(() => buildMineModel(s.config, tc), [s.config, tc]);

  // prediction playback loop (independent of the live clock)
  const last = useRef(performance.now());
  useEffect(() => {
    if (mode !== 'predict') return;
    if (!usePrediction.getState().ready) usePrediction.getState().begin();
    const h = setInterval(() => { const now = performance.now(); usePrediction.getState().tick(Math.min(200, now - last.current)); last.current = now; }, 33);
    return () => clearInterval(h);
  }, [mode]);

  // ---- assemble the feed from the active engine
  const src = useMemo(() => {
    if (mode === 'predict' && pred.ctx && pred.state && pred.start) {
      const ctx = pred.ctx, st = pred.state;
      const I = rainFnOf(ctx, pred.rain)(st.t);
      return { ctx, st, I, rates: sumpRates(ctx, st, id, I), outlook: pred.outlook?.perSump[id] ?? null, t0: pred.start.t };
    }
    const ctx: Ctx = { config: s.config, pumps: s.pumps, rainfall: s.rainfall };
    const r = s.derived.live?.rates[id] ?? sumpRates(ctx, s.sim, id, 0);
    return { ctx, st: s.sim, I: r.intensity, rates: r, outlook: s.derived.live?.expected.perSump[id] ?? null, t0: 0 };
  }, [mode, pred.ctx, pred.state, pred.outlook, pred.rain, pred.start, s.sim, s.derived, s.config, s.pumps, s.rainfall, id]);

  const sc = src.ctx.config.sumps[id];
  const dims = model.dims;
  const V = src.st.volumes[id];
  const cap = sc.existingCapacity;
  const levelM = levelAtVolume(dims, V);
  const L = levelsFor(s.thresholds, id);
  const lv = { warnM: levelAtPct(dims, L.warnPct), dangerM: levelAtPct(dims, L.criticalPct), critM: levelAtPct(dims, L.emergencyPct), spillM: dims.usableDepth, rimM: dims.usableDepth + dims.freeboard };
  const pumps = src.ctx.pumps.pumps.filter((p) => p.sumpId === id);
  const feedPumps = pumps.map((p, i) => ({
    id: p.id, tag: p.tag, label: `Pump ${i + 1}`, status: p.status, rated: p.ratedM3h, eff: effectiveCapacity(p, src.ctx.config).value,
    running: isRunning(p, src.ctx.pumps, src.ctx.config, src.st.pumpRun[p.id], src.st.t),
  }));
  const r = src.rates;
  const pumpedRate = V > 1 ? r.capActiveEff : Math.min(r.capActiveEff, r.qIn);
  const overflowing = V >= cap - 1 && r.qNet < 0;
  const feed: TwinFeed = { V, levelM, cap, intensity: src.I, qRunoff: r.qRunoff, qIn: r.qIn, capEff: r.capActiveEff, pumpedRate, overflowing, powerOn: r.powerOn, pumps: feedPumps, levels: lv };

  // latest manual reading for this sump (shown as MEASURED, never mixed into the simulation silently)
  const reading = s.readings.find((x) => x.sumpId === id && (x.kind === 'level' || x.kind === 'volume'));
  const o = src.outlook;
  const risk = riskOf(feed, o, L, s.thresholds.overflowLeadH);
  const clockAt = (h: number) => fmtDate(simClock(s.sim.startISO, src.st.t + h));
  const running = feedPumps.filter((p) => p.running).length;

  return (
    <div className="twin-home">
      <Canvas key={id} camera={{ position: [model.topL * 0.1 * 0.55, model.pitFloorE * 0.1 * tc.verticalExaggeration + 24, model.topW * 0.1 * 1.9 + 22], fov: 42, near: 0.5, far: 2000 }} dpr={[1, 2]}>
        <MineScene m={model} feed={feed} labels={labels} onPumpClick={mode === 'predict' ? (pid) => {
          const p = pumps.find((x) => x.id === pid); if (p) pred.setPump(pid, { status: p.status === 'ON' ? 'FAILED' : 'ON' });
        } : undefined} />
      </Canvas>

      {/* ---------- header / mode */}
      <div className="th-box" style={{ left: 14, top: 14, width: 360 }}>
        <div className="spread"><h2 style={{ fontSize: 17 }}>Kusmunda Mine — Sump Digital Twin</h2></div>
        <div className="row" style={{ marginTop: 8 }}>
          <select value={id} onChange={(e) => { s.updateTwin({ sumpId: e.target.value as SumpId }, `3D twin sump → ${s.config.sumps[e.target.value as SumpId].name}`); }}>
            {SUMP_IDS.map((x) => <option key={x} value={x}>{s.config.sumps[x].name}</option>)}
          </select>
          <Seg value={mode} onChange={(m) => { setMode(m); if (m === 'predict') pred.begin(); }} options={[{ v: 'live', l: '● Live monitoring' }, { v: 'predict', l: '◆ Prediction / what-if' }]} />
        </div>
        {mode === 'live' ? (
          <div className="small" style={{ marginTop: 8, lineHeight: 1.5 }}>
            <div><b>{fmtDate(simClock(s.sim.startISO, s.sim.t))}</b> · elapsed {dur(s.sim.t) === 'now' ? '0 min' : dur(s.sim.t)} · {s.running ? <span className="ok">● updating</span> : <span className="muted">paused — press ▶ in the top bar</span>}</div>
            <div className="muted">Source: simulation engine — <b>no sensor feed connected</b>. Manual readings appear as MEASURED.</div>
          </div>
        ) : (
          <div className="small" style={{ marginTop: 8, lineHeight: 1.5 }}>
            <div>Prediction from <b>{fmtDate(simClock(s.sim.startISO, src.t0))}</b> · now <b>+{dur(src.st.t - src.t0) === 'now' ? '0 min' : dur(src.st.t - src.t0)}</b> ({fmtDate(simClock(s.sim.startISO, src.st.t))})</div>
            <div className="muted">Scenario: <b style={{ color: 'var(--text-primary)' }}>{pred.scenario}</b> · sandbox copy — live data untouched</div>
          </div>
        )}
        <div className="row small" style={{ marginTop: 8 }}>
          <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} />Labels</label>
          <button className="small" onClick={() => setSettings(!settings)}>⚙ Geometry & strata</button>
        </div>
      </div>

      {/* ---------- KPI panel */}
      <div className="th-box" style={{ right: 14, top: 14, width: 316 }}>
        <div className="spread" style={{ marginBottom: 6 }}>
          <b>{sc.name}</b>
          <span className={`pill sev-${risk.sev}`} title={risk.why}>{risk.label}</span>
        </div>
        <div className="th-kpis">
          <Kpi k="Water level" v={`${levelM.toFixed(2)} m`} sub={`of ${dims.usableDepth} m usable${reading ? ` · last manual ${reading.kind} ${fmt0(reading.value)} ${reading.unit}` : ''}`} t={reading ? 'MEASURED' : 'CALCULATED'} />
          <Kpi k="Water volume" v={`${fmt0(V)} m³`} sub={`${((V / cap) * 100).toFixed(1)} % of ${fmt0(cap)} m³`} t={mode === 'live' ? 'SIMULATED' : 'PREDICTED'} />
          <Kpi k="Available storage" v={`${fmt0(Math.max(0, cap - V))} m³`} t="CALCULATED" />
          <Kpi k="Rainfall intensity" v={`${fmt1(src.I)} mm/hr`} sub={src.I > 0 ? 'raining' : 'dry'} t="INPUT" />
          <Kpi k="Total inflow" v={`${fmt0(r.qIn)} m³/hr`} sub={`runoff ${fmt0(r.qRunoff)} + groundwater ${fmt0(r.qGroundwater)}`} t="CALCULATED" />
          <Kpi k="Pumping capacity" v={`${fmt0(r.capActiveEff)} m³/hr`} sub={`discharging ${fmt0(pumpedRate)} m³/hr`} t="CALCULATED" />
          <Kpi k="Pumps operational" v={`${running} of ${feedPumps.length}`} sub={r.powerOn ? feedPumps.filter((p) => p.status === 'FAILED').length + ' failed' : '⚡ no power'} t="INPUT" />
          <Kpi k="Net change" v={`${r.qNet >= 0 ? '−' : '+'}${fmt0(Math.abs(r.qNet))} m³/hr`} sub={r.qNet > 0 ? (V > 1 ? 'level falling' : 'empty — pumps keep up') : r.qNet < 0 ? 'level rising' : 'holding'} t="CALCULATED" />
          <Kpi k="Time to critical level" v={o?.timeToEmergency == null ? 'not reached' : o.timeToEmergency === 0 ? 'NOW' : dur(o.timeToEmergency)} sub={o?.timeToEmergency ? `at ${clockAt(o.timeToEmergency)}` : `within ${s.config.sim.predictionHorizonH} h`} t="PREDICTED" />
          <Kpi k="Time to overflow" v={o?.timeToOverflow == null ? 'not reached' : o.timeToOverflow === 0 ? 'NOW' : dur(o.timeToOverflow)} sub={o?.timeToEmpty != null && o.timeToEmpty > 0 ? `empties in ${dur(o.timeToEmpty)}` : undefined} t="PREDICTED" />
        </div>
      </div>

      {/* ---------- vertical level gauge */}
      <Gauge levelM={levelM} lv={lv} pct={(V / cap) * 100} />

      {/* ---------- strata legend */}
      {!settings && (
        <div className="th-box" style={{ left: 14, top: 214, width: 236, padding: '10px 12px' }}>
          <div className="spread"><b className="small">Strata on the cutaway</b><T t="ASSUMED" /></div>
          {tc.layers.map((l, i) => (
            <div key={i} className="row small" style={{ gap: 6, marginTop: 3, flexWrap: 'nowrap' }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: l.color, flex: 'none', border: '1px solid rgba(0,0,0,.15)' }} />
              <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</span><span className="muted">{l.thicknessM} m</span>
            </div>
          ))}
          <div className="small muted" style={{ marginTop: 6 }}>Illustrative — enter Kusmunda litholog via ⚙.</div>
        </div>
      )}

      {/* ---------- settings drawer */}
      {settings && <SettingsBox tc={tc} onClose={() => setSettings(false)} />}

      {/* ---------- bottom dock */}
      {mode === 'live'
        ? <LiveDock pumps={feedPumps} onPredict={() => { setMode('predict'); pred.begin(); }} />
        : <PredictDock id={id} lv={lv} />}
    </div>
  );
}

function Kpi({ k, v, sub, t }: { k: string; v: string; sub?: string; t: Tag }) {
  return (
    <div className="th-kpi">
      <div className="spread"><span className="k">{k}</span><T t={t} /></div>
      <div className="v">{v}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  );
}

function riskOf(f: TwinFeed, o: SumpPrediction | null, L: { warnPct: number; criticalPct: number; emergencyPct: number }, lead: number): Risk {
  const u = (f.V / f.cap) * 100;
  if (f.overflowing) return { sev: 'emergency', label: 'CRITICAL · overflowing', why: 'Sump full and inflow exceeds pumping' };
  if (u >= L.emergencyPct || (o?.timeToOverflow != null && o.timeToOverflow <= lead)) return { sev: 'emergency', label: 'CRITICAL', why: `Level ≥ ${L.emergencyPct} % or overflow within ${lead} h` };
  if (u >= L.criticalPct || (o?.timeToEmergency != null && o.timeToEmergency <= 12)) return { sev: 'critical', label: 'DANGER', why: `Level ≥ ${L.criticalPct} % or critical level within 12 h` };
  if (u >= L.warnPct || (f.qIn > f.capEff && o?.timeToWarn != null && o.timeToWarn <= 24) || !f.powerOn || f.pumps.some((p) => p.status === 'FAILED')) return { sev: 'warning', label: 'WARNING', why: 'Rising towards warning level, or pump/power unavailable' };
  return { sev: 'normal', label: 'NORMAL', why: 'Within limits under current conditions' };
}

function Gauge({ levelM, lv, pct }: { levelM: number; lv: TwinFeed['levels']; pct: number }) {
  const H = 230, max = lv.rimM;
  const y = (m: number) => H - (Math.min(max, Math.max(0, m)) / max) * H;
  return (
    <div className="th-box" style={{ right: 342, top: 14, width: 86, padding: '10px 8px' }}>
      <div className="small muted" style={{ textAlign: 'center', fontWeight: 600 }}>LEVEL</div>
      <svg width="70" height={H + 8} viewBox={`0 0 70 ${H + 8}`} role="img" aria-label={`Water level ${levelM.toFixed(2)} m`}>
        <rect x="8" y="4" width="22" height={H} rx="6" fill="rgba(118,128,150,0.16)" />
        <rect x="8" y={4 + y(levelM)} width="22" height={H - y(levelM)} rx="6" fill="#2a83e6" style={{ transition: 'all .3s ease' }} />
        {[['W', lv.warnM, '#e0a800'], ['D', lv.dangerM, '#f07b1a'], ['C', lv.critM, '#e5383b'], ['O', lv.spillM, '#8b0000']].map(([k, m, c]) => (
          <g key={k as string}><line x1="4" x2="34" y1={4 + y(m as number)} y2={4 + y(m as number)} stroke={c as string} strokeWidth="2" /><text x="38" y={8 + y(m as number)} fontSize="10" fill={c as string} fontWeight="700">{k as string} {(m as number).toFixed(1)}</text></g>
        ))}
      </svg>
      <div style={{ textAlign: 'center', fontWeight: 700 }}>{levelM.toFixed(2)} m</div>
      <div className="small muted" style={{ textAlign: 'center' }}>{pct.toFixed(0)} % full</div>
    </div>
  );
}

function LiveDock({ pumps, onPredict }: { pumps: TwinFeed['pumps']; onPredict: () => void }) {
  return (
    <div className="th-box th-dock" style={{ padding: '10px 14px' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          <b className="small">Pumps (live status)</b>
          {pumps.map((p) => <span key={p.id} className={`chip ${p.status === 'FAILED' ? 'failed' : p.running ? 'on' : p.status === 'MAINTENANCE' ? 'maint' : 'off'}`} title={`${p.tag} · ${p.status}`}>{p.running ? '●' : p.status === 'FAILED' ? '✕' : '○'} {p.label} · {Math.round(p.eff)}</span>)}
          {pumps.length === 0 && <span className="muted small">No pumps assigned to this sump</span>}
        </div>
        <button className="primary" onClick={onPredict}>◆ Test pump failures / rain in Prediction mode →</button>
      </div>
    </div>
  );
}

function PredictDock({ id, lv }: { id: SumpId; lv: TwinFeed['levels'] }) {
  const s = useStore();
  const pred = usePrediction();
  const twin = s.twin;
  const dims = useMemo(() => (pred.ctx ? buildMineModel(pred.ctx.config, twin).dims : null), [pred.ctx, twin]);
  const elapsed = pred.state && pred.start ? pred.state.t - pred.start.t : 0;
  // chart: simulated trace so far + forward projection with current settings
  const data = useMemo(() => {
    if (!dims) return [];
    const out: { t: number; past?: number; proj?: number }[] = pred.trace[id].map((p) => ({ t: +p.t.toFixed(3), past: +levelAtVolume(dims, p.V).toFixed(3) }));
    if (pred.outlook) for (const p of pred.outlook.series) { const t = elapsed + p.t; if (t > pred.horizonH + 1e-6) break; out.push({ t: +t.toFixed(3), proj: +levelAtVolume(dims, p.V[id]).toFixed(3) }); }
    return out;
  }, [pred.trace, pred.outlook, pred.horizonH, id, elapsed, dims]);
  if (!pred.ctx || !pred.state || !pred.start || !dims) return null;
  const ctx = pred.ctx, st = pred.state;
  const pumps = ctx.pumps.pumps.filter((p) => p.sumpId === id);
  const o = pred.outlook?.perSump[id];
  const I = pred.rain.kind === 'constant' ? pred.rain.intensity : rainFnOf(ctx, pred.rain)(st.t);
  const at = (h: number | null | undefined) => (h == null ? '—' : fmtDate(simClock(s.sim.startISO, st.t + h)));
  const tm = (h: number | null | undefined) => (h == null ? 'not reached' : h === 0 ? 'now' : dur(h));
  const STATUSES: [PumpStatus, string][] = [['ON', 'ON'], ['OFF', 'OFF'], ['FAILED', 'Fail']];
  return (
    <div className="th-box th-dock">
      <div className="th-dock-grid">
        <div>
          <div className="spread"><b className="small">Rainfall</b><span className="small"><b>{fmt1(I)}</b> mm/hr</span></div>
          <input type="range" min={0} max={100} step={1} value={pred.rain.kind === 'constant' ? pred.rain.intensity : I} disabled={pred.rain.kind !== 'constant'}
            onChange={(e) => pred.setRain({ kind: 'constant', intensity: Number(e.target.value) })} aria-label="Prediction rainfall" />
          <div className="row" style={{ marginTop: 4 }}>
            {[0, 10, 25, 40, 60].map((v) => <button key={v} className={`small ${pred.rain.kind === 'constant' && pred.rain.intensity === v ? 'primary' : ''}`} onClick={() => pred.setRain({ kind: 'constant', intensity: v })}>{v}</button>)}
            <button className={`small ${pred.rain.kind === 'forecast' ? 'primary' : ''}`} onClick={() => pred.setRain({ kind: 'forecast' })}>Forecast</button>
          </div>
          <div className="small" style={{ marginTop: 8 }}><b>Scenario</b></div>
          <select style={{ width: '100%' }} value="" onChange={(e) => e.target.value && pred.preset(e.target.value as never, id)}>
            <option value="">Apply a preset…</option>
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="spread"><b className="small">Pumps — tap a status (or click a pump in 3D to fail/restore)</b>
            <button className={`small ${ctx.pumps.power[id] ? 'on' : 'danger'}`} onClick={() => pred.setPower(id, !ctx.pumps.power[id])}>⚡ {ctx.pumps.power[id] ? 'Power ON' : 'Power FAILED'}</button></div>
          <div className="th-pumps">
            {pumps.map((p, i) => (
              <div key={p.id} className={`th-pump ${p.status === 'FAILED' ? 'bad' : p.status === 'ON' ? 'ok' : ''}`}>
                <div className="spread"><b>Pump {i + 1}</b><span className="muted small">{p.tag}</span></div>
                <div className="seg" style={{ marginTop: 4 }}>{STATUSES.map(([v, l]) => <button key={v} className={p.status === v ? 'active' : ''} onClick={() => pred.setPump(p.id, { status: v })}>{l}</button>)}</div>
                <div className="row small" style={{ marginTop: 4, gap: 4 }}><NumInput value={p.ratedM3h} min={0} max={20000} width={64} onCommit={(v) => pred.setPump(p.id, { ratedM3h: v })} /><span className="muted">m³/hr rated</span></div>
                <div className="small muted">effective {fmt0(effectiveCapacity(p, ctx.config).value)}</div>
              </div>
            ))}
            {pumps.length === 0 && <span className="muted small">No pumps at this sump.</span>}
          </div>
        </div>
        <div>
          <div className="spread"><b className="small">Run forward</b><span className="small muted">+{dur(elapsed) === 'now' ? '0 min' : dur(elapsed)} / {pred.horizonH} h</span></div>
          <div className="row" style={{ marginTop: 4 }}>
            <Seg value={pred.horizonH} onChange={(h) => pred.setHorizon(h)} options={[1, 3, 6, 12, 24].map((v) => ({ v, l: `${v} h` }))} />
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            {pred.playing ? <button onClick={pred.pause}>❚❚ Pause</button> : <button className="primary" onClick={pred.play}>▶ Run</button>}
            <button onClick={pred.restart} title="Back to the prediction start, keep settings">⟲ Restart</button>
            <button onClick={pred.begin} title="Copy the latest live state and settings">⇣ Re-sync live</button>
          </div>
          <div className="row small" style={{ marginTop: 6 }}><span className="muted">Playback</span>
            <Seg value={pred.playSeconds} onChange={(v) => pred.setPlaySeconds(v)} options={[{ v: 40, l: 'Slow' }, { v: 20, l: 'Normal' }, { v: 8, l: 'Fast' }]} /></div>
          <div className="util" style={{ marginTop: 8 }}><div style={{ width: `${Math.min(100, (elapsed / pred.horizonH) * 100)}%`, background: 'var(--accent)' }} /></div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="th-times">
            <div><span style={{ color: '#a16207' }}>Warning</span><b>{tm(o?.timeToWarn)}</b><i>{o?.timeToWarn ? at(o.timeToWarn) : ''}</i></div>
            <div><span style={{ color: '#c2410c' }}>Danger</span><b>{tm(o?.timeToCritical)}</b><i>{o?.timeToCritical ? at(o.timeToCritical) : ''}</i></div>
            <div><span style={{ color: '#b91c1c' }}>Critical</span><b>{tm(o?.timeToEmergency)}</b><i>{o?.timeToEmergency ? at(o.timeToEmergency) : ''}</i></div>
            <div><span style={{ color: '#7f1d1d' }}>Overflow</span><b>{tm(o?.timeToOverflow)}</b><i>{o?.timeToOverflow ? at(o.timeToOverflow) : ''}</i></div>
          </div>
          <div style={{ height: 112 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="rgba(60,72,100,0.1)" vertical={false} />
                <XAxis dataKey="t" type="number" domain={[0, pred.horizonH]} tick={{ fontSize: 10, fill: '#6b7587' }} tickFormatter={(v) => `${v}h`} />
                <YAxis domain={[0, Math.ceil(lv.rimM)]} tick={{ fontSize: 10, fill: '#6b7587' }} width={44} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 10 }} labelFormatter={(v) => `+${Number(v).toFixed(2)} h`} formatter={(v, n) => [`${Number(v).toFixed(2)} m`, n === 'past' ? 'Simulated' : 'Projected']} />
                <ReferenceLine y={lv.warnM} stroke="#e0a800" strokeDasharray="4 3" />
                <ReferenceLine y={lv.dangerM} stroke="#f07b1a" strokeDasharray="4 3" />
                <ReferenceLine y={lv.critM} stroke="#e5383b" strokeDasharray="4 3" />
                <ReferenceLine x={elapsed} stroke="#0a7aff" />
                <Line dataKey="past" stroke="#0a7aff" strokeWidth={2.5} dot={false} isAnimationActive={false} connectNulls />
                <Line dataKey="proj" stroke="#7c3aed" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="small muted">Level (m): <span style={{ color: '#0a7aff' }}>━ simulated</span> · <span style={{ color: '#7c3aed' }}>┅ projected with current settings</span></div>
        </div>
      </div>
    </div>
  );
}

function SettingsBox({ tc, onClose }: { tc: TwinConfig; onClose: () => void }) {
  const s = useStore();
  const up = (patch: Partial<TwinConfig>) => s.updateTwin(patch);
  const setLayer = (i: number, patch: Partial<LithoLayer>) => up({ layers: tc.layers.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const F = ({ l, k, min, max, unit }: { l: string; k: keyof TwinConfig; min: number; max: number; unit: string }) => ([
    <div key={k + 'l'}>{l}</div>, <div key={k + 'v'} className="row" style={{ justifyContent: 'flex-end', gap: 4 }}><NumInput value={tc[k] as number} min={min} max={max} width={70} onCommit={(v) => up({ [k]: v } as Partial<TwinConfig>)} /><span className="muted small" style={{ width: 28 }}>{unit}</span></div>,
  ]);
  return (
    <div className="th-box" style={{ left: 14, top: 214, width: 380, maxHeight: 'calc(100% - 450px)', minHeight: 220, overflowY: 'auto' }}>
      <div className="spread"><b>Geometry & strata</b><button className="small" onClick={onClose}>✕</button></div>
      <div className="banner warn small" style={{ margin: '8px 0' }}>No surveyed pit geometry or borehole lithology was supplied. Values marked <T t="ASSUMED" /> are illustrative defaults — replace them with Kusmunda survey / litholog data. Sump size and capacity come from the engineering configuration.</div>
      <div className="kv small" style={{ alignItems: 'center' }}>
        {F({ l: "Pit depth to sump rim (ASSUMED)", k: "pitDepthM", min: 5, max: 400, unit: "m", })}
        {F({ l: "Bench height (ASSUMED)", k: "benchHeightM", min: 2, max: 50, unit: "m", })}
        {F({ l: "Berm width (ASSUMED)", k: "bermWidthM", min: 1, max: 100, unit: "m", })}
        {F({ l: "Bench face angle (ASSUMED)", k: "faceAngleDeg", min: 20, max: 89, unit: "°", })}
        {F({ l: "Pit length/width (ASSUMED)", k: "pitAspect", min: 0.3, max: 5, unit: "", })}
        {F({ l: "Floor grade to sump (ASSUMED)", k: "floorGradePct", min: 0, max: 10, unit: "%", })}
        {F({ l: "Vertical exaggeration (display)", k: "verticalExaggeration", min: 1, max: 8, unit: "×", })}
      </div>
      <div className="small muted" style={{ margin: '6px 0' }}>Pit footprint is derived from the excavation area A1 (area-true). Sump prismoid = configured usable capacity, depth and side slope.</div>
      <div className="spread" style={{ marginTop: 6 }}><b className="small">Lithology (top → bottom) <T t="ASSUMED" /></b><button className="small" onClick={() => up({ layers: defaultLayers() })}>Reset</button></div>
      <table className="small"><tbody>
        {tc.layers.map((l, i) => (
          <tr key={i}>
            <td><input type="color" value={l.color} onChange={(e) => setLayer(i, { color: e.target.value })} style={{ width: 26, padding: 0, border: 'none', background: 'none' }} /></td>
            <td><input value={l.name} onChange={(e) => setLayer(i, { name: e.target.value })} style={{ width: 170 }} /></td>
            <td className="r"><NumInput value={l.thicknessM} min={0.5} max={500} width={56} onCommit={(v) => setLayer(i, { thicknessM: v })} /></td>
            <td><button className="small danger" onClick={() => up({ layers: tc.layers.filter((_, j) => j !== i) })} disabled={tc.layers.length <= 1}>✕</button></td>
          </tr>
        ))}
      </tbody></table>
      <button className="small" style={{ marginTop: 6 }} onClick={() => up({ layers: [...tc.layers, { name: 'New layer', thicknessM: 10, color: '#999999' }] })}>+ Layer</button>
    </div>
  );
}

export type { SimState };
