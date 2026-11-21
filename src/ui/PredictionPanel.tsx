import { useStore } from '../store/store';
import type { SumpId } from '../engine/types';
import { HORIZONS } from '../engine/prediction';
import { useSumpView } from './hooks';
import { Kpi, Panel, Prov, SevPill } from './components';
import { dur, fmt0, fmt1, fmtDate, pct, simClock } from './format';
import type { SumpPrediction } from '../engine/prediction';

export function PredictionPanel({ id }: { id: SumpId }) {
  const v = useSumpView(id);
  const s = useStore();
  const r = v.rates;
  if (!r) return null;
  const clock = (h: number | null | undefined) => (h == null ? '—' : fmtDate(simClock(s.sim.startISO, s.sim.t + h)));
  const fillTag = r.qNet > 1e-6 ? <span className="ok">Emptying</span> : Math.abs(r.qNet) <= 1e-6 ? <span style={{ color: 'var(--st-warning)' }}>Balanced</span> : <span className="err">Filling</span>;
  return (
    <Panel title={<>Live emptying-time prediction <SevPill s={v.severity} /></>} right={<Prov p="simulated" />}>
      <div className="grid g6" style={{ marginBottom: 12 }}>
        <Kpi label="Current water volume" value={fmt0(v.V)} unit="m³" sub={`Usable ${fmt0(v.cap)} m³`} />
        <Kpi label="Water level" value={v.level.toFixed(2)} unit="m" sub={<>of {v.dims.usableDepth} m usable · <Prov p={v.dims.derived ? 'derived' : 'user'} /></>} />
        <Kpi label="Available storage" value={fmt0(v.available)} unit="m³" sub={`Utilisation ${pct(v.util)}`} />
        <Kpi label="Rainfall now" value={fmt1(r.intensity)} unit="mm/hr" />
        <Kpi label="Incoming water" value={fmt0(r.qIn)} unit="m³/hr" sub={`Runoff ${fmt0(r.qRunoff)} + GW ${fmt0(r.qGroundwater)}`} />
        <Kpi label="Active pumps (rated)" value={fmt0(r.capActiveRated)} unit="m³/hr" sub={`${r.runningPumpIds.length} running`} />
        <Kpi label="Effective pumping" value={fmt0(r.capActiveEff)} unit="m³/hr" />
        <Kpi label="Net water removal" value={(r.qNet >= 0 ? '+' : '') + fmt0(r.qNet)} unit="m³/hr" sub={fillTag} />
        <Kpi label="Hours to empty (constant)" value={v.analytic?.tEmpty != null ? fmt1(v.analytic.tEmpty) : '∞'} unit="h" sub={v.analytic?.tEmpty != null ? `T = V / Qnet = ${fmt0(v.V)} / ${fmt0(r.qNet)}` : 'Cannot empty under current conditions'} />
        <Kpi label="Empty at (constant)" value={v.emptyAt ? fmtDate(v.emptyAt) : '—'} />
        <Kpi label="Time to overflow (current rain)" value={v.constant?.timeToOverflow != null ? dur(v.constant.timeToOverflow) : 'none'} sub={`within ${s.config.sim.predictionHorizonH} h`} />
        <Kpi label="Time to overflow (forecast)" value={v.forecast?.timeToOverflow != null ? dur(v.forecast.timeToOverflow) : 'none'} sub={`within ${s.config.sim.predictionHorizonH} h`} />
      </div>
      {v.analytic?.reason && <div className="banner danger">Why it cannot be emptied now: {v.analytic.reason}</div>}
      <div className="tbl-wrap"><table>
        <thead><tr><th>Prediction basis</th>{HORIZONS.map((h) => <th key={h} className="r">Volume @ +{h} h</th>)}<th className="r">Time to empty</th><th className="r">→ Warning</th><th className="r">→ Critical</th><th className="r">→ Overflow</th><th className="r">Overflow vol.</th></tr></thead>
        <tbody>
          <PredRow label={`1. Current rainfall continues (${fmt1(r.intensity)} mm/hr)`} p={v.constant} clock={clock} />
          <PredRow label="2. Configured forecast (timeline + events)" p={v.forecast} clock={clock} />
        </tbody>
      </table></div>
      <p className="muted small" style={{ marginBottom: 0 }}>Time-stepped simulation at {s.config.sim.predictionDtMinutes}-min steps over {s.config.sim.predictionHorizonH} h with the same water-balance engine as the live run (pumps cannot pump a dry sump; volume above usable capacity is overflow). “0 / now” means the level is already above that threshold. Warning {v.levels.warnPct} %, critical {v.levels.criticalPct} % of usable storage.</p>
    </Panel>
  );
}

function PredRow({ label, p, clock }: { label: string; p?: SumpPrediction; clock: (h: number | null) => string }) {
  if (!p) return null;
  const cell = (h: number | null, bad?: boolean) => <td className={`r ${bad && h != null ? 'err' : ''}`}>{h == null ? 'not reached' : <>{dur(h)}<div className="muted small">{clock(h)}</div></>}</td>;
  return (
    <tr>
      <td>{label}</td>
      {HORIZONS.map((h) => <td key={h} className="r">{fmt0(p.volAt[h])}<div className="muted small">{pct((p.volAt[h] / p.cap) * 100)}</div></td>)}
      {cell(p.timeToEmpty)}{cell(p.timeToWarn, true)}{cell(p.timeToCritical, true)}{cell(p.timeToOverflow, true)}
      <td className={`r ${p.overflowVol > 0 ? 'err' : ''}`}>{fmt0(p.overflowVol)} m³</td>
    </tr>
  );
}
