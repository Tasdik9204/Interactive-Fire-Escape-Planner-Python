import {
  DEFAULT_SETTINGS,
  NODE_KINDS,
  type FireSource,
  type Floor,
  type NodeKind,
  type PlanEdge,
  type PlanNode,
  type Project,
  type Scenario,
  type Settings,
} from './types';

export function uid(prefix = ''): string {
  const r = crypto.getRandomValues(new Uint32Array(2));
  return prefix + r[0].toString(36) + r[1].toString(36).slice(0, 4);
}

export function createScenario(name = 'Scenario 1'): Scenario {
  return { id: uid('s'), name, fireSources: [], blockedNodes: [], blockedEdges: [], seed: 1 };
}

export function createProject(name = 'Untitled building'): Project {
  const scenario = createScenario();
  return {
    version: 2,
    id: uid('p'),
    name,
    updatedAt: Date.now(),
    floors: [{ id: uid('f'), name: 'Ground floor' }],
    nodes: [],
    edges: [],
    settings: { ...DEFAULT_SETTINGS },
    scenarios: [scenario],
    activeScenarioId: scenario.id,
  };
}

export function activeScenario(p: Project): Scenario {
  return p.scenarios.find((s) => s.id === p.activeScenarioId) ?? p.scenarios[0];
}

export function nodeMap(p: Project): Map<string, PlanNode> {
  return new Map(p.nodes.map((n) => [n.id, n]));
}

export function isStairEdge(e: PlanEdge, nodes: Map<string, PlanNode>): boolean {
  const a = nodes.get(e.a);
  const b = nodes.get(e.b);
  return !!a && !!b && a.floorId !== b.floorId;
}

/** Walking length of a connection in metres. */
export function edgeLength(e: PlanEdge, nodes: Map<string, PlanNode>, settings: Settings): number {
  if (e.length !== undefined && e.length > 0) return e.length;
  const a = nodes.get(e.a);
  const b = nodes.get(e.b);
  if (!a || !b) return 0;
  if (a.floorId !== b.floorId) return settings.stairLength;
  return Math.max(0.1, Math.hypot(a.x - b.x, a.y - b.y) / settings.scale);
}

export function nextNodeName(p: Project, kind: NodeKind): string {
  const prefix = { room: 'Room ', corridor: 'C', stair: 'Stair ', exit: 'Exit ', refuge: 'Refuge ' }[kind];
  const used = new Set(p.nodes.map((n) => n.name));
  for (let i = 1; ; i++) {
    const name = prefix + i;
    if (!used.has(name)) return name;
  }
}

// ---------------------------------------------------------------------------
// Import validation (trust boundary: files come from users and other tools)
// ---------------------------------------------------------------------------

export class ImportError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const str = (v: unknown, fallback: string, maxLen = 120): string =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, maxLen) : fallback;

const MAX_NODES = 5000;
const MAX_EDGES = 20000;

function normalizeSettings(raw: unknown): Settings {
  const s = isObj(raw) ? raw : {};
  const d = DEFAULT_SETTINGS;
  return {
    scale: num(s.scale, d.scale, 0.01, 10000),
    walkSpeed: num(s.walkSpeed, d.walkSpeed, 0.1, 5),
    stairSpeedFactor: num(s.stairSpeedFactor, d.stairSpeedFactor, 0.05, 1),
    smokeSpeedFactor: num(s.smokeSpeedFactor, d.smokeSpeedFactor, 0.05, 1),
    flowRate: num(s.flowRate, d.flowRate, 0.1, 5),
    fireSpreadRate: num(s.fireSpreadRate, d.fireSpreadRate, 0.01, 1000),
    smokeSpreadRate: num(s.smokeSpreadRate, d.smokeSpreadRate, 0.01, 1000),
    flashover: num(s.flashover, d.flashover, 0, 3600),
    preMovement: num(s.preMovement, d.preMovement, 0, 3600),
    preMovementSpread: num(s.preMovementSpread, d.preMovementSpread, 0, 3600),
    safetyMargin: num(s.safetyMargin, d.safetyMargin, 0, 3600),
    stairLength: num(s.stairLength, d.stairLength, 0.5, 200),
    maxTravelDistance: num(s.maxTravelDistance, d.maxTravelDistance, 1, 10000),
    targetEvacTime: num(s.targetEvacTime, d.targetEvacTime, 10, 36000),
    minWidth: num(s.minWidth, d.minWidth, 0.1, 20),
  };
}

/** Validate and repair a parsed v2 project. Throws ImportError when unusable. */
export function normalizeProject(raw: unknown): Project {
  if (!isObj(raw)) throw new ImportError('The file is not a project object.');

  const floors: Floor[] = [];
  const floorIds = new Set<string>();
  for (const f of Array.isArray(raw.floors) ? raw.floors : []) {
    if (!isObj(f)) continue;
    const id = str(f.id, uid('f'), 64);
    if (floorIds.has(id)) continue;
    floorIds.add(id);
    const floor: Floor = { id, name: str(f.name, `Floor ${floors.length + 1}`) };
    const bg = f.background;
    if (isObj(bg) && typeof bg.assetId === 'string') {
      floor.background = {
        assetId: bg.assetId.slice(0, 64),
        x: num(bg.x, 0),
        y: num(bg.y, 0),
        width: num(bg.width, 1000, 1),
        height: num(bg.height, 1000, 1),
        opacity: num(bg.opacity, 0.5, 0, 1),
      };
    }
    floors.push(floor);
  }
  if (floors.length === 0) {
    const id = uid('f');
    floors.push({ id, name: 'Ground floor' });
    floorIds.add(id);
  }

  const nodes: PlanNode[] = [];
  const nodeIds = new Set<string>();
  for (const n of Array.isArray(raw.nodes) ? raw.nodes.slice(0, MAX_NODES) : []) {
    if (!isObj(n)) continue;
    const id = str(n.id, uid('n'), 64);
    if (nodeIds.has(id)) continue;
    const kind = NODE_KINDS.includes(n.kind as NodeKind) ? (n.kind as NodeKind) : 'room';
    nodeIds.add(id);
    nodes.push({
      id,
      name: str(n.name, id),
      kind,
      floorId: typeof n.floorId === 'string' && floorIds.has(n.floorId) ? n.floorId : floors[0].id,
      x: num(n.x, 0, -1e6, 1e6),
      y: num(n.y, 0, -1e6, 1e6),
      occupants: kind === 'room' || kind === 'corridor' ? Math.round(num(n.occupants, 0, 0, 10000)) : 0,
    });
  }

  const edges: PlanEdge[] = [];
  const pairs = new Set<string>();
  for (const e of Array.isArray(raw.edges) ? raw.edges.slice(0, MAX_EDGES) : []) {
    if (!isObj(e) || typeof e.a !== 'string' || typeof e.b !== 'string') continue;
    if (e.a === e.b || !nodeIds.has(e.a) || !nodeIds.has(e.b)) continue;
    const key = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
    if (pairs.has(key)) continue;
    pairs.add(key);
    const edge: PlanEdge = { id: str(e.id, uid('e'), 64), a: e.a, b: e.b, width: num(e.width, 1.2, 0.1, 50) };
    const length = num(e.length, 0, 0, 100000);
    if (length > 0) edge.length = length;
    const door = num(e.fireDoor, 0, 0, 240);
    if (door > 0) edge.fireDoor = door;
    edges.push(edge);
  }
  const edgeIds = new Set(edges.map((e) => e.id));

  const scenarios: Scenario[] = [];
  for (const s of Array.isArray(raw.scenarios) ? raw.scenarios : []) {
    if (!isObj(s)) continue;
    const fireSources: FireSource[] = [];
    for (const f of Array.isArray(s.fireSources) ? s.fireSources : []) {
      if (isObj(f) && typeof f.nodeId === 'string' && nodeIds.has(f.nodeId) && !fireSources.some((x) => x.nodeId === f.nodeId)) {
        fireSources.push({ nodeId: f.nodeId, time: num(f.time, 0, 0, 36000) });
      }
    }
    const ids = (v: unknown, valid: Set<string>) =>
      Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && valid.has(x)))] : [];
    scenarios.push({
      id: str(s.id, uid('s'), 64),
      name: str(s.name, `Scenario ${scenarios.length + 1}`),
      fireSources,
      blockedNodes: ids(s.blockedNodes, nodeIds),
      blockedEdges: ids(s.blockedEdges, edgeIds),
      seed: Math.round(num(s.seed, 1, 1, 2 ** 31 - 1)),
    });
  }
  if (scenarios.length === 0) scenarios.push(createScenario());
  const activeScenarioId = scenarios.some((s) => s.id === raw.activeScenarioId)
    ? (raw.activeScenarioId as string)
    : scenarios[0].id;

  return {
    version: 2,
    id: str(raw.id, uid('p'), 64),
    name: str(raw.name, 'Imported building'),
    updatedAt: num(raw.updatedAt, Date.now()),
    floors,
    nodes,
    edges,
    settings: normalizeSettings(raw.settings),
    scenarios,
    activeScenarioId,
  };
}

/**
 * Convert the original Python planner's map format:
 * { positions: { id: [x, y] }, edges: [[u, v, weight], ...] }.
 * Y is flipped (matplotlib draws upward) and coordinates are scaled so the drawn
 * geometry matches the stored weights, read as metres.
 */
export function importLegacyMap(raw: unknown, name: string): Project {
  if (!isObj(raw) || !isObj(raw.positions) || !Array.isArray(raw.edges)) {
    throw new ImportError('Not a recognised map file.');
  }
  const project = createProject(name);
  const floorId = project.floors[0].id;
  const scale = project.settings.scale;

  const pos = new Map<string, [number, number]>();
  for (const [id, p] of Object.entries(raw.positions)) {
    if (Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number' && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
      pos.set(id.slice(0, 64), [p[0], p[1]]);
    }
  }
  if (pos.size === 0) throw new ImportError('The map has no positions.');

  const rawEdges: [string, string, number | undefined][] = [];
  for (const e of raw.edges) {
    if (!Array.isArray(e) || typeof e[0] !== 'string' || typeof e[1] !== 'string') continue;
    if (!pos.has(e[0]) || !pos.has(e[1]) || e[0] === e[1]) continue;
    const w = typeof e[2] === 'number' && Number.isFinite(e[2]) && e[2] > 0 ? e[2] : undefined;
    rawEdges.push([e[0], e[1], w]);
  }

  // Metres per legacy unit: median ratio of weight to drawn length.
  const ratios = rawEdges
    .filter(([, , w]) => w !== undefined)
    .map(([u, v, w]) => {
      const [x1, y1] = pos.get(u)!;
      const [x2, y2] = pos.get(v)!;
      const geo = Math.hypot(x1 - x2, y1 - y2);
      return geo > 0 ? w! / geo : NaN;
    })
    .filter((r) => Number.isFinite(r))
    .sort((a, b) => a - b);
  const weightRatio = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 1;
  let metresPerUnit = weightRatio;
  // Weights that do not read as metres (plan under 10 m or over 300 m across):
  // fit the plan to 60 m and scale the weights by the same factor.
  const xs = [...pos.values()].map((p) => p[0]);
  const ys = [...pos.values()].map((p) => p[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
  if (span * metresPerUnit < 10 || span * metresPerUnit > 300) metresPerUnit = 60 / span;
  const weightScale = metresPerUnit / weightRatio;
  const k = metresPerUnit * scale;
  const maxY = Math.max(...ys);
  const minX = Math.min(...xs);

  // The original planner built its graph from edges only, so positions without
  // an edge were never part of the building.
  const connected = new Set(rawEdges.flatMap(([u, v]) => [u, v]));
  const idMap = new Map<string, string>();
  for (const [legacyId, [x, y]] of pos) {
    if (!connected.has(legacyId)) continue;
    const isExit = /^(e\d+|exit.*)$/i.test(legacyId);
    const id = uid('n');
    idMap.set(legacyId, id);
    project.nodes.push({
      id,
      name: legacyId,
      kind: isExit ? 'exit' : 'room',
      floorId,
      x: Math.round((x - minX) * k + 2 * scale),
      y: Math.round((maxY - y) * k + 2 * scale),
      occupants: isExit ? 0 : 4,
    });
  }
  const nodes = nodeMap(project);
  const seen = new Set<string>();
  for (const [u, v, w] of rawEdges) {
    const a = idMap.get(u)!;
    const b = idMap.get(v)!;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const edge: PlanEdge = { id: uid('e'), a, b, width: 1.2 };
    if (w !== undefined) {
      const metres = w * weightScale;
      const drawn = edgeLength(edge, nodes, project.settings);
      if (Math.abs(drawn - metres) / metres > 0.1) edge.length = Math.round(metres * 100) / 100;
    }
    project.edges.push(edge);
  }
  return project;
}

/** Parse any supported file content into a project. */
export function parseProjectFile(text: string, fileName: string): Project {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError('The file is not valid JSON.');
  }
  const baseName = fileName.replace(/\.[^.]+$/, '') || 'Imported building';
  if (isObj(data) && 'positions' in data && 'edges' in data && !('nodes' in data)) {
    return importLegacyMap(data, baseName);
  }
  const project = normalizeProject(isObj(data) && isObj(data.project) ? data.project : data);
  return project;
}
