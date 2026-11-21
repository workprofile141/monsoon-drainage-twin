import { useState } from 'react';
import { useStore } from '../store/store';
import { NumInput, Panel, Prov } from '../ui/components';
import { PLANNED_CHANNELS } from '../integration/adapters';
import { SUMP_IDS, type SumpId } from '../engine/types';
import { fmtT, wall, fmt0 } from '../ui/format';
import { sumpDims, volumeAt } from '../engine/geometry';
import type { ManualReading } from '../store/store';

const UNITS: Record<ManualReading['kind'], string> = { rainfall: 'mm (cumulative)', volume: 'm³', level: 'm', flow: 'm³/hr', groundwater: 'm³/hr' };

export default function IntegrationPage() {
  const s = useStore();
  const [kind, setKind] = useState<ManualReading['kind']>('volume');
  const [sump, setSump] = useState<SumpId>('A');
  const [value, setValue] = useState(0);
  const [note, setNote] = useState('');
  const apply = (r: ManualReading) => {
    if (!r.sumpId) return;
    if (r.kind === 'volume') s.setVolume(r.sumpId, r.value, `manual reading ${wall(r.wallISO)}`);
    if (r.kind === 'level') { const d = sumpDims(s.config.sumps[r.sumpId]); s.setVolume(r.sumpId, volumeAt(d.L, d.W, d.s, r.value), `manual level reading ${r.value} m via geometry`); }
    if (r.kind === 'groundwater') { s.updateConfig('groundwater.mode', 'measured'); s.updateConfig(`groundwater.measuredM3h.${r.sumpId}`, r.value); }
  };
  return (
    <div>
      <div className="page-head"><div><h1>Sensors, readings & integration readiness</h1><p>No live sensor feeds are connected. Every live value in this application is <Prov p="simulated" /> or <Prov p="manual" /> and is labelled as such.</p></div></div>
      <div className="banner danger">Control safety: this dashboard is advisory and has no control path to physical pumps. Pump ON/OFF changes here alter the simulation only. Any future control integration must be separately implemented, authenticated and safety-validated.</div>
      <Panel title="Manual readings">
        <div className="row">
          <select value={kind} onChange={(e) => setKind(e.target.value as ManualReading['kind'])}>{Object.keys(UNITS).map((k) => <option key={k} value={k}>{k}</option>)}</select>
          {kind !== 'rainfall' && <select value={sump} onChange={(e) => setSump(e.target.value as SumpId)}>{SUMP_IDS.map((id) => <option key={id} value={id}>{s.config.sumps[id].name}</option>)}</select>}
          <NumInput value={value} min={0} max={1e9} onCommit={setValue} /><span className="muted">{UNITS[kind]}</span>
          <input placeholder="Note / observer" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="primary" onClick={() => { s.addReading({ source: 'manual', kind, sumpId: kind === 'rainfall' ? null : sump, value, unit: UNITS[kind], note }); setNote(''); }}>Record reading</button>
        </div>
        <p className="muted small">Readings are time-stamped with wall-clock and simulation time and appear on charts as manual points. “Apply” synchronises the simulation to a reading (volume, level → volume via geometry, or measured groundwater).</p>
        <div className="tbl-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}><table>
          <thead><tr><th>Recorded</th><th>Sim time</th><th>Source</th><th>Kind</th><th>Sump</th><th className="r">Value</th><th>Note</th><th></th></tr></thead>
          <tbody>
            {s.readings.length === 0 && <tr><td colSpan={8} className="muted">No readings recorded.</td></tr>}
            {s.readings.map((r) => <tr key={r.id}><td className="small">{wall(r.wallISO)}</td><td>{fmtT(r.simT)}</td><td><Prov p={r.source} /></td><td>{r.kind}</td><td>{r.sumpId ?? '—'}</td><td className="r">{fmt0(r.value)} {r.unit}</td><td>{r.note}</td>
              <td className="row">{['volume', 'level', 'groundwater'].includes(r.kind) && <button className="small" onClick={() => apply(r)}>Apply</button>}<button className="small danger" onClick={() => s.removeReading(r.id)}>✕</button></td></tr>)}
          </tbody>
        </table></div>
      </Panel>
      <Panel title="Planned sensor channels">
        <table><thead><tr><th>Channel</th><th>Kind</th><th>Unit</th><th>Feeds</th><th>Status</th></tr></thead>
          <tbody>{PLANNED_CHANNELS.map((c) => <tr key={c.channel}><td>{c.channel}</td><td>{c.kind}</td><td>{c.unit}</td><td>{c.feeds}</td><td className="muted">Not connected</td></tr>)}</tbody></table>
        <p className="muted small">Integration contract: <code>src/integration/adapters.ts</code> — read-only <code>SensorAdapter</code> (HTTP / MQTT / OPC-UA / Modbus-TCP / file) delivering validated <code>SensorReading</code>s tagged <code>source: 'sensor'</code>. It intentionally exposes no command/write method.</p>
      </Panel>
    </div>
  );
}
