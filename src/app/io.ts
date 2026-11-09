import { ImportError, parseProjectFile, uid } from '../model/project';
import type { Project } from '../model/types';
import { loadAsset, saveAsset } from './persist';

const FORMAT = 'exitwise-project';
const MAX_FILE = 40 * 1024 * 1024;
const ASSET_TYPES = /^data:(image\/(png|jpeg|webp|gif));base64,/;

export function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const safeFileName = (name: string) => name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'building';

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });

export async function exportProject(p: Project): Promise<Blob> {
  const assets: Record<string, string> = {};
  for (const f of p.floors) {
    if (!f.background) continue;
    const a = await loadAsset(f.background.assetId);
    if (a) assets[a.id] = await blobToDataUrl(a.blob);
  }
  return new Blob([JSON.stringify({ format: FORMAT, version: 2, project: p, assets })], { type: 'application/json' });
}

/** Read a user file: an Exitwise export, a bare project, or a legacy planner map. */
export async function importProjectFile(file: File): Promise<Project> {
  if (file.size > MAX_FILE) throw new ImportError('The file is larger than 40 MB.');
  const text = await file.text();
  const project = parseProjectFile(text, file.name);
  let assets: Record<string, unknown> = {};
  try {
    const data = JSON.parse(text);
    if (data && typeof data.assets === 'object' && data.assets) assets = data.assets;
  } catch {
    /* parseProjectFile already validated the JSON */
  }
  // Re-key assets so an import never overwrites another project's images.
  for (const floor of project.floors) {
    if (!floor.background) continue;
    const dataUrl = assets[floor.background.assetId];
    if (typeof dataUrl !== 'string' || !ASSET_TYPES.test(dataUrl)) {
      delete floor.background;
      continue;
    }
    const blob = await (await fetch(dataUrl)).blob();
    const id = uid('a');
    await saveAsset({ id, blob });
    floor.background = { ...floor.background, assetId: id };
  }
  return { ...project, id: uid('p'), updatedAt: Date.now() };
}

const STYLE_PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin',
  'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'paint-order', 'display', 'visibility',
];

/** Render an on-screen SVG to PNG, copying computed styles so CSS variables survive. */
export async function svgToPng(svg: SVGSVGElement, width: number, height: number, background: string): Promise<Blob> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = svg.querySelectorAll('*');
  const dst = clone.querySelectorAll('*');
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const target = dst[i] as SVGElement;
    target.removeAttribute('class');
    target.setAttribute('style', STYLE_PROPS.map((k) => `${k}:${cs.getPropertyValue(k)}`).join(';'));
  });
  // Inline background images as data URLs (object URLs do not load inside an SVG image).
  for (const img of clone.querySelectorAll('image')) {
    const href = img.getAttribute('href');
    if (href?.startsWith('blob:')) img.setAttribute('href', await blobToDataUrl(await (await fetch(href)).blob()));
  }
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth || 1000, height: img.naturalHeight || 1000 };
  } finally {
    URL.revokeObjectURL(url);
  }
}
