import type { JointConstraint } from '@elemental/asset-schema';
import { clamp } from '../math/angles';

/**
 * Apply a joint constraint to an animated rotation.
 * Limits are expressed relative to the setup-pose rotation (`restRotation`).
 */
export function constrainRotation(rotation: number, restRotation: number, joint: JointConstraint | undefined): number {
  if (!joint) return rotation;
  if (joint.type === 'fixed') return restRotation;
  if (joint.type === 'rotation') {
    const rel = rotation - restRotation;
    const min = joint.minRotation ?? -Infinity;
    const max = joint.maxRotation ?? Infinity;
    return restRotation + clamp(rel, min, max);
  }
  return rotation;
}
