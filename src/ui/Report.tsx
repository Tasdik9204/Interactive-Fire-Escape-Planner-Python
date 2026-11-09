import type { AuditResult } from '../engine/audit';
import type { SimEntry } from '../app/useSimulation';
import { simKey } from '../app/useSimulation';
import { activeScenario, nodeMap } from '../model/project';
import type { Project } from '../model/types';
import { BRAND } from '../brand';
import { Bars, EvacCurve, fmtM, fmtTime } from './common';
import { Icon } from './Icon';
import { SEVERITY, scoreTone } from './panels/AuditPanel';
import { StaticPlan } from './StaticPlan';

interface Props {
  project: Project;
  audit: AuditResult;
  entries: Record<string, SimEntry>;
  running: boolean;
  onRunAll: () => void;
}

export function Report({ project, audit, entries, running, onRunAll }: Props) {
  const s = project.settings;
  const byId = nodeMap(project);
  const name = (id: string) => byId.get(id)?.name ?? '?';
  const active = activeScenario(project);
  const fresh = (id: string) => {
    const e = entries[id];
    return e && e.key === simKey(project, id) ? e : undefined;
  };
  const missing = project.scenarios.some((sc) => !fresh(sc.id)?.result);
  const activeResult = fresh(active.id)?.result;
  const labels = new Map(
    audit.rooms.map((r) => [
      r.nodeId,
      r.primary
        ? { text: fmtM(r.primary.distance), tone: (r.primary.distance > s.maxTravelDistance ? 'warn' : 'ok') as 'ok' | 'warn' }
        : { text: 'no exit', tone: 'bad' as const },
    ]),
  );
  const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="report-scroll">
      <div className="report-actions no-print">
        <button type="button" className="btn" onClick={onRunAll} disabled={running}>
          <Icon name="restart" size={16} /> {running ? 'Simulating…' : missing ? 'Simulate all scenarios' : 'Re-run all scenarios'}
        </button>
        <button type="button" className="btn is-primary" onClick={() => window.print()}>
          <Icon name="printer" size={16} /> Print or save as PDF
        </button>
      </div>
      <article className="report">
        <header className="report-head">
          <div>
            <p className="report-kicker">{BRAND.name} · Fire escape assessment</p>
            <h1>{project.name}</h1>
            <p className="muted">{date} · {project.floors.length} floor{project.floors.length > 1 ? 's' : ''} · {audit.stats.occupants} occupants</p>
          </div>
          <div className={`score is-${scoreTone(audit.score)}`}>
            <div className="score-num">{audit.score}<small>/100</small></div>
          </div>
        </header>

        <section>
          <h2>Summary</h2>
          <dl className="kpis is-report">
            <div><dt>Exits</dt><dd>{audit.stats.exits}</dd></div>
            <div><dt>Longest travel to an exit</dt><dd>{fmtM(audit.stats.maxTravel)}</dd></div>
            <div><dt>Exit discharge time</dt><dd>{Number.isFinite(audit.stats.flowTime) ? `${Math.ceil(audit.stats.flowTime)} s` : '—'}</dd></div>
            <div><dt>Findings</dt><dd>{audit.findings.filter((f) => f.severity !== 'info').length}</dd></div>
          </dl>
        </section>

        <section>
          <h2>Scenario results</h2>
          {missing && <p className="muted small no-print">Some scenarios have not been simulated with the current plan. Use “Simulate all scenarios”.</p>}
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Scenario</th>
                <th scope="col">Fire origin</th>
                <th scope="col">Safe</th>
                <th scope="col">Trapped</th>
                <th scope="col">Last out</th>
                <th scope="col">95% out</th>
                <th scope="col">In smoke</th>
              </tr>
            </thead>
            <tbody>
              {project.scenarios.map((sc) => {
                const r = fresh(sc.id)?.result?.summary;
                return (
                  <tr key={sc.id}>
                    <td>{sc.name}</td>
                    <td>{sc.fireSources.length ? sc.fireSources.map((f) => name(f.nodeId)).join(', ') : 'None (drill)'}</td>
                    <td>{r ? `${r.evacuated + r.sheltered}/${r.total}` : '—'}</td>
                    <td className={r && r.trapped > 0 ? 'tone-bad' : ''}>{r ? r.trapped : '—'}</td>
                    <td className={r && r.totalTime > s.targetEvacTime ? 'tone-warn' : ''}>{r ? fmtTime(r.totalTime) : '—'}</td>
                    <td>{r ? fmtTime(r.p95Time) : '—'}</td>
                    <td>{r ? r.peopleInSmoke : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {activeResult && (
            <div className="report-charts">
              <div>
                <h3>{active.name}: people safe over time</h3>
                <EvacCurve curve={activeResult.summary.curve} total={activeResult.summary.total} target={s.targetEvacTime} height={170} />
              </div>
              <div>
                <h3>Exit use</h3>
                <Bars rows={activeResult.summary.exits.filter((e) => e.count > 0).map((e) => ({ id: e.id, label: e.name, value: e.count }))} />
              </div>
            </div>
          )}
        </section>

        {project.floors.map((f) => (
          <section key={f.id} className="report-floor">
            <h2>{f.name}</h2>
            <StaticPlan
              project={project}
              floorId={f.id}
              overlay={{ labels, fireSources: new Set(active.fireSources.map((x) => x.nodeId)) }}
            />
            <p className="small muted">Labels show the walking distance from each room to its nearest exit.</p>
          </section>
        ))}

        <section>
          <h2>Findings</h2>
          {audit.findings.length === 0 ? (
            <p>No problems found against the limits below.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Severity</th>
                  <th scope="col">Finding</th>
                </tr>
              </thead>
              <tbody>
                {audit.findings.map((fi) => (
                  <tr key={fi.id}>
                    <td className={`sev is-${fi.severity}`}>{SEVERITY[fi.severity].label}</td>
                    <td>
                      <strong>{fi.title}</strong>
                      <br />
                      <span className="small">{fi.detail}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h2>Room escape routes</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Room</th>
                <th scope="col">Floor</th>
                <th scope="col">People</th>
                <th scope="col">Main route</th>
                <th scope="col">Alternative</th>
              </tr>
            </thead>
            <tbody>
              {audit.rooms.map((r) => (
                <tr key={r.nodeId}>
                  <td>{r.name}</td>
                  <td>{r.floor}</td>
                  <td>{r.occupants}</td>
                  <td>{r.primary ? `${[...r.primary.via, r.primary.exit].join(' → ')} (${fmtM(r.primary.distance)})` : 'None'}</td>
                  <td>{r.secondary ? `${r.secondary.exit} (${fmtM(r.secondary.distance)})` : 'None'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2>Assumptions</h2>
          <dl className="assumptions">
            <div><dt>Walking speed</dt><dd>{s.walkSpeed} m/s ({Math.round(s.stairSpeedFactor * 100)}% on stairs, {Math.round(s.smokeSpeedFactor * 100)}% in smoke)</dd></div>
            <div><dt>Door flow</dt><dd>{s.flowRate} people/s per metre of width</dd></div>
            <div><dt>Pre-movement</dt><dd>{s.preMovement} s + up to {s.preMovementSpread} s</dd></div>
            <div><dt>Fire spread</dt><dd>{s.fireSpreadRate} m/min after {s.flashover} s flashover</dd></div>
            <div><dt>Smoke spread</dt><dd>{s.smokeSpreadRate} m/min</dd></div>
            <div><dt>Safety margin</dt><dd>{s.safetyMargin} s ahead of fire</dd></div>
            <div><dt>Travel distance limit</dt><dd>{s.maxTravelDistance} m</dd></div>
            <div><dt>Target evacuation time</dt><dd>{s.targetEvacTime} s</dd></div>
          </dl>
          <p className="small muted disclaimer">
            This report comes from a network model of the building and simplified fire, smoke and movement rates. It supports planning and drills. It does not
            replace a fire engineer's assessment or a check against your local fire code.
          </p>
        </section>
      </article>
    </div>
  );
}
