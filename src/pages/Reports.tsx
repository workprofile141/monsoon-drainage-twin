import { useMemo, useState } from 'react';
import { useStore } from '../store/store';
import { useScenarioStore } from '../store/scenarioStore';
import { buildReport, REPORT_TYPES, type ReportId } from '../reports/build';
import { exportPDF, exportXLSX } from '../reports/export';
import { Panel } from '../ui/components';
import { SUMP_IDS, type SumpId } from '../engine/types';

export default function ReportsPage() {
  const s = useStore();
  const sc = useScenarioStore();
  const [id, setId] = useState<ReportId>('daily');
  const [sump, setSump] = useState<SumpId>('A');
  const [ver, setVer] = useState(0);
  // snapshot (re-built on demand, so the preview does not churn while the simulation runs)
  const rep = useMemo(() => buildReport(useStore.getState(), id, { sump, scenarios: sc.results, scenarioSpecs: sc.specs }), [id, sump, ver, sc.results]); // eslint-disable-line
  return (
    <div>
      <div className="page-head"><div><h1>Reports</h1><p>Each report includes inputs, formulas, outputs, timestamps and provenance. PDF and Excel exports are generated in the browser from the same snapshot.</p></div></div>
      <Panel title="Generate">
        <div className="row">
          <select value={id} onChange={(e) => setId(e.target.value as ReportId)}>{REPORT_TYPES.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select>
          {id === 'sump' && <select value={sump} onChange={(e) => setSump(e.target.value as SumpId)}>{SUMP_IDS.map((x) => <option key={x} value={x}>{s.config.sumps[x].name}</option>)}</select>}
          <button onClick={() => setVer(ver + 1)}>↻ Refresh snapshot</button>
          <button className="primary" onClick={() => exportPDF(rep)}>Export PDF</button>
          <button className="primary" onClick={() => exportXLSX(rep)}>Export Excel</button>
        </div>
        {id === 'scenario' && !sc.results.some(Boolean) && <p className="muted small">No scenario results in the workspace — the two scenarios configured on the Scenario page are run automatically for this report.</p>}
      </Panel>
      <Panel title={rep.title}>
        <p className="muted small">Generated {new Date(rep.generatedISO).toLocaleString('en-GB', { hour12: false })} · {rep.simInfo}</p>
        {rep.sections.map((sec, i) => (
          <div key={i} style={{ marginBottom: 14 }}>
            <h3 style={{ marginBottom: 6 }}>{sec.heading}</h3>
            {sec.paragraphs?.map((p, j) => <p key={j} style={{ margin: '2px 0', color: 'var(--text-secondary)' }}>{p}</p>)}
            {sec.table && <div className="tbl-wrap" style={{ maxHeight: 340, overflowY: 'auto' }}><table>
              <thead><tr>{sec.table.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{sec.table.rows.length === 0 ? <tr><td colSpan={sec.table.head.length} className="muted">(none)</td></tr> : sec.table.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k} className={typeof c === 'number' ? 'r' : ''}>{typeof c === 'number' ? c.toLocaleString('en-IN') : c}</td>)}</tr>)}</tbody>
            </table></div>}
          </div>
        ))}
      </Panel>
    </div>
  );
}
