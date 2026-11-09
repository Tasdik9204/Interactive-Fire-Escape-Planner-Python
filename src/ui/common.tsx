import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export const fmtTime = (s: number) => {
  if (!Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.round(s - m * 60);
  return `${m}:${String(sec === 60 ? 59 : sec).padStart(2, '0')}`;
};
export const fmtM = (m: number) => (Number.isFinite(m) ? `${m.toFixed(1)} m` : '—');

// ---------------------------------------------------------------------------
// Buttons and fields
// ---------------------------------------------------------------------------

export function IconButton({
  icon,
  label,
  onClick,
  active,
  disabled,
  shortcut,
  tone,
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  shortcut?: string;
  tone?: 'danger';
}) {
  return (
    <button
      type="button"
      className={`icon-btn${active ? ' is-active' : ''}${tone === 'danger' ? ' is-danger' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
    >
      <Icon name={icon} />
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <small className="hint">{hint}</small>}
    </div>
  );
}

/** Number input that keeps the user's text while typing and commits valid values. */
export function NumberInput({
  id,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  placeholder,
  onBlur,
}: {
  id?: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  placeholder?: string;
  onBlur?: () => void;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(round(value)));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value === undefined ? '' : String(round(value)));
  }, [value]);
  return (
    <div className="num-input">
      <input
        id={id}
        type="number"
        inputMode="decimal"
        value={text}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setText(value === undefined ? '' : String(round(value)));
          onBlur?.();
        }}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value === '') {
            if (placeholder !== undefined) onChange(undefined);
            return;
          }
          const v = Number(e.target.value);
          if (!Number.isFinite(v)) return;
          if ((min !== undefined && v < min) || (max !== undefined && v > max)) return;
          onChange(v);
        }}
      />
      {unit && <span className="unit">{unit}</span>}
    </div>
  );
}
const round = (v: number) => Math.round(v * 1000) / 1000;

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; icon?: IconName }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'is-active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={16} />}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog (native <dialog>: focus trap, Esc and backdrop come for free)
// ---------------------------------------------------------------------------

export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
  footer,
  closable = true,
}: {
  closable?: boolean;
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`dialog${wide ? ' is-wide' : ''}`}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <>
          <header className="dialog-head">
            <h2>{title}</h2>
            {closable && <IconButton icon="x" label="Close" onClick={onClose} />}
          </header>
          <div className="dialog-body">{children}</div>
          {footer && <footer className="dialog-foot">{footer}</footer>}
        </>
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

type Toast = { id: number; text: string; tone: 'info' | 'error' | 'success' };
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast is-${t.tone}`}>
            <Icon name={t.tone === 'error' ? 'alert' : t.tone === 'success' ? 'check' : 'info'} size={16} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

/** Cumulative people out over time: one series, crosshair tooltip, target line. */
export function EvacCurve({ curve, total, target, height = 150 }: { curve: number[]; total: number; target?: number; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 320;
  const H = height;
  const pad = { l: 34, r: 10, t: 10, b: 22 };
  const tMax = Math.max(curve.length - 1, target ?? 0, 10);
  const yMax = Math.max(total, 1);
  const x = (t: number) => pad.l + (t / tMax) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - (v / yMax) * (H - pad.t - pad.b);
  const pts = curve.map((v, t) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const ticks = niceTicks(tMax);
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = Math.round((((e.clientX - r.left) / r.width) * W - pad.l) / ((W - pad.l - pad.r) / tMax));
    setHover(t >= 0 && t < curve.length ? t : null);
  };
  if (!curve.length) return null;
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Evacuation curve: ${curve[curve.length - 1]} of ${total} people safe after ${fmtTime(curve.length - 1)}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line className="chart-grid" x1={pad.l} x2={W - pad.r} y1={y(yMax * f)} y2={y(yMax * f)} />
            <text className="chart-axis" x={pad.l - 6} y={y(yMax * f)} textAnchor="end" dominantBaseline="middle">
              {Math.round(yMax * f)}
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <text key={t} className="chart-axis" x={x(t)} y={H - 6} textAnchor="middle">
            {fmtTime(t)}
          </text>
        ))}
        {target !== undefined && (
          <g>
            <line className="chart-target" x1={x(target)} x2={x(target)} y1={pad.t} y2={H - pad.b} />
            <text className="chart-axis" x={x(target) - 4} y={pad.t + 8} textAnchor="end">
              target
            </text>
          </g>
        )}
        <polygon className="chart-area" points={`${x(0)},${y(0)} ${pts} ${x(curve.length - 1)},${y(0)}`} />
        <polyline className="chart-line" points={pts} />
        {hover !== null && (
          <g>
            <line className="chart-cross" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} />
            <circle className="chart-dot" cx={x(hover)} cy={y(curve[hover])} r={4} />
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <strong>{curve[hover]}</strong> of {total} safe · {fmtTime(hover)}
        </div>
      )}
    </figure>
  );
}

function niceTicks(max: number): number[] {
  const steps = [15, 30, 60, 120, 300, 600, 900, 1800];
  const step = steps.find((s) => max / s <= 5) ?? 3600;
  const out: number[] = [];
  for (let t = 0; t <= max; t += step) out.push(t);
  return out;
}

/** Horizontal magnitude bars with direct value labels. */
export function Bars({ rows, onHover }: { rows: { id: string; label: string; value: number; note?: string }[]; onHover?: (id: string | null) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.id} onPointerEnter={() => onHover?.(r.id)} onPointerLeave={() => onHover?.(null)} title={r.note}>
          <span className="bars-label">{r.label}</span>
          <span className="bars-track">
            <span className="bars-fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="bars-value">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}
