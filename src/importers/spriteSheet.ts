import { AlphaType, ColorType, ImageFormat, Skia } from '@shopify/react-native-skia';
import { createSpriteAsset, slugify, type SpriteAsset } from '@elemental/asset-schema';
import { addProjectAsset, createAssetFolder, normalizeAssetFolder } from '@/engine/commands';
import { blobStore } from '@/state/blobStore';
import { useProjectStore } from '@/state/projectStore';
import { pickFiles, type PickedFile } from './pickFiles';
import {
  defaultSheetOptions,
  extractGridCells,
  type ExtractedCell,
  type Rgba,
  type SheetExtractOptions,
} from './spriteSheetExtract';

export interface DecodedSheet {
  width: number;
  height: number;
  pixels: Uint8Array;
  /** Original file name without extension (for naming slices). */
  baseName: string;
  /** Original encoded bytes (kept unmodified). */
  sourceBytes: Uint8Array;
}

export interface SheetImportResult {
  assets: SpriteAsset[];
  background: Rgba;
  skippedEmpty: number;
}

/** Decode a PNG into tightly packed RGBA8888 pixels via Skia. */
export function decodeSheetRgba(bytes: Uint8Array): { width: number; height: number; pixels: Uint8Array } | null {
  const data = Skia.Data.fromBytes(bytes);
  const img = Skia.Image.MakeImageFromEncoded(data);
  data.dispose?.();
  if (!img) return null;
  const width = img.width();
  const height = img.height();
  const info = {
    width,
    height,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  };
  const pixels = img.readPixels(0, 0, info);
  img.dispose?.();
  if (!pixels || !(pixels instanceof Uint8Array)) return null;
  // Ensure we own a detachable copy (Skia may return a view).
  return { width, height, pixels: new Uint8Array(pixels) };
}

/** Encode RGBA8888 pixels as a PNG. */
export function encodeRgbaPng(pixels: Uint8Array, width: number, height: number): Uint8Array | null {
  const data = Skia.Data.fromBytes(pixels);
  const img = Skia.Image.MakeImage(
    { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    data,
    width * 4,
  );
  data.dispose?.();
  if (!img) return null;
  const encoded = img.encodeToBytes(ImageFormat.PNG, 100);
  img.dispose?.();
  return encoded ? new Uint8Array(encoded) : null;
}

function uniqueImagePath(baseName: string): string {
  const existing = new Set([
    ...useProjectStore.getState().project.assets.map((a) => a.imagePath),
    ...useProjectStore.getState().globalAssets.map((a) => a.imagePath),
    ...blobStore.keys(),
  ]);
  const slug = slugify(baseName.replace(/\.png$/i, ''));
  let path = `assets/${slug}.png`;
  let i = 2;
  while (existing.has(path)) path = `assets/${slug}_${i++}.png`;
  return path;
}

export function loadDecodedSheet(file: PickedFile): DecodedSheet | null {
  const decoded = decodeSheetRgba(file.bytes);
  if (!decoded) return null;
  return {
    ...decoded,
    baseName: file.name.replace(/\.png$/i, ''),
    sourceBytes: file.bytes,
  };
}

export async function pickSpriteSheetFile(): Promise<PickedFile | null> {
  const [f] = await pickFiles({ types: ['image/png'], multiple: false });
  return f ?? null;
}

function cellName(baseName: string, cell: ExtractedCell): string {
  const n = cell.index + 1;
  return `${baseName}_${String(n).padStart(2, '0')}_r${cell.row}c${cell.column}`;
}

export interface SheetImportMeta {
  /** Library folder path for every extracted sprite (empty = Unfiled). */
  folder?: string;
}

/** Extract grid cells and register each non-empty slice as a project asset. Original sheet is not modified. */
export function importExtractedCells(
  sheet: DecodedSheet,
  options: SheetExtractOptions = defaultSheetOptions(),
  meta: SheetImportMeta = {},
): SheetImportResult {
  const folder = normalizeAssetFolder(meta.folder ?? '');
  if (folder) createAssetFolder(folder);
  const { background, cells } = extractGridCells(sheet.pixels, sheet.width, sheet.height, options);
  const assets: SpriteAsset[] = [];
  let skippedEmpty = 0;
  for (const cell of cells) {
    if (cell.empty) {
      skippedEmpty++;
      continue;
    }
    const png = encodeRgbaPng(cell.pixels, cell.width, cell.height);
    if (!png) continue;
    const name = cellName(sheet.baseName, cell);
    const imagePath = uniqueImagePath(name);
    blobStore.put(imagePath, png, 'image/png');
    const asset = createSpriteAsset({ name, imagePath, width: cell.width, height: cell.height });
    if (folder) asset.folder = folder;
    addProjectAsset(asset);
    assets.push(asset);
  }
  return { assets, background, skippedEmpty };
}

export type { SheetExtractOptions, ExtractedCell, Rgba };
export { defaultSheetOptions, extractGridCells, sampleBackgroundFromCorners } from './spriteSheetExtract';
