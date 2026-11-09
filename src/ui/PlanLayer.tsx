import { memo } from 'react';
import type { Floor, PlanEdge, PlanNode, Project } from '../model/types';
import { useAssetUrl } from './useAsset';

export interface Overlay {
  /** Node id -> 1 smoke, 2 fire at the current time. */
  hazard?: Map<string, 1 | 2>;
  agents?: { xy: Float32Array; floor: Uint8Array; state: Uint8Array } | null;
  highlightNodes?: Set<string>;
  highlightEdges?: Set<string>;
  route?: { nodes: Set<string>; edges: Set<string> } | null;
  labels?: Map<string, { text: string; tone: 'ok' | 'warn' | 'bad' }>;
  fireSources?: Set<string>;
  blockedNodes?: Set<string>;
  blockedEdges?: Set<string>;
}

interface Props {
  project: Project;
  floor: Floor;
  floorIndex: number;
  selectedNodes?: Set<string>;
  selectedEdges?: Set<string>;
  overlay?: Overlay;
  /** Current zoom, used to keep small labels readable. */
  zoom?: number;
}

/** Markers are drawn this many times larger than one metre per unit, for legibility. */
const MARKER = 1.35;

/** Label width estimate in marker units for a given name. */
export const labelWidth = (name: string, u: number) => Math.max(3 * u, name.length * 0.33 * u + 1.4 * u);

export function nodeBox(n: PlanNode, scale: number): { w: number; h: number } {
  const u = scale * MARKER;
  switch (n.kind) {
    case 'room':
      return { w: labelWidth(n.name, u), h: 1.6 * u };
    case 'exit':
    case 'refuge':
      return { w: labelWidth(n.name, u), h: 1.4 * u };
    case 'stair':
      return { w: 1.6 * u, h: 1.6 * u };
    default:
      return { w: 0.8 * u, h: 0.8 * u };
  }
}

/** Pure render of one floor: background, connections, nodes and overlays. */
export const PlanLayer = memo(function PlanLayer({ project, floor, floorIndex, selectedNodes, selectedEdges, overlay, zoom = 1 }: Props) {
  const u = project.settings.scale * MARKER;
  const bgUrl = useAssetUrl(floor.background?.assetId);
  const byId = new Map(project.nodes.map((n) => [n.id, n]));
  const nodes = project.nodes.filter((n) => n.floorId === floor.id);
  const floorNames = new Map(project.floors.map((f) => [f.id, f.name]));
  const edges: PlanEdge[] = [];
  const stairLinks = new Map<string, string[]>();
  for (const e of project.edges) {
    const a = byId.get(e.a);
    const b = byId.get(e.b);
    if (!a || !b) continue;
    if (a.floorId === floor.id && b.floorId === floor.id) edges.push(e);
    else if (a.floorId === floor.id || b.floorId === floor.id) {
      const [here, there] = a.floorId === floor.id ? [a, b] : [b, a];
      stairLinks.set(here.id, [...(stairLinks.get(here.id) ?? []), floorNames.get(there.floorId) ?? '?']);
    }
  }
  const hz = overlay?.hazard;
  const showMinorLabels = zoom * u >= 14;
  const labelSize = 0.55 * u;

  return (
    <g className="plan">
      {floor.background && bgUrl && (
        <image
          href={bgUrl}
          x={floor.background.x}
          y={floor.background.y}
          width={floor.background.width}
          height={floor.background.height}
          opacity={floor.background.opacity}
          preserveAspectRatio="none"
          className="plan-bg"
        />
      )}

      {/* Hazard halos sit under everything else. */}
      {hz &&
        nodes.map((n) => {
          const h = hz.get(n.id);
          return h ? <circle key={'h' + n.id} className={h === 2 ? 'halo-fire' : 'halo-smoke'} cx={n.x} cy={n.y} r={(h === 2 ? 2 : 1.7) * u} /> : null;
        })}

      {edges.map((e) => {
        const a = byId.get(e.a)!;
        const b = byId.get(e.b)!;
        const w = Math.min(1.2 * u, Math.max(0.15 * u, e.width * u * 0.3));
        const burning = hz && hz.get(a.id) === 2 && hz.get(b.id) === 2;
        const smoky = hz && !burning && (hz.get(a.id) || hz.get(b.id));
        const cls = [
          'edge',
          selectedEdges?.has(e.id) && 'is-selected',
          overlay?.highlightEdges?.has(e.id) && 'is-highlight',
          overlay?.route?.edges.has(e.id) && 'is-route',
          overlay?.blockedEdges?.has(e.id) && 'is-blocked',
          burning && 'is-burning',
          smoky && 'is-smoky',
        ]
          .filter(Boolean)
          .join(' ');
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        return (
          <g key={e.id} className={cls} data-edge={e.id}>
            <line className="edge-hit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={Math.max(w, 12 / zoom)} />
            <line className="edge-line" x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={w} />
            {e.fireDoor ? (
              <g transform={`translate(${mx} ${my}) rotate(${ang})`} className="fire-door">
                <rect x={-0.2 * u} y={-0.8 * u} width={0.4 * u} height={1.6 * u} rx={0.1 * u} />
                {showMinorLabels && (
                  <text y={1.45 * u} fontSize={0.42 * u} textAnchor="middle" transform={Math.abs(ang) > 90 ? 'rotate(180)' : undefined}>
                    FD{e.fireDoor}
                  </text>
                )}
              </g>
            ) : null}
            {overlay?.blockedEdges?.has(e.id) && (
              <g transform={`translate(${mx} ${my})`} className="block-mark">
                <circle r={0.7 * u} />
                <path d={`M${-0.4 * u} ${-0.4 * u}L${0.4 * u} ${0.4 * u}M${0.4 * u} ${-0.4 * u}L${-0.4 * u} ${0.4 * u}`} />
              </g>
            )}
          </g>
        );
      })}

      {nodes.map((n) => {
        const { w, h } = nodeBox(n, project.settings.scale);
        const label = overlay?.labels?.get(n.id);
        const cls = [
          'node',
          `kind-${n.kind}`,
          selectedNodes?.has(n.id) && 'is-selected',
          overlay?.highlightNodes?.has(n.id) && 'is-highlight',
          overlay?.route?.nodes.has(n.id) && 'is-route',
          overlay?.blockedNodes?.has(n.id) && 'is-blocked',
          hz?.get(n.id) === 2 && 'is-burning',
        ]
          .filter(Boolean)
          .join(' ');
        const links = stairLinks.get(n.id);
        return (
          <g key={n.id} className={cls} data-node={n.id} transform={`translate(${n.x} ${n.y})`}>
            {n.kind === 'corridor' ? (
              <circle className="node-shape" r={w / 2} />
            ) : (
              <rect className="node-shape" x={-w / 2} y={-h / 2} width={w} height={h} rx={n.kind === 'stair' ? 0.2 * u : 0.35 * u} />
            )}
            {n.kind === 'stair' && (
              <path
                className="node-glyph"
                d={`M${-0.55 * u} ${0.45 * u}h${0.35 * u}v${-0.3 * u}h${0.35 * u}v${-0.3 * u}h${0.35 * u}v${-0.3 * u}h${0.2 * u}`}
                strokeWidth={0.12 * u}
              />
            )}
            {(n.kind === 'room' || n.kind === 'exit' || n.kind === 'refuge') && (
              <text className="node-label" fontSize={labelSize} textAnchor="middle" dominantBaseline="central">
                {n.name}
              </text>
            )}
            {(n.kind === 'corridor' || n.kind === 'stair') && showMinorLabels && (
              <text className="node-sub" y={h / 2 + 0.6 * u} fontSize={0.45 * u} textAnchor="middle">
                {n.name}
              </text>
            )}
            {links && (
              <text className="node-link" y={-h / 2 - 0.4 * u} fontSize={0.45 * u} textAnchor="middle">
                ↕ {links.join(', ')}
              </text>
            )}
            {n.occupants > 0 && (
              <g className="occ" transform={`translate(${w / 2} ${-h / 2})`}>
                <rect x={-0.55 * u} y={-0.42 * u} width={(String(n.occupants).length * 0.3 + 0.5) * u} height={0.84 * u} rx={0.42 * u} />
                <text x={-0.55 * u + ((String(n.occupants).length * 0.3 + 0.5) * u) / 2} fontSize={0.48 * u} textAnchor="middle" dominantBaseline="central">
                  {n.occupants}
                </text>
              </g>
            )}
            {overlay?.fireSources?.has(n.id) && (
              <path
                className="fire-icon"
                transform={`translate(${-w / 2} ${-h / 2}) scale(${u / 22})`}
                d="M0 10c4 0 7-2.7 7-6.8 0-3-1.6-5.2-3.4-7.2-.4 1.6-1.3 2.8-2.6 3.4.3-3.3-1-6.4-4-9.4-.3 3.8-2.6 6-4.2 8.2A8 8 0 0 0-7 3.2C-7 7.3-4 10 0 10z"
              />
            )}
            {overlay?.blockedNodes?.has(n.id) && (
              <g className="block-mark">
                <circle r={0.7 * u} />
                <path d={`M${-0.4 * u} ${-0.4 * u}L${0.4 * u} ${0.4 * u}M${0.4 * u} ${-0.4 * u}L${-0.4 * u} ${0.4 * u}`} />
              </g>
            )}
            {label && (
              <g className={`metric is-${label.tone}`} transform={`translate(0 ${h / 2 + 0.8 * u})`}>
                <rect x={-(label.text.length * 0.28 + 0.6) * u / 2} y={-0.45 * u} width={(label.text.length * 0.28 + 0.6) * u} height={0.9 * u} rx={0.45 * u} />
                <text fontSize={0.48 * u} textAnchor="middle" dominantBaseline="central">
                  {label.text}
                </text>
              </g>
            )}
          </g>
        );
      })}

      {overlay?.agents && <Agents agents={overlay.agents} floorIndex={floorIndex} r={0.28 * u} />}
    </g>
  );
});

const AGENT_CLASSES: Record<number, string> = { 0: 'agent-wait', 1: 'agent-move', 2: 'agent-queue', 4: 'agent-safe', 5: 'agent-trapped', 6: 'agent-stranded' };

/** People as one path per state: thousands of dots without thousands of DOM nodes. */
function Agents({ agents, floorIndex, r }: { agents: NonNullable<Overlay['agents']>; floorIndex: number; r: number }) {
  const paths: Record<string, string[]> = {};
  const n = agents.state.length;
  const d = `m${-r} 0a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
  for (let i = 0; i < n; i++) {
    const st = agents.state[i];
    if (st === 3 || agents.floor[i] !== floorIndex) continue; // evacuated: off the plan
    const cls = AGENT_CLASSES[st];
    (paths[cls] ??= []).push(`M${agents.xy[2 * i].toFixed(1)} ${agents.xy[2 * i + 1].toFixed(1)}${d}`);
  }
  return (
    <g className="agents">
      {Object.entries(paths).map(([cls, parts]) => (
        <path key={cls} className={cls} d={parts.join('')} />
      ))}
    </g>
  );
}
