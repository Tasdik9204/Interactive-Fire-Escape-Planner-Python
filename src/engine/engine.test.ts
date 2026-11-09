import { describe, expect, it } from 'vitest';
import { createProject, importLegacyMap, normalizeProject, parseProjectFile } from '../model/project';
import { TEMPLATES } from '../model/samples';
import type { NodeKind, Project } from '../model/types';
import bup from '../../samples-legacy/BUPMAP.json';
import { auditProject } from './audit';
import { buildGraph } from './graph';
import { computeHazard } from './hazard';
import { blockedMasks, planRoute, type RouteContext } from './routing';
import { AgentState, simulate } from './simulate';

/** Small plan: nodes on a line or grid, coordinates in metres (scale 1). */
function plan(nodes: [string, NodeKind, number, number, number?][], edges: [string, string][]): Project {
  const p = createProject('t');
  p.settings.scale = 1;
  p.settings.preMovement = 0;
  p.settings.preMovementSpread = 0;
  const f = p.floors[0].id;
  p.nodes = nodes.map(([id, kind, x, y, occ = 0]) => ({ id, name: id, kind, floorId: f, x, y, occupants: occ }));
  p.edges = edges.map(([a, b], i) => ({ id: `e${i}`, a, b, width: 1 }));
  return p;
}

function ctx(p: Project): RouteContext {
  const g = buildGraph(p);
  const sc = p.scenarios[0];
  const { bn, be } = blockedMasks(g, sc.blockedNodes, sc.blockedEdges);
  return { g, hazard: computeHazard(g, sc, p.settings), settings: p.settings, blockedNodes: bn, blockedEdges: be };
}

// R --10-- A --10-- X1      R also reaches X2 via a 40 m detour through B.
const twoWay = () =>
  plan(
    [
      ['R', 'room', 0, 0, 1],
      ['A', 'corridor', 10, 0],
      ['X1', 'exit', 20, 0],
      ['B', 'corridor', 0, 20],
      ['X2', 'exit', 0, 40],
    ],
    [['R', 'A'], ['A', 'X1'], ['R', 'B'], ['B', 'X2']],
  );

describe('hazard', () => {
  it('spreads fire at the configured rate and is delayed by fire doors', () => {
    const p = plan([['a', 'room', 0, 0], ['b', 'room', 60, 0], ['c', 'room', 120, 0]], [['a', 'b'], ['b', 'c']]);
    p.settings.fireSpreadRate = 60; // 1 m/s
    p.settings.smokeSpreadRate = 120;
    p.settings.flashover = 10;
    p.edges[1].fireDoor = 1; // +60 s
    p.scenarios[0].fireSources = [{ nodeId: 'a', time: 5 }];
    const h = computeHazard(buildGraph(p), p.scenarios[0], p.settings);
    expect(Array.from(h.fire)).toEqual([15, 75, 195]);
    expect(h.smoke[0]).toBe(5);
    expect(h.smoke[1]).toBeLessThan(h.fire[1]);
  });
});

describe('routing', () => {
  it('takes the nearest exit when there is no fire', () => {
    const p = twoWay();
    const r = planRoute(ctx(p), 0, 0);
    expect(r.kind).toBe('safe');
    expect(r.path.map((i) => p.nodes[i].id)).toEqual(['R', 'A', 'X1']);
    expect(r.distance).toBeCloseTo(20);
  });

  it('avoids a node the fire reaches first, even if it is not burning yet', () => {
    const p = twoWay();
    // Fire starts in F, 10 m from A: A burns at 10 s, the person gets there at 8.3 s.
    p.nodes.push({ id: 'F', name: 'F', kind: 'room', floorId: p.floors[0].id, x: 10, y: 10, occupants: 0 });
    p.edges.push({ id: 'eF', a: 'F', b: 'A', width: 1 });
    p.settings.fireSpreadRate = 60; // 1 m/s
    p.settings.flashover = 0;
    p.scenarios[0].fireSources = [{ nodeId: 'F', time: 0 }];
    p.settings.safetyMargin = 5;
    const r = planRoute(ctx(p), 0, 0);
    expect(r.kind).toBe('safe');
    expect(r.path.map((i) => p.nodes[i].id)).toEqual(['R', 'B', 'X2']);
    // Without a margin, beating the fire to A by 1.7 s is allowed.
    p.settings.safetyMargin = 0;
    expect(planRoute(ctx(p), 0, 0).path.map((i) => p.nodes[i].id)).toEqual(['R', 'A', 'X1']);
  });

  it('passes a node that burns only after the person is long gone', () => {
    const p = twoWay();
    p.settings.fireSpreadRate = 0.6; // 0.01 m/s: reaches A after 1000 s
    p.scenarios[0].fireSources = [{ nodeId: 'X1', time: 10000 }];
    expect(planRoute(ctx(p), 0, 0).path.map((i) => p.nodes[i].id)).toEqual(['R', 'A', 'X1']);
  });

  it('respects people-only blockages', () => {
    const p = twoWay();
    p.scenarios[0].blockedNodes = ['A'];
    expect(planRoute(ctx(p), 0, 0).path.map((i) => p.nodes[i].id)).toEqual(['R', 'B', 'X2']);
  });

  it('falls back to a refuge, then reports no route', () => {
    const p = plan([['R', 'room', 0, 0], ['F', 'refuge', 10, 0], ['X', 'exit', -10, 0]], [['R', 'F'], ['R', 'X']]);
    p.scenarios[0].blockedNodes = ['X'];
    expect(planRoute(ctx(p), 0, 0).kind).toBe('refuge');
    p.scenarios[0].blockedNodes = ['X', 'F'];
    expect(planRoute(ctx(p), 0, 0).kind).toBe('none');
  });
});

describe('simulation', () => {
  it('evacuates everyone when there is no fire, limited by door flow', () => {
    const p = plan([['R', 'room', 0, 0, 20], ['X', 'exit', 12, 0]], [['R', 'X']]);
    p.settings.flowRate = 1; // 1 person/s through a 1 m door
    const res = simulate(p);
    expect(res.summary.evacuated).toBe(20);
    expect(res.summary.trapped).toBe(0);
    // Last person enters the door after 19 s, then walks 12 m at 1.2 m/s.
    expect(res.summary.totalTime).toBeGreaterThanOrEqual(29);
    expect(res.summary.totalTime).toBeLessThan(31);
  });

  it('is deterministic for a given seed', () => {
    const p = TEMPLATES[0].make();
    const a = simulate(p).summary;
    const b = simulate(p).summary;
    expect(a).toEqual(b);
    expect(a.total).toBe(123);
    expect(a.evacuated + a.sheltered + a.trapped + a.stranded).toBe(a.total);
  });

  it('traps people whose room catches fire before they leave', () => {
    const p = plan([['R', 'room', 0, 0, 3], ['X', 'exit', 10, 0]], [['R', 'X']]);
    p.settings.preMovement = 60;
    p.settings.flashover = 0;
    p.settings.smokeSpreadRate = 0.01;
    p.scenarios[0].fireSources = [{ nodeId: 'R', time: 10 }];
    // Smoke is their cue at 10 s, but with no flashover the room is lost at the same moment.
    const res = simulate(p);
    expect(res.summary.trapped).toBe(3);
    expect(res.agents.every((a) => a.state === AgentState.Trapped)).toBe(true);
  });

  it('runs every template to completion', () => {
    for (const t of TEMPLATES) {
      const s = simulate(t.make()).summary;
      expect(s.evacuated + s.sheltered + s.trapped + s.stranded, t.id).toBe(s.total);
      expect(s.endTime, t.id).toBeLessThan(3600);
    }
  });

  it('uses stairs on the clinic and shelters nobody when exits are open', () => {
    const p = TEMPLATES[1].make();
    p.scenarios[0].fireSources = [];
    const s = simulate(p).summary;
    expect(s.evacuated).toBe(s.total);
  });
});

describe('audit', () => {
  it('flags single points of failure and travel distance', () => {
    const p = plan(
      [['R1', 'room', 0, 0, 5], ['C1', 'corridor', 30, 0], ['C2', 'corridor', 45, 0], ['R2', 'room', 30, 30, 5], ['X', 'exit', 60, 0]],
      [['R1', 'C1'], ['C1', 'C2'], ['C2', 'X'], ['R2', 'C1']],
    );
    p.settings.maxTravelDistance = 50;
    const a = auditProject(p);
    expect(a.findings.some((f) => f.id === 'spof-C2')).toBe(true);
    // C1 is only the rooms' own door point.
    expect(a.findings.some((f) => f.id === 'spof-C1')).toBe(false);
    expect(a.findings.some((f) => f.id === 'spof-X')).toBe(true);
    expect(a.findings.some((f) => f.id === 'travel-R1')).toBe(true);
    expect(a.rooms.find((r) => r.nodeId === 'R1')!.primary!.distance).toBeCloseTo(60);
  });

  it('scores the office template without critical findings', () => {
    const a = auditProject(TEMPLATES[0].make());
    expect(a.findings.filter((f) => f.severity === 'critical')).toEqual([]);
    expect(a.score).toBeGreaterThan(60);
    expect(a.rooms.every((r) => r.secondary !== null)).toBe(true);
  });
});

describe('import', () => {
  it('converts legacy maps and detects exits by name', () => {
    const p = importLegacyMap(bup, 'BUP');
    // K–P have positions but no edges, so the original never used them.
    expect(p.nodes).toHaveLength(12);
    expect(p.nodes.filter((n) => n.kind === 'exit').map((n) => n.name).sort()).toEqual(['E1', 'E2']);
    expect(p.edges).toHaveLength(18);
  });

  it('repairs untrusted project files', () => {
    const p = normalizeProject({
      name: 'x',
      nodes: [
        { id: 'a', kind: 'room', x: 0, y: 0, occupants: -5 },
        { id: 'a', kind: 'exit' },
        { id: 'b', kind: 'lava', x: 'no' },
      ],
      edges: [{ a: 'a', b: 'b', width: 9999 }, { a: 'a', b: 'zzz' }, { a: 'a', b: 'a' }, { a: 'b', b: 'a' }],
      settings: { walkSpeed: -1 },
      scenarios: [{ fireSources: [{ nodeId: 'zzz' }, { nodeId: 'a', time: 3 }] }],
    });
    expect(p.nodes).toHaveLength(2);
    expect(p.nodes[0].occupants).toBe(0);
    expect(p.nodes[1].kind).toBe('room');
    expect(p.edges).toHaveLength(1);
    expect(p.edges[0].width).toBe(50);
    expect(p.settings.walkSpeed).toBe(0.1);
    expect(p.scenarios[0].fireSources).toEqual([{ nodeId: 'a', time: 3 }]);
  });

  it('rejects files that are not JSON', () => {
    expect(() => parseProjectFile('nope', 'x.json')).toThrow('not valid JSON');
  });
});
