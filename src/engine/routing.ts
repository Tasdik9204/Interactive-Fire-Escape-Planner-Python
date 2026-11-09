import type { Settings } from '../model/types';
import { pathTo, search, type Graph } from './graph';
import type { Hazard } from './hazard';

export type RouteKind = 'safe' | 'refuge' | 'risky' | 'none';

export interface Route {
  kind: RouteKind;
  /** Node indices from start to target. */
  path: number[];
  /** Edge indices along the path. */
  edges: number[];
  /** Arrival time at the target. */
  eta: number;
  /** Walking distance in metres. */
  distance: number;
  /** Seconds of the walk spent in smoke. */
  smokeTime: number;
}

export interface RouteContext {
  g: Graph;
  hazard: Hazard | null;
  settings: Settings;
  blockedNodes: Uint8Array;
  blockedEdges: Uint8Array;
  /** Expected wait to enter an edge at time `at` (congestion). */
  wait?: (edge: number, at: number) => number;
}

export function blockedMasks(g: Graph, blockedNodes: string[], blockedEdges: string[]) {
  const bn = new Uint8Array(g.n);
  const be = new Uint8Array(g.edges.length);
  for (const id of blockedNodes) {
    const i = g.index.get(id);
    if (i !== undefined) bn[i] = 1;
  }
  for (const id of blockedEdges) {
    const i = g.edgeIndex.get(id);
    if (i !== undefined) be[i] = 1;
  }
  return { bn, be };
}

/** Time to walk edge `ei` starting at time `d` from node `from`. */
export function walkTime(ctx: RouteContext, ei: number, from: number, d: number): number {
  const e = ctx.g.edges[ei];
  const s = ctx.settings;
  let speed = s.walkSpeed * (e.stair ? s.stairSpeedFactor : 1);
  if (ctx.hazard && ctx.hazard.smoke[from] <= d) speed *= s.smokeSpeedFactor;
  return e.len / speed;
}

function attempt(ctx: RouteContext, start: number, t0: number, margin: number, targets: (v: number) => boolean): Route | null {
  const { g, hazard, blockedNodes, blockedEdges } = ctx;
  const fire = hazard?.fire;
  const res = search(
    g,
    [{ node: start, d: t0 }],
    (_e, ei, from, to, d) => {
      if (blockedEdges[ei] || blockedNodes[to]) return Infinity;
      const at = d + (ctx.wait ? ctx.wait(ei, d) : 0);
      const arrive = at + walkTime(ctx, ei, from, at);
      if (fire && arrive + margin >= fire[to]) return Infinity;
      return arrive;
    },
    (v) => v !== start && targets(v),
  );
  if (res.reached < 0) {
    if (start >= 0 && targets(start)) return finish(ctx, [start], t0);
    return null;
  }
  return finish(ctx, pathTo(res.prev, res.reached), t0, res.dist[res.reached]);
}

function finish(ctx: RouteContext, path: number[], t0: number, eta = t0): Route {
  const edges: number[] = [];
  let distance = 0;
  let smokeTime = 0;
  let t = t0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const ei = ctx.g.adj[a].find((x) => x.to === b)!.e;
    edges.push(ei);
    distance += ctx.g.edges[ei].len;
    const dt = walkTime(ctx, ei, a, t);
    if (ctx.hazard && ctx.hazard.smoke[a] <= t) smokeTime += dt;
    t += dt;
  }
  return { kind: 'safe', path, edges, eta, distance, smokeTime };
}

/**
 * Best escape from `start` at time `t0`. Preference order:
 * a safe route to an exit, a safe route to a refuge area, the least-bad route
 * that still beats the fire, then nothing.
 * "Safe" means every node is reached `safetyMargin` seconds before fire.
 */
export function planRoute(ctx: RouteContext, start: number, t0: number): Route {
  const { g, hazard } = ctx;
  const none: Route = { kind: 'none', path: [start], edges: [], eta: Infinity, distance: 0, smokeTime: 0 };
  if (hazard && hazard.fire[start] <= t0) return none;
  const isExit = (v: number) => g.kind[v] === 'exit';
  const isRefuge = (v: number) => g.kind[v] === 'refuge';
  const margin = ctx.settings.safetyMargin;
  const steps: [RouteKind, number, (v: number) => boolean][] = [
    ['safe', margin, isExit],
    ['refuge', margin, isRefuge],
    ['risky', 0, isExit],
    ['risky', 0, isRefuge],
  ];
  for (const [kind, m, targets] of steps) {
    const r = attempt(ctx, start, t0, m, targets);
    if (r) return { ...r, kind };
  }
  return none;
}

/** Shortest walking distance (metres) from every node to its nearest exit, ignoring hazards. */
export function distanceToExits(g: Graph, blockedNodes?: Uint8Array): { dist: Float64Array; next: Int32Array } {
  const sources: { node: number; d: number }[] = [];
  for (let i = 0; i < g.n; i++) if (g.kind[i] === 'exit' && !blockedNodes?.[i]) sources.push({ node: i, d: 0 });
  const res = search(g, sources, (e, _ei, _from, to, d) => (blockedNodes?.[to] ? Infinity : d + e.len));
  // prev points toward the exit when searching from exits.
  return { dist: res.dist, next: res.prev };
}
