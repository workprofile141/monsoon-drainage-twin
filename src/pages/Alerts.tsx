import { useState } from 'react';
import { useStore } from '../store/store';
import { NumInput, Panel, SevPill, Seg } from '../ui/components';
import { fmt1, fmtDate, simClock, fmtT, wall } from '../ui/format';
import { SUMP_IDS, type SumpId } from '../engine/types';
import { SEV_RANK } from '../engine/alerts';

const fv = (v: number, unit: string) => (unit === 'flag' || unit === 'running' ? (v ? 'yes' : 'no') : `${fmt1(v)} ${unit}`);

export default function AlertsPage() {
  const s = useStore();
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const active = [...s.derived.alerts].sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);
  const name = (id: SumpId | null) => (id ? s.config.sumps[id].name : 'Mine-wide');
  const log = s.alertLog.filter((a) => filter === 'all' || !a.clearedISO);
  const t = s.thresholds;
  return (
    <div>
      <div className="page-head"><div><h1>Alerts & thresholds</h1><p>Green = normal · Yellow = warning · Orange = critical · Red = emergency. All thresholds are configurable below.</p></div></div>
      <Panel title={`Active conditions (${active.length})`}>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Severity</th><th>Sump</th><th>Alert</th><th>Triggering parameter</th><th className="r">Actual</th><th className="r">Threshold</th><th>Predicted consequence</th><th>Basis</th></tr></thead>
          <tbody>
            {active.length === 0 && <tr><td colSpan={8}><SevPill s="normal" text="All parameters within thresholds" /></td></tr>}
            {active.map((a) => <tr key={a.key}><td><SevPill s={a.severity} /></td><td>{name(a.sumpId)}</td><td>{a.title}</td><td>{a.parameter}</td><td className="r">{fv(a.actual, a.unit)}</td><td className="r">{fv(a.threshold, a.unit)}</td><td>{a.consequence}</td><td className="muted small">{a.category === 'design' ? 'Design assessment' : 'Simulated operation'}</td></tr>)}
          </tbody>
        </table></div>
      </Panel>

      <Panel title="Alert log" right={<><Seg value={filter} onChange={setFilter} options={[{ v: 'open', l: 'Open' }, { v: 'all', l: 'All incl. cleared' }]} /><button className="small" onClick={s.clearAlertLog}>Purge cleared</button></>}>
        <div className="tbl-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}><table>
          <thead><tr><th>Raised (sim time)</th><th>Wall clock</th><th>Severity</th><th>Sump</th><th>Alert</th><th className="r">Actual</th><th className="r">Threshold</th><th>Consequence</th><th>Cleared</th><th></th></tr></thead>
          <tbody>{log.slice(0, 300).map((a) => <tr key={a.id} style={{ opacity: a.clearedISO ? 0.6 : 1 }}>
            <td>{fmtDate(simClock(s.sim.startISO, a.raisedSimT))}<div className="muted small">{fmtT(a.raisedSimT)} · {a.change}</div></td>
            <td className="small">{wall(a.raisedISO)}</td>
            <td><SevPill s={a.severity} /></td><td>{name(a.sumpId)}</td><td>{a.title}<div className="muted small">{a.parameter}</div></td>
            <td className="r">{fv(a.actual, a.unit)}</td><td className="r">{fv(a.threshold, a.unit)}</td><td className="small">{a.consequence}</td>
            <td className="small">{a.clearedSimT != null ? fmtT(a.clearedSimT) : 'open'}</td>
            <td>{!a.acknowledged ? <button className="small" onClick={() => s.acknowledgeAlert(a.id)}>Ack</button> : <span className="muted small">ack’d</span>}</td>
          </tr>)}</tbody>
        </table></div>
      </Panel>

      <div className="grid g2">
        <Panel title="Rainfall & general thresholds">
          <div className="kv">
            <div>Rainfall warning (mm/hr)</div><div><NumInput value={t.rainfallWarnMmH} min={0} max={500} onCommit={(v) => s.updateThresholds('rainfallWarnMmH', v)} /></div>
            <div>Rainfall critical (mm/hr)</div><div><NumInput value={t.rainfallCriticalMmH} min={0} max={500} onCommit={(v) => s.updateThresholds('rainfallCriticalMmH', v)} /></div>
            <div>Rainfall emergency (mm/hr)</div><div><NumInput value={t.rainfallEmergencyMmH} min={0} max={500} onCommit={(v) => s.updateThresholds('rainfallEmergencyMmH', v)} /></div>
            <div>24-hour rainfall limit (mm)</div><div><NumInput value={t.dailyRainLimitMm} min={0} max={3000} onCommit={(v) => s.updateThresholds('dailyRainLimitMm', v)} /></div>
            <div>“Approaching overflow” lead time (h)</div><div><NumInput value={t.overflowLeadH} min={0} max={168} onCommit={(v) => s.updateThresholds('overflowLeadH', v)} /></div>
            <div>Groundwater increase alert (% above expected)</div><div><NumInput value={t.groundwaterIncreasePct} min={0} max={1000} onCommit={(v) => s.updateThresholds('groundwaterIncreasePct', v)} /></div>
          </div>
          {!(t.rainfallWarnMmH <= t.rainfallCriticalMmH && t.rainfallCriticalMmH <= t.rainfallEmergencyMmH) && <p className="err small">Rainfall thresholds should increase warning ≤ critical ≤ emergency.</p>}
        </Panel>
        <Panel title="Sump level thresholds (% of usable storage)">
          <table><thead><tr><th>Sump</th><th className="r">Warning</th><th className="r">Critical</th><th className="r">Emergency</th><th>Override</th></tr></thead>
            <tbody>
              <tr><td><b>Default (all sumps)</b></td>
                <td className="r"><NumInput value={t.level.warnPct} min={0} max={100} width={70} onCommit={(v) => s.updateThresholds('level.warnPct', v)} /></td>
                <td className="r"><NumInput value={t.level.criticalPct} min={0} max={100} width={70} onCommit={(v) => s.updateThresholds('level.criticalPct', v)} /></td>
                <td className="r"><NumInput value={t.level.emergencyPct} min={0} max={100} width={70} onCommit={(v) => s.updateThresholds('level.emergencyPct', v)} /></td><td></td></tr>
              {SUMP_IDS.map((id) => {
                const o = t.sumpOverrides[id];
                return <tr key={id}><td>{s.config.sumps[id].name}</td>
                  {(['warnPct', 'criticalPct', 'emergencyPct'] as const).map((k) => <td key={k} className="r">{o ? <NumInput value={o[k]} min={0} max={100} width={70} onCommit={(v) => s.updateThresholds(`sumpOverrides.${id}.${k}`, v)} /> : <span className="muted">{t.level[k]}</span>}</td>)}
                  <td><input type="checkbox" checked={!!o} onChange={(e) => s.setSumpOverride(id, e.target.checked)} /></td></tr>;
              })}
            </tbody></table>
        </Panel>
      </div>
    </div>
  );
}
