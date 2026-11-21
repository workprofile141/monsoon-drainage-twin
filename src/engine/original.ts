/**
 * ORIGINAL ENGINEERING ASSESSMENT DATA — "Pumping & Sump Capacity Assessment".
 *
 * These values are transcribed verbatim from the source document and are deep-frozen.
 * They are NEVER modified by the application. All simulation/configuration values live
 * in separate records (see store/) and are only *initialised* from this data.
 */
import type { SumpId } from './types';

export interface OriginalSumpRecord {
  id: SumpId;
  name: string;
  // A. Catchment area (m²)
  A1_excavation: number;
  A3_beyondExcavation: number;
  A2_internalDump: number;
  // C. Water accumulation (m³/day)
  Q1_excavation: number;
  Q2_beyondExcavation: number;
  Q3_backfilled: number;
  Qmax_perDay: number;
  Qtotal_withSeepage: number;
  // D. Sump capacity (m³)
  requiredSumpCapacity: number;
  existingSumpCapacity: number;
  balanceSumpCapacity: number;
  // E. Pumping arrangement
  requiredPumpingCapacity: number; // m³/hr
  existingPumpingCapacity: number; // m³/hr
  existingPumps: number;
  balancePumpingCapacity: number; // m³/hr
  additionalPumps: number;
  totalProposedPumpingCapacity: number; // m³/hr
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

export const ORIGINAL_SUMPS: readonly OriginalSumpRecord[] = deepFreeze([
  {
    id: 'A', name: 'Nilkanth A Sump',
    A1_excavation: 1166620, A3_beyondExcavation: 58331, A2_internalDump: 1295280,
    Q1_excavation: 262490, Q2_beyondExcavation: 2187, Q3_backfilled: 161910,
    Qmax_perDay: 426587, Qtotal_withSeepage: 469246,
    requiredSumpCapacity: 703868, existingSumpCapacity: 583926, balanceSumpCapacity: 119942,
    requiredPumpingCapacity: 4692, existingPumpingCapacity: 0, existingPumps: 0,
    balancePumpingCapacity: 3240, additionalPumps: 4, totalProposedPumpingCapacity: 3240,
  },
  {
    id: 'B', name: 'Nilkanth B Sump',
    A1_excavation: 1145253, A3_beyondExcavation: 57263, A2_internalDump: 1429000,
    Q1_excavation: 257682, Q2_beyondExcavation: 2147, Q3_backfilled: 178625,
    Qmax_perDay: 438454, Qtotal_withSeepage: 482300,
    requiredSumpCapacity: 723450, existingSumpCapacity: 723156, balanceSumpCapacity: 294,
    requiredPumpingCapacity: 4823, existingPumpingCapacity: 3240, existingPumps: 4,
    balancePumpingCapacity: 0, additionalPumps: 0, totalProposedPumpingCapacity: 3240,
  },
  {
    id: 'C', name: 'KNR C Sump',
    A1_excavation: 1310600, A3_beyondExcavation: 65530, A2_internalDump: 952395,
    Q1_excavation: 294885, Q2_beyondExcavation: 2457, Q3_backfilled: 119049,
    Qmax_perDay: 416392, Qtotal_withSeepage: 458031,
    requiredSumpCapacity: 687046, existingSumpCapacity: 595024, balanceSumpCapacity: 92022,
    requiredPumpingCapacity: 4580, existingPumpingCapacity: 0, existingPumps: 0,
    balancePumpingCapacity: 4050, additionalPumps: 5, totalProposedPumpingCapacity: 4050,
  },
  {
    id: 'D', name: 'Departmental D Sump',
    A1_excavation: 625140, A3_beyondExcavation: 31257, A2_internalDump: 587777,
    Q1_excavation: 140657, Q2_beyondExcavation: 1172, Q3_backfilled: 73472,
    Qmax_perDay: 215301, Qtotal_withSeepage: 236831,
    requiredSumpCapacity: 355246, existingSumpCapacity: 187003, balanceSumpCapacity: 168243,
    requiredPumpingCapacity: 2368, existingPumpingCapacity: 2430, existingPumps: 3,
    balancePumpingCapacity: 810, additionalPumps: 2, totalProposedPumpingCapacity: 3240,
  },
] as OriginalSumpRecord[]);

/** B. Runoff coefficients (source document). */
export const ORIGINAL_COEFFICIENTS = deepFreeze({
  n1_excavation: 0.9,
  n2_externalDump: 0.15, // retained; no external dump area is given for any sump
  n3_backfilled: 0.5,
  n4_beyondExcavation: 0.15,
});

/** F. Design assumptions (source document). */
export const ORIGINAL_DESIGN = deepFreeze({
  maxRainfallM: 0.25,
  seepagePct: 10,
  sumpSafetyFactor: 1.5,
  assessmentDays: 5,
  assessmentHours: 100,
  scheduledHoursPerDay: 20,
  pumpEfficiencyPct: 80,
});

/**
 * Pump ratings INFERRED from the source tables (not stated explicitly in the document).
 * - Existing pumps: 3240/4 (B) and 2430/3 (D) = 810 m³/hr each.
 * - Proposed A: 3240/4 = 810; proposed C: 4050/5 = 810.
 * - Proposed D: 810 m³/hr balance across two pumps is an AGGREGATE requirement only.
 */
export const INFERRED_PUMP_RATING = 810;

export const SOURCE_DOCUMENT = 'Pumping & Sump Capacity Assessment';
