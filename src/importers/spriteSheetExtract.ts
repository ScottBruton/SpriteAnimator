/** Pure RGBA sprite-sheet slicing (no Skia). Pixels are tightly packed RGBA8888. */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SheetInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface SheetExtractOptions {
  columns: number;
  rows: number;
  /** When omitted, sampled from the sheet corners. */
  background?: Rgba | null;
  /** Max RGB Euclidean distance from background to treat as empty (0–441). */
  tolerance: number;
  /** Shrink each cell to the opaque content bounding box. */
  trim: boolean;
  /** Extra pixels kept around trimmed content. */
  trimPadding: number;
  insets: SheetInsets;
}

export interface ExtractedCell {
  index: number;
  column: number;
  row: number;
  pixels: Uint8Array;
  width: number;
  height: number;
  /** True when the cell had no opaque content after chroma. */
  empty: boolean;
}

const ZERO: Rgba = { r: 0, g: 0, b: 0, a: 0 };

export function pixelAt(pixels: Uint8Array, width: number, x: number, y: number): Rgba {
  const i = (y * width + x) * 4;
  return { r: pixels[i]!, g: pixels[i + 1]!, b: pixels[i + 2]!, a: pixels[i + 3]! };
}

export function colorDistance(a: Rgba, b: Rgba): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function isBackgroundPixel(px: Rgba, background: Rgba, tolerance: number): boolean {
  if (px.a === 0) return true;
  return colorDistance(px, background) <= tolerance;
}

/** Average a 3×3 patch at each corner; return the mean of those samples (robust for noise). */
export function sampleBackgroundFromCorners(pixels: Uint8Array, width: number, height: number): Rgba {
  const patches: Rgba[] = [];
  const corners: [number, number][] = [
    [0, 0],
    [Math.max(0, width - 3), 0],
    [0, Math.max(0, height - 3)],
    [Math.max(0, width - 3), Math.max(0, height - 3)],
  ];
  for (const [ox, oy] of corners) {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        const x = Math.min(width - 1, ox + dx);
        const y = Math.min(height - 1, oy + dy);
        const p = pixelAt(pixels, width, x, y);
        if (p.a === 0) continue;
        r += p.r;
        g += p.g;
        b += p.b;
        n++;
      }
    }
    if (n > 0) patches.push({ r: r / n, g: g / n, b: b / n, a: 255 });
  }
  if (patches.length === 0) return { r: 0, g: 0, b: 0, a: 255 };
  const sum = patches.reduce((acc, p) => ({ r: acc.r + p.r, g: acc.g + p.g, b: acc.b + p.b, a: 255 }), ZERO);
  return {
    r: Math.round(sum.r / patches.length),
    g: Math.round(sum.g / patches.length),
    b: Math.round(sum.b / patches.length),
    a: 255,
  };
}

export function cellRect(sheetW: number, sheetH: number, columns: number, rows: number, column: number, row: number, insets: SheetInsets): Rect {
  const cellW = sheetW / columns;
  const cellH = sheetH / rows;
  const x0 = Math.round(column * cellW) + Math.max(0, Math.floor(insets.left));
  const y0 = Math.round(row * cellH) + Math.max(0, Math.floor(insets.top));
  const x1 = Math.round((column + 1) * cellW) - Math.max(0, Math.floor(insets.right));
  const y1 = Math.round((row + 1) * cellH) - Math.max(0, Math.floor(insets.bottom));
  return {
    x: Math.max(0, Math.min(sheetW, x0)),
    y: Math.max(0, Math.min(sheetH, y0)),
    width: Math.max(0, Math.min(sheetW, x1) - Math.max(0, Math.min(sheetW, x0))),
    height: Math.max(0, Math.min(sheetH, y1) - Math.max(0, Math.min(sheetH, y0))),
  };
}

function copyRect(src: Uint8Array, srcW: number, rect: Rect): Uint8Array {
  const out = new Uint8Array(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y++) {
    const srcRow = ((rect.y + y) * srcW + rect.x) * 4;
    const dstRow = y * rect.width * 4;
    out.set(src.subarray(srcRow, srcRow + rect.width * 4), dstRow);
  }
  return out;
}

/** In-place: make near-background pixels fully transparent. */
export function applyChromaKey(pixels: Uint8Array, width: number, height: number, background: Rgba, tolerance: number): void {
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const px = { r: pixels[o]!, g: pixels[o + 1]!, b: pixels[o + 2]!, a: pixels[o + 3]! };
    if (isBackgroundPixel(px, background, tolerance)) {
      pixels[o] = 0;
      pixels[o + 1] = 0;
      pixels[o + 2] = 0;
      pixels[o + 3] = 0;
    }
  }
}

export function contentBounds(pixels: Uint8Array, width: number, height: number): Rect | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3]! === 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function trimPixels(pixels: Uint8Array, width: number, height: number, padding: number): { pixels: Uint8Array; width: number; height: number } | null {
  const bounds = contentBounds(pixels, width, height);
  if (!bounds) return null;
  const pad = Math.max(0, Math.floor(padding));
  const rect: Rect = {
    x: Math.max(0, bounds.x - pad),
    y: Math.max(0, bounds.y - pad),
    width: 0,
    height: 0,
  };
  const x1 = Math.min(width, bounds.x + bounds.width + pad);
  const y1 = Math.min(height, bounds.y + bounds.height + pad);
  rect.width = x1 - rect.x;
  rect.height = y1 - rect.y;
  return { pixels: copyRect(pixels, width, rect), width: rect.width, height: rect.height };
}

export function extractGridCells(
  pixels: Uint8Array,
  sheetW: number,
  sheetH: number,
  options: SheetExtractOptions,
): { background: Rgba; cells: ExtractedCell[] } {
  const columns = Math.max(1, Math.floor(options.columns));
  const rows = Math.max(1, Math.floor(options.rows));
  const background = options.background ?? sampleBackgroundFromCorners(pixels, sheetW, sheetH);
  const tolerance = Math.max(0, options.tolerance);
  const insets = options.insets ?? { left: 0, right: 0, top: 0, bottom: 0 };
  const cells: ExtractedCell[] = [];
  let index = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const rect = cellRect(sheetW, sheetH, columns, rows, column, row, insets);
      if (rect.width <= 0 || rect.height <= 0) {
        cells.push({ index, column, row, pixels: new Uint8Array(4), width: 1, height: 1, empty: true });
        index++;
        continue;
      }
      let cell = copyRect(pixels, sheetW, rect);
      applyChromaKey(cell, rect.width, rect.height, background, tolerance);
      let width = rect.width;
      let height = rect.height;
      let empty = false;
      if (options.trim) {
        const trimmed = trimPixels(cell, width, height, options.trimPadding);
        if (!trimmed) {
          empty = true;
          cell = new Uint8Array(4);
          width = 1;
          height = 1;
        } else {
          cell = trimmed.pixels;
          width = trimmed.width;
          height = trimmed.height;
        }
      } else if (!contentBounds(cell, width, height)) {
        empty = true;
      }
      cells.push({ index, column, row, pixels: cell, width, height, empty });
      index++;
    }
  }
  return { background, cells };
}

export function defaultSheetOptions(): SheetExtractOptions {
  return {
    columns: 4,
    rows: 2,
    background: null,
    tolerance: 28,
    trim: true,
    trimPadding: 2,
    insets: { left: 0, right: 0, top: 0, bottom: 0 },
  };
}
