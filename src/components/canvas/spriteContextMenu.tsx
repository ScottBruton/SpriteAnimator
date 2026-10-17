import type { UnitAssembly } from '@elemental/asset-schema';
import type { EvaluatedPose } from '@elemental/animation-core';
import {
  bringToFront,
  deleteInstances,
  patchInstance,
  reorderInLayer,
  sendToBack,
  setPivotToChildLinkAttachment,
  unlinkInstance,
} from '@/engine/commands';
import { useEditorStore } from '@/state/editorStore';
import type { MenuItem } from '../ui/Menu';

/** Build right-click / long-press actions for a sprite under the cursor. */
export function spriteContextMenuItems(input: {
  instanceId: string;
  pose: EvaluatedPose | null;
  assembly: UnitAssembly;
  lookup: (assetId: string) => { id: string } | undefined;
}): MenuItem[] {
  const { instanceId, pose, assembly, lookup } = input;
  const inst = assembly.sprites.find((s) => s.id === instanceId);
  if (!inst) return [];

  const siblings = assembly.sprites.filter((s) => s.layerId === inst.layerId).sort((a, b) => a.orderInLayer - b.orderInLayer);
  const idx = siblings.findIndex((s) => s.id === instanceId);
  const atBack = idx <= 0;
  const atFront = idx < 0 || idx >= siblings.length - 1;
  const asset = lookup(inst.assetId);
  const openSpriteEditor = useEditorStore.getState().openSpriteEditor;

  const items: MenuItem[] = [
    { label: 'Bring forward', disabled: atFront, onPress: () => reorderInLayer(instanceId, +1) },
    { label: 'Send backward', disabled: atBack, onPress: () => reorderInLayer(instanceId, -1) },
    { label: 'Bring to front', disabled: atFront, onPress: () => bringToFront(instanceId) },
    { label: 'Send to back', disabled: atBack, onPress: () => sendToBack(instanceId) },
    { separator: true, label: '' },
    {
      label: inst.locked ? 'Unlock' : 'Lock',
      onPress: () => patchInstance(instanceId, { locked: !inst.locked }, inst.locked ? 'Unlock sprite' : 'Lock sprite'),
    },
    {
      label: inst.visible ? 'Hide' : 'Show',
      onPress: () => patchInstance(instanceId, { visible: !inst.visible }, inst.visible ? 'Hide sprite' : 'Show sprite'),
    },
    { separator: true, label: '' },
  ];

  if (asset) {
    items.push({ label: 'Edit sprite…', onPress: () => openSpriteEditor(asset.id) });
  }

  if (inst.parentId && pose) {
    items.push({ label: 'Unlink from parent', onPress: () => unlinkInstance(instanceId, pose.resolved) });
  }
  if (inst.childAttachmentId && pose) {
    items.push({
      label: 'Pivot around link',
      onPress: () => setPivotToChildLinkAttachment(instanceId, pose.resolved),
    });
  }

  items.push({ separator: true, label: '' }, { label: 'Delete', onPress: () => deleteInstances([instanceId]) });

  return items;
}
