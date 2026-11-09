import type { AuditResult, Finding, Severity } from '../../engine/audit';
import type { Settings } from '../../model/types';
import { fmtM } from '../common';
import { Icon, type IconName } from '../Icon';

export const SEVERITY: Record<Severity, { icon: IconName; label: string }> = {
  critical: { icon: 'alert', label: 'Critical' },
  warning: { icon: 'alert', label: 'Warning' },
  info: { icon: 'info', label: 'Note' },
};

export function scoreTone(score: number) {
  return score >= 85 ? 'ok' : score >= 60 ? 'warn' : 'bad';
}

interface Props {
  audit: AuditResult;
  settings: Settings;
  activeFinding: string | null;
  onFinding: (f: Finding | null) => void;
  onRoom: (nodeId: string) => void;
}

export function AuditPanel({ audit, settings, activeFinding, onFinding, onRoom }: Props) {
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const f of audit.findings) counts[f.severity]++;
  return (
    <div className="panel-section">
      <div className={`score is-${scoreTone(audit.score)}`}>
        <div className="score-num" aria-label={`Plan score ${audit.score} out of 100`}>
          {audit.score}
          <small>/100</small>
        </div>
        <div>
          <strong>{audit.score >= 85 ? 'Good escape design' : audit.score >= 60 ? 'Needs attention' : 'Serious problems'}</strong>
          <p className="small muted">
            {counts.critical} critical · {counts.warning} warnings · {counts.info} notes
          </p>
        </div>
      </div>
      <dl className="stats-grid">
        <div><dt>Occupants</dt><dd>{audit.stats.occupants}</dd></div>
        <div><dt>Exits</dt><dd>{audit.stats.exits}</dd></div>
        <div><dt>Longest travel</dt><dd>{fmtM(audit.stats.maxTravel)}</dd></div>
        <div><dt>Exit discharge</dt><dd>{Number.isFinite(audit.stats.flowTime) ? `${Math.ceil(audit.stats.flowTime)} s` : '—'}</dd></div>
      </dl>
      <p className="small muted">
        Checked against: travel ≤ {settings.maxTravelDistance} m, width ≥ {settings.minWidth} m, discharge ≤ {settings.targetEvacTime} s. Change limits in Settings to match your local code.
      </p>

      <h4 className="panel-sub">Findings</h4>
      {audit.findings.length === 0 && (
        <p className="tone-ok small">
          <Icon name="check" size={14} /> No problems found.
        </p>
      )}
      <ul className="findings">
        {audit.findings.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              className={`finding is-${f.severity}${activeFinding === f.id ? ' is-active' : ''}`}
              onClick={() => onFinding(activeFinding === f.id ? null : f)}
              aria-pressed={activeFinding === f.id}
            >
              <span className="finding-sev">
                <Icon name={SEVERITY[f.severity].icon} size={14} />
                {SEVERITY[f.severity].label}
              </span>
              <strong>{f.title}</strong>
              <span className="small">{f.detail}</span>
            </button>
          </li>
        ))}
      </ul>

      <h4 className="panel-sub">Room escape routes</h4>
      <table className="room-table">
        <thead>
          <tr>
            <th scope="col">Room</th>
            <th scope="col">Main exit</th>
            <th scope="col">Alternative</th>
          </tr>
        </thead>
        <tbody>
          {audit.rooms.map((r) => (
            <tr key={r.nodeId} onClick={() => onRoom(r.nodeId)}>
              <td>
                <button type="button" className="link-btn" onClick={() => onRoom(r.nodeId)}>{r.name}</button>
              </td>
              <td className={!r.primary ? 'tone-bad' : r.primary.distance > settings.maxTravelDistance ? 'tone-warn' : ''}>
                {r.primary ? <>{r.primary.exit}<br /><small className="muted">{fmtM(r.primary.distance)}</small></> : 'None'}
              </td>
              <td className={!r.secondary ? 'muted' : ''}>{r.secondary ? <>{r.secondary.exit}<br /><small className="muted">{fmtM(r.secondary.distance)}</small></> : 'None'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
