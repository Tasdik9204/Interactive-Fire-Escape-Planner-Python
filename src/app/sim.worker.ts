/// <reference lib="webworker" />
import { simulate } from '../engine/simulate';
import type { Project } from '../model/types';

export interface SimRequest {
  id: number;
  project: Project;
  scenarioIds: string[];
}

self.onmessage = (ev: MessageEvent<SimRequest>) => {
  const { id, project, scenarioIds } = ev.data;
  for (const scenarioId of scenarioIds) {
    const scenario = project.scenarios.find((s) => s.id === scenarioId);
    if (!scenario) continue;
    try {
      const result = simulate(project, scenario);
      const buffers = result.frames.flatMap((f) => [f.xy.buffer, f.floor.buffer, f.state.buffer]);
      (self as unknown as Worker).postMessage({ id, scenarioId, result }, buffers as ArrayBuffer[]);
    } catch (e) {
      (self as unknown as Worker).postMessage({ id, scenarioId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  (self as unknown as Worker).postMessage({ id, done: true });
};
