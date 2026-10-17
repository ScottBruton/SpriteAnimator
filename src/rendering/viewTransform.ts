import type { Vector2 } from '@elemental/asset-schema';
import type { Mat2D } from '@elemental/animation-core';
import type { ViewState } from '@/state/editorStore';

export const viewToMatrix = (v: ViewState): Mat2D => [v.zoom, 0, 0, v.zoom, v.panX, v.panY];

export const screenToWorld = (v: ViewState, p: Vector2): Vector2 => ({ x: (p.x - v.panX) / v.zoom, y: (p.y - v.panY) / v.zoom });

export const worldToScreen = (v: ViewState, p: Vector2): Vector2 => ({ x: p.x * v.zoom + v.panX, y: p.y * v.zoom + v.panY });

/** Pick a grid spacing (world px) that stays between ~24 and ~96 screen px. */
export function adaptiveGridStep(base: number, zoom: number): { minor: number; major: number } {
  let minor = base;
  while (minor * zoom < 12) minor *= 2;
  while (minor * zoom > 48) minor /= 2;
  return { minor, major: minor * 4 };
}

/** Nice ruler step so labels do not overlap. */
export function rulerStep(zoom: number): number {
  const target = 80 / zoom; // world units per ~80 screen px
  const pow = 10 ** Math.floor(Math.log10(target));
  const candidates = [1, 2, 5, 10].map((c) => c * pow);
  return candidates.find((c) => c >= target) ?? pow * 10;
}
