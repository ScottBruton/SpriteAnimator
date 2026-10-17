import type { Draft } from 'immer';
import type {
  AnimationAction,
  AttachmentPoint,
  Interpolation,
  Project,
  SpriteAsset,
  SpriteInstance,
  Transform2D,
  TrackProperty,
  UnitAssembly,
  Vector2,
} from '@elemental/asset-schema';
import { createAction, createId, createLayer, createSpriteInstance } from '@elemental/asset-schema';
import {
  attachmentWorldFrame,
  computeWorldTransforms,
  decomposeNodeMatrix,
  insertKeyframe,
  localNodeMatrix,
  multiply,
  preserveWorldPose,
  removeKeyframe,
  snappedLocalTransform,
  translation,
  wouldCreateCycle,
  type KeyableValue,
  type ResolvedInstance,
} from '@elemental/animation-core';
import { getAssetLookup, useProjectStore, withActiveAssembly } from '@/state/projectStore';
import { useEditorStore } from '@/state/editorStore';

const store = () => useProjectStore.getState();

export function findAsset(draft: Draft<Project>, id: string): Draft<SpriteAsset> | undefined {
  return draft.assets.find((a) => a.id === id);
}

export function findInstance(asm: Draft<UnitAssembly>, id: string): Draft<SpriteInstance> | undefined {
  return asm.sprites.find((s) => s.id === id);
}

// ---- Assets ----------------------------------------------------------------------------------

export function addProjectAsset(asset: SpriteAsset): void {
  store().commit('Import asset', (d) => {
    d.assets.push(asset);
  });
}

export function renameAsset(assetId: string, name: string): void {
  store().commit('Rename asset', (d) => {
    const a = findAsset(d, assetId);
    if (a) a.name = name;
  });
}

/** Normalise a library folder path (`Arms\\Front` → `Arms/Front`). Empty string = unfiled. */
export function normalizeAssetFolder(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

function ensureAssetFolders(d: Draft<Project>): string[] {
  if (!Array.isArray(d.settings.assetFolders)) d.settings.assetFolders = [];
  return d.settings.assetFolders;
}

export function createAssetFolder(folder: string): boolean {
  const f = normalizeAssetFolder(folder);
  if (!f) return false;
  store().commit('Create asset folder', (d) => {
    const list = ensureAssetFolders(d);
    if (!list.includes(f)) list.push(f);
  });
  return true;
}

export function setAssetFolder(assetId: string, folder: string): void {
  setAssetsFolder([assetId], folder);
}

/** Move one or more project assets into a folder (empty string = unfiled). Single undo step. */
export function setAssetsFolder(assetIds: string[], folder: string): void {
  const f = normalizeAssetFolder(folder);
  const ids = [...new Set(assetIds)];
  if (ids.length === 0) return;
  store().commit(ids.length > 1 ? 'Move assets to folder' : f ? 'Move asset to folder' : 'Remove asset from folder', (d) => {
    let moved = false;
    for (const id of ids) {
      const a = findAsset(d, id);
      if (!a) continue;
      a.folder = f;
      a.updatedAt = Date.now();
      moved = true;
    }
    if (moved && f) {
      const list = ensureAssetFolders(d);
      if (!list.includes(f)) list.push(f);
    }
  });
}

function remapFolderPath(path: string, src: string, dst: string): string {
  if (path === src) return dst;
  if (path.startsWith(src + '/')) return dst + path.slice(src.length);
  return path;
}

/** Rename a folder and keep nested paths in sync (`unit/body` → `hero/body`). */
export function renameAssetFolder(from: string, to: string): void {
  const src = normalizeAssetFolder(from);
  const dst = normalizeAssetFolder(to);
  if (!src || !dst || src === dst) return;
  store().commit('Rename asset folder', (d) => {
    const list = ensureAssetFolders(d);
    d.settings.assetFolders = [...new Set(list.map((x) => remapFolderPath(x, src, dst)))];
    for (const a of d.assets) {
      const next = remapFolderPath(normalizeAssetFolder(a.folder ?? ''), src, dst);
      if (next !== a.folder) {
        a.folder = next;
        a.updatedAt = Date.now();
      }
    }
  });
}

/**
 * Remove a folder entry. Assets and nested folders are promoted to the parent
 * (or top-level / unfiled if this was a root folder) — nothing is deleted.
 */
export function deleteAssetFolder(folder: string): void {
  const f = normalizeAssetFolder(folder);
  if (!f) return;
  const parent = (() => {
    const i = f.lastIndexOf('/');
    return i <= 0 ? '' : f.slice(0, i);
  })();
  const promote = (path: string): string => {
    if (path === f) return parent;
    if (path.startsWith(f + '/')) {
      const rest = path.slice(f.length + 1);
      return parent ? `${parent}/${rest}` : rest;
    }
    return path;
  };
  store().commit('Delete asset folder', (d) => {
    const list = ensureAssetFolders(d);
    d.settings.assetFolders = [...new Set(list.filter((x) => x !== f).map(promote))].filter(Boolean);
    for (const a of d.assets) {
      const next = promote(normalizeAssetFolder(a.folder ?? ''));
      if (next !== a.folder) {
        a.folder = next;
        a.updatedAt = Date.now();
      }
    }
  });
}

/**
 * Move a folder (and nested content) under `newParent` (empty = top-level).
 * Example: `units/045` → parent `heroes` becomes `heroes/045`.
 */
export function moveAssetFolder(folder: string, newParent: string): void {
  const src = normalizeAssetFolder(folder);
  if (!src) return;
  const parent = normalizeAssetFolder(newParent);
  if (parent === src || parent.startsWith(src + '/')) return; // cannot move into itself
  const leaf = src.includes('/') ? src.slice(src.lastIndexOf('/') + 1) : src;
  const dst = parent ? `${parent}/${leaf}` : leaf;
  if (dst === src) return;
  renameAssetFolder(src, dst);
}

export function deleteAsset(assetId: string): void {
  deleteAssets([assetId]);
}

/** Remove one or more project assets (and stage sprites that use them). Single undo step. */
export function deleteAssets(assetIds: string[]): void {
  const ids = [...new Set(assetIds)];
  if (ids.length === 0) return;
  const remove = new Set(ids);
  store().commit(ids.length > 1 ? 'Delete assets' : 'Delete asset', (d) => {
    d.assets = d.assets.filter((a) => !remove.has(a.id));
    for (const asm of d.assemblies) asm.sprites = asm.sprites.filter((s) => !remove.has(s.assetId));
  });
}

export function setAssetPivot(assetId: string, pivot: Vector2, transient = false): void {
  const recipe = (d: Draft<Project>) => {
    const a = findAsset(d, assetId);
    if (a) {
      a.pivot = { ...pivot };
      a.updatedAt = Date.now();
    }
  };
  if (transient) store().update(recipe);
  else store().commit('Set pivot', recipe);
}

/** Enable (`position`) or disable (`null`) the optional 3D orbit handle on a sprite asset. */
export function setAssetOrbitHandle(assetId: string, position: Vector2 | null, transient = false): void {
  const recipe = (d: Draft<Project>) => {
    const a = findAsset(d, assetId);
    if (!a) return;
    if (position) a.orbitHandle = { ...position };
    else delete a.orbitHandle;
    a.updatedAt = Date.now();
  };
  if (transient) store().update(recipe);
  else store().commit(position ? 'Set 3D handle' : 'Clear 3D handle', recipe);
}

export function addAttachment(assetId: string, name: string, position: Vector2): string {
  const id = createId('att');
  store().commit('Add attachment', (d) => {
    const a = findAsset(d, assetId);
    if (a) a.attachments.push({ id, name, position: { ...position }, rotation: 0 });
  });
  return id;
}

export function updateAttachment(assetId: string, attachmentId: string, patch: Partial<AttachmentPoint>, transient = false): void {
  const recipe = (d: Draft<Project>) => {
    const a = findAsset(d, assetId);
    const att = a?.attachments.find((x) => x.id === attachmentId);
    if (att) Object.assign(att, patch);
  };
  if (transient) store().update(recipe);
  else store().commit('Edit attachment', recipe);
}

export function removeAttachment(assetId: string, attachmentId: string): void {
  store().commit('Remove attachment', (d) => {
    const a = findAsset(d, assetId);
    if (a) a.attachments = a.attachments.filter((x) => x.id !== attachmentId);
    for (const asm of d.assemblies) {
      for (const s of asm.sprites) {
        if (s.parentAttachmentId === attachmentId) s.parentAttachmentId = undefined;
        if (s.childAttachmentId === attachmentId) s.childAttachmentId = undefined;
      }
    }
  });
}

export function duplicateAttachment(assetId: string, attachmentId: string): void {
  store().commit('Duplicate attachment', (d) => {
    const a = findAsset(d, assetId);
    const att = a?.attachments.find((x) => x.id === attachmentId);
    if (a && att) {
      a.attachments.push({ ...att, id: createId('att'), name: `${att.name}_copy`, position: { x: att.position.x + 8, y: att.position.y + 8 } });
    }
  });
}

// ---- Instances -------------------------------------------------------------------------------

export function placeInstance(asset: SpriteAsset, worldPosition: Vector2): string | null {
  let id: string | null = null;
  store().commit('Place sprite', (d) => {
    withActiveAssembly(d, (asm) => {
      const layer = asm.layers[asm.layers.length - 1] ?? asm.layers[0];
      if (!layer) return;
      const maxOrder = asm.sprites.filter((s) => s.layerId === layer.id).reduce((m, s) => Math.max(m, s.orderInLayer), -1);
      const inst = createSpriteInstance({ asset, layerId: layer.id, position: worldPosition, orderInLayer: maxOrder + 1 });
      // Unique readable names.
      const base = asset.name;
      let n = base;
      let i = 2;
      while (asm.sprites.some((s) => s.name === n)) n = `${base}_${i++}`;
      inst.name = n;
      asm.sprites.push(inst);
      id = inst.id;
    });
  });
  return id;
}

export function deleteInstances(ids: string[]): void {
  if (ids.length === 0) return;
  store().commit('Delete sprites', (d) => {
    withActiveAssembly(d, (asm) => {
      const remove = new Set(ids);
      // Children of removed instances become roots, keeping their world pose approximately (local kept).
      for (const s of asm.sprites) {
        if (s.parentId && remove.has(s.parentId) && !remove.has(s.id)) {
          s.parentId = null;
          s.parentAttachmentId = undefined;
          s.childAttachmentId = undefined;
        }
      }
      asm.sprites = asm.sprites.filter((s) => !remove.has(s.id));
      for (const a of asm.actions) a.tracks = a.tracks.filter((t) => !remove.has(t.targetId));
    });
  });
  useEditorStore.getState().select([]);
}

export function setInstanceTransform(id: string, transform: Transform2D, transient = false): void {
  const recipe = (d: Draft<Project>) =>
    withActiveAssembly(d, (asm) => {
      const s = findInstance(asm, id);
      if (s)
        s.transform = {
          position: { ...transform.position },
          rotation: transform.rotation,
          rotationX: transform.rotationX ?? 0,
          rotationY: transform.rotationY ?? 0,
          scale: { ...transform.scale },
          flipX: transform.flipX,
          flipY: transform.flipY,
        };
    });
  if (transient) store().update(recipe);
  else store().commit('Transform sprite', recipe);
}

export function patchInstance(id: string, patch: Partial<SpriteInstance>, label = 'Edit sprite'): void {
  store().commit(label, (d) =>
    withActiveAssembly(d, (asm) => {
      const s = findInstance(asm, id);
      if (s) Object.assign(s, patch);
    }),
  );
}

export function renameInstance(id: string, name: string): void {
  patchInstance(id, { name }, 'Rename sprite');
}

/**
 * Link `childId` under `parentId` at `parentAttachmentId`.
 * - `mode: 'snap'`: the child's socket (pivot or `childAttachmentId`) is moved onto the attachment.
 * - `mode: 'preserve'`: the child keeps its current world pose.
 */
export function linkInstance(input: {
  childId: string;
  parentId: string;
  parentAttachmentId?: string;
  childAttachmentId?: string;
  mode: 'snap' | 'preserve';
  resolved: ReadonlyMap<string, ResolvedInstance>;
}): boolean {
  const asm = useProjectStore.getState().project.assemblies.find((a) => a.id === useProjectStore.getState().project.activeAssemblyId);
  if (!asm) return false;
  if (wouldCreateCycle(asm.sprites, input.childId, input.parentId)) return false;
  const child = input.resolved.get(input.childId);
  const parent = input.resolved.get(input.parentId);
  if (!child || !parent) return false;
  const world = computeWorldTransforms(input.resolved);
  const childWorld = world.get(input.childId);
  const parentWorld = world.get(input.parentId);
  if (!childWorld || !parentWorld) return false;

  const attachment = input.parentAttachmentId ? parent.asset.attachments.find((a) => a.id === input.parentAttachmentId) : undefined;
  const parentFrame = attachment ? attachmentWorldFrame(parentWorld.node, attachment, parent.pivot) : parentWorld.node;

  let local: Transform2D;
  if (input.mode === 'preserve') {
    local = preserveWorldPose(childWorld.node, parentFrame, child.transform);
  } else {
    const socket = input.childAttachmentId ? child.asset.attachments.find((a) => a.id === input.childAttachmentId)?.position : undefined;
    // Keep the child's current world rotation relative to the new frame.
    const rel = preserveWorldPose(childWorld.node, parentFrame, child.transform);
    local = {
      ...snappedLocalTransform({
        childPivot: child.pivot,
        childSocket: socket,
        rotation: rel.rotation,
        scale: rel.scale,
        flipX: rel.flipX,
        flipY: rel.flipY,
      }),
      rotationX: child.transform.rotationX ?? 0,
      rotationY: child.transform.rotationY ?? 0,
    };
  }

  store().commit('Link sprite', (d) =>
    withActiveAssembly(d, (a) => {
      const s = findInstance(a, input.childId);
      if (!s) return;
      s.parentId = input.parentId;
      s.parentAttachmentId = attachment?.id;
      s.childAttachmentId = input.childAttachmentId;
      s.transform = local;
    }),
  );
  return true;
}

export function unlinkInstance(childId: string, resolved: ReadonlyMap<string, ResolvedInstance>): void {
  const child = resolved.get(childId);
  if (!child || child.instance.parentId === null) return;
  const world = computeWorldTransforms(resolved);
  const cw = world.get(childId);
  if (!cw) return;
  const local = preserveWorldPose(cw.node, [1, 0, 0, 1, 0, 0], child.transform);
  store().commit('Unlink sprite', (d) =>
    withActiveAssembly(d, (a) => {
      const s = findInstance(a, childId);
      if (!s) return;
      s.parentId = null;
      s.parentAttachmentId = undefined;
      s.childAttachmentId = undefined;
      s.transform = local;
    }),
  );
}

/**
 * When a child was linked via a green attachment (`childAttachmentId`), move the asset pivot
 * onto that attachment so rotation orbits the joint. Compensates transforms so the image stays put.
 */
export function setPivotToChildLinkAttachment(instanceId: string, resolved: ReadonlyMap<string, ResolvedInstance>): boolean {
  const child = resolved.get(instanceId);
  if (!child?.instance.parentId || !child.instance.childAttachmentId) return false;
  const socket = child.asset.attachments.find((a) => a.id === child.instance.childAttachmentId);
  if (!socket) return false;

  const newPivot = { ...socket.position };
  const delta = { x: newPivot.x - child.pivot.x, y: newPivot.y - child.pivot.y };

  store().commit('Pivot to link attachment', (d) => {
    const a = findAsset(d, child.asset.id);
    if (a) {
      a.pivot = newPivot;
      a.updatedAt = Date.now();
    }
    withActiveAssembly(d, (asm) => {
      for (const s of asm.sprites) {
        if (s.assetId !== child.asset.id) continue;
        const rr = resolved.get(s.id);
        if (!rr) continue;
        if (delta.x !== 0 || delta.y !== 0) {
          const m = multiply(localNodeMatrix(rr.transform), translation(delta.x, delta.y));
          s.transform = decomposeNodeMatrix(m, rr.transform);
        }
        if (s.id === instanceId) s.childAttachmentId = undefined;
      }
    });
  });
  return true;
}

// ---- Layers ----------------------------------------------------------------------------------

export function addLayer(name = 'Layer'): void {
  store().commit('Add layer', (d) =>
    withActiveAssembly(d, (asm) => {
      let n = name;
      let i = 2;
      while (asm.layers.some((l) => l.name === n)) n = `${name} ${i++}`;
      asm.layers.push(createLayer(n));
    }),
  );
}

export function renameLayer(layerId: string, name: string): void {
  store().commit('Rename layer', (d) =>
    withActiveAssembly(d, (asm) => {
      const l = asm.layers.find((x) => x.id === layerId);
      if (l) l.name = name;
    }),
  );
}

export function deleteLayer(layerId: string): void {
  store().commit('Delete layer', (d) =>
    withActiveAssembly(d, (asm) => {
      if (asm.layers.length <= 1) return;
      const idx = asm.layers.findIndex((l) => l.id === layerId);
      if (idx === -1) return;
      asm.layers.splice(idx, 1);
      const fallback = asm.layers[Math.max(0, idx - 1)]!;
      for (const s of asm.sprites) if (s.layerId === layerId) s.layerId = fallback.id;
    }),
  );
}

export function toggleLayer(layerId: string, key: 'visible' | 'locked'): void {
  store().commit('Toggle layer', (d) =>
    withActiveAssembly(d, (asm) => {
      const l = asm.layers.find((x) => x.id === layerId);
      if (l) l[key] = !l[key];
    }),
  );
}

export function moveLayer(layerId: string, delta: number): void {
  store().commit('Reorder layer', (d) =>
    withActiveAssembly(d, (asm) => {
      const idx = asm.layers.findIndex((l) => l.id === layerId);
      const to = idx + delta;
      if (idx === -1 || to < 0 || to >= asm.layers.length) return;
      const [l] = asm.layers.splice(idx, 1);
      asm.layers.splice(to, 0, l!);
    }),
  );
}

export function moveInstanceToLayer(instanceId: string, layerId: string): void {
  store().commit('Move to layer', (d) =>
    withActiveAssembly(d, (asm) => {
      const s = findInstance(asm, instanceId);
      if (!s) return;
      const maxOrder = asm.sprites.filter((x) => x.layerId === layerId).reduce((m, x) => Math.max(m, x.orderInLayer), -1);
      s.layerId = layerId;
      s.orderInLayer = maxOrder + 1;
    }),
  );
}

export function reorderInLayer(instanceId: string, delta: number): void {
  store().commit('Reorder sprite', (d) =>
    withActiveAssembly(d, (asm) => {
      const s = findInstance(asm, instanceId);
      if (!s) return;
      const siblings = asm.sprites.filter((x) => x.layerId === s.layerId).sort((a, b) => a.orderInLayer - b.orderInLayer);
      const idx = siblings.findIndex((x) => x.id === instanceId);
      const to = idx + delta;
      if (to < 0 || to >= siblings.length) return;
      const [item] = siblings.splice(idx, 1);
      siblings.splice(to, 0, item!);
      siblings.forEach((x, i) => (x.orderInLayer = i));
    }),
  );
}

/** Highest `orderInLayer` in the sprite's layer (renders in front). */
export function bringToFront(instanceId: string): void {
  store().commit('Bring to front', (d) =>
    withActiveAssembly(d, (asm) => {
      const s = findInstance(asm, instanceId);
      if (!s) return;
      const siblings = asm.sprites.filter((x) => x.layerId === s.layerId).sort((a, b) => a.orderInLayer - b.orderInLayer);
      const idx = siblings.findIndex((x) => x.id === instanceId);
      if (idx < 0 || idx === siblings.length - 1) return;
      const [item] = siblings.splice(idx, 1);
      siblings.push(item!);
      siblings.forEach((x, i) => (x.orderInLayer = i));
    }),
  );
}

/** Lowest `orderInLayer` in the sprite's layer (renders behind). */
export function sendToBack(instanceId: string): void {
  store().commit('Send to back', (d) =>
    withActiveAssembly(d, (asm) => {
      const s = findInstance(asm, instanceId);
      if (!s) return;
      const siblings = asm.sprites.filter((x) => x.layerId === s.layerId).sort((a, b) => a.orderInLayer - b.orderInLayer);
      const idx = siblings.findIndex((x) => x.id === instanceId);
      if (idx <= 0) return;
      const [item] = siblings.splice(idx, 1);
      siblings.unshift(item!);
      siblings.forEach((x, i) => (x.orderInLayer = i));
    }),
  );
}

// ---- Actions / keyframes ---------------------------------------------------------------------

export function addAction(name: string, fps: number): string {
  const action = createAction(name, fps, 1);
  store().commit('New action', (d) =>
    withActiveAssembly(d, (asm) => {
      asm.actions.push(action);
      if (!asm.defaultActionId) asm.defaultActionId = action.id;
    }),
  );
  return action.id;
}

export function patchAction(actionId: string, patch: Partial<AnimationAction>, label = 'Edit action'): void {
  store().commit(label, (d) =>
    withActiveAssembly(d, (asm) => {
      const a = asm.actions.find((x) => x.id === actionId);
      if (a) Object.assign(a, patch);
    }),
  );
}

export function deleteAction(actionId: string): void {
  store().commit('Delete action', (d) =>
    withActiveAssembly(d, (asm) => {
      asm.actions = asm.actions.filter((a) => a.id !== actionId);
      if (asm.defaultActionId === actionId) asm.defaultActionId = asm.actions[0]?.id;
      for (const key of Object.keys(asm.behaviors)) if (asm.behaviors[key]?.actionId === actionId) delete asm.behaviors[key];
    }),
  );
}

export function duplicateAction(actionId: string): void {
  store().commit('Duplicate action', (d) =>
    withActiveAssembly(d, (asm) => {
      const a = asm.actions.find((x) => x.id === actionId);
      if (a) asm.actions.push({ ...JSON.parse(JSON.stringify(a)), id: createId('act'), name: `${a.name}_copy` });
    }),
  );
}

export function setKeyframe<P extends keyof KeyableValue>(
  actionId: string,
  targetId: string,
  property: P,
  time: number,
  value: KeyableValue[P],
  interpolation?: Interpolation,
  label = 'Insert keyframe',
): void {
  store().commit(label, (d) =>
    withActiveAssembly(d, (asm) => {
      const idx = asm.actions.findIndex((x) => x.id === actionId);
      const a = asm.actions[idx];
      if (!a) return;
      asm.actions[idx] = insertKeyframe(a as AnimationAction, targetId, property, time, value, interpolation) as Draft<AnimationAction>;
    }),
  );
}

/** Key every transform property of an instance at `time` from the given (current) values. */
export function keyAllTransform(actionId: string, targetId: string, time: number, t: Transform2D, opacity: number, visible: boolean): void {
  store().commit('Insert keyframe', (d) =>
    withActiveAssembly(d, (asm) => {
      const idx = asm.actions.findIndex((x) => x.id === actionId);
      let a = asm.actions[idx] as AnimationAction | undefined;
      if (!a) return;
      a = insertKeyframe(a, targetId, 'position', time, { ...t.position });
      a = insertKeyframe(a, targetId, 'rotation', time, t.rotation);
      a = insertKeyframe(a, targetId, 'rotationX', time, t.rotationX ?? 0);
      a = insertKeyframe(a, targetId, 'rotationY', time, t.rotationY ?? 0);
      a = insertKeyframe(a, targetId, 'scale', time, { ...t.scale });
      a = insertKeyframe(a, targetId, 'opacity', time, opacity);
      a = insertKeyframe(a, targetId, 'visible', time, visible, 'step');
      asm.actions[idx] = a as Draft<AnimationAction>;
    }),
  );
}

export function deleteKeyframes(actionId: string, keys: { targetId: string; property: TrackProperty; time: number }[]): void {
  store().commit('Delete keyframes', (d) =>
    withActiveAssembly(d, (asm) => {
      const idx = asm.actions.findIndex((x) => x.id === actionId);
      let a = asm.actions[idx] as AnimationAction | undefined;
      if (!a) return;
      for (const k of keys) a = removeKeyframe(a, k.targetId, k.property, k.time);
      asm.actions[idx] = a as Draft<AnimationAction>;
    }),
  );
}

export function moveKeyframes(actionId: string, keys: { targetId: string; property: TrackProperty; time: number }[], deltaTime: number): void {
  store().commit('Move keyframes', (d) =>
    withActiveAssembly(d, (asm) => {
      const a = asm.actions.find((x) => x.id === actionId);
      if (!a) return;
      const set = new Set(keys.map((k) => `${k.targetId}|${k.property}|${k.time.toFixed(6)}`));
      for (const track of a.tracks) {
        for (const kf of track.keyframes) {
          if (set.has(`${track.targetId}|${track.property}|${kf.time.toFixed(6)}`)) {
            kf.time = Math.max(0, Math.min(a.duration, kf.time + deltaTime));
          }
        }
        (track.keyframes as { time: number }[]).sort((x, y) => x.time - y.time);
      }
    }),
  );
}

export function setKeyframeInterpolation(actionId: string, keys: { targetId: string; property: TrackProperty; time: number }[], interpolation: Interpolation): void {
  store().commit('Set interpolation', (d) =>
    withActiveAssembly(d, (asm) => {
      const a = asm.actions.find((x) => x.id === actionId);
      if (!a) return;
      for (const k of keys) {
        const track = a.tracks.find((t) => t.targetId === k.targetId && t.property === k.property);
        const kf = track?.keyframes.find((x) => Math.abs(x.time - k.time) < 1e-6);
        if (kf) kf.interpolation = interpolation;
      }
    }),
  );
}

// ---- Assembly --------------------------------------------------------------------------------

export function renameAssembly(name: string): void {
  store().commit('Rename assembly', (d) => withActiveAssembly(d, (asm) => void (asm.name = name)));
}

export function setBehavior(behavior: string, actionId: string | null): void {
  store().commit('Map behaviour', (d) =>
    withActiveAssembly(d, (asm) => {
      if (actionId) asm.behaviors[behavior] = { actionId };
      else delete asm.behaviors[behavior];
    }),
  );
}

export function setDefaultAction(actionId: string | undefined): void {
  store().commit('Default action', (d) => withActiveAssembly(d, (asm) => void (asm.defaultActionId = actionId)));
}

export function renameProject(name: string): void {
  store().commit('Rename project', (d) => void (d.name = name));
}

export const lookupAssetNow = getAssetLookup;
