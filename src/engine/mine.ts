/**
 * MINE / SUMP 3D GEOMETRY MODEL (pure functions — used by the 3D twin and by tests).
 *
 * Coordinates in metres, origin at the sump centre on the pit-floor (sump rim) plane projected
 * to ground level: x = along-strike, z = across, elevation e = 0 at original ground surface.
 *
 *  - Pit footprint is DERIVED from the configured excavation area A1 (area-true, aspect configurable).
 *  - Pit depth, bench height, berm width, face angle and floor grade are ASSUMED inputs (no survey supplied).
 *  - The sump is EXACTLY the prismoid used by the water-balance engine (geometry.ts), so the rendered
 *    water body and the volume ↔ level relation are the same function.
 *  - Lithology is an editable ILLUSTRATIVE sequence until actual borehole / litholog data is entered.
 */
import type { EngineeringConfig, SumpId } from './types';
import { sumpDims, type Dims } from './geometry';

export interface LithoLayer { name: string; thicknessM: number; color: string }

export interface TwinConfig {
  sumpId: SumpId;
  pitDepthM: number; // original ground to pit floor at the sump rim
  benchHeightM: number;
  bermWidthM: number;
  faceAngleDeg: number;
  pitAspect: number; // pit length / width
  floorGradePct: number; // pit floor falls towards the sump (%)
  verticalExaggeration: number;
  marginM: number; // terrain shown beyond the pit rim
  dumpHeightM: number; // internal dump / backfill mound height (conceptual)
  layers: LithoLayer[];
}

export const ASSUMED_TWIN_FIELDS = ['pitDepthM', 'benchHeightM', 'bermWidthM', 'faceAngleDeg', 'pitAspect', 'floorGradePct', 'dumpHeightM', 'layers'] as const;

/** Illustrative Gondwana (Barakar-type) open-cast sequence — NOT Kusmunda borehole data. */
export function defaultLayers(): LithoLayer[] {
  return [
    { name: 'Topsoil & alluvium', thicknessM: 5, color: '#8a6a45' },
    { name: 'Weathered sandstone', thicknessM: 12, color: '#c9a46c' },
    { name: 'Sandstone', thicknessM: 18, color: '#dcc596' },
    { name: 'Shale / carbonaceous shale', thicknessM: 8, color: '#77716a' },
    { name: 'Coal seam (upper)', thicknessM: 12, color: '#2b2a2e' },
    { name: 'Interburden sandstone', thicknessM: 10, color: '#bb9d72' },
    { name: 'Coal seam (lower)', thicknessM: 20, color: '#1d1c20' },
    { name: 'Basal sandstone', thicknessM: 60, color: '#a58c68' },
  ];
}

export function defaultTwinConfig(): TwinConfig {
  return {
    sumpId: 'B', pitDepthM: 60, benchHeightM: 10, bermWidthM: 15, faceAngleDeg: 70, pitAspect: 1.4,
    floorGradePct: 0.5, verticalExaggeration: 2.5, marginM: 220, dumpHeightM: 30, layers: defaultLayers(),
  };
}

export interface MineModel {
  tc: TwinConfig;
  dims: Dims;
  sumpDepthM: number; // floor → rim (usable + freeboard)
  sumpFloorE: number; // elevation of the sump floor
  pitFloorE: number; // elevation of the pit floor at the sump rim (= sump rim)
  pitL: number; pitW: number; // rim footprint
  topL: number; topW: number; // sump rim footprint
  X: number; Z: number; // half extents of the terrain block (x ∈ [−X, X], z ∈ [−Z, Z])
  bottomE: number;
  elevation: (x: number, z: number) => number;
  layerAt: (depthBelowGround: number) => number; // index into tc.layers
  layerTops: number[]; // depth (m) of each layer top below ground
  dump: { x0: number; x1: number; z0: number; z1: number };
}

export function buildMineModel(cfg: EngineeringConfig, tc: TwinConfig): MineModel {
  const sc = cfg.sumps[tc.sumpId];
  const dims = sumpDims(sc);
  const sumpDepthM = dims.usableDepth + dims.freeboard;
  const topL = dims.L + 2 * dims.s * sumpDepthM, topW = dims.W + 2 * dims.s * sumpDepthM;
  const aspect = Math.max(0.2, tc.pitAspect);
  // pit rim footprint is area-true to A1, but never smaller than the sump plus the benches
  const run = tc.benchHeightM / Math.tan((Math.max(20, Math.min(89, tc.faceAngleDeg)) * Math.PI) / 180);
  const cycle = tc.bermWidthM + run;
  const benchesWidth = (Math.ceil(tc.pitDepthM / Math.max(1, tc.benchHeightM)) * cycle);
  const pitL = Math.max(Math.sqrt(sc.A1 * aspect), topL + 2 * benchesWidth + 40);
  const pitW = Math.max(Math.sqrt(sc.A1 / aspect), topW + 2 * benchesWidth + 40);
  const pitFloorE = -tc.pitDepthM;
  const sumpFloorE = pitFloorE - sumpDepthM;
  const X = pitL / 2 + tc.marginM, Z = pitW / 2 + tc.marginM;
  const grade = tc.floorGradePct / 100;
  const dump = { x0: pitL / 2 + 40, x1: X - 25, z0: -Z + 40, z1: Z - 40 };

  const benchDepth = (d: number) => {
    if (d <= 0) return 0;
    const k = Math.floor(d / cycle);
    const r = d - k * cycle;
    return k * tc.benchHeightM + Math.min(r / Math.max(run, 1e-6), 1) * tc.benchHeightM;
  };
  const elevation = (x: number, z: number) => {
    const d = Math.min(pitL / 2 - Math.abs(x), pitW / 2 - Math.abs(z)); // distance inside the pit rim
    let e = 0;
    if (d > 0) {
      const distToSump = Math.max(0, Math.max(Math.abs(x) - topL / 2, Math.abs(z) - topW / 2));
      const floorDepth = Math.max(0, tc.pitDepthM - grade * distToSump);
      e = -Math.min(benchDepth(d), floorDepth);
      // sump prismoid: depth below rim decreases by 1/s per metre outside the bottom rectangle
      const out = Math.max(0, Math.max(Math.abs(x) - dims.L / 2, Math.abs(z) - dims.W / 2));
      const dd = dims.s > 0 ? sumpDepthM - out / dims.s : (out <= 0 ? sumpDepthM : 0);
      if (dd > 0) e = Math.min(e, pitFloorE - Math.min(sumpDepthM, dd));
    } else if (x >= dump.x0 && x <= dump.x1 && z >= dump.z0 && z <= dump.z1) {
      // terraced internal-dump / backfill mound (conceptual position, not to scale)
      const dIn = Math.min(x - dump.x0, dump.x1 - x, z - dump.z0, dump.z1 - z);
      const tiers = 3, step = tc.dumpHeightM / tiers;
      e = Math.min(tc.dumpHeightM, Math.floor(dIn / 25) * step + Math.min(1, (dIn % 25) / 8) * step);
      e = Math.min(e, tc.dumpHeightM);
    }
    return e;
  };
  const layerTops: number[] = [];
  let acc = 0;
  for (const l of tc.layers) { layerTops.push(acc); acc += Math.max(0.1, l.thicknessM); }
  const layerAt = (depth: number) => {
    for (let i = layerTops.length - 1; i >= 0; i--) if (depth >= layerTops[i] - 1e-9) return i;
    return 0;
  };
  return {
    tc, dims, sumpDepthM, sumpFloorE, pitFloorE, pitL, pitW, topL, topW, X, Z,
    bottomE: sumpFloorE - 30, elevation, layerAt, layerTops, dump,
  };
}

/** Numerical volume of the sump depression below a water elevation (used to verify the 3D geometry). */
export function numericSumpVolume(m: MineModel, waterE: number, cell = 1): number {
  let v = 0;
  const hx = m.topL / 2 + cell, hz = m.topW / 2 + cell;
  for (let x = -hx + cell / 2; x < hx; x += cell) for (let z = -hz + cell / 2; z < hz; z += cell) {
    const e = m.elevation(x, z);
    if (e < waterE && e < m.pitFloorE + 1e-9) v += (Math.min(waterE, m.pitFloorE) - e) * cell * cell;
  }
  return v;
}
