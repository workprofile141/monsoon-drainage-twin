/**
 * RUNOFF ENGINE + GROUNDWATER INFLOW ENGINE + DESIGN-DAY REQUIREMENTS.
 *
 *  Q1 = A1 × R × n1   (excavation)
 *  Q2 = A3 × R × n4   (beyond excavation)
 *  Q3 = A2 × R × n3   (backfilled / internal dump)
 *  Qext = Aext × R × n2 (external dump — only when an area is configured; source gives none)
 *  Qrunoff = Q1 + Q2 + Q3 (+ Qext)
 *  allowance mode: Qtotal = Qrunoff × (1 + seepage%)
 *  measured  mode: Qtotal = Qrunoff + Qgroundwater   (allowance NOT applied — no double counting)
 *
 *  Hourly: Qrain [m³/hr] = [(A1·n1 + A3·n4 + A2·n3 + Aext·n2) / 1000] × I[mm/hr]
 */
import type { EngineeringConfig, SumpId } from './types';

/** Σ(A·n) in m² — the runoff-weighted catchment area. */
export function effectiveCatchment(cfg: EngineeringConfig, id: SumpId): number {
  const s = cfg.sumps[id];
  const c = cfg.coefficients;
  return s.A1 * c.n1 + s.A3 * c.n4 + s.A2 * c.n3 + (s.Aext > 0 ? s.Aext * c.n2 : 0);
}

/** Runoff rate (m³/hr) for a rainfall intensity in mm/hr. */
export function runoffRate(cfg: EngineeringConfig, id: SumpId, intensityMmH: number): number {
  return (effectiveCatchment(cfg, id) / 1000) * Math.max(0, intensityMmH);
}

/** Groundwater component (m³/hr) — exactly one of the two methods is used. */
export function groundwaterRate(cfg: EngineeringConfig, id: SumpId, qRunoff: number): number {
  if (cfg.groundwater.mode === 'measured') return Math.max(0, cfg.groundwater.measuredM3h[id] ?? 0);
  return qRunoff * (cfg.design.seepagePct / 100);
}

export function inflowRate(cfg: EngineeringConfig, id: SumpId, intensityMmH: number) {
  const qRunoff = runoffRate(cfg, id, intensityMmH);
  const qGroundwater = groundwaterRate(cfg, id, qRunoff);
  return { qRunoff, qGroundwater, qIn: qRunoff + qGroundwater };
}

export function assessmentHours(cfg: EngineeringConfig): number {
  return cfg.design.assessmentDays * cfg.design.hoursPerDay;
}

export interface DesignDayResult {
  id: SumpId;
  R: number;
  Q1: number; Q2: number; Q3: number; Qext: number;
  Qrunoff: number;
  Qgroundwater: number;
  Qtotal: number; // m³/day
  requiredCapacity: number; // Qtotal × safety factor
  existingCapacity: number;
  additionalCapacity: number; // required − existing (may be negative = surplus)
  requiredPumpingEff: number; // m³/hr effective = Qtotal / assessment hours
  requiredPumpingRated: number; // m³/hr rated at design efficiency (engineering note — not in source)
}

/** Design-day calculation (daily depth R in metres). Independent of the live simulation state. */
export function designDay(cfg: EngineeringConfig, id: SumpId, Rm = cfg.design.rainfallDepthM): DesignDayResult {
  const s = cfg.sumps[id];
  const c = cfg.coefficients;
  const Q1 = s.A1 * Rm * c.n1;
  const Q2 = s.A3 * Rm * c.n4;
  const Q3 = s.A2 * Rm * c.n3;
  const Qext = s.Aext > 0 ? s.Aext * Rm * c.n2 : 0;
  const Qrunoff = Q1 + Q2 + Q3 + Qext;
  const Qgroundwater = cfg.groundwater.mode === 'measured'
    ? Math.max(0, cfg.groundwater.measuredM3h[id]) * 24
    : Qrunoff * (cfg.design.seepagePct / 100);
  const Qtotal = Qrunoff + Qgroundwater;
  const requiredCapacity = Qtotal * cfg.design.safetyFactor;
  const hrs = assessmentHours(cfg);
  const requiredPumpingEff = hrs > 0 ? Qtotal / hrs : Infinity;
  const eff = cfg.design.pumpEfficiencyPct / 100;
  return {
    id, R: Rm, Q1, Q2, Q3, Qext, Qrunoff, Qgroundwater, Qtotal,
    requiredCapacity,
    existingCapacity: s.existingCapacity,
    additionalCapacity: requiredCapacity - s.existingCapacity,
    requiredPumpingEff,
    requiredPumpingRated: eff > 0 ? requiredPumpingEff / eff : Infinity,
  };
}
