import { useCallback, useReducer } from 'react';
import type { Project } from '../model/types';

const HISTORY_LIMIT = 100;

interface State {
  project: Project;
  past: Project[];
  future: Project[];
  /** Updates with the same key in a row merge into one undo step (typing, dragging). */
  lastKey: string | null;
}

type Action =
  | { type: 'load'; project: Project }
  | { type: 'update'; fn: (p: Project) => Project; key?: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'seal' };

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'load':
      return { project: a.project, past: [], future: [], lastKey: null };
    case 'update': {
      const next = a.fn(s.project);
      if (next === s.project) return s;
      const stamped = { ...next, updatedAt: Date.now() };
      if (a.key && a.key === s.lastKey) return { ...s, project: stamped, future: [] };
      return {
        project: stamped,
        past: [...s.past, s.project].slice(-HISTORY_LIMIT),
        future: [],
        lastKey: a.key ?? null,
      };
    }
    case 'undo': {
      if (!s.past.length) return s;
      return { project: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.project, ...s.future], lastKey: null };
    }
    case 'redo': {
      if (!s.future.length) return s;
      return { project: s.future[0], past: [...s.past, s.project], future: s.future.slice(1), lastKey: null };
    }
    case 'seal':
      return s.lastKey === null ? s : { ...s, lastKey: null };
  }
}

export function useProjectStore(initial: Project) {
  const [state, dispatch] = useReducer(reducer, { project: initial, past: [], future: [], lastKey: null });
  return {
    project: state.project,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    load: useCallback((project: Project) => dispatch({ type: 'load', project }), []),
    update: useCallback((fn: (p: Project) => Project, key?: string) => dispatch({ type: 'update', fn, key }), []),
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),
    /** End a merged step, so the next keyed update starts a new undo entry. */
    seal: useCallback(() => dispatch({ type: 'seal' }), []),
  };
}

export type ProjectStore = ReturnType<typeof useProjectStore>;
