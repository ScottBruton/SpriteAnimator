import {
  ActionPackageSchema,
  AssemblyPackageSchema,
  migrateDocument,
  type ActionPackage,
  type AssemblyPackage,
  type SpriteAsset,
} from '@elemental/asset-schema';

export class AssemblyLoadError extends Error {
  constructor(message: string, public readonly issues?: unknown) {
    super(message);
    this.name = 'AssemblyLoadError';
  }
}

/** Parse, migrate and validate an `assembly.json` document. */
export function loadAssemblyPackage(raw: unknown): AssemblyPackage {
  const doc = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  const migrated = migrateDocument(doc);
  const result = AssemblyPackageSchema.safeParse(migrated);
  if (!result.success) {
    throw new AssemblyLoadError('Invalid assembly package', result.error.issues);
  }
  return result.data;
}

export function loadActionPackage(raw: unknown): ActionPackage {
  const doc = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  const migrated = migrateDocument(doc);
  const result = ActionPackageSchema.safeParse(migrated);
  if (!result.success) {
    throw new AssemblyLoadError('Invalid action package', result.error.issues);
  }
  return result.data;
}

/** Fast asset lookup for a package. */
export function createAssetLookup(assets: readonly SpriteAsset[]): (id: string) => SpriteAsset | undefined {
  const map = new Map(assets.map((a) => [a.id, a] as const));
  return (id) => map.get(id);
}

/**
 * Static asset registry for React Native Metro bundles. Metro cannot `require()` dynamic paths,
 * so the exporter generates a file that maps `imagePath` -> `require('./assets/x.png')`.
 * At runtime these modules are resolved by `Image.resolveAssetSource` / Skia's `useImage`.
 */
export type StaticAssetRegistry = Record<string, number | { uri: string }>;
