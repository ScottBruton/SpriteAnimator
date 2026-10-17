import { create } from 'zustand';
import type { PoseOverride } from '@elemental/animation-core';

interface PoseOverrideState {
  /** Un-keyed edits made in Animate mode, shown on the canvas until keyed or discarded. */
  overrides: Map<string, PoseOverride>;
  set: (id: string, o: PoseOverride) => void;
  merge: (id: string, o: PoseOverride) => void;
  clear: (ids?: string[]) => void;
}

export const usePoseOverrideStore = create<PoseOverrideState>((set, get) => ({
  overrides: new Map(),
  set: (id, o) => {
    const m = new Map(get().overrides);
    m.set(id, o);
    set({ overrides: m });
  },
  merge: (id, o) => {
    const m = new Map(get().overrides);
    const prev = m.get(id) ?? {};
    m.set(id, { ...prev, ...o, transform: { ...prev.transform, ...o.transform } });
    set({ overrides: m });
  },
  clear: (ids) => {
    if (!ids) {
      if (get().overrides.size) set({ overrides: new Map() });
      return;
    }
    const m = new Map(get().overrides);
    for (const id of ids) m.delete(id);
    set({ overrides: m });
  },
}));
