import type { AttachmentPoint, Transform2D, Vector2 } from '@elemental/asset-schema';
import { getRotationDeg, getScale, getTranslation, multiply, rotationDeg, translation, trs, type Mat2D } from '../math/mat2d';
import { eulerXYAffine } from '../math/project3d';

/**
 * Node matrix of a sprite instance in its parent frame.
 * Maps the instance's pivot-centred frame (pivot at origin) into the parent frame.
 *
 *   M_node = T(position) · R(rotation Z) · S(scale ⊙ flip)
 *
 * X/Y tilt is not included here so children keep a 2D parent frame.
 */
export function localNodeMatrix(t: Transform2D): Mat2D {
  const sx = t.scale.x * (t.flipX ? -1 : 1);
  const sy = t.scale.y * (t.flipY ? -1 : 1);
  return trs(t.position, t.rotation, { x: sx, y: sy });
}

/**
 * Matrix that maps image-local pixel coordinates (origin top-left) into the frame `nodeMatrix`
 * lives in: the pivot is moved to the node origin first, then optional X/Y foreshortening.
 *
 *   M_draw = M_node · P(rotationX, rotationY) · T(-pivot)
 */
export function drawMatrixFromNode(nodeMatrix: Mat2D, pivot: Vector2, t?: Pick<Transform2D, 'rotationX' | 'rotationY'>): Mat2D {
  const P = eulerXYAffine(t?.rotationX ?? 0, t?.rotationY ?? 0);
  return multiply(nodeMatrix, multiply(P, translation(-pivot.x, -pivot.y)));
}

/**
 * Frame defined by an attachment point on a parent, expressed relative to the parent's node frame.
 *
 *   M_attachment = T(attachment.position - parentPivot) · R(attachment.rotation)
 */
export function attachmentFrameMatrix(attachment: AttachmentPoint, parentPivot: Vector2): Mat2D {
  return multiply(
    translation(attachment.position.x - parentPivot.x, attachment.position.y - parentPivot.y),
    rotationDeg(attachment.rotation),
  );
}

/**
 * Decompose a node matrix (no skew) back into a Transform2D. Mirroring is reported as negative
 * `scale.y` folded into `flipY` so that `localNodeMatrix(decompose(m)) ≈ m`.
 */
export function decomposeNodeMatrix(m: Mat2D, prev?: Transform2D): Transform2D {
  const position = getTranslation(m);
  const rotation = getRotationDeg(m);
  const s = getScale(m);
  let flipX = prev?.flipX ?? false;
  let flipY = prev?.flipY ?? false;
  let sx = s.x;
  let sy = s.y;
  if (sy < 0) {
    // Mirrored. Preserve the user's previous flip axis choice where possible.
    if (prev?.flipX && !prev.flipY) {
      // flipX with rotation+180 is equivalent to flipY; keep flipX representation.
      flipX = true;
      flipY = false;
      sy = -sy;
      return {
        position,
        rotation: rotation + 180,
        rotationX: prev?.rotationX ?? 0,
        rotationY: prev?.rotationY ?? 0,
        scale: { x: sx, y: sy },
        flipX,
        flipY,
      };
    }
    flipY = true;
    sy = -sy;
  } else {
    flipX = false;
    flipY = false;
  }
  sx = Math.abs(sx);
  return {
    position,
    rotation,
    rotationX: prev?.rotationX ?? 0,
    rotationY: prev?.rotationY ?? 0,
    scale: { x: sx, y: sy },
    flipX,
    flipY,
  };
}
