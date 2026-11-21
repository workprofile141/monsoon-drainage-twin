import { useStore } from '../store/store';
import { SUMP_IDS, PUMP_STATUSES } from '../engine/types';
import { PumpPanel } from '../ui/PumpPanel';
import { Panel, Prov } from '../ui/components';
import { fmt0 } from '../ui/format';
import { effectiveCapacity, isServiceable } from '../engine/pumps';
import { designDay } from '../engine/runoff';

export default function PumpsPage() {
  const s = useStore();
  return (
    <div>
      <div className="page-head">
        <div><h1>Pump management</h1><p>Every pump has its own identity, rating, efficiency, head, curve and status. Pumps serve only the sump they are assigned to; transfers must be made explicitly.</p></div>
        <div className="row">
          <button className="danger" onClick={() => s.setPower('all', false)}>⚡ Simulate total power failure</button>
          <button onClick={() => s.setPower('all', true)}>Restore all power</button>
          <button onClick={() => { if (confirm('Replace all pumps with the assessment arrangement (existing + proposed)?')) s.loadPumpArrangement(true); }}>Load existing + proposed</button>
          <button onClick={() => { if (confirm('Replace all pumps with existing pumps only?')) s.loadPumpArrangement(false); }}>Load existing only</button>
        </div>
      </div>
      <Panel title="Fleet summary by sump" right={<Prov p="simulated" />}>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Sump</th><th>Power</th>{PUMP_STATUSES.map((st) => <th key={st} className="r">{st}</th>)}<th className="r">Rated (serviceable)</th><th className="r">Effective (serviceable)</th><th className="r">Effective (running)</th><th className="r">Design requirement (eff.)</th><th className="r">Surplus / shortfall</th></tr></thead>
          <tbody>{SUMP_IDS.map((id) => {
            const ps = s.pumps.pumps.filter((p) => p.sumpId === id);
            const serv = ps.filter(isServiceable);
            const effServ = serv.reduce((a, p) => a + effectiveCapacity(p, s.config).value, 0);
            const req = designDay(s.config, id).requiredPumpingEff;
            return <tr key={id}>
              <td>{s.config.sumps[id].name}</td>
              <td className={s.pumps.power[id] ? 'ok' : 'err'}>{s.pumps.power[id] ? 'ON' : 'FAILED'}</td>
              {PUMP_STATUSES.map((st) => <td key={st} className={`r st-${st}`}>{ps.filter((p) => p.status === st).length}</td>)}
              <td className="r">{fmt0(serv.reduce((a, p) => a + p.ratedM3h, 0))}</td>
              <td className="r">{fmt0(effServ)}</td>
              <td className="r">{fmt0(s.derived.live?.rates[id].capActiveEff)}</td>
              <td className="r">{fmt0(req)}</td>
              <td className={`r ${effServ - req < 0 ? 'err' : 'ok'}`}>{fmt0(effServ - req)}</td>
            </tr>;
          })}</tbody>
        </table></div>
        <p className="muted small">Design requirement = design-day accumulation ÷ ({s.config.design.assessmentDays} days × {s.config.design.hoursPerDay} h). Compared with serviceable effective capacity (rated × efficiency or curve).</p>
      </Panel>
      {SUMP_IDS.map((id) => <PumpPanel key={id} sumpId={id} />)}
    </div>
  );
}
