/**
 * RAINFALL ENGINE.
 * Distinguishes:
 *  - instantaneous intensity (mm/hr) at simulation time t       → rainfallAt()
 *  - accumulated depth (mm) over an interval                   → depthBetween()
 *  - forecast rainfall (timeline + scheduled events) for t ≥ now → forecastAt()
 */
import type { RainfallInputs, TimelineEntry, RainFn } from './types';

export const TIMELINE_LENGTH_H = 24;

export function sortedTimeline(tl: TimelineEntry[]): TimelineEntry[] {
  return [...tl].filter((e) => Number.isFinite(e.hour) && Number.isFinite(e.intensity)).sort((a, b) => a.hour - b.hour);
}

/** Piecewise-constant timeline value at simulation hour t (T+0 = simulation start). */
export function timelineAt(r: RainfallInputs, t: number): number {
  const tl = sortedTimeline(r.timeline);
  if (tl.length === 0) return 0;
  let tt = t;
  if (t >= TIMELINE_LENGTH_H) {
    if (r.timelineAfter === 'zero') return 0;
    if (r.timelineAfter === 'hold') return Math.max(0, tl[tl.length - 1].intensity);
    tt = t % TIMELINE_LENGTH_H;
  }
  if (tt < tl[0].hour) return 0;
  let v = 0;
  for (const e of tl) {
    if (e.hour <= tt + 1e-9) v = e.intensity;
    else break;
  }
  return Math.max(0, v);
}

export function eventsAt(r: RainfallInputs, t: number): number {
  let s = 0;
  for (const e of r.events) if (t >= e.startH - 1e-9 && t < e.startH + e.durationH - 1e-9) s += Math.max(0, e.intensity);
  return s;
}

/** Base intensity the live simulation uses (manual or timeline) — without events. */
export function baseAt(r: RainfallInputs, t: number): number {
  if (r.mode === 'manual') {
    if (r.manualDurationH != null && t >= r.manualStartH + r.manualDurationH - 1e-9) return 0;
    return Math.max(0, r.manualIntensity);
  }
  return timelineAt(r, t);
}

/** Instantaneous rainfall intensity (mm/hr) that drives the live simulation. */
export function rainfallAt(r: RainfallInputs, t: number): number {
  return baseAt(r, t) + eventsAt(r, t);
}

/** Configured forecast = timeline profile + scheduled events (independent of manual override). */
export function forecastAt(r: RainfallInputs, t: number): number {
  return timelineAt(r, t) + eventsAt(r, t);
}

export const liveRainFn = (r: RainfallInputs): RainFn => (t) => rainfallAt(r, t);
export const forecastRainFn = (r: RainfallInputs): RainFn => (t) => forecastAt(r, t);
export const constantRainFn = (i: number): RainFn => () => Math.max(0, i);

/** Depth (mm) between t0 and t1 by numerical integration at 1-minute resolution. */
export function depthBetween(fn: RainFn, t0: number, t1: number, stepH = 1 / 60): number {
  let d = 0;
  for (let t = t0; t < t1 - 1e-9; t += stepH) d += fn(t) * Math.min(stepH, t1 - t);
  return d;
}

export const mmDayToMmHr = (mmDay: number) => mmDay / 24;
export const mmHrToMmDay = (mmHr: number) => mmHr * 24;

export interface RainOutlook {
  raining: boolean;
  intensity: number;
  /** true when the live source keeps raining for the whole look-ahead window */
  continuous: boolean;
  stopsInH: number | null; // when raining: hours until intensity first reaches 0
  startsInH: number | null; // when dry: hours until rain is next expected
  lookAheadH: number;
  manualIndefinite: boolean; // manual rain with no end time set
}

/** Plain-language rainfall outlook from the live rainfall source (manual or timeline + events). */
export function rainOutlook(r: RainfallInputs, t: number, lookAheadH = 48): RainOutlook {
  const fn = liveRainFn(r);
  const I = fn(t);
  const step = 5 / 60;
  let stopsInH: number | null = null, startsInH: number | null = null;
  for (let dt = step; dt <= lookAheadH + 1e-9; dt += step) {
    const v = fn(t + dt);
    if (I > 0 && v <= 0 && stopsInH == null) { stopsInH = dt; break; }
    if (I <= 0 && v > 0 && startsInH == null) { startsInH = dt; break; }
  }
  return {
    raining: I > 0, intensity: I, continuous: I > 0 && stopsInH == null, stopsInH, startsInH, lookAheadH,
    manualIndefinite: r.mode === 'manual' && r.manualDurationH == null,
  };
}
