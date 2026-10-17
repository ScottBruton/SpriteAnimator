import type { BezierHandles, Interpolation } from '@elemental/asset-schema';

export const easeInQuad = (t: number): number => t * t;
export const easeOutQuad = (t: number): number => t * (2 - t);
export const easeInOutQuad = (t: number): number => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);

/**
 * CSS-style cubic Bézier easing with P0=(0,0), P1=(x1,y1), P2=(x2,y2), P3=(1,1).
 * Solves x(t)=x for t with Newton-Raphson + bisection fallback, then returns y(t).
 */
export function cubicBezierEase(x: number, h: BezierHandles): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const { x1, y1, x2, y2 } = h;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = sampleX(t) - x;
    if (Math.abs(err) < 1e-7) return sampleY(t);
    const d = sampleDX(t);
    if (Math.abs(d) < 1e-7) break;
    t -= err / d;
  }
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 32 && hi - lo > 1e-7; i++) {
    const cur = sampleX(t);
    if (cur < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return sampleY(t);
}

/** Map a linear 0..1 progress to an eased progress according to the keyframe's interpolation. */
export function applyInterpolation(u: number, interpolation: Interpolation, bezier?: BezierHandles): number {
  switch (interpolation) {
    case 'step':
      return 0;
    case 'linear':
      return u;
    case 'ease-in':
      return easeInQuad(u);
    case 'ease-out':
      return easeOutQuad(u);
    case 'ease-in-out':
      return easeInOutQuad(u);
    case 'bezier':
      return cubicBezierEase(u, bezier ?? { x1: 0.42, y1: 0, x2: 0.58, y2: 1 });
    default:
      return u;
  }
}
