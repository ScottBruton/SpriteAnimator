export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export const degToRad = (deg: number): number => deg * DEG2RAD;
export const radToDeg = (rad: number): number => rad * RAD2DEG;

/** Normalise an angle in degrees to the range (-180, 180]. */
export function normalizeDegrees(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Signed shortest delta from `from` to `to`, in degrees, in (-180, 180]. */
export function shortestDeltaDegrees(from: number, to: number): number {
  return normalizeDegrees(to - from);
}

/** Interpolate along the shortest arc. Used for blending between channels, never for keyframes. */
export function lerpAngleShortest(a: number, b: number, t: number): number {
  return a + shortestDeltaDegrees(a, b) * t;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function approxEqual(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}
