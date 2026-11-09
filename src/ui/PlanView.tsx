import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { ProjectStore } from '../app/store';
import { addNode, connect, moveNodes } from '../model/edit';
import { nextNodeName, uid } from '../model/project';
import type { NodeKind, Project } from '../model/types';
import { nodeBox, PlanLayer, type Overlay } from './PlanLayer';

export type Mode = 'design' | 'simulate' | 'audit' | 'report';
export type Tool = 'select' | 'pan' | 'room' | 'corridor' | 'stair' | 'exit' | 'refuge' | 'connect' | 'calibrate' | 'fire' | 'block' | 'route';
export interface Selection {
  nodes: Set<string>;
  edges: Set<string>;
}
export interface View {
  x: number;
  y: number;
  k: number;
}
export interface PlanViewHandle {
  fit: () => void;
  zoomBy: (f: number) => void;
  svg: () => SVGSVGElement | null;
}

const NODE_TOOLS: Partial<Record<Tool, NodeKind>> = { room: 'room', corridor: 'corridor', stair: 'stair', exit: 'exit', refuge: 'refuge' };
export const EMPTY_SELECTION: Selection = { nodes: new Set(), edges: new Set() };

type Drag =
  | { kind: 'pan'; cx: number; cy: number; view: View }
  | { kind: 'move'; cx: number; cy: number; base: Map<string, { x: number; y: number }>; anchor: { x: number; y: number }; moved: boolean; key: string }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; additive: boolean };

interface Props {
  project: Project;
  store: ProjectStore;
  floorId: string;
  mode: Mode;
  tool: Tool;
  selection: Selection;
  onSelect: (s: Selection) => void;
  view: View;
  onView: (v: View) => void;
  snap: boolean;
  showGrid: boolean;
  overlay?: Overlay;
  onSimClick?: (target: { node?: string; edge?: string }) => void;
  onCalibrate?: (pixels: number) => void;
  onCursor?: (p: { x: number; y: number } | null) => void;
  handle?: Ref<PlanViewHandle>;
}

export function PlanView(props: Props) {
  const { project, store, floorId, mode, tool, selection, onSelect, view, onView, snap, showGrid, overlay, handle } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const spaceRef = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [calib, setCalib] = useState<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);

  const u = project.settings.scale;
  const floorIndex = Math.max(0, project.floors.findIndex((f) => f.id === floorId));
  const floor = project.floors[floorIndex];
  const grid = 0.5 * u;
  const snapV = (v: number) => (snap ? Math.round(v / grid) * grid : v);

  useEffect(() => {
    setPending(null);
    setCalib(null);
  }, [tool, floorId, mode]);

  const toWorld = useCallback((cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k };
  }, []);

  const fit = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const pts = project.nodes.filter((n) => n.floorId === floorId);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of pts) {
      const { w, h } = nodeBox(n, u);
      minX = Math.min(minX, n.x - w / 2);
      maxX = Math.max(maxX, n.x + w / 2);
      minY = Math.min(minY, n.y - h / 2 - u);
      maxY = Math.max(maxY, n.y + h / 2 + u);
    }
    const bg = floor?.background;
    if (bg) {
      minX = Math.min(minX, bg.x);
      minY = Math.min(minY, bg.y);
      maxX = Math.max(maxX, bg.x + bg.width);
      maxY = Math.max(maxY, bg.y + bg.height);
    }
    const r = svg.getBoundingClientRect();
    if (!Number.isFinite(minX)) {
      onView({ x: r.width / 2 - 20 * u, y: r.height / 2 - 12 * u, k: 1 });
      return;
    }
    const pad = 48;
    const k = Math.min(4, Math.max(0.05, Math.min((r.width - pad * 2) / (maxX - minX || 1), (r.height - pad * 2) / (maxY - minY || 1))));
    onView({ k, x: (r.width - (maxX + minX) * k) / 2, y: (r.height - (maxY + minY) * k) / 2 });
  }, [project.nodes, floorId, floor, u, onView]);

  const zoomAt = useCallback(
    (factor: number, cx?: number, cy?: number) => {
      const svg = svgRef.current;
      if (!svg) return;
      const r = svg.getBoundingClientRect();
      const px = cx === undefined ? r.width / 2 : cx - r.left;
      const py = cy === undefined ? r.height / 2 : cy - r.top;
      const v = viewRef.current;
      const k = Math.min(8, Math.max(0.03, v.k * factor));
      const f = k / v.k;
      onView({ k, x: px - (px - v.x) * f, y: py - (py - v.y) * f });
    },
    [onView],
  );

  useImperativeHandle(handle, () => ({ fit, zoomBy: (f) => zoomAt(f), svg: () => svgRef.current }), [fit, zoomAt]);

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 0 && e.deltaMode === 1) {
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
      } else if (Math.abs(e.deltaX) > 0 || !Number.isInteger(e.deltaY)) {
        const v = viewRef.current;
        onView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      } else {
        zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
      }
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [zoomAt, onView]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        spaceRef.current = true;
      }
      if (e.key === 'Escape') {
        setPending(null);
        setCalib(null);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const targetOf = (el: EventTarget | null) => {
    const t = el as Element | null;
    const node = t?.closest?.('[data-node]')?.getAttribute('data-node') ?? undefined;
    const edge = node ? undefined : t?.closest?.('[data-edge]')?.getAttribute('data-edge') ?? undefined;
    return { node, edge };
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button === 2) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = toWorld(e.clientX, e.clientY);
    const { node, edge } = targetOf(e.target);
    const startPan = () => {
      dragRef.current = { kind: 'pan', cx: e.clientX, cy: e.clientY, view: viewRef.current };
      setPanning(true);
    };
    if (e.button === 1 || spaceRef.current || tool === 'pan') return startPan();

    if (mode === 'simulate' && (tool === 'fire' || tool === 'block' || tool === 'route')) {
      if (node || edge) props.onSimClick?.({ node, edge });
      else startPan();
      return;
    }
    if (mode !== 'design') {
      if (node) onSelect({ nodes: new Set([node]), edges: new Set() });
      else if (edge) onSelect({ nodes: new Set(), edges: new Set([edge]) });
      else {
        onSelect(EMPTY_SELECTION);
        startPan();
      }
      return;
    }

    const kind = NODE_TOOLS[tool];
    if (tool === 'calibrate') {
      if (!calib) setCalib(p);
      else {
        props.onCalibrate?.(Math.hypot(p.x - calib.x, p.y - calib.y));
        setCalib(null);
      }
      return;
    }
    if (tool === 'connect') {
      if (!node) return setPending(null);
      if (pending && pending !== node) {
        store.update((pr) => connect(pr, pending, node));
        onSelect({ nodes: new Set([node]), edges: new Set() });
      }
      setPending(node);
      return;
    }
    if (kind && !node && !edge) {
      const from = e.shiftKey && selection.nodes.size === 1 ? [...selection.nodes][0] : undefined;
      const id = uid('n');
      const name = nextNodeName(project, kind);
      const x = snapV(p.x);
      const y = snapV(p.y);
      store.update((pr) => addNode(pr, { id, name, kind, floorId, x, y, occupants: kind === 'room' ? 10 : 0 }, from));
      onSelect({ nodes: new Set([id]), edges: new Set() });
      return;
    }
    // Select tool (or a node tool clicking an existing item).
    if (node) {
      let nodes = selection.nodes;
      if (e.shiftKey) {
        nodes = new Set(nodes);
        if (nodes.has(node)) nodes.delete(node);
        else nodes.add(node);
        onSelect({ nodes, edges: selection.edges });
      } else if (!nodes.has(node)) {
        nodes = new Set([node]);
        onSelect({ nodes, edges: new Set() });
      }
      const base = new Map(project.nodes.filter((n) => nodes.has(n.id) && n.floorId === floorId).map((n) => [n.id, { x: n.x, y: n.y }]));
      const anchor = base.get(node);
      if (anchor) dragRef.current = { kind: 'move', cx: e.clientX, cy: e.clientY, base, anchor, moved: false, key: `move-${Date.now()}` };
      return;
    }
    if (edge) {
      if (e.shiftKey) {
        const edges = new Set(selection.edges);
        if (edges.has(edge)) edges.delete(edge);
        else edges.add(edge);
        onSelect({ nodes: selection.nodes, edges });
      } else onSelect({ nodes: new Set(), edges: new Set([edge]) });
      return;
    }
    if (tool === 'select') {
      if (!e.shiftKey) onSelect(EMPTY_SELECTION);
      dragRef.current = { kind: 'marquee', x0: p.x, y0: p.y, x1: p.x, y1: p.y, additive: e.shiftKey };
    } else startPan();
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = toWorld(e.clientX, e.clientY);
    setCursor(p);
    props.onCursor?.(p);
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === 'pan') {
      onView({ ...d.view, x: d.view.x + e.clientX - d.cx, y: d.view.y + e.clientY - d.cy });
    } else if (d.kind === 'move') {
      const k = viewRef.current.k;
      const rawDx = (e.clientX - d.cx) / k;
      const rawDy = (e.clientY - d.cy) / k;
      if (!d.moved && Math.hypot(rawDx * k, rawDy * k) < 3) return;
      d.moved = true;
      const dx = snapV(d.anchor.x + rawDx) - d.anchor.x;
      const dy = snapV(d.anchor.y + rawDy) - d.anchor.y;
      store.update((pr) => moveNodes(pr, d.base, dx, dy), d.key);
    } else if (d.kind === 'marquee') {
      d.x1 = p.x;
      d.y1 = p.y;
      setMarquee({ x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) });
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setPanning(false);
    if (!d) return;
    if (d.kind === 'move' && d.moved) store.seal();
    if (d.kind === 'marquee') {
      setMarquee(null);
      const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
      if (x1 - x0 < 2 && y1 - y0 < 2) return;
      const inside = project.nodes.filter((n) => n.floorId === floorId && n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1).map((n) => n.id);
      const nodes = new Set(d.additive ? [...selection.nodes, ...inside] : inside);
      const edges = new Set(project.edges.filter((e) => nodes.has(e.a) && nodes.has(e.b)).map((e) => e.id));
      onSelect({ nodes, edges: d.additive ? new Set([...selection.edges, ...edges]) : edges });
    }
  };

  const pendingNode = pending ? project.nodes.find((n) => n.id === pending) : null;
  const cursorClass = panning
    ? 'is-panning'
    : tool === 'pan'
      ? 'is-pan'
      : NODE_TOOLS[tool] || tool === 'calibrate'
        ? 'is-place'
        : tool === 'connect' || tool === 'fire' || tool === 'block' || tool === 'route'
          ? 'is-pick'
          : '';

  if (!floor) return null;
  const k = view.k;
  return (
    <svg
      ref={svgRef}
      className={`plan-view ${cursorClass}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        setCursor(null);
        props.onCursor?.(null);
      }}
      onContextMenu={(e) => e.preventDefault()}
      role="application"
      aria-label={`Floor plan: ${floor.name}`}
    >
      <defs>
        <pattern id="grid-minor" width={u} height={u} patternUnits="userSpaceOnUse">
          <path d={`M${u} 0H0V${u}`} className="grid-minor" fill="none" strokeWidth={1 / k} />
        </pattern>
        <pattern id="grid-major" width={u * 5} height={u * 5} patternUnits="userSpaceOnUse">
          {u * k >= 6 && <rect width={u * 5} height={u * 5} fill="url(#grid-minor)" />}
          <path d={`M${u * 5} 0H0V${u * 5}`} className="grid-major" fill="none" strokeWidth={1 / k} />
        </pattern>
      </defs>
      <g transform={`translate(${view.x} ${view.y}) scale(${k})`}>
        {showGrid && <rect x={-1e5} y={-1e5} width={2e5} height={2e5} fill="url(#grid-major)" className="grid-rect" />}
        <PlanLayer
          project={project}
          floor={floor}
          floorIndex={floorIndex}
          selectedNodes={selection.nodes}
          selectedEdges={selection.edges}
          overlay={overlay}
          zoom={k}
        />
        {pendingNode && cursor && (
          <line className="rubber" x1={pendingNode.x} y1={pendingNode.y} x2={cursor.x} y2={cursor.y} strokeWidth={2 / k} strokeDasharray={`${6 / k} ${4 / k}`} />
        )}
        {calib && cursor && (
          <g className="calib">
            <line x1={calib.x} y1={calib.y} x2={cursor.x} y2={cursor.y} strokeWidth={2 / k} />
            <circle cx={calib.x} cy={calib.y} r={4 / k} />
            <text x={cursor.x + 8 / k} y={cursor.y - 8 / k} fontSize={12 / k}>
              {(Math.hypot(cursor.x - calib.x, cursor.y - calib.y) / u).toFixed(2)} m
            </text>
          </g>
        )}
        {marquee && <rect className="marquee" x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} strokeWidth={1 / k} />}
      </g>
    </svg>
  );
}
