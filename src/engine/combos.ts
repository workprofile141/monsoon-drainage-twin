/**
 * PUMP COMBINATION ANALYSIS (advisory only — this application never operates pumps).
 * Enumerates combinations of serviceable pumps (ON / OFF / STANDBY) at one sump and identifies
 * those whose effective capacity controls the current inflow and the forecast peak inflow.
 */
import type { Ctx, SumpId, Pump } from './types';
import { effectiveCapacity, isServiceable, pumpsNeeded } from './pumps';

export interface Combo {
  pumpIds: string[];
  tags: string[];
  capEff: number;
  marginNow: number;
  meetsCurrent: boolean;
  meetsPeak: boolean;
  switchesNeeded: number; // status changes relative to the present arrangement
}

export interface ComboAnalysis {
  sumpId: SumpId;
  candidates: Pump[];
  qInNow: number;
  qInPeak: number;
  maxCapEff: number;
  combos: Combo[]; // best first, limited
  minimalCurrent: Combo | null;
  minimalPeak: Combo | null;
  extraPumpsNow: number; // reference pumps needed beyond all serviceable pumps
  extraPumpsPeak: number;
  note: string | null;
  enumerated: number;
}

export function analyseCombinations(ctx: Ctx, id: SumpId, qInNow: number, qInPeak: number, limit = 40): ComboAnalysis {
  const candidates = ctx.pumps.pumps.filter((p) => p.sumpId === id && isServiceable(p));
  const caps = candidates.map((p) => effectiveCapacity(p, ctx.config).value);
  const maxCapEff = caps.reduce((a, b) => a + b, 0);
  const n = candidates.length;
  const combos: Combo[] = [];
  let note: string | null = null;
  if (!ctx.pumps.power[id]) note = 'Power is unavailable at this sump: no combination can run until power is restored.';
  const make = (mask: number[]): Combo => {
    const set = new Set(mask);
    let cap = 0;
    mask.forEach((i) => (cap += caps[i]));
    let switches = 0;
    candidates.forEach((p, i) => { if (set.has(i) !== (p.status === 'ON')) switches++; });
    return {
      pumpIds: mask.map((i) => candidates[i].id), tags: mask.map((i) => candidates[i].tag), capEff: cap,
      marginNow: cap - qInNow, meetsCurrent: cap >= qInNow - 1e-9 && cap > 0, meetsPeak: cap >= qInPeak - 1e-9 && cap > 0, switchesNeeded: switches,
    };
  };
  let enumerated = 0;
  if (n <= 14) {
    for (let m = 1; m < 1 << n; m++) {
      const idx: number[] = [];
      for (let i = 0; i < n; i++) if (m & (1 << i)) idx.push(i);
      combos.push(make(idx));
      enumerated++;
    }
  } else {
    // greedy by capacity for large fleets
    const order = caps.map((c, i) => [c, i]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
    for (let k = 1; k <= n; k++) { combos.push(make(order.slice(0, k))); enumerated++; }
    note = (note ? note + ' ' : '') + 'More than 14 serviceable pumps: greedy (largest-first) combinations shown.';
  }
  const rank = (a: Combo, b: Combo) =>
    Number(b.meetsPeak) - Number(a.meetsPeak) || Number(b.meetsCurrent) - Number(a.meetsCurrent) ||
    a.pumpIds.length - b.pumpIds.length || a.switchesNeeded - b.switchesNeeded || a.capEff - b.capEff;
  const feasibleNow = combos.filter((c) => c.meetsCurrent).sort((a, b) => a.pumpIds.length - b.pumpIds.length || a.switchesNeeded - b.switchesNeeded || a.capEff - b.capEff);
  const feasiblePeak = combos.filter((c) => c.meetsPeak).sort((a, b) => a.pumpIds.length - b.pumpIds.length || a.switchesNeeded - b.switchesNeeded || a.capEff - b.capEff);
  combos.sort(rank);
  return {
    sumpId: id, candidates, qInNow, qInPeak, maxCapEff,
    combos: combos.slice(0, limit),
    minimalCurrent: feasibleNow[0] ?? null,
    minimalPeak: feasiblePeak[0] ?? null,
    extraPumpsNow: pumpsNeeded(qInNow - maxCapEff, ctx.config),
    extraPumpsPeak: pumpsNeeded(qInPeak - maxCapEff, ctx.config),
    note, enumerated,
  };
}
