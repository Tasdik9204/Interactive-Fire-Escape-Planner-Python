import type { Project } from '../model/types';
import { nodeBox, PlanLayer, type Overlay } from './PlanLayer';

/** A whole floor fitted into a fixed box, for reports and thumbnails. */
export function StaticPlan({ project, floorId, overlay, className }: { project: Project; floorId: string; overlay?: Overlay; className?: string }) {
  const floorIndex = project.floors.findIndex((f) => f.id === floorId);
  const floor = project.floors[floorIndex];
  if (!floor) return null;
  const u = project.settings.scale;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of project.nodes) {
    if (n.floorId !== floorId) continue;
    const { w, h } = nodeBox(n, u);
    minX = Math.min(minX, n.x - w / 2 - 1.5 * u);
    maxX = Math.max(maxX, n.x + w / 2 + 1.5 * u);
    // Room for occupant badges and stair labels above, distance labels below.
    minY = Math.min(minY, n.y - h / 2 - 2 * u);
    maxY = Math.max(maxY, n.y + h / 2 + 2.6 * u);
  }
  if (floor.background) {
    minX = Math.min(minX, floor.background.x);
    minY = Math.min(minY, floor.background.y);
    maxX = Math.max(maxX, floor.background.x + floor.background.width);
    maxY = Math.max(maxY, floor.background.y + floor.background.height);
  }
  if (!Number.isFinite(minX)) return <p className="muted small">This floor is empty.</p>;
  return (
    <svg className={`static-plan ${className ?? ''}`} viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} role="img" aria-label={`Plan of ${floor.name}`}>
      <PlanLayer project={project} floor={floor} floorIndex={floorIndex} overlay={overlay} zoom={2} />
    </svg>
  );
}
