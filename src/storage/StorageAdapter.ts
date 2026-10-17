import type { Project, ProjectSummary, SpriteAsset } from '@elemental/asset-schema';

/**
 * Local-first persistence. Project documents (small JSON) and binary blobs (PNG/audio) are
 * stored separately so frequent autosaves never rewrite image data.
 */
export interface StorageAdapter {
  readonly kind: 'web-indexeddb' | 'native-filesystem' | 'memory';
  listProjects(): Promise<ProjectSummary[]>;
  loadProject(id: string): Promise<Project | null>;
  saveProject(project: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;

  putBlob(key: string, bytes: Uint8Array): Promise<void>;
  getBlob(key: string): Promise<Uint8Array | null>;
  deleteBlob(key: string): Promise<void>;
  listBlobKeys(): Promise<string[]>;

  loadGlobalAssets(): Promise<SpriteAsset[]>;
  saveGlobalAssets(assets: SpriteAsset[]): Promise<void>;

  getSetting<T>(key: string): Promise<T | null>;
  setSetting<T>(key: string, value: T): Promise<void>;
}

export const SETTING_LAST_PROJECT = 'lastProjectId';
