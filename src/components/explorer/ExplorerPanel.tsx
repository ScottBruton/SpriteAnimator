import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { SpriteInstance, UnitAssembly } from '@elemental/asset-schema';
import {
  addAction,
  deleteAction,
  deleteAssembly,
  duplicateAction,
  ensureEntityArtFolders,
  patchAction,
  renameAssembly,
  renameInstance,
  renameProject,
  setActiveAssembly,
} from '@/engine/commands';
import { blobStore } from '@/state/blobStore';
import { useEditorStore } from '@/state/editorStore';
import { useActiveAssembly, useProjectStore } from '@/state/projectStore';
import { deleteCurrentProjectCompletely } from '@/storage/projectService';
import { colors, font, spacing } from '@/theme/tokens';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/Dialog';
import { TextField } from '../ui/Fields';
import { Panel } from '../ui/Panel';

export function ExplorerPanel() {
  const project = useProjectStore((s) => s.project);
  const dirty = useProjectStore((s) => s.dirty);
  const workspaceFolderName = useProjectStore((s) => s.workspaceFolderName);
  const assembly = useActiveAssembly();
  const openDialog = useEditorStore((s) => s.openDialog);
  const setStatus = useEditorStore((s) => s.setStatus);
  const [confirmProjectDelete, setConfirmProjectDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  // Backfill 000…315 asset folders for entities created before that existed.
  useEffect(() => {
    if (assembly) ensureEntityArtFolders(assembly);
  }, [assembly?.id, assembly?.folder, assembly?.category]);

  const wipeProject = async () => {
    setBusy(true);
    try {
      const msg = await deleteCurrentProjectCompletely();
      setConfirmProjectDelete(false);
      setStatus(msg, 'success');
    } catch (e) {
      setStatus(`Delete project failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.column}>
      <Panel title="Project" padded>
        <TextField value={project.name} onChange={renameProject} />
        <View style={styles.row}>
          <Text style={styles.meta}>{dirty ? '● unsaved changes' : '✓ saved'}</Text>
          <Button label="Projects…" small onPress={() => openDialog('projects')} />
        </View>
        {workspaceFolderName ? <Text style={styles.meta}>Folder · {workspaceFolderName}</Text> : null}
        <Button label="Create new…" primary small onPress={() => openDialog('createEntity')} />
        <Button
          label="Delete entire project…"
          small
          danger
          title="Permanently delete this project, its assets, and wipe the linked folder on disk"
          onPress={() => setConfirmProjectDelete(true)}
        />
      </Panel>
      <AssembliesSection />
      <Panel title="Active" padded>
        {assembly ? <TextField value={assembly.name} onChange={renameAssembly} /> : null}
        <Text style={styles.meta}>
          {assembly?.category ?? 'unit'}
          {assembly?.folder ? ` · ${assembly.folder}` : ''}
        </Text>
        <Text style={styles.meta}>
          {assembly?.sprites.length ?? 0} sprites · {assembly?.layers.length ?? 0} layers · {assembly?.actions.length ?? 0} actions
        </Text>
        {assembly ? <DeleteEntityButton assembly={assembly} /> : null}
      </Panel>
      <HierarchySection />
      <ActionsSection />

      <ConfirmDialog
        visible={confirmProjectDelete}
        title="Delete entire project?"
        message={`Permanently delete “${project.name}”?\n\nThis removes the project from local storage, all project sprites/audio, and — if linked — wipes the on-disk project folder contents (${workspaceFolderName ?? 'no folder linked'}).\n\nThis cannot be undone.`}
        confirmLabel={busy ? 'Deleting…' : 'Delete project'}
        danger
        onCancel={() => !busy && setConfirmProjectDelete(false)}
        onConfirm={() => {
          if (!busy) void wipeProject();
        }}
      />
    </View>
  );
}

function DeleteEntityButton({ assembly }: { assembly: UnitAssembly }) {
  const [confirm, setConfirm] = useState(false);
  const setStatus = useEditorStore((s) => s.setStatus);
  const kind = assembly.category ?? 'unit';
  return (
    <>
      <Button
        label={`Delete this ${kind}…`}
        small
        danger
        title={`Delete ${assembly.name} and its art folders/assets`}
        onPress={() => setConfirm(true)}
      />
      <ConfirmDialog
        visible={confirm}
        title={`Delete ${kind}?`}
        message={`Delete “${assembly.name}” (${kind})?\n\nIts assembly and art under ${assembly.folder || '(no folder)'} will be removed. This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          const keys = deleteAssembly(assembly.id, { deleteArt: true });
          for (const k of keys) blobStore.remove(k);
          setConfirm(false);
          setStatus(`Deleted ${kind} “${assembly.name}”`, 'success');
        }}
      />
    </>
  );
}

function AssembliesSection() {
  const assemblies = useProjectStore((s) => s.project.assemblies);
  const activeId = useProjectStore((s) => s.project.activeAssemblyId);
  const setStatus = useEditorStore((s) => s.setStatus);
  const grouped = useMemo(() => groupAssemblies(assemblies), [assemblies]);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const pending = confirmId ? assemblies.find((a) => a.id === confirmId) : null;

  return (
    <Panel title="Assemblies" flex={0.9} scroll padded={false}>
      {assemblies.length === 0 ? <Text style={styles.empty}>No assemblies. Use Create new…</Text> : null}
      {grouped.map((g) => (
        <View key={g.folder || '__unfiled'}>
          <Text style={styles.folderLabel}>{g.folder || 'Unfiled'}</Text>
          {g.items.map((a) => {
            const active = a.id === activeId;
            return (
              <View key={a.id} style={[styles.treeRow, active && styles.treeRowSel, { paddingLeft: 10 }]}>
                <Pressable onPress={() => setActiveAssembly(a.id)} style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.treeText, active && styles.treeTextSel]} numberOfLines={1}>
                    {a.name} <Text style={styles.meta}>{a.category ?? 'unit'}</Text>
                  </Text>
                </Pressable>
                <Button
                  icon="🗑"
                  small
                  danger
                  title={`Delete ${a.category ?? 'unit'} “${a.name}”`}
                  onPress={() => setConfirmId(a.id)}
                />
              </View>
            );
          })}
        </View>
      ))}
      <ConfirmDialog
        visible={!!pending}
        title={`Delete ${pending?.category ?? 'unit'}?`}
        message={
          pending
            ? `Delete “${pending.name}” and its art under ${pending.folder || '(no folder)'}? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirmId(null)}
        onConfirm={() => {
          if (!pending) return;
          const keys = deleteAssembly(pending.id, { deleteArt: true });
          for (const k of keys) blobStore.remove(k);
          setStatus(`Deleted ${pending.category ?? 'unit'} “${pending.name}”`, 'success');
          setConfirmId(null);
        }}
      />
    </Panel>
  );
}

function groupAssemblies(assemblies: UnitAssembly[]): { folder: string; items: UnitAssembly[] }[] {
  const map = new Map<string, UnitAssembly[]>();
  for (const a of assemblies) {
    const f = (a.folder ?? '').trim();
    const list = map.get(f) ?? [];
    list.push(a);
    map.set(f, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([folder, items]) => ({ folder, items: items.sort((x, y) => x.name.localeCompare(y.name)) }));
}

function HierarchySection() {
  const assembly = useActiveAssembly();
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const select = useEditorStore((s) => s.select);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  if (!assembly) return null;
  const children = new Map<string | null, SpriteInstance[]>();
  for (const s of assembly.sprites) {
    const k = s.parentId ?? null;
    children.set(k, [...(children.get(k) ?? []), s]);
  }
  const rows: { inst: SpriteInstance; depth: number; hasChildren: boolean }[] = [];
  const walk = (parent: string | null, depth: number, seen: Set<string>) => {
    for (const s of children.get(parent) ?? []) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      const kids = children.get(s.id) ?? [];
      rows.push({ inst: s, depth, hasChildren: kids.length > 0 });
      if (!collapsed.has(s.id)) walk(s.id, depth + 1, seen);
    }
  };
  walk(null, 0, new Set());
  for (const s of assembly.sprites) if (!rows.some((r) => r.inst.id === s.id)) rows.push({ inst: s, depth: 0, hasChildren: false });

  return (
    <Panel title="Hierarchy" flex={1} scroll padded={false}>
      {rows.length === 0 ? <Text style={styles.empty}>Drag sprites from the Asset Library onto the canvas.</Text> : null}
      {rows.map(({ inst, depth, hasChildren }) => {
        const sel = selectedIds.includes(inst.id);
        return (
          <Pressable key={inst.id} onPress={() => select([inst.id])} onLongPress={() => setEditing(inst.id)} style={[styles.treeRow, sel && styles.treeRowSel, { paddingLeft: 6 + depth * 14 }]}>
            <Pressable
              onPress={() =>
                setCollapsed((c) => {
                  const n = new Set(c);
                  if (n.has(inst.id)) n.delete(inst.id);
                  else n.add(inst.id);
                  return n;
                })
              }
              style={styles.chev}
            >
              <Text style={styles.chevText}>{hasChildren ? (collapsed.has(inst.id) ? '▸' : '▾') : '·'}</Text>
            </Pressable>
            {editing === inst.id ? (
              <TextField
                value={inst.name}
                autoFocus
                onChange={(v) => {
                  renameInstance(inst.id, v || inst.name);
                  setEditing(null);
                }}
                onSubmit={() => setEditing(null)}
                style={{ flex: 1 }}
              />
            ) : (
              <Text style={[styles.treeText, sel && styles.treeTextSel]} numberOfLines={1}>
                {inst.name}
              </Text>
            )}
          </Pressable>
        );
      })}
    </Panel>
  );
}

function ActionsSection() {
  const assembly = useActiveAssembly();
  const activeActionId = useEditorStore((s) => s.activeActionId);
  const setActiveAction = useEditorStore((s) => s.setActiveAction);
  const setWorkspace = useEditorStore((s) => s.setWorkspace);
  const [editing, setEditing] = useState<string | null>(null);
  if (!assembly) return null;
  return (
    <Panel
      title="Actions"
      flex={0.7}
      scroll
      padded={false}
      actions={
        <Button
          icon="+"
          small
          title="New action"
          onPress={() => {
            const fps = useProjectStore.getState().project.settings.defaultFps ?? 30;
            let n = 1;
            while (assembly.actions.some((a) => a.name === `action_${n}`)) n++;
            const id = addAction(`action_${n}`, fps);
            setActiveAction(id);
            setWorkspace('animate');
            setEditing(id);
          }}
        />
      }
    >
      {assembly.actions.length === 0 ? <Text style={styles.empty}>No actions. Create one to start animating.</Text> : null}
      {assembly.actions.map((a) => {
        const active = a.id === activeActionId;
        return (
          <Pressable
            key={a.id}
            onPress={() => {
              setActiveAction(a.id);
              setWorkspace('animate');
            }}
            onLongPress={() => setEditing(a.id)}
            style={[styles.treeRow, active && styles.treeRowSel, { paddingLeft: 8 }]}
          >
            {editing === a.id ? (
              <TextField
                value={a.name}
                autoFocus
                onChange={(v) => {
                  patchAction(a.id, { name: v || a.name }, 'Rename action');
                  setEditing(null);
                }}
                onSubmit={() => setEditing(null)}
                style={{ flex: 1 }}
              />
            ) : (
              <Text style={[styles.treeText, active && styles.treeTextSel, { flex: 1 }]} numberOfLines={1}>
                {a.name}{' '}
                <Text style={styles.meta}>
                  {a.duration.toFixed(2)}s{a.loop ? ' ↻' : ''}
                </Text>
              </Text>
            )}
            <Button icon="✎" small onPress={() => setEditing(a.id)} title="Rename" />
            <Button icon="⧉" small onPress={() => duplicateAction(a.id)} title="Duplicate" />
            <Button
              icon="🗑"
              small
              title="Delete"
              onPress={() => {
                deleteAction(a.id);
                if (active) setActiveAction(null);
              }}
            />
          </Pressable>
        );
      })}
    </Panel>
  );
}

const styles = StyleSheet.create({
  column: { flex: 1, minHeight: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  meta: { color: colors.textDim, fontSize: font.xs },
  empty: { color: colors.textDim, fontSize: font.sm, padding: spacing.md },
  folderLabel: {
    color: colors.textDim,
    fontSize: font.xs,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 2,
  },
  treeRow: { flexDirection: 'row', alignItems: 'center', height: 24, paddingRight: 4, gap: 2 },
  treeRowSel: { backgroundColor: colors.accentSoft },
  treeText: { color: colors.textMuted, fontSize: font.sm, flex: 1 },
  treeTextSel: { color: colors.text },
  chev: { width: 14, alignItems: 'center' },
  chevText: { color: colors.textDim, fontSize: font.xs },
});

export { ScrollView };
