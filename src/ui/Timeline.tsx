import { fmtTime } from './common';
import { Icon } from './Icon';

const SPEEDS = [1, 2, 5, 10, 30];

interface Props {
  t: number;
  end: number;
  playing: boolean;
  speed: number;
  onT: (t: number) => void;
  onPlay: (p: boolean) => void;
  onSpeed: (s: number) => void;
  counts: { safe: number; moving: number; trapped: number; total: number } | null;
}

export function Timeline({ t, end, playing, speed, onT, onPlay, onSpeed, counts }: Props) {
  return (
    <div className="timeline">
      <button type="button" className="icon-btn is-primary" onClick={() => onPlay(!playing)} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (K)' : 'Play (K)'}>
        <Icon name={playing ? 'pause' : 'play'} />
      </button>
      <button type="button" className="icon-btn" onClick={() => { onT(0); onPlay(false); }} aria-label="Back to start" title="Back to start">
        <Icon name="restart" />
      </button>
      <span className="tl-time" aria-live="off">{fmtTime(t)}</span>
      <input
        className="tl-range"
        type="range"
        min={0}
        max={Math.max(1, end)}
        step={0.25}
        value={Math.min(t, end)}
        onChange={(e) => onT(Number(e.target.value))}
        aria-label="Simulation time"
        aria-valuetext={fmtTime(t)}
      />
      <span className="tl-time muted">{fmtTime(end)}</span>
      <select className="tl-speed" value={speed} onChange={(e) => onSpeed(Number(e.target.value))} aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <option key={s} value={s}>{s}×</option>
        ))}
      </select>
      {counts && (
        <div className="tl-counts" aria-label="People at this moment">
          <span><i className="dot dot-move" /> {counts.moving} inside</span>
          <span><i className="dot dot-safe" /> {counts.safe} safe</span>
          {counts.trapped > 0 && <span><i className="dot dot-trapped" /> {counts.trapped} trapped</span>}
        </div>
      )}
      <div className="tl-legend" aria-hidden="true">
        <span><i className="sw sw-fire" /> Fire</span>
        <span><i className="sw sw-smoke" /> Smoke</span>
      </div>
    </div>
  );
}
