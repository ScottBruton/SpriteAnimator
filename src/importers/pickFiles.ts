import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
  mimeType?: string;
}

/**
 * Platform-neutral file picking. On web `expo-document-picker` yields a `File`; on native it yields
 * a cached URI which we read with the new `expo-file-system` API.
 */
export async function pickFiles(opts: { types: string[]; multiple?: boolean }): Promise<PickedFile[]> {
  const result = await DocumentPicker.getDocumentAsync({
    type: opts.types,
    multiple: opts.multiple ?? true,
    copyToCacheDirectory: true,
    base64: false,
  });
  if (result.canceled) return [];
  const out: PickedFile[] = [];
  for (const asset of result.assets) {
    let bytes: Uint8Array | null = null;
    if (Platform.OS === 'web') {
      const f = asset.file;
      if (f) bytes = new Uint8Array(await f.arrayBuffer());
      else {
        const res = await fetch(asset.uri);
        bytes = new Uint8Array(await res.arrayBuffer());
      }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { File } = require('expo-file-system') as typeof import('expo-file-system');
      bytes = await new File(asset.uri).bytes();
    }
    if (bytes) out.push({ name: asset.name, bytes, mimeType: asset.mimeType });
  }
  return out;
}
