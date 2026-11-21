import { useMemo, useState } from 'react';
import { useStore } from '../store/store';
import { Kpi, NumInput, Panel, Prov, Seg } from '../ui/components';
import { TimeChart } from '../ui/charts';
import { fmt0, fmt1, fmt2, fmtT } from '../ui/format';
import { forecastAt, depthBetween, forecastRainFn, timelineAt, sortedTimeline, rainfallAt } from '../engine/rainfall';
import type { TimelineEntry } from '../engine/types';
import { SUMP_IDS } from '../engine/types';
import { effectiveCatchment } from '../engine/runoff';
import { defaultRainfall } from '../engine/defaults';

export default function RainfallPage() {
  const s = useStore();
  const r = s.rainfall;
  const I = s.derived.live?.intensity ?? 0;
  const [tl, setTl] = useState<TimelineEntry[]>(sortedTimeline(r.timeline));
  const [ev, setEv] = useState({ label: 'Rain event', startIn: 0, durationH: 2, intensity: 30 });
  const dirty = JSON.stringify(sortedTimeline(tl)) !== JSON.stringify(sortedTimeline(r.timeline));

  const fc24 = depthBetween(forecastRainFn(r), s.sim.t, s.sim.t + 24, 1 / 12);
  const tl24 = depthBetween((t) => timelineAt({ ...r, timeline: tl }, t), 0, 24, 1 / 12);
  const chart = useMemo(() => {
    const out: Record<string, number>[] = [];
    const t0 = Math.max(0, s.sim.t - 24);
    for (let t = t0; t <= s.sim.t + 48 + 1e-9; t += 0.25) {
      out.push({ t, forecast: forecastAt(r, t), live: rainfallAt(r, t), ...(t <= s.sim.t ? {} : {}) });
    }
    return out;
  }, [r, s.sim.t]);
  const hist = s.history.map((p) => ({ t: p.t, rain: p.rain, cum: p.cumRain }));
  const mmDay = r.manualIntensity * 24;

  return (
    <div>
      <div className="page-head"><div><h1>Dynamic rainfall simulator</h1><p>Rainfall can be changed at any time, including while the simulation runs. Changes take effect from the current simulation step.</p></div></div>
      <div className="grid g6" style={{ marginBottom: 14 }}>
        <Kpi label="Instantaneous intensity" value={fmt1(I)} unit="mm/hr" prov="simulated" sub={`${r.mode === 'manual' ? 'Manual' : 'Timeline'} source${r.events.length ? ' + events' : ''}`} />
        <Kpi label="Accumulated since start" value={fmt1(s.sim.cumRainMm)} unit="mm" prov="simulated" sub={fmtT(s.sim.t)} />
        <Kpi label="Last 24 h depth" value={fmt1(s.derived.rain24)} unit="mm" prov="simulated" sub={`Design day ${s.config.design.rainfallDepthM * 1000} mm`} />
        <Kpi label="Forecast next 24 h" value={fmt1(fc24)} unit="mm" prov="derived" sub="Timeline + events" />
        <Kpi label="Timeline 24-h total" value={fmt1(tl24)} unit="mm" prov="user" />
        <Kpi label="Rain events" value={r.events.length} sub={`${r.events.filter((e) => s.sim.t >= e.startH && s.sim.t < e.startH + e.durationH).length} active now`} />
      </div>

      <div className="grid g2">
        <Panel title="Live rainfall source" right={<Seg value={r.mode} onChange={(m) => s.setRainfall({ mode: m }, `Rainfall source → ${m}`)} options={[{ v: 'timeline', l: 'Timeline (forecast)' }, { v: 'manual', l: 'Manual intensity' }]} />}>
          {r.mode === 'timeline' && <div className="banner">The live simulation follows the 24-hour timeline below (plus events). Switch to manual to override it with a constant intensity — the timeline is then still used as the forecast for prediction #2.</div>}
          <div style={{ opacity: r.mode === 'manual' ? 1 : 0.55 }}>
            <label className="field">Daily rainfall depth (0 – 250 mm/day slider → uniform intensity)
              <input type="range" min={0} max={250} step={1} value={Math.min(250, mmDay)} onChange={(e) => s.setRainfall({ mode: 'manual', manualIntensity: Number(e.target.value) / 24 }, `Manual rainfall ${e.target.value} mm/day (${(Number(e.target.value) / 24).toFixed(2)} mm/hr)`)} />
            </label>
            <div className="row" style={{ marginTop: 8 }}>
              <span className="muted">Depth</span><NumInput value={+mmDay.toFixed(2)} min={0} max={2000} width={80} onCommit={(v) => s.setRainfall({ mode: 'manual', manualIntensity: v / 24 })} /><span className="muted">mm/day</span>
              <span className="muted" style={{ marginLeft: 10 }}>= intensity</span><NumInput value={+r.manualIntensity.toFixed(3)} min={0} max={500} width={80} onCommit={(v) => s.setRainfall({ mode: 'manual', manualIntensity: v })} /><span className="muted">mm/hr</span>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <span className="muted">Duration</span>
              <Seg value={r.manualDurationH == null ? 'inf' : 'fixed'} onChange={(x) => s.setRainfall({ manualDurationH: x === 'inf' ? null : 6 })} options={[{ v: 'inf', l: 'Until changed' }, { v: 'fixed', l: 'Fixed hours' }]} />
              {r.manualDurationH != null && <><NumInput value={r.manualDurationH} min={0.25} max={720} width={70} onCommit={(v) => s.setRainfall({ manualDurationH: v })} /><span className="muted">h from {fmtT(r.manualStartH)} (then 0)</span></>}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <span className="muted">Quick set:</span>
              {[0, 2, 5, 10, 20, 40, 60].map((v) => <button key={v} className="small" onClick={() => s.setRainfall({ mode: 'manual', manualIntensity: v }, `Manual rainfall → ${v} mm/hr`)}>{v} mm/hr</button>)}
            </div>
          </div>
          <h3 style={{ marginTop: 14 }}>Inflow at the current intensity</h3>
          <div className="formula">Qrain [m³/hr] = [(A1·n1 + A3·n4 + A2·n3{s.config.sumps.A.Aext > 0 ? ' + Aext·n2' : ''}) / 1000] × I    ·    Qin = {s.config.groundwater.mode === 'allowance' ? `Qrain × (1 + ${s.config.design.seepagePct} %)` : 'Qrain + Qgroundwater(measured)'}</div>
          <table style={{ marginTop: 6 }}><thead><tr><th>Sump</th><th className="r">Σ A·n / 1000 (m³ per mm)</th><th className="r">Qrain m³/hr</th><th className="r">Qin m³/hr</th></tr></thead>
            <tbody>{SUMP_IDS.map((id) => <tr key={id}><td>{s.config.sumps[id].name}</td><td className="r">{fmt1(effectiveCatchment(s.config, id) / 1000)}</td><td className="r">{fmt0(s.derived.live?.rates[id].qRunoff)}</td><td className="r">{fmt0(s.derived.live?.rates[id].qIn)}</td></tr>)}</tbody></table>
        </Panel>

        <Panel title="Rain events & sudden changes" right={<Prov p="user" />}>
          <div className="row">
            <button onClick={() => s.addRainEvent({ label: 'Sudden extreme rainfall', startH: s.sim.t, durationH: 2, intensity: 80 })}>⚡ Extreme burst now (+80 mm/hr, 2 h)</button>
            <button onClick={() => s.setRainfall({ mode: 'manual', manualIntensity: Math.max(I * 2, 10) }, `Sudden increase: rainfall ${fmt1(I)} → ${fmt1(Math.max(I * 2, 10))} mm/hr`)}>⬆ Sudden increase (×2)</button>
            <button onClick={() => s.setRainfall({ mode: 'manual', manualIntensity: I / 4 }, `Sudden decrease: rainfall ${fmt1(I)} → ${fmt1(I / 4)} mm/hr`)}>⬇ Sudden decrease (÷4)</button>
            <button onClick={() => s.setRainfall({ mode: 'manual', manualIntensity: 0 }, 'Rain stopped (0 mm/hr)')}>Stop rain</button>
          </div>
          <h3 style={{ marginTop: 12 }}>Add event</h3>
          <div className="row">
            <input value={ev.label} onChange={(e) => setEv({ ...ev, label: e.target.value })} style={{ width: 150 }} />
            <span className="muted">starts in</span><NumInput value={ev.startIn} min={0} max={720} width={60} onCommit={(v) => setEv({ ...ev, startIn: v })} /><span className="muted">h, for</span>
            <NumInput value={ev.durationH} min={0.1} max={720} width={60} onCommit={(v) => setEv({ ...ev, durationH: v })} /><span className="muted">h at +</span>
            <NumInput value={ev.intensity} min={0} max={500} width={60} onCommit={(v) => setEv({ ...ev, intensity: v })} /><span className="muted">mm/hr</span>
            <button className="primary" onClick={() => s.addRainEvent({ label: ev.label, startH: s.sim.t + ev.startIn, durationH: ev.durationH, intensity: ev.intensity })}>Add</button>
          </div>
          <table style={{ marginTop: 10 }}><thead><tr><th>Event</th><th>From</th><th>To</th><th className="r">+mm/hr</th><th className="r">Depth mm</th><th></th></tr></thead>
            <tbody>
              {r.events.length === 0 && <tr><td colSpan={6} className="muted">No events. Events add rainfall on top of the base source (timeline or manual) and are part of the forecast.</td></tr>}
              {r.events.map((e) => {
                const active = s.sim.t >= e.startH && s.sim.t < e.startH + e.durationH;
                return <tr key={e.id}><td>{e.label} {active && <span className="ok">● active</span>}</td><td>{fmtT(e.startH)}</td><td>{fmtT(e.startH + e.durationH)}</td><td className="r">{fmt1(e.intensity)}</td><td className="r">{fmt1(e.intensity * e.durationH)}</td><td><button className="small danger" onClick={() => s.removeRainEvent(e.id)}>✕</button></td></tr>;
              })}
            </tbody></table>
        </Panel>
      </div>

      <Panel title="24-hour rainfall timeline (also the forecast)" right={<>
        <span className="muted small">After T+24 h</span>
        <Seg value={r.timelineAfter} onChange={(v) => s.setRainfall({ timelineAfter: v })} options={[{ v: 'zero', l: 'Dry (0)' }, { v: 'repeat', l: 'Repeat daily' }, { v: 'hold', l: 'Hold last' }]} />
      </>}>
        <p className="muted" style={{ marginTop: 0 }}>Piecewise-constant intensities from simulation start (T+0). The supplied example values are <b>demonstration inputs</b>; the final 16:00 → 0 entry ends the demo storm. Edit freely, then apply.</p>
        <div className="grid g2">
          <div>
            <table><thead><tr><th>From (T+ h)</th><th className="r">Intensity mm/hr</th><th className="r">Until</th><th className="r">Depth mm</th><th></th></tr></thead>
              <tbody>{sortedTimeline(tl).map((e, i, arr) => {
                const until = i < arr.length - 1 ? arr[i + 1].hour : 24;
                return <tr key={i}>
                  <td><NumInput value={e.hour} min={0} max={23.99} width={70} onCommit={(v) => setTl(tl.map((x) => (x === e ? { ...x, hour: v } : x)))} /></td>
                  <td className="r"><NumInput value={e.intensity} min={0} max={500} width={80} onCommit={(v) => setTl(tl.map((x) => (x === e ? { ...x, intensity: v } : x)))} /></td>
                  <td className="r">{fmtT(until)}</td><td className="r">{fmt2(e.intensity * Math.max(0, until - e.hour))}</td>
                  <td><button className="small danger" onClick={() => setTl(tl.filter((x) => x !== e))}>✕</button></td></tr>;
              })}</tbody></table>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="small" onClick={() => { const last = sortedTimeline(tl).at(-1); setTl([...tl, { hour: Math.min(23, (last?.hour ?? -2) + 2), intensity: 0 }]); }}>+ Row</button>
              <button className="small" onClick={() => setTl(defaultRainfall().timeline)}>Demo storm</button>
              <button className="small" onClick={() => setTl([{ hour: 0, intensity: +(s.config.design.rainfallDepthM * 1000 / 24).toFixed(4) }])}>Design day uniform ({s.config.design.rainfallDepthM * 1000} mm / 24 h)</button>
              <button className="small" onClick={() => setTl([{ hour: 0, intensity: 0 }])}>Dry</button>
              <button className="primary" disabled={!dirty} onClick={() => s.setRainfall({ timeline: sortedTimeline(tl) }, `Rainfall timeline updated (${tl.length} entries, ${fmt1(tl24)} mm/24 h)`)}>Apply timeline</button>
              {dirty && <span className="small" style={{ color: 'var(--st-warning)' }}>Unapplied changes</span>}
            </div>
          </div>
          <TimeChart data={Array.from({ length: 97 }, (_, i) => ({ t: i / 4, v: timelineAt({ ...r, timeline: tl, timelineAfter: 'zero' }, i / 4 - 1e-9 + (i === 96 ? 0 : 1e-9)) }))} series={[{ key: 'v', name: 'Timeline intensity', color: '#3987e5' }]} unit="mm/hr" yLabel="mm/hr" area step xLabel="Timeline hour (T+)" />
        </div>
      </Panel>

      <div className="grid g2">
        <Panel title="Rainfall: live source vs forecast (−24 h … +48 h)" right={<Prov p="derived" />}>
          <TimeChart data={chart} series={[{ key: 'live', name: 'Live source', color: '#3987e5' }, { key: 'forecast', name: 'Forecast (timeline + events)', color: '#d95926', dashed: true }]} unit="mm/hr" yLabel="mm/hr" step refLines={[{ y: s.thresholds.rainfallWarnMmH, label: 'Warn' }]} />
          <p className="muted small">Vertical position of “now” = T+{s.sim.t.toFixed(2)} h.</p>
        </Panel>
        <Panel title="Recorded rainfall & cumulative depth" right={<Prov p="simulated" />}>
          <TimeChart data={hist} series={[{ key: 'cum', name: 'Cumulative rainfall', color: '#199e70' }]} unit="mm" yLabel="mm" scatter={{ name: 'Manual gauge readings', color: '#e0b25a', data: s.readings.filter((x) => x.kind === 'rainfall').map((x) => ({ t: x.simT, v: x.value })) }} />
        </Panel>
      </div>
    </div>
  );
}
