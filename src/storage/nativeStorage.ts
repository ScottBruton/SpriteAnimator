import { Directory, File, Paths } from 'expo-file-system';
import type { Project, ProjectSummary, SpriteAsset } from '@elemental/asset-schema';
import { ProjectSchema, migrateDocument } from '@elemental/asset-schema';
import type { StorageAdapter } from './StorageAdapter';

const root = new Directory(Paths.document, 'elemental-sprite-studio');
const projectsDir = new Directory(root, 'projects');
const blobsDir = new Directory(root, 'blobs');
const settingsFile = new File(root, 'settings.json');
const globalAssetsFile = new File(root, 'global-assets.json');

function ensureDirs() {
  for (const d of [root, projectsDir, blobsDir]) {
    if (!d.exists) d.create({ intermediates: true, idempotent: true });
  }
}

/** Blob keys are relative paths like `assets/body.png`; store them flat with a safe filename. */
function blobFile(key: string): File {
  return new File(blobsDir, encodeURIComponent(key));
}

async function readJson<T>(file: File): Promise<T | null> {
  try {
    if (!file.exists) return null;
    return JSON.parse(await file.text()) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: File, value: unknown) {
  ensureDirs();
  if (!file.exists) file.create({ intermediates: true, overwrite: true });
  await file.write(JSON.stringify(value));
}

export const nativeStorage: StorageAdapter = {
  kind: 'native-filesystem',

  async listProjects() {
    ensureDirs();
    const out: ProjectSummary[] = [];
    for (const entry of projectsDir.list()) {
      if (entry instanceof File && entry.name.endsWith('.json')) {
        const p = await readJson<Project>(entry);
        if (p) out.push({ id: p.id, name: p.name, updatedAt: p.updatedAt, createdAt: p.createdAt });
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async loadProject(id) {
    ensureDirs();
    const raw = await readJson<unknown>(new File(projectsDir, `${id}.json`));
    if (!raw) return null;
    const parsed = ProjectSchema.safeParse(migrateDocument(raw));
    return parsed.success ? parsed.data : null;
  },

  async saveProject(project) {
    await writeJson(new File(projectsDir, `${project.id}.json`), project);
  },

  async deleteProject(id) {
    const f = new File(projectsDir, `${id}.json`);
    if (f.exists) f.delete();
  },

  async putBlob(key, bytes) {
    ensureDirs();
    const f = blobFile(key);
    if (!f.exists) f.create({ intermediates: true, overwrite: true });
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    await f.write(copy.buffer);
  },

  async getBlob(key) {
    const f = blobFile(key);
    if (!f.exists) return null;
    return f.bytes();
  },

  async deleteBlob(key) {
    const f = blobFile(key);
    if (f.exists) f.delete();
  },

  async listBlobKeys() {
    ensureDirs();
    return blobsDir
      .list()
      .filter((e): e is File => e instanceof File)
      .map((f) => decodeURIComponent(f.name));
  },

  async loadGlobalAssets() {
    return (await readJson<SpriteAsset[]>(globalAssetsFile)) ?? [];
  },

  async saveGlobalAssets(assets) {
    await writeJson(globalAssetsFile, assets);
  },

  async getSetting<T>(key: string) {
    const all = (await readJson<Record<string, unknown>>(settingsFile)) ?? {};
    return (all[key] as T | undefined) ?? null;
  },

  async setSetting<T>(key: string, value: T) {
    const all = (await readJson<Record<string, unknown>>(settingsFile)) ?? {};
    all[key] = value;
    await writeJson(settingsFile, all);
  },
};
