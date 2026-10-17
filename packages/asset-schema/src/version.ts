/**
 * Schema version of every document produced by the editor or runtime.
 * Bump MINOR for backwards-compatible additions, MAJOR for breaking changes.
 * Every bump must ship with a migration in `migrations.ts`.
 */
export const SCHEMA_VERSION = '1.1.0';

export function parseSchemaVersion(v: string): { major: number; minor: number; patch: number } {
  const [maj = '0', min = '0', pat = '0'] = v.split('.');
  return { major: Number(maj), minor: Number(min), patch: Number(pat) };
}

export function compareSchemaVersion(a: string, b: string): number {
  const pa = parseSchemaVersion(a);
  const pb = parseSchemaVersion(b);
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  return pa.patch - pb.patch;
}
