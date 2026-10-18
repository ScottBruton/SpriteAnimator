import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ProjectSummary } from '@elemental/asset-schema';
import { buildCurrentAssemblyExport, exportAssemblyJson, exportAssemblyZip, exportV2UnitPackZip, importAssemblyPackage } from '@/exporters/exportService';
import {
  FACTIONS,
  UNIT_KINDS,
  requiredVariantsFor,
  type Faction,
  type UnitKind,
} from '@/exporters/v2UnitPack';
import { pickFiles } from '@/importers/pickFiles';
import { useEditorStore } from '@/state/editorStore';
import { useProjectStore } from '@/state/projectStore';
import { getStorage } from '@/storage';
import {
  deleteProject,
  newProject,
  newProjectInFolder,
  openProject,
  openProjectFromFile,
  openProjectFromFolder,
  saveCurrentProject,
  supportsFolderWorkspace,
} from '@/storage/projectService';
import { colors, font, spacing } from '@/theme/tokens';
import { Button } from '../ui/Button';
import { ConfirmDialog, Dialog } from '../ui/Dialog';
import { Checkbox, NumberField, Row, SectionTitle, Select, TextField } from '../ui/Fields';
import { CreateEntityDialog } from './CreateEntityDialog';
import { SaveAsDialog } from './SaveAsDialog';
import { SpriteSheetDialog } from './SpriteSheetDialog';

export function Dialogs() {
  const dialog = useEditorStore((s) => s.dialog);
  const close = () => useEditorStore.getState().openDialog(null);
  switch (dialog) {
    case 'projects':
      return <ProjectsDialog onClose={close} />;
    case 'newProject':
      return <NewProjectDialog onClose={close} />;
    case 'saveAs':
      return <SaveAsDialog onClose={close} />;
    case 'createEntity':
      return <CreateEntityDialog onClose={close} />;
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
  const folderOk = supportsFolderWorkspace();
  const isAbort = (e: unknown) => e instanceof Error && (e.name === 'AbortError' || /abort|cancel/i.test(e.message));
  const openFile = async () => {
    try {
      if (dirty) await saveCurrentProject();
      const msg = await openProjectFromFile();
      setStatus(msg, 'success');
      onClose();
    } catch (e) {
      if ((e as Error).message === 'No file selected') return;
      setStatus(`Open failed: ${(e as Error).message}`, 'error');
    }
  };
  const openFolder = async () => {
    try {
      if (dirty) await saveCurrentProject();
      const msg = await openProjectFromFolder();
      setStatus(msg, 'success');
      onClose();
    } catch (e) {
      if (isAbort(e)) return;
      setStatus(`Open folder failed: ${(e as Error).message}`, 'error');
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
          {folderOk ? <Button label="Open folder…" onPress={openFolder} /> : null}
          <Button label="Open zip…" onPress={openFile} />
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
      <Text style={styles.hint}>
        {folderOk
          ? 'Prefer Open folder… for a live project directory on disk. Local copies below are a browser mirror / crash recovery. Zip packs are optional backups.'
          : 'Projects are stored locally in this browser/device. Use File → Save As… for a folder (Chrome/Edge) or zip backup.'}
      </Text>
      {confirm ? (
        <ConfirmDialog
          visible
          title="Delete project"
          message={
            confirm.id === currentId
              ? `Delete the open project “${confirm.name}”? This removes local storage, project assets, and wipes the linked folder on disk. This cannot be undone.`
              : `Delete “${confirm.name}” from the local project list? (On-disk folders for closed projects are not wiped.) This cannot be undone.`
          }
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
  const [busy, setBusy] = useState(false);
  const dirty = useProjectStore((s) => s.dirty);
  const folderOk = supportsFolderWorkspace();
  const isAbort = (e: unknown) => e instanceof Error && (e.name === 'AbortError' || /abort|cancel/i.test(e.message));

  const createInFolder = async () => {
    setBusy(true);
    try {
      if (dirty) await saveCurrentProject();
      const msg = await newProjectInFolder(name.trim() || 'Untitled');
      useEditorStore.getState().setStatus(msg, 'success');
      onClose();
    } catch (e) {
      if (isAbort(e)) return;
      useEditorStore.getState().setStatus(`Create failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const createLocal = async () => {
    setBusy(true);
    try {
      if (dirty) await saveCurrentProject();
      await newProject(name.trim() || 'Untitled');
      useEditorStore.getState().setStatus('Project created (local only — use Save As… to pick a folder)', 'success');
      onClose();
    } catch (e) {
      useEditorStore.getState().setStatus(`Create failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      visible
      title="New project"
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button label="Cancel" onPress={onClose} disabled={busy} />
          {!folderOk ? <Button label="Create" primary disabled={busy} onPress={createLocal} /> : null}
          {folderOk ? (
            <>
              <Button label="Local only" disabled={busy} onPress={createLocal} />
              <Button label={busy ? 'Creating…' : 'Choose folder…'} primary disabled={busy} onPress={createInFolder} />
            </>
          ) : null}
        </>
      }
    >
      <TextField label="Name" value={name} onChange={setName} autoFocus onSubmit={folderOk ? createInFolder : createLocal} />
      {folderOk ? (
        <Text style={styles.hint}>
          Choose a parent folder; a subfolder named after the project is created there. Save writes into that folder.
        </Text>
      ) : (
        <Text style={styles.hint}>Folder workspaces need Chrome or Edge. Creating locally for now.</Text>
      )}
      {dirty ? <Text style={styles.hint}>The current project will be saved first.</Text> : null}
    </Dialog>
  );
}

function ExportDialog({ onClose }: { onClose: () => void }) {
  const setStatus = useEditorStore((s) => s.setStatus);
  const assemblies = useProjectStore((s) => s.project.assemblies);
  const activeId = useProjectStore((s) => s.project.activeAssemblyId);
  const built = buildCurrentAssemblyExport();
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<UnitKind>('melee');
  const [faction, setFaction] = useState<Faction>('fire');
  const required = requiredVariantsFor(kind, faction);
  const [variantMap, setVariantMap] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const v of requiredVariantsFor('melee', 'fire')) m[v] = activeId ?? assemblies[0]?.id ?? '';
    return m;
  });

  // When kind/faction change, ensure required variant keys exist (keep prior picks when possible).
  const syncVariants = (k: UnitKind, f: Faction) => {
    setKind(k);
    setFaction(f);
    const req = requiredVariantsFor(k, f);
    setVariantMap((prev) => {
      const next: Record<string, string> = {};
      for (const v of req) next[v] = prev[v] ?? activeId ?? assemblies[0]?.id ?? '';
      return next;
    });
  };

  const run = async (fn: () => Promise<{ message: string; warnings: string[] } | null>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r) {
        const extra = r.warnings.length ? ` (${r.warnings.length} warning(s) — see status)` : '';
        setStatus(`${r.message}${extra}`, r.warnings.length ? 'info' : 'success');
        if (r.warnings.length) console.warn('[export]', r.warnings);
      }
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

  const asmOptions = assemblies.map((a) => ({ value: a.id, label: a.name }));

  return (
    <Dialog visible title="Export / import" onClose={onClose} width={600} height={640}>
      <SectionTitle>Elemental game pack (V2)</SectionTitle>
      <Text style={styles.hint}>
        Drop-in ZIP for <Text style={styles.mono}>assets/v2/units/</Text> — assemblies.json, 8-direction layered frames, pivot
        sidecars, projectiles, plus <Text style={styles.mono}>control.js</Text> to drive the unit in React Native.
      </Text>
      <Select
        label="Kind"
        value={kind}
        options={UNIT_KINDS.map((k) => ({ value: k, label: k }))}
        onChange={(k) => syncVariants(k, faction)}
      />
      <Select
        label="Faction"
        value={faction}
        options={FACTIONS.map((f) => ({ value: f, label: f }))}
        onChange={(f) => syncVariants(kind, f)}
      />
      <Text style={styles.body}>
        Unit id: <Text style={styles.bold}>{kind}/{faction}</Text>
      </Text>
      {required.map((vid) => (
        <Select
          key={vid}
          label={`Variant “${vid}”`}
          value={(variantMap[vid] && asmOptions.some((o) => o.value === variantMap[vid]) ? variantMap[vid] : asmOptions[0]?.value) as string}
          options={asmOptions.length ? asmOptions : [{ value: '', label: '(no assemblies)' }]}
          onChange={(assemblyId) => setVariantMap((m) => ({ ...m, [vid]: assemblyId }))}
          compact
        />
      ))}
      <Row>
        <Button
          label={busy ? 'Exporting…' : 'Export Elemental V2 pack ZIP'}
          primary
          disabled={busy || !assemblies.length}
          onPress={() =>
            run(() =>
              exportV2UnitPackZip({
                kind,
                faction,
                variantAssemblyIds: Object.fromEntries(required.map((v) => [v, variantMap[v] || activeId || assemblies[0]!.id])),
              }),
            )
          }
        />
      </Row>
      <Text style={styles.hint}>
        Name sprites/slots <Text style={styles.mono}>body</Text>, <Text style={styles.mono}>weapon</Text>,{' '}
        <Text style={styles.mono}>grip_hand</Text>, <Text style={styles.mono}>pickaxe</Text>, <Text style={styles.mono}>hammer</Text>,{' '}
        <Text style={styles.mono}>crystal_bag</Text>, <Text style={styles.mono}>left_fist</Text>/<Text style={styles.mono}>right_fist</Text> so the
        game can animate them. Put projectile art in a Projectiles folder (or tag “projectile”).
      </Text>

      <SectionTitle>Studio runtime pack (our player)</SectionTitle>
      {built ? (
        <>
          <Text style={styles.body}>
            <Text style={styles.bold}>{built.manifest.name}</Text> — {built.pkg.assembly.sprites.length} sprites, {built.pkg.assets.length}{' '}
            images, {built.manifest.actions.length} actions.
          </Text>
          <View style={styles.fileList}>
            {built.files.slice(0, 12).map((f) => (
              <Text key={f.path} style={styles.file}>
                {f.path}{' '}
                <Text style={styles.hint}>
                  {typeof f.data === 'string' ? `${(f.data.length / 1024).toFixed(1)} KB` : `${(f.data.byteLength / 1024).toFixed(1)} KB`}
                </Text>
              </Text>
            ))}
            {built.files.length > 12 ? <Text style={styles.hint}>…and {built.files.length - 12} more</Text> : null}
          </View>
          <Row>
            <Button label="Export studio ZIP" disabled={busy} onPress={() => run(exportAssemblyZip)} />
            <Button label="Export assembly.json only" disabled={busy} onPress={() => run(exportAssemblyJson)} />
          </Row>
        </>
      ) : (
        <Text style={styles.hint}>No active assembly.</Text>
      )}

      <SectionTitle>Import</SectionTitle>
      <Row>
        <Button label="Import studio assembly package…" onPress={doImport} />
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
  mono: { fontFamily: font.mono, color: colors.textMuted },
  warn: { color: colors.warning, fontSize: font.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.sm, borderRadius: 3, borderWidth: 1, borderColor: colors.border },
  rowCurrent: { borderColor: colors.accent },
  rowTitle: { color: colors.text, fontSize: font.md },
  fileList: { backgroundColor: colors.bg0, borderRadius: 3, padding: spacing.sm, gap: 1, maxHeight: 140 },
  file: { color: colors.textMuted, fontSize: font.xs, fontFamily: font.mono },
  shortcutRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  key: { color: colors.keyframe, fontSize: font.sm, fontFamily: font.mono, width: 190 },
});
