import type { Direction, DirectionConfiguration, SpriteAsset, UnitAssembly } from '@elemental/asset-schema';
import type { ResolvedInstance } from '../transforms/worldMatrices';

export type AssetLookup = (assetId: string) => SpriteAsset | undefined;

export function getDirectionConfig(assembly: UnitAssembly, direction: Direction): DirectionConfiguration | undefined {
  return assembly.directions.find((d) => d.direction === direction);
}

/**
 * Setup pose of the shared logical rig for one viewing direction: asset / pivot / transform / layer
 * / visibility overrides applied, no animation yet.
 * Instances whose asset cannot be resolved are skipped (reported through `missing`).
 */
export function resolveSetupPose(
  assembly: UnitAssembly,
  direction: Direction,
  lookupAsset: AssetLookup,
): { resolved: Map<string, ResolvedInstance>; layerOrder: string[]; missing: string[] } {
  const cfg = getDirectionConfig(assembly, direction);
  const resolved = new Map<string, ResolvedInstance>();
  const missing: string[] = [];

  for (const inst of assembly.sprites) {
    const assetId = cfg?.assetOverrides[inst.id] ?? cfg?.assetOverrides[inst.slotId ?? ''] ?? inst.assetId;
    const asset = lookupAsset(assetId);
    if (!asset) {
      missing.push(inst.id);
      continue;
    }
    const transform = cfg?.transformOverrides[inst.id] ?? inst.transform;
    const pivot = cfg?.pivotOverrides[inst.id] ?? asset.pivot;
    const layerId = cfg?.layerOverrides[inst.id] ?? inst.layerId;
    const orderInLayer = cfg?.orderOverrides[inst.id] ?? inst.orderInLayer;
    const visible = cfg?.visibilityOverrides[inst.id] ?? inst.visible;
    resolved.set(inst.id, {
      instance: inst,
      asset,
      pivot,
      transform: {
        position: { ...transform.position },
        rotation: transform.rotation,
        rotationX: transform.rotationX ?? 0,
        rotationY: transform.rotationY ?? 0,
        scale: { ...transform.scale },
        flipX: transform.flipX,
        flipY: transform.flipY,
      },
      opacity: inst.opacity,
      visible,
      layerId,
      orderInLayer,
    });
  }

  const layerOrder = cfg?.layerOrder ?? assembly.layers.map((l) => l.id);
  return { resolved, layerOrder, missing };
}
