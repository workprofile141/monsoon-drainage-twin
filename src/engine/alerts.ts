/**
 * ALERT ENGINE — every threshold comes from the configurable Thresholds record.
 * Severity colours: normal = green, warning = yellow, critical = orange, emergency = red.
 */
import type { Ctx, SimState, SumpId, Thresholds } from './types';
import { SUMP_IDS } from './types';
import type { LivePrediction } from './prediction';
import { levelsFor } from './prediction';
import { effectiveCapacity } from './pumps';
import { designDay } from './runoff';
import { ORIGINAL_DESIGN } from './original';

export type Severity = 'normal' | 'warning' | 'critical' | 'emergency';
export const SEV_RANK: Record<Severity, number> = { normal: 0, warning: 1, critical: 2, emergency: 3 };

export interface AlertItem {
  key: string;
  sumpId: SumpId | null;
  severity: Exclude<Severity, 'normal'>;
  category: 'operational' | 'design';
  type: string;
  title: string;
  parameter: string;
  actual: number;
  threshold: number;
  unit: string;
  consequence: string;
}

const f0 = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-IN') : '∞');
const f1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '∞');

export function evaluateAlerts(ctx: Ctx, s: SimState, live: LivePrediction, th: Thresholds, rain24hMm: number): AlertItem[] {
  const out: AlertItem[] = [];
  const I = live.intensity;
  const totalIn = SUMP_IDS.reduce((a, id) => a + live.rates[id].qIn, 0);

  // Rainfall intensity
  const rSev = I >= th.rainfallEmergencyMmH ? 'emergency' : I >= th.rainfallCriticalMmH ? 'critical' : I >= th.rainfallWarnMmH ? 'warning' : null;
  if (rSev) {
    const thr = rSev === 'emergency' ? th.rainfallEmergencyMmH : rSev === 'critical' ? th.rainfallCriticalMmH : th.rainfallWarnMmH;
    out.push({ key: 'rain-intensity', sumpId: null, severity: rSev, category: 'operational', type: 'Rainfall', title: 'Rainfall intensity above limit',
      parameter: 'Rainfall intensity', actual: I, threshold: thr, unit: 'mm/hr',
      consequence: `Mine-wide inflow ${f0(totalIn)} m³/hr across the four sumps.` });
  }
  if (rain24hMm >= th.dailyRainLimitMm) {
    out.push({ key: 'rain-24h', sumpId: null, severity: 'critical', category: 'operational', type: 'Rainfall', title: '24-hour rainfall exceeds design limit',
      parameter: '24-hour accumulated rainfall', actual: rain24hMm, threshold: th.dailyRainLimitMm, unit: 'mm',
      consequence: 'Design-day accumulation basis of the assessment is exceeded; sump storage requirement is no longer conservative.' });
  }

  for (const id of SUMP_IDS) {
    const r = live.rates[id];
    const cap = ctx.config.sumps[id].existingCapacity;
    const V = s.volumes[id];
    const util = cap > 0 ? (V / cap) * 100 : 0;
    const L = levelsFor(th, id);
    const fc = live.forecast.perSump[id];
    const cc = live.constant.perSump[id];

    // Power failure
    if (!r.powerOn) {
      out.push({ key: `power-${id}`, sumpId: id, severity: r.qIn > 0 ? 'emergency' : 'critical', category: 'operational', type: 'Power', title: 'Power failure at pump station',
        parameter: 'Power available', actual: 0, threshold: 1, unit: 'flag',
        consequence: `All pumps stopped. Sump filling at ${f0(r.qIn)} m³/hr` + (cc.timeToOverflow != null ? `; overflow in ${f1(cc.timeToOverflow)} h if rainfall continues.` : '.') });
    }
    // Pump failures
    for (const p of ctx.pumps.pumps.filter((x) => x.sumpId === id && x.status === 'FAILED')) {
      out.push({ key: `pumpfail-${p.id}`, sumpId: id, severity: 'critical', category: 'operational', type: 'Pump failure', title: `Pump ${p.tag} failed`,
        parameter: `Pump ${p.tag} status`, actual: 0, threshold: 1, unit: 'running',
        consequence: `Effective capacity reduced by ${f0(effectiveCapacity(p, ctx.config).value)} m³/hr.` });
    }
    // Inflow exceeding active pumping
    if (r.qIn > r.capActiveEff + 1e-6 && r.qIn > 0) {
      const sev = fc.timeToOverflow != null && fc.timeToOverflow <= th.overflowLeadH ? 'critical' : 'warning';
      out.push({ key: `inflow-${id}`, sumpId: id, severity: sev, category: 'operational', type: 'Water balance', title: 'Inflow exceeds pumping capacity',
        parameter: 'Inflow vs effective pumping', actual: r.qIn, threshold: r.capActiveEff, unit: 'm³/hr',
        consequence: `Sump filling at ${f0(r.qIn - r.capActiveEff)} m³/hr` + (cc.timeToCritical != null && cc.timeToCritical > 0 ? `; critical level in ${f1(cc.timeToCritical)} h at current rain.` : '.') });
    }
    // Levels
    if (V >= cap - 1e-6 && r.qNet < 0) {
      out.push({ key: `level-${id}`, sumpId: id, severity: 'emergency', category: 'operational', type: 'Sump level', title: 'Sump OVERFLOWING',
        parameter: 'Storage utilisation', actual: util, threshold: 100, unit: '%',
        consequence: `Overflowing at ${f0(-r.qNet)} m³/hr; cumulative overflow ${f0(s.cumOverflow[id])} m³.` });
    } else if (util >= L.emergencyPct) {
      out.push({ key: `level-${id}`, sumpId: id, severity: 'emergency', category: 'operational', type: 'Sump level', title: 'Sump at emergency level',
        parameter: 'Storage utilisation', actual: util, threshold: L.emergencyPct, unit: '%', consequence: overflowText(fc.timeToOverflow) });
    } else if (util >= L.criticalPct) {
      out.push({ key: `level-${id}`, sumpId: id, severity: 'critical', category: 'operational', type: 'Sump level', title: 'Sump at critical level',
        parameter: 'Storage utilisation', actual: util, threshold: L.criticalPct, unit: '%', consequence: overflowText(fc.timeToOverflow) });
    } else if (util >= L.warnPct) {
      out.push({ key: `level-${id}`, sumpId: id, severity: 'warning', category: 'operational', type: 'Sump level', title: 'Sump at warning level',
        parameter: 'Storage utilisation', actual: util, threshold: L.warnPct, unit: '%', consequence: overflowText(fc.timeToOverflow) });
    }
    // Approaching overflow (forecast)
    if (fc.timeToOverflow != null && fc.timeToOverflow > 0 && fc.timeToOverflow <= th.overflowLeadH) {
      out.push({ key: `approach-${id}`, sumpId: id, severity: 'emergency', category: 'operational', type: 'Overflow forecast', title: 'Approaching overflow',
        parameter: 'Forecast time to overflow', actual: fc.timeToOverflow, threshold: th.overflowLeadH, unit: 'h',
        consequence: `Forecast overflow volume ${f0(fc.overflowVol)} m³ within ${ctx.config.sim.predictionHorizonH} h.` });
    }
    // Inadequate pumping capacity (design basis)
    const dd = designDay(ctx.config, id);
    if (r.capInstalledEff < dd.requiredPumpingEff - 1e-6) {
      out.push({ key: `design-pump-${id}`, sumpId: id, severity: 'warning', category: 'design', type: 'Capacity', title: 'Inadequate pumping capacity (design basis)',
        parameter: 'Serviceable effective capacity vs design requirement', actual: r.capInstalledEff, threshold: dd.requiredPumpingEff, unit: 'm³/hr',
        consequence: `Design-day accumulation of ${f0(dd.Qtotal)} m³ cannot be removed in ${ctx.config.design.assessmentDays * ctx.config.design.hoursPerDay} pumping hours.` });
    }
    if (fc.peakQin > r.capInstalledEff + 1e-6 && fc.timeToOverflow != null) {
      out.push({ key: `forecast-pump-${id}`, sumpId: id, severity: 'critical', category: 'operational', type: 'Capacity', title: 'Inadequate pumping capacity for forecast',
        parameter: 'Forecast peak inflow vs serviceable capacity', actual: fc.peakQin, threshold: r.capInstalledEff, unit: 'm³/hr',
        consequence: `Even with every serviceable pump running, forecast overflow ≈ ${f0(fc.overflowVol)} m³.` });
    }
    // Groundwater
    if (ctx.config.groundwater.mode === 'measured') {
      const m = ctx.config.groundwater.measuredM3h[id];
      const e = ctx.config.groundwater.expectedM3h[id];
      const lim = e * (1 + th.groundwaterIncreasePct / 100);
      if (e > 0 && m > lim) {
        out.push({ key: `gw-${id}`, sumpId: id, severity: 'warning', category: 'operational', type: 'Groundwater', title: 'Unexpected increase in groundwater inflow',
          parameter: 'Measured groundwater inflow', actual: m, threshold: lim, unit: 'm³/hr',
          consequence: `Adds ${f0(m - e)} m³/hr above the expected baseline (${f0(m * 24)} m³/day total).` });
      }
    } else {
      const lim = ORIGINAL_DESIGN.seepagePct * (1 + th.groundwaterIncreasePct / 100);
      if (ctx.config.design.seepagePct > lim) {
        out.push({ key: `gw-${id}`, sumpId: id, severity: 'warning', category: 'operational', type: 'Groundwater', title: 'Seepage allowance increased above assessment',
          parameter: 'Seepage allowance', actual: ctx.config.design.seepagePct, threshold: lim, unit: '%',
          consequence: `Inflow increased by ${f0(r.qGroundwater)} m³/hr groundwater component at current rainfall.` });
      }
    }
  }
  return out;
}

function overflowText(t: number | null) {
  return t == null ? 'No overflow forecast within the prediction horizon.' : t === 0 ? 'Overflowing now.' : `Forecast overflow in ${f1(t)} h.`;
}

export function sumpSeverity(alerts: AlertItem[], id: SumpId): Severity {
  let s: Severity = 'normal';
  for (const a of alerts) if (a.sumpId === id && a.category === 'operational' && SEV_RANK[a.severity] > SEV_RANK[s]) s = a.severity;
  return s;
}
