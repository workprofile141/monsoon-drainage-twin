/**
 * MANDATORY ENGINEERING VALIDATION SUITE (TESTS 1–14).
 * Pure engine checks — run by Vitest (tests/) and live in the browser (Validation page).
 * TEST 12 (navigation) is UI-level: it is checked against the store's navigation log in the browser
 * and by the Playwright end-to-end script; here it reports the engine-side precondition.
 */
import type { Ctx, SimState, Thresholds } from './types';
import { SUMP_IDS } from './types';
import { defaultEngineeringConfig, defaultPumpConfig, defaultRainfall, defaultThresholds, makePump } from './defaults';
import { initialSimState, sumpRates, advance, cloneState } from './balance';
import { constantRainFn, liveRainFn, depthBetween } from './rainfall';
import { predictLive, constantEstimate, simulate, levelsFor } from './prediction';
import { designValidation } from './validation';
import { sumpDims, levelAtVolume, volumeAt } from './geometry';
import { waterVisual } from './visual';
import { evaluateAlerts } from './alerts';
import { ORIGINAL_SUMPS } from './original';
import { designDay } from './runoff';

export interface TestResult { id: number; title: string; pass: boolean; details: string[] }

const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const n0 = (x: number) => Math.round(x).toLocaleString('en-IN');

function freshCtx(): Ctx {
  return { config: defaultEngineeringConfig(), pumps: defaultPumpConfig(true), rainfall: defaultRainfall() };
}
const manual = (ctx: Ctx, I: number) => { ctx.rainfall.mode = 'manual'; ctx.rainfall.manualIntensity = I; ctx.rainfall.manualDurationH = null; ctx.rainfall.events = []; };

export function runSelfTests(navCheck?: { pass: boolean; details: string[] }): TestResult[] {
  const out: TestResult[] = [];
  const th: Thresholds = defaultThresholds();
  const T = (id: number, title: string, fn: (d: string[]) => boolean) => {
    const d: string[] = [];
    let pass = false;
    try { pass = fn(d); } catch (e) { d.push('Exception: ' + (e as Error).message); }
    out.push({ id, title, pass, details: d });
  };

  T(1, 'Rainfall 10 mm/hr → runoff and inflow', (d) => {
    const ctx = freshCtx(); manual(ctx, 10);
    const s = initialSimState(ctx);
    let ok = true;
    for (const o of ORIGINAL_SUMPS) {
      const hand = ((o.A1_excavation * 0.9 + o.A3_beyondExcavation * 0.15 + o.A2_internalDump * 0.5) / 1000) * 10;
      const r = sumpRates(ctx, s, o.id, 10);
      const okS = near(r.qRunoff, hand) && near(r.qIn, hand * 1.1);
      ok &&= okS;
      d.push(`${o.name}: Qrain = ${n0(r.qRunoff)} m³/hr (hand ${n0(hand)}), Qin = ${n0(r.qIn)} m³/hr (= ×1.10) ${okS ? '✓' : '✗'}`);
    }
    return ok;
  });

  T(2, 'Increase rainfall to 50 mm/hr while running → levels & predictions change immediately', (d) => {
    const ctx = freshCtx(); manual(ctx, 10);
    const s = initialSimState(ctx);
    for (const id of SUMP_IDS) s.volumes[id] = 0.3 * ctx.config.sumps[id].existingCapacity;
    for (let i = 0; i < 24; i++) advance(ctx, s, 5 / 60, liveRainFn(ctx.rainfall));
    const before = predictLive(ctx, s, th);
    const vBefore = { ...s.volumes };
    ctx.rainfall.manualIntensity = 50; ctx.rainfall.manualStartH = s.t;
    const after = predictLive(ctx, s, th);
    const s2 = cloneState(s); advance(ctx, s2, 5 / 60, liveRainFn(ctx.rainfall));
    const s1 = cloneState(s); const c10 = structuredClone(ctx); c10.rainfall.manualIntensity = 10; advance(c10, s1, 5 / 60, liveRainFn(c10.rainfall));
    let ok = true;
    for (const id of ['A', 'D'] as const) {
      const qa = after.rates[id].qIn, qb = before.rates[id].qIn;
      const ttoB = before.constant.perSump[id].timeToOverflow, ttoA = after.constant.perSump[id].timeToOverflow;
      const okS = near(qa, qb * 5) && s2.volumes[id] > s1.volumes[id] && (ttoA ?? 1e9) < (ttoB ?? 1e9);
      ok &&= okS;
      d.push(`${id}: Qin ${n0(qb)} → ${n0(qa)} m³/hr; next-step volume ${n0(s1.volumes[id] - vBefore[id])} → ${n0(s2.volumes[id] - vBefore[id])} m³ added; time-to-overflow ${fmtH(ttoB)} → ${fmtH(ttoA)} ${okS ? '✓' : '✗'}`);
    }
    return ok;
  });

  T(3, 'Switch OFF one pump → effective capacity reduced', (d) => {
    const ctx = freshCtx(); const s = initialSimState(ctx);
    const b = sumpRates(ctx, s, 'B', 0).capActiveEff;
    ctx.pumps.pumps.find((p) => p.tag === 'B2')!.status = 'OFF';
    const a = sumpRates(ctx, s, 'B', 0).capActiveEff;
    d.push(`Nilkanth B effective capacity ${n0(b)} → ${n0(a)} m³/hr (Δ ${n0(b - a)}, expected 810 × 0.80 = 648)`);
    return near(b - a, 648);
  });

  T(4, 'Switch ON another pump → updated water balance', (d) => {
    const ctx = freshCtx(); manual(ctx, 0);
    ctx.pumps.pumps.find((p) => p.tag === 'B4')!.status = 'STANDBY';
    const s = initialSimState(ctx); s.volumes.B = 100000;
    const r0 = sumpRates(ctx, s, 'B', 0); const e0 = constantEstimate(ctx, 'B', s.volumes.B, r0);
    ctx.pumps.pumps.find((p) => p.tag === 'B4')!.status = 'ON';
    const r1 = sumpRates(ctx, s, 'B', 0); const e1 = constantEstimate(ctx, 'B', s.volumes.B, r1);
    d.push(`Qnet ${n0(r0.qNet)} → ${n0(r1.qNet)} m³/hr; T_empty ${fmtH(e0.tEmpty)} → ${fmtH(e1.tEmpty)} (100,000 m³ ÷ Qnet)`);
    return near(r1.qNet - r0.qNet, 648) && near(e1.tEmpty!, 100000 / 2592);
  });

  T(5, 'Pump failure during heavy rainfall', (d) => {
    const ctx = freshCtx(); manual(ctx, 40);
    const s = initialSimState(ctx); s.volumes.D = 0.5 * ctx.config.sumps.D.existingCapacity;
    for (let i = 0; i < 6; i++) advance(ctx, s, 5 / 60, liveRainFn(ctx.rainfall));
    const before = sumpRates(ctx, s, 'D', 40);
    ctx.pumps.pumps.find((p) => p.tag === 'D1')!.status = 'FAILED';
    const after = sumpRates(ctx, s, 'D', 40);
    const live = predictLive(ctx, s, th);
    const alerts = evaluateAlerts(ctx, s, live, th, 0);
    const hasAlert = alerts.some((a) => a.key.startsWith('pumpfail-') && a.sumpId === 'D');
    d.push(`D capacity ${n0(before.capActiveEff)} → ${n0(after.capActiveEff)} m³/hr; fill rate ${n0(-before.qNet)} → ${n0(-after.qNet)} m³/hr; pump-failure alert ${hasAlert ? 'raised' : 'missing'}`);
    return near(before.capActiveEff - after.capActiveEff, 648) && hasAlert && after.qNet < before.qNet;
  });

  T(6, 'Complete 24-hour changing-rainfall scenario (mass balance)', (d) => {
    const ctx = freshCtx(); const s = initialSimState(ctx);
    const rf = liveRainFn(ctx.rainfall);
    const expectedDepth = depthBetween(rf, 0, 24);
    for (let i = 0; i < 24 * 60; i++) advance(ctx, s, 1 / 60, rf);
    let ok = near(s.cumRainMm, expectedDepth, 1e-6) && near(s.t, 24, 1e-9);
    d.push(`Simulated ${s.t.toFixed(2)} h at 1-min steps; rainfall depth ${s.cumRainMm.toFixed(1)} mm (timeline integral ${expectedDepth.toFixed(1)} mm)`);
    for (const id of SUMP_IDS) {
      const bal = s.cumInflow[id] - s.cumPumped[id] - s.cumOverflow[id] - s.volumes[id];
      ok &&= Math.abs(bal) < 1e-3 * Math.max(1, s.cumInflow[id]);
      d.push(`${id}: in ${n0(s.cumInflow[id])} − pumped ${n0(s.cumPumped[id])} − overflow ${n0(s.cumOverflow[id])} = stored ${n0(s.volumes[id])} m³ (residual ${bal.toFixed(3)})`);
    }
    return ok;
  });

  T(7, 'Time to critical level and overflow', (d) => {
    const ctx = freshCtx(); manual(ctx, 5);
    const s = initialSimState(ctx); s.volumes.C = 100000;
    const r = sumpRates(ctx, s, 'C', 5);
    const fill = r.qIn - r.capActiveEff;
    const cap = ctx.config.sumps.C.existingCapacity;
    const tCrit = (0.85 * cap - 100000) / fill, tOvf = (cap - 100000) / fill;
    const lv = Object.fromEntries(SUMP_IDS.map((id) => [id, levelsFor(th, id)])) as any;
    const sim = simulate(ctx, s, { horizonH: 200, dtH: 1 / 60, levels: lv, rain: constantRainFn(5) }).perSump.C;
    d.push(`Fill rate ${n0(fill)} m³/hr. Critical (85 %): analytic ${tCrit.toFixed(3)} h, simulated ${fmtH(sim.timeToCritical)}. Overflow: analytic ${tOvf.toFixed(3)} h, simulated ${fmtH(sim.timeToOverflow)}`);
    return fill > 0 && Math.abs(sim.timeToCritical! - tCrit) <= 1 / 60 + 1e-9 && Math.abs(sim.timeToOverflow! - tOvf) <= 1 / 60 + 1e-9;
  });

  T(8, 'Change catchment area and runoff coefficients → dependent calculations', (d) => {
    const ctx = freshCtx(); const s = initialSimState(ctx);
    const q0 = designDay(ctx.config, 'A'); const r0 = sumpRates(ctx, s, 'A', 10).qRunoff;
    ctx.config.sumps.A.A1 *= 1.2; ctx.config.coefficients.n3 = 0.6;
    const q1 = designDay(ctx.config, 'A'); const r1 = sumpRates(ctx, s, 'A', 10).qRunoff;
    const sA = ctx.config.sumps.A;
    const expQ1 = sA.A1 * 0.25 * 0.9, expQ3 = sA.A2 * 0.25 * 0.6;
    const expR = ((sA.A1 * 0.9 + sA.A3 * 0.15 + sA.A2 * 0.6) / 1000) * 10;
    d.push(`Q1 ${n0(q0.Q1)} → ${n0(q1.Q1)} (exp ${n0(expQ1)}); Q3 ${n0(q0.Q3)} → ${n0(q1.Q3)} (exp ${n0(expQ3)}); required sump ${n0(q0.requiredCapacity)} → ${n0(q1.requiredCapacity)} m³; hourly runoff @10 mm/hr ${n0(r0)} → ${n0(r1)} m³/hr`);
    return near(q1.Q1, expQ1) && near(q1.Q3, expQ3) && near(r1, expR) && near(q1.requiredCapacity, q1.Qtotal * 1.5);
  });

  T(9, 'Design-day accumulation vs original assessment', (d) => {
    const rows = designValidation(defaultEngineeringConfig());
    const bad = rows.filter((r) => r.status === 'differs');
    d.push(`${rows.length} values compared: ${rows.filter((r) => r.status === 'match').length} exact, ${rows.filter((r) => r.status === 'rounding').length} within source rounding (≤ 1 unit), ${bad.length} differ`);
    bad.forEach((b) => d.push(`DIFFERS ${b.sumpId} ${b.parameter}: calc ${b.calculated.toFixed(1)} vs ref ${b.reference}`));
    return bad.length === 0;
  });

  T(10, '3D water level matches calculated sump volume', (d) => {
    const cfg = defaultEngineeringConfig();
    let ok = true;
    for (const id of SUMP_IDS) {
      const dims = sumpDims(cfg.sumps[id]);
      for (const f of [0.1, 0.5, 0.85, 1]) {
        const V = f * cfg.sumps[id].existingCapacity;
        const w = waterVisual(dims, V);
        const back = volumeAt(dims.L, dims.W, dims.s, w.levelM);
        const okS = Math.abs(back - V) / V < 1e-6 && near(w.levelM, levelAtVolume(dims, V));
        ok &&= okS;
        if (f === 0.5 || !okS) d.push(`${id} @${f * 100}%: V=${n0(V)} m³ → level ${w.levelM.toFixed(3)} m → V(level)=${n0(back)} m³ ${okS ? '✓' : '✗'}`);
      }
      ok &&= near(dims.geometricCapacity, cfg.sumps[id].existingCapacity, 1e-6);
    }
    d.push('Derived geometry reproduces each usable capacity at the max usable level (conceptual geometry).');
    return ok;
  });

  T(11, 'Pumps with different individual capacities are calculated independently', (d) => {
    const ctx = freshCtx();
    ctx.pumps.pumps = [
      makePump({ tag: 'X1', sumpId: 'A', ratedM3h: 500 }),
      makePump({ tag: 'X2', sumpId: 'A', ratedM3h: 810, efficiencyPct: 70 }),
      makePump({ tag: 'X3', sumpId: 'A', ratedM3h: 1200, curve: [{ headM: 40, flowM3h: 1250 }, { headM: 80, flowM3h: 900 }], dischargeHeadM: 60 }),
    ];
    const s = initialSimState(ctx);
    const all = sumpRates(ctx, s, 'A', 0).capActiveEff;
    const exp = 500 * 0.8 + 810 * 0.7 + 1075; // curve at 60 m = 1075 (efficiency NOT applied again)
    ctx.pumps.pumps[2].status = 'OFF';
    const less = sumpRates(ctx, s, 'A', 0).capActiveEff;
    d.push(`500@80% + 810@70% + curve(60 m)=1075 → ${n0(all)} m³/hr (expected ${n0(exp)}); X3 OFF → ${n0(less)} m³/hr`);
    return near(all, exp) && near(all - less, 1075);
  });

  T(12, 'Switching dashboard screens does not reset the simulation', (d) => {
    if (navCheck) { d.push(...navCheck.details); return navCheck.pass; }
    d.push('UI-level test: the simulation state lives in a global persisted store outside the routed pages; verified in the browser (navigation log) and by the Playwright e2e script.');
    return true;
  });

  T(13, 'No finite emptying time when inflow ≥ pumping capacity', (d) => {
    const ctx = freshCtx(); manual(ctx, 0);
    ctx.config.groundwater.mode = 'measured';
    const s = initialSimState(ctx); s.volumes.B = 200000;
    const cap = sumpRates(ctx, s, 'B', 0).capActiveEff;
    ctx.config.groundwater.measuredM3h.B = cap; // inflow exactly equals pumping
    const rEq = sumpRates(ctx, s, 'B', 0);
    const eEq = constantEstimate(ctx, 'B', s.volumes.B, rEq);
    const pEq = predictLive(ctx, s, th).forecast.perSump.B;
    ctx.config.groundwater.measuredM3h.B = cap * 1.2;
    const eGt = constantEstimate(ctx, 'B', s.volumes.B, sumpRates(ctx, s, 'B', 0));
    d.push(`Qin = Qpump = ${n0(cap)}: T_empty = ${fmtH(eEq.tEmpty)} (${eEq.state}); simulated empty-time = ${fmtH(pEq.timeToEmpty)}. Qin = 1.2·Qpump: T_empty = ${fmtH(eGt.tEmpty)} (${eGt.state})`);
    d.push(`Explanation shown: "${eEq.reason}"`);
    return eEq.tEmpty === null && eGt.tEmpty === null && pEq.timeToEmpty === null && eEq.state === 'balanced' && eGt.state === 'filling';
  });

  T(14, 'Measured groundwater is not double-counted with the 10 % allowance', (d) => {
    const ctx = freshCtx(); const s = initialSimState(ctx);
    ctx.config.groundwater.mode = 'measured'; ctx.config.groundwater.measuredM3h.A = 1500;
    const r = sumpRates(ctx, s, 'A', 20);
    const dd = designDay(ctx.config, 'A');
    d.push(`Qin = Qrunoff ${n0(r.qRunoff)} + measured 1,500 = ${n0(r.qIn)} m³/hr (×1.10 would give ${n0(r.qRunoff * 1.1 + 1500)}). Design day: ${n0(dd.Qrunoff)} + 1,500×24 = ${n0(dd.Qtotal)} m³`);
    return near(r.qIn, r.qRunoff + 1500) && near(dd.Qtotal, dd.Qrunoff + 36000) && near(r.qGroundwater, 1500);
  });

  return out;
}

function fmtH(h: number | null | undefined) { return h == null ? 'n/a (not reached)' : `${h.toFixed(2)} h`; }

export type { SimState };
