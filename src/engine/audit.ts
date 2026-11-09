import type { Project } from '../model/types';
import { buildGraph, pathTo, search, type Graph } from './graph';
import { distanceToExits } from './routing';

export type Severity = 'critical' | 'warning' | 'info';

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Node or edge ids to highlight. */
  nodes: string[];
  edges: string[];
}

export interface RoomPlan {
  nodeId: string;
  name: string;
  floor: string;
  occupants: number;
  primary: { exit: string; distance: number; time: number; via: string[] } | null;
  secondary: { exit: string; distance: number; time: number; via: string[] } | null;
}

export interface AuditResult {
  score: number;
  findings: Finding[];
  rooms: RoomPlan[];
  stats: {
    rooms: number;
    exits: number;
    occupants: number;
    exitWidth: number;
    flowTime: number;
    maxTravel: number;
  };
}

const fmt = (m: number) => `${m.toFixed(1)} m`;

/** Shortest route from `start` to any exit, optionally avoiding a set of nodes. */
function bestExitRoute(g: Graph, start: number, avoid?: Set<number>) {
  const res = search(
    g,
    [{ node: start, d: 0 }],
    (e, _ei, _f, to, d) => (avoid?.has(to) ? Infinity : d + e.len),
    (v) => v !== start && g.kind[v] === 'exit',
  );
  if (res.reached < 0) return null;
  return { exit: res.reached, distance: res.dist[res.reached], path: pathTo(res.prev, res.reached) };
}

/**
 * Static code-style checks on the plan. Thresholds come from project settings
 * so a consultant can align them with the local fire code.
 */
export function auditProject(p: Project): AuditResult {
  const g = buildGraph(p);
  const s = p.settings;
  const findings: Finding[] = [];
  const floorName = (i: number) => p.floors[i]?.name ?? '';
  const exits = [...Array(g.n).keys()].filter((v) => g.kind[v] === 'exit');
  const rooms = [...Array(g.n).keys()].filter((v) => g.kind[v] === 'room');
  const occupants = g.occupants.reduce((a, b) => a + b, 0);

  if (g.n === 0) {
    return {
      score: 0,
      findings: [{ id: 'empty', severity: 'info', title: 'The plan is empty', detail: 'Add rooms, corridors and exits in Design.', nodes: [], edges: [] }],
      rooms: [],
      stats: { rooms: 0, exits: 0, occupants: 0, exitWidth: 0, flowTime: 0, maxTravel: 0 },
    };
  }

  if (exits.length === 0) {
    findings.push({ id: 'no-exit', severity: 'critical', title: 'No exits', detail: 'The building has no exit. Mark at least two final exits.', nodes: [], edges: [] });
  } else if (exits.length === 1 && occupants > 60) {
    findings.push({
      id: 'one-exit',
      severity: 'critical',
      title: 'Single exit for more than 60 people',
      detail: `${occupants} occupants depend on one exit. Most codes require two independent exits above 60 people.`,
      nodes: [g.ids[exits[0]]],
      edges: [],
    });
  }

  // Travel distance and reachability.
  const { dist } = distanceToExits(g);
  const unreachable: number[] = [];
  const tooFar: number[] = [];
  let maxTravel = 0;
  for (const v of rooms) {
    if (dist[v] === Infinity) unreachable.push(v);
    else {
      maxTravel = Math.max(maxTravel, dist[v]);
      if (dist[v] > s.maxTravelDistance) tooFar.push(v);
    }
  }
  if (unreachable.length && exits.length) {
    findings.push({
      id: 'unreachable',
      severity: 'critical',
      title: `${unreachable.length} room${unreachable.length > 1 ? 's have' : ' has'} no route to an exit`,
      detail: unreachable.map((v) => g.names[v]).join(', '),
      nodes: unreachable.map((v) => g.ids[v]),
      edges: [],
    });
  }
  for (const v of tooFar) {
    findings.push({
      id: `travel-${g.ids[v]}`,
      severity: 'warning',
      title: `Travel distance from ${g.names[v]} is ${fmt(dist[v])}`,
      detail: `Limit is ${fmt(s.maxTravelDistance)}. Add an exit closer to ${floorName(g.floor[v])} or shorten the route.`,
      nodes: [g.ids[v]],
      edges: [],
    });
  }

  // Single points of failure: one blocked node or exit cuts rooms off from every exit.
  const baseReach = new Set(rooms.filter((v) => dist[v] < Infinity));
  for (let x = 0; x < g.n; x++) {
    // Removing a leaf cannot cut anyone else off, except when the leaf is an exit.
    if (g.kind[x] !== 'exit' && g.adj[x].length < 2) continue;
    const blocked = new Uint8Array(g.n);
    blocked[x] = 1;
    const d2 = distanceToExits(g, blocked).dist;
    // A room that opens straight onto x has one door; that is a per-room matter,
    // not a building chokepoint, so only count rooms further away.
    const cut = [...baseReach].filter((v) => v !== x && d2[v] === Infinity && !g.adj[v].some((l) => l.to === x));
    if (cut.length) {
      const people = cut.reduce((a, v) => a + g.occupants[v], 0);
      findings.push({
        id: `spof-${g.ids[x]}`,
        severity: people > 0 ? 'critical' : 'warning',
        title: `${g.names[x]} is a single point of failure`,
        detail: `If ${g.names[x]} is lost, ${cut.length} room${cut.length > 1 ? 's' : ''} (${people} people) have no way out: ${cut
          .slice(0, 8)
          .map((v) => g.names[v])
          .join(', ')}${cut.length > 8 ? '…' : ''}.`,
        nodes: [g.ids[x], ...cut.map((v) => g.ids[v])],
        edges: [],
      });
    }
  }

  // Dead ends: non-exit corridor points with one connection.
  for (let v = 0; v < g.n; v++) {
    if (g.kind[v] === 'corridor' && g.adj[v].length === 1) {
      findings.push({
        id: `deadend-${g.ids[v]}`,
        severity: 'warning',
        title: `Dead-end corridor at ${g.names[v]}`,
        detail: 'People who walk in must turn back. Connect it onward or remove it.',
        nodes: [g.ids[v]],
        edges: [],
      });
    }
    if (g.adj[v].length === 0) {
      findings.push({
        id: `isolated-${g.ids[v]}`,
        severity: g.kind[v] === 'room' ? 'critical' : 'warning',
        title: `${g.names[v]} is not connected`,
        detail: 'Connect it to the plan with the Connect tool.',
        nodes: [g.ids[v]],
        edges: [],
      });
    }
  }

  // Narrow connections.
  for (const e of g.edges) {
    if (e.width < s.minWidth) {
      findings.push({
        id: `narrow-${e.id}`,
        severity: 'warning',
        title: `${g.names[e.a]} – ${g.names[e.b]} is ${e.width.toFixed(2)} m wide`,
        detail: `Minimum escape width is ${s.minWidth.toFixed(2)} m.`,
        nodes: [],
        edges: [e.id],
      });
    }
  }

  // Exit capacity: time to pass everyone through the final exits.
  let exitWidth = 0;
  for (const v of exits) exitWidth += g.adj[v].reduce((m, { e }) => Math.max(m, g.edges[e].width), 0);
  const flowTime = exitWidth > 0 ? occupants / (exitWidth * s.flowRate) : Infinity;
  if (exits.length && flowTime > s.targetEvacTime) {
    findings.push({
      id: 'capacity',
      severity: 'warning',
      title: `Exits need ${Math.ceil(flowTime)} s to discharge ${occupants} people`,
      detail: `Target is ${s.targetEvacTime} s. Add ${((occupants / (s.targetEvacTime * s.flowRate)) - exitWidth).toFixed(1)} m of exit width.`,
      nodes: exits.map((v) => g.ids[v]),
      edges: [],
    });
  }

  // Floors without a way down or out.
  p.floors.forEach((f, i) => {
    const onFloor = [...Array(g.n).keys()].filter((v) => g.floor[v] === i);
    if (onFloor.some((v) => g.kind[v] === 'room') && !onFloor.some((v) => g.kind[v] === 'exit' || g.kind[v] === 'stair')) {
      findings.push({ id: `floor-${f.id}`, severity: 'critical', title: `${f.name} has no exit or stair`, detail: 'Add an exit or a stair linked to another floor.', nodes: [], edges: [] });
    }
  });

  // Room evacuation plans: primary route and an alternative that avoids the primary exit.
  const roomPlans: RoomPlan[] = rooms.map((v) => {
    const time = (d: number) => d / s.walkSpeed;
    const toPlan = (r: NonNullable<ReturnType<typeof bestExitRoute>>) => ({
      exit: g.names[r.exit],
      distance: r.distance,
      time: time(r.distance),
      via: r.path.slice(1, -1).map((n) => g.names[n]),
    });
    const primary = bestExitRoute(g, v);
    let secondary = null;
    if (primary) {
      // Avoid the primary exit and the first node after the room, to find a truly different way out.
      const avoid = new Set<number>([primary.exit]);
      if (primary.path.length > 2) avoid.add(primary.path[1]);
      secondary = bestExitRoute(g, v, avoid) ?? bestExitRoute(g, v, new Set([primary.exit]));
    }
    return {
      nodeId: g.ids[v],
      name: g.names[v],
      floor: floorName(g.floor[v]),
      occupants: g.occupants[v],
      primary: primary ? toPlan(primary) : null,
      secondary: secondary ? toPlan(secondary) : null,
    };
  });
  const singleRoute = roomPlans.filter((r) => r.primary && !r.secondary && r.occupants > 0);
  if (singleRoute.length) {
    findings.push({
      id: 'single-route',
      severity: 'info',
      title: `${singleRoute.length} room${singleRoute.length > 1 ? 's have' : ' has'} only one way out`,
      detail: singleRoute.map((r) => r.name).slice(0, 12).join(', ') + (singleRoute.length > 12 ? '…' : ''),
      nodes: singleRoute.map((r) => r.nodeId),
      edges: [],
    });
  }

  const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const critical = findings.filter((f) => f.severity === 'critical').length;
  const warning = findings.filter((f) => f.severity === 'warning').length;
  const score = Math.max(0, Math.min(100, Math.round(100 - critical * 20 - warning * 5)));

  return {
    score,
    findings,
    rooms: roomPlans,
    stats: { rooms: rooms.length, exits: exits.length, occupants, exitWidth, flowTime, maxTravel },
  };
}
