import type { ProjectStore } from '../app/store';
import { DEFAULT_SETTINGS, type Settings } from '../model/types';
import { Dialog, Field, NumberInput } from './common';

type Key = keyof Settings;
const GROUPS: { title: string; fields: [Key, string, string, number, number, number, string?][] }[] = [
  {
    title: 'People',
    fields: [
      ['walkSpeed', 'Walking speed', 'm/s', 0.1, 5, 0.05],
      ['stairSpeedFactor', 'Speed on stairs', '×', 0.05, 1, 0.05, 'Share of walking speed.'],
      ['smokeSpeedFactor', 'Speed in smoke', '×', 0.05, 1, 0.05],
      ['flowRate', 'Door flow', 'p/s/m', 0.1, 5, 0.1, 'People per second per metre of clear width.'],
      ['preMovement', 'Pre-movement time', 's', 0, 3600, 5, 'From alarm to the first step.'],
      ['preMovementSpread', 'Pre-movement spread', 's', 0, 3600, 5, 'Each person adds a random 0 to this.'],
    ],
  },
  {
    title: 'Fire and smoke',
    fields: [
      ['flashover', 'Time to flashover', 's', 0, 3600, 10, 'Until the fire room is untenable.'],
      ['fireSpreadRate', 'Fire spread', 'm/min', 0.01, 1000, 0.5],
      ['smokeSpreadRate', 'Smoke spread', 'm/min', 0.01, 1000, 1],
      ['safetyMargin', 'Safety margin', 's', 0, 3600, 5, 'Routes must stay this far ahead of the fire.'],
    ],
  },
  {
    title: 'Plan',
    fields: [
      ['scale', 'Drawing scale', 'px/m', 0.01, 10000, 1, 'Plan pixels per metre. Calibrate on a floor to set it.'],
      ['stairLength', 'Stair flight length', 'm', 0.5, 200, 0.5, 'Walking length between linked stairs.'],
    ],
  },
  {
    title: 'Audit limits',
    fields: [
      ['maxTravelDistance', 'Max travel distance', 'm', 1, 10000, 1],
      ['targetEvacTime', 'Target evacuation time', 's', 10, 36000, 10],
      ['minWidth', 'Minimum route width', 'm', 0.1, 20, 0.05],
    ],
  },
];

const PRESETS: { name: string; values: Partial<Settings> }[] = [
  { name: 'Office', values: { walkSpeed: 1.2, stairSpeedFactor: 0.5, preMovement: 30, preMovementSpread: 60 } },
  { name: 'School', values: { walkSpeed: 1.3, stairSpeedFactor: 0.55, preMovement: 20, preMovementSpread: 40 } },
  { name: 'Shop or venue', values: { walkSpeed: 1.1, stairSpeedFactor: 0.5, preMovement: 60, preMovementSpread: 120 } },
  { name: 'Hospital or care home', values: { walkSpeed: 0.7, stairSpeedFactor: 0.3, preMovement: 90, preMovementSpread: 180 } },
];

export function SettingsDialog({ open, onClose, settings, store }: { open: boolean; onClose: () => void; settings: Settings; store: ProjectStore }) {
  const set = (patch: Partial<Settings>, key?: string) => store.update((p) => ({ ...p, settings: { ...p.settings, ...patch } }), key);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Model settings"
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={() => set({ ...DEFAULT_SETTINGS, scale: settings.scale })}>Reset to defaults</button>
          <button type="button" className="btn is-primary" onClick={onClose}>Done</button>
        </>
      }
    >
      <div className="presets">
        <span className="small muted">Occupancy preset:</span>
        {PRESETS.map((p) => (
          <button key={p.name} type="button" className="chip" onClick={() => set(p.values)}>
            {p.name}
          </button>
        ))}
      </div>
      <div className="settings-grid">
        {GROUPS.map((g) => (
          <fieldset key={g.title}>
            <legend>{g.title}</legend>
            {g.fields.map(([key, label, unit, min, max, step, hint]) => (
              <Field key={key} label={label} hint={hint}>
                {(id) => (
                  <NumberInput id={id} value={settings[key]} min={min} max={max} step={step} unit={unit} onChange={(v) => v !== undefined && set({ [key]: v }, `set-${key}`)} onBlur={store.seal} />
                )}
              </Field>
            ))}
          </fieldset>
        ))}
      </div>
    </Dialog>
  );
}
