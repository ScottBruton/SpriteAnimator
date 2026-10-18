/**
 * Live project folder on the user's disk (Chrome/Edge File System Access API on web).
 * Layout:
 *   ProjectName/
 *     project.json
 *     assets/…
 *     audio/…
 */
import { Platform } from 'react-native';
import { get, set, del } from 'idb-keyval';
import type { Project } from '@elemental/asset-schema';
import { ProjectSchema, migrateDocument } from '@elemental/asset-schema';
import { blobStore } from '@/state/blobStore';
import { utf8Decode, utf8Encode } from '@/utils/base64';

const HANDLE_KEY = 'workspaceDirHandle';
const HANDLE_META_KEY = 'workspaceDirMeta';

export type WorkspaceMeta = {
  folderName: string;
  projectId: string;
  projectName: string;
};

/** In-memory active project directory (web FileSystemDirectoryHandle). */
let activeDir: FileSystemDirectoryHandle | null = null;
let activeMeta: WorkspaceMeta | null = null;

export function getWorkspaceMeta(): WorkspaceMeta | null {
  return activeMeta;
}

export function hasFolderWorkspace(): boolean {
  return activeDir != null;
}

export function supportsFolderWorkspace(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined' && typeof (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

/** Safe folder name for the OS (keeps spaces / casing). */
export function projectFolderName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .slice(0, 120);
  return cleaned || 'Untitled';
}

async function ensurePermission(dir: FileSystemDirectoryHandle, mode: FileSystemPermissionMode = 'readwrite'): Promise<boolean> {
  const withPerm = dir as FileSystemDirectoryHandle & {
    queryPermission?: (o: { mode: FileSystemPermissionMode }) => Promise<PermissionState>;
    requestPermission?: (o: { mode: FileSystemPermissionMode }) => Promise<PermissionState>;
  };
  if (withPerm.queryPermission) {
    let state = await withPerm.queryPermission({ mode });
    if (state === 'granted') return true;
    if (withPerm.requestPermission) {
      state = await withPerm.requestPermission({ mode });
      return state === 'granted';
    }
    return false;
  }
  return true;
}

export async function pickParentDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!supportsFolderWorkspace()) throw new Error('Folder workspaces require Chrome or Edge (File System Access API).');
  const dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'elemental-project-parent' });
  if (!(await ensurePermission(dir))) throw new Error('Permission to write to that folder was denied.');
  return dir;
}

export async function pickProjectDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!supportsFolderWorkspace()) throw new Error('Folder workspaces require Chrome or Edge (File System Access API).');
  const dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'elemental-project-open' });
  if (!(await ensurePermission(dir))) throw new Error('Permission to read that folder was denied.');
  return dir;
}

async function getOrCreateDir(parent: FileSystemDirectoryHandle, name: string): Promise<FileSystemDirectoryHandle> {
  return parent.getDirectoryHandle(name, { create: true });
}

async function writeFile(root: FileSystemDirectoryHandle, relativePath: string, data: Uint8Array | string): Promise<void> {
  const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length === 0) throw new Error('Empty path');
  let dir = root;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await getOrCreateDir(dir, parts[i]!);
  }
  const fileName = parts[parts.length - 1]!;
  const file = await dir.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();
  const bytes = typeof data === 'string' ? utf8Encode(data) : data;
  await writable.write(bytes as BufferSource);
  await writable.close();
}

async function readFile(root: FileSystemDirectoryHandle, relativePath: string): Promise<Uint8Array | null> {
  try {
    const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
    let dir = root;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]!);
    }
    const file = await (await dir.getFileHandle(parts[parts.length - 1]!)).getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

async function collectFiles(dir: FileSystemDirectoryHandle, prefix: string, out: { path: string; bytes: Uint8Array }[]): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      await collectFiles(handle, path, out);
    } else {
      const file = await (handle as FileSystemFileHandle).getFile();
      out.push({ path, bytes: new Uint8Array(await file.arrayBuffer()) });
    }
  }
}

export async function setActiveWorkspace(dir: FileSystemDirectoryHandle, meta: WorkspaceMeta): Promise<void> {
  activeDir = dir;
  activeMeta = meta;
  if (Platform.OS === 'web') {
    await set(HANDLE_KEY, dir);
    await set(HANDLE_META_KEY, meta);
  }
}

export async function clearActiveWorkspace(): Promise<void> {
  activeDir = null;
  activeMeta = null;
  if (Platform.OS === 'web') {
    await del(HANDLE_KEY);
    await del(HANDLE_META_KEY);
  }
}

/** Recursively delete every entry inside a directory (does not remove the directory itself). */
async function wipeDirectoryContents(dir: FileSystemDirectoryHandle): Promise<void> {
  const names: { name: string; kind: 'file' | 'directory' }[] = [];
  for await (const [name, handle] of dir.entries()) {
    names.push({ name, kind: handle.kind });
  }
  for (const entry of names) {
    await dir.removeEntry(entry.name, { recursive: entry.kind === 'directory' });
  }
}

/**
 * Wipe the linked project folder on disk (all files inside), then clear the workspace binding.
 * The empty folder shell may remain on disk — FSA cannot delete the directory we hold a handle to
 * without its parent. Returns true if a folder was wiped.
 */
export async function wipeAndClearWorkspaceFolder(): Promise<boolean> {
  if (!activeDir) {
    await clearActiveWorkspace();
    return false;
  }
  if (!(await ensurePermission(activeDir))) {
    throw new Error('Lost permission to the project folder. Grant access and try again, or delete the folder manually in Explorer.');
  }
  await wipeDirectoryContents(activeDir);
  await clearActiveWorkspace();
  return true;
}

/** Try to restore the last folder workspace (may need a user gesture for permission). */
export async function tryRestoreWorkspace(): Promise<{ dir: FileSystemDirectoryHandle; meta: WorkspaceMeta } | null> {
  if (Platform.OS !== 'web') return null;
  const dir = (await get(HANDLE_KEY)) as FileSystemDirectoryHandle | undefined;
  const meta = (await get(HANDLE_META_KEY)) as WorkspaceMeta | undefined;
  if (!dir || !meta) return null;
  const ok = await ensurePermission(dir);
  if (!ok) return null;
  activeDir = dir;
  activeMeta = meta;
  return { dir, meta };
}

/**
 * Create `parent/<ProjectName>/` with project.json + empty assets/audio folders and bind it.
 */
export async function createProjectFolder(parent: FileSystemDirectoryHandle, project: Project): Promise<FileSystemDirectoryHandle> {
  const folder = projectFolderName(project.name);
  // Fail clearly if a same-named folder already exists with content.
  try {
    const existing = await parent.getDirectoryHandle(folder, { create: false });
    let hasProject = false;
    try {
      await existing.getFileHandle('project.json');
      hasProject = true;
    } catch {
      /* empty or other */
    }
    if (hasProject) throw new Error(`A project folder named “${folder}” already exists here. Choose another name or location.`);
  } catch (e) {
    if (e instanceof Error && e.message.includes('already exists')) throw e;
    // NotFoundError → create below
  }
  const projectDir = await parent.getDirectoryHandle(folder, { create: true });
  await getOrCreateDir(projectDir, 'assets');
  await getOrCreateDir(projectDir, 'audio');
  await writeFile(projectDir, 'project.json', JSON.stringify(project, null, 2));
  await setActiveWorkspace(projectDir, { folderName: folder, projectId: project.id, projectName: project.name });
  return projectDir;
}

/** Write project.json + all in-memory blobs into the active (or given) project folder. */
export async function saveProjectToFolder(project: Project, globalAssetPaths: string[] = [], dir = activeDir): Promise<void> {
  if (!dir) throw new Error('No project folder is linked. Use New project or Open project folder…');
  if (!(await ensurePermission(dir))) throw new Error('Lost permission to the project folder. Open it again.');
  await writeFile(dir, 'project.json', JSON.stringify(project, null, 2));
  await getOrCreateDir(dir, 'assets');
  await getOrCreateDir(dir, 'audio');
  const paths = new Set<string>([...project.assets.map((a) => a.imagePath), ...project.audio.map((a) => a.audioPath), ...globalAssetPaths]);
  for (const p of paths) {
    const blob = blobStore.get(p);
    if (!blob) continue;
    // Keep paths under assets/ or audio/; otherwise nest under assets/
    const rel = p.includes('/') ? p : `assets/${p}`;
    await writeFile(dir, rel, blob.bytes);
  }
  activeDir = dir;
  activeMeta = {
    folderName: dir.name,
    projectId: project.id,
    projectName: project.name,
  };
  if (Platform.OS === 'web') {
    await set(HANDLE_KEY, dir);
    await set(HANDLE_META_KEY, activeMeta);
  }
}

/** Load project.json + assets/audio from a project folder into memory. */
export async function loadProjectFromFolder(dir: FileSystemDirectoryHandle): Promise<Project> {
  if (!(await ensurePermission(dir, 'readwrite'))) throw new Error('Permission to that folder was denied.');
  const raw = await readFile(dir, 'project.json');
  if (!raw) throw new Error('That folder is not a project (project.json missing). Pick the project folder itself.');
  const parsed = ProjectSchema.safeParse(migrateDocument(JSON.parse(utf8Decode(raw))));
  if (!parsed.success) throw new Error(`Invalid project.json: ${parsed.error.issues[0]?.message ?? 'parse failed'}`);
  const project = parsed.data;

  const files: { path: string; bytes: Uint8Array }[] = [];
  for (const sub of ['assets', 'audio'] as const) {
    try {
      const subDir = await dir.getDirectoryHandle(sub);
      await collectFiles(subDir, sub, files);
    } catch {
      /* optional */
    }
  }
  for (const f of files) {
    blobStore.put(f.path, f.bytes, f.path.endsWith('.png') ? 'image/png' : 'application/octet-stream');
  }

  await setActiveWorkspace(dir, { folderName: dir.name, projectId: project.id, projectName: project.name });
  return project;
}
