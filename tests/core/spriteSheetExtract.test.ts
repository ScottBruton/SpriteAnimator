import {
  applyChromaKey,
  cellRect,
  colorDistance,
  contentBounds,
  extractGridCells,
  isBackgroundPixel,
  partLetter,
  sampleBackgroundFromCorners,
  splitConnectedParts,
  trimPixels,
} from '@/importers/spriteSheetExtract';

function makeRgba(w: number, h: number, fill: [number, number, number, number]): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = fill[0];
    out[i * 4 + 1] = fill[1];
    out[i * 4 + 2] = fill[2];
    out[i * 4 + 3] = fill[3];
  }
  return out;
}

function putPixel(px: Uint8Array, w: number, x: number, y: number, rgba: [number, number, number, number]) {
  const i = (y * w + x) * 4;
  px[i] = rgba[0];
  px[i + 1] = rgba[1];
  px[i + 2] = rgba[2];
  px[i + 3] = rgba[3];
}

describe('spriteSheetExtract', () => {
  test('colorDistance and background match', () => {
    expect(colorDistance({ r: 0, g: 0, b: 0, a: 255 }, { r: 0, g: 0, b: 0, a: 255 })).toBe(0);
    expect(isBackgroundPixel({ r: 0, g: 0, b: 0, a: 0 }, { r: 255, g: 255, b: 255, a: 255 }, 0)).toBe(true);
    expect(isBackgroundPixel({ r: 10, g: 0, b: 0, a: 255 }, { r: 0, g: 0, b: 0, a: 255 }, 20)).toBe(true);
    expect(isBackgroundPixel({ r: 80, g: 0, b: 0, a: 255 }, { r: 0, g: 0, b: 0, a: 255 }, 20)).toBe(false);
  });

  test('sampleBackgroundFromCorners prefers corner colour', () => {
    const w = 8;
    const h = 8;
    const px = makeRgba(w, h, [255, 0, 0, 255]);
    // Paint 3×3 navy patches in each corner
    const origins: [number, number][] = [
      [0, 0],
      [5, 0],
      [0, 5],
      [5, 5],
    ];
    for (const [ox, oy] of origins) {
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) putPixel(px, w, ox + dx, oy + dy, [10, 20, 40, 255]);
    }
    const bg = sampleBackgroundFromCorners(px, w, h);
    expect(bg.r).toBeLessThan(40);
    expect(bg.b).toBeGreaterThan(bg.r);
  });

  test('cellRect divides the sheet evenly', () => {
    const r = cellRect(400, 200, 4, 2, 1, 0, { left: 0, right: 0, top: 0, bottom: 0 });
    expect(r).toEqual({ x: 100, y: 0, width: 100, height: 100 });
    const inset = cellRect(400, 200, 4, 2, 0, 0, { left: 5, right: 5, top: 2, bottom: 2 });
    expect(inset.x).toBe(5);
    expect(inset.y).toBe(2);
    expect(inset.width).toBe(90);
    expect(inset.height).toBe(96);
  });

  test('chroma + trim extracts a red blob from a black sheet cell', () => {
    const w = 20;
    const h = 10;
    const px = makeRgba(w, h, [0, 0, 0, 255]);
    // Two cells side by side (2 cols × 1 row): paint a 3×3 red square in cell 0 and cell 1
    for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) putPixel(px, w, x, y, [220, 30, 30, 255]);
    for (let y = 2; y <= 4; y++) for (let x = 12; x <= 14; x++) putPixel(px, w, x, y, [30, 220, 30, 255]);

    const { background, cells } = extractGridCells(px, w, h, {
      columns: 2,
      rows: 1,
      tolerance: 20,
      trim: true,
      trimPadding: 0,
      splitParts: false,
      minPartPixels: 64,
      minPartRatio: 0.08,
      insets: { left: 0, right: 0, top: 0, bottom: 0 },
    });
    expect(background.r + background.g + background.b).toBeLessThan(30);
    expect(cells).toHaveLength(2);
    expect(cells[0]!.empty).toBe(false);
    expect(cells[1]!.empty).toBe(false);
    expect(cells[0]!.width).toBe(3);
    expect(cells[0]!.height).toBe(3);
    expect(cells[1]!.width).toBe(3);
    expect(cells[1]!.height).toBe(3);
  });

  test('white background sheets chroma correctly', () => {
    const w = 8;
    const h = 4;
    const px = makeRgba(w, h, [250, 250, 250, 255]);
    putPixel(px, w, 1, 1, [0, 0, 255, 255]);
    putPixel(px, w, 5, 1, [255, 0, 0, 255]);
    const { cells } = extractGridCells(px, w, h, {
      columns: 2,
      rows: 1,
      tolerance: 30,
      trim: true,
      trimPadding: 0,
      splitParts: false,
      minPartPixels: 64,
      minPartRatio: 0.08,
      insets: { left: 0, right: 0, top: 0, bottom: 0 },
    });
    expect(cells[0]!.empty).toBe(false);
    expect(cells[1]!.empty).toBe(false);
  });

  test('applyChromaKey and contentBounds', () => {
    const w = 4;
    const h = 4;
    const px = makeRgba(w, h, [0, 0, 0, 255]);
    putPixel(px, w, 1, 1, [255, 0, 0, 255]);
    applyChromaKey(px, w, h, { r: 0, g: 0, b: 0, a: 255 }, 5);
    expect(px[3]).toBe(0);
    expect(px[(1 * 4 + 1) * 4 + 3]).toBe(255);
    const b = contentBounds(px, w, h);
    expect(b).toEqual({ x: 1, y: 1, width: 1, height: 1 });
    const trimmed = trimPixels(px, w, h, 1);
    expect(trimmed?.width).toBe(3);
    expect(trimmed?.height).toBe(3);
  });

  test('empty cells are marked empty when trim is on', () => {
    const px = makeRgba(10, 10, [0, 0, 0, 255]);
    const { cells } = extractGridCells(px, 10, 10, {
      columns: 2,
      rows: 2,
      tolerance: 10,
      trim: true,
      trimPadding: 0,
      splitParts: false,
      minPartPixels: 64,
      minPartRatio: 0.08,
      insets: { left: 0, right: 0, top: 0, bottom: 0 },
    });
    expect(cells.every((c) => c.empty)).toBe(true);
  });

  test('partLetter uses a..z then pN', () => {
    expect(partLetter(0)).toBe('a');
    expect(partLetter(25)).toBe('z');
    expect(partLetter(26)).toBe('p27');
  });

  test('splitConnectedParts separates two blobs and sorts left-to-right', () => {
    const w = 12;
    const h = 6;
    const px = makeRgba(w, h, [0, 0, 0, 0]);
    // Right blob first in scan order, left blob second — sort should still put left first.
    for (let y = 1; y <= 3; y++) for (let x = 7; x <= 9; x++) putPixel(px, w, x, y, [0, 200, 0, 255]);
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) putPixel(px, w, x, y, [200, 0, 0, 255]);
    const parts = splitConnectedParts(px, w, h, { minPixels: 4, padding: 0, minPartRatio: 0 });
    expect(parts).toHaveLength(2);
    expect(parts[0]!.bounds.x).toBe(1);
    expect(parts[1]!.bounds.x).toBe(7);
    expect(parts[0]!.width).toBe(3);
    expect(parts[0]!.height).toBe(3);
  });

  test('splitParts extracts two sprites from one grid cell', () => {
    const w = 20;
    const h = 10;
    const px = makeRgba(w, h, [0, 0, 0, 255]);
    // Cell 0 (cols 0–9): two separate red squares
    for (let y = 2; y <= 4; y++) for (let x = 1; x <= 3; x++) putPixel(px, w, x, y, [220, 30, 30, 255]);
    for (let y = 2; y <= 4; y++) for (let x = 6; x <= 8; x++) putPixel(px, w, x, y, [30, 30, 220, 255]);
    // Cell 1: one green square
    for (let y = 2; y <= 4; y++) for (let x = 12; x <= 14; x++) putPixel(px, w, x, y, [30, 220, 30, 255]);

    const { cells } = extractGridCells(px, w, h, {
      columns: 2,
      rows: 1,
      tolerance: 20,
      trim: true,
      trimPadding: 0,
      splitParts: true,
      minPartPixels: 4,
      minPartRatio: 0.08,
      insets: { left: 0, right: 0, top: 0, bottom: 0 },
    });
    const nonempty = cells.filter((c) => !c.empty);
    expect(nonempty).toHaveLength(3);
    expect(nonempty[0]!.index).toBe(0);
    expect(nonempty[0]!.partCount).toBe(2);
    expect(nonempty[0]!.partIndex).toBe(0);
    expect(nonempty[1]!.index).toBe(0);
    expect(nonempty[1]!.partIndex).toBe(1);
    expect(nonempty[2]!.index).toBe(1);
    expect(nonempty[2]!.partCount).toBe(1);
  });

  test('minPartPixels drops tiny noise blobs', () => {
    const w = 10;
    const h = 10;
    const px = makeRgba(w, h, [0, 0, 0, 0]);
    for (let y = 2; y <= 5; y++) for (let x = 2; x <= 5; x++) putPixel(px, w, x, y, [255, 0, 0, 255]);
    putPixel(px, w, 8, 8, [0, 255, 0, 255]);
    const parts = splitConnectedParts(px, w, h, { minPixels: 8, padding: 0, minPartRatio: 0 });
    expect(parts).toHaveLength(1);
    expect(parts[0]!.pixelCount).toBe(16);
  });

  test('minPartRatio drops shadow islands much smaller than the main parts', () => {
    const w = 40;
    const h = 20;
    const px = makeRgba(w, h, [0, 0, 0, 0]);
    // Two large arms (~100 px each)
    for (let y = 2; y <= 11; y++) for (let x = 2; x <= 11; x++) putPixel(px, w, x, y, [200, 50, 50, 255]);
    for (let y = 2; y <= 11; y++) for (let x = 22; x <= 31; x++) putPixel(px, w, x, y, [50, 50, 200, 255]);
    // Mid-size fringe island (~5% of an arm) — kept by absolute floor, dropped by ratio.
    for (let y = 15; y <= 16; y++) for (let x = 14; x <= 16; x++) putPixel(px, w, x, y, [5, 5, 5, 255]);
    // Low-alpha fringe — ignored by minAlpha.
    putPixel(px, w, 38, 18, [8, 8, 8, 20]);
    putPixel(px, w, 39, 18, [8, 8, 8, 20]);
    putPixel(px, w, 38, 19, [8, 8, 8, 20]);

    const parts = splitConnectedParts(px, w, h, {
      minPixels: 4,
      padding: 0,
      minAlpha: 32,
      minPartRatio: 0.08,
    });
    expect(parts).toHaveLength(2);
    expect(parts[0]!.pixelCount).toBe(100);
    expect(parts[1]!.pixelCount).toBe(100);
  });
});
