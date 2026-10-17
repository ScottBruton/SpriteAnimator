import type { RenderItem } from '@elemental/animation-core';
import { Skia, type SkCanvas, type SkPaint } from '@shopify/react-native-skia';
import type { ImageRegistry } from '../ImageRegistry';
import { toSkiaMatrixValues } from '@elemental/animation-core';

export type ImagePathLookup = (assetId: string) => string | undefined;

let sharedPaint: SkPaint | null = null;

/**
 * Imperative renderer: draws a render list onto an SkCanvas. Used for picture recording and
 * batched multi-unit drawing (many units in one Canvas).
 */
export function drawRenderList(
  canvas: SkCanvas,
  renderList: readonly RenderItem[],
  images: ImageRegistry,
  imagePathForAsset: ImagePathLookup,
): void {
  if (!sharedPaint) sharedPaint = Skia.Paint();
  const paint = sharedPaint;
  for (const item of renderList) {
    const key = imagePathForAsset(item.assetId);
    const img = key ? images.get(key) : undefined;
    if (!img) continue;
    canvas.save();
    const m = Skia.Matrix(toSkiaMatrixValues(item.matrix));
    canvas.concat(m);
    paint.setAlphaf(item.opacity);
    const src = Skia.XYWHRect(0, 0, img.width(), img.height());
    const dst = Skia.XYWHRect(0, 0, item.width, item.height);
    canvas.drawImageRect(img, src, dst, paint);
    canvas.restore();
  }
}
