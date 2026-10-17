import { Skia, type SkImage } from '@shopify/react-native-skia';

type Listener = () => void;

/**
 * Shared cache of decoded Skia images keyed by `imagePath`. Many unit instances share one
 * registry so image data is decoded once. Images are released explicitly via `dispose()`.
 */
export class ImageRegistry {
  private images = new Map<string, SkImage>();
  private pending = new Map<string, Promise<SkImage | null>>();
  private listeners = new Set<Listener>();

  get(key: string): SkImage | undefined {
    return this.images.get(key);
  }

  has(key: string): boolean {
    return this.images.has(key);
  }

  keys(): string[] {
    return Array.from(this.images.keys());
  }

  /** Decode PNG bytes synchronously. Returns null when Skia cannot decode. */
  registerBytes(key: string, bytes: Uint8Array): SkImage | null {
    const data = Skia.Data.fromBytes(bytes);
    const img = Skia.Image.MakeImageFromEncoded(data);
    data.dispose?.();
    if (img) this.set(key, img);
    return img;
  }

  registerBase64(key: string, base64: string): SkImage | null {
    const data = Skia.Data.fromBase64(base64);
    const img = Skia.Image.MakeImageFromEncoded(data);
    data.dispose?.();
    if (img) this.set(key, img);
    return img;
  }

  /** Load from a URI (http, file, data, blob). De-duplicates concurrent loads. */
  async registerUri(key: string, uri: string): Promise<SkImage | null> {
    const existing = this.images.get(key);
    if (existing) return existing;
    const inflight = this.pending.get(key);
    if (inflight) return inflight;
    const p = (async () => {
      try {
        const data = await Skia.Data.fromURI(uri);
        const img = Skia.Image.MakeImageFromEncoded(data);
        data.dispose?.();
        if (img) this.set(key, img);
        return img;
      } catch {
        return null;
      } finally {
        this.pending.delete(key);
      }
    })();
    this.pending.set(key, p);
    return p;
  }

  set(key: string, image: SkImage): void {
    const prev = this.images.get(key);
    if (prev && prev !== image) prev.dispose?.();
    this.images.set(key, image);
    this.emit();
  }

  remove(key: string): void {
    const prev = this.images.get(key);
    if (prev) {
      prev.dispose?.();
      this.images.delete(key);
      this.emit();
    }
  }

  dispose(): void {
    for (const img of this.images.values()) img.dispose?.();
    this.images.clear();
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}

/** Default shared registry used when none is provided. */
export const sharedImageRegistry = new ImageRegistry();
