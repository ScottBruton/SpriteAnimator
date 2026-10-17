import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useEditorStore } from '@/state/editorStore';
import { useActiveAssembly } from '@/state/projectStore';
import { colors, font, sizes, spacing } from '@/theme/tokens';

export function StatusBar({ fps }: { fps: number }) {
  const status = useEditorStore((s) => s.status);
  const cursor = useEditorStore((s) => s.cursorWorld);
  const zoom = useEditorStore((s) => s.view.zoom);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const tool = useEditorStore((s) => s.tool);
  const workspace = useEditorStore((s) => s.workspace);
  const assembly = useActiveAssembly();
  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const fresh = status && (now === 0 || now - status.at < 6000);
  const sel = selectedIds.map((id) => assembly?.sprites.find((s) => s.id === id)?.name ?? id);
  return (
    <View style={styles.bar}>
      <Text style={[styles.msg, fresh && status?.kind === 'error' && { color: colors.danger }, fresh && status?.kind === 'success' && { color: colors.success }]} numberOfLines={1}>
        {fresh ? status!.message : hint(workspace, tool)}
      </Text>
      <Text style={styles.cell}>{sel.length ? (sel.length === 1 ? sel[0] : `${sel.length} selected`) : 'nothing selected'}</Text>
      <Text style={styles.cell}>{cursor ? `${cursor.x.toFixed(1)}, ${cursor.y.toFixed(1)}` : '—'}</Text>
      <Text style={styles.cell}>{Math.round(zoom * 100)}%</Text>
      <Text style={styles.cell}>{fps > 0 ? `${fps} fps` : ''}</Text>
    </View>
  );
}

function hint(workspace: string, tool: string): string {
  if (workspace === 'assembly') return 'Map behaviours to actions and test the unit in the arena.';
  if (workspace === 'animate') {
    return 'Select one sprite. Corners = Rot Z (main) · edge mids = Rot X/Y · 3D node = orbit (Shift = Y). Rotating a parent swings children; rotate the child alone for local spin.';
  }
  switch (tool) {
    case 'rotate':
      return 'Drag to rotate about the pivot. Shift snaps to 15°.';
    case 'scale':
      return 'Drag to scale about the pivot. Shift keeps aspect.';
    case 'pivot':
      return 'Drag the pivot marker to move the rotation centre (sprite stays in place).';
    case 'attachment':
      return 'Drag attachment markers to reposition them on the asset.';
    case 'link':
      return 'Drag a sprite by its pivot onto another sprite’s attachment point to link it.';
    case 'pan':
      return 'Drag to pan. Wheel zooms. Space + drag also pans.';
    default:
      return 'Pink = rotation pivot (put on the shoulder). Green = parent socket only. Double-click sprite → double-tap image to set pivot, or select a green and “Move pivot here”. Link: child pivot → parent green.';
  }
}

const styles = StyleSheet.create({
  bar: { height: sizes.statusBar, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg2, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: spacing.md, gap: spacing.lg },
  msg: { flex: 1, color: colors.textMuted, fontSize: font.xs },
  cell: { color: colors.textDim, fontSize: font.xs, fontFamily: font.mono, minWidth: 40, textAlign: 'right' },
});
