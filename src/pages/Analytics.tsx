import { useState } from 'react';
import { useStore } from '../store/store';
import { Panel, Prov } from '../ui/components';
import { TimeChart, Bars } from '../ui/charts';
import { SUMP_IDS, type SumpId } from '../engine/types';
import { SUMP_COLOR, fmt0, fmt1, wall } from '../ui/format';
import { effectiveCapacity, isServiceable } from '../engine/pumps';
import { designDay } from '../engine/runoff';

export default function AnalyticsPage() {
  const s = useStore();
  const [sel, setSel] = useState<SumpId[]>([...SUMP_IDS]);
  const [focus, setFocus] = useState<SumpId>('B');
  const h = s.history;
  const ser = (suffix: string) => sel.map((id) => ({ key: `${id}_${suffix}`, name: s.config.sumps[id].name, color: SUMP_COLOR[id] }));
  const live = s.derived.live;
  const pumpPerf = s.pumps.pumps.filter((p) => sel.includes(p.sumpId)).map((p) => ({ tag: p.tag, rated: p.ratedM3h, effective: Math.round(effectiveCapacity(p, s.config).value), pumped: Math.round(s.sim.pumpRun[p.id]?.pumpedM3 ?? 0), hours: +(s.sim.pumpRun[p.id]?.totalH ?? 0).toFixed(2) }))

  const capReq = SUMP_IDS.filter((id) => sel.includes(id)).map((id) => ({
    sump: id,
    required: Math.round(designDay(s.config, id).requiredPumpingEff),
    serviceable: Math.round(s.pumps.pumps.filter((p) => p.sumpId === id && isServiceable(p)).reduce((a, p) => a + effectiveCapacity(p, s.config).value, 0)),
    running: Math.round(live?.rates[id].capActiveEff ?? 0),
    inflow: Math.round(live?.rates[id].qIn ?? 0),
    peak: Math.round(live?.forecast.perSump[id].peakQin ?? 0),
  }));
  const readings = (id: SumpId) => s.readings.filter((r) => r.sumpId === id && r.kind === 'volume').map((r) => ({ t: r.simT, v: r.value }));

  return (
    <div>
      <div className="page-head">
        <div><h1>Engineering analytics</h1><p>Provenance: <Prov p="simulated" /> engine output · <Prov p="manual" /> manually entered readings (diamonds) · <Prov p="derived" /> calculated from configuration · <Prov p="sensor" /> none connected.</p></div>
        <div className="row">{SUMP_IDS.map((id) => (
          <label key={id} className="row" style={{ gap: 4 }}><input type="checkbox" checked={sel.includes(id)} onChange={(e) => setSel(e.target.checked ? [...sel, id].sort() as SumpId[] : sel.filter((x) => x !== id))} />
            <span className="swatch" style={{ background: SUMP_COLOR[id] }} />{s.config.sumps[id].name}</label>))}</div>
      </div>
      {h.length < 3 && <div className="banner warn">Little history yet — start the simulation or fast-forward to populate the time-series charts.</div>}
      <div className="grid g2">
        <Panel title="1. Rainfall vs time" right={<Prov p="simulated" />}><TimeChart data={h} series={[{ key: 'rain', name: 'Rainfall intensity', color: '#3987e5' }]} unit="mm/hr" yLabel="mm/hr" area step /></Panel>
        <Panel title="2. Water inflow vs time" right={<Prov p="simulated" />}><TimeChart data={h} series={ser('qin')} unit="m³/hr" yLabel="m³/hr" /></Panel>
        <Panel title="3. Effective pumping capacity (running) vs time" right={<Prov p="simulated" />}><TimeChart data={h} series={ser('cap')} unit="m³/hr" yLabel="m³/hr" step /></Panel>
        <Panel title="4. Sump water volume vs time" right={<Prov p="simulated" />}>
          <TimeChart data={h} series={ser('V')} unit="m³" yLabel="m³" scatter={sel.length === 1 ? { name: 'Manual readings', color: '#e0b25a', data: readings(sel[0]) } : undefined} />
          {sel.length !== 1 && <p className="muted small">Select a single sump to overlay manual volume readings.</p>}
        </Panel>
        <Panel title="5. Storage utilisation vs time" right={<Prov p="simulated" />}><TimeChart data={h} series={ser('util')} unit="%" yLabel="%" yDomain={[0, 100]} refLines={[{ y: s.thresholds.level.warnPct, label: 'Warning' }, { y: s.thresholds.level.criticalPct, label: 'Critical' }]} /></Panel>
        <Panel title="6. Emptying-time prediction (constant conditions) vs time" right={<Prov p="simulated" />}>
          <TimeChart data={h} series={ser('te')} unit="h" yLabel="hours to empty" filterNegative />
          <p className="muted small">Gaps = sump cannot be emptied at that moment (inflow ≥ effective pumping).</p>
        </Panel>
        <Panel title="7. Pump performance" right={<Prov p="simulated" />}>
          <Bars data={pumpPerf} xKey="tag" series={[{ key: 'rated', name: 'Rated m³/hr', color: '#3987e5' }, { key: 'effective', name: 'Effective m³/hr', color: '#199e70' }]} unit="m³/hr" />
          <details><summary>Run hours and pumped volume per pump</summary>
            <table><thead><tr><th>Pump</th><th className="r">Run h</th><th className="r">Pumped m³</th></tr></thead><tbody>{pumpPerf.map((p) => <tr key={p.tag}><td>{p.tag}</td><td className="r">{fmt1(p.hours)}</td><td className="r">{fmt0(p.pumped)}</td></tr>)}</tbody></table>
          </details>
        </Panel>
        <Panel title="8. Available vs required pumping capacity" right={<Prov p="derived" />}>
          <Bars data={capReq} xKey="sump" unit="m³/hr" series={[
            { key: 'required', name: 'Design requirement (eff.)', color: '#9aa3b2' }, { key: 'serviceable', name: 'Serviceable effective', color: '#3987e5' },
            { key: 'running', name: 'Running effective', color: '#199e70' }, { key: 'inflow', name: 'Current inflow', color: '#d95926' }, { key: 'peak', name: 'Forecast peak inflow', color: '#c98500' }]} />
        </Panel>
        <Panel title="9. Cumulative rainfall" right={<Prov p="simulated" />}><TimeChart data={h} series={[{ key: 'cumRain', name: 'Cumulative rainfall', color: '#199e70' }]} unit="mm" yLabel="mm" /></Panel>
        <Panel title="10. Cumulative incoming vs pumped water" right={<>
          <select value={focus} onChange={(e) => setFocus(e.target.value as SumpId)}>{SUMP_IDS.map((id) => <option key={id} value={id}>{s.config.sumps[id].name}</option>)}</select><Prov p="simulated" /></>}>
          <TimeChart data={h} unit="m³" yLabel="m³" series={[{ key: `${focus}_cin`, name: 'Cumulative inflow', color: '#d95926' }, { key: `${focus}_cout`, name: 'Cumulative pumped', color: '#3987e5' }, { key: `${focus}_ovf`, name: 'Cumulative overflow', color: '#e5484d', dashed: true }]} />
        </Panel>
      </div>
      <Panel title="Historical simulation runs (archived on reset)">
        {s.runs.length === 0 ? <p className="muted">No archived runs yet. Resetting a simulation archives it here.</p> :
          <div className="tbl-wrap"><table><thead><tr><th>Run</th><th>Archived</th><th className="r">Sim hours</th><th className="r">Rain mm</th>{SUMP_IDS.map((id) => <th key={id} className="r">{id}: in / pumped / overflow m³</th>)}</tr></thead>
            <tbody>{s.runs.map((r) => <tr key={r.id}><td>{r.name}</td><td>{wall(r.endedISO)}</td><td className="r">{fmt1(r.simHours)}</td><td className="r">{fmt1(r.rainMm)}</td>
              {SUMP_IDS.map((id) => <td key={id} className="r">{fmt0(r.perSump[id].cumIn)} / {fmt0(r.perSump[id].cumPumped)} / <span className={r.perSump[id].cumOverflow > 0 ? 'err' : ''}>{fmt0(r.perSump[id].cumOverflow)}</span></td>)}</tr>)}</tbody></table></div>}
      </Panel>
    </div>
  );
}
