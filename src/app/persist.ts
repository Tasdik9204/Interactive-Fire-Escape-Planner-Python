import { normalizeProject } from '../model/project';
import type { Project } from '../model/types';

/**
 * Local persistence in IndexedDB: projects and uploaded floor-plan images.
 * Everything stays in this browser; export a file to move a project.
 * Falls back to memory when IndexedDB is unavailable (private windows).
 */

const DB_NAME = 'exitwise';
const DB_VERSION = 1;

export interface StoredAsset {
  id: string;
  blob: Blob;
}

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
  floors: number;
  nodes: number;
  occupants: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory = { projects: new Map<string, Project>(), assets: new Map<string, StoredAsset>() };

function open(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

export async function storageAvailable(): Promise<boolean> {
  return (await open()) !== null;
}

function tx<T>(store: 'projects' | 'assets', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        if (!db) return reject(new Error('IndexedDB unavailable'));
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req.result);
        t.onerror = () => reject(t.error ?? new Error('Storage error'));
        t.onabort = () => reject(t.error ?? new Error('Storage aborted (disk full?)'));
      }),
  );
}

export async function saveProject(p: Project): Promise<void> {
  if (!(await open())) {
    memory.projects.set(p.id, p);
    return;
  }
  await tx('projects', 'readwrite', (s) => s.put(p));
}

export async function loadProject(id: string): Promise<Project | null> {
  if (!(await open())) return memory.projects.get(id) ?? null;
  const raw = await tx<unknown>('projects', 'readonly', (s) => s.get(id));
  if (!raw) return null;
  // Stored data may come from an older version: run it through validation.
  return normalizeProject(raw);
}

export async function deleteProject(id: string): Promise<void> {
  const p = await loadProject(id);
  if (!(await open())) {
    memory.projects.delete(id);
  } else {
    await tx('projects', 'readwrite', (s) => s.delete(id));
  }
  // Remove images no other project uses.
  if (p) {
    const others = await listProjectsFull();
    const used = new Set(others.flatMap((o) => o.floors.map((f) => f.background?.assetId)));
    for (const f of p.floors) if (f.background && !used.has(f.background.assetId)) await deleteAsset(f.background.assetId);
  }
}

async function listProjectsFull(): Promise<Project[]> {
  if (!(await open())) return [...memory.projects.values()];
  return tx<Project[]>('projects', 'readonly', (s) => s.getAll() as IDBRequest<Project[]>);
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await listProjectsFull();
  return all
    .map((p) => ({
      id: p.id,
      name: p.name,
      updatedAt: p.updatedAt,
      floors: p.floors?.length ?? 0,
      nodes: p.nodes?.length ?? 0,
      occupants: (p.nodes ?? []).reduce((a, n) => a + (n.occupants || 0), 0),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveAsset(a: StoredAsset): Promise<void> {
  if (!(await open())) {
    memory.assets.set(a.id, a);
    return;
  }
  await tx('assets', 'readwrite', (s) => s.put(a));
}

export async function loadAsset(id: string): Promise<StoredAsset | null> {
  if (!(await open())) return memory.assets.get(id) ?? null;
  return (await tx<StoredAsset | undefined>('assets', 'readonly', (s) => s.get(id))) ?? null;
}

export async function deleteAsset(id: string): Promise<void> {
  if (!(await open())) {
    memory.assets.delete(id);
    return;
  }
  await tx('assets', 'readwrite', (s) => s.delete(id));
}

const LAST_KEY = 'exitwise:last-project';
export function rememberLast(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST_KEY, id);
    else localStorage.removeItem(LAST_KEY);
  } catch {
    /* storage blocked: nothing to remember */
  }
}
export function lastProjectId(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}
