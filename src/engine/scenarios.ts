/**
 * SCENARIO SIMULATOR — applies a scenario to a COPY of the current (or initial) state and
 * runs the same water-balance engine forward. Never mutates live state.
 */
import type { Ctx, SimState, SumpId, Thresholds, RainFn, LevelThresholds } from './types';
import { SUMP_IDS } from './types';
import { simulate, levelsFor, type SimResult } from './prediction';
import { cloneState, initialSimState, sumpRates } from './balance';
import { rainfallAt, forecastAt } from './rainfall';
import { effectiveCapacity, isServiceable, referenceEffective } from './pumps';
import { makePump } from './defaults';

export type ScenarioRain =
  | { kind: 'current' } // current intensity continuing
  | { kind: 'forecast' }
  | { kind: 'constant'; intensity: number }
  | { kind: 'step'; before: number; after: number; atH: number };

export interface ScenarioSpec {
  id: string;
  name: string;
  description: string;
  durationH: number;
  start: 'current' | 'initial';
  rain: ScenarioRain;
  failPumps: 'none' | 'largest-one-per-sump' | 'two-per-sump' | 'all';
  powerFailure: boolean;
  efficiencyPct: number | null; // replaces efficiency for all efficiency-rated pumps
  seepagePct: number | null; // allowance mode
  groundwaterMultiplier: number | null; // measured mode
  additionalPumps: number; // reference pumps added (ON) per sump
  startStandby: boolean; // start every serviceable OFF/STANDBY pump
  initialFillPct: number | null;
}

export const blankScenario = (over: Partial<ScenarioSpec> = {}): ScenarioSpec => ({
  id: 'custom', name: 'Custom', description: '', durationH: 24, start: 'current', rain: { kind: 'current' },
  failPumps: 'none', powerFailure: false, efficiencyPct: null, seepagePct: null, groundwaterMultiplier: null,
  additionalPumps: 0, startStandby: false, initialFillPct: null, ...over,
});

export const PRESET_SCENARIOS: ScenarioSpec[] = [
  blankScenario({ id: 'normal', name: 'Normal rainfall', description: 'Steady 5 mm/hr monsoon rain for 24 h.', rain: { kind: 'constant', intensity: 5 } }),
  blankScenario({ id: 'heavy', name: 'Heavy rainfall', description: 'Steady 20 mm/hr for 24 h.', rain: { kind: 'constant', intensity: 20 } }),
  blankScenario({ id: 'extreme', name: 'Extreme rainfall', description: 'Design-day depth (250 mm) concentrated: 50 mm/hr for 5 h, then dry.', rain: { kind: 'step', before: 50, after: 0, atH: 5 } }),
  blankScenario({ id: 'sudden-up', name: 'Sudden rainfall increase', description: '5 mm/hr jumping to 40 mm/hr after 2 h.', rain: { kind: 'step', before: 5, after: 40, atH: 2 } }),
  blankScenario({ id: 'sudden-down', name: 'Sudden rainfall decrease', description: '40 mm/hr dropping to 2 mm/hr after 3 h.', rain: { kind: 'step', before: 40, after: 2, atH: 3 } }),
  blankScenario({ id: 'one-fail', name: 'One pump failure', description: 'Largest pump at every sump fails; forecast rainfall.', rain: { kind: 'forecast' }, failPumps: 'largest-one-per-sump' }),
  blankScenario({ id: 'multi-fail', name: 'Multiple pump failures', description: 'Two pumps fail at every sump; forecast rainfall.', rain: { kind: 'forecast' }, failPumps: 'two-per-sump' }),
  blankScenario({ id: 'power', name: 'Total power failure', description: 'No power at any pump station; forecast rainfall.', rain: { kind: 'forecast' }, powerFailure: true }),
  blankScenario({ id: 'eff', name: 'Reduced pump efficiency', description: 'Efficiency falls to 60 % (efficiency-rated pumps).', rain: { kind: 'forecast' }, efficiencyPct: 60 }),
  blankScenario({ id: 'seep', name: 'Increased groundwater seepage', description: 'Seepage allowance 25 % (allowance mode) / measured groundwater ×2.5.', rain: { kind: 'forecast' }, seepagePct: 25, groundwaterMultiplier: 2.5 }),
  blankScenario({ id: 'add', name: 'Additional pumps deployed', description: '+3 reference pumps ON at every sump, all standby pumps started.', rain: { kind: 'forecast' }, additionalPumps: 3, startStandby: true }),
  blankScenario({ id: 'full', name: 'Sump approaching maximum storage', description: 'All sumps start at 90 % of usable storage with forecast rainfall.', rain: { kind: 'forecast' }, initialFillPct: 90, start: 'initial' }),
];

export interface ScenarioSumpResult {
  id: SumpId;
  totalInflow: number;
  peakInflow: number;
  avgInflow: number;
  pumpCapEff: number;
  netRemovalStart: number;
  finalV: number;
  peakUtil: number;
  finalUtil: number;
  timeToEmpty: number | null;
  timeToCritical: number | null;
  timeToOverflow: number | null;
  overflowVol: number;
  extraEffToPreventOverflow: number; // m³/hr effective
  extraPumpsToPreventOverflow: number;
  extraEffToBalancePeak: number;
}

export interface ScenarioResult { spec: ScenarioSpec; sim: SimResult; perSump: Record<SumpId, ScenarioSumpResult>; computedAt: string }

export function buildScenario(ctx: Ctx, live: SimState, sp: ScenarioSpec): { ctx: Ctx; state: SimState; rain: RainFn } {
  const config = structuredClone(ctx.config);
  const pumps = structuredClone(ctx.pumps);
  const rainfall = structuredClone(ctx.rainfall);
  if (sp.seepagePct != null) config.design.seepagePct = sp.seepagePct;
  if (sp.groundwaterMultiplier != null) for (const id of SUMP_IDS) config.groundwater.measuredM3h[id] *= sp.groundwaterMultiplier;
  if (sp.efficiencyPct != null) { config.design.pumpEfficiencyPct = sp.efficiencyPct; for (const p of pumps.pumps) p.efficiencyPct = null; }
  if (sp.startStandby) for (const p of pumps.pumps) if (p.status === 'OFF' || p.status === 'STANDBY') p.status = 'ON';
  const tmpCtx: Ctx = { config, pumps, rainfall };
  for (const id of SUMP_IDS) {
    const mine = pumps.pumps.filter((p) => p.sumpId === id && isServiceable(p))
      .sort((a, b) => effectiveCapacity(b, config).value - effectiveCapacity(a, config).value);
    const nFail = sp.failPumps === 'largest-one-per-sump' ? 1 : sp.failPumps === 'two-per-sump' ? 2 : sp.failPumps === 'all' ? mine.length : 0;
    mine.slice(0, nFail).forEach((p) => (p.status = 'FAILED'));
    for (let k = 0; k < sp.additionalPumps; k++) {
      pumps.pumps.push(makePump({ tag: `${id}+${k + 1}`, sumpId: id, ratedM3h: config.referencePumpRating, origin: 'user', ratingBasis: 'user', notes: 'Scenario pump' }));
    }
    if (sp.powerFailure) pumps.power[id] = false;
  }
  let state = sp.start === 'initial' ? initialSimState(tmpCtx, live.startISO) : cloneState(live);
  if (sp.start === 'initial') state.t = live.t;
  if (sp.initialFillPct != null) for (const id of SUMP_IDS) state.volumes[id] = (sp.initialFillPct / 100) * config.sumps[id].existingCapacity;
  const t0 = state.t;
  const nowI = rainfallAt(ctx.rainfall, live.t);
  const rr = sp.rain;
  const rain: RainFn = rr.kind === 'current' ? () => nowI
    : rr.kind === 'forecast' ? (t) => forecastAt(rainfall, t)
    : rr.kind === 'constant' ? () => rr.intensity
    : (t) => (t - t0 < rr.atH ? rr.before : rr.after);
  return { ctx: tmpCtx, state, rain };
}

export function runScenario(ctx: Ctx, live: SimState, th: Thresholds, sp: ScenarioSpec): ScenarioResult {
  const { ctx: c2, state, rain } = buildScenario(ctx, live, sp);
  const levels = Object.fromEntries(SUMP_IDS.map((id) => [id, levelsFor(th, id)])) as Record<SumpId, LevelThresholds>;
  const dtH = ctx.config.sim.predictionDtMinutes / 60;
  const sim = simulate(c2, state, { horizonH: sp.durationH, dtH, levels, rain, sampleH: 0.25 });
  const perSump = {} as Record<SumpId, ScenarioSumpResult>;
  for (const id of SUMP_IDS) {
    const p = sim.perSump[id];
    const r0 = sumpRates(c2, state, id, rain(state.t));
    const cap = c2.config.sumps[id].existingCapacity;
    // Extra effective capacity needed to avoid any overflow over the duration (bisection on the same engine)
    let extra = 0;
    if (p.overflowVol > 0) {
      let lo = 0, hi = Math.max(1000, p.peakQin);
      const overflowWith = (x: number) => simulate(c2, state, { horizonH: sp.durationH, dtH: Math.max(dtH, 0.25), levels, rain, capOverride: { [id]: x }, sampleH: 1e9 }).perSump[id].overflowVol;
      let guard = 0;
      while (overflowWith(hi) > 0 && guard++ < 20) hi *= 2;
      for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (overflowWith(mid) > 0) lo = mid; else hi = mid; }
      extra = hi;
    }
    perSump[id] = {
      id, totalInflow: p.totalIn, peakInflow: p.peakQin, avgInflow: p.totalIn / sp.durationH,
      pumpCapEff: r0.capActiveEff, netRemovalStart: r0.capActiveEff - r0.qIn,
      finalV: p.finalV, peakUtil: cap > 0 ? (p.peakV / cap) * 100 : 0, finalUtil: cap > 0 ? (p.finalV / cap) * 100 : 0,
      timeToEmpty: p.timeToEmpty, timeToCritical: p.timeToCritical, timeToOverflow: p.timeToOverflow, overflowVol: p.overflowVol,
      extraEffToPreventOverflow: extra,
      extraPumpsToPreventOverflow: extra > 0 ? Math.ceil(extra / referenceEffective(c2.config) - 1e-9) : 0,
      extraEffToBalancePeak: Math.max(0, p.peakQin - r0.capActiveEff),
    };
  }
  return { spec: sp, sim, perSump, computedAt: new Date().toISOString() };
}
