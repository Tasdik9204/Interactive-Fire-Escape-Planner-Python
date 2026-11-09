import { useEffect, useRef, useState } from 'react';
import { exportProject, importProjectFile, download, safeFileName } from '../app/io';
import { deleteProject, listProjects, loadProject, saveProject, type ProjectMeta } from '../app/persist';
import { createProject, ImportError, uid } from '../model/project';
import { TEMPLATES } from '../model/samples';
import type { Project } from '../model/types';
import { Dialog, useToast } from './common';
import { Icon } from './Icon';
import { StaticPlan } from './StaticPlan';

interface Props {
  open: boolean;
  /** Without a current project the dialog cannot be dismissed. */
  canClose: boolean;
  currentId: string | null;
  onClose: () => void;
  onOpen: (p: Project) => void;
}

const thumbs = new Map<string, Project>();
function templateProject(id: string): Project {
  if (!thumbs.has(id)) thumbs.set(id, TEMPLATES.find((t) => t.id === id)!.make());
  return thumbs.get(id)!;
}

export function ProjectsDialog({ open, canClose, currentId, onClose, onOpen }: Props) {
  const toast = useToast();
  const [list, setList] = useState<ProjectMeta[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => listProjects().then(setList).catch(() => setList([]));
  useEffect(() => {
    if (open) refresh();
  }, [open]);

  const openNew = async (p: Project) => {
    await saveProject(p).catch(() => toast('Could not save to this browser. Export your work to keep it.', 'error'));
    onOpen(p);
  };

  const onImport = async (file?: File) => {
    if (!file) return;
    try {
      const p = await importProjectFile(file);
      await openNew(p);
      toast(`Imported “${p.name}”.`, 'success');
    } catch (e) {
      toast(e instanceof ImportError ? e.message : 'Import failed: the file could not be read.', 'error');
    }
  };

  const act = async (id: string, action: 'open' | 'duplicate' | 'export' | 'delete') => {
    const p = await loadProject(id);
    if (!p) return toast('That project could not be loaded.', 'error');
    if (action === 'open') onOpen(p);
    if (action === 'duplicate') {
      await saveProject({ ...p, id: uid('p'), name: `${p.name} (copy)`, updatedAt: Date.now() });
      refresh();
    }
    if (action === 'export') download(await exportProject(p), `${safeFileName(p.name)}.exitwise.json`);
    if (action === 'delete') {
      if (!confirm(`Delete “${p.name}” from this browser? This cannot be undone. Export it first to keep a copy.`)) return;
      await deleteProject(id);
      refresh();
      toast(`Deleted “${p.name}”.`);
    }
  };

  return (
    <Dialog open={open} onClose={canClose ? onClose : () => {}} closable={canClose} title="Projects" wide>
      <section className="projects-section">
        <div className="section-head">
          <h3>Start a new building</h3>
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={16} /> Import file
            </button>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { onImport(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
        </div>
        <ul className="template-grid">
          <li>
            <button type="button" className="template-card is-blank" onClick={() => openNew(createProject())}>
              <span className="template-thumb"><Icon name="plus" size={28} /></span>
              <strong>Blank building</strong>
              <span className="small muted">Draw from scratch or trace an image</span>
            </button>
          </li>
          {TEMPLATES.map((t) => (
            <li key={t.id}>
              <button type="button" className="template-card" onClick={() => openNew(t.make())}>
                <span className="template-thumb">
                  {open && <StaticPlan project={templateProject(t.id)} floorId={templateProject(t.id).floors[0].id} />}
                </span>
                <strong>{t.name}</strong>
                <span className="small muted">{t.description}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="projects-section">
        <h3>Saved in this browser</h3>
        {list === null ? (
          <p className="muted small">Loading…</p>
        ) : list.length === 0 ? (
          <p className="muted small">No saved projects yet. Projects save automatically as you work.</p>
        ) : (
          <ul className="project-list">
            {list.map((m) => (
              <li key={m.id} className={m.id === currentId ? 'is-current' : ''}>
                <button type="button" className="project-open" onClick={() => act(m.id, 'open')}>
                  <strong>{m.name}</strong>
                  <span className="small muted">
                    {m.floors} floor{m.floors === 1 ? '' : 's'} · {m.nodes} points · {m.occupants} people · edited {new Date(m.updatedAt).toLocaleString()}
                  </span>
                </button>
                <div className="btn-group">
                  <button type="button" className="icon-btn" title="Duplicate" aria-label={`Duplicate ${m.name}`} onClick={() => act(m.id, 'duplicate')}><Icon name="copy" size={16} /></button>
                  <button type="button" className="icon-btn" title="Export file" aria-label={`Export ${m.name}`} onClick={() => act(m.id, 'export')}><Icon name="download" size={16} /></button>
                  <button type="button" className="icon-btn is-danger" title="Delete" aria-label={`Delete ${m.name}`} disabled={m.id === currentId} onClick={() => act(m.id, 'delete')}><Icon name="trash" size={16} /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="small muted">Projects live in this browser only. Export a file to back up, move between computers or share with a colleague. Files from the original Python planner import too.</p>
      </section>
    </Dialog>
  );
}
