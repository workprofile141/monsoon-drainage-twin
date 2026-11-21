import { useRef, useState } from 'react';
import { useStore } from '../store/store';
import { NumInput, Panel, Prov, Seg, Tabs } from '../ui/components';
import { SUMP_IDS } from '../engine/types';
import { ORIGINAL_SUMPS, ORIGINAL_COEFFICIENTS, ORIGINAL_DESIGN, SOURCE_DOCUMENT, INFERRED_PUMP_RATING } from '../engine/original';
import { fmt0, fmtT, wall } from '../ui/format';
import { downloadText, toCSV, stamp } from '../ui/download';
import { assessmentHours } from '../engine/runoff';
import { sumpDims } from '../engine/geometry';

type Tab = 'engineering' | 'sumps' | 'original' | 'data' | 'audit';

export default function ConfigPage() {
  const [tab, setTab] = useState<Tab>('engineering');
  return (
    <div>
      <div className="page-head"><div><h1>Engineering configuration & data management</h1><p>Every engineering value is editable here. The original assessment record is read-only and is never overwritten; all edits are logged with timestamps.</p></div></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ v: 'engineering', l: 'Engineering parameters' }, { v: 'sumps', l: 'Sumps, catchments & geometry' }, { v: 'original', l: 'Original assessment (read-only)' }, { v: 'data', l: 'Save / restore / import / export' }, { v: 'audit', l: 'Change log' }]} />
      {tab === 'engineering' && <Engineering />}
      {tab === 'sumps' && <Sumps />}
      {tab === 'original' && <Original />}
      {tab === 'data' && <DataMgmt />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}

function Row({ label, prov, orig, children, unit }: { label: string; prov: 'original' | 'inferred' | 'derived' | 'user'; orig?: number | string; children: React.ReactNode; unit?: string }) {
  return <tr><td>{label}</td><td><Prov p={prov} /></td><td className="r">{children}</td><td className="muted">{unit}</td><td className="r muted">{orig ?? ''}</td></tr>;
}

function Engineering() {
  const s = useStore();
  const c = s.config;
  const u = s.updateConfig;
  return (
    <div className="grid g2">
      <Panel title="Runoff coefficients">
        <table><thead><tr><th>Area</th><th>Source</th><th className="r">Value</th><th></th><th className="r">Original</th></tr></thead><tbody>
          <Row label="Excavation area n1" prov="original" orig={ORIGINAL_COEFFICIENTS.n1_excavation}><NumInput value={c.coefficients.n1} min={0} max={1} onCommit={(v) => u('coefficients.n1', v)} /></Row>
          <Row label="External dump area n2" prov="original" orig={ORIGINAL_COEFFICIENTS.n2_externalDump}><NumInput value={c.coefficients.n2} min={0} max={1} onCommit={(v) => u('coefficients.n2', v)} /></Row>
          <Row label="Backfilled / internal dump n3" prov="original" orig={ORIGINAL_COEFFICIENTS.n3_backfilled}><NumInput value={c.coefficients.n3} min={0} max={1} onCommit={(v) => u('coefficients.n3', v)} /></Row>
          <Row label="Area beyond excavation n4" prov="original" orig={ORIGINAL_COEFFICIENTS.n4_beyondExcavation}><NumInput value={c.coefficients.n4} min={0} max={1} onCommit={(v) => u('coefficients.n4', v)} /></Row>
        </tbody></table>
        <p className="muted small">n2 is retained but only enters the calculation for a sump whose external dump area (Aext) is configured &gt; 0. The source gives no external dump area for any of the four sumps.</p>
      </Panel>
      <Panel title="Design assumptions">
        <table><thead><tr><th>Parameter</th><th>Source</th><th className="r">Value</th><th></th><th className="r">Original</th></tr></thead><tbody>
          <Row label="Design rainfall depth R" prov="original" unit="m" orig={ORIGINAL_DESIGN.maxRainfallM}><NumInput value={c.design.rainfallDepthM} min={0} max={5} onCommit={(v) => u('design.rainfallDepthM', v)} /></Row>
          <Row label="Seepage allowance" prov="original" unit="%" orig={ORIGINAL_DESIGN.seepagePct}><NumInput value={c.design.seepagePct} min={0} max={500} onCommit={(v) => u('design.seepagePct', v)} /></Row>
          <Row label="Sump capacity safety factor" prov="original" orig={ORIGINAL_DESIGN.sumpSafetyFactor}><NumInput value={c.design.safetyFactor} min={0.1} max={10} onCommit={(v) => u('design.safetyFactor', v)} /></Row>
          <Row label="Assessment period" prov="original" unit="days" orig={ORIGINAL_DESIGN.assessmentDays}><NumInput value={c.design.assessmentDays} min={0.1} max={60} onCommit={(v) => u('design.assessmentDays', v)} /></Row>
          <Row label="Scheduled pumping hours" prov="original" unit="h/day" orig={ORIGINAL_DESIGN.scheduledHoursPerDay}><NumInput value={c.design.hoursPerDay} min={0.1} max={24} onCommit={(v) => u('design.hoursPerDay', v)} /></Row>
          <tr><td>→ Assessment operating hours</td><td><Prov p="derived" /></td><td className="r">{assessmentHours(c)}</td><td className="muted">h</td><td className="r muted">{ORIGINAL_DESIGN.assessmentHours}</td></tr>
          <Row label="Default pumping efficiency" prov="original" unit="%" orig={ORIGINAL_DESIGN.pumpEfficiencyPct}><NumInput value={c.design.pumpEfficiencyPct} min={1} max={100} onCommit={(v) => u('design.pumpEfficiencyPct', v)} /></Row>
          <Row label="Reference pump rating" prov="inferred" unit="m³/hr" orig={INFERRED_PUMP_RATING}><NumInput value={c.referencePumpRating} min={1} max={20000} onCommit={(v) => u('referencePumpRating', v)} /></Row>
        </tbody></table>
        <label className="row" style={{ marginTop: 8 }}><input type="checkbox" checked={c.design.enforceOperatingHours} onChange={(e) => u('design.enforceOperatingHours', e.target.checked)} />
          Enforce each pump's daily operating hours in the simulation (pumps stop for the rest of the day once their hours are used)</label>
      </Panel>
      <Panel title="Groundwater inflow method" right={<Seg value={c.groundwater.mode} onChange={(m) => u('groundwater.mode', m)} options={[{ v: 'allowance', l: `Seepage allowance (${c.design.seepagePct} %)` }, { v: 'measured', l: 'Measured inflow' }]} />}>
        <div className="formula">{c.groundwater.mode === 'allowance' ? `Qin = Qrunoff × (1 + ${c.design.seepagePct}/100)     — measured values below are ignored` : 'Qin = Qrunoff + Qgroundwater(measured)     — the seepage allowance is NOT applied'}</div>
        <table style={{ marginTop: 8 }}><thead><tr><th>Sump</th><th className="r">Measured inflow m³/hr</th><th className="r">Expected baseline m³/hr</th></tr></thead><tbody>
          {SUMP_IDS.map((id) => <tr key={id}><td>{c.sumps[id].name}</td>
            <td className="r"><NumInput value={c.groundwater.measuredM3h[id]} min={0} max={1e6} disabled={c.groundwater.mode !== 'measured'} onCommit={(v) => u(`groundwater.measuredM3h.${id}`, v)} /></td>
            <td className="r"><NumInput value={c.groundwater.expectedM3h[id]} min={0} max={1e6} onCommit={(v) => u(`groundwater.expectedM3h.${id}`, v)} /></td></tr>)}
        </tbody></table>
        <p className="muted small">Defaults <Prov p="derived" />: seepage allowance at the design day spread over 24 h. Replace with measured values. The expected baseline drives the “unexpected groundwater increase” alert.</p>
      </Panel>
      <Panel title="Simulation & prediction settings">
        <div className="kv">
          <div>Live calculation interval Δt</div><div><Seg value={c.sim.dtMinutes} onChange={(v) => u('sim.dtMinutes', v)} options={[1, 5, 15].map((v) => ({ v: v as 1 | 5 | 15, l: `${v} min` }))} /></div>
          <div>Prediction interval</div><div><Seg value={c.sim.predictionDtMinutes} onChange={(v) => u('sim.predictionDtMinutes', v)} options={[1, 5, 15].map((v) => ({ v: v as 1 | 5 | 15, l: `${v} min` }))} /></div>
          <div>Prediction horizon (h)</div><div><NumInput value={c.sim.predictionHorizonH} min={24} max={720} onCommit={(v) => u('sim.predictionHorizonH', v)} /></div>
        </div>
      </Panel>
    </div>
  );
}

function Sumps() {
  const s = useStore();
  const c = s.config;
  const u = s.updateConfig;
  const fields: [string, string, 'A1' | 'A2' | 'A3' | 'Aext' | 'existingCapacity' | 'initialVolume', 'original' | 'user' | 'derived', string][] = [
    ['Excavation area A1', 'm²', 'A1', 'original', 'A1_excavation'],
    ['Area beyond excavation A3', 'm²', 'A3', 'original', 'A3_beyondExcavation'],
    ['Internal dump / backfilled area A2', 'm²', 'A2', 'original', 'A2_internalDump'],
    ['External dump area Aext', 'm²', 'Aext', 'user', ''],
    ['Existing (usable) sump capacity', 'm³', 'existingCapacity', 'original', 'existingSumpCapacity'],
    ['Initial stored volume (new run)', 'm³', 'initialVolume', 'user', ''],
  ];
  return (
    <>
      <Panel title="Catchment areas and storage">
        <div className="tbl-wrap"><table>
          <thead><tr><th>Parameter</th><th>Source</th>{SUMP_IDS.map((id) => <th key={id} className="r">{c.sumps[id].name}</th>)}</tr></thead>
          <tbody>{fields.map(([label, unit, key, prov, ok]) => (
            <tr key={key}><td>{label} <span className="muted">({unit})</span></td><td><Prov p={prov} /></td>
              {SUMP_IDS.map((id) => {
                const o = ORIGINAL_SUMPS.find((x) => x.id === id)!;
                const orig = ok ? (o as any)[ok] as number : null;
                const val = c.sumps[id][key];
                return <td key={id} className="r"><NumInput value={val} min={0} max={key === 'initialVolume' ? c.sumps[id].existingCapacity : 1e9} width={110} onCommit={(v) => u(`sumps.${id}.${key}`, v)} />
                  {orig != null && orig !== val && <div className="small" style={{ color: 'var(--st-warning)' }}>orig {fmt0(orig)}</div>}</td>;
              })}</tr>))}
          </tbody>
        </table></div>
        <p className="muted small">Initial stored volume defaults to 0 m³ (no measurement available) and applies when the simulation is reset. To change the current volume during a run, use the sump page or a manual reading.</p>
      </Panel>
      <Panel title="Sump geometry (water level ↔ volume)">
        <div className="banner warn">No surveyed sump dimensions were supplied. In <b>derived</b> mode each sump is a CONCEPTUAL prismoidal pit whose bottom size is solved so its volume at the spill level equals the usable capacity. Switch to <b>manual</b> to enter surveyed dimensions.</div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Parameter</th>{SUMP_IDS.map((id) => <th key={id} className="r">{c.sumps[id].name}</th>)}</tr></thead>
          <tbody>
            <tr><td>Mode</td>{SUMP_IDS.map((id) => <td key={id} className="r"><Seg value={c.sumps[id].geometry.mode} onChange={(m) => {
              const d = sumpDims(c.sumps[id]);
              s.replaceConfig({ ...c, sumps: { ...c.sumps, [id]: { ...c.sumps[id], geometry: { ...c.sumps[id].geometry, mode: m, bottomLengthM: c.sumps[id].geometry.bottomLengthM || Math.round(d.L), bottomWidthM: c.sumps[id].geometry.bottomWidthM || Math.round(d.W) } } } }, `${c.sumps[id].name}: geometry mode → ${m}`);
            }} options={[{ v: 'derived', l: 'Derived' }, { v: 'manual', l: 'Manual' }]} /></td>)}</tr>
            {([['Usable depth to spill level (m)', 'usableDepthM'], ['Freeboard above spill (m)', 'freeboardM'], ['Side slope H:V', 'sideSlope'], ['Bottom aspect L/W (derived)', 'aspect'], ['Bottom length (manual, m)', 'bottomLengthM'], ['Bottom width (manual, m)', 'bottomWidthM']] as const).map(([l, k]) => (
              <tr key={k}><td>{l}</td>{SUMP_IDS.map((id) => <td key={id} className="r"><NumInput value={c.sumps[id].geometry[k]} min={0} max={5000} width={90}
                disabled={(k === 'aspect' && c.sumps[id].geometry.mode === 'manual') || ((k === 'bottomLengthM' || k === 'bottomWidthM') && c.sumps[id].geometry.mode === 'derived')}
                onCommit={(v) => u(`sumps.${id}.geometry.${k}`, v)} /></td>)}</tr>))}
            <tr><td>→ Bottom L × W (m)</td>{SUMP_IDS.map((id) => { const d = sumpDims(c.sumps[id]); return <td key={id} className="r">{fmt0(d.L)} × {fmt0(d.W)}</td>; })}</tr>
            <tr><td>→ Geometric volume at spill (m³)</td>{SUMP_IDS.map((id) => { const d = sumpDims(c.sumps[id]); const off = Math.abs(d.geometricCapacity - d.capacity) / d.capacity > 0.02; return <td key={id} className={`r ${off ? 'err' : ''}`}>{fmt0(d.geometricCapacity)}</td>; })}</tr>
          </tbody>
        </table></div>
      </Panel>
    </>
  );
}

function Original() {
  const rows: [string, keyof typeof ORIGINAL_SUMPS[number], string][] = [
    ['Excavation area A1', 'A1_excavation', 'm²'], ['Area beyond excavation A3', 'A3_beyondExcavation', 'm²'], ['Internal dump area A2', 'A2_internalDump', 'm²'],
    ['Water through excavation', 'Q1_excavation', 'm³/day'], ['Water beyond excavation', 'Q2_beyondExcavation', 'm³/day'], ['Water through backfilled area', 'Q3_backfilled', 'm³/day'],
    ['Maximum water per day', 'Qmax_perDay', 'm³/day'], ['Total accumulation incl. 10 % seepage', 'Qtotal_withSeepage', 'm³/day'],
    ['Required sump capacity', 'requiredSumpCapacity', 'm³'], ['Existing sump capacity', 'existingSumpCapacity', 'm³'], ['Balance capacity required', 'balanceSumpCapacity', 'm³'],
    ['Required pumping capacity', 'requiredPumpingCapacity', 'm³/hr'], ['Existing pumping capacity', 'existingPumpingCapacity', 'm³/hr'], ['Existing pumps', 'existingPumps', 'nos'],
    ['Balance pumping capacity required', 'balancePumpingCapacity', 'm³/hr'], ['Additional pumps required', 'additionalPumps', 'nos'], ['Total proposed pumping capacity', 'totalProposedPumpingCapacity', 'm³/hr'],
  ];
  return (
    <Panel title={`Source: “${SOURCE_DOCUMENT}”`} right={<Prov p="original" />}>
      <div className="tbl-wrap"><table>
        <thead><tr><th>Parameter</th><th>Unit</th>{ORIGINAL_SUMPS.map((o) => <th key={o.id} className="r">{o.name}</th>)}</tr></thead>
        <tbody>{rows.map(([l, k, u]) => <tr key={k}><td>{l}</td><td className="muted">{u}</td>{ORIGINAL_SUMPS.map((o) => <td key={o.id} className="r">{fmt0(o[k] as number)}</td>)}</tr>)}</tbody>
      </table></div>
      <p className="muted small">Coefficients: n1 {ORIGINAL_COEFFICIENTS.n1_excavation}, n2 {ORIGINAL_COEFFICIENTS.n2_externalDump}, n3 {ORIGINAL_COEFFICIENTS.n3_backfilled}, n4 {ORIGINAL_COEFFICIENTS.n4_beyondExcavation}. Design: R = {ORIGINAL_DESIGN.maxRainfallM} m, seepage {ORIGINAL_DESIGN.seepagePct} %, SF {ORIGINAL_DESIGN.sumpSafetyFactor}, {ORIGINAL_DESIGN.assessmentHours} h in {ORIGINAL_DESIGN.assessmentDays} days ({ORIGINAL_DESIGN.scheduledHoursPerDay} h/day), efficiency {ORIGINAL_DESIGN.pumpEfficiencyPct} %. Inferred individual pump rating {INFERRED_PUMP_RATING} m³/hr <Prov p="inferred" />. This record is frozen in code and cannot be edited.</p>
    </Panel>
  );
}

function DataMgmt() {
  const s = useStore();
  const [name, setName] = useState('My configuration');
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const exportAll = () => {
    const st = useStore.getState();
    downloadText(`monsoon-twin-export-${stamp()}.json`, JSON.stringify({
      exportedISO: new Date().toISOString(), application: 'Monsoon Drainage Digital Twin', note: 'Simulated values are engine outputs, not measurements.',
      originalAssessment: { sumps: ORIGINAL_SUMPS, coefficients: ORIGINAL_COEFFICIENTS, design: ORIGINAL_DESIGN },
      config: st.config, pumps: st.pumps, rainfall: st.rainfall, thresholds: st.thresholds,
      liveSimulation: st.sim, history: st.history, readings: st.readings, alertLog: st.alertLog, audit: st.audit, runs: st.runs,
    }, null, 2));
  };
  const exportConfig = () => { const st = useStore.getState(); downloadText(`monsoon-config-${stamp()}.json`, JSON.stringify({ config: st.config, pumps: st.pumps, rainfall: st.rainfall, thresholds: st.thresholds }, null, 2)); };
  return (
    <div className="grid g2">
      <Panel title="Save & restore">
        <div className="row"><input value={name} onChange={(e) => setName(e.target.value)} style={{ width: 220 }} /><button className="primary" onClick={() => { s.saveConfig(name); setMsg(`Saved “${name}”`); }}>Save configuration</button></div>
        <p className="muted small">Saves engineering configuration, pumps, rainfall inputs and thresholds. The application state is also persisted automatically in this browser.</p>
        <table><thead><tr><th>Saved configuration</th><th>Saved</th><th></th></tr></thead><tbody>
          {s.savedConfigs.length === 0 && <tr><td colSpan={3} className="muted">None saved yet.</td></tr>}
          {s.savedConfigs.map((c) => <tr key={c.id}><td>{c.name}</td><td>{wall(c.savedISO)}</td><td className="row"><button className="small" onClick={() => { s.loadSavedConfig(c.id); setMsg(`Loaded “${c.name}”`); }}>Load</button><button className="small danger" onClick={() => s.deleteSavedConfig(c.id)}>Delete</button></td></tr>)}
        </tbody></table>
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={() => { if (confirm('Restore all engineering values, pumps, rainfall inputs and thresholds to the original assessment? (Simulation state is kept.)')) { s.restoreOriginal(); setMsg('Original values restored'); } }}>Restore original values</button>
          <button onClick={() => { if (confirm('Reset the simulation (archives the current run)?')) s.reset(true); }}>Reset simulation</button>
        </div>
        {msg && <p className="ok">{msg}</p>}
      </Panel>
      <Panel title="Import / export">
        <div className="row">
          <button onClick={exportAll}>Export everything (JSON)</button>
          <button onClick={exportConfig}>Export configuration (JSON)</button>
          <button onClick={() => downloadText(`simulation-history-${stamp()}.csv`, toCSV(useStore.getState().history), 'text/csv')}>Export history (CSV)</button>
          <button onClick={() => downloadText(`audit-log-${stamp()}.csv`, toCSV(useStore.getState().audit as any), 'text/csv')}>Export change log (CSV)</button>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setMsg(s.importData(await f.text())); e.target.value = ''; }} />
        </div>
        <p className="muted small">Import accepts a JSON file with any of: <code>config</code>, <code>pumps</code>, <code>rainfall</code>, <code>thresholds</code>, <code>readings</code>. The original assessment data is never imported over.</p>
      </Panel>
    </div>
  );
}

function Audit() {
  const s = useStore();
  const [q, setQ] = useState('');
  const rows = s.audit.filter((a) => !q || (a.category + a.message).toLowerCase().includes(q.toLowerCase()));
  return (
    <Panel title={`Change log (${s.audit.length})`} right={<input placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />}>
      <div className="tbl-wrap" style={{ maxHeight: 600, overflowY: 'auto' }}><table>
        <thead><tr><th>Wall clock</th><th>Sim time</th><th>Category</th><th>Change</th></tr></thead>
        <tbody>{rows.slice(0, 500).map((a) => <tr key={a.id}><td className="small">{wall(a.wallISO)}</td><td className="small">{fmtT(a.simT)}</td><td>{a.category}</td><td>{a.message}</td></tr>)}</tbody>
      </table></div>
    </Panel>
  );
}
