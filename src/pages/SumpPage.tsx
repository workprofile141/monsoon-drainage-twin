import { useParams, useNavigate } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { useStore, ctxOf } from '../store/store';
import type { SumpId } from '../engine/types';
import { SUMP_IDS } from '../engine/types';
import { PredictionPanel } from '../ui/PredictionPanel';
import { PumpPanel } from '../ui/PumpPanel';
import { NumInput, Panel, Prov, Seg } from '../ui/components';
import { TimeChart } from '../ui/charts';
import { analyseCombinations } from '../engine/combos';
import { useSumpView } from '../ui/hooks';
import { fmt0, fmt2, SUMP_COLOR } from '../ui/format';
import { markerLevels } from '../engine/visual';
import { designDay } from '../engine/runoff';

export default function SumpPage() {
  const { id: raw } = useParams();
  const id = (SUMP_IDS.includes(raw as SumpId) ? raw : 'A') as SumpId;
  const nav = useNavigate();
  const s = useStore();
  const v = useSumpView(id);
  const live = s.derived.live;
  const [setV, setSetV] = useState<number | null>(null);

  // history + both projections on one time axis
  const projection = useMemo(() => {
    if (!live) return [];
    const t0 = s.sim.t;
    const hist = s.history.map((p) => ({ t: p.t, actual: p[`${id}_V`] }));
    const map = new Map<number, Record<string, number>>();
    for (const p of live.constant.series) if (p.t <= 48) map.set(+(t0 + p.t).toFixed(3), { t: t0 + p.t, cur: p.V[id] });
    for (const p of live.forecast.series) if (p.t <= 48) { const k = +(t0 + p.t).toFixed(3); map.set(k, { ...(map.get(k) ?? { t: t0 + p.t }), fc: p.V[id] }); }
    return [...hist, ...[...map.values()].sort((a, b) => a.t - b.t)];
  }, [live, s.history, s.sim.t, id]);

  const dd = designDay(s.config, id);
  const combos = useMemo(() => {
    if (!live) return null;
    return analyseCombinations(ctxOf(s), id, live.rates[id].qIn, live.forecast.perSump[id].peakQin);
  }, [live, s.pumps, s.config, id]);
  const mk = markerLevels(v.dims, v.levels.warnPct, v.levels.criticalPct);

  return (
    <div>
      <div className="page-head">
        <div><h1><span className="swatch" style={{ background: SUMP_COLOR[id] }} />{v.name}</h1><p>Individual sump dashboard — water balance, predictions, pumps and combination analysis.</p></div>
        <Seg value={id} onChange={(x) => nav(`/sump/${x}`)} options={SUMP_IDS.map((x) => ({ v: x, l: s.config.sumps[x].name.replace(' Sump', '') }))} />
      </div>

      <PredictionPanel id={id} />

      <div className="grid g2">
        <Panel title="Stored volume: history and projections" right={<Prov p="simulated" />}>
          <TimeChart data={projection} unit="m³" yLabel="m³" series={[
            { key: 'actual', name: 'Simulated (history)', color: SUMP_COLOR[id] },
            { key: 'cur', name: 'Projection — current rain', color: '#6b7587', dashed: true },
            { key: 'fc', name: 'Projection — forecast', color: '#e7a3c6', dashed: true },
          ]} refLines={[{ y: v.cap, label: 'Overflow (usable capacity)', color: '#e5484d' }, { y: v.cap * v.levels.criticalPct / 100, label: 'Critical', color: '#f08a24' }]}
            scatter={{ name: 'Manual readings', color: '#e0b25a', data: s.readings.filter((r) => r.sumpId === id && r.kind === 'volume').map((r) => ({ t: r.simT, v: r.value })) }} />
        </Panel>
        <Panel title="Levels and storage (from sump geometry)" right={<Prov p={v.dims.derived ? 'derived' : 'user'} />}>
          <div className="kv">
            <div>Current water level</div><div><b>{fmt2(v.level)} m</b></div>
            <div>Warning level ({v.levels.warnPct} %)</div><div>{fmt2(mk.warnM)} m</div>
            <div>Critical level ({v.levels.criticalPct} %)</div><div>{fmt2(mk.critM)} m</div>
            <div>Maximum usable / overflow (spill) level</div><div>{fmt2(mk.maxM)} m</div>
            <div>Rim (incl. freeboard)</div><div>{fmt2(mk.rimM)} m</div>
            <div>Bottom size L × W</div><div>{fmt0(v.dims.L)} × {fmt0(v.dims.W)} m, side slope {v.dims.s}:1</div>
            <div>Usable capacity (configured)</div><div>{fmt0(v.cap)} m³</div>
            <div>Geometric volume at spill level</div><div>{fmt0(v.dims.geometricCapacity)} m³</div>
            <div>Cumulative inflow / pumped / overflow</div><div>{fmt0(s.sim.cumInflow[id])} / {fmt0(s.sim.cumPumped[id])} / <span className={s.sim.cumOverflow[id] > 0 ? 'err' : ''}>{fmt0(s.sim.cumOverflow[id])}</span> m³</div>
            <div>Design-day accumulation / required storage</div><div>{fmt0(dd.Qtotal)} m³ / {fmt0(dd.requiredCapacity)} m³</div>
          </div>
          {v.dims.derived && <p className="muted small">Geometry is CONCEPTUAL: a prismoidal pit solved so its volume at the spill level equals the usable capacity. Enter surveyed dimensions in Configuration to replace it.</p>}
          {!v.dims.derived && Math.abs(v.dims.geometricCapacity - v.cap) / v.cap > 0.02 && <p className="err small">Surveyed geometry volume differs from the configured usable capacity by {fmt0(v.dims.geometricCapacity - v.cap)} m³ — levels use geometry, balance uses usable capacity.</p>}
          <div className="row" style={{ marginTop: 8 }}>
            <span className="muted">Set current stored volume</span>
            <NumInput value={setV ?? Math.round(v.V)} min={0} max={v.cap} width={110} onCommit={setSetV} />
            <button onClick={() => setV != null && s.setVolume(id, setV, 'manual entry on sump page')}>Apply (manual)</button>
          </div>
        </Panel>
      </div>

      <PumpPanel sumpId={id} />

      {combos && (
        <Panel title="Pump combination analysis (advisory)" right={<Prov p="simulated" />}>
          <p className="muted" style={{ marginTop: 0 }}>Evaluated {combos.enumerated} combinations of {combos.candidates.length} serviceable pumps (ON / OFF / STANDBY) against current inflow <b>{fmt0(combos.qInNow)}</b> m³/hr and forecast peak inflow <b>{fmt0(combos.qInPeak)}</b> m³/hr. Maximum available effective capacity {fmt0(combos.maxCapEff)} m³/hr. Recommendations are advisory only.</p>
          {combos.note && <div className="banner warn">{combos.note}</div>}
          <div className="grid g2" style={{ marginBottom: 10 }}>
            <div className="banner">{combos.minimalCurrent ? <>Smallest set controlling <b>current</b> inflow: <b>{combos.minimalCurrent.tags.join(' + ')}</b> ({fmt0(combos.minimalCurrent.capEff)} m³/hr, {combos.minimalCurrent.switchesNeeded} status change(s))</> : <span className="err">No combination controls the current inflow. Additional reference pumps needed: {combos.extraPumpsNow}.</span>}</div>
            <div className="banner">{combos.minimalPeak ? <>Smallest set controlling the <b>forecast peak</b>: <b>{combos.minimalPeak.tags.join(' + ')}</b> ({fmt0(combos.minimalPeak.capEff)} m³/hr)</> : <span className="err">No combination controls the forecast peak. Additional {s.config.referencePumpRating} m³/hr pumps needed: {combos.extraPumpsPeak}.</span>}</div>
          </div>
          <details><summary>Top combinations</summary>
            <div className="tbl-wrap"><table>
              <thead><tr><th>Pumps</th><th className="r">Effective m³/hr</th><th className="r">Margin vs current</th><th>Controls current</th><th>Controls peak</th><th className="r">Status changes</th></tr></thead>
              <tbody>{combos.combos.slice(0, 20).map((c) => (
                <tr key={c.pumpIds.join()}><td>{c.tags.join(' + ')}</td><td className="r">{fmt0(c.capEff)}</td><td className={`r ${c.marginNow < 0 ? 'err' : 'ok'}`}>{fmt0(c.marginNow)}</td><td>{c.meetsCurrent ? '✓' : '✗'}</td><td>{c.meetsPeak ? '✓' : '✗'}</td><td className="r">{c.switchesNeeded}</td></tr>))}
              </tbody>
            </table></div>
          </details>
        </Panel>
      )}
    </div>
  );
}
