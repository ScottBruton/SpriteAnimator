import type { Vector2 } from '@elemental/asset-schema';
import {
  attachmentWorldPosition,
  invert,
  pivotWorldPosition,
  transformPoint,
  vdist,
  type EvaluatedPose,
  type RenderItem,
} from '@elemental/animation-core';

/** Topmost render item under a world point (rectangle test in image-local space). */
export function pickInstance(pose: EvaluatedPose, world: Vector2, locked: ReadonlySet<string> = new Set()): RenderItem | null {
  for (let i = pose.renderList.length - 1; i >= 0; i--) {
    const item = pose.renderList[i]!;
    if (locked.has(item.instanceId)) continue;
    const local = transformPoint(invert(item.matrix), world);
    if (local.x >= 0 && local.y >= 0 && local.x <= item.width && local.y <= item.height) return item;
  }
  return null;
}

export interface HandleHit {
  kind: 'pivot' | 'attachment';
  instanceId: string;
  attachmentId?: string;
  world: Vector2;
}

/** Pivot / attachment markers of the given instances within `radiusWorld` of a point. */
export function pickHandle(pose: EvaluatedPose, instanceIds: readonly string[], world: Vector2, radiusWorld: number): HandleHit | null {
  let best: HandleHit | null = null;
  let bestD = radiusWorld;
  for (const id of instanceIds) {
    const r = pose.resolved.get(id);
    const w = pose.world.get(id);
    if (!r || !w) continue;
    const pv = pivotWorldPosition(w);
    const dp = vdist(pv, world);
    if (dp <= bestD) {
      best = { kind: 'pivot', instanceId: id, world: pv };
      bestD = dp;
    }
    for (const att of r.asset.attachments) {
      const ap = attachmentWorldPosition(w, att.position);
      const da = vdist(ap, world);
      if (da <= bestD) {
        best = { kind: 'attachment', instanceId: id, attachmentId: att.id, world: ap };
        bestD = da;
      }
    }
  }
  return best;
}

export interface SnapTarget {
  instanceId: string;
  attachmentId: string;
  world: Vector2;
  distance: number;
}

/** Nearest attachment point on any other instance within tolerance (world units). */
export function findSnapTarget(pose: EvaluatedPose, world: Vector2, excludeIds: ReadonlySet<string>, tolerance: number): SnapTarget | null {
  let best: SnapTarget | null = null;
  for (const [id, r] of pose.resolved) {
    if (excludeIds.has(id)) continue;
    const w = pose.world.get(id);
    if (!w) continue;
    for (const att of r.asset.attachments) {
      const ap = attachmentWorldPosition(w, att.position);
      const d = vdist(ap, world);
      if (d <= tolerance && (!best || d < best.distance)) best = { instanceId: id, attachmentId: att.id, world: ap, distance: d };
    }
  }
  return best;
}

export function snapToGrid(p: Vector2, grid: number): Vector2 {
  return { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid };
}
