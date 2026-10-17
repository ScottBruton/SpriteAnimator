import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { addLayer, deleteLayer, moveInstanceToLayer, moveLayer, patchInstance, renameLayer, reorderInLayer, toggleLayer } from '@/engine/commands';
import { useEditorStore } from '@/state/editorStore';
import { useActiveAssembly } from '@/state/projectStore';
import { colors, font, spacing } from '@/theme/tokens';
import { Button } from '../ui/Button';
import { TextField } from '../ui/Fields';
import { Panel } from '../ui/Panel';

/**
 * Render layers (front-most at the top) with the sprites they contain. Render order is edited
 * here and is fully independent of the attachment hierarchy shown in the Explorer.
 */
export function LayersPanel() {
  const assembly = useActiveAssembly();
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const select = useEditorStore((s) => s.select);
  const [activeLayer, setActiveLayer] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  if (!assembly) return null;

  const layersFrontFirst = [...assembly.layers].reverse();
  const current = activeLayer && assembly.layers.some((l) => l.id === activeLayer) ? activeLayer : (assembly.layers[assembly.layers.length - 1]?.id ?? null);

  return (
    <Panel
      title="Layers"
      flex={1}
      scroll
      padded={false}
      actions={
        <>
          <Button icon="+" small onPress={() => addLayer()} title="Add layer" />
          <Button icon="▲" small onPress={() => current && moveLayer(current, +1)} title="Bring layer forward" />
          <Button icon="▼" small onPress={() => current && moveLayer(current, -1)} title="Send layer backward" />
          <Button icon="🗑" small onPress={() => current && deleteLayer(current)} title="Delete layer" disabled={assembly.layers.length <= 1} />
        </>
      }
    >
      {layersFrontFirst.map((layer) => {
        const sprites = assembly.sprites.filter((s) => s.layerId === layer.id).sort((a, b) => b.orderInLayer - a.orderInLayer);
        const isActive = layer.id === current;
        return (
          <View key={layer.id}>
            <Pressable onPress={() => setActiveLayer(layer.id)} style={[styles.layerRow, isActive && styles.layerRowActive]}>
              <Pressable onPress={() => toggleLayer(layer.id, 'visible')} style={styles.iconBtn} accessibilityLabel="Toggle visibility">
                <Text style={[styles.icon, !layer.visible && styles.iconOff]}>{layer.visible ? '👁' : '◌'}</Text>
              </Pressable>
              <Pressable onPress={() => toggleLayer(layer.id, 'locked')} style={styles.iconBtn} accessibilityLabel="Toggle lock">
                <Text style={[styles.icon, !layer.locked && styles.iconOff]}>{layer.locked ? '🔒' : '🔓'}</Text>
              </Pressable>
              {editing === layer.id ? (
                <TextField
                  value={layer.name}
                  autoFocus
                  onChange={(v) => {
                    renameLayer(layer.id, v || layer.name);
                    setEditing(null);
                  }}
                  onSubmit={() => setEditing(null)}
                  style={{ flex: 1 }}
                />
              ) : (
                <Pressable style={{ flex: 1 }} onPress={() => setActiveLayer(layer.id)} onLongPress={() => setEditing(layer.id)}>
                  <Text style={styles.layerName} numberOfLines={1}>
                    {layer.name} <Text style={styles.count}>({sprites.length})</Text>
                  </Text>
                </Pressable>
              )}
              <Button icon="✎" small onPress={() => setEditing(layer.id)} title="Rename" />
            </Pressable>
            {sprites.map((s) => {
              const sel = selectedIds.includes(s.id);
              return (
                <Pressable key={s.id} onPress={() => select([s.id])} style={[styles.spriteRow, sel && styles.spriteRowSel]}>
                  <Pressable onPress={() => patchInstance(s.id, { visible: !s.visible }, 'Toggle sprite')} style={styles.iconBtn}>
                    <Text style={[styles.icon, !s.visible && styles.iconOff]}>{s.visible ? '👁' : '◌'}</Text>
                  </Pressable>
                  <Pressable onPress={() => patchInstance(s.id, { locked: !s.locked }, 'Lock sprite')} style={styles.iconBtn}>
                    <Text style={[styles.icon, !s.locked && styles.iconOff]}>{s.locked ? '🔒' : '🔓'}</Text>
                  </Pressable>
                  <Text style={[styles.spriteName, sel && styles.spriteNameSel]} numberOfLines={1}>
                    {s.name}
                  </Text>
                  <Button icon="▲" small onPress={() => reorderInLayer(s.id, +1)} title="Bring forward" />
                  <Button icon="▼" small onPress={() => reorderInLayer(s.id, -1)} title="Send backward" />
                  <Button
                    icon="⇄"
                    small
                    title="Move to next layer"
                    onPress={() => {
                      const idx = assembly.layers.findIndex((l) => l.id === s.layerId);
                      const next = assembly.layers[(idx + 1) % assembly.layers.length];
                      if (next && next.id !== s.layerId) moveInstanceToLayer(s.id, next.id);
                    }}
                  />
                </Pressable>
              );
            })}
          </View>
        );
      })}
      <Text style={styles.hint}>Top of list renders in front. Long-press a layer name to rename. ⇄ cycles a sprite to the next layer.</Text>
    </Panel>
  );
}

const styles = StyleSheet.create({
  layerRow: { flexDirection: 'row', alignItems: 'center', height: 26, paddingHorizontal: spacing.sm, backgroundColor: colors.bg2, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 2 },
  layerRowActive: { backgroundColor: colors.bg3 },
  layerName: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  count: { color: colors.textDim, fontWeight: '400' },
  spriteRow: { flexDirection: 'row', alignItems: 'center', height: 24, paddingLeft: spacing.lg, paddingRight: spacing.sm, gap: 2 },
  spriteRowSel: { backgroundColor: colors.accentSoft },
  spriteName: { flex: 1, color: colors.textMuted, fontSize: font.sm },
  spriteNameSel: { color: colors.text },
  iconBtn: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 11, color: colors.text },
  iconOff: { opacity: 0.35 },
  hint: { color: colors.textDim, fontSize: font.xs, padding: spacing.md },
});
