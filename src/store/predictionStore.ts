/**
 * PREDICTION / WHAT-IF SANDBOX.
 * A copy of the live configuration and state that the user can modify (rain, pump status/capacity)
 * and run forward in time. It is stepped with the SAME advance() water-balance function as the
 * live simulation, in sub-steps of ≤ 1 minute, so the 3D water body moves continuously while the
 * volume stays mass-consistent. Never writes back to the live store.
 */
import { create } from 'zustand';
import type { Ctx, SimState, SumpId, Pump, PumpStatus, Thresholds, LevelThresholds } from '../engine/types';
import { SUMP_IDS } from '../engine/types';
import { advance, cloneState } from '../engine/balance';
import { forecastAt, rainfallAt } from '../engine/rainfall';
import { simulate, levelsFor, type SimResult } from '../engine/prediction';
import { useStore, ctxOf } from './store';

export type PredRain = { kind: 'constant'; intensity: number } | { kind: 'forecast' };
export type PresetId = 'all' | 'p1' | 'p2' | 'p12' | 'one' | 'none' | 'heavy1';

export const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'all', label: 'All pumps operational' },
  { id: 'p1', label: 'Pump 1 fails' },
  { id: 'p2', label: 'Pump 2 fails' },
  { id: 'p12', label: 'Pumps 1 + 2 fail' },
  { id: 'one', label: 'Only one pump running' },
  { id: 'none', label: 'All pumps fail' },
  { id: 'heavy1', label: 'Heavy rain (40 mm/hr) + Pump 1 down' },
];

export interface TracePoint { t: number; V: number }

interface PredState {
  ready: boolean;
  ctx: Ctx | null;
  start: SimState | null;
  state: SimState | null;
  rain: PredRain;
  horizonH: number;
  playing: boolean;
  playSeconds: number; // real seconds to play the whole horizon
  trace: Record<SumpId, TracePoint[]>;
  outlook: SimResult | null; // from the current sandbox time forward, with current settings
  scenario: string;
  version: number;
  begin: () => void;
  restart: () => void;
  setRain: (r: PredRain) => void;
  setPump: (id: string, patch: Partial<Pump>) => void;
  setPower: (id: SumpId, on: boolean) => void;
  preset: (p: PresetId, sumpId: SumpId) => void;
  setHorizon: (h: number) => void;
  setPlaySeconds: (s: number) => void;
  play: () => void;
  pause: () => void;
  tick: (realMs: number) => void;
}

export const rainFnOf = (ctx: Ctx, r: PredRain) => (r.kind === 'constant' ? () => Math.max(0, r.intensity) : (t: number) => forecastAt(ctx.rainfall, t));

function levelsOf(th: Thresholds) {
  return Object.fromEntries(SUMP_IDS.map((id) => [id, levelsFor(th, id)])) as Record<SumpId, LevelThresholds>;
}

function computeOutlook(ctx: Ctx, s: SimState, r: PredRain): SimResult {
  const th = useStore.getState().thresholds;
  return simulate(ctx, s, { horizonH: Math.max(24, ctx.config.sim.predictionHorizonH), dtH: ctx.config.sim.predictionDtMinutes / 60, levels: levelsOf(th), rain: rainFnOf(ctx, r), sampleH: 0.25 });
}

let lastRefresh = 0;
const emptyTrace = () => ({ A: [], B: [], C: [], D: [] }) as Record<SumpId, TracePoint[]>;

export const usePrediction = create<PredState>((set, get) => {
  const refresh = (patch: Partial<PredState> = {}) => {
    const st = { ...get(), ...patch };
    if (!st.ctx || !st.state) { set(patch); return; }
    set({ ...patch, outlook: computeOutlook(st.ctx, st.state, st.rain), version: get().version + 1 });
  };
  return {
    ready: false, ctx: null, start: null, state: null, rain: { kind: 'constant', intensity: 0 }, horizonH: 6, playing: false, playSeconds: 20,
    trace: emptyTrace(), outlook: null, scenario: 'Copy of live conditions', version: 0,

    begin: () => {
      const live = useStore.getState();
      const ctx: Ctx = structuredClone(ctxOf(live));
      const state = cloneState(live.sim);
      const I = rainfallAt(live.rainfall, live.sim.t);
      const trace = emptyTrace();
      for (const id of SUMP_IDS) trace[id].push({ t: 0, V: state.volumes[id] });
      refresh({ ready: true, ctx, start: cloneState(state), state, rain: { kind: 'constant', intensity: +I.toFixed(2) }, trace, playing: false, scenario: 'Copy of live conditions' });
    },
    restart: () => {
      const { start } = get();
      if (!start) return;
      const state = cloneState(start);
      const trace = emptyTrace();
      for (const id of SUMP_IDS) trace[id].push({ t: 0, V: state.volumes[id] });
      refresh({ state, trace, playing: false });
    },
    setRain: (r) => refresh({ rain: r }),
    setPump: (id, patch) => {
      const ctx = get().ctx;
      if (!ctx) return;
      const pumps = { ...ctx.pumps, pumps: ctx.pumps.pumps.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
      refresh({ ctx: { ...ctx, pumps }, scenario: 'Custom' });
    },
    setPower: (id, on) => {
      const ctx = get().ctx;
      if (!ctx) return;
      refresh({ ctx: { ...ctx, pumps: { ...ctx.pumps, power: { ...ctx.pumps.power, [id]: on } } }, scenario: 'Custom' });
    },
    preset: (p, sumpId) => {
      const { ctx } = get();
      if (!ctx) return;
      const mine = ctx.pumps.pumps.filter((x) => x.sumpId === sumpId);
      const status = (i: number): PumpStatus => {
        switch (p) {
          case 'all': return 'ON';
          case 'p1': return i === 0 ? 'FAILED' : 'ON';
          case 'p2': return i === 1 ? 'FAILED' : 'ON';
          case 'p12': return i <= 1 ? 'FAILED' : 'ON';
          case 'one': return i === 0 ? 'ON' : 'FAILED';
          case 'none': return 'FAILED';
          case 'heavy1': return i === 0 ? 'FAILED' : 'ON';
        }
      };
      const pumps = ctx.pumps.pumps.map((x) => { const i = mine.indexOf(x); return i >= 0 ? { ...x, status: status(i) } : x; });
      const label = PRESETS.find((x) => x.id === p)!.label;
      refresh({ ctx: { ...ctx, pumps: { ...ctx.pumps, pumps, power: { ...ctx.pumps.power, [sumpId]: true } } }, scenario: label, ...(p === 'heavy1' ? { rain: { kind: 'constant', intensity: 40 } as PredRain } : {}) });
    },
    setHorizon: (h) => set({ horizonH: h }),
    setPlaySeconds: (s) => set({ playSeconds: s }),
    play: () => {
      const { state, start, horizonH } = get();
      if (state && start && state.t - start.t >= horizonH - 1e-6) get().restart();
      set({ playing: true });
    },
    pause: () => set({ playing: false }),
    tick: (realMs) => {
      const st = get();
      if (!st.playing || !st.ctx || !st.state || !st.start) return;
      const elapsed = st.state.t - st.start.t;
      const remaining = st.horizonH - elapsed;
      if (remaining <= 1e-9) { set({ playing: false }); return; }
      const simH = Math.min(remaining, (st.horizonH / st.playSeconds) * (realMs / 1000));
      const s = cloneState(st.state);
      const rain = rainFnOf(st.ctx, st.rain);
      let left = simH;
      while (left > 1e-12) { const dt = Math.min(1 / 60, left); advance(st.ctx, s, dt, rain); left -= dt; }
      const trace = { ...st.trace };
      for (const id of SUMP_IDS) {
        const arr = trace[id];
        const last = arr[arr.length - 1];
        if (!last || s.t - st.start.t - last.t >= Math.max(st.horizonH / 400, 1 / 60)) trace[id] = [...arr, { t: s.t - st.start.t, V: s.volumes[id] }];
      }
      const done = s.t - st.start.t >= st.horizonH - 1e-9;
      set({ state: s, trace, playing: !done });
      // keep the forward outlook current (~2 Hz)
      if (done || performance.now() - lastRefresh > 500) { lastRefresh = performance.now(); refresh(); }
    },
  };
});
