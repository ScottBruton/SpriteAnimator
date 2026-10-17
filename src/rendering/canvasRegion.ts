import type { Vector2 } from '@elemental/asset-schema';
import { useEditorStore } from '@/state/editorStore';
import { screenToWorld } from './viewTransform';
import { RULER_SIZE } from './Rulers';

/** Window-space rectangle of the editor canvas, used for drag-and-drop from the asset library. */
export const canvasRegion = { x: 0, y: 0, width: 0, height: 0, rulers: true };

export function windowPointToWorld(p: Vector2): Vector2 | null {
  const r = canvasRegion;
  if (p.x < r.x || p.y < r.y || p.x > r.x + r.width || p.y > r.y + r.height) return null;
  const inset = r.rulers ? RULER_SIZE : 0;
  return screenToWorld(useEditorStore.getState().view, { x: p.x - r.x - inset, y: p.y - r.y - inset });
}

export function canvasCentreWorld(): Vector2 {
  const r = canvasRegion;
  const inset = r.rulers ? RULER_SIZE : 0;
  return screenToWorld(useEditorStore.getState().view, { x: (r.width - inset) / 2, y: (r.height - inset) / 2 });
}
