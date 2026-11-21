import { useMemo } from 'react';
import { useStore, ctxOf } from '../store/store';
import { useScenarioStore } from '../store/scenarioStore';
import { PRESET_SCENARIOS, runScenario, type ScenarioSpec, type ScenarioResult } from '../engine/scenarios';
import { NumInput, Panel, Prov, Seg } from '../ui/components';
import { TimeChart } from '../ui/charts';
import { SUMP_IDS } from '../engine/types';
import { dur, fmt0, pct, SUMP_COLOR } from '../ui/format';

export default function ScenariosPage() {
  const sc = useScenarioStore();
  const s = useStore();
  const run = (i: 0 | 1) => sc.setResult(i, runScenario(ctxOf(s), s.sim, s.thresholds, sc.specs[i]));
  const runBoth = () => { run(0); run(1); };
  return (
    <div>
      <div className="page-head">
        <div><h1>What-if scenario simulator</h1><p>Each scenario is applied to a copy of the current state (or the configured initial volumes) and run through the same water-balance engine. The live simulation is never changed.</p></div>
        <button className="primary" onClick={runBoth}>▶ Run both & compare</button>
      </div>
      <div className="grid g2">
        {([0, 1] as const).map((i) => <ScenarioEditor key={i} i={i} onRun={() => run(i)} />)}
      </div>
      <Comparison a={sc.results[0]} b={sc.results[1]} />
    </div>
  );
}

function ScenarioEditor({ i, onRun }: { i: 0 | 1; onRun: () => void }) {
  const sc = useScenarioStore();
  const sp = sc.specs[i];
  const set = (patch: Partial<ScenarioSpec>) => sc.setSpec(i, { ...sp, ...patch, id: patch.id ?? 'custom' });
  const res = sc.results[i];
  return (
    <Panel title={`Scenario ${i === 0 ? 'A' : 'B'}: ${sp.name}`} right={<button className="primary" onClick={onRun}>Run</button>}>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="muted">Preset</span>
        <select value={PRESET_SCENARIOS.some((p) => p.id === sp.id) ? sp.id : ''} onChange={(e) => { const p = PRESET_SCENARIOS.find((x) => x.id === e.target.value); if (p) sc.setSpec(i, structuredClone(p)); }}>
          <option value="">— custom —</option>
          {PRESET_SCENARIOS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input value={sp.name} onChange={(e) => set({ name: e.target.value })} style={{ width: 180 }} />
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>{sp.description}</p>
      <div className="kv" style={{ gridTemplateColumns: '170px 1fr' }}>
        <div>Duration</div><div style={{ textAlign: 'left' }}><Seg value={sp.durationH} onChange={(v) => set({ durationH: v })} options={[12, 24, 48, 72].map((v) => ({ v, l: `${v} h` }))} /></div>
        <div>Starting state</div><div style={{ textAlign: 'left' }}><Seg value={sp.start} onChange={(v) => set({ start: v })} options={[{ v: 'current', l: 'Current live state' }, { v: 'initial', l: 'Configured initial volumes' }]} /></div>
        <div>Rainfall</div><div style={{ textAlign: 'left' }}>
          <Seg value={sp.rain.kind} onChange={(k) => set({ rain: k === 'constant' ? { kind: k, intensity: 20 } : k === 'step' ? { kind: k, before: 5, after: 40, atH: 2 } : { kind: k } })}
            options={[{ v: 'current', l: 'Current' }, { v: 'forecast', l: 'Forecast' }, { v: 'constant', l: 'Constant' }, { v: 'step', l: 'Step change' }]} />
          {sp.rain.kind === 'constant' && <span className="row" style={{ marginTop: 4 }}><NumInput value={sp.rain.intensity} min={0} max={500} width={70} onCommit={(v) => set({ rain: { kind: 'constant', intensity: v } })} /> mm/hr</span>}
          {sp.rain.kind === 'step' && (() => { const r = sp.rain; return <span className="row" style={{ marginTop: 4 }}>
            <NumInput value={r.before} min={0} max={500} width={60} onCommit={(v) => set({ rain: { ...r, before: v } })} /> mm/hr →
            <NumInput value={r.after} min={0} max={500} width={60} onCommit={(v) => set({ rain: { ...r, after: v } })} /> mm/hr after
            <NumInput value={r.atH} min={0} max={72} width={50} onCommit={(v) => set({ rain: { ...r, atH: v } })} /> h</span>; })()}
        </div>
        <div>Pump failures</div><div style={{ textAlign: 'left' }}><Seg value={sp.failPumps} onChange={(v) => set({ failPumps: v })} options={[{ v: 'none', l: 'None' }, { v: 'largest-one-per-sump', l: '1 / sump' }, { v: 'two-per-sump', l: '2 / sump' }, { v: 'all', l: 'All' }]} /></div>
        <div>Total power failure</div><div style={{ textAlign: 'left' }}><input type="checkbox" checked={sp.powerFailure} onChange={(e) => set({ powerFailure: e.target.checked })} /></div>
        <div>Pump efficiency</div><div style={{ textAlign: 'left' }}><Opt value={sp.efficiencyPct} def={60} unit="%" max={100} onChange={(v) => set({ efficiencyPct: v })} /></div>
        <div>Seepage allowance</div><div style={{ textAlign: 'left' }}><Opt value={sp.seepagePct} def={25} unit="%" max={200} onChange={(v) => set({ seepagePct: v })} /></div>
        <div>Measured GW multiplier</div><div style={{ textAlign: 'left' }}><Opt value={sp.groundwaterMultiplier} def={2} unit="×" max={50} onChange={(v) => set({ groundwaterMultiplier: v })} /></div>
        <div>Additional pumps / sump</div><div style={{ textAlign: 'left' }}><NumInput value={sp.additionalPumps} min={0} max={20} step={1} width={60} onCommit={(v) => set({ additionalPumps: Math.round(v) })} /> <span className="muted small">reference pumps, ON</span></div>
        <div>Start OFF/standby pumps</div><div style={{ textAlign: 'left' }}><input type="checkbox" checked={sp.startStandby} onChange={(e) => set({ startStandby: e.target.checked })} /></div>
        <div>Initial fill override</div><div style={{ textAlign: 'left' }}><Opt value={sp.initialFillPct} def={90} unit="% of usable" max={100} onChange={(v) => set({ initialFillPct: v })} /></div>
      </div>
      {res && <p className="muted small">Last run {new Date(res.computedAt).toLocaleTimeString()} — {res.spec.name}</p>}
    </Panel>
  );
}

function Opt({ value, def, unit, max, onChange }: { value: number | null; def: number; unit: string; max: number; onChange: (v: number | null) => void }) {
  return <span className="row"><input type="checkbox" checked={value != null} onChange={(e) => onChange(e.target.checked ? def : null)} />
    {value != null ? <><NumInput value={value} min={0} max={max} width={70} onCommit={onChange} /> {unit}</> : <span className="muted">unchanged</span>}</span>;
}

function Comparison({ a, b }: { a: ScenarioResult | null; b: ScenarioResult | null }) {
  const s = useStore();
  const res = [a, b].filter(Boolean) as ScenarioResult[];
  const chart = useMemo(() => {
    const map = new Map<number, Record<string, number>>();
    res.forEach((r, k) => r.sim.series.forEach((p) => {
      const row = map.get(p.t) ?? { t: p.t };
      for (const id of SUMP_IDS) row[`${k}_${id}`] = (p.V[id] / s.config.sumps[id].existingCapacity) * 100;
      map.set(p.t, row);
    }));
    return [...map.values()].sort((x, y) => x.t - y.t);
  }, [a, b, s.config]);
  if (!res.length) return <Panel title="Comparison"><p className="muted">Run a scenario to see results.</p></Panel>;
  type Row = [string, (r: ScenarioResult, id: typeof SUMP_IDS[number]) => string, ((r: ScenarioResult, id: typeof SUMP_IDS[number]) => boolean)?];
  const rows: Row[] = [
    ['Total inflow over period (m³)', (r, id) => fmt0(r.perSump[id].totalInflow)],
    ['Peak inflow (m³/hr)', (r, id) => fmt0(r.perSump[id].peakInflow)],
    ['Effective pumping at start (m³/hr)', (r, id) => fmt0(r.perSump[id].pumpCapEff)],
    ['Net removal at start (m³/hr)', (r, id) => fmt0(r.perSump[id].netRemovalStart), (r, id) => r.perSump[id].netRemovalStart < 0],
    ['Final volume / utilisation', (r, id) => `${fmt0(r.perSump[id].finalV)} (${pct(r.perSump[id].finalUtil)})`],
    ['Peak utilisation', (r, id) => pct(r.perSump[id].peakUtil), (r, id) => r.perSump[id].peakUtil >= 85],
    ['Emptying time', (r, id) => r.perSump[id].timeToEmpty == null ? 'not within period' : dur(r.perSump[id].timeToEmpty)],
    ['Time to critical level', (r, id) => r.perSump[id].timeToCritical == null ? '—' : dur(r.perSump[id].timeToCritical), (r, id) => r.perSump[id].timeToCritical != null],
    ['Time to overflow', (r, id) => r.perSump[id].timeToOverflow == null ? 'no overflow' : dur(r.perSump[id].timeToOverflow), (r, id) => r.perSump[id].timeToOverflow != null],
    ['Overflow volume (m³)', (r, id) => fmt0(r.perSump[id].overflowVol), (r, id) => r.perSump[id].overflowVol > 0],
    ['Extra effective pumping to prevent overflow (m³/hr)', (r, id) => fmt0(r.perSump[id].extraEffToPreventOverflow), (r, id) => r.perSump[id].extraEffToPreventOverflow > 0],
    [`… as ${s.config.referencePumpRating} m³/hr pumps`, (r, id) => String(r.perSump[id].extraPumpsToPreventOverflow), (r, id) => r.perSump[id].extraPumpsToPreventOverflow > 0],
    ['Extra to balance peak inflow (m³/hr)', (r, id) => fmt0(r.perSump[id].extraEffToBalancePeak)],
  ];
  return (
    <>
      <Panel title="Side-by-side comparison" right={<Prov p="simulated" />}>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Metric</th>{SUMP_IDS.map((id) => <th key={id} colSpan={res.length} style={{ textAlign: 'center' }}><span className="swatch" style={{ background: SUMP_COLOR[id] }} />{s.config.sumps[id].name}</th>)}</tr>
            <tr><th></th>{SUMP_IDS.map((id) => res.map((r, k) => <th key={id + k} className="r">{k === 0 && a ? 'A' : 'B'}: {r.spec.name}</th>))}</tr></thead>
          <tbody>{rows.map(([label, f, bad]) => (
            <tr key={label}><td>{label}</td>{SUMP_IDS.map((id) => res.map((r, k) => <td key={id + k} className={`r ${bad?.(r, id) ? 'err' : ''}`}>{f(r, id)}</td>))}</tr>
          ))}</tbody>
        </table></div>
        <p className="muted small">Extra pumping requirement found by bisection: the smallest constant additional effective capacity for which the same simulation produces no overflow within the period.</p>
      </Panel>
      <Panel title="Storage utilisation over the scenario period" right={<span className="muted small">solid = {res[0].spec.name}{res[1] ? `, dashed = ${res[1].spec.name}` : ''}</span>}>
        <TimeChart data={chart} unit="%" yLabel="% of usable storage" xLabel="Hours from scenario start" yDomain={[0, 100]} height={300}
          series={res.flatMap((r, k) => SUMP_IDS.map((id) => ({ key: `${k}_${id}`, name: `${r.spec.name} — ${id}`, color: SUMP_COLOR[id], dashed: k === 1 })))} refLines={[{ y: s.thresholds.level.criticalPct, label: 'Critical' }]} />
      </Panel>
    </>
  );
}
