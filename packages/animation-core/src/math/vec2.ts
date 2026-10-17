import type { Vector2 } from '@elemental/asset-schema';

export const vec2 = (x = 0, y = 0): Vector2 => ({ x, y });
export const vadd = (a: Vector2, b: Vector2): Vector2 => ({ x: a.x + b.x, y: a.y + b.y });
export const vsub = (a: Vector2, b: Vector2): Vector2 => ({ x: a.x - b.x, y: a.y - b.y });
export const vscale = (a: Vector2, s: number): Vector2 => ({ x: a.x * s, y: a.y * s });
export const vmul = (a: Vector2, b: Vector2): Vector2 => ({ x: a.x * b.x, y: a.y * b.y });
export const vlen = (a: Vector2): number => Math.hypot(a.x, a.y);
export const vdist = (a: Vector2, b: Vector2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const vlerp = (a: Vector2, b: Vector2, t: number): Vector2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
export const veq = (a: Vector2, b: Vector2, eps = 1e-6): boolean =>
  Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
export const vangle = (a: Vector2): number => Math.atan2(a.y, a.x);
