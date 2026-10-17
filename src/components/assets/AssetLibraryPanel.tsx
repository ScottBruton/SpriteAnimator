import React, { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import type { SpriteAsset } from '@elemental/asset-schema';
import { createId } from '@elemental/asset-schema';
import { deleteAsset, placeInstance, renameAsset } from '@/engine/commands';
import { useBlobVersion } from '@/hooks/useBlobVersion';
import { importPngFiles } from '@/importers/importPng';
import { canvasCentreWorld, windowPointToWorld } from '@/rendering/canvasRegion';
import { blobStore } from '@/state/blobStore';
import { useEditorStore } from '@/state/editorStore';
import { useProjectStore } from '@/state/projectStore';
import { colors, font, spacing } from '@/theme/tokens';
import { Button } from '../ui/Button';
import { TextField } from '../ui/Fields';
import { Panel } from '../ui/Panel';

type Scope = 'project' | 'global';

export function AssetLibraryPanel() {
  const [scope, setScope] = useState<Scope>('project');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const projectAssets = useProjectStore((s) => s.project.assets);
  const globalAssets = useProjectStore((s) => s.globalAssets);
  const assembly = useProjectStore((s) => s.project.assemblies.find((a) => a.id === s.project.activeAssemblyId));
  const setStatus = useEditorStore((s) => s.setStatus);
  const openSpriteEditor = useEditorStore((s) => s.openSpriteEditor);
  useBlobVersion();

  const assets = scope === 'project' ? projectAssets : globalAssets;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? assets.filter((a) => a.name.toLowerCase().includes(q) || a.tags.some((t) => t.toLowerCase().includes(q))) : assets;
  }, [assets, query]);
  const selectedAsset = assets.find((a) => a.id === selected) ?? null;
  const usage = (id: string) => assembly?.sprites.filter((s) => s.assetId === id).length ?? 0;

  const onImport = async () => {
    try {
      const imported = await importPngFiles();
      if (imported.length) setStatus(`Imported ${imported.length} sprite${imported.length > 1 ? 's' : ''}`, 'success');
    } catch (e) {
      setStatus(`Import failed: ${(e as Error).message}`, 'error');
    }
  };

  const copyToScope = (asset: SpriteAsset, to: Scope) => {
    const copy: SpriteAsset = { ...asset, id: createId('spr'), attachments: asset.attachments.map((a) => ({ ...a })) };
    if (to === 'global') {
      useProjectStore.getState().setGlobalAssets([...useProjectStore.getState().globalAssets, copy]);
    } else {
      useProjectStore.getState().commit('Copy asset to project', (d) => void d.assets.push(copy));
    }
    setStatus(`Copied "${asset.name}" to ${to} library`, 'success');
  };

  const removeAsset = (asset: SpriteAsset) => {
    if (scope === 'global') {
      useProjectStore.getState().setGlobalAssets(useProjectStore.getState().globalAssets.filter((a) => a.id !== asset.id));
    } else {
      deleteAsset(asset.id);
    }
    setSelected(null);
  };

  return (
    <Panel
      title="Asset Library"
      flex={1}
      padded={false}
      actions={
        <>
          <Button icon="⤓" label="Import PNG" small onPress={onImport} title="Import PNG files" />
        </>
      }
    >
      <View style={styles.toolbar}>
        <View style={styles.scopeRow}>
          <Button label="Project" small active={scope === 'project'} onPress={() => setScope('project')} />
          <Button label="Global" small active={scope === 'global'} onPress={() => setScope('global')} />
        </View>
        <TextField value={query} onChange={setQuery} placeholder="Search…" style={{ flex: 1 }} />
      </View>
      <ScrollView style={styles.grid} contentContainerStyle={styles.gridContent}>
        {filtered.length === 0 ? (
          <Text style={styles.empty}>{assets.length === 0 ? 'No sprites yet. Import transparent PNGs to begin.' : 'No matches.'}</Text>
        ) : (
          filtered.map((a) => (
            <AssetTile
              key={a.id}
              asset={a}
              selected={a.id === selected}
              usage={usage(a.id)}
              onSelect={() => setSelected(a.id)}
              onOpen={() => openSpriteEditor(a.id)}
              onDrop={(world) => {
                placeInstance(a, world);
                setStatus(`Placed "${a.name}"`, 'success');
              }}
            />
          ))
        )}
      </ScrollView>
      {selectedAsset ? (
        <View style={styles.details}>
          <TextField value={selectedAsset.name} onChange={(v) => (scope === 'project' ? renameAsset(selectedAsset.id, v) : renameGlobal(selectedAsset.id, v))} />
          <Text style={styles.meta}>
            {selectedAsset.width}×{selectedAsset.height}px · pivot {Math.round(selectedAsset.pivot.x)},{Math.round(selectedAsset.pivot.y)} · {selectedAsset.attachments.length} attachment
            {selectedAsset.attachments.length === 1 ? '' : 's'} · used {usage(selectedAsset.id)}×
          </Text>
          <View style={styles.actionRow}>
            <Button label="Place" small primary onPress={() => placeInstance(selectedAsset, canvasCentreWorld())} />
            <Button label="Edit sprite" small onPress={() => openSpriteEditor(selectedAsset.id)} />
            <Button label={scope === 'project' ? '→ Global' : '→ Project'} small onPress={() => copyToScope(selectedAsset, scope === 'project' ? 'global' : 'project')} />
            <Button label="Delete" small danger onPress={() => removeAsset(selectedAsset)} />
          </View>
        </View>
      ) : null}
    </Panel>
  );
}

function renameGlobal(id: string, name: string) {
  const st = useProjectStore.getState();
  st.setGlobalAssets(st.globalAssets.map((a) => (a.id === id ? { ...a, name } : a)));
}

function AssetTile({ asset, selected, usage, onSelect, onOpen, onDrop }: { asset: SpriteAsset; selected: boolean; usage: number; onSelect: () => void; onOpen: () => void; onDrop: (world: { x: number; y: number }) => void }) {
  const blob = blobStore.get(asset.imagePath);
  const lastTap = React.useRef(0);
  const setDrag = useEditorStore((s) => s.setDragAsset);
  const pan = usePanGesture({
    runOnJS: true,
    minDistance: 6,
    activeCursor: 'grabbing',
    onActivate: (e) => {
      onSelect();
      setDrag({ assetId: asset.id, x: e.absoluteX, y: e.absoluteY });
    },
    onUpdate: (e) => setDrag({ assetId: asset.id, x: e.absoluteX, y: e.absoluteY }),
    onDeactivate: (e) => {
      setDrag(null);
      if (e.canceled) return;
      const world = windowPointToWorld({ x: e.absoluteX, y: e.absoluteY });
      if (world) onDrop(world);
    },
    onFinalize: () => setDrag(null),
  });
  return (
    <GestureDetector gesture={pan}>
      <Pressable
        onPress={() => {
          const now = Date.now();
          if (now - lastTap.current < 350) onOpen();
          lastTap.current = now;
          onSelect();
        }}
        style={[styles.tile, selected && styles.tileSelected]}
      >
        <View style={styles.thumb}>
          <Checker />
          {blob ? <Image source={{ uri: blob.uri }} style={styles.thumbImg} resizeMode="contain" /> : <Text style={styles.missing}>missing</Text>}
          {usage > 0 ? <Text style={styles.badge}>{usage}</Text> : null}
        </View>
        <Text style={styles.name} numberOfLines={1}>
          {asset.name}
        </Text>
        <Text style={styles.dims}>
          {asset.width}×{asset.height}
        </Text>
      </Pressable>
    </GestureDetector>
  );
}

/** Lightweight CSS-free checkerboard made of two offset stripes. */
export function Checker() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.checkerB }]} />
      {[0, 1, 2, 3, 4, 5].map((r) =>
        [0, 1, 2, 3, 4, 5].map((c) =>
          (r + c) % 2 === 0 ? <View key={`${r}-${c}`} style={{ position: 'absolute', left: `${c * 16.666}%`, top: `${r * 16.666}%`, width: '16.7%', height: '16.7%', backgroundColor: colors.checkerA }} /> : null,
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  scopeRow: { flexDirection: 'row', gap: 2 },
  grid: { flex: 1 },
  gridContent: { flexDirection: 'row', flexWrap: 'wrap', padding: spacing.sm, gap: spacing.sm },
  empty: { color: colors.textDim, fontSize: font.sm, padding: spacing.md },
  tile: { width: 84, borderRadius: 3, borderWidth: 1, borderColor: 'transparent', padding: 3, alignItems: 'center' },
  tileSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  thumb: { width: 76, height: 64, overflow: 'hidden', borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  thumbImg: { width: 76, height: 64 },
  missing: { color: colors.danger, fontSize: font.xs },
  badge: { position: 'absolute', right: 2, top: 2, backgroundColor: colors.accent, color: '#fff', fontSize: 9, paddingHorizontal: 4, borderRadius: 6, overflow: 'hidden' },
  name: { color: colors.text, fontSize: font.sm, marginTop: 2, maxWidth: 76 },
  dims: { color: colors.textDim, fontSize: font.xs },
  details: { borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.sm, gap: spacing.sm, backgroundColor: colors.bg2 },
  meta: { color: colors.textMuted, fontSize: font.xs },
  actionRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
});
