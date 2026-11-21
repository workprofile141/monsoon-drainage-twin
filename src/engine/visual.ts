/**
 * Mapping from calculated sump state → 3D scene geometry. The 3D model ONLY uses this
 * function to size the water body, so the rendered water level is the geometric level
 * derived from the simulated volume (TEST 10).
 */
import { levelAtVolume, levelAtPct, surfaceAt, type Dims } from './geometry';

export const SCENE_H_SCALE = 1 / 20; // 1 scene unit = 20 m horizontally
export const SCENE_V_SCALE = 1 / 2.5; // 1 scene unit = 2.5 m vertically
export const VERTICAL_EXAGGERATION = SCENE_V_SCALE / SCENE_H_SCALE;

export interface WaterVisual {
  levelM: number;
  surfaceLengthM: number;
  surfaceWidthM: number;
  util: number;
  sceneLevel: number; // scene units above sump floor
  sceneSurfaceL: number;
  sceneSurfaceW: number;
}

export function waterVisual(d: Dims, V: number): WaterVisual {
  const levelM = levelAtVolume(d, V);
  const s = surfaceAt(d, levelM);
  return {
    levelM, surfaceLengthM: s.length, surfaceWidthM: s.width,
    util: d.capacity > 0 ? V / d.capacity : 0,
    sceneLevel: levelM * SCENE_V_SCALE,
    sceneSurfaceL: s.length * SCENE_H_SCALE,
    sceneSurfaceW: s.width * SCENE_H_SCALE,
  };
}

export function markerLevels(d: Dims, warnPct: number, critPct: number) {
  return {
    warnM: levelAtPct(d, warnPct),
    critM: levelAtPct(d, critPct),
    maxM: d.usableDepth, // max usable = spill / overflow level
    rimM: d.usableDepth + d.freeboard,
  };
}
