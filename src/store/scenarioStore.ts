import { create } from 'zustand';
import { PRESET_SCENARIOS, type ScenarioSpec, type ScenarioResult } from '../engine/scenarios';

interface ScenarioState {
  specs: [ScenarioSpec, ScenarioSpec];
  results: [ScenarioResult | null, ScenarioResult | null];
  setSpec: (i: 0 | 1, s: ScenarioSpec) => void;
  setResult: (i: 0 | 1, r: ScenarioResult | null) => void;
}

/** Scenario workspace — kept in memory across page navigation (never touches live state). */
export const useScenarioStore = create<ScenarioState>((set, get) => ({
  specs: [structuredClone(PRESET_SCENARIOS[1]), structuredClone(PRESET_SCENARIOS[5])],
  results: [null, null],
  setSpec: (i, s) => { const specs = [...get().specs] as ScenarioState['specs']; specs[i] = s; set({ specs }); },
  setResult: (i, r) => { const results = [...get().results] as ScenarioState['results']; results[i] = r; set({ results }); },
}));
