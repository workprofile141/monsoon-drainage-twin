import { runSelfTests } from '../src/engine/selfTests';
import { ORIGINAL_SUMPS, ORIGINAL_DESIGN } from '../src/engine/original';
import { defaultEngineeringConfig, defaultPumpConfig, defaultRainfall } from '../src/engine/defaults';
import { designValidation, sourceConsistencyNotes } from '../src/engine/validation';
import { analyseCombinations } from '../src/engine/combos';
import { runScenario, PRESET_SCENARIOS } from '../src/engine/scenarios';
import { initialSimState } from '../src/engine/balance';
import { defaultThresholds } from '../src/engine/defaults';
import { curveFlowAtHead } from '../src/engine/pumps';
import { timelineAt } from '../src/engine/rainfall';

describe('Mandatory engineering validation (TESTS 1–14)', () => {
  const results = runSelfTests();
  for (const r of results) {
    it(`TEST ${r.id}: ${r.title}`, () => {
      if (!r.pass) console.log(r.details.join('\n'));
      expect(r.pass).toBe(true);
    });
  }
});

describe('Original data integrity', () => {
  it('is frozen and cannot be overwritten', () => {
    expect(Object.isFrozen(ORIGINAL_SUMPS[0])).toBe(true);
    expect(() => { (ORIGINAL_SUMPS[0] as any).A1_excavation = 1; }).toThrow();
    expect(ORIGINAL_SUMPS[0].A1_excavation).toBe(1166620);
    expect(ORIGINAL_DESIGN.maxRainfallM).toBe(0.25);
  });
  it('config is a copy (editing config does not change original)', () => {
    const c = defaultEngineeringConfig();
    c.sumps.A.A1 = 5;
    expect(ORIGINAL_SUMPS[0].A1_excavation).toBe(1166620);
  });
  it('validation rows all within rounding', () => {
    const rows = designValidation(defaultEngineeringConfig());
    expect(rows.every((r) => r.status !== 'differs')).toBe(true);
  });
  it('flags source inconsistencies without altering them', () => {
    const notes = sourceConsistencyNotes();
    expect(notes.some((n) => n.sumpId === 'A' && n.severity === 'inconsistent')).toBe(true);
  });
});

describe('Engines', () => {
  const ctx = { config: defaultEngineeringConfig(), pumps: defaultPumpConfig(), rainfall: defaultRainfall() };
  it('default pumps follow the assessment', () => {
    const count = (id: string) => ctx.pumps.pumps.filter((p) => p.sumpId === id).length;
    expect([count('A'), count('B'), count('C'), count('D')]).toEqual([4, 4, 5, 5]);
    const d = ctx.pumps.pumps.filter((p) => p.sumpId === 'D' && p.origin === 'proposed');
    expect(d.every((p) => p.ratedM3h === 405 && p.ratingBasis === 'aggregate-split')).toBe(true);
  });
  it('timeline is piecewise constant', () => {
    expect(timelineAt(ctx.rainfall, 0)).toBe(5);
    expect(timelineAt(ctx.rainfall, 8.5)).toBe(60);
    expect(timelineAt(ctx.rainfall, 30)).toBe(0);
  });
  it('curve interpolation', () => {
    expect(curveFlowAtHead([{ headM: 40, flowM3h: 1000 }, { headM: 80, flowM3h: 600 }], 60)).toBe(800);
    expect(curveFlowAtHead([{ headM: 40, flowM3h: 1000 }, { headM: 80, flowM3h: 600 }], 90)).toBe(0);
  });
  it('combination analysis finds minimal sets', () => {
    const a = analyseCombinations(ctx, 'B', 1500, 2000);
    expect(a.minimalCurrent!.pumpIds.length).toBe(3); // 648 each → 3 × 648 = 1944 ≥ 1500
    expect(a.minimalPeak!.pumpIds.length).toBe(4);
  });
  it('scenarios run and report extra pumping', () => {
    const s = initialSimState(ctx);
    for (const sp of PRESET_SCENARIOS) {
      const r = runScenario(ctx, s, defaultThresholds(), sp);
      for (const id of ['A', 'B', 'C', 'D'] as const) {
        const p = r.perSump[id];
        expect(Number.isFinite(p.totalInflow)).toBe(true);
        if (p.overflowVol > 0) expect(p.extraEffToPreventOverflow).toBeGreaterThan(0);
      }
    }
  });
});
