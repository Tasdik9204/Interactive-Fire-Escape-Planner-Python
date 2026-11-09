import bupMap from '../../samples-legacy/BUPMAP.json';
import complexMap from '../../samples-legacy/complex_map.json';
import largeMap from '../../samples-legacy/floor_plan_large.json';
import { createProject, importLegacyMap, uid } from './project';
import type { NodeKind, Project } from './types';

type NodeSpec = [key: string, name: string, kind: NodeKind, floor: number, x: number, y: number, occupants?: number];
type EdgeSpec = [a: string, b: string, width?: number, fireDoor?: number];

/** Build a project from compact specs. Coordinates are in metres. */
function build(name: string, floors: string[], nodes: NodeSpec[], edges: EdgeSpec[], fire: string[]): Project {
  const p = createProject(name);
  p.floors = floors.map((f) => ({ id: uid('f'), name: f }));
  const s = p.settings.scale;
  const ids = new Map<string, string>();
  for (const [key, label, kind, floor, x, y, occ = 0] of nodes) {
    const id = uid('n');
    ids.set(key, id);
    p.nodes.push({ id, name: label, kind, floorId: p.floors[floor].id, x: x * s, y: y * s, occupants: occ });
  }
  for (const [a, b, width = 1.8, door] of edges) {
    p.edges.push({ id: uid('e'), a: ids.get(a)!, b: ids.get(b)!, width, ...(door ? { fireDoor: door } : {}) });
  }
  p.scenarios[0].name = 'Fire in ' + nodes.find((n) => n[0] === fire[0])![1];
  p.scenarios[0].fireSources = fire.map((k) => ({ nodeId: ids.get(k)!, time: 0 }));
  return p;
}

function officeFloor(): Project {
  const nodes: NodeSpec[] = [
    ['c1', 'C1', 'corridor', 0, 6, 12], ['c2', 'C2', 'corridor', 0, 16, 12], ['c3', 'C3', 'corridor', 0, 26, 12],
    ['c4', 'C4', 'corridor', 0, 36, 12], ['c5', 'C5', 'corridor', 0, 46, 12], ['c6', 'C6', 'corridor', 0, 54, 12],
    ['oa', 'Open office A', 'room', 0, 6, 5, 30], ['m1', 'Meeting 1', 'room', 0, 16, 5, 10], ['kit', 'Kitchen', 'room', 0, 26, 5, 6],
    ['ob', 'Open office B', 'room', 0, 36, 5, 30], ['srv', 'Server room', 'room', 0, 46, 5, 1],
    ['rec', 'Reception', 'room', 0, 6, 19, 8], ['m2', 'Meeting 2', 'room', 0, 16, 19, 10], ['tr', 'Training room', 'room', 0, 26, 19, 25],
    ['dir', 'Director', 'room', 0, 36, 19, 2], ['st', 'Store', 'room', 0, 46, 19, 1],
    ['ew', 'West exit', 'exit', 0, 1, 12], ['ee', 'East exit', 'exit', 0, 59, 12], ['em', 'Main entrance', 'exit', 0, 6, 24],
  ];
  const edges: EdgeSpec[] = [
    ['c1', 'c2'], ['c2', 'c3'], ['c3', 'c4', 1.8, 30], ['c4', 'c5'], ['c5', 'c6'],
    ['ew', 'c1', 1.2], ['c6', 'ee', 1.2], ['rec', 'em', 1.8],
    ['oa', 'c1', 1.2], ['m1', 'c2', 0.9], ['kit', 'c3', 0.9], ['ob', 'c4', 1.2], ['srv', 'c5', 0.9],
    ['rec', 'c1', 1.8], ['m2', 'c2', 0.9], ['tr', 'c3', 1.2], ['dir', 'c4', 0.9], ['st', 'c5', 0.8], ['oa', 'm1', 0.9],
  ];
  return build('Office floor', ['Ground floor'], nodes, edges, ['kit']);
}

function clinic(): Project {
  const nodes: NodeSpec[] = [
    // Ground floor
    ['g1', 'G1', 'corridor', 0, 7, 10], ['g2', 'G2', 'corridor', 0, 16, 10], ['g3', 'G3', 'corridor', 0, 26, 10], ['g4', 'G4', 'corridor', 0, 34, 10],
    ['wait', 'Waiting area', 'room', 0, 16, 4, 25], ['con1', 'Consult 1', 'room', 0, 7, 4, 4], ['con2', 'Consult 2', 'room', 0, 26, 4, 4],
    ['treat', 'Treatment', 'room', 0, 34, 4, 6], ['pharm', 'Pharmacy', 'room', 0, 7, 16, 3], ['xray', 'X-ray', 'room', 0, 16, 16, 3],
    ['staff', 'Staff room', 'room', 0, 26, 16, 5],
    ['gsw', 'West stair', 'stair', 0, 2, 10], ['gse', 'East stair', 'stair', 0, 39, 10],
    ['main', 'Main exit', 'exit', 0, 16, 0.5], ['side', 'Side exit', 'exit', 0, 34, 17], ['wexit', 'West exit', 'exit', 0, 2, 20],
    // First floor
    ['f1', 'F1', 'corridor', 1, 7, 10], ['f2', 'F2', 'corridor', 1, 16, 10], ['f3', 'F3', 'corridor', 1, 26, 10], ['f4', 'F4', 'corridor', 1, 34, 10],
    ['wa', 'Ward A', 'room', 1, 7, 4, 12], ['wb', 'Ward B', 'room', 1, 16, 4, 12], ['wc', 'Ward C', 'room', 1, 26, 4, 12],
    ['nurse', 'Nurses station', 'room', 1, 34, 4, 4], ['off', 'Admin office', 'room', 1, 7, 16, 3], ['plant', 'Plant room', 'room', 1, 16, 16],
    ['ref', 'Refuge', 'refuge', 1, 26, 16],
    ['fsw', 'West stair', 'stair', 1, 2, 10], ['fse', 'East stair', 'stair', 1, 39, 10],
  ];
  const edges: EdgeSpec[] = [
    ['g1', 'g2'], ['g2', 'g3'], ['g3', 'g4'], ['gsw', 'g1', 1.2, 60], ['g4', 'gse', 1.2, 60],
    ['wait', 'g2', 2], ['wait', 'main', 2], ['con1', 'g1', 0.9], ['con2', 'g3', 0.9], ['treat', 'g4', 1.2],
    ['pharm', 'g1', 0.9], ['xray', 'g2', 1.2], ['staff', 'g3', 0.9], ['g4', 'side', 1.2], ['gsw', 'wexit', 1.2],
    ['f1', 'f2'], ['f2', 'f3', 1.8, 30], ['f3', 'f4'], ['fsw', 'f1', 1.2, 60], ['f4', 'fse', 1.2, 60],
    ['wa', 'f1', 1.2], ['wb', 'f2', 1.2], ['wc', 'f3', 1.2], ['nurse', 'f4', 0.9], ['off', 'f1', 0.9], ['plant', 'f2', 0.9],
    ['ref', 'f3', 1.2, 60],
    ['gsw', 'fsw', 1.2], ['gse', 'fse', 1.2],
  ];
  return build('Two-storey clinic', ['Ground floor', 'First floor'], nodes, edges, ['plant']);
}

export interface Template {
  id: string;
  name: string;
  description: string;
  make: () => Project;
}

export const TEMPLATES: Template[] = [
  { id: 'office', name: 'Office floor', description: '1 floor · 16 rooms · 3 exits · 123 people', make: officeFloor },
  { id: 'clinic', name: 'Two-storey clinic', description: '2 floors · stairs, refuge, fire doors · 93 people', make: clinic },
  { id: 'bup', name: 'BUP academic block', description: 'Imported from the original planner', make: () => importLegacyMap(bupMap, 'BUP academic block') },
  { id: 'complex', name: 'Complex map', description: 'Imported from the original planner', make: () => importLegacyMap(complexMap, 'Complex map') },
  { id: 'large', name: 'Large floor plan', description: 'Imported from the original planner', make: () => importLegacyMap(largeMap, 'Large floor plan') },
];
