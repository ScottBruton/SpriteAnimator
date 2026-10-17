import type { Vector2 } from '@elemental/asset-schema';
import { radToDeg } from '../math/angles';

export interface TwoBoneIkInput {
  /** Root joint position (in the frame the result angles are expressed in). */
  root: Vector2;
  /** Length of the upper and lower bones. */
  upperLength: number;
  lowerLength: number;
  target: Vector2;
  /** Which side the elbow/knee bends to. */
  bendDirection: 'positive' | 'negative';
}

export interface TwoBoneIkResult {
  /** Absolute rotation (degrees) of the upper bone's x axis. */
  upperRotation: number;
  /** Absolute rotation (degrees) of the lower bone's x axis. */
  lowerRotation: number;
  /** True when the target is reachable; false when the chain is fully extended toward it. */
  reachable: boolean;
}

/**
 * Analytic two-bone inverse kinematics in 2D (law of cosines). Pure function; the caller maps
 * absolute rotations back into local joint rotations and applies influence/limits.
 */
export function solveTwoBoneIk(input: TwoBoneIkInput): TwoBoneIkResult {
  const dx = input.target.x - input.root.x;
  const dy = input.target.y - input.root.y;
  const dist = Math.hypot(dx, dy);
  const l1 = input.upperLength;
  const l2 = input.lowerLength;
  const baseAngle = Math.atan2(dy, dx);
  const maxReach = l1 + l2;
  const minReach = Math.abs(l1 - l2);
  const clamped = Math.min(Math.max(dist, minReach + 1e-6), maxReach - 1e-6);
  const reachable = dist >= minReach && dist <= maxReach;

  const cosUpper = (l1 * l1 + clamped * clamped - l2 * l2) / (2 * l1 * clamped);
  const cosLower = (l1 * l1 + l2 * l2 - clamped * clamped) / (2 * l1 * l2);
  const upperOffset = Math.acos(Math.min(1, Math.max(-1, cosUpper)));
  const innerAngle = Math.acos(Math.min(1, Math.max(-1, cosLower)));
  const sign = input.bendDirection === 'positive' ? 1 : -1;

  const upper = baseAngle - sign * upperOffset;
  const lower = upper + sign * (Math.PI - innerAngle);
  return { upperRotation: radToDeg(upper), lowerRotation: radToDeg(lower), reachable };
}
