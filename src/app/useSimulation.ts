import { useCallback, useEffect, useRef, useState } from 'react';
import type { SimResult } from '../engine/simulate';
import type { Project } from '../model/types';
import type { SimRequest } from './sim.worker';

/** Identity of everything a simulation result depends on, for one scenario. */
export function simKey(p: Project, scenarioId: string): string {
  const s = p.scenarios.find((x) => x.id === scenarioId);
  return JSON.stringify([p.nodes, p.edges, p.settings, p.floors.map((f) => f.id), s]);
}

export interface SimEntry {
  key: string;
  result?: SimResult;
  error?: string;
}

/** Runs simulations in a Web Worker so the editor never freezes. */
export function useSimulation() {
  const workerRef = useRef<Worker | null>(null);
  const reqRef = useRef(0);
  const [entries, setEntries] = useState<Record<string, SimEntry>>({});
  const [running, setRunning] = useState(false);

  const stop = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setRunning(false);
  }, []);

  useEffect(() => stop, [stop]);

  const run = useCallback(
    (project: Project, scenarioIds: string[]) => {
      // A newer request replaces any run in progress.
      workerRef.current?.terminate();
      const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      const id = ++reqRef.current;
      const keys = Object.fromEntries(scenarioIds.map((s) => [s, simKey(project, s)]));
      setRunning(true);
      worker.onmessage = (ev: MessageEvent<{ id: number; scenarioId?: string; result?: SimResult; error?: string; done?: boolean }>) => {
        const m = ev.data;
        if (m.id !== reqRef.current) return;
        if (m.done) {
          setRunning(false);
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
          return;
        }
        if (m.scenarioId) {
          const sid = m.scenarioId;
          setEntries((e) => ({ ...e, [sid]: { key: keys[sid], result: m.result, error: m.error } }));
        }
      };
      worker.onerror = (ev) => {
        if (id !== reqRef.current) return;
        setRunning(false);
        setEntries((e) => {
          const next = { ...e };
          for (const s of scenarioIds) next[s] = { key: keys[s], error: ev.message || 'Simulation failed' };
          return next;
        });
      };
      worker.postMessage({ id, project, scenarioIds } satisfies SimRequest);
    },
    [],
  );

  return { entries, running, run, stop };
}
