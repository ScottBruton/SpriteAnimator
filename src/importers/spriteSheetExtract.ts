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
  /**
   * When true, each grid cell is split into separate sprites per opaque connected
   * component (e.g. left/right arm). Parts from the same cell share `index` / row / col.
   */
  splitParts: boolean;
  /** Absolute floor: ignore blobs smaller than this many solid pixels. */
  minPartPixels: number;
  /**
   * Relative floor: ignore blobs smaller than this fraction of the largest blob
   * in the same cell (0–1). Drops chroma fringe / shadow speckles.
   */
  minPartRatio: number;
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
  /** 0-based part within the source grid cell (only meaningful when splitParts produced multiple). */
  partIndex: number;
  /** How many non-empty parts this source cell produced (1 when not split or single blob). */
  partCount: number;
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

export interface ConnectedPart {
  pixels: Uint8Array;
  width: number;
  height: number;
  /** Bounding box of the part in the source cell before padding. */
  bounds: Rect;
  /** Opaque pixel count (before trim padding). */
  pixelCount: number;
}

export interface SplitPartsParams {
  minPixels: number;
  padding: number;
  /** Alpha below this is treated as empty when flooding (anti-aliased fringe). */
  minAlpha?: number;
  /** Drop parts smaller than this fraction of the largest part (0–1). */
  minPartRatio?: number;
}

function isSolidPixel(pixels: Uint8Array, i: number, minAlpha: number): boolean {
  return pixels[i * 4 + 3]! >= minAlpha;
}

/**
 * 4-connected solid components, sorted left→right then top→bottom.
 * Each part is cropped to its content (optional padding).
 * Tiny absolute blobs and blobs much smaller than the largest in the cell are dropped
 * (chroma fringe / shadow islands that look “empty” in preview).
 */
export function splitConnectedParts(
  pixels: Uint8Array,
  width: number,
  height: number,
  minPixelsOrParams: number | SplitPartsParams,
  paddingArg?: number,
): ConnectedPart[] {
  // Back-compat: (pixels, w, h, minPixels, padding)
  const params: SplitPartsParams =
    typeof minPixelsOrParams === 'number'
      ? { minPixels: minPixelsOrParams, padding: paddingArg ?? 0 }
      : minPixelsOrParams;
  const minPx = Math.max(1, Math.floor(params.minPixels));
  const pad = Math.max(0, Math.floor(params.padding));
  const minAlpha = Math.max(1, Math.min(255, Math.floor(params.minAlpha ?? 32)));
  const minRatio = Math.max(0, Math.min(1, params.minPartRatio ?? 0.08));
  const visited = new Uint8Array(width * height);
  const parts: ConnectedPart[] = [];
  const stackX: number[] = [];
  const stackY: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x;
      if (visited[start] || !isSolidPixel(pixels, start, minAlpha)) continue;

      stackX.length = 0;
      stackY.length = 0;
      stackX.push(x);
      stackY.push(y);
      visited[start] = 1;

      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let count = 0;
      const members: number[] = [];

      while (stackX.length) {
        const cx = stackX.pop()!;
        const cy = stackY.pop()!;
        const ci = cy * width + cx;
        members.push(ci);
        count++;
        if (cx < minX) minX = cx;
        if (cy < minY) minY = cy;
        if (cx > maxX) maxX = cx;
        if (cy > maxY) maxY = cy;
        const neigh: [number, number][] = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ];
        for (const [nx, ny] of neigh) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const ni = ny * width + nx;
          if (visited[ni] || !isSolidPixel(pixels, ni, minAlpha)) continue;
          visited[ni] = 1;
          stackX.push(nx);
          stackY.push(ny);
        }
      }

      if (count < minPx) continue;

      const bounds: Rect = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
      const outX = Math.max(0, bounds.x - pad);
      const outY = Math.max(0, bounds.y - pad);
      const outX1 = Math.min(width, bounds.x + bounds.width + pad);
      const outY1 = Math.min(height, bounds.y + bounds.height + pad);
      const outW = outX1 - outX;
      const outH = outY1 - outY;
      const out = new Uint8Array(outW * outH * 4);
      for (const ci of members) {
        const sx = ci % width;
        const sy = (ci - sx) / width;
        const dx = sx - outX;
        const dy = sy - outY;
        const di = (dy * outW + dx) * 4;
        const si = ci * 4;
        out[di] = pixels[si]!;
        out[di + 1] = pixels[si + 1]!;
        out[di + 2] = pixels[si + 2]!;
        out[di + 3] = pixels[si + 3]!;
      }
      parts.push({ pixels: out, width: outW, height: outH, bounds, pixelCount: count });
    }
  }

  if (parts.length === 0) return parts;
  const largest = parts.reduce((m, p) => Math.max(m, p.pixelCount), 0);
  const threshold = Math.max(minPx, Math.ceil(largest * minRatio));
  const kept = parts.filter((p) => p.pixelCount >= threshold);
  kept.sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
  return kept;
}

/** Letter suffix for part index: a, b, … z, then p27, p28, … */
export function partLetter(partIndex: number): string {
  if (partIndex < 26) return String.fromCharCode(97 + partIndex);
  return `p${partIndex + 1}`;
}

function emptyCell(index: number, column: number, row: number): ExtractedCell {
  return {
    index,
    column,
    row,
    pixels: new Uint8Array(4),
    width: 1,
    height: 1,
    empty: true,
    partIndex: 0,
    partCount: 0,
  };
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
  const splitParts = !!options.splitParts;
  const minPartPixels = Math.max(1, Math.floor(options.minPartPixels ?? 64));
  const minPartRatio = Math.max(0, Math.min(1, options.minPartRatio ?? 0.08));
  const cells: ExtractedCell[] = [];
  let index = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const rect = cellRect(sheetW, sheetH, columns, rows, column, row, insets);
      if (rect.width <= 0 || rect.height <= 0) {
        cells.push(emptyCell(index, column, row));
        index++;
        continue;
      }
      let cell = copyRect(pixels, sheetW, rect);
      applyChromaKey(cell, rect.width, rect.height, background, tolerance);
      let width = rect.width;
      let height = rect.height;

      if (splitParts) {
        // Always crop each blob; trimPadding still applies as padding around each part.
        const pad = options.trim ? options.trimPadding : 0;
        const parts = splitConnectedParts(cell, width, height, {
          minPixels: minPartPixels,
          padding: pad,
          minAlpha: 32,
          minPartRatio,
        });
        if (parts.length === 0) {
          cells.push(emptyCell(index, column, row));
        } else {
          for (let pi = 0; pi < parts.length; pi++) {
            const p = parts[pi]!;
            cells.push({
              index,
              column,
              row,
              pixels: p.pixels,
              width: p.width,
              height: p.height,
              empty: false,
              partIndex: pi,
              partCount: parts.length,
            });
          }
        }
        index++;
        continue;
      }

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
      cells.push({
        index,
        column,
        row,
        pixels: cell,
        width,
        height,
        empty,
        partIndex: 0,
        partCount: empty ? 0 : 1,
      });
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
    splitParts: false,
    minPartPixels: 64,
    minPartRatio: 0.08,
    insets: { left: 0, right: 0, top: 0, bottom: 0 },
  };
}
