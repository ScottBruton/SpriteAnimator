import type {
  AnimationAction,
  AnimationChannel,
  AnimationMask,
  AnimationTrack,
  Direction,
  TrackProperty,
  Transform2D,
  UnitAssembly,
  Vector2,
} from '@elemental/asset-schema';
import { BASE_CHANNEL_ID } from '@elemental/asset-schema';
import { constrainRotation } from '../constraints/joint';
import { lerp } from '../math/angles';
import { vlerp } from '../math/vec2';
import { computeWorldTransforms, type ResolvedInstance, type WorldTransforms } from '../transforms/worldMatrices';
import { resolveSetupPose, type AssetLookup } from './resolveDirection';
import { resolveActionTime, sampleTrack } from './sampleTrack';

/** One action currently playing on a channel. */
export interface PlayingLayer {
  actionId: string;
  /** Absolute seconds since the action started (wrapped/clamped internally). */
  time: number;
  channelId?: string;
  /** 0..1 blend weight, used for cross-fades. Default 1. */
  weight?: number;
}

export interface EvaluateInput {
  assembly: UnitAssembly;
  direction: Direction;
  layers: readonly PlayingLayer[];
  lookupAsset: AssetLookup;
  /** When false (editor "setup mode"), animation is ignored and the setup pose is returned. */
  applyAnimation?: boolean;
  /** Apply joint limits (default true). */
  applyConstraints?: boolean;
  /**
   * Per-instance overrides applied after animation and before constraints. Used by the editor for
   * un-keyed edits in Animate mode and by games for procedural adjustments (e.g. turret aiming).
   */
  overrides?: ReadonlyMap<string, PoseOverride>;
}

export interface PoseOverride {
  transform?: Partial<Transform2D>;
  opacity?: number;
  visible?: boolean;
}

export interface RenderItem {
  instanceId: string;
  assetId: string;
  width: number;
  height: number;
  /** Image-local → world. */
  matrix: WorldTransforms['draw'];
  opacity: number;
  layerId: string;
}

export interface EvaluatedPose {
  resolved: Map<string, ResolvedInstance>;
  world: Map<string, WorldTransforms>;
  /** Back-to-front draw order of visible instances. */
  renderList: RenderItem[];
  layerOrder: string[];
  missingAssets: string[];
}

function maskAllows(mask: AnimationMask | undefined, instanceId: string, property: TrackProperty): boolean {
  if (!mask) return true;
  if (mask.instanceIds && !mask.instanceIds.includes(instanceId)) return false;
  if (mask.properties && !mask.properties.includes(property)) return false;
  return true;
}

function applyTrackValue(
  target: ResolvedInstance,
  track: AnimationTrack,
  value: number | Vector2 | boolean,
  weight: number,
  mode: AnimationChannel['blendMode'],
): void {
  switch (track.property) {
    case 'position': {
      const v = value as Vector2;
      target.transform.position =
        mode === 'additive'
          ? { x: target.transform.position.x + v.x * weight, y: target.transform.position.y + v.y * weight }
          : vlerp(target.transform.position, v, weight);
      break;
    }
    case 'rotation': {
      const v = value as number;
      target.transform.rotation =
        mode === 'additive' ? target.transform.rotation + v * weight : lerp(target.transform.rotation, v, weight);
      break;
    }
    case 'rotationX': {
      const v = value as number;
      target.transform.rotationX =
        mode === 'additive' ? target.transform.rotationX + v * weight : lerp(target.transform.rotationX, v, weight);
      break;
    }
    case 'rotationY': {
      const v = value as number;
      target.transform.rotationY =
        mode === 'additive' ? target.transform.rotationY + v * weight : lerp(target.transform.rotationY, v, weight);
      break;
    }
    case 'scale': {
      const v = value as Vector2;
      target.transform.scale =
        mode === 'additive'
          ? { x: target.transform.scale.x * lerp(1, v.x, weight), y: target.transform.scale.y * lerp(1, v.y, weight) }
          : vlerp(target.transform.scale, v, weight);
      break;
    }
    case 'opacity': {
      const v = value as number;
      target.opacity = mode === 'additive' ? Math.min(1, Math.max(0, target.opacity + v * weight)) : lerp(target.opacity, v, weight);
      break;
    }
    case 'visible': {
      if (weight >= 0.5) target.visible = value as boolean;
      break;
    }
    default:
      break;
  }
}

/**
 * Deterministic pose evaluation.
 *
 * 1. Start from the direction's setup pose.
 * 2. Sort channels by `priority` (ascending, then id for stability). Layers without a channel use
 *    the base channel.
 * 3. For each channel in order, for each playing layer on that channel (in input order), sample
 *    every track at the layer's local time and apply it with the channel's blend mode and the
 *    layer's weight, subject to the action mask and the channel mask.
 * 4. Apply joint constraints relative to the setup pose.
 * 5. Compute world matrices and the back-to-front render list.
 */
export function evaluatePose(input: EvaluateInput): EvaluatedPose {
  const { assembly, direction, lookupAsset } = input;
  const { resolved, layerOrder, missing } = resolveSetupPose(assembly, direction, lookupAsset);
  const restRotations = new Map<string, number>();
  for (const [id, r] of resolved) restRotations.set(id, r.transform.rotation);

  if (input.applyAnimation !== false && input.layers.length > 0) {
    const actionsById = new Map<string, AnimationAction>(assembly.actions.map((a) => [a.id, a]));
    const channelsById = new Map<string, AnimationChannel>(assembly.channels.map((c) => [c.id, c]));
    const sortedChannels = [...assembly.channels].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    const baseChannel: AnimationChannel = channelsById.get(BASE_CHANNEL_ID) ?? {
      id: BASE_CHANNEL_ID,
      name: 'Base',
      priority: Number.NEGATIVE_INFINITY,
      blendMode: 'override',
    };
    if (!channelsById.has(baseChannel.id)) sortedChannels.unshift(baseChannel);

    for (const channel of sortedChannels) {
      for (const layer of input.layers) {
        const layerChannelId = layer.channelId ?? actionsById.get(layer.actionId)?.channelId ?? BASE_CHANNEL_ID;
        if (layerChannelId !== channel.id) continue;
        const action = actionsById.get(layer.actionId);
        if (!action) continue;
        const weight = Math.min(1, Math.max(0, layer.weight ?? 1));
        if (weight <= 0) continue;
        const t = resolveActionTime(layer.time, action.duration, action.loop);
        for (const track of action.tracks) {
          const target = resolved.get(track.targetId);
          if (!target) continue;
          if (!maskAllows(action.mask, track.targetId, track.property)) continue;
          if (!maskAllows(channel.mask, track.targetId, track.property)) continue;
          const value = sampleTrack(track, t);
          if (value === undefined) continue;
          applyTrackValue(target, track, value, weight, channel.blendMode);
        }
      }
    }
  }

  if (input.overrides) {
    for (const [id, o] of input.overrides) {
      const r = resolved.get(id);
      if (!r) continue;
      if (o.transform) r.transform = { ...r.transform, ...o.transform };
      if (o.opacity !== undefined) r.opacity = o.opacity;
      if (o.visible !== undefined) r.visible = o.visible;
    }
  }

  if (input.applyConstraints !== false) {
    for (const [id, r] of resolved) {
      if (r.instance.joint) {
        r.transform.rotation = constrainRotation(r.transform.rotation, restRotations.get(id) ?? 0, r.instance.joint);
      }
    }
  }

  const world = computeWorldTransforms(resolved);
  const renderList = buildRenderList(resolved, world, layerOrder, assembly);
  return { resolved, world, renderList, layerOrder, missingAssets: missing };
}

/** Visible instances sorted by layer order then `orderInLayer`, honouring hidden layers and parents. */
export function buildRenderList(
  resolved: ReadonlyMap<string, ResolvedInstance>,
  world: ReadonlyMap<string, WorldTransforms>,
  layerOrder: readonly string[],
  assembly: UnitAssembly,
): RenderItem[] {
  const layerIndex = new Map<string, number>();
  layerOrder.forEach((id, i) => layerIndex.set(id, i));
  const hiddenLayers = new Set(assembly.layers.filter((l) => !l.visible).map((l) => l.id));

  // A hidden parent hides its subtree (visibility is inherited); opacity is inherited multiplicatively.
  const effVisible = new Map<string, boolean>();
  const effOpacity = new Map<string, number>();
  const compute = (id: string): void => {
    if (effVisible.has(id)) return;
    const r = resolved.get(id);
    if (!r) {
      effVisible.set(id, false);
      effOpacity.set(id, 0);
      return;
    }
    let vis = r.visible && !hiddenLayers.has(r.layerId);
    let op = r.opacity;
    const p = r.instance.parentId;
    if (p !== null && resolved.has(p)) {
      compute(p);
      vis = vis && (effVisible.get(p) ?? true);
      op *= effOpacity.get(p) ?? 1;
    }
    effVisible.set(id, vis);
    effOpacity.set(id, op);
  };

  const items: RenderItem[] = [];
  for (const [id, r] of resolved) {
    compute(id);
    if (!effVisible.get(id)) continue;
    const w = world.get(id);
    if (!w) continue;
    items.push({
      instanceId: id,
      assetId: r.asset.id,
      width: r.asset.width,
      height: r.asset.height,
      matrix: w.draw,
      opacity: effOpacity.get(id) ?? 1,
      layerId: r.layerId,
    });
  }
  items.sort((a, b) => {
    const la = layerIndex.get(a.layerId) ?? Number.MAX_SAFE_INTEGER;
    const lb = layerIndex.get(b.layerId) ?? Number.MAX_SAFE_INTEGER;
    if (la !== lb) return la - lb;
    const oa = resolved.get(a.instanceId)?.orderInLayer ?? 0;
    const ob = resolved.get(b.instanceId)?.orderInLayer ?? 0;
    if (oa !== ob) return oa - ob;
    return a.instanceId.localeCompare(b.instanceId);
  });
  return items;
}
