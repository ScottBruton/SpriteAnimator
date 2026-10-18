import type { Project } from '@elemental/asset-schema';
import { createProject } from '@elemental/asset-schema';
import { importProjectBackup } from '@/exporters/exportService';
import { pickFiles } from '@/importers/pickFiles';
import { blobStore } from '@/state/blobStore';
import { useEditorStore } from '@/state/editorStore';
import { useProjectStore } from '@/state/projectStore';
import {
  clearActiveWorkspace,
  createProjectFolder,
  hasFolderWorkspace,
  loadProjectFromFolder,
  pickParentDirectory,
  pickProjectDirectory,
  projectFolderName,
  saveProjectToFolder,
  supportsFolderWorkspace,
  tryRestoreWorkspace,
  wipeAndClearWorkspaceFolder,
} from './folderWorkspace';
import { getStorage, SETTING_LAST_PROJECT } from './index';
import { prepareProjectForSave } from './prepareProject';

function afterOpen(project: Project, workspaceFolderName: string | null) {
  useProjectStore.getState().setProject(project, { dirty: false, workspaceFolderName });
  useEditorStore.getState().select([]);
  const asm = project.assemblies.find((a) => a.id === project.activeAssemblyId) ?? project.assemblies[0];
  useEditorStore.getState().setActiveAction(asm?.defaultActionId ?? asm?.actions[0]?.id ?? null);
}

/** Persist the current project into its linked folder (and mirror to local storage). */
export async function saveCurrentProject(): Promise<void> {
  const storage = getStorage();
  const { project, globalAssets } = useProjectStore.getState();
  const toSave = prepareProjectForSave(project);
  useProjectStore.setState({ project: toSave });

  if (hasFolderWorkspace()) {
    await saveProjectToFolder(
      toSave,
      globalAssets.map((a) => a.imagePath),
    );
  }

  // Always keep a local mirror so the Projects list / crash recovery still work.
  const stored = new Set(await storage.listBlobKeys());
  const referenced = new Set<string>([
    ...toSave.assets.map((a) => a.imagePath),
    ...globalAssets.map((a) => a.imagePath),
    ...toSave.audio.map((a) => a.audioPath),
  ]);
  for (const key of referenced) {
    if (stored.has(key)) continue;
    const blob = blobStore.get(key);
    if (blob) await storage.putBlob(key, blob.bytes);
  }
  await storage.saveProject(toSave);
  await storage.saveGlobalAssets(globalAssets);
  await storage.setSetting(SETTING_LAST_PROJECT, toSave.id);
  useProjectStore.getState().markSaved();
}

/** Load a project from local storage (IndexedDB / app docs) by id. */
export async function openProject(id: string): Promise<boolean> {
  const storage = getStorage();
  const project = await storage.loadProject(id);
  if (!project) return false;
  await hydrateBlobs(project);
  await clearActiveWorkspace();
  afterOpen(project, null);
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

/** Open the last folder workspace or last local project; otherwise Untitled. */
export async function restoreLastSession(): Promise<void> {
  await loadGlobalLibrary();
  const restored = await tryRestoreWorkspace();
  if (restored) {
    try {
      const project = await loadProjectFromFolder(restored.dir);
      afterOpen(project, restored.meta.folderName);
      await getStorage().setSetting(SETTING_LAST_PROJECT, project.id);
      return;
    } catch {
      await clearActiveWorkspace();
    }
  }
  const storage = getStorage();
  const last = await storage.getSetting<string>(SETTING_LAST_PROJECT);
  if (last && (await openProject(last))) return;
  const list = await storage.listProjects();
  const first = list[0];
  if (first && (await openProject(first.id))) return;
  useProjectStore.getState().setProject(createProject('Untitled'), { dirty: false, workspaceFolderName: null });
}

/**
 * Create a new project inside a user-chosen parent folder as `Parent/<ProjectName>/`.
 * Requires Chrome/Edge File System Access API.
 */
export async function newProjectInFolder(name: string): Promise<string> {
  if (!supportsFolderWorkspace()) {
    throw new Error('Choose a folder requires Chrome or Edge. Use New project (local only) as a fallback.');
  }
  const parent = await pickParentDirectory();
  const project = createProject(name.trim() || 'Untitled');
  const folder = projectFolderName(project.name);
  await createProjectFolder(parent, project);
  afterOpen(project, folder);
  await saveCurrentProject();
  return `Created “${project.name}” in folder ${folder}`;
}

/** Legacy: new project only in local storage (no disk folder). */
export async function newProject(name: string): Promise<void> {
  await clearActiveWorkspace();
  const project = createProject(name);
  useProjectStore.getState().setProject(project, { dirty: true, workspaceFolderName: null });
  useEditorStore.getState().select([]);
  useEditorStore.getState().setActiveAction(null);
  await saveCurrentProject();
}

/** Open an existing project folder from disk (must contain project.json). */
export async function openProjectFromFolder(): Promise<string> {
  if (!supportsFolderWorkspace()) throw new Error('Opening a folder requires Chrome or Edge.');
  const dir = await pickProjectDirectory();
  const project = await loadProjectFromFolder(dir);
  afterOpen(project, dir.name);
  await saveCurrentProject();
  return `Opened “${project.name}” from ${dir.name}`;
}

/**
 * Bind the current project to a new folder location (Save As to disk).
 * Creates `Parent/<Name>/` and writes the full workspace there.
 */
export async function saveProjectAsFolder(name?: string): Promise<string> {
  if (!supportsFolderWorkspace()) throw new Error('Saving to a folder requires Chrome or Edge.');
  const n = (name ?? useProjectStore.getState().project.name).trim() || 'Untitled';
  if (n !== useProjectStore.getState().project.name) {
    useProjectStore.getState().commit('Rename project', (d) => {
      d.name = n;
    });
  }
  const parent = await pickParentDirectory();
  const project = prepareProjectForSave(useProjectStore.getState().project);
  useProjectStore.setState({ project });
  const folder = projectFolderName(project.name);
  await createProjectFolder(parent, project);
  await saveProjectToFolder(project, useProjectStore.getState().globalAssets.map((a) => a.imagePath));
  useProjectStore.getState().setWorkspaceFolderName(folder);
  await saveCurrentProject();
  return `Saved “${project.name}” to folder ${folder}`;
}

/** Remove a project from local storage only (Projects list). Does not wipe an on-disk folder. */
export async function deleteProject(id: string): Promise<void> {
  const storage = getStorage();
  const current = useProjectStore.getState().project;
  if (current.id === id) {
    await deleteCurrentProjectCompletely();
    return;
  }
  await storage.deleteProject(id);
  const last = await storage.getSetting<string>(SETTING_LAST_PROJECT);
  if (last === id) await storage.setSetting(SETTING_LAST_PROJECT, '');
}

/**
 * Permanently delete the currently open project: local mirror, in-memory blobs,
 * and wipe the linked on-disk project folder contents when one is bound.
 * Leaves a fresh Untitled project open.
 */
export async function deleteCurrentProjectCompletely(): Promise<string> {
  const storage = getStorage();
  const { project, globalAssets } = useProjectStore.getState();
  const id = project.id;
  const name = project.name;
  const globalPaths = new Set(globalAssets.map((a) => a.imagePath));
  const keys = [
    ...project.assets.map((a) => a.imagePath),
    ...project.audio.map((a) => a.audioPath),
  ].filter((k) => k && !globalPaths.has(k));

  let wipedDisk = false;
  if (hasFolderWorkspace()) {
    wipedDisk = await wipeAndClearWorkspaceFolder();
  } else {
    await clearActiveWorkspace();
  }

  for (const key of keys) {
    blobStore.remove(key);
    try {
      await storage.deleteBlob(key);
    } catch {
      /* ignore missing */
    }
  }

  await storage.deleteProject(id);
  const last = await storage.getSetting<string>(SETTING_LAST_PROJECT);
  if (last === id) await storage.setSetting(SETTING_LAST_PROJECT, '');

  const next = createProject('Untitled');
  afterOpen(next, null);
  useProjectStore.setState({ dirty: false });

  return wipedDisk
    ? `Deleted “${name}” and wiped its project folder on disk`
    : `Deleted “${name}” from local storage`;
}

/** Pick a `.ess.zip` backup, load it, then use Save As… to write into a project folder. */
export async function openProjectFromFile(): Promise<string> {
  const [f] = await pickFiles({ types: ['application/zip', '.zip', '.ess.zip'], multiple: false });
  if (!f) throw new Error('No file selected');
  await clearActiveWorkspace();
  const p = await importProjectBackup(f.bytes);
  afterOpen(p, null);
  useProjectStore.setState({ dirty: true });
  return `Loaded “${p.name}” from zip — use Save As… to write it into a project folder`;
}

export { supportsFolderWorkspace, hasFolderWorkspace, getWorkspaceMeta } from './folderWorkspace';
