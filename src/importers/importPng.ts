import { Skia } from '@shopify/react-native-skia';
import { createSpriteAsset, slugify, type SpriteAsset } from '@elemental/asset-schema';
import { blobStore } from '@/state/blobStore';
import { addProjectAsset } from '@/engine/commands';
import { useProjectStore } from '@/state/projectStore';
import { pickFiles, type PickedFile } from './pickFiles';

/** Decode PNG dimensions with Skia (works identically on web and native). */
export function decodeImageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const data = Skia.Data.fromBytes(bytes);
  const img = Skia.Image.MakeImageFromEncoded(data);
  data.dispose?.();
  if (!img) return null;
  const size = { width: img.width(), height: img.height() };
  img.dispose?.();
  return size;
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

/** Register PNG bytes as a new project asset. Returns the asset or null if undecodable. */
export function importPngBytes(file: PickedFile): SpriteAsset | null {
  const size = decodeImageSize(file.bytes);
  if (!size) return null;
  const imagePath = uniqueImagePath(file.name);
  blobStore.put(imagePath, file.bytes, 'image/png');
  const asset = createSpriteAsset({ name: file.name.replace(/\.png$/i, ''), imagePath, width: size.width, height: size.height });
  addProjectAsset(asset);
  return asset;
}

export async function importPngFiles(): Promise<SpriteAsset[]> {
  const files = await pickFiles({ types: ['image/png'], multiple: true });
  const out: SpriteAsset[] = [];
  for (const f of files) {
    const a = importPngBytes(f);
    if (a) out.push(a);
  }
  return out;
}
