import type { Scenario, Settings } from '../model/types';
import { search, type Graph } from './graph';

export interface Hazard {
  /** Time fire reaches each node (Infinity: never). */
  fire: Float64Array;
  /** Time smoke reaches each node (always <= fire). */
  smoke: Float64Array;
}

/**
 * Fire and smoke spread along connections at fixed rates. A fire door holds
 * both back for its rating. People-only obstructions do not stop spread.
 * Smoke reaching a node is also the occupants' cue to leave.
 */
export function computeHazard(g: Graph, scenario: Scenario, s: Settings): Hazard {
  const sources = scenario.fireSources
    .map((f) => ({ node: g.index.get(f.nodeId) ?? -1, d: f.time }))
    .filter((f) => f.node >= 0);
  const fireSpeed = s.fireSpreadRate / 60;
  const smokeSpeed = s.smokeSpreadRate / 60;
  // Smoke leaves the fire room at ignition; flames take hold after flashover.
  const fireSources = sources.map((f) => ({ node: f.node, d: f.d + s.flashover }));
  const fire = search(g, fireSources, (e, _i, _f, _t, d) => d + e.len / fireSpeed + e.doorDelay).dist;
  const smokeRaw = search(g, sources, (e, _i, _f, _t, d) => d + e.len / smokeSpeed + e.doorDelay).dist;
  const smoke = smokeRaw.map((v, i) => Math.min(v, fire[i]));
  return { fire, smoke };
}

export type HazardState = 0 | 1 | 2; // clear, smoke, fire

export function hazardAt(h: Hazard, node: number, t: number): HazardState {
  if (h.fire[node] <= t) return 2;
  if (h.smoke[node] <= t) return 1;
  return 0;
}
