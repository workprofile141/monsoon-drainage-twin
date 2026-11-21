/**
 * DESIGN-DAY VALIDATION — compares engine calculations with the source document.
 * Calculated values are never forced to match; discrepancies are reported as-is.
 */
import type { EngineeringConfig, SumpId } from './types';
import { ORIGINAL_SUMPS } from './original';
import { designDay } from './runoff';

export interface ValidationRow {
  sumpId: SumpId;
  parameter: string;
  unit: string;
  calculated: number;
  reference: number;
  diff: number;
  diffPct: number;
  status: 'match' | 'rounding' | 'differs';
}

export function designValidation(cfg: EngineeringConfig): ValidationRow[] {
  const rows: ValidationRow[] = [];
  for (const o of ORIGINAL_SUMPS) {
    const d = designDay(cfg, o.id);
    const add = (parameter: string, unit: string, calculated: number, reference: number) => {
      const diff = calculated - reference;
      const diffPct = reference !== 0 ? (diff / reference) * 100 : calculated === 0 ? 0 : 100;
      const status = Math.abs(diff) < 1e-6 ? 'match' : Math.abs(diff) <= 1.0 || Math.abs(diffPct) <= 0.01 ? 'rounding' : 'differs';
      rows.push({ sumpId: o.id, parameter, unit, calculated, reference, diff, diffPct, status });
    };
    add('Water through excavation (Q1)', 'm³/day', d.Q1, o.Q1_excavation);
    add('Water beyond excavation (Q2)', 'm³/day', d.Q2, o.Q2_beyondExcavation);
    add('Water through backfilled area (Q3)', 'm³/day', d.Q3, o.Q3_backfilled);
    add('Maximum water per day (Q1+Q2+Q3)', 'm³/day', d.Qrunoff, o.Qmax_perDay);
    add('Total accumulation incl. seepage', 'm³/day', d.Qtotal, o.Qtotal_withSeepage);
    add('Required sump capacity (×SF)', 'm³', d.requiredCapacity, o.requiredSumpCapacity);
    add('Balance sump capacity required', 'm³', d.additionalCapacity, o.balanceSumpCapacity);
    add('Required pumping capacity (Qtotal ÷ hours)', 'm³/hr', d.requiredPumpingEff, o.requiredPumpingCapacity);
  }
  return rows;
}

export interface SourceNote { sumpId: SumpId; severity: 'info' | 'inconsistent'; text: string }

/** Internal-consistency observations on the source pumping table (data preserved, not altered). */
export function sourceConsistencyNotes(): SourceNote[] {
  const notes: SourceNote[] = [];
  for (const o of ORIGINAL_SUMPS) {
    const gap = Math.max(0, o.requiredPumpingCapacity - o.existingPumpingCapacity);
    if (Math.abs(gap - o.balancePumpingCapacity) > 1) {
      notes.push({ sumpId: o.id, severity: 'inconsistent', text: `${o.name}: stated balance pumping capacity ${o.balancePumpingCapacity} m³/hr ≠ required − existing = ${o.requiredPumpingCapacity} − ${o.existingPumpingCapacity} = ${gap} m³/hr. Preserved as stated; the engine computes requirements from inputs instead.` });
    }
    if (o.existingPumpingCapacity + o.balancePumpingCapacity !== o.totalProposedPumpingCapacity) {
      notes.push({ sumpId: o.id, severity: 'inconsistent', text: `${o.name}: existing + balance (${o.existingPumpingCapacity + o.balancePumpingCapacity}) ≠ total proposed ${o.totalProposedPumpingCapacity} m³/hr.` });
    }
    if (o.totalProposedPumpingCapacity < o.requiredPumpingCapacity) {
      notes.push({ sumpId: o.id, severity: 'inconsistent', text: `${o.name}: total proposed rated capacity ${o.totalProposedPumpingCapacity} m³/hr is below the stated requirement ${o.requiredPumpingCapacity} m³/hr (shortfall ${o.requiredPumpingCapacity - o.totalProposedPumpingCapacity} m³/hr, before applying 80 % efficiency).` });
    }
    if (o.id === 'D') notes.push({ sumpId: o.id, severity: 'info', text: 'Departmental D: 810 m³/hr balance across 2 proposed pumps is an aggregate; the two pumps are configured independently (placeholder 405 m³/hr each).' });
  }
  return notes;
}
