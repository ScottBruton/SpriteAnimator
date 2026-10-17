import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { SpriteInstance } from '@elemental/asset-schema';
import { addAction, deleteAction, duplicateAction, patchAction, renameAssembly, renameInstance, renameProject } from '@/engine/commands';
import { useEditorStore } from '@/state/editorStore';
import { useActiveAssembly, useProjectStore } from '@/state/projectStore';
import { colors, font, spacing } from '@/theme/tokens';
import { Button } from '../ui/Button';
import { TextField } from '../ui/Fields';
import { Panel } from '../ui/Panel';

export function ExplorerPanel() {
  const project = useProjectStore((s) => s.project);
  const dirty = useProjectStore((s) => s.dirty);
  const assembly = useActiveAssembly();
  const openDialog = useEditorStore((s) => s.openDialog);
  return (
    <View style={styles.column}>
      <Panel title="Project" padded>
        <TextField value={project.name} onChange={renameProject} />
        <View style={styles.row}>
          <Text style={styles.meta}>{dirty ? '● unsaved changes' : '✓ saved'}</Text>
          <Button label="Projects…" small onPress={() => openDialog('projects')} />
        </View>
      </Panel>
      <Panel title="Assembly" padded>
        {assembly ? <TextField value={assembly.name} onChange={renameAssembly} /> : null}
        <Text style={styles.meta}>
          {assembly?.sprites.length ?? 0} sprites · {assembly?.layers.length ?? 0} layers · {assembly?.actions.length ?? 0} actions
        </Text>
      </Panel>
      <HierarchySection />
      <ActionsSection />
    </View>
  );
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
  // Orphans (parent missing) appear as roots.
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
                {inst.parentAttachmentId ? <Text style={styles.meta}>  ⟵ {attachmentName(assembly, inst)}</Text> : null}
              </Text>
            )}
          </Pressable>
        );
      })}
    </Panel>
  );
}

function attachmentName(assembly: { sprites: SpriteInstance[] }, inst: SpriteInstance): string {
  const parent = assembly.sprites.find((s) => s.id === inst.parentId);
  const lookup = useProjectStore.getState();
  const asset = [...lookup.project.assets, ...lookup.globalAssets].find((a) => a.id === parent?.assetId);
  return asset?.attachments.find((a) => a.id === inst.parentAttachmentId)?.name ?? '?';
}

function ActionsSection() {
  const assembly = useActiveAssembly();
  const activeActionId = useEditorStore((s) => s.activeActionId);
  const setActiveAction = useEditorStore((s) => s.setActiveAction);
  const setWorkspace = useEditorStore((s) => s.setWorkspace);
  const fps = useProjectStore((s) => s.project.settings.defaultFps);
  const [editing, setEditing] = useState<string | null>(null);
  if (!assembly) return null;
  return (
    <Panel
      title="Actions"
      flex={1}
      scroll
      padded={false}
      actions={
        <Button
          icon="+"
          small
          title="New action"
          onPress={() => {
            let n = 1;
            while (assembly.actions.some((a) => a.name === `action_${n}`)) n++;
            const id = addAction(`action_${n}`, fps);
            setActiveAction(id);
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
                {a.name} <Text style={styles.meta}>{a.duration.toFixed(2)}s{a.loop ? ' ↻' : ''}</Text>
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
  column: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  meta: { color: colors.textDim, fontSize: font.xs },
  empty: { color: colors.textDim, fontSize: font.sm, padding: spacing.md },
  treeRow: { flexDirection: 'row', alignItems: 'center', height: 24, paddingRight: 4, gap: 2 },
  treeRowSel: { backgroundColor: colors.accentSoft },
  treeText: { color: colors.textMuted, fontSize: font.sm, flex: 1 },
  treeTextSel: { color: colors.text },
  chev: { width: 14, alignItems: 'center' },
  chevText: { color: colors.textDim, fontSize: font.xs },
});

export { ScrollView };
