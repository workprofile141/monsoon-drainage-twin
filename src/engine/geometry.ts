/**
 * SUMP GEOMETRY — volume ↔ level for a prismoidal pit with uniform side slopes.
 *   V(h) = L·W·h + s·h²·(L + W) + (4/3)·s²·h³
 * L, W = bottom length/width, s = side slope (H:V), h = water depth above floor.
 * In 'derived' mode the bottom size is solved so V(usableDepth) = configured usable capacity.
 * That layout is CONCEPTUAL (not surveyed) and is labelled as such in the UI.
 */
import type { SumpConfig } from './types';

export interface Dims { L: number; W: number; s: number; usableDepth: number; freeboard: number; capacity: number; geometricCapacity: number; derived: boolean }

export function volumeAt(L: number, W: number, s: number, h: number): number {
  const hh = Math.max(0, h);
  return L * W * hh + s * hh * hh * (L + W) + (4 / 3) * s * s * hh * hh * hh;
}

export function sumpDims(sc: SumpConfig): Dims {
  const g = sc.geometry;
  const h = Math.max(0.1, g.usableDepthM);
  const s = Math.max(0, g.sideSlope);
  let L: number, W: number;
  if (g.mode === 'manual' && g.bottomLengthM > 0 && g.bottomWidthM > 0) {
    L = g.bottomLengthM; W = g.bottomWidthM;
  } else {
    // W = L / a  →  (h/a)L² + s h² (1 + 1/a) L + (4/3)s² h³ − C = 0
    const a = Math.max(0.1, g.aspect);
    const A = h / a;
    const B = s * h * h * (1 + 1 / a);
    const C0 = (4 / 3) * s * s * h * h * h - Math.max(0, sc.existingCapacity);
    const disc = B * B - 4 * A * C0;
    L = Math.max(1, (-B + Math.sqrt(Math.max(0, disc))) / (2 * A));
    W = L / a;
  }
  return {
    L, W, s, usableDepth: h, freeboard: Math.max(0, g.freeboardM),
    capacity: sc.existingCapacity,
    geometricCapacity: volumeAt(L, W, s, h),
    derived: !(g.mode === 'manual' && g.bottomLengthM > 0 && g.bottomWidthM > 0),
  };
}

/** Water level (m above sump floor) for a stored volume — bisection on the monotonic V(h). */
export function levelAtVolume(d: Dims, V: number): number {
  if (V <= 0) return 0;
  const maxH = d.usableDepth + d.freeboard;
  if (V >= volumeAt(d.L, d.W, d.s, maxH)) return maxH;
  let lo = 0, hi = maxH;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (volumeAt(d.L, d.W, d.s, mid) < V) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export const levelAtPct = (d: Dims, pct: number) => levelAtVolume(d, (pct / 100) * d.capacity);

/** Top dimensions of the water surface at level h (used by the 3D model). */
export function surfaceAt(d: Dims, h: number) {
  return { length: d.L + 2 * d.s * h, width: d.W + 2 * d.s * h };
}
