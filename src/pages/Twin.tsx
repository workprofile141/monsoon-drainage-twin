import { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { TwinScene } from '../twin/Scene';
import { useStore } from '../store/store';
import { SUMP_IDS, PUMP_STATUSES, type SumpId } from '../engine/types';
import { Seg, SevPill, Prov } from '../ui/components';
import { useSumpView } from '../ui/hooks';
import { fmt0, fmt1, dur, pct } from '../ui/format';
import { waterVisual, markerLevels, VERTICAL_EXAGGERATION, SCENE_V_SCALE } from '../engine/visual';
import { effectiveCapacity } from '../engine/pumps';

export default function TwinPage() {
  const [selected, setSelected] = useState<SumpId | null>(null);
  const [rain, setRain] = useState(true);
  const [labels, setLabels] = useState(true);
  const [flows, setFlows] = useState(true);
  const config = useStore((s) => s.config);
  return (
    <div>
      <div className="page-head">
        <div><h1>3D mine drainage digital twin</h1><p>Connected live to the calculation engine. Drag to rotate, scroll to zoom, right-drag to pan, click a sump to select it.</p></div>
        <div className="row">
          <Seg value={selected ?? 'all'} onChange={(v) => setSelected(v === 'all' ? null : (v as SumpId))} options={[{ v: 'all', l: 'Overall view' }, ...SUMP_IDS.map((id) => ({ v: id, l: config.sumps[id].name.replace(' Sump', '') }))]} />
          <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={rain} onChange={(e) => setRain(e.target.checked)} />Rain</label>
          <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={flows} onChange={(e) => setFlows(e.target.checked)} />Flows</label>
          <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} />Labels</label>
        </div>
      </div>
      <div className="twin-wrap">
        <Canvas camera={{ position: [0, 78, 92], fov: 45, near: 0.5, far: 1000 }} dpr={[1, 2]} onPointerMissed={() => undefined}>
          <TwinScene rain={rain} labels={labels} flows={flows} selected={selected} onSelect={setSelected} />
        </Canvas>
        <div className="twin-overlay">
          <Legend />
          {selected && <SelectedPanel id={selected} onClose={() => setSelected(null)} />}
          <div className="box small muted" style={{ left: 10, bottom: 10, maxWidth: 520 }}>
            <b style={{ color: 'var(--st-warning)' }}>Conceptual layout — not a surveyed mine model.</b> Positions and catchment patches are schematic (catchments drawn area-proportional at 1 unit = 60 m). Sumps are drawn from the configured sump geometry at 1 unit = 20 m horizontally with ×{VERTICAL_EXAGGERATION.toFixed(0)} vertical exaggeration. Water height = level computed from the simulated volume.
          </div>
        </div>
      </div>
    </div>
  );
}

function Legend() {
  const I = useStore((s) => s.derived.live?.intensity ?? 0);
  return (
    <div className="box small" style={{ left: 10, top: 10 }}>
      <div><b>Rain {fmt1(I)} mm/hr</b> <Prov p="simulated" /></div>
      <div style={{ marginTop: 6 }}>Pumps: {PUMP_STATUSES.map((s) => <span key={s} className={`st-${s}`} style={{ marginRight: 6 }}>■ {s.toLowerCase()}</span>)}</div>
      <div>Levels: <span style={{ color: 'var(--st-warning)' }}>— warning</span> <span style={{ color: 'var(--st-critical)' }}>— critical</span> <span style={{ color: 'var(--st-emergency)' }}>— max / overflow</span> <span className="muted">-- rim</span></div>
      <div>Particles: <span style={{ color: '#1f78e0' }}>● runoff</span> <span style={{ color: '#0a64c8' }}>● pump discharge</span> <span style={{ color: '#ff6b6b' }}>● overflow</span></div>
    </div>
  );
}

function SelectedPanel({ id, onClose }: { id: SumpId; onClose: () => void }) {
  const v = useSumpView(id);
  const s = useStore();
  const r = v.rates;
  const wv = waterVisual(v.dims, v.V);
  const mk = markerLevels(v.dims, v.levels.warnPct, v.levels.criticalPct);
  return (
    <div className="box" style={{ right: 10, top: 10, width: 330, maxHeight: 'calc(100% - 20px)', overflowY: 'auto' }}>
      <div className="spread"><h2>{v.name}</h2><span className="row"><SevPill s={v.severity} /><button className="small" onClick={onClose}>✕</button></span></div>
      <div className="kv small" style={{ marginTop: 8 }}>
        <div>Actual water volume</div><div>{fmt0(v.V)} m³</div>
        <div>Usable storage capacity</div><div>{fmt0(v.cap)} m³</div>
        <div>Utilisation</div><div>{pct(v.util)}</div>
        <div>Current water level</div><div><b>{wv.levelM.toFixed(3)} m</b></div>
        <div>Warning / critical level</div><div>{mk.warnM.toFixed(2)} / {mk.critM.toFixed(2)} m</div>
        <div>Maximum (spill/overflow) level</div><div>{mk.maxM.toFixed(2)} m</div>
        <div>Rim</div><div>{mk.rimM.toFixed(2)} m</div>
        <div>Rendered water surface</div><div>{wv.sceneLevel.toFixed(3)} u = {(wv.sceneLevel / SCENE_V_SCALE).toFixed(3)} m</div>
        <div>Inflow</div><div>{fmt0(r?.qIn)} m³/hr</div>
        <div>Effective pumping</div><div>{fmt0(r?.capActiveEff)} m³/hr</div>
        <div>Net removal</div><div className={r && r.qNet < 0 ? 'err' : 'ok'}>{fmt0(r?.qNet)} m³/hr</div>
        <div>Emptying time</div><div>{v.analytic?.tEmpty != null ? dur(v.analytic.tEmpty) : 'cannot empty'}</div>
        <div>Overflow (forecast)</div><div>{v.forecast?.timeToOverflow != null ? `in ${dur(v.forecast.timeToOverflow)}` : 'none'}</div>
      </div>
      <h3 style={{ marginTop: 10 }}>Pumps (click to toggle)</h3>
      <div className="row" style={{ marginTop: 4 }}>
        <button className={`small ${s.pumps.power[id] ? 'on' : 'danger'}`} onClick={() => s.setPower(id, !s.pumps.power[id])}>⚡ {s.pumps.power[id] ? 'Power ON' : 'Power FAILED'}</button>
      </div>
      <table className="small" style={{ marginTop: 4 }}><tbody>
        {v.pumps.map((p) => (
          <tr key={p.id}><td className={`st-${p.status}`}><b>{p.tag}</b></td><td className="r">{fmt0(effectiveCapacity(p, s.config).value)}</td>
            <td><select value={p.status} onChange={(e) => s.setPumpStatus(p.id, e.target.value as typeof p.status)}>{PUMP_STATUSES.map((st) => <option key={st}>{st}</option>)}</select></td></tr>))}
      </tbody></table>
    </div>
  );
}
