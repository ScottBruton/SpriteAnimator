import { Platform } from 'react-native';
import { sharedImageRegistry } from '@elemental/animation-runtime';
import { bytesToBase64 } from '@/utils/base64';

export interface StoredBlob {
  bytes: Uint8Array;
  /** URI usable by <Image>: object URL on web, data URI elsewhere. */
  uri: string;
  mimeType: string;
}

type Listener = () => void;

/**
 * In-memory binary store for the current session, keyed by `imagePath` / `audioPath`.
 * PNG bytes are also decoded into the shared Skia image registry so the editor canvas and the
 * runtime renderer share one texture per asset.
 */
class BlobStore {
  private blobs = new Map<string, StoredBlob>();
  private listeners = new Set<Listener>();

  get(key: string): StoredBlob | undefined {
    return this.blobs.get(key);
  }

  has(key: string): boolean {
    return this.blobs.has(key);
  }

  keys(): string[] {
    return [...this.blobs.keys()];
  }

  put(key: string, bytes: Uint8Array, mimeType = 'image/png'): StoredBlob {
    const prev = this.blobs.get(key);
    if (prev && Platform.OS === 'web' && prev.uri.startsWith('blob:')) {
      URL.revokeObjectURL(prev.uri);
    }
    let uri: string;
    if (Platform.OS === 'web') {
      uri = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType }));
    } else {
      uri = `data:${mimeType};base64,${bytesToBase64(bytes)}`;
    }
    const blob = { bytes, uri, mimeType };
    this.blobs.set(key, blob);
    if (mimeType.startsWith('image/')) sharedImageRegistry.registerBytes(key, bytes);
    this.emit();
    return blob;
  }

  remove(key: string): void {
    const prev = this.blobs.get(key);
    if (!prev) return;
    if (Platform.OS === 'web' && prev.uri.startsWith('blob:')) URL.revokeObjectURL(prev.uri);
    this.blobs.delete(key);
    sharedImageRegistry.remove(key);
    this.emit();
  }

  clear(): void {
    for (const k of [...this.blobs.keys()]) this.remove(k);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}

export const blobStore = new BlobStore();
