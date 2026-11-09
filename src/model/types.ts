/**
 * Project data model. All plan coordinates are in "plan pixels"; `settings.scale`
 * converts them to metres. All times are seconds, all distances metres.
 */

export type NodeKind = 'room' | 'corridor' | 'stair' | 'exit' | 'refuge';

export const NODE_KINDS: readonly NodeKind[] = ['room', 'corridor', 'stair', 'exit', 'refuge'];

export interface PlanNode {
  id: string;
  name: string;
  kind: NodeKind;
  floorId: string;
  x: number;
  y: number;
  /** People present at the start of an evacuation (rooms and corridors). */
  occupants: number;
}

export interface PlanEdge {
  id: string;
  a: string;
  b: string;
  /** Clear width of the doorway or corridor in metres; sets people flow capacity. */
  width: number;
  /** Measured walking length in metres. Undefined: derived from the drawing. */
  length?: number;
  /** Fire-resisting door on this connection, rated in minutes. 0 or undefined: none. */
  fireDoor?: number;
}

export interface FloorBackground {
  assetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
}

export interface Floor {
  id: string;
  name: string;
  background?: FloorBackground;
}

export interface FireSource {
  nodeId: string;
  /** Ignition time in seconds after the alarm. */
  time: number;
}

export interface Scenario {
  id: string;
  name: string;
  fireSources: FireSource[];
  /** Nodes people cannot pass (debris, locked doors, cordons). Fire still spreads. */
  blockedNodes: string[];
  blockedEdges: string[];
  seed: number;
}

export interface Settings {
  /** Plan pixels per metre. */
  scale: number;
  /** Unimpeded horizontal walking speed, m/s. */
  walkSpeed: number;
  /** Speed multiplier on stairs. */
  stairSpeedFactor: number;
  /** Speed multiplier in smoke. */
  smokeSpeedFactor: number;
  /** Specific flow through a doorway or corridor, persons per second per metre width. */
  flowRate: number;
  /** Fire spread rate along connections, metres per minute. */
  fireSpreadRate: number;
  /** Smoke spread rate along connections, metres per minute. */
  smokeSpreadRate: number;
  /** Seconds from ignition until the fire room is untenable and fire starts to spread. */
  flashover: number;
  /** Time from alarm until people start moving, seconds. */
  preMovement: number;
  /** Extra random pre-movement per person, 0..spread seconds. */
  preMovementSpread: number;
  /** A route node counts as safe only if reached this many seconds before fire. */
  safetyMargin: number;
  /** Default length of a stair flight between two floors, metres. */
  stairLength: number;
  /** Audit: maximum travel distance from any room to the nearest exit, metres. */
  maxTravelDistance: number;
  /** Audit: target total evacuation time, seconds. */
  targetEvacTime: number;
  /** Audit: minimum clear width of an escape route, metres. */
  minWidth: number;
}

export interface Project {
  version: 2;
  id: string;
  name: string;
  updatedAt: number;
  floors: Floor[];
  nodes: PlanNode[];
  edges: PlanEdge[];
  settings: Settings;
  scenarios: Scenario[];
  activeScenarioId: string;
}

export const DEFAULT_SETTINGS: Settings = {
  scale: 20,
  walkSpeed: 1.2,
  stairSpeedFactor: 0.5,
  smokeSpeedFactor: 0.6,
  flowRate: 1.3,
  fireSpreadRate: 6,
  smokeSpreadRate: 30,
  flashover: 90,
  preMovement: 30,
  preMovementSpread: 60,
  safetyMargin: 30,
  stairLength: 8,
  maxTravelDistance: 45,
  targetEvacTime: 150,
  minWidth: 0.8,
};

export const KIND_LABEL: Record<NodeKind, string> = {
  room: 'Room',
  corridor: 'Corridor point',
  stair: 'Stair',
  exit: 'Exit',
  refuge: 'Refuge area',
};
