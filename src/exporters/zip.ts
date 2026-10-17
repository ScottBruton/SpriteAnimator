import { Platform } from 'react-native';
import JSZip from 'jszip';
import type { ExportFile } from './buildPackage';

export async function filesToZip(files: ExportFile[]): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const f of files) zip.file(f.path, f.data);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

export interface UnzippedFile {
  path: string;
  bytes: Uint8Array;
}

export async function unzip(bytes: Uint8Array): Promise<UnzippedFile[]> {
  const zip = await JSZip.loadAsync(bytes);
  const out: UnzippedFile[] = [];
  const entries = Object.values(zip.files).filter((e) => !e.dir);
  for (const e of entries) out.push({ path: e.name.replace(/\\/g, '/'), bytes: await e.async('uint8array') });
  return out;
}

/**
 * Deliver a binary file to the user. Web: browser download. Native: write to the cache directory
 * and open the share sheet (iOS Files / AirDrop / etc.).
 */
export async function deliverFile(filename: string, bytes: Uint8Array, mimeType: string): Promise<string> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return `Downloaded ${filename}`;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sharing = require('expo-sharing') as typeof import('expo-sharing');
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: filename });
    return `Shared ${filename}`;
  }
  return `Saved to ${file.uri}`;
}
