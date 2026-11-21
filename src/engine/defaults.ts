/**
 * Builds the INITIAL configuration records from the frozen original assessment.
 * Every value here is either copied from the source (provenance 'original'),
 * inferred from it ('inferred'), or a clearly labelled conceptual default ('derived' / 'user').
 */
import { ORIGINAL_COEFFICIENTS, ORIGINAL_DESIGN, ORIGINAL_SUMPS, INFERRED_PUMP_RATING } from './original';
import type {
  EngineeringConfig, PumpConfig, Pump, RainfallInputs, Thresholds, SumpId, SumpConfig, Provenance,
} from './types';
import { SUMP_IDS } from './types';

const LAYOUT: Record<SumpId, { x: number; z: number }> = {
  A: { x: -30, z: -16 },
  B: { x: 30, z: -16 },
  C: { x: -30, z: 20 },
  D: { x: 30, z: 20 },
};

export function defaultEngineeringConfig(): EngineeringConfig {
  const c = ORIGINAL_COEFFICIENTS;
  const d = ORIGINAL_DESIGN;
  const sumps = {} as Record<SumpId, SumpConfig>;
  const measured = {} as Record<SumpId, number>;
  for (const o of ORIGINAL_SUMPS) {
    sumps[o.id] = {
      id: o.id,
      name: o.name,
      A1: o.A1_excavation,
      A2: o.A2_internalDump,
      A3: o.A3_beyondExcavation,
      Aext: 0,
      existingCapacity: o.existingSumpCapacity,
      initialVolume: 0,
      geometry: {
        mode: 'derived', usableDepthM: 12, freeboardM: 1, sideSlope: 1, aspect: 1.5,
        bottomLengthM: 0, bottomWidthM: 0,
      },
      layout: { ...LAYOUT[o.id] },
    };
    // Baseline groundwater = seepage allowance at the design day, spread over 24 h (derived, editable).
    const runoffDesign = (o.A1_excavation * c.n1_excavation + o.A3_beyondExcavation * c.n4_beyondExcavation +
      o.A2_internalDump * c.n3_backfilled) * d.maxRainfallM;
    measured[o.id] = Math.round((runoffDesign * d.seepagePct) / 100 / 24);
  }
  return {
    coefficients: { n1: c.n1_excavation, n2: c.n2_externalDump, n3: c.n3_backfilled, n4: c.n4_beyondExcavation },
    design: {
      rainfallDepthM: d.maxRainfallM,
      seepagePct: d.seepagePct,
      safetyFactor: d.sumpSafetyFactor,
      assessmentDays: d.assessmentDays,
      hoursPerDay: d.scheduledHoursPerDay,
      pumpEfficiencyPct: d.pumpEfficiencyPct,
      enforceOperatingHours: false,
    },
    groundwater: { mode: 'allowance', measuredM3h: { ...measured }, expectedM3h: { ...measured } },
    sumps,
    referencePumpRating: INFERRED_PUMP_RATING,
    sim: { dtMinutes: 5, predictionHorizonH: 168, predictionDtMinutes: 5 },
  };
}

let pumpSeq = 0;
export function newPumpId(): string {
  pumpSeq += 1;
  return `p_${Date.now().toString(36)}_${pumpSeq}_${Math.random().toString(36).slice(2, 6)}`;
}

export function makePump(p: Partial<Pump> & Pick<Pump, 'tag' | 'sumpId'>): Pump {
  return {
    id: p.id ?? newPumpId(),
    tag: p.tag,
    sumpId: p.sumpId,
    ratedM3h: p.ratedM3h ?? INFERRED_PUMP_RATING,
    efficiencyPct: p.efficiencyPct ?? null,
    dischargeHeadM: p.dischargeHeadM ?? 60,
    curve: p.curve ?? [],
    operatingHoursPerDay: p.operatingHoursPerDay ?? ORIGINAL_DESIGN.scheduledHoursPerDay,
    status: p.status ?? 'ON',
    origin: p.origin ?? 'user',
    ratingBasis: p.ratingBasis ?? 'user',
    notes: p.notes ?? '',
  };
}

/**
 * Initial pump arrangement: existing pumps + proposed additional pumps from the assessment.
 * includeProposed=false gives the "existing only" arrangement.
 */
export function defaultPumpConfig(includeProposed = true): PumpConfig {
  const pumps: Pump[] = [];
  for (const o of ORIGINAL_SUMPS) {
    let n = 0;
    for (let i = 0; i < o.existingPumps; i++) {
      n++;
      pumps.push(makePump({
        id: `${o.id}${n}`, tag: `${o.id}${n}`, sumpId: o.id, ratedM3h: INFERRED_PUMP_RATING, origin: 'existing',
        ratingBasis: 'inferred', notes: `Existing pump. Rating inferred: ${o.existingPumpingCapacity} m³/hr ÷ ${o.existingPumps} pumps.`,
      }));
    }
    if (!includeProposed) continue;
    for (let i = 0; i < o.additionalPumps; i++) {
      n++;
      const aggregate = o.id === 'D';
      const rated = aggregate ? o.balancePumpingCapacity / o.additionalPumps : INFERRED_PUMP_RATING;
      pumps.push(makePump({
        id: `${o.id}${n}`, tag: `${o.id}${n}`, sumpId: o.id, ratedM3h: rated, origin: 'proposed',
        ratingBasis: aggregate ? 'aggregate-split' : 'inferred',
        notes: aggregate
          ? `Proposed pump. Source gives only an AGGREGATE balance of ${o.balancePumpingCapacity} m³/hr for ${o.additionalPumps} pumps — split equally as a placeholder; confirm the actual rating.`
          : `Proposed pump. Rating inferred: ${o.totalProposedPumpingCapacity} m³/hr ÷ ${o.existingPumps + o.additionalPumps} pumps.`,
      }));
    }
  }
  return { pumps, power: { A: true, B: true, C: true, D: true } };
}

/** Demonstration timeline from the brief (editable). The 16:00 → 0 entry ends the demo storm. */
export function defaultRainfall(): RainfallInputs {
  return {
    mode: 'timeline',
    manualIntensity: 10,
    manualDurationH: null,
    manualStartH: 0,
    timeline: [
      { hour: 0, intensity: 5 },
      { hour: 2, intensity: 10 },
      { hour: 4, intensity: 25 },
      { hour: 6, intensity: 40 },
      { hour: 8, intensity: 60 },
      { hour: 10, intensity: 30 },
      { hour: 12, intensity: 15 },
      { hour: 14, intensity: 5 },
      { hour: 16, intensity: 0 },
    ],
    timelineAfter: 'zero',
    events: [],
  };
}

export function defaultThresholds(): Thresholds {
  return {
    rainfallWarnMmH: 20,
    rainfallCriticalMmH: 40,
    rainfallEmergencyMmH: 60,
    dailyRainLimitMm: ORIGINAL_DESIGN.maxRainfallM * 1000,
    level: { warnPct: 70, criticalPct: 85, emergencyPct: 95 },
    sumpOverrides: {},
    overflowLeadH: 6,
    groundwaterIncreasePct: 25,
  };
}

/** Provenance of configuration fields — used by the UI to label values. */
export function configProvenance(path: string): Provenance {
  if (path.startsWith('sumps.') && /\.(A1|A2|A3|existingCapacity|name)$/.test(path)) return 'original';
  if (path.startsWith('coefficients.')) return 'original';
  if (/^design\.(rainfallDepthM|seepagePct|safetyFactor|assessmentDays|hoursPerDay|pumpEfficiencyPct)$/.test(path)) return 'original';
  if (path === 'referencePumpRating') return 'inferred';
  return 'derived';
}

export const ALL_SUMPS = SUMP_IDS;
