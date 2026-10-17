import { degToRad } from './angles';
import { mat2d, type Mat2D } from './mat2d';

/** Default perspective distance (pixels) for X/Y foreshortening. */
export const DEFAULT_PERSPECTIVE = 800;

/**
 * Affine map approximating Rx · Ry about the origin with a simple perspective divide.
 * Used so existing Skia Image draws (affine only) can show into/out-of-screen tilt.
 * Parenting still uses the pure 2D node matrix (Z + scale) without this term.
 */
export function eulerXYAffine(rotationXDeg: number, rotationYDeg: number, perspective = DEFAULT_PERSPECTIVE): Mat2D {
  if (rotationXDeg === 0 && rotationYDeg === 0) return mat2d(1, 0, 0, 1, 0, 0);

  const rx = degToRad(rotationXDeg);
  const ry = degToRad(rotationYDeg);
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);

  const project = (x: number, y: number, z: number) => {
    // Ry (about vertical / screen Y), then Rx (about horizontal / screen X).
    const x1 = x * cy + z * sy;
    const y1 = y;
    const z1 = -x * sy + z * cy;
    const x2 = x1;
    const y2 = y1 * cx - z1 * sx;
    const z2 = y1 * sx + z1 * cx;
    const w = perspective / (perspective + z2);
    return { x: x2 * w, y: y2 * w };
  };

  const p10 = project(1, 0, 0);
  const p01 = project(0, 1, 0);
  return mat2d(p10.x, p10.y, p01.x, p01.y, 0, 0);
}
