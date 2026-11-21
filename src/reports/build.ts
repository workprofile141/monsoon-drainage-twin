/**
 * REPORTING — report content is assembled from the store + engine, then rendered to
 * HTML preview, PDF (jsPDF + autotable) or Excel (SheetJS). Every report carries its
 * inputs, formulas, outputs, timestamps and a provenance statement.
 */
import type { AppState } from '../store/store';
import { ctxOf } from '../store/store';
import { SUMP_IDS, type SumpId } from '../engine/types';
import { designDay, effectiveCatchment, assessmentHours } from '../engine/runoff';
import { effectiveCapacity, isServiceable, pumpsNeeded } from '../engine/pumps';
import { sumpDims, levelAtVolume } from '../engine/geometry';
import { ORIGINAL_SUMPS, SOURCE_DOCUMENT } from '../engine/original';
import { HORIZONS } from '../engine/prediction';
import { runScenario, type ScenarioResult, type ScenarioSpec } from '../engine/scenarios';
import { sortedTimeline } from '../engine/rainfall';
import { sumpSeverity } from '../engine/alerts';
import { designValidation } from '../engine/validation';

export type Cell = string | number;
export interface Section { heading: string; paragraphs?: string[]; table?: { head: string[]; rows: Cell[][] } }
export interface Report { id: string; title: string; generatedISO: string; simInfo: string; sections: Section[] }

export const REPORT_TYPES = [
  { id: 'daily', title: 'Daily Monsoon Monitoring Report' },
  { id: 'sump', title: 'Individual Sump Status Report' },
  { id: 'pumps', title: 'Pump Operation Report' },
  { id: 'capacity', title: 'Pumping Capacity Assessment' },
  { id: 'rain', title: 'Rainfall and Water Accumulation Report' },
  { id: 'critical', title: 'Critical Warning Report' },
  { id: 'scenario', title: 'Scenario Simulation Report' },
] as const;
export type ReportId = typeof REPORT_TYPES[number]['id'];

const r0 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : Math.round(n));
const r1 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : Math.round(n * 10) / 10);
const r2 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : Math.round(n * 100) / 100);
const hrs = (n: number | null | undefined, none = 'not reached') => (n == null ? none : Math.round(n * 100) / 100);
const simDate = (s: AppState, t: number) => new Date(new Date(s.sim.startISO).getTime() + t * 3600_000).toLocaleString('en-GB', { hour12: false });

const PROVENANCE = 'Values marked as simulated are outputs of the calculation engine, not measurements. No sensor feeds are connected; any manual readings are listed as such. This report is advisory — the application does not control physical pumps.';

function formulas(s: AppState): Section {
  return {
    heading: 'Calculation basis and formulas',
    paragraphs: [
      'Design day: Q1 = A1·R·n1; Q2 = A3·R·n4; Q3 = A2·R·n3; Qrunoff = Q1+Q2+Q3' + (SUMP_IDS.some((id) => s.config.sumps[id].Aext > 0) ? ' + Aext·R·n2' : '') + '.',
      s.config.groundwater.mode === 'allowance' ? `Groundwater: seepage allowance — Qtotal = Qrunoff × (1 + ${s.config.design.seepagePct}/100).` : 'Groundwater: measured — Qtotal = Qrunoff + Qgw(measured); the seepage allowance is not applied.',
      `Required sump capacity = Qtotal × ${s.config.design.safetyFactor}; required pumping (effective) = Qtotal ÷ ${assessmentHours(s.config)} h (${s.config.design.assessmentDays} days × ${s.config.design.hoursPerDay} h).`,
      'Hourly inflow: Qrain [m³/hr] = [(A1·n1 + A3·n4 + A2·n3)/1000] × I [mm/hr].',
      'Effective pump capacity = rated × efficiency, or pump-curve flow at discharge head (efficiency not re-applied). Qnet = ΣQpump,eff(active) − Qin.',
      `Water balance: V(t+Δt) = V(t) + (Qin − Qpump)·Δt, Δt = ${s.config.sim.dtMinutes} min; 0 ≤ V ≤ usable capacity, excess recorded as overflow. Constant-condition emptying time = V/Qnet (only when Qnet > 0).`,
    ],
  };
}

function header(s: AppState, id: string, title: string): Report {
  return { id, title, generatedISO: new Date().toISOString(), simInfo: `Simulation run ${s.runId}, T+${s.sim.t.toFixed(2)} h (${simDate(s, s.sim.t)}), Δt ${s.config.sim.dtMinutes} min. Source assessment: “${SOURCE_DOCUMENT}”.`, sections: [] };
}

function statusTable(s: AppState): Section {
  const live = s.derived.live!;
  return {
    heading: 'Sump status (simulated)',
    table: {
      head: ['Sump', 'Status', 'Volume m³', 'Usable m³', 'Utilisation %', 'Level m', 'Inflow m³/hr', 'Eff. pumping m³/hr', 'Qnet m³/hr', 'Hours to empty', 'Forecast overflow in h', 'Cum. overflow m³'],
      rows: SUMP_IDS.map((id) => {
        const r = live.rates[id];
        const cap = s.config.sumps[id].existingCapacity;
        return [s.config.sumps[id].name, sumpSeverity(s.derived.alerts, id), r0(s.sim.volumes[id]), r0(cap), r1((s.sim.volumes[id] / cap) * 100),
          r2(levelAtVolume(sumpDims(s.config.sumps[id]), s.sim.volumes[id])), r0(r.qIn), r0(r.capActiveEff), r0(r.qNet),
          live.analytic[id].tEmpty != null ? r2(live.analytic[id].tEmpty) : 'cannot empty', hrs(live.forecast.perSump[id].timeToOverflow, 'none'), r0(s.sim.cumOverflow[id])];
      }),
    },
  };
}

function alertsTable(s: AppState, minSev: 'warning' | 'critical'): Section {
  const ok = (sev: string) => minSev === 'warning' || sev !== 'warning';
  return {
    heading: 'Active alerts',
    table: { head: ['Severity', 'Sump', 'Alert', 'Parameter', 'Actual', 'Threshold', 'Unit', 'Predicted consequence'],
      rows: s.derived.alerts.filter((a) => ok(a.severity)).map((a) => [a.severity.toUpperCase(), a.sumpId ? s.config.sumps[a.sumpId].name : 'Mine-wide', a.title, a.parameter, r2(a.actual), r2(a.threshold), a.unit, a.consequence]) },
  };
}

function pumpsTable(s: AppState, only?: SumpId): Section {
  return {
    heading: only ? 'Pumps at this sump' : 'Pump register',
    table: {
      head: ['Pump', 'Sump', 'Origin', 'Rating basis', 'Rated m³/hr', 'Efficiency %', 'Head m', 'Capacity basis', 'Effective m³/hr', 'Status', 'Run h today', 'Run h total', 'Pumped m³'],
      rows: s.pumps.pumps.filter((p) => !only || p.sumpId === only).map((p) => {
        const e = effectiveCapacity(p, s.config); const run = s.sim.pumpRun[p.id];
        return [p.tag, p.sumpId, p.origin, p.ratingBasis, r0(p.ratedM3h), e.efficiencyPct ?? 'curve', p.dischargeHeadM, e.basis, r0(e.value), p.status + (s.pumps.power[p.sumpId] ? '' : ' (no power)'), r2(run?.todayH ?? 0), r2(run?.totalH ?? 0), r0(run?.pumpedM3 ?? 0)];
      }),
    },
  };
}

function hourly(s: AppState, hours = 24): Section {
  const out: Cell[][] = [];
  const h = s.history;
  const t0 = Math.max(0, Math.floor(s.sim.t) - hours);
  for (let t = t0; t <= s.sim.t + 1e-9; t += 1) {
    const p = h.reduce((best, x) => (Math.abs(x.t - t) < Math.abs(best.t - t) ? x : best), h[0]);
    if (!p) break;
    out.push([`T+${t} h`, simDate(s, t), r1(p.rain), r1(p.cumRain), ...SUMP_IDS.flatMap((id) => [r0(p[`${id}_V`]), r0(p[`${id}_qin`]), r0(p[`${id}_cap`])])]);
  }
  return { heading: `Hourly log (last ${hours} h, simulated)`, table: { head: ['Time', 'Date/time', 'Rain mm/hr', 'Cum. rain mm', ...SUMP_IDS.flatMap((id) => [`${id} V m³`, `${id} Qin`, `${id} Qpump`])], rows: out } };
}

export function buildReport(s: AppState, id: ReportId, opts: { sump?: SumpId; scenarios?: (ScenarioResult | null)[]; scenarioSpecs?: ScenarioSpec[] } = {}): Report {
  const title = REPORT_TYPES.find((r) => r.id === id)!.title;
  const live = s.derived.live;
  if (!live) return { ...header(s, id, title), sections: [{ heading: 'Not ready', paragraphs: ['Engine not yet computed.'] }] };
  const rep = header(s, id, title);
  const sec = rep.sections;

  if (id === 'daily') {
    const totIn = SUMP_IDS.reduce((a, x) => a + live.rates[x].qIn, 0);
    sec.push({ heading: 'Summary', table: { head: ['Item', 'Value', 'Unit', 'Basis'], rows: [
      ['Current rainfall intensity', r1(live.intensity), 'mm/hr', 'simulated'], ['24-hour accumulated rainfall', r1(s.derived.rain24), 'mm', 'simulated'],
      ['Cumulative rainfall since start', r1(s.sim.cumRainMm), 'mm', 'simulated'], ['Total inflow (4 sumps)', r0(totIn), 'm³/hr', 'simulated'],
      ['Total stored', r0(SUMP_IDS.reduce((a, x) => a + s.sim.volumes[x], 0)), 'm³', 'simulated'],
      ['Total usable capacity', r0(SUMP_IDS.reduce((a, x) => a + s.config.sumps[x].existingCapacity, 0)), 'm³', 'original/config'],
      ['Pumps installed / running / failed', `${s.pumps.pumps.length} / ${SUMP_IDS.reduce((a, x) => a + live.rates[x].runningPumpIds.length, 0)} / ${s.pumps.pumps.filter((p) => p.status === 'FAILED').length}`, 'nos', 'configuration'],
      ['Manual readings recorded', s.readings.length, 'nos', 'manual'],
    ] } });
    sec.push(statusTable(s), alertsTable(s, 'warning'), hourly(s), formulas(s));
  }

  if (id === 'sump') {
    const sid = opts.sump ?? 'A';
    const sc = s.config.sumps[sid];
    const r = live.rates[sid];
    const dd = designDay(s.config, sid);
    rep.title = `${title} — ${sc.name}`;
    sec.push({ heading: 'Inputs', table: { head: ['Parameter', 'Value', 'Unit'], rows: [
      ['Excavation area A1', sc.A1, 'm²'], ['Area beyond excavation A3', sc.A3, 'm²'], ['Internal dump area A2', sc.A2, 'm²'], ['External dump area Aext', sc.Aext || 'not configured', 'm²'],
      ['n1 / n2 / n3 / n4', `${s.config.coefficients.n1} / ${s.config.coefficients.n2} / ${s.config.coefficients.n3} / ${s.config.coefficients.n4}`, '-'],
      ['Σ A·n', r0(effectiveCatchment(s.config, sid)), 'm²'], ['Usable capacity', sc.existingCapacity, 'm³'],
      ['Geometry', `${sc.geometry.mode}: depth ${sc.geometry.usableDepthM} m, slope ${sc.geometry.sideSlope}:1`, ''],
    ] } });
    sec.push({ heading: 'Current water balance (simulated)', table: { head: ['Quantity', 'Value', 'Unit'], rows: [
      ['Stored volume', r0(s.sim.volumes[sid]), 'm³'], ['Water level', r2(levelAtVolume(sumpDims(sc), s.sim.volumes[sid])), 'm'], ['Rainfall intensity', r1(r.intensity), 'mm/hr'],
      ['Runoff', r0(r.qRunoff), 'm³/hr'], ['Groundwater', r0(r.qGroundwater), 'm³/hr'], ['Total inflow', r0(r.qIn), 'm³/hr'],
      ['Active rated capacity', r0(r.capActiveRated), 'm³/hr'], ['Effective pumping', r0(r.capActiveEff), 'm³/hr'], ['Net removal', r0(r.qNet), 'm³/hr'],
      ['Emptying time (constant)', live.analytic[sid].tEmpty != null ? r2(live.analytic[sid].tEmpty) : 'cannot empty', 'h'],
      ['Reason', live.analytic[sid].reason ?? '-', ''],
      ['Cumulative inflow / pumped / overflow', `${r0(s.sim.cumInflow[sid])} / ${r0(s.sim.cumPumped[sid])} / ${r0(s.sim.cumOverflow[sid])}`, 'm³'],
    ] } });
    sec.push({ heading: 'Predictions', table: { head: ['Basis', ...HORIZONS.map((h) => `V @ +${h} h`), 'Empty in h', 'Warning in h', 'Critical in h', 'Overflow in h', 'Overflow m³'], rows: [
      ['Current rainfall continues', ...HORIZONS.map((h) => r0(live.constant.perSump[sid].volAt[h])), hrs(live.constant.perSump[sid].timeToEmpty), hrs(live.constant.perSump[sid].timeToWarn), hrs(live.constant.perSump[sid].timeToCritical), hrs(live.constant.perSump[sid].timeToOverflow), r0(live.constant.perSump[sid].overflowVol)],
      ['Configured forecast', ...HORIZONS.map((h) => r0(live.forecast.perSump[sid].volAt[h])), hrs(live.forecast.perSump[sid].timeToEmpty), hrs(live.forecast.perSump[sid].timeToWarn), hrs(live.forecast.perSump[sid].timeToCritical), hrs(live.forecast.perSump[sid].timeToOverflow), r0(live.forecast.perSump[sid].overflowVol)],
    ] } });
    sec.push({ heading: 'Design day', table: { head: ['Q1', 'Q2', 'Q3', 'Qrunoff', 'Qtotal', 'Required capacity', 'Additional capacity', 'Required pumping (eff.)'], rows: [[r0(dd.Q1), r0(dd.Q2), r0(dd.Q3), r0(dd.Qrunoff), r0(dd.Qtotal), r0(dd.requiredCapacity), r0(dd.additionalCapacity), r0(dd.requiredPumpingEff)]] } });
    sec.push(pumpsTable(s, sid), formulas(s));
  }

  if (id === 'pumps') {
    sec.push({ heading: 'Station power', table: { head: ['Sump', 'Power'], rows: SUMP_IDS.map((x) => [s.config.sumps[x].name, s.pumps.power[x] ? 'available' : 'FAILED']) } });
    sec.push(pumpsTable(s));
    sec.push({ heading: 'Pump changes (from change log)', table: { head: ['Wall clock', 'Sim T+ h', 'Change'], rows: s.audit.filter((a) => a.category === 'Pump' || a.category === 'Power').slice(0, 200).map((a) => [a.wallISO, r2(a.simT), a.message]) } });
    sec.push(formulas(s));
  }

  if (id === 'capacity') {
    sec.push({ heading: 'Pumping capacity assessment (current configuration)', table: {
      head: ['Sump', 'Qtotal m³/day', 'Required eff. m³/hr', `Required rated @${s.config.design.pumpEfficiencyPct}% m³/hr`, 'Source required m³/hr', 'Serviceable rated m³/hr', 'Serviceable eff. m³/hr', 'Shortfall eff. m³/hr', `Additional ${s.config.referencePumpRating} m³/hr pumps`, 'Required storage m³', 'Existing storage m³', 'Additional storage m³'],
      rows: SUMP_IDS.map((x) => {
        const dd = designDay(s.config, x); const o = ORIGINAL_SUMPS.find((q) => q.id === x)!;
        const serv = s.pumps.pumps.filter((p) => p.sumpId === x && isServiceable(p));
        const eff = serv.reduce((a, p) => a + effectiveCapacity(p, s.config).value, 0);
        return [s.config.sumps[x].name, r0(dd.Qtotal), r0(dd.requiredPumpingEff), r0(dd.requiredPumpingRated), o.requiredPumpingCapacity, r0(serv.reduce((a, p) => a + p.ratedM3h, 0)), r0(eff), r0(Math.max(0, dd.requiredPumpingEff - eff)), pumpsNeeded(dd.requiredPumpingEff - eff, s.config), r0(dd.requiredCapacity), r0(dd.existingCapacity), r0(dd.additionalCapacity)];
      }) } });
    sec.push({ heading: 'Validation against source', table: { head: ['Sump', 'Parameter', 'Calculated', 'Source', 'Difference', 'Result'], rows: designValidation(s.config).map((v) => [v.sumpId, v.parameter, r1(v.calculated), v.reference, r1(v.diff), v.status]) } });
    sec.push(formulas(s));
  }

  if (id === 'rain') {
    sec.push({ heading: 'Rainfall inputs', paragraphs: [`Live source: ${s.rainfall.mode}${s.rainfall.mode === 'manual' ? ` (${s.rainfall.manualIntensity} mm/hr${s.rainfall.manualDurationH != null ? ` for ${s.rainfall.manualDurationH} h` : ''})` : ''}. After T+24 h: ${s.rainfall.timelineAfter}.`],
      table: { head: ['Timeline from T+ h', 'Intensity mm/hr'], rows: sortedTimeline(s.rainfall.timeline).map((e) => [e.hour, e.intensity]) } });
    sec.push({ heading: 'Rain events', table: { head: ['Event', 'Start T+ h', 'Duration h', '+mm/hr'], rows: s.rainfall.events.map((e) => [e.label, r2(e.startH), e.durationH, e.intensity]) } });
    sec.push({ heading: 'Design-day accumulation', table: { head: ['Sump', 'Q1', 'Q2', 'Q3', 'Qext', 'Qrunoff', 'Groundwater', 'Qtotal m³/day'], rows: SUMP_IDS.map((x) => { const d = designDay(s.config, x); return [s.config.sumps[x].name, r0(d.Q1), r0(d.Q2), r0(d.Q3), r0(d.Qext), r0(d.Qrunoff), r0(d.Qgroundwater), r0(d.Qtotal)]; }) } });
    sec.push({ heading: 'Simulated accumulation since start', table: { head: ['Sump', 'Cum. inflow m³', 'Cum. pumped m³', 'Cum. overflow m³', 'Stored m³'], rows: SUMP_IDS.map((x) => [s.config.sumps[x].name, r0(s.sim.cumInflow[x]), r0(s.sim.cumPumped[x]), r0(s.sim.cumOverflow[x]), r0(s.sim.volumes[x])]) } });
    sec.push({ heading: 'Manual rainfall readings', table: { head: ['Recorded', 'Sim T+ h', 'Value', 'Unit', 'Note'], rows: s.readings.filter((r) => r.kind === 'rainfall').map((r) => [r.wallISO, r2(r.simT), r.value, r.unit, r.note]) } });
    sec.push(hourly(s), formulas(s));
  }

  if (id === 'critical') {
    sec.push(alertsTable(s, 'critical'));
    sec.push({ heading: 'Critical / emergency alert history', table: { head: ['Raised (wall)', 'Sim T+ h', 'Change', 'Severity', 'Sump', 'Alert', 'Actual', 'Threshold', 'Unit', 'Consequence', 'Cleared T+ h', 'Ack'],
      rows: s.alertLog.filter((a) => a.severity !== 'warning').slice(0, 300).map((a) => [a.raisedISO, r2(a.raisedSimT), a.change, a.severity, a.sumpId ?? 'Mine-wide', a.title, r2(a.actual), r2(a.threshold), a.unit, a.consequence, a.clearedSimT != null ? r2(a.clearedSimT) : 'open', a.acknowledged ? 'yes' : 'no']) } });
    sec.push({ heading: 'Thresholds in force', table: { head: ['Threshold', 'Value'], rows: [
      ['Rainfall warning / critical / emergency (mm/hr)', `${s.thresholds.rainfallWarnMmH} / ${s.thresholds.rainfallCriticalMmH} / ${s.thresholds.rainfallEmergencyMmH}`], ['24-h rainfall limit (mm)', s.thresholds.dailyRainLimitMm],
      ['Level warning / critical / emergency (%)', `${s.thresholds.level.warnPct} / ${s.thresholds.level.criticalPct} / ${s.thresholds.level.emergencyPct}`], ['Approaching-overflow lead (h)', s.thresholds.overflowLeadH], ['Groundwater increase (%)', s.thresholds.groundwaterIncreasePct],
    ] } });
    sec.push(statusTable(s));
  }

  if (id === 'scenario') {
    let results = (opts.scenarios ?? []).filter(Boolean) as ScenarioResult[];
    if (!results.length && opts.scenarioSpecs) results = opts.scenarioSpecs.map((sp) => runScenario(ctxOf(s), s.sim, s.thresholds, sp));
    for (const res of results) {
      const sp = res.spec;
      sec.push({ heading: `Scenario: ${sp.name}`, paragraphs: [`${sp.description} Duration ${sp.durationH} h from ${sp.start === 'current' ? 'current live state' : 'configured initial volumes'}; rain ${JSON.stringify(sp.rain)}; pump failures ${sp.failPumps}; power failure ${sp.powerFailure}; efficiency ${sp.efficiencyPct ?? 'unchanged'}; seepage ${sp.seepagePct ?? 'unchanged'}; +${sp.additionalPumps} pumps/sump; initial fill ${sp.initialFillPct ?? 'unchanged'}. Computed ${res.computedAt}.`],
        table: { head: ['Sump', 'Total inflow m³', 'Peak inflow m³/hr', 'Eff. pumping m³/hr', 'Net removal m³/hr', 'Final V m³', 'Peak util %', 'Empty in h', 'Critical in h', 'Overflow in h', 'Overflow m³', 'Extra eff. m³/hr', 'Extra pumps'],
          rows: SUMP_IDS.map((x) => { const p = res.perSump[x]; return [s.config.sumps[x].name, r0(p.totalInflow), r0(p.peakInflow), r0(p.pumpCapEff), r0(p.netRemovalStart), r0(p.finalV), r1(p.peakUtil), hrs(p.timeToEmpty), hrs(p.timeToCritical), hrs(p.timeToOverflow, 'none'), r0(p.overflowVol), r0(p.extraEffToPreventOverflow), p.extraPumpsToPreventOverflow]; }) } });
    }
    sec.push(formulas(s));
  }

  sec.push({ heading: 'Data provenance', paragraphs: [PROVENANCE] });
  return rep;
}
