/**
 * SUMP WATER BALANCE ENGINE.
 *   V_new = V_prev + (Q_in − Q_pump) × Δt        (Δt in hours)
 * Physical limits: pumps cannot remove more water than is available (V ≥ 0);
 * volume above usable capacity is recorded separately as OVERFLOW and the stored
 * volume is capped at usable capacity.
 *
 * The same advance() function drives the live simulation, the predictions and the
 * scenario simulator, so every number on screen comes from one source of truth.
 */
import type { Ctx, SimState, SumpId, SumpRates, RainFn } from './types';
import { SUMP_IDS } from './types';
import { inflowRate } from './runoff';
import { effectiveCapacity, isRunning, isServiceable } from './pumps';

export function initialSimState(ctx: Ctx, startISO = defaultStartISO()): SimState {
  const rec = (f: (id: SumpId) => number) => Object.fromEntries(SUMP_IDS.map((id) => [id, f(id)])) as Record<SumpId, number>;
  return {
    t: 0,
    startISO,
    volumes: rec((id) => Math.min(Math.max(0, ctx.config.sumps[id].initialVolume), ctx.config.sumps[id].existingCapacity)),
    cumInflow: rec(() => 0),
    cumPumped: rec(() => 0),
    cumOverflow: rec(() => 0),
    cumRainMm: 0,
    pumpRun: {},
  };
}

export function defaultStartISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function cloneState(s: SimState): SimState {
  const pumpRun: SimState['pumpRun'] = {};
  for (const [k, v] of Object.entries(s.pumpRun)) pumpRun[k] = { ...v };
  return {
    t: s.t, startISO: s.startISO, cumRainMm: s.cumRainMm,
    volumes: { ...s.volumes }, cumInflow: { ...s.cumInflow }, cumPumped: { ...s.cumPumped },
    cumOverflow: { ...s.cumOverflow }, pumpRun,
  };
}

/** Instantaneous rates for one sump at time t with rainfall intensity I (mm/hr). */
export function sumpRates(ctx: Ctx, s: SimState, id: SumpId, intensity: number, t = s.t): SumpRates {
  const { qRunoff, qGroundwater, qIn } = inflowRate(ctx.config, id, intensity);
  let capInstalledEff = 0, capActiveEff = 0, capActiveRated = 0;
  const runningPumpIds: string[] = [];
  for (const p of ctx.pumps.pumps) {
    if (p.sumpId !== id) continue;
    const eff = effectiveCapacity(p, ctx.config).value;
    if (isServiceable(p)) capInstalledEff += eff;
    if (isRunning(p, ctx.pumps, ctx.config, s.pumpRun[p.id], t)) {
      capActiveEff += eff;
      capActiveRated += p.ratedM3h;
      runningPumpIds.push(p.id);
    }
  }
  return {
    intensity, qRunoff, qGroundwater, qIn, capInstalledEff, capActiveEff, capActiveRated, runningPumpIds,
    qNet: capActiveEff - qIn, powerOn: !!ctx.pumps.power[id],
  };
}

export function allRates(ctx: Ctx, s: SimState, intensity: number): Record<SumpId, SumpRates> {
  return Object.fromEntries(SUMP_IDS.map((id) => [id, sumpRates(ctx, s, id, intensity)])) as Record<SumpId, SumpRates>;
}

export interface StepFlows { qIn: Record<SumpId, number>; pumped: Record<SumpId, number>; overflow: Record<SumpId, number>; intensity: number }

/**
 * Advance the state IN PLACE by dtH hours. Rainfall intensity is evaluated at the start
 * of the step (piecewise-constant within the step). Returns the flows of the step.
 */
export function advance(ctx: Ctx, s: SimState, dtH: number, rain: RainFn, capOverride?: Partial<Record<SumpId, number>>): StepFlows {
  const intensity = Math.max(0, rain(s.t));
  const out: StepFlows = { qIn: {} as Record<SumpId, number>, pumped: {} as Record<SumpId, number>, overflow: {} as Record<SumpId, number>, intensity };
  const day = Math.floor(s.t / 24 + 1e-9);
  for (const id of SUMP_IDS) {
    const r = sumpRates(ctx, s, id, intensity);
    const capEff = r.capActiveEff + (capOverride?.[id] ?? 0);
    const cap = ctx.config.sumps[id].existingCapacity;
    const V0 = s.volumes[id];
    const inVol = r.qIn * dtH;
    const pumpVol = Math.min(capEff * dtH, V0 + inVol); // cannot pump a dry sump
    let V = V0 + inVol - pumpVol;
    let ovf = 0;
    if (V > cap) { ovf = V - cap; V = cap; }
    s.volumes[id] = Math.max(0, V);
    s.cumInflow[id] += inVol;
    s.cumPumped[id] += pumpVol;
    s.cumOverflow[id] += ovf;
    out.qIn[id] = r.qIn;
    out.pumped[id] = pumpVol / dtH;
    out.overflow[id] = ovf;
    // per-pump run-hours and volume (volume shared pro-rata to effective capacity)
    if (r.runningPumpIds.length && r.capActiveEff > 0) {
      for (const pid of r.runningPumpIds) {
        const p = ctx.pumps.pumps.find((x) => x.id === pid)!;
        // capEff may include a virtual scenario capacity; real pumps get their pro-rata share only.
        const pumpedByThis = pumpVol * (effectiveCapacity(p, ctx.config).value / capEff);
        const rs = s.pumpRun[pid] ?? { dayIndex: day, todayH: 0, totalH: 0, pumpedM3: 0 };
        if (rs.dayIndex !== day) { rs.dayIndex = day; rs.todayH = 0; }
        rs.todayH += dtH; rs.totalH += dtH; rs.pumpedM3 += pumpedByThis;
        s.pumpRun[pid] = rs;
      }
    }
  }
  s.cumRainMm += intensity * dtH;
  s.t += dtH;
  return out;
}
