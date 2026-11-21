import { useState } from 'react';
import { useStore } from '../store/store';
import type { SumpId, PumpStatus, Pump, CurvePoint } from '../engine/types';
import { SUMP_IDS, PUMP_STATUSES } from '../engine/types';
import { effectiveCapacity, isRunning } from '../engine/pumps';
import { NumInput, Panel, Prov } from './components';
import { fmt0, fmt1 } from './format';

const STATUS_LABEL: Record<PumpStatus, string> = { ON: 'ON', OFF: 'OFF', STANDBY: 'Standby', MAINTENANCE: 'Maint.', FAILED: 'Fail' };

export function PumpPanel({ sumpId, compact }: { sumpId: SumpId; compact?: boolean }) {
  const s = useStore();
  const pumps = s.pumps.pumps.filter((p) => p.sumpId === sumpId);
  const [newRating, setNewRating] = useState(s.config.referencePumpRating);
  const r = s.derived.live?.rates[sumpId];
  const setQuantity = (n: number) => {
    const n2 = Math.max(0, Math.round(n));
    if (n2 > pumps.length) for (let i = pumps.length; i < n2; i++) s.addPump(sumpId, newRating);
    else if (n2 < pumps.length) {
      const remove = pumps.slice(n2);
      if (confirm(`Remove ${remove.map((p) => p.tag).join(', ')}?`)) remove.forEach((p) => s.removePump(p.id));
    }
  };
  return (
    <Panel title={`Pump management — ${s.config.sumps[sumpId].name}`} right={<>
      <span className="muted small">Station power</span>
      <button className={s.pumps.power[sumpId] ? 'on small' : 'danger small'} onClick={() => s.setPower(sumpId, !s.pumps.power[sumpId])}>{s.pumps.power[sumpId] ? '⚡ Power ON' : '⚡ POWER FAILED — restore'}</button>
    </>}>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="muted">Quantity</span><NumInput value={pumps.length} min={0} max={30} step={1} width={60} onCommit={setQuantity} />
        <span className="muted">New pump rating</span><NumInput value={newRating} min={1} max={20000} width={80} onCommit={setNewRating} /><span className="muted small">m³/hr</span>
        <button onClick={() => s.addPump(sumpId, newRating)}>+ Add pump</button>
        <span style={{ marginLeft: 'auto' }} className="num">Running: <b>{r?.runningPumpIds.length ?? 0}</b> · Rated active <b>{fmt0(r?.capActiveRated)}</b> · Effective active <b>{fmt0(r?.capActiveEff)}</b> m³/hr · Serviceable effective {fmt0(r?.capInstalledEff)} m³/hr</span>
      </div>
      <div className="tbl-wrap"><table>
        <thead><tr>
          <th>Pump</th><th>Basis</th><th className="r">Rated m³/hr</th><th className="r">Eff. %</th><th className="r">Head m</th>
          {!compact && <th className="r">Hrs/day</th>}<th className="r">Effective m³/hr</th><th>Status</th>{!compact && <th className="r">Run h (today/total)</th>}{!compact && <th className="r">Pumped m³</th>}<th>Assign / transfer</th><th></th>
        </tr></thead>
        <tbody>
          {pumps.length === 0 && <tr><td colSpan={12} className="muted">No pumps assigned. The source assessment lists 0 existing pumps here{sumpId === 'A' || sumpId === 'C' ? ' — proposed pumps can be loaded from Configuration' : ''}.</td></tr>}
          {pumps.map((p) => <PumpRow key={p.id} p={p} compact={compact} />)}
        </tbody>
      </table></div>
      <p className="muted small" style={{ marginBottom: 0 }}>Effective capacity = rated × efficiency, or the pump-curve flow at the discharge head when a curve is entered (efficiency is then not applied again). Status changes are <b>advisory simulation inputs</b> — no physical pump is controlled.</p>
    </Panel>
  );
}

function PumpRow({ p, compact }: { p: Pump; compact?: boolean }) {
  const s = useStore();
  const ec = effectiveCapacity(p, s.config);
  const run = s.sim.pumpRun[p.id];
  const running = isRunning(p, s.pumps, s.config, run, s.sim.t);
  const [showCurve, setShowCurve] = useState(false);
  const basis = p.ratingBasis === 'user' ? 'user' : 'inferred';
  return (
    <>
      <tr>
        <td><b className={`st-${p.status}`}>{p.tag}</b> {running ? <span className="ok" title="Discharging">◉</span> : null}<div className="muted small">{p.origin}</div></td>
        <td><Prov p={basis} />{p.ratingBasis === 'aggregate-split' && <div className="small" style={{ color: 'var(--st-warning)' }} title={p.notes}>aggregate split</div>}</td>
        <td className="r"><NumInput value={p.ratedM3h} min={0} max={20000} width={80} onCommit={(v) => s.updatePump(p.id, { ratedM3h: v })} /></td>
        <td className="r">
          <NumInput value={p.efficiencyPct ?? s.config.design.pumpEfficiencyPct} min={1} max={100} width={60} disabled={ec.basis === 'curve'}
            title={ec.basis === 'curve' ? 'Pump curve in use — efficiency not applied' : p.efficiencyPct == null ? 'Using design default' : 'Pump-specific efficiency'}
            onCommit={(v) => s.updatePump(p.id, { efficiencyPct: v })} />
          {p.efficiencyPct != null && ec.basis !== 'curve' && <div><button className="small" onClick={() => s.updatePump(p.id, { efficiencyPct: null })}>use default</button></div>}
        </td>
        <td className="r"><NumInput value={p.dischargeHeadM} min={0} max={500} width={60} onCommit={(v) => s.updatePump(p.id, { dischargeHeadM: v })} />
          <div><button className="small" onClick={() => setShowCurve(!showCurve)}>{p.curve.length >= 2 ? 'curve ✓' : 'curve…'}</button></div></td>
        {!compact && <td className="r"><NumInput value={p.operatingHoursPerDay} min={0} max={24} width={55} onCommit={(v) => s.updatePump(p.id, { operatingHoursPerDay: v })} /></td>}
        <td className="r"><b>{fmt0(ec.value)}</b><div className="muted small">{ec.basis === 'curve' ? `curve @ ${p.dischargeHeadM} m` : `× ${ec.efficiencyPct}%`}</div></td>
        <td>
          <div className="seg">{PUMP_STATUSES.map((st) => (
            <button key={st} className={p.status === st ? 'active' : ''} onClick={() => s.setPumpStatus(p.id, st)} title={st}>{STATUS_LABEL[st]}</button>))}
          </div>
          {p.status === 'ON' && !running && <div className="small" style={{ color: 'var(--st-warning)' }}>{!s.pumps.power[p.sumpId] ? 'no power' : 'daily hours reached'}</div>}
        </td>
        {!compact && <td className="r">{fmt1(run?.todayH ?? 0)} / {fmt1(run?.totalH ?? 0)}</td>}
        {!compact && <td className="r">{fmt0(run?.pumpedM3 ?? 0)}</td>}
        <td>
          <select value={p.sumpId} onChange={(e) => { if (confirm(`Transfer ${p.tag} to ${s.config.sumps[e.target.value as SumpId].name}? It will be set OFF until commissioned.`)) s.transferPump(p.id, e.target.value as SumpId); }}>
            {SUMP_IDS.map((id) => <option key={id} value={id}>{s.config.sumps[id].name}</option>)}
          </select>
        </td>
        <td><button className="small danger" onClick={() => { if (confirm(`Remove pump ${p.tag}?`)) s.removePump(p.id); }}>✕</button></td>
      </tr>
      {showCurve && <tr><td colSpan={12}><CurveEditor p={p} /></td></tr>}
    </>
  );
}

function CurveEditor({ p }: { p: Pump }) {
  const s = useStore();
  const [rows, setRows] = useState<CurvePoint[]>(p.curve.length ? p.curve : [{ headM: 0, flowM3h: p.ratedM3h }, { headM: p.dischargeHeadM * 1.5, flowM3h: 0 }]);
  const valid = rows.length >= 2 && rows.every((r) => r.headM >= 0 && r.flowM3h >= 0) && new Set(rows.map((r) => r.headM)).size === rows.length;
  return (
    <div className="panel" style={{ margin: 0 }}>
      <div className="muted small" style={{ marginBottom: 6 }}>Manufacturer pump curve for {p.tag} (head → delivered flow). Only enter curves from actual pump data. When saved, the effective capacity is read from this curve at the discharge head and the efficiency factor is not applied.</div>
      <div className="row">
        {rows.map((r, i) => (
          <span key={i} className="row" style={{ gap: 3 }}>
            H <NumInput value={r.headM} min={0} width={60} onCommit={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, headM: v } : x)))} />
            Q <NumInput value={r.flowM3h} min={0} width={70} onCommit={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, flowM3h: v } : x)))} />
            <button className="small" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
          </span>
        ))}
        <button className="small" onClick={() => setRows([...rows, { headM: (rows.at(-1)?.headM ?? 0) + 10, flowM3h: 0 }])}>+ point</button>
        <button className="small primary" disabled={!valid} onClick={() => s.updatePump(p.id, { curve: [...rows].sort((a, b) => a.headM - b.headM) })}>Save curve</button>
        <button className="small" onClick={() => s.updatePump(p.id, { curve: [] })}>Remove curve</button>
        {!valid && <span className="err small">Need ≥ 2 points with unique heads, non-negative values</span>}
      </div>
    </div>
  );
}
