import { useState } from 'react';
import type { SimResult } from '../../engine/simulate';
import type { Route } from '../../engine/routing';
import type { ProjectStore } from '../../app/store';
import { toggleBlockedEdge, toggleBlockedNode, toggleFire, updateScenario } from '../../model/edit';
import { activeScenario, createScenario, nodeMap, uid } from '../../model/project';
import type { Project } from '../../model/types';
import { Bars, EvacCurve, Field, NumberInput, fmtM, fmtTime } from '../common';
import { Icon } from '../Icon';

interface Props {
  project: Project;
  store: ProjectStore;
  result?: SimResult;
  error?: string;
  running: boolean;
  stale: boolean;
  onRun: () => void;
  onHighlightEdge: (id: string | null) => void;
  route: { start: string; at: number; route: Route; names: string[] } | null;
  onClearRoute: () => void;
}

export function SimPanel({ project, store, result, error, running, stale, onRun, onHighlightEdge, route, onClearRoute }: Props) {
  const sc = activeScenario(project);
  const byId = nodeMap(project);
  const name = (id: string) => byId.get(id)?.name ?? '?';
  const [renaming, setRenaming] = useState(false);
  const s = result?.summary;

  const addScenario = (copy: boolean) => {
    const id = uid('s');
    store.update((p) => {
      const base = copy ? { ...activeScenario(p), name: `${activeScenario(p).name} (copy)` } : createScenario(`Scenario ${p.scenarios.length + 1}`);
      return { ...p, scenarios: [...p.scenarios, { ...base, id }], activeScenarioId: id };
    });
  };
  const deleteScenario = () => {
    if (project.scenarios.length <= 1) return;
    if (!confirm(`Delete scenario "${sc.name}"?`)) return;
    store.update((p) => {
      const scenarios = p.scenarios.filter((x) => x.id !== sc.id);
      return { ...p, scenarios, activeScenarioId: scenarios[0].id };
    });
  };

  return (
    <div className="panel-section">
      <div className="panel-title">
        <Icon name="flame" />
        <h3>Scenario</h3>
      </div>
      <div className="scenario-row">
        {renaming ? (
          <input
            autoFocus
            aria-label="Scenario name"
            value={sc.name}
            maxLength={120}
            onChange={(e) => store.update((p) => updateScenario(p, (x) => ({ ...x, name: e.target.value })), `sc-name-${sc.id}`)}
            onBlur={() => { setRenaming(false); store.seal(); }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <select aria-label="Active scenario" value={sc.id} onChange={(e) => store.update((p) => ({ ...p, activeScenarioId: e.target.value }))}>
            {project.scenarios.map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </select>
        )}
        <div className="btn-group">
          <button type="button" className="icon-btn" title="Rename scenario" aria-label="Rename scenario" onClick={() => setRenaming(true)}><Icon name="edit" size={16} /></button>
          <button type="button" className="icon-btn" title="New scenario" aria-label="New scenario" onClick={() => addScenario(false)}><Icon name="plus" size={16} /></button>
          <button type="button" className="icon-btn" title="Duplicate scenario" aria-label="Duplicate scenario" onClick={() => addScenario(true)}><Icon name="copy" size={16} /></button>
          <button type="button" className="icon-btn is-danger" title="Delete scenario" aria-label="Delete scenario" disabled={project.scenarios.length <= 1} onClick={deleteScenario}><Icon name="trash" size={16} /></button>
        </div>
      </div>

      <h4 className="panel-sub">Fire origins</h4>
      {sc.fireSources.length === 0 && <p className="muted small">No fire. Pick the Fire tool (F) and click a room, or run a drill with no fire.</p>}
      <ul className="source-list">
        {sc.fireSources.map((f) => (
          <li key={f.nodeId}>
            <Icon name="flame" size={14} className="tone-fire" />
            <span className="grow">{name(f.nodeId)}</span>
            <label className="small muted" htmlFor={`ig-${f.nodeId}`}>at</label>
            <NumberInput
              id={`ig-${f.nodeId}`}
              value={f.time}
              min={0}
              max={36000}
              unit="s"
              onChange={(v) => store.update((p) => updateScenario(p, (x) => ({ ...x, fireSources: x.fireSources.map((y) => (y.nodeId === f.nodeId ? { ...y, time: v ?? 0 } : y)) })), `ig-${f.nodeId}`)}
              onBlur={store.seal}
            />
            <button type="button" className="icon-btn" aria-label={`Remove fire in ${name(f.nodeId)}`} onClick={() => store.update((p) => toggleFire(p, f.nodeId))}><Icon name="x" size={14} /></button>
          </li>
        ))}
      </ul>

      {(sc.blockedNodes.length > 0 || sc.blockedEdges.length > 0) && (
        <>
          <h4 className="panel-sub">Blocked for people</h4>
          <div className="chips">
            {sc.blockedNodes.map((id) => (
              <button key={id} type="button" className="chip" onClick={() => store.update((p) => toggleBlockedNode(p, id))} aria-label={`Unblock ${name(id)}`}>
                {name(id)} <Icon name="x" size={12} />
              </button>
            ))}
            {sc.blockedEdges.map((id) => {
              const e = project.edges.find((x) => x.id === id);
              return e ? (
                <button key={id} type="button" className="chip" onClick={() => store.update((p) => toggleBlockedEdge(p, id))} aria-label="Unblock connection">
                  {name(e.a)} – {name(e.b)} <Icon name="x" size={12} />
                </button>
              ) : null;
            })}
          </div>
        </>
      )}

      <div className="field-row">
        <Field label="Random seed" hint="Same seed, same result.">
          {(id) => <NumberInput id={id} value={sc.seed} min={1} max={2 ** 31 - 1} onChange={(v) => v && store.update((p) => updateScenario(p, (x) => ({ ...x, seed: Math.round(v) })), `seed-${sc.id}`)} onBlur={store.seal} />}
        </Field>
        <button type="button" className="btn btn-inline" onClick={() => store.update((p) => updateScenario(p, (x) => ({ ...x, seed: 1 + Math.floor(Math.random() * 1e6) })))}>
          <Icon name="dice" size={16} /> New seed
        </button>
      </div>

      {route && (
        <div className="route-card">
          <div className="route-head">
            <strong>Route from {route.names[0]}</strong>
            <button type="button" className="icon-btn" aria-label="Clear route" onClick={onClearRoute}><Icon name="x" size={14} /></button>
          </div>
          {route.route.kind === 'none' ? (
            <p className="tone-bad small">No way out at {fmtTime(route.at)}. Everyone here must shelter in place.</p>
          ) : (
            <>
              <p className={`small ${route.route.kind === 'safe' ? 'tone-ok' : route.route.kind === 'refuge' ? 'tone-warn' : 'tone-bad'}`}>
                {route.route.kind === 'safe' && 'Safe route to an exit, ahead of the fire.'}
                {route.route.kind === 'refuge' && 'No safe exit route. Go to the refuge area and wait.'}
                {route.route.kind === 'risky' && 'Only a risky route: it beats the fire by less than the safety margin.'}
              </p>
              <ol className="route-steps">
                {route.names.map((n, i) => <li key={i}>{n}</li>)}
              </ol>
              <p className="small muted">
                {fmtM(route.route.distance)} · leave {fmtTime(route.at)} · arrive {fmtTime(route.route.eta)}
                {route.route.smokeTime > 0 && ` · ${Math.round(route.route.smokeTime)} s in smoke`}
              </p>
            </>
          )}
        </div>
      )}

      <div className="panel-title results-title">
        <Icon name="users" />
        <h3>Results</h3>
        <button type="button" className="btn btn-small" onClick={onRun} disabled={running}>
          <Icon name="restart" size={14} /> {running ? 'Running…' : 'Re-run'}
        </button>
      </div>
      {error && <p className="tone-bad small">Simulation failed: {error}</p>}
      {stale && !running && <p className="muted small">The plan changed. Results update in a moment.</p>}
      {!s && !error && <p className="muted small">{running ? 'Simulating…' : 'Add rooms with occupants and an exit to simulate.'}</p>}
      {s && (
        <>
          <dl className="kpis">
            <div className={s.trapped + s.stranded > 0 ? 'is-bad' : 'is-ok'}>
              <dt>Safe</dt>
              <dd>{s.evacuated + s.sheltered}<small>/{s.total}</small></dd>
            </div>
            <div className={s.trapped > 0 ? 'is-bad' : ''}>
              <dt>Trapped</dt>
              <dd>{s.trapped}</dd>
            </div>
            <div className={s.totalTime > project.settings.targetEvacTime ? 'is-warn' : ''}>
              <dt>Last person out</dt>
              <dd>{fmtTime(s.totalTime)}</dd>
            </div>
            <div>
              <dt>95% out by</dt>
              <dd>{fmtTime(s.p95Time)}</dd>
            </div>
          </dl>
          {(s.sheltered > 0 || s.stranded > 0 || s.peopleInSmoke > 0) && (
            <ul className="notes small">
              {s.sheltered > 0 && <li>{s.sheltered} waiting in refuge areas for rescue.</li>}
              {s.stranded > 0 && <li className="tone-bad">{s.stranded} could not find any way out.</li>}
              {s.peopleInSmoke > 0 && <li>{s.peopleInSmoke} people walked through smoke (longest {Math.round(s.maxSmokeTime)} s).</li>}
            </ul>
          )}
          <h4 className="panel-sub">People safe over time</h4>
          <EvacCurve curve={s.curve} total={s.total} target={project.settings.targetEvacTime} />
          <h4 className="panel-sub">Exit use</h4>
          <Bars rows={s.exits.filter((e) => e.count > 0 || byId.get(e.id)?.kind === 'exit').map((e) => ({ id: e.id, label: e.name, value: e.count, note: `Last person ${fmtTime(e.last)}` }))} />
          {s.bottlenecks.length > 0 && (
            <>
              <h4 className="panel-sub">Bottlenecks</h4>
              <ul className="bottlenecks" onPointerLeave={() => onHighlightEdge(null)}>
                {s.bottlenecks.map((b) => (
                  <li key={b.id} onPointerEnter={() => onHighlightEdge(b.id)}>
                    <span className="grow">{b.label}</span>
                    <span className="muted small">queue of {b.peakQueue}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
