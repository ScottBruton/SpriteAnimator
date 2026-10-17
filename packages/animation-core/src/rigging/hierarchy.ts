import type { SpriteAsset, SpriteInstance } from '@elemental/asset-schema';

export type InstanceLike = Pick<SpriteInstance, 'id' | 'parentId' | 'parentAttachmentId' | 'assetId'>;

/** Children grouped by parent id (`null` key for roots). */
export function buildChildrenMap<T extends InstanceLike>(instances: readonly T[]): Map<string | null, T[]> {
  const map = new Map<string | null, T[]>();
  for (const inst of instances) {
    const key = inst.parentId ?? null;
    const arr = map.get(key);
    if (arr) arr.push(inst);
    else map.set(key, [inst]);
  }
  return map;
}

/**
 * Parents before children. Instances whose parent is missing or part of a cycle are treated as
 * roots so evaluation never hangs; `validateRig` reports those problems separately.
 */
export function topologicalOrder<T extends InstanceLike>(instances: readonly T[]): T[] {
  const byId = new Map(instances.map((i) => [i.id, i] as const));
  const children = buildChildrenMap(instances);
  const visited = new Set<string>();
  const out: T[] = [];

  const visit = (node: T) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    out.push(node);
    for (const child of children.get(node.id) ?? []) visit(child);
  };

  for (const inst of instances) {
    if (inst.parentId === null || !byId.has(inst.parentId)) visit(inst);
  }
  // Anything left is part of a cycle: break it deterministically.
  for (const inst of instances) visit(inst);
  return out;
}

export function getDescendantIds<T extends InstanceLike>(instances: readonly T[], rootId: string): Set<string> {
  const children = buildChildrenMap(instances);
  const out = new Set<string>();
  const stack = [...(children.get(rootId) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (out.has(n.id)) continue;
    out.add(n.id);
    for (const c of children.get(n.id) ?? []) stack.push(c);
  }
  return out;
}

/** True if setting `childId.parentId = newParentId` would create a cycle. */
export function wouldCreateCycle<T extends InstanceLike>(
  instances: readonly T[],
  childId: string,
  newParentId: string | null,
): boolean {
  if (newParentId === null) return false;
  if (newParentId === childId) return true;
  return getDescendantIds(instances, childId).has(newParentId);
}

export type RigIssue =
  | { kind: 'duplicate-id'; instanceId: string }
  | { kind: 'missing-parent'; instanceId: string; parentId: string }
  | { kind: 'missing-asset'; instanceId: string; assetId: string }
  | { kind: 'missing-attachment'; instanceId: string; parentId: string; attachmentId: string }
  | { kind: 'cycle'; instanceId: string }
  | { kind: 'missing-layer'; instanceId: string; layerId: string };

export function validateRig(
  instances: readonly SpriteInstance[],
  assetsById: ReadonlyMap<string, SpriteAsset>,
  layerIds: ReadonlySet<string>,
): RigIssue[] {
  const issues: RigIssue[] = [];
  const seen = new Set<string>();
  const byId = new Map<string, SpriteInstance>();
  for (const inst of instances) {
    if (seen.has(inst.id)) issues.push({ kind: 'duplicate-id', instanceId: inst.id });
    seen.add(inst.id);
    byId.set(inst.id, inst);
  }
  for (const inst of instances) {
    if (!assetsById.has(inst.assetId)) issues.push({ kind: 'missing-asset', instanceId: inst.id, assetId: inst.assetId });
    if (!layerIds.has(inst.layerId)) issues.push({ kind: 'missing-layer', instanceId: inst.id, layerId: inst.layerId });
    if (inst.parentId !== null) {
      const parent = byId.get(inst.parentId);
      if (!parent) {
        issues.push({ kind: 'missing-parent', instanceId: inst.id, parentId: inst.parentId });
      } else if (inst.parentAttachmentId) {
        const parentAsset = assetsById.get(parent.assetId);
        if (parentAsset && !parentAsset.attachments.some((a) => a.id === inst.parentAttachmentId)) {
          issues.push({
            kind: 'missing-attachment',
            instanceId: inst.id,
            parentId: parent.id,
            attachmentId: inst.parentAttachmentId,
          });
        }
      }
    }
  }
  // Cycle detection: walk up from each node.
  for (const inst of instances) {
    const visited = new Set<string>();
    let cur: SpriteInstance | undefined = inst;
    while (cur && cur.parentId !== null) {
      if (visited.has(cur.id)) {
        issues.push({ kind: 'cycle', instanceId: inst.id });
        break;
      }
      visited.add(cur.id);
      cur = byId.get(cur.parentId);
    }
  }
  return issues;
}
