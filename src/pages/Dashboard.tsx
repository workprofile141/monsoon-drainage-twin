import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/store';
import { useAllSumpViews } from '../ui/hooks';
import { Kpi, Panel, SevPill, UtilBar, Prov } from '../ui/components';
import { fmt0, fmt1, dur, fmtDate, pct, SUMP_COLOR } from '../ui/format';
import { SUMP_IDS } from '../engine/types';
import { TimeChart } from '../ui/charts';
import { pumpsNeeded } from '../engine/pumps';

export default function Dashboard() {
  const views = useAllSumpViews();
  const s = useStore();
  const live = s.derived.live;
  const nav = useNavigate();
  const allPumps = s.pumps.pumps;
  const totIn = views.reduce((a, v) => a + (v.rates?.qIn ?? 0), 0);
  const totV = views.reduce((a, v) => a + v.V, 0);
  const totCap = views.reduce((a, v) => a + v.cap, 0);
  const totEff = views.reduce((a, v) => a + (v.rates?.capActiveEff ?? 0), 0);
  const nWarn = views.filter((v) => v.severity === 'warning').length;
  const nCrit = views.filter((v) => v.severity === 'critical' || v.severity === 'emergency').length;
  const fcDepth = live ? live.forecast.series.filter((p) => p.t > 0 && p.t <= 24).reduce((a, p) => a + p.rain * 0.5, 0) : 0;

  return (
    <div>
      <div className="page-head">
        <div><h1>Mine-wide monsoon dashboard</h1><p>Every figure derives from the central calculation engine. Pumping capacity is never pooled across sumps — each sump is served only by the pumps assigned to it.</p></div>
      </div>

      <div className="grid g6" style={{ marginBottom: 14 }}>
        <Kpi label="Rainfall intensity" value={fmt1(live?.intensity)} unit="mm/hr" prov="simulated" sub={`${s.rainfall.mode === 'manual' ? 'Manual input' : 'Timeline'}${s.rainfall.events.length ? ' + events' : ''}`} />
        <Kpi label="24-h accumulated rain" value={fmt1(s.derived.rain24)} unit="mm" prov="simulated" sub={`Forecast next 24 h ≈ ${fmt0(fcDepth)} mm`} />
        <Kpi label="Total water inflow" value={fmt0(totIn)} unit="m³/hr" prov="simulated" sub="Runoff + groundwater, 4 sumps" />
        <Kpi label="Total water stored" value={fmt0(totV)} unit="m³" prov="simulated" sub={`${pct((totV / totCap) * 100)} of usable storage`} />
        <Kpi label="Existing sump capacity" value={fmt0(totCap)} unit="m³" prov="original" sub="Usable storage, sum of 4 sumps" />
        <Kpi label="Effective pumping (running)" value={fmt0(totEff)} unit="m³/hr" prov="simulated" sub="Sum of independent sump stations" />
        <Kpi label="Pumps installed" value={allPumps.length} sub={`${allPumps.filter((p) => p.origin === 'existing').length} existing · ${allPumps.filter((p) => p.origin === 'proposed').length} proposed · ${allPumps.filter((p) => p.origin === 'user').length} user-added`} />
        <Kpi label="Pumps operating" value={views.reduce((a, v) => a + (v.rates?.runningPumpIds.length ?? 0), 0)} sub={`${allPumps.filter((p) => p.status === 'ON').length} switched ON`} />
        <Kpi label="Pumps on standby" value={allPumps.filter((p) => p.status === 'STANDBY').length} sub={`${allPumps.filter((p) => p.status === 'OFF').length} OFF · ${allPumps.filter((p) => p.status === 'MAINTENANCE').length} maintenance`} />
        <Kpi label="Failed pumps" value={allPumps.filter((p) => p.status === 'FAILED').length} className={allPumps.some((p) => p.status === 'FAILED') ? 'bar-sev-critical' : ''} sub={SUMP_IDS.filter((id) => !s.pumps.power[id]).length ? `Power failure at ${SUMP_IDS.filter((id) => !s.pumps.power[id]).join(', ')}` : 'All stations powered'} />
        <Kpi label="Sumps in warning" value={nWarn} className={nWarn ? 'bar-sev-warning' : ''} />
        <Kpi label="Sumps critical / emergency" value={nCrit} className={nCrit ? 'bar-sev-emergency' : ''} />
      </div>

      <div className="grid g4" style={{ marginBottom: 14 }}>
        {views.map((v) => {
          const r = v.rates;
          const deficit = r ? r.qIn - r.capActiveEff : 0;
          return (
            <div key={v.id} className={`panel sump-card bar-sev-${v.severity}`} style={{ marginBottom: 0 }} onClick={() => nav(`/sump/${v.id}`)}>
              <div className="spread" style={{ marginBottom: 6 }}>
                <h2><span className="swatch" style={{ background: SUMP_COLOR[v.id] }} />{v.name}</h2>
                <SevPill s={v.severity} />
              </div>
              <div className="spread small"><span className="muted">Storage {pct(v.util)}</span><span className="muted">{fmt0(v.V)} / {fmt0(v.cap)} m³</span></div>
              <UtilBar pct={v.util} warn={v.levels.warnPct} crit={v.levels.criticalPct} color={SUMP_COLOR[v.id]} />
              <div className="kv" style={{ marginTop: 8 }}>
                <div>Water volume</div><div>{fmt0(v.V)} m³</div>
                <div>Water level</div><div>{v.level.toFixed(2)} m <Prov p={v.dims.derived ? 'derived' : 'user'} /></div>
                <div>Incoming</div><div>{fmt0(r?.qIn)} m³/hr</div>
                <div>Effective pumping</div><div>{fmt0(r?.capActiveEff)} m³/hr ({r?.runningPumpIds.length ?? 0}/{v.pumps.length})</div>
                <div>Net removal</div><div className={r && r.qNet < 0 ? 'err' : 'ok'}>{r ? (r.qNet >= 0 ? '+' : '') + fmt0(r.qNet) : '—'} m³/hr</div>
                <div>Status</div><div><b>{v.statusText}</b></div>
                <div>Est. emptying time</div><div><b>{v.analytic?.tEmpty != null ? dur(v.analytic.tEmpty) : 'Cannot empty'}</b></div>
                <div>Empty at</div><div>{v.emptyAt ? fmtDate(v.emptyAt) : '—'}</div>
                <div>Forecast overflow</div><div className={v.forecast?.timeToOverflow != null ? 'err' : ''}>{v.forecast?.timeToOverflow != null ? `in ${dur(v.forecast.timeToOverflow)}` : 'none ≤ ' + s.config.sim.predictionHorizonH + ' h'}</div>
              </div>
              {deficit > 0 && <div className="small err" style={{ marginTop: 6 }}>Deficit {fmt0(deficit)} m³/hr ≈ {pumpsNeeded(deficit, s.config)} more {s.config.referencePumpRating} m³/hr pumps</div>}
              {!r?.powerOn && <div className="small err">⚡ Power failure — no pump can run</div>}
            </div>
          );
        })}
      </div>

      <div className="grid g2">
        <Panel title="Sump water volume — all sumps" right={<Prov p="simulated" />}>
          <TimeChart data={s.history} series={SUMP_IDS.map((id) => ({ key: `${id}_util`, name: s.config.sumps[id].name, color: SUMP_COLOR[id] }))} unit="%" yLabel="Storage utilisation %" refLines={[{ y: s.thresholds.level.warnPct, label: 'Warning' }, { y: s.thresholds.level.criticalPct, label: 'Critical' }]} />
        </Panel>
        <Panel title="Rainfall intensity" right={<Prov p="simulated" />}>
          <TimeChart data={s.history} series={[{ key: 'rain', name: 'Rainfall', color: '#3987e5' }]} unit="mm/hr" yLabel="mm/hr" area step />
        </Panel>
      </div>

      <Panel title="Live answers" right={<Prov p="simulated" />}>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Sump</th><th className="r">Entering (m³/hr)</th><th className="r">Pumped out (m³/hr)</th><th>Filling / emptying</th><th className="r">Hours to empty</th><th>If rainfall continues</th><th>Under forecast</th><th className="r">Extra pumps for current inflow</th></tr></thead>
          <tbody>{views.map((v) => (
            <tr key={v.id}>
              <td>{v.name}</td>
              <td className="r">{fmt0(v.rates?.qIn)}</td>
              <td className="r">{fmt0(v.rates ? Math.min(v.rates.capActiveEff, v.V > 0 ? Infinity : v.rates.qIn) : 0)}</td>
              <td>{v.statusText}</td>
              <td className="r">{v.analytic?.tEmpty != null ? fmt1(v.analytic.tEmpty) : '∞ (cannot)'}</td>
              <td>{v.constant?.timeToOverflow != null ? <span className="err">Overflow in {dur(v.constant.timeToOverflow)}</span> : v.constant?.timeToEmpty != null ? `Empty in ${dur(v.constant.timeToEmpty)}` : 'Holds below overflow'}</td>
              <td>{v.forecast?.timeToOverflow != null ? <span className="err">Overflow in {dur(v.forecast.timeToOverflow)} ({fmt0(v.forecast.overflowVol)} m³)</span> : v.forecast?.timeToEmpty != null ? `Empty in ${dur(v.forecast.timeToEmpty)}` : 'No overflow'}</td>
              <td className="r">{v.rates ? pumpsNeeded(v.rates.qIn - v.rates.capActiveEff, s.config) : '—'}</td>
            </tr>))}
          </tbody>
        </table></div>
      </Panel>
    </div>
  );
}
