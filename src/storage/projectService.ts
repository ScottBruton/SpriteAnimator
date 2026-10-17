import type { Project } from '@elemental/asset-schema';
import { createProject } from '@elemental/asset-schema';
import { blobStore } from '@/state/blobStore';
import { useEditorStore } from '@/state/editorStore';
import { useProjectStore } from '@/state/projectStore';
import { getStorage, SETTING_LAST_PROJECT } from './index';

/** Persist the current project document + any blobs not yet stored. */
export async function saveCurrentProject(): Promise<void> {
  const storage = getStorage();
  const { project, globalAssets } = useProjectStore.getState();
  const stored = new Set(await storage.listBlobKeys());
  const referenced = new Set<string>([
    ...project.assets.map((a) => a.imagePath),
    ...globalAssets.map((a) => a.imagePath),
    ...project.audio.map((a) => a.audioPath),
  ]);
  for (const key of referenced) {
    if (stored.has(key)) continue;
    const blob = blobStore.get(key);
    if (blob) await storage.putBlob(key, blob.bytes);
  }
  await storage.saveProject(project);
  await storage.saveGlobalAssets(globalAssets);
  await storage.setSetting(SETTING_LAST_PROJECT, project.id);
  useProjectStore.getState().markSaved();
}

/** Load a project and hydrate its blobs into memory. */
export async function openProject(id: string): Promise<boolean> {
  const storage = getStorage();
  const project = await storage.loadProject(id);
  if (!project) return false;
  await hydrateBlobs(project);
  useProjectStore.getState().setProject(project);
  useEditorStore.getState().select([]);
  useEditorStore.getState().setActiveAction(project.assemblies[0]?.actions[0]?.id ?? null);
  await storage.setSetting(SETTING_LAST_PROJECT, project.id);
  return true;
}

export async function hydrateBlobs(project: Project): Promise<void> {
  const storage = getStorage();
  const { globalAssets } = useProjectStore.getState();
  const keys = new Set<string>([
    ...project.assets.map((a) => a.imagePath),
    ...globalAssets.map((a) => a.imagePath),
    ...project.audio.map((a) => a.audioPath),
  ]);
  for (const key of keys) {
    if (blobStore.has(key)) continue;
    const bytes = await storage.getBlob(key);
    if (bytes) blobStore.put(key, bytes, key.endsWith('.png') ? 'image/png' : 'application/octet-stream');
  }
}

export async function loadGlobalLibrary(): Promise<void> {
  const storage = getStorage();
  const assets = await storage.loadGlobalAssets();
  useProjectStore.getState().setGlobalAssets(assets);
  for (const a of assets) {
    if (blobStore.has(a.imagePath)) continue;
    const bytes = await storage.getBlob(a.imagePath);
    if (bytes) blobStore.put(a.imagePath, bytes, 'image/png');
  }
}

/** Open the last project, or create a fresh one on first launch. */
export async function restoreLastSession(): Promise<void> {
  await loadGlobalLibrary();
  const storage = getStorage();
  const last = await storage.getSetting<string>(SETTING_LAST_PROJECT);
  if (last && (await openProject(last))) return;
  const list = await storage.listProjects();
  const first = list[0];
  if (first && (await openProject(first.id))) return;
  useProjectStore.getState().setProject(createProject('Untitled'), { dirty: false });
}

export async function newProject(name: string): Promise<void> {
  const project = createProject(name);
  useProjectStore.getState().setProject(project, { dirty: true });
  useEditorStore.getState().select([]);
  useEditorStore.getState().setActiveAction(null);
  await saveCurrentProject();
}

export async function deleteProject(id: string): Promise<void> {
  await getStorage().deleteProject(id);
}
