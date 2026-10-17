import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { deleteInstances } from '@/engine/commands';
import { exportProjectBackup } from '@/exporters/exportService';
import { importPngFiles } from '@/importers/importPng';
import { useEditorStore, type Workspace } from '@/state/editorStore';
import { useProjectStore } from '@/state/projectStore';
import { saveCurrentProject } from '@/storage/projectService';
import { colors, font, sizes, spacing } from '@/theme/tokens';
import { Button } from '../ui/Button';
import { Menu } from '../ui/Menu';

const mod = Platform.OS === 'web' && typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';

export function MenuBar() {
  const projectName = useProjectStore((s) => s.project.name);
  const dirty = useProjectStore((s) => s.dirty);
  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const ed = useEditorStore();
  const setStatus = ed.setStatus;

  const run = (label: string, fn: () => Promise<unknown>) => () =>
    fn()
      .then((r) => setStatus(typeof r === 'string' ? r : label, 'success'))
      .catch((e: Error) => setStatus(`${label} failed: ${e.message}`, 'error'));

  const workspaces: { id: Workspace; label: string }[] = [
    { id: 'rigging', label: 'Rigging' },
    { id: 'animate', label: 'Animate' },
    { id: 'assembly', label: 'Assembly' },
  ];

  return (
    <View style={styles.bar}>
      <Text style={styles.brand}>◈ Elemental Sprite Studio</Text>
      <Menu
        label="File"
        items={[
          { label: 'New project…', onPress: () => ed.openDialog('newProject') },
          { label: 'Open project…', shortcut: `${mod}O`, onPress: () => ed.openDialog('projects') },
          { label: 'Save', shortcut: `${mod}S`, onPress: run('Saved', saveCurrentProject) },
          { separator: true, label: '' },
          { label: 'Import PNG sprites…', shortcut: `${mod}I`, onPress: run('Imported', importPngFiles) },
          { label: 'Import assembly package…', onPress: () => ed.openDialog('export') },
          { separator: true, label: '' },
          { label: 'Export assembly…', shortcut: `${mod}E`, onPress: () => ed.openDialog('export') },
          { label: 'Backup project (ZIP)…', onPress: run('Backup created', exportProjectBackup) },
        ]}
      />
      <Menu
        label="Edit"
        items={[
          { label: 'Undo', shortcut: `${mod}Z`, disabled: !canUndo, onPress: undo },
          { label: 'Redo', shortcut: `${mod}⇧Z`, disabled: !canRedo, onPress: redo },
          { separator: true, label: '' },
          { label: 'Delete selection', shortcut: 'Del', disabled: ed.selectedIds.length === 0, onPress: () => deleteInstances(ed.selectedIds) },
          { label: 'Select none', shortcut: 'Esc', onPress: () => ed.select([]) },
          { separator: true, label: '' },
          { label: 'Project settings…', onPress: () => ed.openDialog('settings') },
        ]}
      />
      <Menu
        label="View"
        items={[
          { label: 'Grid', shortcut: 'G', checked: ed.showGrid, onPress: () => ed.toggle('showGrid') },
          { label: 'Rulers', checked: ed.showRulers, onPress: () => ed.toggle('showRulers') },
          { label: 'Pivots', checked: ed.showPivots, onPress: () => ed.toggle('showPivots') },
          { label: 'Attachment points', checked: ed.showAttachments, onPress: () => ed.toggle('showAttachments') },
          { label: 'Joint lines', checked: ed.showJointLines, onPress: () => ed.toggle('showJointLines') },
          { separator: true, label: '' },
          { label: 'Zoom to 100%', shortcut: '1', onPress: () => ed.setView({ zoom: 1 }) },
          { label: 'Zoom in', shortcut: '+', onPress: () => ed.setView({ zoom: Math.min(32, ed.view.zoom * 1.25) }) },
          { label: 'Zoom out', shortcut: '−', onPress: () => ed.setView({ zoom: Math.max(0.05, ed.view.zoom / 1.25) }) },
        ]}
      />
      <Menu
        label="Window"
        items={[
          { label: 'Explorer', checked: ed.explorerOpen, onPress: () => ed.toggle('explorerOpen') },
          { label: 'Right dock (Inspector / Layers / Assets)', checked: ed.rightOpen, onPress: () => ed.toggle('rightOpen') },
          { label: 'Timeline', checked: ed.timelineOpen, onPress: () => ed.toggle('timelineOpen') },
        ]}
      />
      <Menu
        label="Help"
        items={[
          { label: 'About / shortcuts', onPress: () => ed.openDialog('about') },
          { label: 'Runtime test screen (standalone)', onPress: () => router.push('/runtime-test') },
        ]}
      />

      <View style={styles.tabs}>
        {workspaces.map((w) => (
          <Button key={w.id} label={w.label} active={ed.workspace === w.id} onPress={() => ed.setWorkspace(w.id)} style={styles.tab} />
        ))}
      </View>

      <View style={{ flex: 1 }} />
      <Text style={styles.project} numberOfLines={1}>
        {projectName}
        {dirty ? <Text style={styles.dirty}> ●</Text> : ''}
      </Text>
      <Button label="Save" small primary={dirty} onPress={run('Saved', saveCurrentProject)} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { height: sizes.menuBar, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg2, borderBottomWidth: 1, borderBottomColor: colors.border, paddingRight: spacing.sm, zIndex: 10 },
  brand: { color: colors.textMuted, fontSize: font.md, fontWeight: '700', paddingHorizontal: spacing.lg, letterSpacing: 0.5 },
  tabs: { flexDirection: 'row', marginLeft: spacing.lg, gap: 2 },
  tab: { height: 22 },
  project: { color: colors.textMuted, fontSize: font.sm, marginRight: spacing.md, maxWidth: 240 },
  dirty: { color: colors.warning },
});
