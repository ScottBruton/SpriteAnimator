import { compareSchemaVersion, SCHEMA_VERSION } from './version';

type Migration = {
  from: string;
  to: string;
  migrate: (doc: Record<string, unknown>) => Record<string, unknown>;
};

/**
 * Ordered list of document migrations. Each migration upgrades a raw (unvalidated) JSON document
 * from `from` to `to`. Add a new entry whenever `SCHEMA_VERSION` changes.
 */
const MIGRATIONS: Migration[] = [
  {
    from: '1.0.0',
    to: '1.1.0',
    // Additive: Transform2D.rotationX/Y default 0; SpriteAsset.orbitHandle optional; new track props.
    migrate: (doc) => doc,
  },
];

export class SchemaVersionError extends Error {
  constructor(public readonly documentVersion: string) {
    super(
      `Document schema version ${documentVersion} is newer than the supported version ${SCHEMA_VERSION}.`,
    );
    this.name = 'SchemaVersionError';
  }
}

/** Upgrade a raw document to the current schema version. Throws if the document is newer. */
export function migrateDocument(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Document must be an object.');
  }
  let doc = raw as Record<string, unknown>;
  let version = typeof doc.schemaVersion === 'string' ? doc.schemaVersion : '1.0.0';
  if (compareSchemaVersion(version, SCHEMA_VERSION) > 0) {
    throw new SchemaVersionError(version);
  }
  for (const m of MIGRATIONS) {
    if (compareSchemaVersion(version, m.from) === 0) {
      doc = m.migrate(doc);
      version = m.to;
    }
  }
  return { ...doc, schemaVersion: SCHEMA_VERSION };
}
