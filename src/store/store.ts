/**
 * Global persistent application store.
 * Separate records are kept for: original data (frozen, in engine/original.ts — never stored here),
 * engineering configuration, pump configuration, rainfall inputs, alert thresholds, live simulation
 * state, simulation history, archived runs, manual readings, alert log and audit log.
 *
 * The simulation clock is driven from <App/> (outside routed pages) so navigating between
 * screens never resets or pauses the simulation.
 */
import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import type {
  EngineeringConfig, PumpConfig, RainfallInputs, Thresholds, SimState, SumpId, Pump, Ctx, RainEvent, PumpStatus,
} from '../engine/types';
import { SUMP_IDS } from '../engine/types';
import { defaultEngineeringConfig, defaultPumpConfig, defaultRainfall, defaultThresholds, makePump } from '../engine/defaults';
import { initialSimState, advance, allRates } from '../engine/balance';
import { predictLive, constantEstimate, type LivePrediction } from '../engine/prediction';
import { liveRainFn, rainfallAt } from '../engine/rainfall';
import { evaluateAlerts, type AlertItem } from '../engine/alerts';
import { nextPumpTag, effectiveCapacity } from '../engine/pumps';
import { defaultTwinConfig, type TwinConfig } from '../engine/mine';

export type HistoryPoint = Record<string, number>;

export interface AuditEntry { id: string; wallISO: string; simT: number; category: string; message: string }
export interface AlertLogEntry extends AlertItem {
  id: string; raisedISO: string; raisedSimT: number; clearedISO?: string; clearedSimT?: number; acknowledged: boolean; change: 'raised' | 'escalated' | 'de-escalated';
}
export interface ManualReading {
  id: string; wallISO: string; simT: number; source: 'manual' | 'sensor';
  kind: 'rainfall' | 'volume' | 'level' | 'flow' | 'groundwater';
  sumpId: SumpId | null; value: number; unit: string; note: string;
}
export interface SavedConfig { id: string; name: string; savedISO: string; config: EngineeringConfig; pumps: PumpConfig; rainfall: RainfallInputs; thresholds: Thresholds }
export interface ArchivedRun {
  id: string; name: string; endedISO: string; startISO: string; simHours: number; rainMm: number;
  perSump: Record<SumpId, { finalV: number; cumIn: number; cumPumped: number; cumOverflow: number }>;
  history: HistoryPoint[];
}
export interface NavEntry { path: string; wallISO: string; simT: number; runId: number; running: boolean }

export const SPEEDS = [1, 60, 300, 900, 3600, 14400] as const;

interface Derived {
  live: LivePrediction | null;
  alerts: AlertItem[];
  rain24: number;
  computedAt: number;
}

export interface AppState {
  config: EngineeringConfig;
  pumps: PumpConfig;
  rainfall: RainfallInputs;
  thresholds: Thresholds;
  twin: TwinConfig;
  sim: SimState;
  history: HistoryPoint[];
  runId: number;
  running: boolean;
  speed: number; // simulated seconds per real second
  carryH: number;
  alertLog: AlertLogEntry[];
  audit: AuditEntry[];
  readings: ManualReading[];
  savedConfigs: SavedConfig[];
  runs: ArchivedRun[];
  navLog: NavEntry[];
  derived: Derived;

  // simulation control
  start: () => void;
  pause: () => void;
  reset: (archive?: boolean) => void;
  setSpeed: (s: number) => void;
  setDt: (m: 1 | 5 | 15) => void;
  tick: (realMs: number) => void;
  fastForward: (hours: number) => void;
  setVolume: (id: SumpId, v: number, why: string) => void;
  // configuration
  updateConfig: (path: string, value: unknown) => void;
  replaceConfig: (c: EngineeringConfig, msg: string) => void;
  updateThresholds: (path: string, value: unknown) => void;
  setSumpOverride: (id: SumpId, on: boolean) => void;
  // pumps
  updatePump: (id: string, patch: Partial<Pump>) => void;
  setPumpStatus: (id: string, s: PumpStatus) => void;
  addPump: (sumpId: SumpId, rated?: number) => void;
  removePump: (id: string) => void;
  transferPump: (id: string, to: SumpId) => void;
  setPower: (id: SumpId | 'all', on: boolean) => void;
  loadPumpArrangement: (includeProposed: boolean) => void;
  // rainfall
  setRainfall: (patch: Partial<RainfallInputs>, msg?: string) => void;
  addRainEvent: (e: Omit<RainEvent, 'id'>) => void;
  removeRainEvent: (id: string) => void;
  // data
  saveConfig: (name: string) => void;
  loadSavedConfig: (id: string) => void;
  deleteSavedConfig: (id: string) => void;
  restoreOriginal: () => void;
  importData: (json: string) => string;
  addReading: (r: Omit<ManualReading, 'id' | 'wallISO' | 'simT'>) => void;
  removeReading: (id: string) => void;
  acknowledgeAlert: (id: string) => void;
  clearAlertLog: () => void;
  recordNav: (path: string) => void;
  updateTwin: (patch: Partial<TwinConfig>, msg?: string) => void;
  recompute: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const nowISO = () => new Date().toISOString();

export const ctxOf = (s: Pick<AppState, 'config' | 'pumps' | 'rainfall'>): Ctx => ({ config: s.config, pumps: s.pumps, rainfall: s.rainfall });

function getPath(o: any, path: string) { return path.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
function setPath<T>(o: T, path: string, v: unknown): T {
  const c = structuredClone(o) as any;
  const ks = path.split('.');
  let cur = c;
  for (let i = 0; i < ks.length - 1; i++) cur = cur[ks[i]];
  cur[ks[ks.length - 1]] = v;
  return c;
}
const show = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('en-IN', { maximumFractionDigits: 4 }) : JSON.stringify(v));

const HISTORY_MAX = 2000;
const round = (x: number, d = 1) => { const f = 10 ** d; return Math.round(x * f) / f; };

function historyPoint(ctx: Ctx, s: SimState, flows?: { pumped: Record<SumpId, number> }): HistoryPoint {
  const I = rainfallAt(ctx.rainfall, s.t);
  const rates = allRates(ctx, s, I);
  const p: HistoryPoint = { t: round(s.t, 4), rain: round(I, 2), cumRain: round(s.cumRainMm, 2) };
  for (const id of SUMP_IDS) {
    const r = rates[id];
    const cap = ctx.config.sumps[id].existingCapacity;
    const est = constantEstimate(ctx, id, s.volumes[id], r);
    p[`${id}_V`] = Math.round(s.volumes[id]);
    p[`${id}_util`] = round(cap > 0 ? (s.volumes[id] / cap) * 100 : 0, 2);
    p[`${id}_qin`] = Math.round(r.qIn);
    p[`${id}_cap`] = Math.round(r.capActiveEff);
    p[`${id}_pumped`] = Math.round(flows ? flows.pumped[id] : (s.volumes[id] > 0 ? r.capActiveEff : Math.min(r.capActiveEff, r.qIn)));
    p[`${id}_te`] = est.tEmpty == null ? -1 : round(est.tEmpty, 2);
    p[`${id}_cin`] = Math.round(s.cumInflow[id]);
    p[`${id}_cout`] = Math.round(s.cumPumped[id]);
    p[`${id}_ovf`] = Math.round(s.cumOverflow[id]);
  }
  return p;
}

function thin(h: HistoryPoint[], max: number): HistoryPoint[] {
  if (h.length <= max) return h;
  const out: HistoryPoint[] = [];
  const k = Math.ceil(h.length / max);
  for (let i = 0; i < h.length; i++) if (i % k === 0 || i === h.length - 1) out.push(h[i]);
  return out;
}

export function rain24FromHistory(history: HistoryPoint[], s: SimState): number {
  if (s.t <= 24) return s.cumRainMm;
  const target = s.t - 24;
  let prev: HistoryPoint | null = null;
  for (const p of history) {
    if (p.t >= target) {
      if (!prev) return s.cumRainMm - p.cumRain;
      const f = (target - prev.t) / (p.t - prev.t || 1);
      return s.cumRainMm - (prev.cumRain + f * (p.cumRain - prev.cumRain));
    }
    prev = p;
  }
  return s.cumRainMm - (prev?.cumRain ?? 0);
}

// Debounced persistence (the store changes up to 10×/s while running).
let pending: { name: string; value: StorageValue<unknown> } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
export let persistError: string | null = null;
function flush() {
  timer = null;
  if (!pending) return;
  try { localStorage.setItem(pending.name, JSON.stringify(pending.value)); persistError = null; }
  catch (e) { persistError = (e as Error).message; }
  pending = null;
}
const storage: PersistStorage<unknown> = {
  getItem: (name) => { try { const v = localStorage.getItem(name); return v ? JSON.parse(v) : null; } catch { return null; } },
  setItem: (name, value) => { pending = { name, value }; if (!timer) timer = setTimeout(flush, 1500); },
  removeItem: (name) => { try { localStorage.removeItem(name); } catch { /* ignore */ } },
};
if (typeof window !== 'undefined') window.addEventListener('beforeunload', flush);

function freshSimFields(config: EngineeringConfig, pumps: PumpConfig, rainfall: RainfallInputs) {
  const sim = initialSimState({ config, pumps, rainfall });
  return { sim, history: [historyPoint({ config, pumps, rainfall }, sim)], carryH: 0 };
}

const init = (() => {
  const config = defaultEngineeringConfig();
  const pumps = defaultPumpConfig(true);
  const rainfall = defaultRainfall();
  return { config, pumps, rainfall, thresholds: defaultThresholds(), ...freshSimFields(config, pumps, rainfall) };
})();

export const useStore = create<AppState>()(persist((set, get) => {
  const audit = (category: string, message: string) => {
    const s = get();
    set({ audit: [{ id: uid(), wallISO: nowISO(), simT: s.sim.t, category, message }, ...s.audit].slice(0, 1500) });
  };
  const after = () => get().recompute();

  return {
    ...init,
    runId: 1,
    running: false,
    speed: 300,
    alertLog: [],
    audit: [],
    readings: [],
    savedConfigs: [],
    runs: [],
    navLog: [],
    derived: { live: null, alerts: [], rain24: 0, computedAt: 0 },
    twin: defaultTwinConfig(),
    updateTwin: (patch, msg) => {
      set({ twin: { ...get().twin, ...patch } });
      audit('3D twin', msg ?? '3D twin settings: ' + Object.entries(patch).map(([k, v]) => `${k} → ${k === 'layers' ? '(lithology table)' : show(v)}`).join('; '));
    },

    start: () => { if (!get().running) { set({ running: true }); audit('Simulation', `Simulation started/resumed at T+${get().sim.t.toFixed(2)} h`); } },
    pause: () => { if (get().running) { set({ running: false }); audit('Simulation', `Simulation paused at T+${get().sim.t.toFixed(2)} h`); } },
    reset: (archive = true) => {
      const s = get();
      let runs = s.runs;
      if (archive && s.sim.t > 0) {
        const perSump = Object.fromEntries(SUMP_IDS.map((id) => [id, { finalV: s.sim.volumes[id], cumIn: s.sim.cumInflow[id], cumPumped: s.sim.cumPumped[id], cumOverflow: s.sim.cumOverflow[id] }])) as ArchivedRun['perSump'];
        runs = [{ id: uid(), name: `Run ${s.runId}`, endedISO: nowISO(), startISO: s.sim.startISO, simHours: s.sim.t, rainMm: s.sim.cumRainMm, perSump, history: thin(s.history, 150) }, ...runs].slice(0, 10);
      }
      set({ ...freshSimFields(s.config, s.pumps, s.rainfall), runs, running: false, runId: s.runId + 1 });
      audit('Simulation', `Simulation reset${archive && s.sim.t > 0 ? ` (Run ${s.runId} archived, ${s.sim.t.toFixed(2)} h)` : ''}`);
      after();
    },
    setSpeed: (speed) => { set({ speed }); audit('Simulation', `Speed set to ${speed}× (simulated s per real s)`); },
    setDt: (m) => { get().updateConfig('sim.dtMinutes', m); },
    tick: (realMs) => {
      const s = get();
      if (!s.running) return;
      const dtH = s.config.sim.dtMinutes / 60;
      let carry = s.carryH + (s.speed * realMs) / 1000 / 3600;
      let steps = Math.floor(carry / dtH + 1e-9);
      if (steps <= 0) { set({ carryH: carry }); return; }
      steps = Math.min(steps, 5000);
      carry -= steps * dtH;
      if (carry > 10 * dtH) carry = 0; // drop backlog if the browser stalled
      const ctx = ctxOf(s);
      const sim = structuredClone(s.sim);
      const hist = s.history.slice();
      const rf = liveRainFn(s.rainfall);
      const sampleH = Math.max(dtH, 5 / 60);
      let lastT = hist.length ? hist[hist.length - 1].t : -1;
      for (let i = 0; i < steps; i++) {
        const flows = advance(ctx, sim, dtH, rf);
        if (sim.t - lastT >= sampleH - 1e-9) { hist.push(historyPoint(ctx, sim, flows)); lastT = sim.t; }
      }
      set({ sim, history: thin(hist, HISTORY_MAX), carryH: carry });
      if (performance.now() - get().derived.computedAt > 200) after();
    },
    fastForward: (hours) => {
      const s = get();
      const dtH = s.config.sim.dtMinutes / 60;
      const ctx = ctxOf(s);
      const sim = structuredClone(s.sim);
      const hist = s.history.slice();
      const rf = liveRainFn(s.rainfall);
      const sampleH = Math.max(dtH, 5 / 60);
      let lastT = hist.length ? hist[hist.length - 1].t : -1;
      const n = Math.round(hours / dtH);
      for (let i = 0; i < n; i++) {
        const flows = advance(ctx, sim, dtH, rf);
        if (sim.t - lastT >= sampleH - 1e-9) { hist.push(historyPoint(ctx, sim, flows)); lastT = sim.t; }
      }
      set({ sim, history: thin(hist, HISTORY_MAX) });
      audit('Simulation', `Fast-forward +${hours} h → T+${sim.t.toFixed(2)} h`);
      after();
    },
    setVolume: (id, v, why) => {
      const s = get();
      const cap = s.config.sumps[id].existingCapacity;
      const V = Math.max(0, Math.min(cap, v));
      const sim = structuredClone(s.sim);
      sim.volumes[id] = V;
      set({ sim, history: [...s.history, historyPoint(ctxOf({ ...s }), sim)] });
      audit('Sump volume', `${s.config.sumps[id].name}: stored volume set to ${Math.round(V).toLocaleString('en-IN')} m³ (${why})`);
      after();
    },

    updateConfig: (path, value) => {
      const s = get();
      const old = getPath(s.config, path);
      if (JSON.stringify(old) === JSON.stringify(value)) return;
      set({ config: setPath(s.config, path, value) });
      audit('Configuration', `config.${path}: ${show(old)} → ${show(value)}`);
      after();
    },
    replaceConfig: (c, msg) => { set({ config: c }); audit('Configuration', msg); after(); },
    updateThresholds: (path, value) => {
      const s = get();
      const old = getPath(s.thresholds, path);
      if (JSON.stringify(old) === JSON.stringify(value)) return;
      set({ thresholds: setPath(s.thresholds, path, value) });
      audit('Thresholds', `thresholds.${path}: ${show(old)} → ${show(value)}`);
      after();
    },
    setSumpOverride: (id, on) => {
      const s = get();
      const ov = { ...s.thresholds.sumpOverrides };
      if (on) ov[id] = { ...s.thresholds.level }; else delete ov[id];
      set({ thresholds: { ...s.thresholds, sumpOverrides: ov } });
      audit('Thresholds', `${s.config.sumps[id].name}: level threshold override ${on ? 'enabled' : 'removed'}`);
      after();
    },

    updatePump: (id, patch) => {
      const s = get();
      const p = s.pumps.pumps.find((x) => x.id === id);
      if (!p) return;
      const changes = Object.entries(patch).filter(([k, v]) => JSON.stringify((p as any)[k]) !== JSON.stringify(v));
      if (!changes.length) return;
      const np = { ...p, ...patch };
      if ('ratedM3h' in patch && p.ratingBasis !== 'user') np.ratingBasis = 'user';
      set({ pumps: { ...s.pumps, pumps: s.pumps.pumps.map((x) => (x.id === id ? np : x)) } });
      audit('Pump', `Pump ${p.tag} (${s.config.sumps[p.sumpId].name}): ` + changes.map(([k, v]) => `${k} ${show((p as any)[k])} → ${show(v)}`).join('; '));
      after();
    },
    setPumpStatus: (id, st) => get().updatePump(id, { status: st }),
    addPump: (sumpId, rated) => {
      const s = get();
      const p = makePump({ tag: nextPumpTag(s.pumps, sumpId), sumpId, ratedM3h: rated ?? s.config.referencePumpRating, status: 'OFF', origin: 'user', ratingBasis: 'user', notes: 'Added by user' });
      set({ pumps: { ...s.pumps, pumps: [...s.pumps.pumps, p] } });
      audit('Pump', `Pump ${p.tag} added to ${s.config.sumps[sumpId].name} (${p.ratedM3h} m³/hr rated, OFF)`);
      after();
    },
    removePump: (id) => {
      const s = get();
      const p = s.pumps.pumps.find((x) => x.id === id);
      if (!p) return;
      set({ pumps: { ...s.pumps, pumps: s.pumps.pumps.filter((x) => x.id !== id) } });
      audit('Pump', `Pump ${p.tag} removed from ${s.config.sumps[p.sumpId].name}`);
      after();
    },
    transferPump: (id, to) => {
      const s = get();
      const p = s.pumps.pumps.find((x) => x.id === id);
      if (!p || p.sumpId === to) return;
      const tag = nextPumpTag(s.pumps, to);
      set({ pumps: { ...s.pumps, pumps: s.pumps.pumps.map((x) => (x.id === id ? { ...x, sumpId: to, tag, status: 'OFF', notes: `${x.notes} Transferred from ${p.tag}.`.trim() } : x)) } });
      audit('Pump', `Pump ${p.tag} transferred ${s.config.sumps[p.sumpId].name} → ${s.config.sumps[to].name} as ${tag} (set OFF until commissioned)`);
      after();
    },
    setPower: (id, on) => {
      const s = get();
      const power = { ...s.pumps.power };
      for (const k of id === 'all' ? SUMP_IDS : [id]) power[k] = on;
      set({ pumps: { ...s.pumps, power } });
      audit('Power', `${id === 'all' ? 'All pump stations' : s.config.sumps[id].name}: power ${on ? 'RESTORED' : 'FAILED'}`);
      after();
    },
    loadPumpArrangement: (inc) => {
      set({ pumps: defaultPumpConfig(inc) });
      audit('Pump', `Pump arrangement reset to assessment: ${inc ? 'existing + proposed pumps' : 'existing pumps only'}`);
      after();
    },

    setRainfall: (patch, msg) => {
      const s = get();
      const np = { ...s.rainfall, ...patch };
      if (('manualIntensity' in patch || 'manualDurationH' in patch || patch.mode === 'manual') && !('manualStartH' in patch)) np.manualStartH = s.sim.t;
      set({ rainfall: np });
      audit('Rainfall', msg ?? 'Rainfall inputs: ' + Object.entries(patch).map(([k, v]) => `${k} → ${show(v)}`).join('; '));
      after();
    },
    addRainEvent: (e) => {
      const s = get();
      set({ rainfall: { ...s.rainfall, events: [...s.rainfall.events, { ...e, id: uid() }] } });
      audit('Rainfall', `Rain event "${e.label}" added: +${e.intensity} mm/hr from T+${e.startH.toFixed(2)} h for ${e.durationH} h`);
      after();
    },
    removeRainEvent: (id) => {
      const s = get();
      const e = s.rainfall.events.find((x) => x.id === id);
      set({ rainfall: { ...s.rainfall, events: s.rainfall.events.filter((x) => x.id !== id) } });
      if (e) audit('Rainfall', `Rain event "${e.label}" removed`);
      after();
    },

    saveConfig: (name) => {
      const s = get();
      const sc: SavedConfig = { id: uid(), name, savedISO: nowISO(), config: structuredClone(s.config), pumps: structuredClone(s.pumps), rainfall: structuredClone(s.rainfall), thresholds: structuredClone(s.thresholds) };
      set({ savedConfigs: [sc, ...s.savedConfigs].slice(0, 30) });
      audit('Data', `Configuration saved as "${name}"`);
    },
    loadSavedConfig: (id) => {
      const s = get();
      const sc = s.savedConfigs.find((x) => x.id === id);
      if (!sc) return;
      set({ config: structuredClone(sc.config), pumps: structuredClone(sc.pumps), rainfall: structuredClone(sc.rainfall), thresholds: structuredClone(sc.thresholds) });
      audit('Data', `Configuration "${sc.name}" loaded`);
      after();
    },
    deleteSavedConfig: (id) => {
      const s = get();
      const sc = s.savedConfigs.find((x) => x.id === id);
      set({ savedConfigs: s.savedConfigs.filter((x) => x.id !== id) });
      if (sc) audit('Data', `Saved configuration "${sc.name}" deleted`);
    },
    restoreOriginal: () => {
      set({ config: defaultEngineeringConfig(), pumps: defaultPumpConfig(true), rainfall: defaultRainfall(), thresholds: defaultThresholds() });
      audit('Data', 'Engineering configuration, pumps, rainfall inputs and thresholds restored to original assessment values');
      after();
    },
    importData: (json) => {
      try {
        const d = JSON.parse(json);
        const patch: Partial<AppState> = {};
        const base = defaultEngineeringConfig();
        if (d.config) {
          if (!d.config.sumps || !SUMP_IDS.every((id) => d.config.sumps[id])) throw new Error('config.sumps must contain A, B, C, D');
          patch.config = { ...base, ...d.config, design: { ...base.design, ...d.config.design }, sim: { ...base.sim, ...d.config.sim } };
        }
        if (d.pumps) { if (!Array.isArray(d.pumps.pumps)) throw new Error('pumps.pumps must be an array'); patch.pumps = d.pumps; }
        if (d.rainfall) patch.rainfall = { ...defaultRainfall(), ...d.rainfall };
        if (d.thresholds) patch.thresholds = { ...defaultThresholds(), ...d.thresholds };
        if (Array.isArray(d.readings)) patch.readings = d.readings;
        if (!Object.keys(patch).length) throw new Error('No recognised sections (config, pumps, rainfall, thresholds, readings)');
        set(patch);
        audit('Data', `Imported: ${Object.keys(patch).join(', ')}`);
        after();
        return `Imported ${Object.keys(patch).join(', ')}`;
      } catch (e) {
        return 'Import failed: ' + (e as Error).message;
      }
    },
    addReading: (r) => {
      const s = get();
      const rec: ManualReading = { ...r, id: uid(), wallISO: nowISO(), simT: s.sim.t };
      set({ readings: [rec, ...s.readings].slice(0, 2000) });
      audit('Reading', `Manual reading: ${r.kind}${r.sumpId ? ' ' + r.sumpId : ''} = ${r.value} ${r.unit}`);
    },
    removeReading: (id) => set({ readings: get().readings.filter((x) => x.id !== id) }),
    acknowledgeAlert: (id) => set({ alertLog: get().alertLog.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)) }),
    clearAlertLog: () => { set({ alertLog: get().alertLog.filter((a) => !a.clearedISO) }); audit('Alerts', 'Cleared resolved alerts from log'); },
    recordNav: (path) => {
      const s = get();
      set({ navLog: [...s.navLog, { path, wallISO: nowISO(), simT: s.sim.t, runId: s.runId, running: s.running }].slice(-60) });
    },

    recompute: () => {
      const s = get();
      const ctx = ctxOf(s);
      const live = predictLive(ctx, s.sim, s.thresholds);
      const rain24 = rain24FromHistory(s.history, s.sim);
      const alerts = evaluateAlerts(ctx, s.sim, live, s.thresholds, rain24);
      // alert log maintenance
      const SR = { warning: 1, critical: 2, emergency: 3 } as const;
      const openByKey = new Map<string, AlertLogEntry>();
      for (const a of s.alertLog) if (!a.clearedISO && !openByKey.has(a.key)) openByKey.set(a.key, a);
      let log = s.alertLog;
      let changed = false;
      const now = nowISO();
      const seen = new Set<string>();
      const newEntries: AlertLogEntry[] = [];
      for (const a of alerts) {
        seen.add(a.key);
        const open = openByKey.get(a.key);
        if (!open) {
          newEntries.push({ ...a, id: uid(), raisedISO: now, raisedSimT: s.sim.t, acknowledged: false, change: 'raised' });
        } else if (open.severity !== a.severity) {
          log = log.map((x) => (x.id === open.id ? { ...x, clearedISO: now, clearedSimT: s.sim.t } : x));
          newEntries.push({ ...a, id: uid(), raisedISO: now, raisedSimT: s.sim.t, acknowledged: false, change: SR[a.severity] > SR[open.severity] ? 'escalated' : 'de-escalated' });
          changed = true;
        }
      }
      for (const [k, open] of openByKey) if (!seen.has(k)) { log = log.map((x) => (x.id === open.id ? { ...x, clearedISO: now, clearedSimT: s.sim.t } : x)); changed = true; }
      if (newEntries.length) { log = [...newEntries, ...log]; changed = true; }
      set({ derived: { live, alerts, rain24, computedAt: performance.now() }, ...(changed ? { alertLog: log.slice(0, 1000) } : {}) });
    },
  };
}, {
  name: 'monsoon-twin-v1',
  version: 1,
  storage: storage as PersistStorage<any>,
  partialize: (s) => ({
    config: s.config, pumps: s.pumps, rainfall: s.rainfall, thresholds: s.thresholds, twin: s.twin, sim: s.sim, history: s.history,
    runId: s.runId, speed: s.speed, alertLog: s.alertLog.slice(0, 300), audit: s.audit.slice(0, 800), readings: s.readings,
    savedConfigs: s.savedConfigs, runs: s.runs, navLog: s.navLog,
  }) as any,
  onRehydrateStorage: () => (st) => { st?.recompute(); },
}));

/** Effective capacity helper for UI. */
export const effCap = (p: Pump, cfg: EngineeringConfig) => effectiveCapacity(p, cfg);
