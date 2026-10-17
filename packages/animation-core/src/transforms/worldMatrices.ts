import type { AttachmentPoint, SpriteAsset, SpriteInstance, Transform2D, Vector2 } from '@elemental/asset-schema';
import { IDENTITY, multiply, transformPoint, type Mat2D } from '../math/mat2d';
import { topologicalOrder } from '../rigging/hierarchy';
import { attachmentFrameMatrix, drawMatrixFromNode, localNodeMatrix } from './localMatrix';

export interface ResolvedInstance {
  /** Source instance (id, parent links, layer...). */
  instance: SpriteInstance;
  /** Effective asset after direction overrides. */
  asset: SpriteAsset;
  /** Effective pivot after direction overrides. */
  pivot: Vector2;
  /** Effective local transform (setup pose + direction override + animation). */
  transform: Transform2D;
  opacity: number;
  visible: boolean;
  layerId: string;
  orderInLayer: number;
}

export interface WorldTransforms {
  /** Pivot-centred node matrix in world space. */
  node: Mat2D;
  /** Image-local (top-left origin) → world. */
  draw: Mat2D;
  /** Parent frame this instance's local transform is relative to. */
  parentFrame: Mat2D;
}

/**
 * Compute world matrices for every resolved instance.
 *
 *   parentFrame(i) = IDENTITY                                               if no parent
 *                  = node(p) · T(att.position − pivot(p)) · R(att.rotation)  if parentAttachmentId
 *                  = node(p)                                                otherwise
 *   node(i)        = parentFrame(i) · T(pos) · R(rot Z) · S(scale ⊙ flip)
 *   draw(i)        = node(i) · P(rotX, rotY) · T(−pivot(i))
 */
export function computeWorldTransforms(
  resolved: ReadonlyMap<string, ResolvedInstance>,
): Map<string, WorldTransforms> {
  const list = Array.from(resolved.values()).map((r) => r.instance);
  const ordered = topologicalOrder(list);
  const out = new Map<string, WorldTransforms>();

  for (const inst of ordered) {
    const r = resolved.get(inst.id);
    if (!r) continue;
    let parentFrame: Mat2D = IDENTITY;
    if (inst.parentId !== null) {
      const parentWorld = out.get(inst.parentId);
      const parentResolved = resolved.get(inst.parentId);
      if (parentWorld && parentResolved) {
        parentFrame = parentWorld.node;
        if (inst.parentAttachmentId) {
          const att = parentResolved.asset.attachments.find((a) => a.id === inst.parentAttachmentId);
          if (att) parentFrame = multiply(parentFrame, attachmentFrameMatrix(att, parentResolved.pivot));
        }
      }
    }
    const node = multiply(parentFrame, localNodeMatrix(r.transform));
    const draw = drawMatrixFromNode(node, r.pivot, r.transform);
    out.set(inst.id, { node, draw, parentFrame });
  }
  return out;
}

/** World-space position of an attachment point on an instance (draw space — markers / labels). */
export function attachmentWorldPosition(world: WorldTransforms, attachmentPosition: Vector2): Vector2 {
  return transformPoint(world.draw, attachmentPosition);
}

/**
 * World-space origin of an attachment's parent frame (matches hierarchy parenting).
 * Prefer this for joint lines and snap targets so the link visual matches where the child hangs.
 */
export function attachmentFrameWorldPosition(world: WorldTransforms, attachment: AttachmentPoint, pivot: Vector2): Vector2 {
  const m = multiply(world.node, attachmentFrameMatrix(attachment, pivot));
  return { x: m[4], y: m[5] };
}

/** World-space pivot position (the node origin). */
export function pivotWorldPosition(world: WorldTransforms): Vector2 {
  return { x: world.node[4], y: world.node[5] };
}

/** Corners of the image rectangle in world space, clockwise from top-left. */
export function imageWorldCorners(world: WorldTransforms, width: number, height: number): [Vector2, Vector2, Vector2, Vector2] {
  return [
    transformPoint(world.draw, { x: 0, y: 0 }),
    transformPoint(world.draw, { x: width, y: 0 }),
    transformPoint(world.draw, { x: width, y: height }),
    transformPoint(world.draw, { x: 0, y: height }),
  ];
}

/** Centre of the image rectangle in world space. */
export function imageWorldCenter(world: WorldTransforms, width: number, height: number): Vector2 {
  return transformPoint(world.draw, { x: width / 2, y: height / 2 });
}
