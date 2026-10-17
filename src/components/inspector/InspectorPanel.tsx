import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { JointType, Transform2D } from '@elemental/asset-schema';
import type { EvaluatedPose } from '@elemental/animation-core';
import { patchInstance, setAssetPivot, setInstanceTransform, setKeyframe, unlinkInstance } from '@/engine/commands';
import { useEditorStore } from '@/state/editorStore';
import { usePoseOverrideStore } from '@/state/poseOverrideStore';
import { useActiveAssembly, useAssetLookup } from '@/state/projectStore';
import { colors, font, spacing } from '@/theme/tokens';
import { Button } from '../ui/Button';
import { Checkbox, Label, NumberField, Row, SectionTitle, Select } from '../ui/Fields';
import { Panel } from '../ui/Panel';

/** Numeric editing of the selected sprite. In Animate mode edits are pending until keyed. */
export function InspectorPanel({ pose }: { pose: EvaluatedPose | null }) {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const workspace = useEditorStore((s) => s.workspace);
  const activeActionId = useEditorStore((s) => s.activeActionId);
  const playhead = useEditorStore((s) => s.playhead);
  const autoKey = useEditorStore((s) => s.autoKey);
  const openSpriteEditor = useEditorStore((s) => s.openSpriteEditor);
  const assembly = useActiveAssembly();
  const lookup = useAssetLookup();
  const merge = usePoseOverrideStore((s) => s.merge);

  const id = selectedIds[0];
  const inst = assembly?.sprites.find((s) => s.id === id);
  const resolved = id && pose ? pose.resolved.get(id) : undefined;
  const asset = inst ? lookup(inst.assetId) : undefined;
  const animate = workspace === 'animate' && !!activeActionId;

  if (!inst || !asset || !assembly) {
    return (
      <Panel title="Inspector" padded>
        <Text style={styles.hint}>{selectedIds.length > 1 ? `${selectedIds.length} sprites selected` : 'Select a sprite to edit its properties.'}</Text>
      </Panel>
    );
  }

  const t: Transform2D = resolved?.transform ?? inst.transform;
  const apply = (patch: Partial<Transform2D>) => {
    const next = { ...t, ...patch };
    if (animate) {
      merge(inst.id, { transform: next });
      if (autoKey && activeActionId) {
        if (patch.position) setKeyframe(activeActionId, inst.id, 'position', playhead, next.position);
        if (patch.rotation !== undefined) setKeyframe(activeActionId, inst.id, 'rotation', playhead, next.rotation);
        if (patch.scale) setKeyframe(activeActionId, inst.id, 'scale', playhead, next.scale);
      }
    } else {
      setInstanceTransform(inst.id, next);
    }
  };
  const key = (prop: 'position' | 'rotation' | 'scale') => {
    if (!activeActionId) return;
    if (prop === 'position') setKeyframe(activeActionId, inst.id, 'position', playhead, t.position);
    if (prop === 'rotation') setKeyframe(activeActionId, inst.id, 'rotation', playhead, t.rotation);
    if (prop === 'scale') setKeyframe(activeActionId, inst.id, 'scale', playhead, t.scale);
  };
  const parent = inst.parentId ? assembly.sprites.find((s) => s.id === inst.parentId) : undefined;
  const parentAsset = parent ? lookup(parent.assetId) : undefined;
  const parentAtt = parentAsset?.attachments.find((a) => a.id === inst.parentAttachmentId);
  const layerOptions = assembly.layers.map((l) => ({ value: l.id, label: l.name }));

  return (
    <Panel title="Inspector" scroll padded>
      <Text style={styles.name}>{inst.name}</Text>
      <Text style={styles.meta}>
        {asset.name} · {asset.width}×{asset.height}
      </Text>
      {parent ? (
        <Row>
          <Label>Parent</Label>
          <Text style={styles.value}>
            {parent.name}
            {parentAtt ? ` @ ${parentAtt.name}` : ''}
          </Text>
          <Button label="Unlink" small onPress={() => pose && unlinkInstance(inst.id, pose.resolved)} />
        </Row>
      ) : (
        <Text style={styles.meta}>Root sprite (drag its pivot onto another sprite&apos;s attachment to link)</Text>
      )}

      <SectionTitle>Transform{animate ? ' (animate)' : ''}</SectionTitle>
      <Row>
        <NumberField label="X" value={t.position.x} onChange={(x) => apply({ position: { ...t.position, x } })} width={78} />
        <NumberField label="Y" value={t.position.y} onChange={(y) => apply({ position: { ...t.position, y } })} width={78} />
        {animate ? <Button icon="◆" small onPress={() => key('position')} title="Key position" /> : null}
      </Row>
      <Row>
        <NumberField label="Rot" value={t.rotation} onChange={(rotation) => apply({ rotation })} width={78} suffix="°" />
        {animate ? <Button icon="◆" small onPress={() => key('rotation')} title="Key rotation" /> : null}
      </Row>
      <Row>
        <NumberField label="SX" value={t.scale.x} onChange={(x) => apply({ scale: { ...t.scale, x } })} step={0.1} width={78} />
        <NumberField label="SY" value={t.scale.y} onChange={(y) => apply({ scale: { ...t.scale, y } })} step={0.1} width={78} />
        {animate ? <Button icon="◆" small onPress={() => key('scale')} title="Key scale" /> : null}
      </Row>
      <Row>
        <Checkbox label="Flip X" value={t.flipX} onChange={(flipX) => apply({ flipX })} />
        <Checkbox label="Flip Y" value={t.flipY} onChange={(flipY) => apply({ flipY })} />
        <Button label="Reset" small onPress={() => apply({ position: { x: t.position.x, y: t.position.y }, rotation: 0, scale: { x: 1, y: 1 }, flipX: false, flipY: false })} />
      </Row>

      <SectionTitle>Display</SectionTitle>
      <Row>
        <NumberField label="Opacity" value={inst.opacity} min={0} max={1} step={0.05} onChange={(opacity) => patchInstance(inst.id, { opacity }, 'Opacity')} width={78} />
        <Checkbox label="Visible" value={inst.visible} onChange={(visible) => patchInstance(inst.id, { visible }, 'Visibility')} />
        <Checkbox label="Locked" value={inst.locked} onChange={(locked) => patchInstance(inst.id, { locked }, 'Lock')} />
      </Row>
      <Select label="Layer" value={inst.layerId} options={layerOptions} onChange={(layerId) => patchInstance(inst.id, { layerId }, 'Move to layer')} compact={layerOptions.length > 3} />
      <Row>
        <NumberField label="Order" value={inst.orderInLayer} precision={0} onChange={(orderInLayer) => patchInstance(inst.id, { orderInLayer: Math.round(orderInLayer) }, 'Order')} width={78} />
      </Row>

      <SectionTitle>Pivot (asset)</SectionTitle>
      <Row>
        <NumberField label="X" value={asset.pivot.x} onChange={(x) => setAssetPivot(asset.id, { ...asset.pivot, x })} width={78} />
        <NumberField label="Y" value={asset.pivot.y} onChange={(y) => setAssetPivot(asset.id, { ...asset.pivot, y })} width={78} />
        <Button label="Edit sprite…" small onPress={() => openSpriteEditor(asset.id)} />
      </Row>

      <SectionTitle>Joint</SectionTitle>
      <Select<JointType>
        value={inst.joint?.type ?? 'free'}
        options={[
          { value: 'free', label: 'Free' },
          { value: 'rotation', label: 'Rotation' },
          { value: 'fixed', label: 'Fixed' },
        ]}
        onChange={(type) => patchInstance(inst.id, { joint: { ...inst.joint, type } }, 'Joint type')}
      />
      {inst.joint?.type === 'rotation' ? (
        <Row>
          <NumberField label="Min" value={inst.joint.minRotation ?? -180} onChange={(minRotation) => patchInstance(inst.id, { joint: { ...inst.joint!, minRotation } }, 'Joint limit')} width={78} suffix="°" />
          <NumberField label="Max" value={inst.joint.maxRotation ?? 180} onChange={(maxRotation) => patchInstance(inst.id, { joint: { ...inst.joint!, maxRotation } }, 'Joint limit')} width={78} suffix="°" />
        </Row>
      ) : null}
      <View style={{ height: spacing.md }} />
    </Panel>
  );
}

const styles = StyleSheet.create({
  name: { color: colors.text, fontSize: font.lg, fontWeight: '600' },
  meta: { color: colors.textDim, fontSize: font.xs },
  value: { color: colors.text, fontSize: font.sm, flex: 1 },
  hint: { color: colors.textDim, fontSize: font.sm },
});
