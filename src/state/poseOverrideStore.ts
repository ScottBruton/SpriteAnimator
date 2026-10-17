import { create } from 'zustand';
import type { PoseOverride } from '@elemental/animation-core';

type OverrideMap = Map<string, PoseOverride>;

interface HistoryEntry {
  label: string;
  before: OverrideMap;
}

function cloneOverrides(src: OverrideMap): OverrideMap {
  const out: OverrideMap = new Map();
  for (const [id, o] of src) {
    const t = o.transform;
    out.set(id, {
      opacity: o.opacity,
      visible: o.visible,
      transform: t
        ? {
            ...t,
            ...(t.position ? { position: { ...t.position } } : {}),
            ...(t.scale ? { scale: { ...t.scale } } : {}),
          }
        : undefined,
    });
  }
  return out;
}

interface PoseOverrideState {
  /** Un-keyed edits made in Animate mode, shown on the canvas until keyed or discarded. */
  overrides: OverrideMap;
  past: HistoryEntry[];
  future: HistoryEntry[];
  transaction: HistoryEntry | null;
  beginTransaction: (label: string) => void;
  endTransaction: () => void;
  cancelTransaction: () => void;
  set: (id: string, o: PoseOverride) => void;
  merge: (id: string, o: PoseOverride) => void;
  /** Push a single undoable snapshot then apply `recipe`. */
  commit: (label: string, recipe: (draft: OverrideMap) => void) => void;
  clear: (ids?: string[]) => void;
  /** Clear overrides (selected ids, or all) — returns sprites to the rigged setup pose. */
  resetToRigged: (ids?: string[]) => void;
  undo: () => boolean;
  redo: () => boolean;
}

const MAX_HISTORY = 100;

export const usePoseOverrideStore = create<PoseOverrideState>((set, get) => ({
  overrides: new Map(),
  past: [],
  future: [],
  transaction: null,

  beginTransaction: (label) => {
    const { transaction, overrides } = get();
    if (transaction) return;
    set({ transaction: { label, before: cloneOverrides(overrides) } });
  },

  endTransaction: () => {
    const { transaction, overrides, past } = get();
    if (!transaction) return;
    const changed = transaction.before.size !== overrides.size || [...overrides.entries()].some(([id, o]) => {
      const b = transaction.before.get(id);
      return JSON.stringify(b) !== JSON.stringify(o);
    });
    if (!changed) {
      set({ transaction: null });
      return;
    }
    set({
      transaction: null,
      past: [...past.slice(-MAX_HISTORY + 1), transaction],
      future: [],
    });
  },

  cancelTransaction: () => {
    const { transaction } = get();
    if (!transaction) return;
    set({ transaction: null, overrides: transaction.before });
  },

  set: (id, o) => {
    get().commit('Edit pose', (m) => {
      m.set(id, o);
    });
  },

  merge: (id, o) => {
    const { transaction, overrides, past } = get();
    const apply = (base: OverrideMap) => {
      const m = cloneOverrides(base);
      const prev = m.get(id) ?? {};
      m.set(id, { ...prev, ...o, transform: { ...prev.transform, ...o.transform } });
      return m;
    };
    if (transaction) {
      set({ overrides: apply(overrides) });
      return;
    }
    const before = cloneOverrides(overrides);
    set({
      overrides: apply(overrides),
      past: [...past.slice(-MAX_HISTORY + 1), { label: 'Edit pose', before }],
      future: [],
    });
  },

  commit: (label, recipe) => {
    const { overrides, past, transaction } = get();
    if (transaction) {
      const m = cloneOverrides(overrides);
      recipe(m);
      set({ overrides: m });
      return;
    }
    const before = cloneOverrides(overrides);
    const m = cloneOverrides(overrides);
    recipe(m);
    set({
      overrides: m,
      past: [...past.slice(-MAX_HISTORY + 1), { label, before }],
      future: [],
    });
  },

  clear: (ids) => {
    const label = ids?.length ? 'Discard pose edits' : 'Discard all pose edits';
    get().commit(label, (m) => {
      if (!ids) m.clear();
      else for (const id of ids) m.delete(id);
    });
  },

  resetToRigged: (ids) => {
    const label = ids?.length ? 'Reset selection to rig' : 'Reset to rigged pose';
    get().commit(label, (m) => {
      if (!ids) m.clear();
      else for (const id of ids) m.delete(id);
    });
  },

  undo: () => {
    const { past, future, overrides, transaction } = get();
    if (transaction) {
      set({ transaction: null, overrides: transaction.before });
      return true;
    }
    const entry = past[past.length - 1];
    if (!entry) return false;
    set({
      overrides: entry.before,
      past: past.slice(0, -1),
      future: [...future, { label: entry.label, before: cloneOverrides(overrides) }],
    });
    return true;
  },

  redo: () => {
    const { past, future, overrides } = get();
    const entry = future[future.length - 1];
    if (!entry) return false;
    set({
      overrides: entry.before,
      future: future.slice(0, -1),
      past: [...past, { label: entry.label, before: cloneOverrides(overrides) }],
    });
    return true;
  },
}));
