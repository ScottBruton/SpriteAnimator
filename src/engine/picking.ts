import type { Vector2 } from '@elemental/asset-schema';
import {
  attachmentFrameWorldPosition,
  attachmentWorldPosition,
  imageWorldCorners,
  invert,
  pivotWorldPosition,
  transformPoint,
  vdist,
  type EvaluatedPose,
  type RenderItem,
} from '@elemental/animation-core';

/**
 * Topmost render item under a world point (rectangle test in image-local space).
 * Unlocked sprites win over locked ones so a locked image cannot block selecting what is under it.
 * Locked sprites are only returned when no unlocked sprite is under the pointer.
 */
export function pickInstance(pose: EvaluatedPose, world: Vector2, locked: ReadonlySet<string> = new Set()): RenderItem | null {
  let lockedHit: RenderItem | null = null;
  for (let i = pose.renderList.length - 1; i >= 0; i--) {
    const item = pose.renderList[i]!;
    const local = transformPoint(invert(item.matrix), world);
    if (local.x < 0 || local.y < 0 || local.x > item.width || local.y > item.height) continue;
    if (locked.has(item.instanceId)) {
      if (!lockedHit) lockedHit = item;
      continue;
    }
    return item;
  }
  return lockedHit;
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
  /** Set when snapping to an attachment; omit for parent pivot. */
  attachmentId?: string;
  world: Vector2;
  distance: number;
  kind: 'attachment' | 'pivot';
}

/**
 * Nearest link target on any other instance: attachments first (preferred), then pivots.
 * Attachments win over a pivot at the same distance so joints hang from sockets, not the image centre.
 */
export function findSnapTarget(pose: EvaluatedPose, world: Vector2, excludeIds: ReadonlySet<string>, tolerance: number): SnapTarget | null {
  let bestAtt: SnapTarget | null = null;
  let bestPivot: SnapTarget | null = null;
  for (const [id, r] of pose.resolved) {
    if (excludeIds.has(id)) continue;
    const w = pose.world.get(id);
    if (!w) continue;
    for (const att of r.asset.attachments) {
      const ap = attachmentFrameWorldPosition(w, att, r.pivot);
      const d = vdist(ap, world);
      if (d <= tolerance && (!bestAtt || d < bestAtt.distance)) {
        bestAtt = { instanceId: id, attachmentId: att.id, world: ap, distance: d, kind: 'attachment' };
      }
    }
    const pv = pivotWorldPosition(w);
    const dp = vdist(pv, world);
    if (dp <= tolerance && (!bestPivot || dp < bestPivot.distance)) {
      bestPivot = { instanceId: id, world: pv, distance: dp, kind: 'pivot' };
    }
  }
  // Prefer attachments; only fall back to pivot when no attachment is in range.
  return bestAtt ?? bestPivot;
}

export function snapToGrid(p: Vector2, grid: number): Vector2 {
  return { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid };
}

/** Which box manipulators are active for the sole selection. */
export type HandleMode = 'scale' | 'rotate' | 'extra';

export type BoxHandleKind =
  | 'orbit'
  | 'corner-z'
  | 'edge-x'
  | 'edge-y'
  | 'corner-scale'
  | 'edge-scale-x'
  | 'edge-scale-y';

export interface BoxHandleHit {
  kind: BoxHandleKind;
  instanceId: string;
  world: Vector2;
}

function midpoint(a: Vector2, b: Vector2): Vector2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Box manipulators for a single selected sprite.
 * `scale`: corner = uniform resize, edges = axis resize.
 * `rotate`: orbit → corners (Z) → edge midpoints (tilt X/Y).
 * `extra`: reserved (no hits yet).
 * Corners use a larger hit radius so they win near corners over edges.
 */
export function pickBoxHandle(
  pose: EvaluatedPose,
  instanceId: string,
  world: Vector2,
  zoom: number,
  mode: HandleMode = 'scale',
): BoxHandleHit | null {
  if (mode === 'extra') return null;

  const r = pose.resolved.get(instanceId);
  const w = pose.world.get(instanceId);
  if (!r || !w) return null;

  const cornerR = 14 / zoom;
  const edgeR = 9 / zoom;
  const orbitR = 12 / zoom;

  const [tl, tr, br, bl] = imageWorldCorners(w, r.asset.width, r.asset.height);
  const corners = [tl, tr, br, bl];

  if (mode === 'rotate' && r.asset.orbitHandle) {
    const ow = transformPoint(w.draw, r.asset.orbitHandle);
    if (vdist(ow, world) <= orbitR) return { kind: 'orbit', instanceId, world: ow };
  }

  const cornerKind: BoxHandleKind = mode === 'scale' ? 'corner-scale' : 'corner-z';
  let bestCorner: BoxHandleHit | null = null;
  let bestCornerD = cornerR;
  for (const c of corners) {
    const d = vdist(c, world);
    if (d <= bestCornerD) {
      bestCorner = { kind: cornerKind, instanceId, world: c };
      bestCornerD = d;
    }
  }
  if (bestCorner) return bestCorner;

  const edgeKinds =
    mode === 'scale'
      ? ([
          { kind: 'edge-scale-x' as const, p: midpoint(tl, tr) },
          { kind: 'edge-scale-x' as const, p: midpoint(bl, br) },
          { kind: 'edge-scale-y' as const, p: midpoint(tl, bl) },
          { kind: 'edge-scale-y' as const, p: midpoint(tr, br) },
        ] as const)
      : ([
          { kind: 'edge-x' as const, p: midpoint(tl, tr) },
          { kind: 'edge-x' as const, p: midpoint(bl, br) },
          { kind: 'edge-y' as const, p: midpoint(tl, bl) },
          { kind: 'edge-y' as const, p: midpoint(tr, br) },
        ] as const);
  let bestEdge: BoxHandleHit | null = null;
  let bestEdgeD = edgeR;
  for (const e of edgeKinds) {
    if (corners.some((c) => vdist(c, world) <= cornerR)) continue;
    const d = vdist(e.p, world);
    if (d <= bestEdgeD) {
      bestEdge = { kind: e.kind, instanceId, world: e.p };
      bestEdgeD = d;
    }
  }
  return bestEdge;
}
