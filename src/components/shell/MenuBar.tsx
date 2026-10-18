import React, { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { deleteInstances } from '@/engine/commands';
import { importPngFiles } from '@/importers/importPng';
import { useEditorStore, type Workspace } from '@/state/editorStore';
import { useProjectStore } from '@/state/projectStore';
import {
  deleteCurrentProjectCompletely,
  hasFolderWorkspace,
  openProjectFromFile,
  openProjectFromFolder,
  saveCurrentProject,
  supportsFolderWorkspace,
} from '@/storage/projectService';
import { colors, font, sizes, spacing } from '@/theme/tokens';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/Dialog';
import { Menu, type MenuItem } from '../ui/Menu';

const mod = Platform.OS === 'web' && typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';

export function MenuBar() {
  const projectName = useProjectStore((s) => s.project.name);
  const workspaceFolderName = useProjectStore((s) => s.workspaceFolderName);
  const dirty = useProjectStore((s) => s.dirty);
  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const ed = useEditorStore();
  const setStatus = ed.setStatus;
  const folderOk = supportsFolderWorkspace();
  const linked = hasFolderWorkspace() || !!workspaceFolderName;
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isAbort = (e: unknown) => e instanceof Error && (e.name === 'AbortError' || /abort|cancel/i.test(e.message));

  const run = (label: string, fn: () => Promise<unknown>) => () =>
    fn()
      .then((r) => setStatus(typeof r === 'string' ? r : label, 'success'))
      .catch((e: Error) => {
        if (isAbort(e)) return;
        setStatus(`${label} failed: ${e.message}`, 'error');
      });

  const workspaces: { id: Workspace; label: string; title: string }[] = [
    { id: 'rigging', label: 'Rigging', title: 'Rig sprites: pivots, attachments, and setup pose' },
    { id: 'animate', label: 'Animate', title: 'Keyframe animation for the active action and facing' },
    { id: 'assembly', label: 'Assembly', title: 'Behaviours, export, and runtime test for this unit' },
  ];

  const projectTitle = workspaceFolderName
    ? dirty
      ? `${projectName} → ${workspaceFolderName} (unsaved)`
      : `${projectName} → ${workspaceFolderName}`
    : dirty
      ? `${projectName} (unsaved — use Save As… to choose a folder)`
      : projectName;

  const fileItems: MenuItem[] = [
    { label: 'New project…', tooltip: 'Create a project folder on disk (or local-only fallback)', onPress: () => ed.openDialog('newProject') },
    { label: 'Create new…', tooltip: 'Create a unit, structure, resource, or terrain with folders and starter actions', onPress: () => ed.openDialog('createEntity') },
    { label: 'Open project…', shortcut: `${mod}O`, tooltip: 'Browse local library or open a project folder', onPress: () => ed.openDialog('projects') },
  ];
  if (folderOk) {
    fileItems.push({
      label: 'Open project folder…',
      tooltip: 'Open a project folder that contains project.json',
      onPress: () => {
        (async () => {
          try {
            if (dirty) await saveCurrentProject();
            const msg = await openProjectFromFolder();
            setStatus(msg, 'success');
          } catch (e) {
            if (isAbort(e)) return;
            setStatus(`Open failed: ${(e as Error).message}`, 'error');
          }
        })();
      },
    });
  }
  fileItems.push(
    {
      label: 'Open from zip…',
      tooltip: 'Load a .ess.zip backup, then Save As… to write it into a folder',
      onPress: () => {
        (async () => {
          try {
            if (dirty) await saveCurrentProject();
            const msg = await openProjectFromFile();
            setStatus(msg, 'success');
          } catch (e) {
            if ((e as Error).message === 'No file selected') return;
            setStatus(`Open failed: ${(e as Error).message}`, 'error');
          }
        })();
      },
    },
    {
      label: 'Save',
      shortcut: `${mod}S`,
      tooltip: linked ? 'Write project.json + assets into the linked project folder' : 'Save locally; use Save As… to choose a project folder first',
      onPress: run(linked ? 'Saved to folder' : 'Saved locally', saveCurrentProject),
    },
    {
      label: 'Save As…',
      shortcut: `${mod}⇧S`,
      tooltip: 'Choose a parent folder and create/link a project directory on disk',
      onPress: () => ed.openDialog('saveAs'),
    },
    {
      label: 'Delete entire project…',
      tooltip: 'Permanently delete this project, its assets, and wipe the linked folder on disk',
      onPress: () => setConfirmDeleteProject(true),
    },
    { separator: true, label: '' },
    { label: 'Import PNG sprites…', shortcut: `${mod}I`, tooltip: 'Import PNG images into the asset library', onPress: run('Imported', importPngFiles) },
    { label: 'Import assembly package…', tooltip: 'Import an exported assembly ZIP/JSON into this project', onPress: () => ed.openDialog('export') },
    { separator: true, label: '' },
    { label: 'Export assembly…', shortcut: `${mod}E`, tooltip: 'Export Elemental V2 unit pack (game) or studio runtime ZIP', onPress: () => ed.openDialog('export') },
  );

  return (
    <>
    <View style={styles.bar}>
      <Text style={styles.brand} {...({ title: 'Elemental Sprite Studio' } as object)}>
        ◈ Elemental Sprite Studio
      </Text>
      <Menu label="File" tooltip="Project files, create entities, import and export" items={fileItems} />
      <Menu
        label="Edit"
        tooltip="Undo, redo, selection, and project settings"
        items={[
          { label: 'Undo', shortcut: `${mod}Z`, tooltip: 'Undo the last edit', disabled: !canUndo, onPress: undo },
          { label: 'Redo', shortcut: `${mod}⇧Z`, tooltip: 'Redo the last undone edit', disabled: !canRedo, onPress: redo },
          { separator: true, label: '' },
          { label: 'Delete selection', shortcut: 'Del', tooltip: 'Delete selected sprites on the canvas', disabled: ed.selectedIds.length === 0, onPress: () => deleteInstances(ed.selectedIds) },
          { label: 'Select none', shortcut: 'Esc', tooltip: 'Clear the current selection', onPress: () => ed.select([]) },
          { separator: true, label: '' },
          { label: 'Project settings…', tooltip: 'Grid, snap, units, and default FPS', onPress: () => ed.openDialog('settings') },
        ]}
      />
      <Menu
        label="View"
        tooltip="Canvas overlays and zoom"
        items={[
          { label: 'Grid', shortcut: 'G', tooltip: 'Show or hide the canvas grid', checked: ed.showGrid, onPress: () => ed.toggle('showGrid') },
          { label: 'Rulers', tooltip: 'Show or hide canvas rulers', checked: ed.showRulers, onPress: () => ed.toggle('showRulers') },
          { label: 'Pivots', tooltip: 'Show pink rotation centres on sprites', checked: ed.showPivots, onPress: () => ed.toggle('showPivots') },
          { label: 'Attachment points', tooltip: 'Show green attachment sockets', checked: ed.showAttachments, onPress: () => ed.toggle('showAttachments') },
          { label: 'Joint lines', tooltip: 'Show parent–child link lines', checked: ed.showJointLines, onPress: () => ed.toggle('showJointLines') },
          { separator: true, label: '' },
          { label: 'Zoom to 100%', shortcut: '1', tooltip: 'Reset zoom to 100%', onPress: () => ed.setView({ zoom: 1 }) },
          { label: 'Zoom in', shortcut: '+', tooltip: 'Zoom in on the canvas', onPress: () => ed.setView({ zoom: Math.min(32, ed.view.zoom * 1.25) }) },
          { label: 'Zoom out', shortcut: '−', tooltip: 'Zoom out on the canvas', onPress: () => ed.setView({ zoom: Math.max(0.05, ed.view.zoom / 1.25) }) },
        ]}
      />
      <Menu
        label="Window"
        tooltip="Show or hide editor panels"
        items={[
          { label: 'Explorer', tooltip: 'Left panel: project, assemblies, hierarchy, actions', checked: ed.explorerOpen, onPress: () => ed.toggle('explorerOpen') },
          { label: 'Right dock (Inspector / Layers / Assets)', tooltip: 'Right panel: inspector, layers, and asset library', checked: ed.rightOpen, onPress: () => ed.toggle('rightOpen') },
          { label: 'Timeline', tooltip: 'Bottom timeline for Animate mode', checked: ed.timelineOpen, onPress: () => ed.toggle('timelineOpen') },
        ]}
      />
      <Menu
        label="Help"
        tooltip="Shortcuts and standalone runtime test"
        items={[
          { label: 'About / shortcuts', tooltip: 'Keyboard shortcuts and app overview', onPress: () => ed.openDialog('about') },
          { label: 'Runtime test screen (standalone)', tooltip: 'Open the standalone runtime player for exported packages', onPress: () => router.push('/runtime-test') },
        ]}
      />

      <View style={styles.tabs}>
        {workspaces.map((w) => (
          <Button key={w.id} label={w.label} title={w.title} active={ed.workspace === w.id} onPress={() => ed.setWorkspace(w.id)} style={styles.tab} />
        ))}
      </View>

      <View style={{ flex: 1 }} />
      <Text style={styles.project} numberOfLines={1} {...({ title: projectTitle } as object)}>
        {projectName}
        {workspaceFolderName ? <Text style={styles.folder}> · {workspaceFolderName}</Text> : null}
        {dirty ? <Text style={styles.dirty}> ●</Text> : ''}
      </Text>
      <Button
        label="Save"
        small
        primary={dirty}
        title={linked ? 'Save into linked project folder' : 'Save locally — use Save As… to choose a folder'}
        onPress={run(linked ? 'Saved to folder' : 'Saved locally', saveCurrentProject)}
      />
    </View>
    <ConfirmDialog
      visible={confirmDeleteProject}
      title="Delete entire project?"
      message={`Permanently delete “${projectName}”?\n\nRemoves local storage, project assets/audio, and wipes the linked folder on disk (${workspaceFolderName ?? 'no folder linked'}).\n\nThis cannot be undone.`}
      confirmLabel={deleting ? 'Deleting…' : 'Delete project'}
      danger
      onCancel={() => !deleting && setConfirmDeleteProject(false)}
      onConfirm={() => {
        if (deleting) return;
        setDeleting(true);
        deleteCurrentProjectCompletely()
          .then((msg) => {
            setConfirmDeleteProject(false);
            setStatus(msg, 'success');
          })
          .catch((e: Error) => setStatus(`Delete project failed: ${e.message}`, 'error'))
          .finally(() => setDeleting(false));
      }}
    />
    </>
  );
}

const styles = StyleSheet.create({
  bar: { height: sizes.menuBar, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg2, borderBottomWidth: 1, borderBottomColor: colors.border, paddingRight: spacing.sm, zIndex: 10 },
  brand: { color: colors.textMuted, fontSize: font.md, fontWeight: '700', paddingHorizontal: spacing.lg, letterSpacing: 0.5 },
  tabs: { flexDirection: 'row', marginLeft: spacing.lg, gap: 2 },
  tab: { height: 22 },
  project: { color: colors.textMuted, fontSize: font.sm, marginRight: spacing.md, maxWidth: 280 },
  folder: { color: colors.accent, fontSize: font.xs },
  dirty: { color: colors.warning },
});
