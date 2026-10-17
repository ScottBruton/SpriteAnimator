import { createStore, del, get, keys, set } from 'idb-keyval';
import type { Project, ProjectSummary, SpriteAsset } from '@elemental/asset-schema';
import { ProjectSchema, migrateDocument } from '@elemental/asset-schema';
import type { StorageAdapter } from './StorageAdapter';

// idb-keyval supports exactly one object store per database, so each store gets its own DB.
const DB = 'elemental-sprite-studio';
const projects = createStore(`${DB}-projects`, 'projects');
const blobs = createStore(`${DB}-blobs`, 'blobs');
const settings = createStore(`${DB}-settings`, 'settings');

export const webStorage: StorageAdapter = {
  kind: 'web-indexeddb',

  async listProjects() {
    const ids = (await keys(projects)) as string[];
    const out: ProjectSummary[] = [];
    for (const id of ids) {
      const p = (await get<Project>(id, projects)) ?? null;
      if (p) out.push({ id: p.id, name: p.name, updatedAt: p.updatedAt, createdAt: p.createdAt });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async loadProject(id) {
    const raw = await get<unknown>(id, projects);
    if (!raw) return null;
    const parsed = ProjectSchema.safeParse(migrateDocument(raw));
    return parsed.success ? parsed.data : null;
  },

  async saveProject(project) {
    await set(project.id, project, projects);
  },

  async deleteProject(id) {
    await del(id, projects);
  },

  async putBlob(key, bytes) {
    await set(key, bytes, blobs);
  },

  async getBlob(key) {
    const v = await get<Uint8Array | ArrayBuffer>(key, blobs);
    if (!v) return null;
    return v instanceof Uint8Array ? v : new Uint8Array(v);
  },

  async deleteBlob(key) {
    await del(key, blobs);
  },

  async listBlobKeys() {
    return (await keys(blobs)) as string[];
  },

  async loadGlobalAssets() {
    return (await get<SpriteAsset[]>('globalAssets', settings)) ?? [];
  },

  async saveGlobalAssets(assets) {
    await set('globalAssets', assets, settings);
  },

  async getSetting<T>(key: string) {
    return (await get<T>(key, settings)) ?? null;
  },

  async setSetting<T>(key: string, value: T) {
    await set(key, value, settings);
  },
};
