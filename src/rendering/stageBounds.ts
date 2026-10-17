import { imageWorldCorners, type EvaluatedPose } from '@elemental/animation-core';

export interface StageBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const EMPTY: StageBounds = { minX: -512, minY: -512, maxX: 512, maxY: 512 };
const PAD = 256;

/** World-space axis-aligned bounds of the posed sprites, plus padding for scrolling past the edges. */
export function poseStageBounds(pose: EvaluatedPose | null): StageBounds {
  if (!pose || pose.renderList.length === 0) return { ...EMPTY };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const item of pose.renderList) {
    const w = pose.world.get(item.instanceId);
    if (!w) continue;
    for (const c of imageWorldCorners(w, item.width, item.height)) {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x);
      maxY = Math.max(maxY, c.y);
    }
  }
  if (!Number.isFinite(minX)) return { ...EMPTY };
  return { minX: minX - PAD, minY: minY - PAD, maxX: maxX + PAD, maxY: maxY + PAD };
}
