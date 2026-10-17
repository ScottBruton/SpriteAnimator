import type { AttachmentPoint, Transform2D, Vector2 } from '@elemental/asset-schema';
import { invert, multiply, translation, type Mat2D } from '../math/mat2d';
import { attachmentFrameMatrix, decomposeNodeMatrix, localNodeMatrix } from '../transforms/localMatrix';

/**
 * Local transform that keeps a child's current world node matrix unchanged after it is re-parented
 * under `newParentFrame` (world matrix of the new parent frame: node or attachment frame).
 *
 *   local = inverse(newParentFrame) · childWorldNode
 */
export function preserveWorldPose(childWorldNode: Mat2D, newParentFrame: Mat2D, prev?: Transform2D): Transform2D {
  return decomposeNodeMatrix(multiply(invert(newParentFrame), childWorldNode), prev);
}

/**
 * Local transform for a child snapped onto a parent attachment:
 * the child's socket point coincides with the parent's attachment point.
 *
 * The child's rotation centre is always its pivot. If the socket is not the pivot, the position is
 * offset so that `socket` lands exactly on the attachment frame origin for the given rotation/scale.
 *
 * All values relative to the attachment frame (origin at attachment, rotated by attachment.rotation).
 */
export function snappedLocalTransform(input: {
  childPivot: Vector2;
  /** Child point that should coincide with the parent attachment (image-local). Defaults to pivot. */
  childSocket?: Vector2;
  rotation: number;
  scale: Vector2;
  flipX: boolean;
  flipY: boolean;
}): Transform2D {
  const socket = input.childSocket ?? input.childPivot;
  const base: Transform2D = {
    position: { x: 0, y: 0 },
    rotation: input.rotation,
    rotationX: 0,
    rotationY: 0,
    scale: input.scale,
    flipX: input.flipX,
    flipY: input.flipY,
  };
  // Socket offset from pivot, expressed in the child's node frame.
  const nodeNoTranslate = localNodeMatrix(base);
  const dx = socket.x - input.childPivot.x;
  const dy = socket.y - input.childPivot.y;
  const sx = nodeNoTranslate[0] * dx + nodeNoTranslate[2] * dy;
  const sy = nodeNoTranslate[1] * dx + nodeNoTranslate[3] * dy;
  // Move the node so the socket sits at the frame origin.
  return { ...base, position: { x: -sx, y: -sy } };
}

/** World matrix of a parent attachment frame given the parent's world node matrix. */
export function attachmentWorldFrame(parentWorldNode: Mat2D, attachment: AttachmentPoint, parentPivot: Vector2): Mat2D {
  return multiply(parentWorldNode, attachmentFrameMatrix(attachment, parentPivot));
}

/** Convenience: world frame for a plain (non-attachment) parent-child link. */
export function nodeFrame(parentWorldNode: Mat2D): Mat2D {
  return multiply(parentWorldNode, translation(0, 0));
}
