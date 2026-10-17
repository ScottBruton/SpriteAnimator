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
  insertKeyframe,
  preserveWorldPose,
  removeKeyframe,
  snappedLocalTransform,
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

export function deleteAsset(assetId: string): void {
  store().commit('Delete asset', (d) => {
    d.assets = d.assets.filter((a) => a.id !== assetId);
    for (const asm of d.assemblies) asm.sprites = asm.sprites.filter((s) => s.assetId !== assetId);
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
      if (s) s.transform = { position: { ...transform.position }, rotation: transform.rotation, scale: { ...transform.scale }, flipX: transform.flipX, flipY: transform.flipY };
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
    local = snappedLocalTransform({
      childPivot: child.pivot,
      childSocket: socket,
      rotation: rel.rotation,
      scale: rel.scale,
      flipX: rel.flipX,
      flipY: rel.flipY,
    });
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
