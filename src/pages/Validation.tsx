import { useMemo, useState } from 'react';
import { useStore } from '../store/store';
import { Panel, Prov, Seg } from '../ui/components';
import { designValidation, sourceConsistencyNotes } from '../engine/validation';
import { defaultEngineeringConfig } from '../engine/defaults';
import { runSelfTests, type TestResult } from '../engine/selfTests';
import { fmt0, fmt1, fmtT } from '../ui/format';
import { SUMP_IDS } from '../engine/types';

export function navigationCheck(): { pass: boolean; details: string[] } {
  const s = useStore.getState();
  const nav = s.navLog.filter((n) => n.runId === s.runId);
  const paths = new Set(nav.map((n) => n.path));
  const details: string[] = [];
  if (paths.size < 2) return { pass: false, details: ['Navigate to at least two other screens during this run (ideally while running), then re-run the suite.'] };
  let monotonic = true, advancedWhileRunning = false;
  for (let i = 1; i < nav.length; i++) {
    if (nav[i].simT + 1e-9 < nav[i - 1].simT) monotonic = false;
    if (nav[i - 1].running && nav[i].simT > nav[i - 1].simT) advancedWhileRunning = true;
  }
  const last = nav.slice(-6);
  details.push(`Run ${s.runId}: ${nav.length} screen changes across ${paths.size} screens; simulation time never went backwards: ${monotonic ? 'yes' : 'NO'}.`);
  details.push('Recent: ' + last.map((n) => `${n.path} @ ${fmtT(n.simT)}`).join(' → '));
  details.push(advancedWhileRunning ? 'Simulation kept advancing while switching screens.' : 'Tip: start the simulation and switch screens to also verify continued running.');
  return { pass: monotonic, details };
}

export default function ValidationPage() {
  const s = useStore();
  const [basis, setBasis] = useState<'current' | 'original'>('original');
  const rows = useMemo(() => designValidation(basis === 'current' ? s.config : defaultEngineeringConfig()), [basis, s.config]);
  const notes = sourceConsistencyNotes();
  const [results, setResults] = useState<TestResult[] | null>(null);
  const [ranAt, setRanAt] = useState('');
  const run = () => { setResults(runSelfTests(navigationCheck())); setRanAt(new Date().toLocaleTimeString()); };
  const nPass = results?.filter((r) => r.pass).length ?? 0;
  return (
    <div>
      <div className="page-head"><div><h1>Engineering validation</h1><p>Design-day accumulation calculated by the engine vs the source document, and the mandatory test suite. Calculated values are never forced to match.</p></div></div>
      <Panel title="Design-day validation vs original assessment" right={<Seg value={basis} onChange={setBasis} options={[{ v: 'original', l: 'Engine with original inputs' }, { v: 'current', l: 'Current configuration' }]} />}>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Sump</th><th>Parameter</th><th className="r">Calculated</th><th className="r">Source document</th><th className="r">Difference</th><th className="r">Diff %</th><th>Result</th></tr></thead>
          <tbody>{SUMP_IDS.map((id) => rows.filter((r) => r.sumpId === id).map((r, i) => (
            <tr key={id + r.parameter}>
              <td>{i === 0 ? s.config.sumps[id].name : ''}</td><td>{r.parameter} <span className="muted small">{r.unit}</span></td>
              <td className="r">{fmt1(r.calculated)}</td><td className="r">{fmt0(r.reference)} <Prov p="original" /></td>
              <td className="r">{r.diff >= 0 ? '+' : ''}{fmt1(r.diff)}</td><td className="r">{r.diffPct.toFixed(3)}</td>
              <td className={r.status === 'differs' ? 'err' : 'ok'}>{r.status === 'match' ? '✓ exact' : r.status === 'rounding' ? '✓ source rounding' : '✗ differs'}</td>
            </tr>)))}
          </tbody>
        </table></div>
        <p className="muted small">“Source rounding” = within 1 unit (the document reports whole m³). In “current configuration” mode, any edits you made to areas, coefficients, rainfall or seepage show up here as differences.</p>
      </Panel>
      <Panel title="Source document consistency observations">
        <ul style={{ margin: 0, paddingLeft: 18 }}>{notes.map((n, i) => <li key={i} className={n.severity === 'inconsistent' ? '' : 'muted'} style={{ marginBottom: 4 }}>{n.severity === 'inconsistent' ? '⚠ ' : 'ℹ '}{n.text}</li>)}</ul>
      </Panel>
      <Panel title="Mandatory engineering tests (1 – 14)" right={<>{results && <span className={nPass === results.length ? 'ok' : 'err'}>{nPass}/{results.length} passed · {ranAt}</span>}<button className="primary" onClick={run}>Run test suite</button></>}>
        {!results && <p className="muted">Runs the 14 checks against fresh copies of the engine (your live state is not changed). Test 12 uses this session's navigation log.</p>}
        {results?.map((r) => (
          <details key={r.id} open={!r.pass} style={{ marginBottom: 6 }}>
            <summary><b className={r.pass ? 'ok' : 'err'}>{r.pass ? '✓ PASS' : '✗ FAIL'}</b> — TEST {r.id}: {r.title}</summary>
            <ul className="small" style={{ margin: '4px 0 8px', paddingLeft: 22, color: 'var(--text-secondary)' }}>{r.details.map((d, i) => <li key={i}>{d}</li>)}</ul>
          </details>
        ))}
      </Panel>
    </div>
  );
}
