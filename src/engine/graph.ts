import { edgeLength, isStairEdge, nodeMap } from '../model/project';
import type { NodeKind, Project } from '../model/types';

export interface GEdge {
  id: string;
  a: number;
  b: number;
  len: number;
  width: number;
  stair: boolean;
  /** Fire door rating in seconds (0 = none). */
  doorDelay: number;
}

/** Index-based view of a project, built once per computation. */
export interface Graph {
  n: number;
  ids: string[];
  index: Map<string, number>;
  names: string[];
  kind: NodeKind[];
  floor: number[];
  x: Float64Array;
  y: Float64Array;
  occupants: number[];
  edges: GEdge[];
  edgeIndex: Map<string, number>;
  adj: { to: number; e: number }[][];
}

export function buildGraph(p: Project): Graph {
  const nodes = nodeMap(p);
  const floorIdx = new Map(p.floors.map((f, i) => [f.id, i]));
  const n = p.nodes.length;
  const g: Graph = {
    n,
    ids: p.nodes.map((v) => v.id),
    index: new Map(p.nodes.map((v, i) => [v.id, i])),
    names: p.nodes.map((v) => v.name),
    kind: p.nodes.map((v) => v.kind),
    floor: p.nodes.map((v) => floorIdx.get(v.floorId) ?? 0),
    x: Float64Array.from(p.nodes, (v) => v.x),
    y: Float64Array.from(p.nodes, (v) => v.y),
    occupants: p.nodes.map((v) => v.occupants),
    edges: [],
    edgeIndex: new Map(),
    adj: Array.from({ length: n }, () => []),
  };
  for (const e of p.edges) {
    const a = g.index.get(e.a);
    const b = g.index.get(e.b);
    if (a === undefined || b === undefined) continue;
    const i = g.edges.length;
    g.edges.push({
      id: e.id,
      a,
      b,
      len: edgeLength(e, nodes, p.settings),
      width: e.width,
      stair: isStairEdge(e, nodes),
      doorDelay: (e.fireDoor ?? 0) * 60,
    });
    g.edgeIndex.set(e.id, i);
    g.adj[a].push({ to: b, e: i });
    g.adj[b].push({ to: a, e: i });
  }
  return g;
}

/** Binary min-heap keyed by number. */
export class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(key: number, val: number) {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  /** Returns [key, val]; heap must be non-empty. */
  pop(): [number, number] {
    const k = this.keys;
    const v = this.vals;
    const topK = k[0];
    const topV = v[0];
    const lastK = k.pop()!;
    const lastV = v.pop()!;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && k[r] < k[l] ? r : l;
        if (k[c] >= lastK) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return [topK, topV];
  }
}

export interface SearchResult {
  dist: Float64Array;
  prev: Int32Array;
  prevEdge: Int32Array;
}

/**
 * Dijkstra from several sources. `cost` returns the label at `to` when leaving
 * `from` (label `d`) along edge `e`, or Infinity if the move is not allowed.
 * Labels may be times rather than lengths, so cost can depend on `d`
 * (it must be non-decreasing in d for correctness, which holds for waiting).
 */
export function search(
  g: Graph,
  sources: { node: number; d: number }[],
  cost: (e: GEdge, ei: number, from: number, to: number, d: number) => number,
  stopAt?: (node: number) => boolean,
): SearchResult & { reached: number } {
  const dist = new Float64Array(g.n).fill(Infinity);
  const prev = new Int32Array(g.n).fill(-1);
  const prevEdge = new Int32Array(g.n).fill(-1);
  const done = new Uint8Array(g.n);
  const heap = new MinHeap();
  for (const s of sources) {
    if (s.d < dist[s.node]) {
      dist[s.node] = s.d;
      heap.push(s.d, s.node);
    }
  }
  while (heap.size) {
    const [d, u] = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    if (stopAt && stopAt(u)) return { dist, prev, prevEdge, reached: u };
    for (const { to, e } of g.adj[u]) {
      if (done[to]) continue;
      const nd = cost(g.edges[e], e, u, to, d);
      if (nd < dist[to]) {
        dist[to] = nd;
        prev[to] = u;
        prevEdge[to] = e;
        heap.push(nd, to);
      }
    }
  }
  return { dist, prev, prevEdge, reached: -1 };
}

export function pathTo(prev: Int32Array, target: number): number[] {
  const path: number[] = [];
  for (let v = target; v !== -1; v = prev[v]) path.push(v);
  return path.reverse();
}
