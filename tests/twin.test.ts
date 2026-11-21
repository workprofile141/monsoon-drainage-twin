import { buildMineModel, defaultTwinConfig, numericSumpVolume } from '../src/engine/mine';
import { defaultEngineeringConfig, defaultPumpConfig, defaultRainfall } from '../src/engine/defaults';
import { levelAtVolume, volumeAt } from '../src/engine/geometry';
import { initialSimState, advance, cloneState } from '../src/engine/balance';
import { simulate } from '../src/engine/prediction';
import { defaultThresholds } from '../src/engine/defaults';
import { SUMP_IDS } from '../src/engine/types';

describe('3D sump twin geometry', () => {
  const cfg = defaultEngineeringConfig();
  for (const id of SUMP_IDS) {
    it(`sump ${id}: carved 3D depression holds the configured volume at each level`, () => {
      const m = buildMineModel(cfg, { ...defaultTwinConfig(), sumpId: id });
      for (const f of [0.25, 0.6, 1]) {
        const V = f * cfg.sumps[id].existingCapacity;
        const h = levelAtVolume(m.dims, V);
        const numeric = numericSumpVolume(m, m.sumpFloorE + h, 1);
        expect(Math.abs(numeric - V) / V).toBeLessThan(0.01); // 1 m grid integration
        expect(Math.abs(volumeAt(m.dims.L, m.dims.W, m.dims.s, h) - V) / V).toBeLessThan(1e-9);
      }
      // pit footprint is area-true to A1 (unless the sump + benches need more room)
      expect(m.pitL * m.pitW).toBeGreaterThanOrEqual(cfg.sumps[id].A1 * 0.999);
    });
  }
});

describe('Prediction playback = forward simulation (same engine)', () => {
  it('continuous ≤1-min sub-stepping matches simulate() within 0.5 %', () => {
    const ctx = { config: defaultEngineeringConfig(), pumps: defaultPumpConfig(), rainfall: defaultRainfall() };
    ctx.pumps.pumps.filter((p) => p.sumpId === 'B').slice(0, 2).forEach((p) => (p.status = 'FAILED'));
    const s0 = initialSimState(ctx); s0.volumes.B = 150000;
    const rain = () => 40;
    const s = cloneState(s0);
    let left = 6; while (left > 1e-9) { const step = Math.min(left, 0.0137); let l2 = step; while (l2 > 1e-12) { const d = Math.min(1 / 60, l2); advance(ctx, s, d, rain); l2 -= d; } left -= step; }
    const th = defaultThresholds();
    const lv = Object.fromEntries(SUMP_IDS.map((k) => [k, th.level])) as any;
    const sim = simulate(ctx, s0, { horizonH: 6, dtH: 1 / 60, levels: lv, rain });
    expect(Math.abs(s.volumes.B - sim.perSump.B.finalV) / sim.perSump.B.finalV).toBeLessThan(0.005);
  });
});
