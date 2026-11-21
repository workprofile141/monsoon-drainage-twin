import { useStore } from '../store/store';
import type { SumpId } from '../engine/types';
import { SUMP_IDS } from '../engine/types';
import { sumpSeverity, type Severity } from '../engine/alerts';
import { sumpDims, levelAtVolume } from '../engine/geometry';
import { levelsFor } from '../engine/prediction';
import { simClock } from './format';

export function useSumpView(id: SumpId) {
  const config = useStore((s) => s.config);
  const sim = useStore((s) => s.sim);
  const derived = useStore((s) => s.derived);
  const thresholds = useStore((s) => s.thresholds);
  const pumps = useStore((s) => s.pumps);
  return sumpView(id, { config, sim, derived, thresholds, pumps });
}

export function sumpView(id: SumpId, s: Pick<ReturnType<typeof useStore.getState>, 'config' | 'sim' | 'derived' | 'thresholds' | 'pumps'>) {
  const sc = s.config.sumps[id];
  const V = s.sim.volumes[id];
  const cap = sc.existingCapacity;
  const util = cap > 0 ? (V / cap) * 100 : 0;
  const live = s.derived.live;
  const rates = live?.rates[id];
  const analytic = live?.analytic[id];
  const severity: Severity = sumpSeverity(s.derived.alerts, id);
  const dims = sumpDims(sc);
  const level = levelAtVolume(dims, V);
  const L = levelsFor(s.thresholds, id);
  const emptyAt = analytic?.tEmpty != null ? simClock(s.sim.startISO, s.sim.t + analytic.tEmpty) : null;
  const pumps = s.pumps.pumps.filter((p) => p.sumpId === id);
  return {
    id, name: sc.name, V, cap, util, rates, analytic, severity, dims, level, levels: L, emptyAt, pumps,
    constant: live?.constant.perSump[id], forecast: live?.forecast.perSump[id],
    available: Math.max(0, cap - V),
    statusText: analytic ? ({ emptying: 'Emptying', balanced: 'Balanced (holding)', filling: 'Filling', empty: 'Empty' } as const)[analytic.state] : '—',
  };
}

export const useAllSumpViews = () => {
  const config = useStore((s) => s.config);
  const sim = useStore((s) => s.sim);
  const derived = useStore((s) => s.derived);
  const thresholds = useStore((s) => s.thresholds);
  const pumps = useStore((s) => s.pumps);
  return SUMP_IDS.map((id) => sumpView(id, { config, sim, derived, thresholds, pumps }));
};
