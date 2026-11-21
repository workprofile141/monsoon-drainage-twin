/**
 * EMPTYING-TIME PREDICTION ENGINE.
 * - Constant conditions (analytic):  T_empty = V / Q_net   (only when Q_net > 0)
 * - Changing conditions: numerical time-stepped simulation with the same advance()
 *   function as the live simulation, for (1) current rainfall continuing and
 *   (2) the configured forecast (timeline + scheduled events).
 */
import type { Ctx, SimState, SumpId, RainFn, LevelThresholds, Thresholds, SumpRates } from './types';
import { SUMP_IDS } from './types';
import { advance, cloneState, allRates } from './balance';
import { rainfallAt, forecastRainFn, constantRainFn, liveRainFn } from './rainfall';
import { isServiceable, pumpsNeeded } from './pumps';

export const HORIZONS = [1, 3, 6, 12, 24] as const;

export interface SumpPrediction {
  id: SumpId;
  cap: number;
  startV: number;
  volAt: Record<number, number>;
  timeToEmpty: number | null; // hours from now; 0 = already empty; null = not within horizon
  timeToWarn: number | null;
  timeToCritical: number | null;
  timeToEmergency: number | null;
  timeToOverflow: number | null;
  overflowVol: number;
  totalIn: number;
  totalPumped: number;
  peakQin: number;
  peakV: number;
  peakT: number;
  finalV: number;
}

export interface SimPoint { t: number; rain: number; V: Record<SumpId, number>; qIn: Record<SumpId, number>; pumped: Record<SumpId, number> }

export interface SimResult { horizonH: number; perSump: Record<SumpId, SumpPrediction>; series: SimPoint[] }

export function levelsFor(th: Thresholds, id: SumpId): LevelThresholds {
  return th.sumpOverrides[id] ?? th.level;
}

export interface SimulateOpts {
  horizonH: number;
  dtH: number;
  sampleH?: number;
  levels: Record<SumpId, LevelThresholds>;
  capOverride?: Partial<Record<SumpId, number>>;
  /** absolute rain function in simulation time (t = state.t + elapsed) */
  rain: RainFn;
}

export function simulate(ctx: Ctx, start: SimState, o: SimulateOpts): SimResult {
  const s = cloneState(start);
  const t0 = s.t;
  const per = {} as Record<SumpId, SumpPrediction>;
  for (const id of SUMP_IDS) {
    const cap = ctx.config.sumps[id].existingCapacity;
    const V = s.volumes[id];
    const L = o.levels[id];
    const tol = Math.max(1, cap * 1e-6);
    per[id] = {
      id, cap, startV: V, volAt: {}, overflowVol: 0, totalIn: 0, totalPumped: 0, peakQin: 0, peakV: V, peakT: 0, finalV: V,
      timeToEmpty: V <= tol ? 0 : null,
      timeToWarn: V >= (L.warnPct / 100) * cap ? 0 : null,
      timeToCritical: V >= (L.criticalPct / 100) * cap ? 0 : null,
      timeToEmergency: V >= (L.emergencyPct / 100) * cap ? 0 : null,
      timeToOverflow: null,
    };
  }
  const series: SimPoint[] = [];
  const sampleH = o.sampleH ?? 0.25;
  let nextSample = 0;
  const push = (elapsed: number, flows?: ReturnType<typeof advance>) => {
    series.push({
      t: elapsed, rain: flows ? flows.intensity : o.rain(s.t),
      V: { ...s.volumes },
      qIn: flows ? { ...flows.qIn } : ({} as Record<SumpId, number>),
      pumped: flows ? { ...flows.pumped } : ({} as Record<SumpId, number>),
    });
  };
  push(0);
  nextSample = sampleH;
  const steps = Math.ceil(o.horizonH / o.dtH - 1e-9);
  const horizonSet = new Set<number>(HORIZONS as readonly number[]);
  for (let i = 0; i < steps; i++) {
    const flows = advance(ctx, s, o.dtH, o.rain, o.capOverride);
    const elapsed = s.t - t0;
    for (const id of SUMP_IDS) {
      const p = per[id];
      const V = s.volumes[id];
      const L = o.levels[id];
      p.totalIn += flows.qIn[id] * o.dtH;
      p.totalPumped += flows.pumped[id] * o.dtH;
      p.peakQin = Math.max(p.peakQin, flows.qIn[id]);
      if (V > p.peakV) { p.peakV = V; p.peakT = elapsed; }
      if (flows.overflow[id] > 0) {
        p.overflowVol += flows.overflow[id];
        if (p.timeToOverflow == null) p.timeToOverflow = elapsed; // resolution = one calculation step
      }
      if (p.timeToEmpty == null && V <= Math.max(1, p.cap * 1e-6)) p.timeToEmpty = elapsed;
      if (p.timeToWarn == null && V >= (L.warnPct / 100) * p.cap) p.timeToWarn = elapsed;
      if (p.timeToCritical == null && V >= (L.criticalPct / 100) * p.cap) p.timeToCritical = elapsed;
      if (p.timeToEmergency == null && V >= (L.emergencyPct / 100) * p.cap) p.timeToEmergency = elapsed;
      p.finalV = V;
    }
    for (const h of horizonSet) if (Math.abs(elapsed - h) < o.dtH / 2) for (const id of SUMP_IDS) per[id].volAt[h] = s.volumes[id];
    if (elapsed >= nextSample - 1e-9) { push(elapsed, flows); nextSample += sampleH; }
  }
  for (const id of SUMP_IDS) for (const h of HORIZONS) if (per[id].volAt[h] == null) per[id].volAt[h] = NaN;
  return { horizonH: o.horizonH, perSump: per, series };
}

export interface ConstantEstimate { tEmpty: number | null; reason: string | null; state: 'emptying' | 'balanced' | 'filling' | 'empty' }

/** Analytic constant-conditions emptying time + plain-language explanation. */
export function constantEstimate(ctx: Ctx, id: SumpId, V: number, r: SumpRates): ConstantEstimate {
  const qNet = r.capActiveEff - r.qIn;
  const eps = 1e-6;
  if (V <= Math.max(1, ctx.config.sumps[id].existingCapacity * 1e-6)) {
    return { tEmpty: 0, reason: qNet < -eps ? 'Sump is empty now but inflow exceeds pumping — it will start filling.' : null, state: qNet < -eps ? 'filling' : 'empty' };
  }
  if (qNet > eps) return { tEmpty: V / qNet, reason: null, state: 'emptying' };
  return { tEmpty: null, reason: explainNoEmpty(ctx, id, r), state: Math.abs(qNet) <= eps ? 'balanced' : 'filling' };
}

export function explainNoEmpty(ctx: Ctx, id: SumpId, r: SumpRates): string {
  const pumps = ctx.pumps.pumps.filter((p) => p.sumpId === id);
  const avail = pumps.filter((p) => isServiceable(p) && p.status !== 'ON').length;
  const failed = pumps.filter((p) => p.status === 'FAILED').length;
  const maint = pumps.filter((p) => p.status === 'MAINTENANCE').length;
  const parts: string[] = [];
  if (!r.powerOn) parts.push('Power is unavailable at the pump station — no pump can run.');
  else if (pumps.length === 0) parts.push('No pumps are assigned to this sump.');
  else if (r.runningPumpIds.length === 0) parts.push('No pump is currently running' + (pumps.some((p) => p.status === 'ON') ? ' (ON pumps have reached their daily operating-hour limit).' : '.'));
  const deficit = r.qIn - r.capActiveEff;
  if (Math.abs(deficit) <= 1e-6) parts.push(`Inflow (${fmt(r.qIn)} m³/hr) exactly equals effective pumping (${fmt(r.capActiveEff)} m³/hr): the level holds steady, it does not fall.`);
  else parts.push(`Inflow ${fmt(r.qIn)} m³/hr ≥ effective pumping ${fmt(r.capActiveEff)} m³/hr — deficit ${fmt(deficit)} m³/hr (≈ ${pumpsNeeded(deficit, ctx.config)} more reference pumps).`);
  if (avail) parts.push(`${avail} serviceable pump(s) are OFF/STANDBY and could be started.`);
  if (failed || maint) parts.push(`${failed} failed and ${maint} under maintenance.`);
  return parts.join(' ');
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');

export interface LivePrediction {
  intensity: number;
  rates: Record<SumpId, SumpRates>;
  constant: SimResult; // current rainfall continuing
  forecast: SimResult; // configured forecast
  expected: SimResult; // the live rainfall source exactly as configured (manual/timeline + events)
  analytic: Record<SumpId, ConstantEstimate>;
}

export function predictLive(ctx: Ctx, s: SimState, th: Thresholds): LivePrediction {
  const intensity = rainfallAt(ctx.rainfall, s.t);
  const rates = allRates(ctx, s, intensity);
  const levels = Object.fromEntries(SUMP_IDS.map((id) => [id, levelsFor(th, id)])) as Record<SumpId, LevelThresholds>;
  const dtH = ctx.config.sim.predictionDtMinutes / 60;
  const horizonH = ctx.config.sim.predictionHorizonH;
  const constant = simulate(ctx, s, { horizonH, dtH, levels, rain: constantRainFn(intensity), sampleH: 0.5 });
  const forecast = simulate(ctx, s, { horizonH, dtH, levels, rain: forecastRainFn(ctx.rainfall), sampleH: 0.5 });
  const expected = ctx.rainfall.mode === 'timeline' ? forecast : simulate(ctx, s, { horizonH, dtH, levels, rain: liveRainFn(ctx.rainfall), sampleH: 0.5 });
  const analytic = Object.fromEntries(SUMP_IDS.map((id) => [id, constantEstimate(ctx, id, s.volumes[id], rates[id])])) as Record<SumpId, ConstantEstimate>;
  return { intensity, rates, constant, forecast, expected, analytic };
}
