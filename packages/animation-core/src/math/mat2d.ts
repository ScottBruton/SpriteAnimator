import type { Vector2 } from '@elemental/asset-schema';
import { degToRad, radToDeg } from './angles';

/**
 * 2D affine matrix stored as `[a, b, c, d, tx, ty]` (same layout as Canvas2D / gl-matrix):
 *
 *   | a  c  tx |
 *   | b  d  ty |
 *   | 0  0  1  |
 *
 * Point transform: x' = a*x + c*y + tx ; y' = b*x + d*y + ty.
 * Coordinates are y-down; a positive rotation therefore appears clockwise on screen.
 */
export type Mat2D = readonly [number, number, number, number, number, number];

export const IDENTITY: Mat2D = [1, 0, 0, 1, 0, 0];

export const mat2d = (a: number, b: number, c: number, d: number, tx: number, ty: number): Mat2D => [
  a,
  b,
  c,
  d,
  tx,
  ty,
];

export const translation = (x: number, y: number): Mat2D => [1, 0, 0, 1, x, y];

export const scaling = (sx: number, sy: number): Mat2D => [sx, 0, 0, sy, 0, 0];

export function rotationDeg(deg: number): Mat2D {
  const r = degToRad(deg);
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
}

/** Returns `m1 * m2` — apply `m2` first, then `m1`. */
export function multiply(m1: Mat2D, m2: Mat2D): Mat2D {
  const [a1, b1, c1, d1, tx1, ty1] = m1;
  const [a2, b2, c2, d2, tx2, ty2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * tx2 + c1 * ty2 + tx1,
    b1 * tx2 + d1 * ty2 + ty1,
  ];
}

/** Compose left-to-right: `compose(A, B, C)` = A * B * C (C applied first). */
export function compose(...ms: Mat2D[]): Mat2D {
  let out: Mat2D = IDENTITY;
  for (const m of ms) out = multiply(out, m);
  return out;
}

export function invert(m: Mat2D): Mat2D {
  const [a, b, c, d, tx, ty] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) {
    // Degenerate (zero scale). Return identity translation inverse to avoid NaNs.
    return [0, 0, 0, 0, -tx, -ty];
  }
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  return [ia, ib, ic, id, -(ia * tx + ic * ty), -(ib * tx + id * ty)];
}

export function transformPoint(m: Mat2D, p: Vector2): Vector2 {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** Transform a direction vector (ignores translation). */
export function transformVector(m: Mat2D, v: Vector2): Vector2 {
  return { x: m[0] * v.x + m[2] * v.y, y: m[1] * v.x + m[3] * v.y };
}

export function getTranslation(m: Mat2D): Vector2 {
  return { x: m[4], y: m[5] };
}

/** Rotation of the x axis in degrees. */
export function getRotationDeg(m: Mat2D): number {
  return radToDeg(Math.atan2(m[1], m[0]));
}

/** Signed scale, assuming no skew. Returns negative sy when the matrix is mirrored. */
export function getScale(m: Mat2D): Vector2 {
  const sx = Math.hypot(m[0], m[1]);
  const det = m[0] * m[3] - m[1] * m[2];
  const sy = Math.hypot(m[2], m[3]) * (det < 0 ? -1 : 1);
  return { x: sx, y: sy };
}

export function matEquals(a: Mat2D, b: Mat2D, eps = 1e-6): boolean {
  for (let i = 0; i < 6; i++) {
    if (Math.abs((a[i] as number) - (b[i] as number)) > eps) return false;
  }
  return true;
}

/** Convert to a 3x3 row-major array as expected by Skia (`Skia.Matrix(values)`). */
export function toSkiaMatrixValues(m: Mat2D): number[] {
  return [m[0], m[2], m[4], m[1], m[3], m[5], 0, 0, 1];
}

/** Build a TRS matrix: translate, then rotate, then scale (scale applied first to points). */
export function trs(position: Vector2, rotationDegrees: number, scale: Vector2): Mat2D {
  const r = degToRad(rotationDegrees);
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c * scale.x, s * scale.x, -s * scale.y, c * scale.y, position.x, position.y];
}
