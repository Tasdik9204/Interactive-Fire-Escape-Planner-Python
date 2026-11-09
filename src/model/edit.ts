import { activeScenario, uid } from './project';
import type { NodeKind, PlanEdge, PlanNode, Project, Scenario } from './types';

/** Pure project edits. Each returns a new project (or the same one when nothing changes). */

const defaultWidth = (a: NodeKind, b: NodeKind) => (a === 'room' || b === 'room' ? 0.9 : a === 'exit' || b === 'exit' ? 1.2 : 1.8);

/** The caller creates the id, so the update stays pure and the id is known up front. */
export function addNode(p: Project, node: PlanNode, connectFrom?: string): Project {
  const next: Project = { ...p, nodes: [...p.nodes, node] };
  return connectFrom ? connect(next, connectFrom, node.id) : next;
}

export function connect(p: Project, a: string, b: string): Project {
  if (a === b) return p;
  if (p.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))) return p;
  const na = p.nodes.find((n) => n.id === a);
  const nb = p.nodes.find((n) => n.id === b);
  if (!na || !nb) return p;
  return { ...p, edges: [...p.edges, { id: uid('e'), a, b, width: defaultWidth(na.kind, nb.kind) }] };
}

export function updateNodes(p: Project, ids: Set<string>, patch: Partial<Omit<PlanNode, 'id'>>): Project {
  return {
    ...p,
    nodes: p.nodes.map((n) => {
      if (!ids.has(n.id)) return n;
      const next = { ...n, ...patch };
      if (next.kind !== 'room' && next.kind !== 'corridor') next.occupants = 0;
      return next;
    }),
  };
}

export function moveNodes(p: Project, base: Map<string, { x: number; y: number }>, dx: number, dy: number): Project {
  return { ...p, nodes: p.nodes.map((n) => (base.has(n.id) ? { ...n, x: base.get(n.id)!.x + dx, y: base.get(n.id)!.y + dy } : n)) };
}

export function updateEdges(p: Project, ids: Set<string>, patch: Partial<Omit<PlanEdge, 'id' | 'a' | 'b'>>): Project {
  return {
    ...p,
    edges: p.edges.map((e) => {
      if (!ids.has(e.id)) return e;
      const next: PlanEdge = { ...e, ...patch };
      if (!next.length) delete next.length;
      if (!next.fireDoor) delete next.fireDoor;
      return next;
    }),
  };
}

function cleanScenarios(scenarios: Scenario[], nodes: Set<string>, edges: Set<string>): Scenario[] {
  return scenarios.map((s) => ({
    ...s,
    fireSources: s.fireSources.filter((f) => nodes.has(f.nodeId)),
    blockedNodes: s.blockedNodes.filter((id) => nodes.has(id)),
    blockedEdges: s.blockedEdges.filter((id) => edges.has(id)),
  }));
}

export function deleteItems(p: Project, nodeIds: Set<string>, edgeIds: Set<string>): Project {
  if (!nodeIds.size && !edgeIds.size) return p;
  const nodes = p.nodes.filter((n) => !nodeIds.has(n.id));
  const edges = p.edges.filter((e) => !edgeIds.has(e.id) && !nodeIds.has(e.a) && !nodeIds.has(e.b));
  return {
    ...p,
    nodes,
    edges,
    scenarios: cleanScenarios(p.scenarios, new Set(nodes.map((n) => n.id)), new Set(edges.map((e) => e.id))),
  };
}

export function updateScenario(p: Project, fn: (s: Scenario) => Scenario): Project {
  const cur = activeScenario(p);
  return { ...p, scenarios: p.scenarios.map((s) => (s.id === cur.id ? fn(s) : s)) };
}

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

export function toggleFire(p: Project, nodeId: string, time = 0): Project {
  return updateScenario(p, (s) => ({
    ...s,
    fireSources: s.fireSources.some((f) => f.nodeId === nodeId)
      ? s.fireSources.filter((f) => f.nodeId !== nodeId)
      : [...s.fireSources, { nodeId, time }],
  }));
}

export function toggleBlockedNode(p: Project, id: string): Project {
  return updateScenario(p, (s) => ({ ...s, blockedNodes: toggle(s.blockedNodes, id) }));
}

export function toggleBlockedEdge(p: Project, id: string): Project {
  return updateScenario(p, (s) => ({ ...s, blockedEdges: toggle(s.blockedEdges, id) }));
}

export function addFloor(p: Project, id: string, name: string): Project {
  return { ...p, floors: [...p.floors, { id, name }] };
}

export function deleteFloor(p: Project, floorId: string): Project {
  if (p.floors.length <= 1) return p;
  const gone = new Set(p.nodes.filter((n) => n.floorId === floorId).map((n) => n.id));
  const next = deleteItems(p, gone, new Set());
  return { ...next, floors: next.floors.filter((f) => f.id !== floorId) };
}

export function moveFloor(p: Project, floorId: string, dir: -1 | 1): Project {
  const i = p.floors.findIndex((f) => f.id === floorId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= p.floors.length) return p;
  const floors = [...p.floors];
  [floors[i], floors[j]] = [floors[j], floors[i]];
  return { ...p, floors };
}

/** Copy nodes (and edges among them) with an offset. `map` gives each copied node its new id. */
export function duplicateNodes(p: Project, map: Map<string, string>, offset: number): Project {
  const nodes = p.nodes
    .filter((n) => map.has(n.id))
    .map((n) => ({ ...n, id: map.get(n.id)!, x: n.x + offset, y: n.y + offset, name: n.name + ' copy' }));
  const edges = p.edges
    .filter((e) => map.has(e.a) && map.has(e.b))
    .map((e) => ({ ...e, id: `${e.id}-${map.get(e.a)}`, a: map.get(e.a)!, b: map.get(e.b)! }));
  return { ...p, nodes: [...p.nodes, ...nodes], edges: [...p.edges, ...edges] };
}
