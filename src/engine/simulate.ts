import { activeScenario } from '../model/project';
import type { Project, Scenario } from '../model/types';
import { buildGraph, type Graph } from './graph';
import { computeHazard, type Hazard } from './hazard';
import { blockedMasks, planRoute, type RouteContext, type RouteKind } from './routing';

export const AgentState = {
  Waiting: 0,
  Moving: 1,
  Queued: 2,
  Evacuated: 3,
  Sheltered: 4,
  Trapped: 5,
  Stranded: 6,
} as const;
export type AgentStateValue = (typeof AgentState)[keyof typeof AgentState];

export interface Frame {
  t: number;
  /** x0, y0, x1, y1, ... plan coordinates */
  xy: Float32Array;
  floor: Uint8Array;
  state: Uint8Array;
}

export interface AgentOutcome {
  origin: string;
  start: number;
  end: number;
  state: AgentStateValue;
  exit: string | null;
  smokeTime: number;
  distance: number;
  routeKind: RouteKind;
}

export interface SimSummary {
  total: number;
  evacuated: number;
  sheltered: number;
  trapped: number;
  stranded: number;
  /** Time the last person reached an exit or refuge. */
  totalTime: number;
  meanTime: number;
  p95Time: number;
  peopleInSmoke: number;
  maxSmokeTime: number;
  exits: { id: string; name: string; count: number; last: number }[];
  bottlenecks: { id: string; label: string; peakQueue: number; throughput: number }[];
  /** Cumulative evacuated + sheltered per second. */
  curve: number[];
  endTime: number;
}

export interface SimResult {
  scenarioId: string;
  /** Node ids in the index order used by fire, smoke and agent origins. */
  nodeIds: string[];
  frameStep: number;
  frames: Frame[];
  agents: AgentOutcome[];
  summary: SimSummary;
  fire: number[];
  smoke: number[];
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Agent {
  origin: number;
  node: number;
  edge: number;
  from: number;
  to: number;
  prog: number;
  route: number[];
  routeKind: RouteKind;
  state: AgentStateValue;
  start: number;
  end: number;
  nextReplan: number;
  smokeTime: number;
  distance: number;
  exit: number;
}

const DT = 0.25;
const FRAME_STEP = 1;
const MAX_TIME = 3600;
const REPLAN_WHILE_QUEUED = 8;

const terminal = (s: AgentStateValue) => s === AgentState.Evacuated || s === AgentState.Trapped;

export function simulate(project: Project, scenario: Scenario = activeScenario(project)): SimResult {
  const g = buildGraph(project);
  const s = project.settings;
  const hazard = computeHazard(g, scenario, s);
  const { bn, be } = blockedMasks(g, scenario.blockedNodes, scenario.blockedEdges);
  const rng = mulberry32(scenario.seed || 1);

  const edgeNext = new Float64Array(g.edges.length);
  const queueNow = new Int32Array(g.edges.length);
  const peakQueue = new Int32Array(g.edges.length);
  const throughput = new Int32Array(g.edges.length);

  const ctx: RouteContext = {
    g,
    hazard,
    settings: s,
    blockedNodes: bn,
    blockedEdges: be,
    wait: (ei, at) => (at <= t + 5 ? Math.max(0, edgeNext[ei] - at) : 0),
  };

  const agents: Agent[] = [];
  for (let v = 0; v < g.n; v++) {
    for (let k = 0; k < g.occupants[v]; k++) {
      agents.push({
        origin: v,
        node: v,
        edge: -1,
        from: v,
        to: v,
        prog: 0,
        route: [],
        routeKind: 'safe',
        state: AgentState.Waiting,
        // People leave at once when smoke reaches them, whatever the alarm says.
        start: Math.min(s.preMovement + rng() * s.preMovementSpread, hazard.smoke[v]),
        end: Infinity,
        nextReplan: 0,
        smokeTime: 0,
        distance: 0,
        exit: -1,
      });
    }
  }

  const frames: Frame[] = [];
  const record = (time: number) => {
    const n = agents.length;
    const f: Frame = { t: time, xy: new Float32Array(n * 2), floor: new Uint8Array(n), state: new Uint8Array(n) };
    for (let i = 0; i < n; i++) {
      const a = agents[i];
      let x: number;
      let y: number;
      let fl: number;
      if (a.edge >= 0) {
        const len = g.edges[a.edge].len;
        const r = len > 0 ? Math.min(1, a.prog / len) : 1;
        x = g.x[a.from] + (g.x[a.to] - g.x[a.from]) * r;
        y = g.y[a.from] + (g.y[a.to] - g.y[a.from]) * r;
        fl = r < 0.5 ? g.floor[a.from] : g.floor[a.to];
      } else {
        x = g.x[a.node];
        y = g.y[a.node];
        fl = g.floor[a.node];
      }
      f.xy[2 * i] = x;
      f.xy[2 * i + 1] = y;
      f.floor[i] = fl;
      f.state[i] = a.state;
    }
    frames.push(f);
  };

  let t = 0;
  let routeCache = new Map<number, ReturnType<typeof planRoute>>();
  const replan = (a: Agent) => {
    let r = routeCache.get(a.node);
    if (!r) {
      r = planRoute(ctx, a.node, t);
      routeCache.set(a.node, r);
    }
    a.route = r.path.slice(1);
    a.routeKind = r.kind;
    a.nextReplan = t + REPLAN_WHILE_QUEUED;
    if (r.kind === 'none') a.state = AgentState.Stranded;
  };

  record(0);
  while (t < MAX_TIME) {
    routeCache = new Map();
    queueNow.fill(0);
    let active = 0;

    for (const a of agents) {
      if (terminal(a.state)) continue;

      if (a.edge >= 0) {
        // Walking along a connection.
        if (hazard.fire[a.to] <= t) {
          if (hazard.fire[a.from] <= t) {
            a.state = AgentState.Trapped;
            a.end = t;
            continue;
          }
          // Destination is burning: turn back and choose again.
          const len = g.edges[a.edge].len;
          [a.from, a.to] = [a.to, a.from];
          a.prog = len - a.prog;
          a.route = [a.to];
        }
        const smoky = hazard.smoke[a.from] <= t || hazard.smoke[a.to] <= t;
        const e = g.edges[a.edge];
        const len = e.len;
        a.prog += s.walkSpeed * (e.stair ? s.stairSpeedFactor : 1) * (smoky ? s.smokeSpeedFactor : 1) * DT;
        if (smoky) a.smokeTime += DT;
        if (a.prog >= len) {
          a.distance += len;
          a.node = a.to;
          a.edge = -1;
          if (a.route[0] === a.node) a.route.shift();
        }
        active++;
        continue;
      }

      // At a node.
      const v = a.node;
      if (hazard.fire[v] <= t && g.kind[v] !== 'exit') {
        a.state = AgentState.Trapped;
        a.end = t;
        continue;
      }
      if (hazard.smoke[v] <= t && a.state !== AgentState.Sheltered) a.smokeTime += DT;
      if (a.state === AgentState.Waiting) {
        if (t < a.start) {
          active++;
          continue;
        }
        a.state = AgentState.Queued;
      }
      if (g.kind[v] === 'exit') {
        a.state = AgentState.Evacuated;
        a.end = t;
        a.exit = v;
        continue;
      }
      if (a.state === AgentState.Sheltered) {
        // Stay in the refuge, but leave if a safe exit route opens.
        if (t >= a.nextReplan) {
          const r = planRoute(ctx, v, t);
          a.nextReplan = t + REPLAN_WHILE_QUEUED;
          if (r.kind === 'safe') {
            a.route = r.path.slice(1);
            a.routeKind = 'safe';
            a.state = AgentState.Queued;
          }
        }
        if (a.state === AgentState.Sheltered) {
          if (hazard.fire[v] < Infinity) active++;
          continue;
        }
      }
      if (g.kind[v] === 'refuge' && a.routeKind !== 'safe' && a.route.length === 0) {
        a.state = AgentState.Sheltered;
        if (a.end === Infinity) a.end = t;
        a.exit = v;
        a.nextReplan = t + REPLAN_WHILE_QUEUED;
        if (hazard.fire[v] < Infinity) active++;
        continue;
      }

      const next = a.route[0];
      const stale =
        next === undefined ||
        bn[next] === 1 ||
        hazard.fire[next] <= t + 1 ||
        (a.state === AgentState.Queued && t >= a.nextReplan) ||
        a.state === AgentState.Stranded;
      if (stale && (a.state !== AgentState.Stranded || t >= a.nextReplan)) {
        a.state = AgentState.Queued;
        replan(a);
      }
      if (a.state === AgentState.Stranded) {
        if (hazard.fire[v] < Infinity) active++;
        continue;
      }
      const nextNode = a.route[0];
      if (nextNode === undefined) {
        // Already at the target (refuge handled above).
        active++;
        continue;
      }
      const link = g.adj[v].find((x) => x.to === nextNode && !be[x.e]);
      if (!link) {
        a.route = [];
        active++;
        continue;
      }
      const ei = link.e;
      if (edgeNext[ei] <= t) {
        const e = g.edges[ei];
        edgeNext[ei] = Math.max(edgeNext[ei], t) + 1 / (s.flowRate * e.width);
        throughput[ei]++;
        a.edge = ei;
        a.from = v;
        a.to = nextNode;
        a.prog = 0;
        a.state = AgentState.Moving;
      } else {
        a.state = AgentState.Queued;
        queueNow[ei]++;
      }
      active++;
    }

    for (let i = 0; i < queueNow.length; i++) if (queueNow[i] > peakQueue[i]) peakQueue[i] = queueNow[i];
    t = Math.round((t + DT) * 1000) / 1000;
    if (Math.abs(t / FRAME_STEP - Math.round(t / FRAME_STEP)) < 1e-9) record(t);
    if (active === 0) break;
  }
  if (frames[frames.length - 1].t !== t) record(t);

  return {
    scenarioId: scenario.id,
    nodeIds: g.ids,
    frameStep: FRAME_STEP,
    frames,
    agents: agents.map((a) => ({
      origin: g.ids[a.origin],
      start: a.start,
      end: a.end,
      state: a.state === AgentState.Waiting || a.state === AgentState.Moving || a.state === AgentState.Queued ? AgentState.Stranded : a.state,
      exit: a.exit >= 0 ? g.ids[a.exit] : null,
      smokeTime: a.smokeTime,
      distance: a.distance,
      routeKind: a.routeKind,
    })),
    summary: summarize(g, agents, hazard, peakQueue, throughput, t),
    fire: Array.from(hazard.fire),
    smoke: Array.from(hazard.smoke),
  };
}

function summarize(g: Graph, agents: Agent[], _h: Hazard, peakQueue: Int32Array, throughput: Int32Array, endTime: number): SimSummary {
  const done = agents.filter((a) => a.state === AgentState.Evacuated || a.state === AgentState.Sheltered);
  const times = done.map((a) => a.end).sort((x, y) => x - y);
  const exits = new Map<number, { count: number; last: number }>();
  for (let v = 0; v < g.n; v++) if (g.kind[v] === 'exit' || g.kind[v] === 'refuge') exits.set(v, { count: 0, last: 0 });
  for (const a of done) {
    const e = exits.get(a.exit);
    if (e) {
      e.count++;
      e.last = Math.max(e.last, a.end);
    }
  }
  const curve: number[] = [];
  const horizon = Math.ceil(endTime);
  let j = 0;
  for (let sec = 0; sec <= horizon; sec++) {
    while (j < times.length && times[j] <= sec) j++;
    curve.push(j);
  }
  const edgeLabel = (i: number) => `${g.names[g.edges[i].a]} – ${g.names[g.edges[i].b]}`;
  const bottlenecks = [...peakQueue.keys()]
    .filter((i) => peakQueue[i] > 0)
    .sort((x, y) => peakQueue[y] - peakQueue[x])
    .slice(0, 6)
    .map((i) => ({ id: g.edges[i].id, label: edgeLabel(i), peakQueue: peakQueue[i], throughput: throughput[i] }));
  const smoked = agents.filter((a) => a.smokeTime > 0);
  return {
    total: agents.length,
    evacuated: agents.filter((a) => a.state === AgentState.Evacuated).length,
    sheltered: agents.filter((a) => a.state === AgentState.Sheltered).length,
    trapped: agents.filter((a) => a.state === AgentState.Trapped).length,
    stranded: agents.filter((a) => !terminal(a.state) && a.state !== AgentState.Sheltered).length,
    totalTime: times.length ? times[times.length - 1] : 0,
    meanTime: times.length ? times.reduce((x, y) => x + y, 0) / times.length : 0,
    p95Time: times.length ? times[Math.min(times.length - 1, Math.floor(times.length * 0.95))] : 0,
    peopleInSmoke: smoked.length,
    maxSmokeTime: smoked.reduce((m, a) => Math.max(m, a.smokeTime), 0),
    exits: [...exits.entries()]
      .map(([v, e]) => ({ id: g.ids[v], name: g.names[v], count: e.count, last: e.last }))
      .sort((x, y) => y.count - x.count),
    bottlenecks,
    curve,
    endTime,
  };
}
