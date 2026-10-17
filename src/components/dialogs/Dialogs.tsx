import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ProjectSummary } from '@elemental/asset-schema';
import { buildCurrentAssemblyExport, exportAssemblyJson, exportAssemblyZip, importAssemblyPackage, importProjectBackup } from '@/exporters/exportService';
import { pickFiles } from '@/importers/pickFiles';
import { useEditorStore } from '@/state/editorStore';
import { useProjectStore } from '@/state/projectStore';
import { getStorage } from '@/storage';
import { deleteProject, newProject, openProject, saveCurrentProject } from '@/storage/projectService';
import { colors, font, spacing } from '@/theme/tokens';
import { Button } from '../ui/Button';
import { ConfirmDialog, Dialog } from '../ui/Dialog';
import { Checkbox, NumberField, Row, SectionTitle, Select, TextField } from '../ui/Fields';
import { SpriteSheetDialog } from './SpriteSheetDialog';

export function Dialogs() {
  const dialog = useEditorStore((s) => s.dialog);
  const close = () => useEditorStore.getState().openDialog(null);
  switch (dialog) {
    case 'projects':
      return <ProjectsDialog onClose={close} />;
    case 'newProject':
      return <NewProjectDialog onClose={close} />;
    case 'export':
      return <ExportDialog onClose={close} />;
    case 'settings':
      return <SettingsDialog onClose={close} />;
    case 'about':
      return <AboutDialog onClose={close} />;
    case 'importSheet':
      return <SpriteSheetDialog onClose={close} />;
    default:
      return null;
  }
}

function ProjectsDialog({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [confirm, setConfirm] = useState<ProjectSummary | null>(null);
  const currentId = useProjectStore((s) => s.project.id);
  const dirty = useProjectStore((s) => s.dirty);
  const setStatus = useEditorStore((s) => s.setStatus);
  const refresh = () => getStorage().listProjects().then(setList);
  useEffect(() => {
    refresh();
  }, []);
  const open = async (id: string) => {
    if (dirty) await saveCurrentProject();
    if (await openProject(id)) {
      setStatus('Project opened', 'success');
      onClose();
    }
  };
  const restore = async () => {
    const [f] = await pickFiles({ types: ['application/zip', '.zip'], multiple: false });
    if (!f) return;
    try {
      const p = await importProjectBackup(f.bytes);
      await saveCurrentProject();
      setStatus(`Restored "${p.name}"`, 'success');
      onClose();
    } catch (e) {
      setStatus(`Restore failed: ${(e as Error).message}`, 'error');
    }
  };
  return (
    <Dialog
      visible
      title="Projects"
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button label="Restore backup (ZIP)…" onPress={restore} />
          <Button label="New project…" primary onPress={() => useEditorStore.getState().openDialog('newProject')} />
        </>
      }
    >
      {list === null ? <Text style={styles.hint}>Loading…</Text> : null}
      {list?.length === 0 ? <Text style={styles.hint}>No saved projects yet.</Text> : null}
      {list?.map((p) => (
        <View key={p.id} style={[styles.row, p.id === currentId && styles.rowCurrent]}>
          <Pressable style={{ flex: 1 }} onPress={() => open(p.id)}>
            <Text style={styles.rowTitle}>
              {p.name}
              {p.id === currentId ? <Text style={styles.hint}> (open)</Text> : null}
            </Text>
            <Text style={styles.hint}>Updated {new Date(p.updatedAt).toLocaleString()}</Text>
          </Pressable>
          <Button label="Open" small onPress={() => open(p.id)} />
          <Button icon="🗑" small danger onPress={() => setConfirm(p)} title="Delete project" />
        </View>
      ))}
      <Text style={styles.hint}>Projects are stored locally in this browser/device. Use “Backup project (ZIP)” from the File menu to move them elsewhere.</Text>
      {confirm ? (
        <ConfirmDialog
          visible
          title="Delete project"
          message={`Delete "${confirm.name}" permanently? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            await deleteProject(confirm.id);
            setConfirm(null);
            refresh();
          }}
        />
      ) : null}
    </Dialog>
  );
}

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('New unit');
  const dirty = useProjectStore((s) => s.dirty);
  const create = async () => {
    if (dirty) await saveCurrentProject();
    await newProject(name.trim() || 'Untitled');
    useEditorStore.getState().setStatus('Project created', 'success');
    onClose();
  };
  return (
    <Dialog
      visible
      title="New project"
      onClose={onClose}
      width={380}
      footer={
        <>
          <Button label="Cancel" onPress={onClose} />
          <Button label="Create" primary onPress={create} />
        </>
      }
    >
      <TextField label="Name" value={name} onChange={setName} autoFocus onSubmit={create} />
      {dirty ? <Text style={styles.hint}>The current project will be saved first.</Text> : null}
    </Dialog>
  );
}

function ExportDialog({ onClose }: { onClose: () => void }) {
  const setStatus = useEditorStore((s) => s.setStatus);
  const built = buildCurrentAssemblyExport();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<{ message: string; warnings: string[] } | null>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r) setStatus(r.message, 'success');
    } catch (e) {
      setStatus(`Export failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  const doImport = async () => {
    const [f] = await pickFiles({ types: ['application/zip', 'application/json', '.zip', '.json'], multiple: false });
    if (!f) return;
    try {
      const r = await importAssemblyPackage(f);
      setStatus(`Imported assembly${r.warnings.length ? ` with ${r.warnings.length} warning(s)` : ''}`, r.warnings.length ? 'info' : 'success');
      onClose();
    } catch (e) {
      setStatus(`Import failed: ${(e as Error).message}`, 'error');
    }
  };
  return (
    <Dialog visible title="Export / import assembly" onClose={onClose} width={560}>
      {built ? (
        <>
          <Text style={styles.body}>
            <Text style={styles.bold}>{built.manifest.name}</Text> — {built.pkg.assembly.sprites.length} sprites, {built.pkg.assets.length} images, {built.manifest.actions.length} actions, directions {built.manifest.supportedDirections.join(' ')}.
          </Text>
          <SectionTitle>Package contents</SectionTitle>
          <View style={styles.fileList}>
            {built.files.map((f) => (
              <Text key={f.path} style={styles.file}>
                {f.path} <Text style={styles.hint}>{typeof f.data === 'string' ? `${(f.data.length / 1024).toFixed(1)} KB` : `${(f.data.byteLength / 1024).toFixed(1)} KB`}</Text>
              </Text>
            ))}
          </View>
          {built.warnings.length ? (
            <>
              <SectionTitle>Warnings</SectionTitle>
              {built.warnings.map((w, i) => (
                <Text key={i} style={styles.warn}>
                  ⚠ {w}
                </Text>
              ))}
            </>
          ) : null}
          <Row>
            <Button label="Export ZIP (JSON + PNGs + runtime example)" primary disabled={busy} onPress={() => run(exportAssemblyZip)} />
            <Button label="Export assembly.json only" disabled={busy} onPress={() => run(exportAssemblyJson)} />
          </Row>
          <Text style={styles.hint}>All paths inside the package are relative. Original PNG bytes are copied unmodified. Open the exported ZIP in the Runtime Test screen (Assembly tab → “Runtime test”) to verify it independently of the editor.</Text>
        </>
      ) : (
        <Text style={styles.hint}>No active assembly.</Text>
      )}
      <SectionTitle>Import</SectionTitle>
      <Row>
        <Button label="Import assembly package (ZIP / JSON)…" onPress={doImport} />
      </Row>
    </Dialog>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useProjectStore((s) => s.project.settings);
  const patch = (p: Partial<typeof settings>) => useProjectStore.getState().commit('Project settings', (d) => void Object.assign(d.settings, p));
  return (
    <Dialog visible title="Project settings" onClose={onClose} width={420} footer={<Button label="Done" primary onPress={onClose} />}>
      <Select label="Units" value={settings.units} options={[{ value: 'px', label: 'px' }, { value: 'mm', label: 'mm' }, { value: 'cm', label: 'cm' }]} onChange={(units) => patch({ units })} />
      <NumberField label="Pixels per mm" value={settings.pixelsPerMillimetre} min={0.01} step={0.5} onChange={(pixelsPerMillimetre) => patch({ pixelsPerMillimetre })} width={100} />
      <NumberField label="Grid size (px)" value={settings.gridSize} min={1} precision={0} onChange={(gridSize) => patch({ gridSize: Math.max(1, Math.round(gridSize)) })} width={100} />
      <Checkbox label="Snap to grid when moving" value={settings.snapToGrid} onChange={(snapToGrid) => patch({ snapToGrid })} />
      <NumberField label="Default action fps" value={settings.defaultFps} min={1} max={240} precision={0} onChange={(defaultFps) => patch({ defaultFps: Math.round(defaultFps) })} width={100} />
      <Checkbox label="Snap pivot to attachment points when dragging" value={settings.snapToAttachments} onChange={(snapToAttachments) => patch({ snapToAttachments })} />
      <NumberField label="Snap tolerance (screen px)" value={settings.snapTolerance} min={1} precision={0} onChange={(v) => patch({ snapTolerance: Math.max(1, Math.round(v)) })} width={100} />
    </Dialog>
  );
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['V / R / S / P / A / L / H', 'Select, Rotate, Scale, Pivot, Attachment, Link, Pan tools'],
    ['Space (hold) + drag', 'Pan the canvas'],
    ['Wheel / pinch', 'Zoom at cursor'],
    ['Shift + click', 'Add to selection'],
    ['Shift while rotating', 'Snap to 15°'],
    ['Drag pivot → attachment', 'Link child to parent at that attachment'],
    ['Double-click sprite', 'Open sprite editor (pivot + attachments)'],
    ['K', 'Insert keyframe for selection (Animate)'],
    ['Space', 'Play / pause (Animate)'],
    [', / .', 'Previous / next frame'],
    ['Delete / Backspace', 'Delete selected sprites or keyframes'],
    ['Ctrl/⌘ + Z / ⇧Z', 'Undo / redo'],
    ['Ctrl/⌘ + S', 'Save project'],
    ['Esc', 'Clear selection'],
  ];
  return (
    <Dialog visible title="Elemental Sprite Studio" onClose={onClose} width={520} footer={<Button label="Close" primary onPress={onClose} />}>
      <Text style={styles.body}>Rigid 2D sprite rigging and animation editor. Exports portable JSON + PNG assemblies rendered by a shared React Native runtime.</Text>
      <SectionTitle>Shortcuts</SectionTitle>
      {rows.map(([k, v]) => (
        <View key={k} style={styles.shortcutRow}>
          <Text style={styles.key}>{k}</Text>
          <Text style={styles.body}>{v}</Text>
        </View>
      ))}
    </Dialog>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.textDim, fontSize: font.xs, lineHeight: 15 },
  body: { color: colors.text, fontSize: font.md, lineHeight: 17, flex: 1 },
  bold: { fontWeight: '700' },
  warn: { color: colors.warning, fontSize: font.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.sm, borderRadius: 3, borderWidth: 1, borderColor: colors.border },
  rowCurrent: { borderColor: colors.accent },
  rowTitle: { color: colors.text, fontSize: font.md },
  fileList: { backgroundColor: colors.bg0, borderRadius: 3, padding: spacing.sm, gap: 1, maxHeight: 180 },
  file: { color: colors.textMuted, fontSize: font.xs, fontFamily: font.mono },
  shortcutRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  key: { color: colors.keyframe, fontSize: font.sm, fontFamily: font.mono, width: 190 },
});
