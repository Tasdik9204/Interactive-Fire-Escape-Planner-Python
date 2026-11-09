import { useRef } from 'react';
import { imageSize } from '../../app/io';
import { saveAsset } from '../../app/persist';
import type { ProjectStore } from '../../app/store';
import { connect, deleteItems, updateEdges, updateNodes } from '../../model/edit';
import { edgeLength, nodeMap, uid } from '../../model/project';
import { KIND_LABEL, NODE_KINDS, type NodeKind, type Project } from '../../model/types';
import { Field, NumberInput, Segmented, useToast } from '../common';
import { Icon, type IconName } from '../Icon';
import type { Selection, Tool } from '../PlanView';

export const KIND_ICON: Record<NodeKind, IconName> = { room: 'room', corridor: 'corridor', stair: 'stair', exit: 'exit', refuge: 'refuge' };
const DOORS = [0, 30, 60, 90, 120];

interface Props {
  project: Project;
  store: ProjectStore;
  floorId: string;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onTool: (t: Tool) => void;
}

export function DesignInspector({ project, store, floorId, selection, onSelect, onTool }: Props) {
  const nodes = project.nodes.filter((n) => selection.nodes.has(n.id));
  const edges = project.edges.filter((e) => selection.edges.has(e.id));
  if (nodes.length === 1 && edges.length === 0) return <NodePanel project={project} store={store} nodeId={nodes[0].id} onSelect={onSelect} />;
  if (nodes.length === 0 && edges.length === 1) return <EdgePanel project={project} store={store} edgeId={edges[0].id} onSelect={onSelect} />;
  if (nodes.length + edges.length > 1) return <MultiPanel project={project} store={store} selection={selection} onSelect={onSelect} />;
  return <FloorPanel project={project} store={store} floorId={floorId} onTool={onTool} />;
}

function NodePanel({ project, store, nodeId, onSelect }: { project: Project; store: ProjectStore; nodeId: string; onSelect: (s: Selection) => void }) {
  const node = project.nodes.find((n) => n.id === nodeId)!;
  const byId = nodeMap(project);
  const ids = new Set([nodeId]);
  const links = project.edges.filter((e) => e.a === nodeId || e.b === nodeId);
  const floorName = (fid: string) => project.floors.find((f) => f.id === fid)?.name ?? '';
  const otherStairs = node.kind === 'stair' ? project.nodes.filter((n) => n.kind === 'stair' && n.floorId !== node.floorId) : [];
  const linkedTo = (other: string) => links.find((e) => e.a === other || e.b === other);

  return (
    <div className="panel-section">
      <div className="panel-title">
        <Icon name={KIND_ICON[node.kind]} />
        <h3>{KIND_LABEL[node.kind]}</h3>
      </div>
      <Field label="Name">
        {(id) => (
          <input
            id={id}
            value={node.name}
            maxLength={120}
            onChange={(e) => store.update((p) => updateNodes(p, ids, { name: e.target.value }), `name-${nodeId}`)}
            onBlur={store.seal}
          />
        )}
      </Field>
      <Field label="Type">
        {() => (
          <Segmented
            label="Node type"
            value={node.kind}
            onChange={(kind) => store.update((p) => updateNodes(p, ids, { kind }))}
            options={NODE_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k].split(' ')[0], icon: KIND_ICON[k] }))}
          />
        )}
      </Field>
      {(node.kind === 'room' || node.kind === 'corridor') && (
        <Field label="Occupants" hint="People here when the alarm sounds.">
          {(id) => (
            <NumberInput
              id={id}
              value={node.occupants}
              min={0}
              max={10000}
              unit="people"
              onChange={(v) => store.update((p) => updateNodes(p, ids, { occupants: Math.round(v ?? 0) }), `occ-${nodeId}`)}
              onBlur={store.seal}
            />
          )}
        </Field>
      )}

      <h4 className="panel-sub">Connections ({links.length})</h4>
      {links.length === 0 && <p className="muted small">Not connected. Use the Connect tool (L) or hold Shift while placing.</p>}
      <ul className="link-list">
        {links.map((e) => {
          const other = byId.get(e.a === nodeId ? e.b : e.a);
          if (!other) return null;
          return (
            <li key={e.id}>
              <button type="button" className="link-btn" onClick={() => onSelect({ nodes: new Set(), edges: new Set([e.id]) })}>
                <Icon name={KIND_ICON[other.kind]} size={14} />
                <span>{other.name}</span>
                {other.floorId !== node.floorId && <span className="tag">{floorName(other.floorId)}</span>}
              </button>
              <span className="muted small">
                {edgeLength(e, byId, project.settings).toFixed(1)} m · {e.width} m wide{e.fireDoor ? ` · FD${e.fireDoor}` : ''}
              </span>
            </li>
          );
        })}
      </ul>

      {node.kind === 'stair' && (
        <>
          <h4 className="panel-sub">Stair links</h4>
          {otherStairs.length === 0 ? (
            <p className="muted small">Add a stair on another floor, then link it here to connect the floors.</p>
          ) : (
            <ul className="check-list">
              {otherStairs.map((s) => {
                const e = linkedTo(s.id);
                return (
                  <li key={s.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={!!e}
                        onChange={() => store.update((p) => (e ? deleteItems(p, new Set(), new Set([e.id])) : connect(p, nodeId, s.id)))}
                      />
                      {s.name} <span className="muted">· {floorName(s.floorId)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <div className="panel-actions">
        <button type="button" className="btn is-danger" onClick={() => { store.update((p) => deleteItems(p, ids, new Set())); onSelect({ nodes: new Set(), edges: new Set() }); }}>
          <Icon name="trash" size={16} /> Delete {KIND_LABEL[node.kind].toLowerCase()}
        </button>
      </div>
    </div>
  );
}

function EdgePanel({ project, store, edgeId, onSelect }: { project: Project; store: ProjectStore; edgeId: string; onSelect: (s: Selection) => void }) {
  const e = project.edges.find((x) => x.id === edgeId)!;
  const byId = nodeMap(project);
  const a = byId.get(e.a)!;
  const b = byId.get(e.b)!;
  const ids = new Set([edgeId]);
  const auto = edgeLength({ ...e, length: undefined }, byId, project.settings);
  const stair = a.floorId !== b.floorId;
  return (
    <div className="panel-section">
      <div className="panel-title">
        <Icon name={stair ? 'stair' : 'door'} />
        <h3>{stair ? 'Stair flight' : 'Connection'}</h3>
      </div>
      <p className="edge-ends">
        <button type="button" className="link-btn" onClick={() => onSelect({ nodes: new Set([a.id]), edges: new Set() })}>{a.name}</button>
        <span aria-hidden="true">↔</span>
        <button type="button" className="link-btn" onClick={() => onSelect({ nodes: new Set([b.id]), edges: new Set() })}>{b.name}</button>
      </p>
      <Field label="Clear width" hint={`Flow capacity ${(e.width * project.settings.flowRate).toFixed(1)} people/s.`}>
        {(id) => (
          <NumberInput id={id} value={e.width} min={0.1} max={50} step={0.1} unit="m" onChange={(v) => v && store.update((p) => updateEdges(p, ids, { width: v }), `w-${edgeId}`)} onBlur={store.seal} />
        )}
      </Field>
      <Field label="Walking length" hint={stair ? 'Leave empty to use the default flight length from Settings.' : 'Leave empty to measure from the drawing.'}>
        {(id) => (
          <NumberInput
            id={id}
            value={e.length}
            min={0.1}
            max={100000}
            step={0.5}
            unit="m"
            placeholder={auto.toFixed(1)}
            onChange={(v) => store.update((p) => updateEdges(p, ids, { length: v }), `l-${edgeId}`)}
            onBlur={store.seal}
          />
        )}
      </Field>
      <Field label="Fire door" hint="A fire-resisting door holds back fire and smoke for its rating.">
        {(id) => (
          <select id={id} value={e.fireDoor ?? 0} onChange={(ev) => store.update((p) => updateEdges(p, ids, { fireDoor: Number(ev.target.value) }))}>
            {DOORS.map((d) => (
              <option key={d} value={d}>
                {d === 0 ? 'None' : `${d} minutes (FD${d})`}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="panel-actions">
        <button type="button" className="btn is-danger" onClick={() => { store.update((p) => deleteItems(p, new Set(), ids)); onSelect({ nodes: new Set(), edges: new Set() }); }}>
          <Icon name="trash" size={16} /> Delete connection
        </button>
      </div>
    </div>
  );
}

function MultiPanel({ project, store, selection, onSelect }: { project: Project; store: ProjectStore; selection: Selection; onSelect: (s: Selection) => void }) {
  const rooms = project.nodes.filter((n) => selection.nodes.has(n.id) && n.kind === 'room');
  const sel = project.edges.filter((e) => selection.edges.has(e.id));
  const sameWidth = sel.length && sel.every((e) => e.width === sel[0].width) ? sel[0].width : undefined;
  return (
    <div className="panel-section">
      <div className="panel-title">
        <Icon name="layers" />
        <h3>
          {selection.nodes.size} points, {selection.edges.size} connections
        </h3>
      </div>
      {selection.nodes.size > 0 && (
        <Field label="Set type">
          {(id) => (
            <select id={id} value="" onChange={(e) => e.target.value && store.update((p) => updateNodes(p, selection.nodes, { kind: e.target.value as NodeKind }))}>
              <option value="">Choose…</option>
              {NODE_KINDS.map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </select>
          )}
        </Field>
      )}
      {rooms.length > 0 && (
        <Field label={`Occupants per room (${rooms.length} rooms)`}>
          {(id) => (
            <NumberInput
              id={id}
              value={rooms.every((r) => r.occupants === rooms[0].occupants) ? rooms[0].occupants : undefined}
              placeholder="mixed"
              min={0}
              max={10000}
              unit="people"
              onChange={(v) => v !== undefined && store.update((p) => updateNodes(p, new Set(rooms.map((r) => r.id)), { occupants: Math.round(v) }), 'multi-occ')}
              onBlur={store.seal}
            />
          )}
        </Field>
      )}
      {sel.length > 0 && (
        <Field label="Width of selected connections">
          {(id) => (
            <NumberInput id={id} value={sameWidth} placeholder="mixed" min={0.1} max={50} step={0.1} unit="m" onChange={(v) => v && store.update((p) => updateEdges(p, selection.edges, { width: v }), 'multi-w')} onBlur={store.seal} />
          )}
        </Field>
      )}
      <div className="panel-actions">
        <button type="button" className="btn is-danger" onClick={() => { store.update((p) => deleteItems(p, selection.nodes, selection.edges)); onSelect({ nodes: new Set(), edges: new Set() }); }}>
          <Icon name="trash" size={16} /> Delete selection
        </button>
      </div>
    </div>
  );
}

function FloorPanel({ project, store, floorId, onTool }: { project: Project; store: ProjectStore; floorId: string; onTool: (t: Tool) => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const floor = project.floors.find((f) => f.id === floorId)!;
  const onFloor = project.nodes.filter((n) => n.floorId === floorId);
  const setFloor = (patch: Partial<typeof floor>, key?: string) =>
    store.update((p) => ({ ...p, floors: p.floors.map((f) => (f.id === floorId ? { ...f, ...patch } : f)) }), key);
  const bg = floor.background;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return toast('Use a PNG, JPEG, WebP or GIF image. Export PDFs to an image first.', 'error');
    if (file.size > 15 * 1024 * 1024) return toast('Images must be under 15 MB.', 'error');
    try {
      const { width, height } = await imageSize(file);
      const id = uid('a');
      await saveAsset({ id, blob: file });
      // Fit the image to roughly 60 m wide at the current scale.
      const w = 60 * project.settings.scale;
      setFloor({ background: { assetId: id, x: 0, y: 0, width: w, height: (w * height) / width, opacity: 0.45 } });
      toast('Floor plan added. Calibrate the scale next.', 'success');
      onTool('calibrate');
    } catch {
      toast('That image could not be read.', 'error');
    }
  };

  return (
    <div className="panel-section">
      <div className="panel-title">
        <Icon name="layers" />
        <h3>{floor.name}</h3>
      </div>
      <Field label="Floor name">
        {(id) => <input id={id} value={floor.name} maxLength={120} onChange={(e) => setFloor({ name: e.target.value }, `floor-name-${floorId}`)} onBlur={store.seal} />}
      </Field>
      <dl className="stats-grid">
        <div><dt>Rooms</dt><dd>{onFloor.filter((n) => n.kind === 'room').length}</dd></div>
        <div><dt>People</dt><dd>{onFloor.reduce((a, n) => a + n.occupants, 0)}</dd></div>
        <div><dt>Exits</dt><dd>{onFloor.filter((n) => n.kind === 'exit').length}</dd></div>
        <div><dt>Stairs</dt><dd>{onFloor.filter((n) => n.kind === 'stair').length}</dd></div>
      </dl>

      <h4 className="panel-sub">Drawing underlay</h4>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
      {!bg ? (
        <>
          <p className="muted small">Trace over a scanned plan or CAD export. The image stays in this browser.</p>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            <Icon name="image" size={16} /> Add floor plan image
          </button>
        </>
      ) : (
        <>
          <Field label="Opacity">
            {(id) => <input id={id} type="range" min={0.05} max={1} step={0.05} value={bg.opacity} onChange={(e) => setFloor({ background: { ...bg, opacity: Number(e.target.value) } }, `bg-op-${floorId}`)} onPointerUp={store.seal} />}
          </Field>
          <div className="field-row">
            <Field label="X">{(id) => <NumberInput id={id} value={bg.x} unit="px" onChange={(v) => v !== undefined && setFloor({ background: { ...bg, x: v } }, `bg-x-${floorId}`)} onBlur={store.seal} />}</Field>
            <Field label="Y">{(id) => <NumberInput id={id} value={bg.y} unit="px" onChange={(v) => v !== undefined && setFloor({ background: { ...bg, y: v } }, `bg-y-${floorId}`)} onBlur={store.seal} />}</Field>
          </div>
          <Field label="Width" hint="Height follows the image's proportions.">
            {(id) => (
              <NumberInput id={id} value={bg.width} min={1} unit="px" onChange={(v) => v && setFloor({ background: { ...bg, width: v, height: (bg.height / bg.width) * v } }, `bg-w-${floorId}`)} onBlur={store.seal} />
            )}
          </Field>
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}><Icon name="image" size={16} /> Replace</button>
            <button type="button" className="btn is-danger" onClick={() => setFloor({ background: undefined })}><Icon name="trash" size={16} /> Remove</button>
          </div>
        </>
      )}

      <h4 className="panel-sub">Scale</h4>
      <p className="muted small">1 m = {project.settings.scale.toFixed(2)} plan px. Calibrate by clicking two points a known distance apart.</p>
      <button type="button" className="btn" onClick={() => onTool('calibrate')}>
        <Icon name="ruler" size={16} /> Calibrate scale
      </button>

      <h4 className="panel-sub">Drawing tips</h4>
      <ul className="tips">
        <li>Place rooms (R), corridor points (C), stairs (S), exits (X) and refuges (G).</li>
        <li>Hold <kbd>Shift</kbd> while placing to connect to the selected point.</li>
        <li>Connect tool (L): click two points. Drag empty space to box-select.</li>
        <li><kbd>Space</kbd>+drag or middle mouse pans; scroll zooms; <kbd>F</kbd> fits.</li>
      </ul>
    </div>
  );
}
