const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Pure-JS base64 encode (no Buffer/atob dependency; works on Hermes and browsers). */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    out += CHARS[(n >> 18) & 63]! + CHARS[(n >> 12) & 63]! + CHARS[(n >> 6) & 63]! + CHARS[n & 63]!;
  }
  if (i < bytes.length) {
    const b0 = bytes[i] as number;
    const b1 = i + 1 < bytes.length ? (bytes[i + 1] as number) : 0;
    const n = (b0 << 16) | (b1 << 8);
    out += CHARS[(n >> 18) & 63]! + CHARS[(n >> 12) & 63]!;
    out += i + 1 < bytes.length ? CHARS[(n >> 6) & 63]! : '=';
    out += '=';
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const lookup = new Uint8Array(256);
  for (let i = 0; i < CHARS.length; i++) lookup[CHARS.charCodeAt(i)] = i;
  const len = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(len);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = lookup[clean.charCodeAt(i)] ?? 0;
    const b = lookup[clean.charCodeAt(i + 1)] ?? 0;
    const c = i + 2 < clean.length ? (lookup[clean.charCodeAt(i + 2)] ?? 0) : 0;
    const d = i + 3 < clean.length ? (lookup[clean.charCodeAt(i + 3)] ?? 0) : 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (p < len) out[p++] = (n >> 16) & 255;
    if (p < len && i + 2 < clean.length) out[p++] = (n >> 8) & 255;
    if (p < len && i + 3 < clean.length) out[p++] = n & 255;
  }
  return out;
}

export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
