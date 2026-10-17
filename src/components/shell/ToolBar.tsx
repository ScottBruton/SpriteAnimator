import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { DIRECTIONS } from '@elemental/asset-schema';
import { useEditorStore, type Tool } from '@/state/editorStore';
import { useProjectStore } from '@/state/projectStore';
import { colors, font, sizes, spacing } from '@/theme/tokens';
import { Button } from '../ui/Button';
import { Select } from '../ui/Fields';

const TOOLS: { id: Tool; icon: string; label: string; key: string }[] = [
  { id: 'select', icon: '↖', label: 'Select / move', key: 'V' },
  { id: 'rotate', icon: '↻', label: 'Rotate', key: 'R' },
  { id: 'scale', icon: '⤢', label: 'Scale', key: 'S' },
  { id: 'pivot', icon: '⊕', label: 'Pivot', key: 'P' },
  { id: 'attachment', icon: '◎', label: 'Attachment', key: 'A' },
  { id: 'link', icon: '⛓', label: 'Link (drag pivot onto attachment)', key: 'L' },
  { id: 'pan', icon: '✋', label: 'Pan', key: 'H' },
];

export function ToolBar() {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const ed = useEditorStore();
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);
  const snap = useProjectStore((s) => s.project.settings.snapToGrid);
  const toggleSnap = () => useProjectStore.getState().commit('Snap to grid', (d) => void (d.settings.snapToGrid = !d.settings.snapToGrid));

  return (
    <View style={styles.bar}>
      {TOOLS.map((t) => (
        <Button key={t.id} icon={t.icon} active={tool === t.id} onPress={() => setTool(t.id)} title={`${t.label} (${t.key})`} style={styles.tool} />
      ))}
      <View style={styles.sep} />
      <Button icon="↶" onPress={undo} disabled={!canUndo} title="Undo" style={styles.tool} />
      <Button icon="↷" onPress={redo} disabled={!canRedo} title="Redo" style={styles.tool} />
      <View style={styles.sep} />
      <Button icon="▦" active={ed.showGrid} onPress={() => ed.toggle('showGrid')} title="Grid (G)" style={styles.tool} />
      <Button icon="⌗" active={snap} onPress={toggleSnap} title="Snap to grid" style={styles.tool} />
      <Button icon="📏" active={ed.showRulers} onPress={() => ed.toggle('showRulers')} title="Rulers" style={styles.tool} />
      <Button icon="⊕" active={ed.showPivots} onPress={() => ed.toggle('showPivots')} title="Show pivots" style={styles.tool} />
      <Button icon="◎" active={ed.showAttachments} onPress={() => ed.toggle('showAttachments')} title="Show attachment points" style={styles.tool} />
      <Button icon="⟋" active={ed.showJointLines} onPress={() => ed.toggle('showJointLines')} title="Show joint lines" style={styles.tool} />
      <View style={styles.sep} />
      <Text style={styles.label}>Dir</Text>
      <Select value={ed.direction} options={DIRECTIONS.map((d) => ({ value: d, label: d }))} onChange={ed.setDirection} compact />
      <View style={{ flex: 1 }} />
      <Button icon="−" onPress={() => ed.setView({ zoom: Math.max(0.05, ed.view.zoom / 1.25) })} title="Zoom out" style={styles.tool} />
      <Button label={`${Math.round(ed.view.zoom * 100)}%`} onPress={() => ed.setView({ zoom: 1 })} title="Reset zoom" small />
      <Button icon="+" onPress={() => ed.setView({ zoom: Math.min(32, ed.view.zoom * 1.25) })} title="Zoom in" style={styles.tool} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { height: sizes.toolBar, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg1, borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: spacing.sm, gap: 2 },
  tool: { width: 28, paddingHorizontal: 0, alignItems: 'center' },
  sep: { width: 1, height: 18, backgroundColor: colors.border, marginHorizontal: spacing.sm },
  label: { color: colors.textDim, fontSize: font.xs, marginRight: 4 },
});
