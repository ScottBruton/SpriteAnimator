/**
 * Stable, URL-safe ids. Uses `crypto.randomUUID` when available (web, Hermes ≥ RN 0.73 via
 * expo-crypto polyfill) and falls back to a time + random based id otherwise.
 */
let counter = 0;

export function createId(prefix?: string): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  let core: string;
  if (g.crypto?.randomUUID) {
    core = g.crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  } else {
    counter = (counter + 1) % 0xffff;
    core = `${Date.now().toString(36)}${Math.floor(Math.random() * 0xffffff).toString(36)}${counter.toString(36)}`;
  }
  return prefix ? `${prefix}_${core}` : core;
}

/** Make a filesystem/URL-safe slug from a display name. */
export function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug.length > 0 ? slug : 'item';
}
