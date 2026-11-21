/**
 * PUMP MANAGEMENT ENGINE.
 * Effective capacity of one pump:
 *   - with a pump curve (≥2 points): flow interpolated at the configured discharge head.
 *     The curve already represents actual delivered performance, so efficiency is NOT applied again.
 *   - without a curve: rated capacity × operating efficiency.
 */
import type { EngineeringConfig, Pump, PumpConfig, SumpId, PumpRunState, CurvePoint } from './types';

export function pumpEfficiencyPct(p: Pump, cfg: EngineeringConfig): number {
  return p.efficiencyPct ?? cfg.design.pumpEfficiencyPct;
}

export function curveFlowAtHead(curve: CurvePoint[], head: number): number | null {
  const pts = curve.filter((c) => Number.isFinite(c.headM) && Number.isFinite(c.flowM3h)).sort((a, b) => a.headM - b.headM);
  if (pts.length < 2) return null;
  if (head <= pts[0].headM) return Math.max(0, pts[0].flowM3h);
  const last = pts[pts.length - 1];
  if (head > last.headM) return 0; // beyond shut-off head of supplied curve
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (head <= b.headM) {
      const f = (head - a.headM) / (b.headM - a.headM || 1);
      return Math.max(0, a.flowM3h + f * (b.flowM3h - a.flowM3h));
    }
  }
  return Math.max(0, last.flowM3h);
}

export interface EffectiveCapacity { value: number; basis: 'curve' | 'efficiency'; efficiencyPct: number | null }

export function effectiveCapacity(p: Pump, cfg: EngineeringConfig): EffectiveCapacity {
  const c = curveFlowAtHead(p.curve, p.dischargeHeadM);
  if (c != null) return { value: c, basis: 'curve', efficiencyPct: null };
  const e = pumpEfficiencyPct(p, cfg);
  return { value: Math.max(0, p.ratedM3h) * (e / 100), basis: 'efficiency', efficiencyPct: e };
}

/** Physically available to run (not failed / under maintenance). */
export const isServiceable = (p: Pump) => p.status === 'ON' || p.status === 'OFF' || p.status === 'STANDBY';

/** Is the pump discharging at time t? */
export function isRunning(p: Pump, pc: PumpConfig, cfg: EngineeringConfig, run: PumpRunState | undefined, t: number): boolean {
  if (p.status !== 'ON') return false;
  if (!pc.power[p.sumpId]) return false;
  if (cfg.design.enforceOperatingHours) {
    const day = Math.floor(t / 24 + 1e-9);
    const today = run && run.dayIndex === day ? run.todayH : 0;
    if (today >= p.operatingHoursPerDay - 1e-9) return false;
  }
  return true;
}

export const pumpsOf = (pc: PumpConfig, id: SumpId) => pc.pumps.filter((p) => p.sumpId === id);

export function nextPumpTag(pc: PumpConfig, id: SumpId): string {
  let n = 1;
  const tags = new Set(pc.pumps.map((p) => p.tag));
  while (tags.has(`${id}${n}`)) n++;
  return `${id}${n}`;
}

/** Reference effective capacity used to express "additional pumps required". */
export function referenceEffective(cfg: EngineeringConfig): number {
  return cfg.referencePumpRating * (cfg.design.pumpEfficiencyPct / 100);
}

export function pumpsNeeded(deficitM3h: number, cfg: EngineeringConfig): number {
  const r = referenceEffective(cfg);
  if (deficitM3h <= 0) return 0;
  if (r <= 0) return Infinity;
  return Math.ceil(deficitM3h / r - 1e-9);
}
