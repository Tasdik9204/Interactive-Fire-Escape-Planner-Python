import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { download, exportProject, safeFileName, svgToPng } from '../app/io';
import { lastProjectId, loadProject, rememberLast, saveProject, storageAvailable } from '../app/persist';
import { useProjectStore } from '../app/store';
import { simKey, useSimulation } from '../app/useSimulation';
import { BRAND } from '../brand';
import { auditProject, type Finding } from '../engine/audit';
import { buildGraph } from '../engine/graph';
import { computeHazard, type Hazard } from '../engine/hazard';
import { blockedMasks, planRoute } from '../engine/routing';
import { AgentState } from '../engine/simulate';
import { addFloor, deleteFloor, deleteItems, duplicateNodes, moveFloor, moveNodes, toggleBlockedEdge, toggleBlockedNode, toggleFire } from '../model/edit';
import { activeScenario, createProject, uid } from '../model/project';
import type { Project } from '../model/types';
import { Dialog, Field, IconButton, NumberInput, fmtTime, useToast } from './common';
import { Icon, type IconName } from './Icon';
import { AuditPanel } from './panels/AuditPanel';
import { DesignInspector } from './panels/DesignInspector';
import { SimPanel } from './panels/SimPanel';
import type { Overlay } from './PlanLayer';
import { EMPTY_SELECTION, PlanView, type Mode, type PlanViewHandle, type Selection, type Tool, type View } from './PlanView';
import { ProjectsDialog } from './ProjectsDialog';
import { Report } from './Report';
import { SettingsDialog } from './SettingsDialog';
import { Timeline } from './Timeline';

const MODES: { id: Mode; label: string; icon: IconName }[] = [
  { id: 'design', label: 'Design', icon: 'edit' },
  { id: 'simulate', label: 'Simulate', icon: 'flame' },
  { id: 'audit', label: 'Audit', icon: 'check' },
  { id: 'report', label: 'Report', icon: 'file' },
];

const DESIGN_TOOLS: { id: Tool; label: string; icon: IconName; key: string }[] = [
  { id: 'select', label: 'Select and move', icon: 'select', key: 'V' },
  { id: 'pan', label: 'Pan', icon: 'hand', key: 'H' },
  { id: 'room', label: 'Room', icon: 'room', key: 'R' },
  { id: 'corridor', label: 'Corridor point', icon: 'corridor', key: 'C' },
  { id: 'stair', label: 'Stair', icon: 'stair', key: 'S' },
  { id: 'exit', label: 'Exit', icon: 'exit', key: 'X' },
  { id: 'refuge', label: 'Refuge area', icon: 'refuge', key: 'G' },
  { id: 'connect', label: 'Connect', icon: 'link', key: 'L' },
  { id: 'calibrate', label: 'Calibrate scale', icon: 'ruler', key: 'M' },
];
const SIM_TOOLS: { id: Tool; label: string; icon: IconName; key: string }[] = [
  { id: 'select', label: 'Inspect', icon: 'select', key: 'V' },
  { id: 'pan', label: 'Pan', icon: 'hand', key: 'H' },
  { id: 'fire', label: 'Start or remove a fire', icon: 'flame', key: 'F' },
  { id: 'block', label: 'Block or unblock for people', icon: 'block', key: 'B' },
  { id: 'route', label: 'Show escape route from a point', icon: 'route', key: 'P' },
];

type Theme = 'light' | 'dark' | 'system';
function readTheme(): Theme {
  try {
    const t = localStorage.getItem('exitwise:theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function App() {
  const toast = useToast();
  const store = useProjectStore(createProject());
  const { project } = store;
  const [loaded, setLoaded] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'memory' | 'error'>('saved');
  const [mode, setMode] = useState<Mode>('design');
  const [tool, setTool] = useState<Tool>('select');
  const [floorId, setFloorId] = useState(project.floors[0].id);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [views, setViews] = useState<Record<string, View>>({});
  const [snap, setSnap] = useState(true);
  const [grid, setGrid] = useState(true);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [calibPx, setCalibPx] = useState<number | null>(null);
  const [calibM, setCalibM] = useState<number | undefined>(5);
  const [finding, setFinding] = useState<Finding | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [routeStart, setRouteStart] = useState<{ node: string; at: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const planRef = useRef<PlanViewHandle>(null);

  // ---- Boot: reopen the last project, or show the project picker.
  useEffect(() => {
    (async () => {
      if (!(await storageAvailable())) {
        setSaveState('memory');
        toast('This browser blocks local storage. Work is kept until you close the tab: export to keep it.', 'error');
      }
      const id = lastProjectId();
      const p = id ? await loadProject(id).catch(() => null) : null;
      if (p) openProject(p);
      else setProjectsOpen(true);
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openProject = useCallback(
    (p: Project) => {
      store.load(p);
      setFloorId(p.floors[0].id);
      setSelection(EMPTY_SELECTION);
      setViews({});
      setRouteStart(null);
      setFinding(null);
      setProjectsOpen(false);
      rememberLast(p.id);
    },
    [store],
  );

  // ---- Autosave (debounced).
  const firstSave = useRef(true);
  useEffect(() => {
    if (!loaded) return;
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    if (saveState !== 'memory') setSaveState('saving');
    const t = setTimeout(() => {
      saveProject(project)
        .then(() => setSaveState((s) => (s === 'memory' ? s : 'saved')))
        .catch(() => setSaveState('error'));
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, loaded]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (saveState === 'saving' || saveState === 'memory' || saveState === 'error') e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveState]);

  // ---- Theme.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('exitwise:theme', theme);
    } catch {
      /* not remembered */
    }
  }, [theme]);

  // Keep the floor valid after undo, delete or load.
  const floor = project.floors.find((f) => f.id === floorId) ?? project.floors[0];
  useEffect(() => {
    if (floor.id !== floorId) setFloorId(floor.id);
  }, [floor.id, floorId]);

  // Drop selected ids that no longer exist.
  useEffect(() => {
    const nodeIds = new Set(project.nodes.map((n) => n.id));
    const edgeIds = new Set(project.edges.map((e) => e.id));
    if ([...selection.nodes].some((id) => !nodeIds.has(id)) || [...selection.edges].some((id) => !edgeIds.has(id))) {
      setSelection({ nodes: new Set([...selection.nodes].filter((id) => nodeIds.has(id))), edges: new Set([...selection.edges].filter((id) => edgeIds.has(id))) });
    }
  }, [project, selection]);

  const view = views[floor.id];
  const setView = useCallback((v: View) => setViews((vs) => ({ ...vs, [floor.id]: v })), [floor.id]);
  useEffect(() => {
    if (!view && (mode === 'design' || mode === 'simulate' || mode === 'audit')) requestAnimationFrame(() => planRef.current?.fit());
  }, [view, mode, floor.id]);

  const switchMode = (m: Mode) => {
    setMode(m);
    setTool('select');
    setFinding(null);
    setRouteStart(null);
  };

  // ---- Simulation.
  const scenario = activeScenario(project);
  const sim = useSimulation();
  const key = useMemo(() => simKey(project, scenario.id), [project, scenario.id]);
  const entry = sim.entries[scenario.id];
  const stale = !entry || entry.key !== key;
  const result = entry?.result;
  useEffect(() => {
    if (mode !== 'simulate' || !stale) return;
    const t = setTimeout(() => sim.run(project, [scenario.id]), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, key, stale]);

  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(5);
  const endTime = result ? result.frames[result.frames.length - 1].t : 0;
  useEffect(() => {
    if (t > endTime) setT(endTime);
  }, [endTime, t]);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const dt = ((now - last) / 1000) * speed;
      last = now;
      setT((cur) => {
        const next = cur + dt;
        if (next >= endTime) {
          setPlaying(false);
          return endTime;
        }
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, endTime]);

  // Hazard for overlays and route planning: from the result, or computed live when stale.
  const hazard = useMemo<{ ids: string[]; h: Hazard } | null>(() => {
    if (mode !== 'simulate') return null;
    if (result && !stale) return { ids: result.nodeIds, h: { fire: Float64Array.from(result.fire), smoke: Float64Array.from(result.smoke) } };
    const g = buildGraph(project);
    return { ids: g.ids, h: computeHazard(g, scenario, project.settings) };
  }, [mode, result, stale, project, scenario]);

  const frame = useMemo(() => {
    if (!result || stale || mode !== 'simulate') return null;
    const step = result.frameStep;
    const i = Math.min(result.frames.length - 1, Math.floor(t / step));
    const a = result.frames[i];
    const b = result.frames[Math.min(result.frames.length - 1, i + 1)];
    const r = b === a ? 0 : (t - a.t) / (b.t - a.t);
    if (r <= 0) return a;
    const xy = new Float32Array(a.xy.length);
    for (let k = 0; k < a.state.length; k++) {
      const same = a.floor[k] === b.floor[k];
      xy[2 * k] = same ? a.xy[2 * k] + (b.xy[2 * k] - a.xy[2 * k]) * r : a.xy[2 * k];
      xy[2 * k + 1] = same ? a.xy[2 * k + 1] + (b.xy[2 * k + 1] - a.xy[2 * k + 1]) * r : a.xy[2 * k + 1];
    }
    return { ...a, xy };
  }, [result, stale, mode, t]);

  const counts = useMemo(() => {
    if (!frame) return null;
    let safe = 0, trapped = 0, moving = 0;
    for (const s of frame.state) {
      if (s === AgentState.Evacuated || s === AgentState.Sheltered) safe++;
      else if (s === AgentState.Trapped) trapped++;
      else moving++;
    }
    return { safe, trapped, moving, total: frame.state.length };
  }, [frame]);

  const route = useMemo(() => {
    if (!routeStart || mode !== 'simulate') return null;
    const g = buildGraph(project);
    const start = g.index.get(routeStart.node);
    if (start === undefined) return null;
    const { bn, be } = blockedMasks(g, scenario.blockedNodes, scenario.blockedEdges);
    const r = planRoute({ g, hazard: computeHazard(g, scenario, project.settings), settings: project.settings, blockedNodes: bn, blockedEdges: be }, start, routeStart.at);
    return {
      start: routeStart.node,
      at: routeStart.at,
      route: r,
      names: r.path.map((i) => g.names[i]),
      nodes: new Set(r.path.map((i) => g.ids[i])),
      edges: new Set(r.edges.map((i) => g.edges[i].id)),
    };
  }, [routeStart, mode, project, scenario]);

  // ---- Audit.
  const audit = useMemo(() => (mode === 'audit' || mode === 'report' ? auditProject(project) : null), [mode, project]);

  // ---- Overlay per mode.
  const overlay = useMemo<Overlay | undefined>(() => {
    if (mode === 'simulate') {
      const hz = new Map<string, 1 | 2>();
      if (hazard) {
        hazard.ids.forEach((id, i) => {
          if (hazard.h.fire[i] <= t) hz.set(id, 2);
          else if (hazard.h.smoke[i] <= t) hz.set(id, 1);
        });
      }
      return {
        hazard: hz,
        agents: frame,
        fireSources: new Set(scenario.fireSources.map((f) => f.nodeId)),
        blockedNodes: new Set(scenario.blockedNodes),
        blockedEdges: new Set(scenario.blockedEdges),
        highlightEdges: hoverEdge ? new Set([hoverEdge]) : undefined,
        route: route ? { nodes: route.nodes, edges: route.edges } : null,
      };
    }
    if (mode === 'audit' && audit) {
      const labels = new Map<string, { text: string; tone: 'ok' | 'warn' | 'bad' }>();
      for (const r of audit.rooms) {
        labels.set(r.nodeId, r.primary ? { text: `${r.primary.distance.toFixed(0)} m`, tone: r.primary.distance > project.settings.maxTravelDistance ? 'warn' : 'ok' } : { text: 'no exit', tone: 'bad' });
      }
      return { labels, highlightNodes: finding ? new Set(finding.nodes) : undefined, highlightEdges: finding ? new Set(finding.edges) : undefined };
    }
    return undefined;
  }, [mode, hazard, t, frame, scenario, hoverEdge, route, audit, finding, project.settings.maxTravelDistance]);

  const onSimClick = ({ node, edge }: { node?: string; edge?: string }) => {
    if (tool === 'fire' && node) store.update((p) => toggleFire(p, node));
    if (tool === 'block') {
      if (node) store.update((p) => toggleBlockedNode(p, node));
      else if (edge) store.update((p) => toggleBlockedEdge(p, edge));
    }
    if (tool === 'route' && node) setRouteStart({ node, at: t });
  };

  const onFinding = (f: Finding | null) => {
    setFinding(f);
    const first = f?.nodes[0] ?? (f?.edges[0] ? project.edges.find((e) => e.id === f.edges[0])?.a : undefined);
    const n = first ? project.nodes.find((x) => x.id === first) : undefined;
    if (n && n.floorId !== floor.id) setFloorId(n.floorId);
  };

  // ---- Commands.
  const deleteSelection = () => {
    if (!selection.nodes.size && !selection.edges.size) return;
    store.update((p) => deleteItems(p, selection.nodes, selection.edges));
    setSelection(EMPTY_SELECTION);
  };
  const duplicateSelection = () => {
    if (!selection.nodes.size) return;
    const map = new Map([...selection.nodes].map((id) => [id, uid('n')]));
    store.update((p) => duplicateNodes(p, map, project.settings.scale * 2));
    setSelection({ nodes: new Set(map.values()), edges: new Set() });
  };
  const addNewFloor = () => {
    const id = uid('f');
    store.update((p) => addFloor(p, id, `Floor ${p.floors.length + 1}`));
    setFloorId(id);
    setSelection(EMPTY_SELECTION);
  };
  const removeFloor = (id: string) => {
    const f = project.floors.find((x) => x.id === id);
    const n = project.nodes.filter((x) => x.floorId === id).length;
    if (!f || project.floors.length <= 1) return;
    if (n && !confirm(`Delete ${f.name} and its ${n} points? You can undo this.`)) return;
    store.update((p) => deleteFloor(p, id));
  };
  const exportJson = async () => download(await exportProject(project), `${safeFileName(project.name)}.exitwise.json`);
  const exportPng = async () => {
    const svg = planRef.current?.svg();
    if (!svg) return toast('Open Design, Simulate or Audit to export the plan image.', 'error');
    const r = svg.getBoundingClientRect();
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim() || '#ffffff';
    try {
      download(await svgToPng(svg, Math.round(r.width * 2), Math.round(r.height * 2), bg), `${safeFileName(project.name)}-${safeFileName(floor.name)}.png`);
    } catch {
      toast('PNG export failed in this browser.', 'error');
    }
  };
  const applyCalibration = () => {
    if (!calibPx || !calibM || calibM <= 0) return;
    const scale = calibPx / calibM;
    store.update((p) => ({ ...p, settings: { ...p.settings, scale } }));
    setCalibPx(null);
    setTool('select');
    toast(`Scale set: 1 m = ${scale.toFixed(2)} px.`, 'success');
  };

  // ---- Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && k === 'y') {
        e.preventDefault();
        store.redo();
        return;
      }
      if (mod && k === 's') {
        e.preventDefault();
        exportJson();
        return;
      }
      if (mod && k === 'a' && mode === 'design') {
        e.preventDefault();
        const nodes = new Set(project.nodes.filter((n) => n.floorId === floor.id).map((n) => n.id));
        setSelection({ nodes, edges: new Set(project.edges.filter((x) => nodes.has(x.a) && nodes.has(x.b)).map((x) => x.id)) });
        return;
      }
      if (mod && k === 'd' && mode === 'design') {
        e.preventDefault();
        duplicateSelection();
        return;
      }
      if (mod) return;
      if ((k === 'delete' || k === 'backspace') && mode === 'design') {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (k === 'escape') {
        setSelection(EMPTY_SELECTION);
        setFinding(null);
        if (tool !== 'select') setTool('select');
        return;
      }
      if (k.startsWith('arrow') && mode === 'design' && selection.nodes.size) {
        e.preventDefault();
        const d = (e.shiftKey ? 1 : 0.1) * project.settings.scale;
        const base = new Map(project.nodes.filter((n) => selection.nodes.has(n.id)).map((n) => [n.id, { x: n.x, y: n.y }]));
        const dx = k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0;
        const dy = k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0;
        store.update((p) => moveNodes(p, base, dx, dy), 'nudge');
        return;
      }
      if (k === 'f' && mode !== 'simulate') return planRef.current?.fit();
      if (k === '0') return planRef.current?.fit();
      if (k === '=' || k === '+') return planRef.current?.zoomBy(1.25);
      if (k === '-') return planRef.current?.zoomBy(0.8);
      if (k === 'k' && mode === 'simulate') {
        if (t >= endTime) setT(0);
        return setPlaying((p) => !p);
      }
      const tools = mode === 'design' ? DESIGN_TOOLS : mode === 'simulate' ? SIM_TOOLS : [];
      const hit = tools.find((x) => x.key.toLowerCase() === k);
      if (hit) setTool(hit.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const tools = mode === 'design' ? DESIGN_TOOLS : mode === 'simulate' ? SIM_TOOLS : [];
  const showCanvas = mode !== 'report';

  return (
    <div className={`app mode-${mode}${panelOpen ? '' : ' panel-closed'}`}>
      <header className="topbar">
        <a className="brand" href="./" title={`${BRAND.name} home`}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <rect x="2" y="2" width="20" height="20" rx="5" className="brand-mark" />
            <path d="M8 7h8M8 12h6M8 17h8M8 7v10" className="brand-e" />
          </svg>
          <span>{BRAND.name}</span>
        </a>
        <input
          className="project-name"
          aria-label="Project name"
          value={project.name}
          maxLength={120}
          onChange={(e) => store.update((p) => ({ ...p, name: e.target.value }), 'project-name')}
          onBlur={store.seal}
        />
        <nav className="modes" aria-label="Workspace">
          {MODES.map((m) => (
            <button key={m.id} type="button" className={mode === m.id ? 'is-active' : ''} aria-current={mode === m.id ? 'page' : undefined} onClick={() => switchMode(m.id)}>
              <Icon name={m.icon} size={16} />
              <span>{m.label}</span>
            </button>
          ))}
        </nav>
        <div className="topbar-actions">
          <span className={`save-state is-${saveState}`} role="status">
            {saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : saveState === 'memory' ? 'Not saved (private mode)' : 'Save failed'}
          </span>
          <IconButton icon="undo" label="Undo" shortcut="Ctrl+Z" onClick={store.undo} disabled={!store.canUndo} />
          <IconButton icon="redo" label="Redo" shortcut="Ctrl+Shift+Z" onClick={store.redo} disabled={!store.canRedo} />
          <span className="divider" />
          <IconButton icon="download" label="Export project file" shortcut="Ctrl+S" onClick={exportJson} />
          <IconButton icon="image" label="Export current view as PNG" onClick={exportPng} />
          <IconButton icon="printer" label="Report and PDF" onClick={() => switchMode('report')} />
          <span className="divider" />
          <IconButton icon="settings" label="Model settings" onClick={() => setSettingsOpen(true)} />
          <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} label={theme === 'dark' ? 'Light theme' : 'Dark theme'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
          <button type="button" className="btn btn-small" onClick={() => setProjectsOpen(true)}>
            <Icon name="folder" size={16} /> Projects
          </button>
        </div>
      </header>

      {showCanvas && (
        <aside className="rail" aria-label="Tools and floors">
          {tools.length > 0 && (
            <div className="tools" role="toolbar" aria-label="Tools" aria-orientation="vertical">
              {tools.map((x) => (
                <IconButton key={x.id} icon={x.icon} label={x.label} shortcut={x.key} active={tool === x.id} onClick={() => setTool(x.id)} />
              ))}
            </div>
          )}
          <div className="floors">
            <div className="floors-head">
              <span>Floors</span>
              {mode === 'design' && <IconButton icon="plus" label="Add floor" onClick={addNewFloor} />}
            </div>
            <ul>
              {[...project.floors].reverse().map((f) => {
                const i = project.floors.indexOf(f);
                return (
                  <li key={f.id} className={f.id === floor.id ? 'is-active' : ''}>
                    <button type="button" className="floor-btn" onClick={() => { setFloorId(f.id); setSelection(EMPTY_SELECTION); }} aria-current={f.id === floor.id}>
                      {f.name}
                    </button>
                    {mode === 'design' && f.id === floor.id && (
                      <span className="floor-tools">
                        <IconButton icon="chevronUp" label="Move floor up" onClick={() => store.update((p) => moveFloor(p, f.id, 1))} disabled={i === project.floors.length - 1} />
                        <IconButton icon="chevronDown" label="Move floor down" onClick={() => store.update((p) => moveFloor(p, f.id, -1))} disabled={i === 0} />
                        <IconButton icon="trash" label="Delete floor" tone="danger" onClick={() => removeFloor(f.id)} disabled={project.floors.length <= 1} />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
      )}

      <main className="stage">
        {showCanvas ? (
          <>
            <div className="canvas-wrap">
              <PlanView
                handle={planRef}
                project={project}
                store={store}
                floorId={floor.id}
                mode={mode}
                tool={tool}
                selection={selection}
                onSelect={setSelection}
                view={view ?? { x: 0, y: 0, k: 1 }}
                onView={setView}
                snap={snap}
                showGrid={grid}
                overlay={overlay}
                onSimClick={onSimClick}
                onCalibrate={(px) => setCalibPx(px)}
                onCursor={setCursor}
              />
              {project.nodes.filter((n) => n.floorId === floor.id).length === 0 && mode === 'design' && (
                <div className="empty-hint">
                  <Icon name="room" size={28} />
                  <p>
                    <strong>{floor.name} is empty.</strong> Pick Room (R) and click to place one, or add a floor plan image to trace in the panel on the right.
                  </p>
                </div>
              )}
              {tool === 'calibrate' && <div className="tool-hint">Click two points a known distance apart.</div>}
              {tool === 'connect' && <div className="tool-hint">Click a point, then another to connect them. Esc to stop.</div>}
              {tool === 'fire' && <div className="tool-hint">Click a room or point to start a fire there. Click again to remove it.</div>}
              {tool === 'block' && <div className="tool-hint">Click a point or connection people cannot use (debris, locked door).</div>}
              {tool === 'route' && <div className="tool-hint">Click any point to see its escape route at {fmtTime(t)}.</div>}
              <div className="zoom-ctrl">
                <IconButton icon="plus" label="Zoom in" shortcut="+" onClick={() => planRef.current?.zoomBy(1.25)} />
                <IconButton icon="minus" label="Zoom out" shortcut="-" onClick={() => planRef.current?.zoomBy(0.8)} />
                <IconButton icon="fit" label="Fit to screen" shortcut="0" onClick={() => planRef.current?.fit()} />
              </div>
            </div>
            {mode === 'simulate' && (
              <Timeline t={t} end={endTime} playing={playing} speed={speed} onT={(v) => { setT(v); }} onPlay={(p) => { if (p && t >= endTime) setT(0); setPlaying(p); }} onSpeed={setSpeed} counts={counts} />
            )}
            <footer className="statusbar">
              <span>{cursor ? `${(cursor.x / project.settings.scale).toFixed(1)}, ${(cursor.y / project.settings.scale).toFixed(1)} m` : '—'}</span>
              <span>{Math.round((view?.k ?? 1) * 100)}%</span>
              {mode === 'design' && (
                <>
                  <label className="toggle"><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Snap 0.5 m</label>
                  <label className="toggle"><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> Grid</label>
                </>
              )}
              <span className="grow" />
              <span>
                {project.nodes.length} points · {project.edges.length} connections · {project.nodes.reduce((a, n) => a + n.occupants, 0)} people
              </span>
            </footer>
          </>
        ) : (
          audit && <Report project={project} audit={audit} entries={sim.entries} running={sim.running} onRunAll={() => sim.run(project, project.scenarios.map((s) => s.id))} />
        )}
      </main>

      {showCanvas && (
        <aside className="panel" aria-label="Inspector">
          <button type="button" className="panel-toggle" onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen} aria-label={panelOpen ? 'Hide panel' : 'Show panel'}>
            <Icon name="panel" size={16} />
          </button>
          <div className="panel-scroll">
            {mode === 'design' && <DesignInspector project={project} store={store} floorId={floor.id} selection={selection} onSelect={setSelection} onTool={setTool} />}
            {mode === 'simulate' && (
              <SimPanel
                project={project}
                store={store}
                result={stale ? undefined : result}
                error={!stale ? entry?.error : undefined}
                running={sim.running}
                stale={stale && !!result}
                onRun={() => sim.run(project, [scenario.id])}
                onHighlightEdge={setHoverEdge}
                route={route}
                onClearRoute={() => setRouteStart(null)}
              />
            )}
            {mode === 'audit' && audit && (
              <AuditPanel
                audit={audit}
                settings={project.settings}
                activeFinding={finding?.id ?? null}
                onFinding={onFinding}
                onRoom={(id) => {
                  const n = project.nodes.find((x) => x.id === id);
                  if (n) setFloorId(n.floorId);
                  setSelection({ nodes: new Set([id]), edges: new Set() });
                }}
              />
            )}
          </div>
        </aside>
      )}

      <ProjectsDialog open={projectsOpen} canClose={loaded && lastProjectId() !== null} currentId={project.id} onClose={() => setProjectsOpen(false)} onOpen={openProject} />
      <SettingsDialog open={settingsOpen} onClose={() => { setSettingsOpen(false); store.seal(); }} settings={project.settings} store={store} />
      <Dialog
        open={calibPx !== null}
        onClose={() => setCalibPx(null)}
        title="Calibrate scale"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setCalibPx(null)}>Cancel</button>
            <button type="button" className="btn is-primary" onClick={applyCalibration} disabled={!calibM}>Set scale</button>
          </>
        }
      >
        <p className="small muted">You measured {calibPx?.toFixed(0)} plan px. How long is that in reality?</p>
        <Field label="Real distance">
          {(id) => <NumberInput id={id} value={calibM} min={0.01} max={100000} step={0.1} unit="m" onChange={setCalibM} />}
        </Field>
        <p className="small muted">Points keep their drawn positions; lengths, room sizes and the grid change to the new scale.</p>
      </Dialog>
    </div>
  );
}
