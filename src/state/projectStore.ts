import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import type { Project, SpriteAsset, UnitAssembly } from '@elemental/asset-schema';
import { createProject } from '@elemental/asset-schema';

export type ProjectRecipe = (draft: Draft<Project>) => void;

interface HistoryEntry {
  label: string;
  before: Project;
}

interface ProjectState {
  project: Project;
  /** Global library assets (shared across projects). */
  globalAssets: SpriteAsset[];
  /** Display name of the linked on-disk project folder (null = not linked). */
  workspaceFolderName: string | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  dirty: boolean;
  lastSavedAt: number | null;
  /** Non-null while a drag/transient edit is in progress. */
  transaction: { label: string; before: Project } | null;

  setProject: (project: Project, opts?: { dirty?: boolean; workspaceFolderName?: string | null }) => void;
  setWorkspaceFolderName: (name: string | null) => void;
  setGlobalAssets: (assets: SpriteAsset[]) => void;
  /** Undoable edit. */
  commit: (label: string, recipe: ProjectRecipe) => void;
  /** Begin a transient edit (drag). Subsequent `update` calls do not push history. */
  beginTransaction: (label: string) => void;
  update: (recipe: ProjectRecipe) => void;
  endTransaction: () => void;
  cancelTransaction: () => void;
  undo: () => void;
  redo: () => void;
  markSaved: () => void;
}

const MAX_HISTORY = 200;

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: createProject('Untitled'),
  globalAssets: [],
  workspaceFolderName: null,
  past: [],
  future: [],
  dirty: false,
  lastSavedAt: null,
  transaction: null,

  setProject: (project, opts) =>
    set((s) => ({
      project,
      past: [],
      future: [],
      dirty: opts?.dirty ?? false,
      transaction: null,
      lastSavedAt: opts?.dirty ? null : Date.now(),
      workspaceFolderName: opts?.workspaceFolderName !== undefined ? opts.workspaceFolderName : s.workspaceFolderName,
    })),

  setWorkspaceFolderName: (workspaceFolderName) => set({ workspaceFolderName }),

  setGlobalAssets: (assets) => set({ globalAssets: assets }),

  commit: (label, recipe) => {
    const { project, past, transaction } = get();
    const next = produce(project, (d) => {
      recipe(d);
      d.updatedAt = Date.now();
    });
    if (next === project) return;
    // Inside a transaction, commits are folded into the single pending history entry.
    if (transaction) {
      set({ project: next, dirty: true });
      return;
    }
    set({
      project: next,
      past: [...past.slice(-MAX_HISTORY + 1), { label, before: project }],
      future: [],
      dirty: true,
    });
  },

  beginTransaction: (label) => {
    const { project, transaction } = get();
    if (transaction) return;
    set({ transaction: { label, before: project } });
  },

  update: (recipe) => {
    const { project } = get();
    const next = produce(project, recipe);
    if (next !== project) set({ project: next, dirty: true });
  },

  endTransaction: () => {
    const { transaction, project, past } = get();
    if (!transaction) return;
    if (transaction.before === project) {
      set({ transaction: null });
      return;
    }
    set({
      transaction: null,
      project: { ...project, updatedAt: Date.now() },
      past: [...past.slice(-MAX_HISTORY + 1), { label: transaction.label, before: transaction.before }],
      future: [],
    });
  },

  cancelTransaction: () => {
    const { transaction } = get();
    if (!transaction) return;
    set({ transaction: null, project: transaction.before });
  },

  undo: () => {
    const { past, future, project } = get();
    const entry = past[past.length - 1];
    if (!entry) return;
    set({
      project: entry.before,
      past: past.slice(0, -1),
      future: [...future, { label: entry.label, before: project }],
      dirty: true,
    });
  },

  redo: () => {
    const { past, future, project } = get();
    const entry = future[future.length - 1];
    if (!entry) return;
    set({
      project: entry.before,
      future: future.slice(0, -1),
      past: [...past, { label: entry.label, before: project }],
      dirty: true,
    });
  },

  markSaved: () => set({ dirty: false, lastSavedAt: Date.now() }),
}));

// ---- Selectors -------------------------------------------------------------------------------

export function selectActiveAssembly(p: Project): UnitAssembly | undefined {
  return p.assemblies.find((a) => a.id === p.activeAssemblyId) ?? p.assemblies[0];
}

export const useActiveAssembly = (): UnitAssembly | undefined => useProjectStore((s) => selectActiveAssembly(s.project));

/** Mutate the active assembly inside a recipe. */
export function withActiveAssembly(draft: Draft<Project>, fn: (asm: Draft<UnitAssembly>) => void): void {
  const asm = draft.assemblies.find((a) => a.id === draft.activeAssemblyId) ?? draft.assemblies[0];
  if (asm) fn(asm);
}

/** Lookup across project + global assets. */
export function useAssetLookup(): (id: string) => SpriteAsset | undefined {
  const projectAssets = useProjectStore((s) => s.project.assets);
  const globalAssets = useProjectStore((s) => s.globalAssets);
  const map = new Map<string, SpriteAsset>();
  for (const a of globalAssets) map.set(a.id, a);
  for (const a of projectAssets) map.set(a.id, a);
  return (id) => map.get(id);
}

export function getAssetLookup(): (id: string) => SpriteAsset | undefined {
  const { project, globalAssets } = useProjectStore.getState();
  const map = new Map<string, SpriteAsset>();
  for (const a of globalAssets) map.set(a.id, a);
  for (const a of project.assets) map.set(a.id, a);
  return (id) => map.get(id);
}
