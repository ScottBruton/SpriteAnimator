import React, { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import type { SpriteAsset } from '@elemental/asset-schema';
import { createId } from '@elemental/asset-schema';
import {
  createAssetFolder,
  deleteAssets,
  deleteAssetFolder,
  moveAssetFolder,
  normalizeAssetFolder,
  placeInstance,
  renameAsset,
  renameAssetFolder,
  setAssetFolder,
  setAssetsFolder,
} from '@/engine/commands';
import { useBlobVersion } from '@/hooks/useBlobVersion';
import { importPngFiles } from '@/importers/importPng';
import { pickSpriteSheetFile } from '@/importers/spriteSheet';
import { canvasCentreWorld, windowPointToWorld } from '@/rendering/canvasRegion';
import { blobStore } from '@/state/blobStore';
import { useEditorStore } from '@/state/editorStore';
import { useProjectStore } from '@/state/projectStore';
import { colors, font, spacing } from '@/theme/tokens';
import { setPendingSpriteSheet } from '../dialogs/SpriteSheetDialog';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/Dialog';
import { DropdownSelect, TextField } from '../ui/Fields';
import { Panel } from '../ui/Panel';

type Scope = 'project' | 'global';
/** `all` = every asset; `unfiled` = empty folder; otherwise a folder path. */
type FolderFilter = 'all' | 'unfiled' | string;

function folderLeaf(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

function folderParent(path: string): string {
  const i = path.lastIndexOf('/');
  return i <= 0 ? '' : path.slice(0, i);
}

/** Immediate child folder paths under `parent` ('' = top-level). */
function childFoldersOf(all: string[], parent: string): string[] {
  const prefix = parent ? parent + '/' : '';
  const out: string[] = [];
  for (const f of all) {
    if (parent) {
      if (!f.startsWith(prefix)) continue;
      const rest = f.slice(prefix.length);
      if (!rest || rest.includes('/')) continue;
      out.push(f);
    } else if (!f.includes('/')) {
      out.push(f);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function remapFolderPathLocal(path: string, src: string, dst: string): string {
  if (path === src) return dst;
  if (path.startsWith(src + '/')) return dst + path.slice(src.length);
  return path;
}

export function AssetLibraryPanel() {
  const [scope, setScope] = useState<Scope>('project');
  const [query, setQuery] = useState('');
  /** Multi-select via round checkboxes (and click-to-select). */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [folderFilter, setFolderFilter] = useState<FolderFilter>('all');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState(false);
  /** Empty folders for the global library (not persisted in project settings). */
  const [globalFolders, setGlobalFolders] = useState<string[]>([]);

  const projectAssets = useProjectStore((s) => s.project.assets);
  const projectFolders = useProjectStore((s) => s.project.settings.assetFolders ?? []);
  const globalAssets = useProjectStore((s) => s.globalAssets);
  const assembly = useProjectStore((s) => s.project.assemblies.find((a) => a.id === s.project.activeAssemblyId));
  const setStatus = useEditorStore((s) => s.setStatus);
  const openSpriteEditor = useEditorStore((s) => s.openSpriteEditor);
  useBlobVersion();

  const assets = scope === 'project' ? projectAssets : globalAssets;

  const folders = useMemo(() => {
    const set = new Set<string>();
    if (scope === 'project') for (const f of projectFolders) if (f) set.add(f);
    else for (const f of globalFolders) if (f) set.add(f);
    for (const a of assets) {
      const f = normalizeAssetFolder(a.folder ?? '');
      if (f) set.add(f);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [scope, projectFolders, globalFolders, assets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => {
      const folder = normalizeAssetFolder(a.folder ?? '');
      if (folderFilter === 'unfiled' && folder) return false;
      if (folderFilter !== 'all' && folderFilter !== 'unfiled' && folder !== folderFilter) return false;
      if (!q) return true;
      return a.name.toLowerCase().includes(q) || a.tags.some((t) => t.toLowerCase().includes(q)) || folder.toLowerCase().includes(q);
    });
  }, [assets, query, folderFilter]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedAssets = useMemo(() => assets.filter((a) => selectedSet.has(a.id)), [assets, selectedSet]);
  const selectedAsset = selectedAssets.length === 1 ? selectedAssets[0]! : null;
  const usage = (id: string) => assembly?.sprites.filter((s) => s.assetId === id).length ?? 0;

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const selectOnly = (id: string) => setSelectedIds([id]);
  const selectAllVisible = () => setSelectedIds(filtered.map((a) => a.id));
  const clearSelection = () => setSelectedIds([]);

  const onImport = async () => {
    try {
      const imported = await importPngFiles();
      if (imported.length) {
        if (folderFilter !== 'all' && folderFilter !== 'unfiled' && scope === 'project') {
          for (const a of imported) setAssetFolder(a.id, folderFilter);
        }
        setStatus(`Imported ${imported.length} sprite${imported.length > 1 ? 's' : ''}`, 'success');
      }
    } catch (e) {
      setStatus(`Import failed: ${(e as Error).message}`, 'error');
    }
  };

  const onExtractSheet = async () => {
    try {
      const file = await pickSpriteSheetFile();
      if (!file) return;
      setPendingSpriteSheet(file);
      useEditorStore.getState().openDialog('importSheet');
    } catch (e) {
      setStatus(`Sheet pick failed: ${(e as Error).message}`, 'error');
    }
  };

  const copyToScope = (asset: SpriteAsset, to: Scope) => {
    const copy: SpriteAsset = {
      ...asset,
      id: createId('spr'),
      attachments: asset.attachments.map((a) => ({ ...a })),
      folder: asset.folder ?? '',
    };
    if (to === 'global') {
      useProjectStore.getState().setGlobalAssets([...useProjectStore.getState().globalAssets, copy]);
    } else {
      useProjectStore.getState().commit('Copy asset to project', (d) => void d.assets.push(copy));
    }
    setStatus(`Copied "${asset.name}" to ${to} library`, 'success');
  };

  const removeSelectedAssets = () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (scope === 'global') {
      const remove = new Set(ids);
      useProjectStore.getState().setGlobalAssets(useProjectStore.getState().globalAssets.filter((a) => !remove.has(a.id)));
    } else {
      deleteAssets(ids);
    }
    clearSelection();
    setConfirmDelete(false);
    setStatus(ids.length > 1 ? `Deleted ${ids.length} assets` : 'Deleted asset', 'success');
  };

  const moveSelectedToFolder = (folder: string) => {
    if (selectedIds.length === 0) return;
    const f = normalizeAssetFolder(folder);
    if (scope === 'project') setAssetsFolder(selectedIds, f);
    else {
      const idSet = new Set(selectedIds);
      useProjectStore.getState().setGlobalAssets(
        useProjectStore.getState().globalAssets.map((a) => (idSet.has(a.id) ? { ...a, folder: f, updatedAt: Date.now() } : a)),
      );
      if (f && !globalFolders.includes(f)) setGlobalFolders((prev) => [...prev, f]);
    }
    if (f) setFolderFilter(f);
    setStatus(
      selectedIds.length > 1 ? `Moved ${selectedIds.length} assets to ${f || 'Unfiled'}` : `Moved to ${f || 'Unfiled'}`,
      'success',
    );
  };

  const currentFolderPath = folderFilter !== 'all' && folderFilter !== 'unfiled' ? folderFilter : '';
  const visibleChildFolders = useMemo(() => childFoldersOf(folders, currentFolderPath), [folders, currentFolderPath]);
  const breadcrumb = useMemo(() => {
    if (!currentFolderPath) return [] as { path: string; label: string }[];
    const parts = currentFolderPath.split('/');
    return parts.map((label, i) => ({ path: parts.slice(0, i + 1).join('/'), label }));
  }, [currentFolderPath]);

  const openCreateFolder = () => {
    setCreatingFolder(true);
    setNewFolderName('');
  };

  const submitNewFolder = () => {
    const leaf = normalizeAssetFolder(newFolderName);
    if (!leaf) {
      setCreatingFolder(false);
      setNewFolderName('');
      return;
    }
    // Name alone nests under the folder you're viewing; a path with `/` is used as-is.
    const f = leaf.includes('/') ? leaf : normalizeAssetFolder(currentFolderPath ? `${currentFolderPath}/${leaf}` : leaf);
    if (scope === 'project') {
      if (!createAssetFolder(f)) return;
    } else if (!folders.includes(f)) {
      setGlobalFolders((prev) => [...prev, f]);
    }
    setFolderFilter(f);
    setCreatingFolder(false);
    setNewFolderName('');
    setStatus(`Folder "${f}" ready`, 'success');
  };

  const submitRenameFolder = () => {
    if (!renamingFolder) return;
    // Rename edits the leaf name by default; keep parent path.
    const raw = normalizeAssetFolder(renameValue);
    const parent = folderParent(renamingFolder);
    const dst = raw.includes('/') ? raw : normalizeAssetFolder(parent ? `${parent}/${raw}` : raw);
    if (!dst || dst === renamingFolder) {
      setRenamingFolder(null);
      return;
    }
    if (scope === 'project') renameAssetFolder(renamingFolder, dst);
    else {
      setGlobalFolders((prev) => [...new Set(prev.map((x) => remapFolderPathLocal(x, renamingFolder, dst)))]);
      useProjectStore.getState().setGlobalAssets(
        useProjectStore.getState().globalAssets.map((a) => {
          const next = remapFolderPathLocal(normalizeAssetFolder(a.folder ?? ''), renamingFolder, dst);
          return next !== a.folder ? { ...a, folder: next, updatedAt: Date.now() } : a;
        }),
      );
    }
    setFolderFilter(dst);
    setRenamingFolder(null);
  };

  const promoteFolderPath = (path: string, removed: string): string => {
    const parent = folderParent(removed);
    if (path === removed) return parent;
    if (path.startsWith(removed + '/')) {
      const rest = path.slice(removed.length + 1);
      return parent ? `${parent}/${rest}` : rest;
    }
    return path;
  };

  const removeFolder = (folder: string) => {
    if (scope === 'project') deleteAssetFolder(folder);
    else {
      setGlobalFolders((prev) => [...new Set(prev.filter((x) => x !== folder).map((x) => promoteFolderPath(x, folder)))].filter(Boolean));
      useProjectStore.getState().setGlobalAssets(
        useProjectStore.getState().globalAssets.map((a) => {
          const next = promoteFolderPath(normalizeAssetFolder(a.folder ?? ''), folder);
          return next !== a.folder ? { ...a, folder: next, updatedAt: Date.now() } : a;
        }),
      );
    }
    setFolderFilter(folderParent(folder) || 'all');
    setConfirmDeleteFolder(false);
    setStatus(`Removed folder “${folderLeaf(folder)}” (assets kept)`, 'success');
  };

  const moveCurrentFolderTo = (newParent: string) => {
    if (!currentFolderPath) return;
    const parent = normalizeAssetFolder(newParent);
    if (parent === currentFolderPath || parent.startsWith(currentFolderPath + '/')) return;
    const leaf = folderLeaf(currentFolderPath);
    const dst = parent ? `${parent}/${leaf}` : leaf;
    if (dst === currentFolderPath) return;
    if (scope === 'project') moveAssetFolder(currentFolderPath, parent);
    else {
      setGlobalFolders((prev) => [...new Set(prev.map((x) => remapFolderPathLocal(x, currentFolderPath, dst)))]);
      useProjectStore.getState().setGlobalAssets(
        useProjectStore.getState().globalAssets.map((a) => {
          const next = remapFolderPathLocal(normalizeAssetFolder(a.folder ?? ''), currentFolderPath, dst);
          return next !== a.folder ? { ...a, folder: next, updatedAt: Date.now() } : a;
        }),
      );
    }
    setFolderFilter(dst);
    setStatus(`Moved folder to ${parent || 'top level'}`, 'success');
  };

  const folderMoveOptions = useMemo(() => {
    const opts: { value: string; label: string; depth: number }[] = [{ value: '', label: 'Unfiled', depth: 0 }];
    for (const f of folders) {
      opts.push({ value: f, label: f, depth: f.split('/').length - 1 });
    }
    return opts;
  }, [folders]);

  /** Destinations for moving the current folder (not itself or a descendant). */
  const folderRelocateOptions = useMemo(() => {
    if (!currentFolderPath) return [] as { value: string; label: string; depth: number }[];
    const opts: { value: string; label: string; depth: number }[] = [{ value: '', label: 'Top level (no parent)', depth: 0 }];
    for (const f of folders) {
      if (f === currentFolderPath || f.startsWith(currentFolderPath + '/')) continue;
      opts.push({ value: f, label: f, depth: f.split('/').length - 1 });
    }
    return opts;
  }, [folders, currentFolderPath]);

  return (
    <Panel
      title="Asset Library"
      flex={1.4}
      scroll
      padded={false}
      actions={
        <>
          <Button icon="⧉" label="Sheet" small onPress={onExtractSheet} title="Extract sprites from a sheet PNG" />
          <Button icon="⤓" label="Import PNG" small onPress={onImport} title="Import PNG files" />
        </>
      }
    >
      <View style={styles.toolbar}>
        <View style={styles.scopeRow}>
          <Button
            label="Project"
            small
            active={scope === 'project'}
            onPress={() => {
              setScope('project');
              clearSelection();
            }}
          />
          <Button
            label="Global"
            small
            active={scope === 'global'}
            onPress={() => {
              setScope('global');
              clearSelection();
            }}
          />
        </View>
        <TextField value={query} onChange={setQuery} placeholder="Search…" style={{ flex: 1 }} />
      </View>

      <View style={styles.folderBar}>
        <View style={styles.folderChips}>
          <FolderChip label="All" active={folderFilter === 'all'} onPress={() => setFolderFilter('all')} />
          <FolderChip label="Unfiled" active={folderFilter === 'unfiled'} onPress={() => setFolderFilter('unfiled')} />
          {breadcrumb.map((b, i) => (
            <React.Fragment key={b.path}>
              <Text style={styles.crumbSep}>/</Text>
              <FolderChip
                label={b.label}
                active={folderFilter === b.path && i === breadcrumb.length - 1}
                onPress={() => setFolderFilter(b.path)}
                onLongPress={() => {
                  setRenamingFolder(b.path);
                  setRenameValue(folderLeaf(b.path));
                }}
              />
            </React.Fragment>
          ))}
          {visibleChildFolders.map((f) => (
            <FolderChip
              key={f}
              label={folderLeaf(f)}
              active={folderFilter === f}
              onPress={() => setFolderFilter(f)}
              onLongPress={() => {
                setRenamingFolder(f);
                setRenameValue(folderLeaf(f));
              }}
            />
          ))}
          <Button
            icon="+"
            label={currentFolderPath ? 'Subfolder' : 'Folder'}
            small
            onPress={openCreateFolder}
            title={currentFolderPath ? `Create a subfolder inside ${currentFolderPath}` : 'Create a top-level folder (e.g. units, arms)'}
          />
        </View>
      </View>

      {creatingFolder ? (
        <View style={styles.folderEdit}>
          <TextField
            value={newFolderName}
            onChange={setNewFolderName}
            placeholder={currentFolderPath ? `name inside ${currentFolderPath}` : 'e.g. units, snowman, arms'}
            style={{ flex: 1 }}
            autoFocus
          />
          <Button label="Create" small primary onPress={submitNewFolder} />
          <Button label="Cancel" small onPress={() => { setCreatingFolder(false); setNewFolderName(''); }} />
        </View>
      ) : null}

      {renamingFolder ? (
        <View style={styles.folderEdit}>
          <TextField value={renameValue} onChange={setRenameValue} style={{ flex: 1 }} autoFocus />
          <Button label="Save" small primary onPress={submitRenameFolder} />
          <Button label="Cancel" small onPress={() => setRenamingFolder(null)} />
        </View>
      ) : null}

      {currentFolderPath && !creatingFolder && !renamingFolder ? (
        <View style={styles.folderActions}>
          <Button
            label="Rename"
            small
            onPress={() => {
              setRenamingFolder(currentFolderPath);
              setRenameValue(folderLeaf(currentFolderPath));
            }}
          />
          <DropdownSelect
            label="Move"
            value="__pick__"
            options={folderRelocateOptions}
            onChange={moveCurrentFolderTo}
            placeholder="Move to…"
            minWidth={140}
          />
          <Button label="Delete" small danger onPress={() => setConfirmDeleteFolder(true)} title="Remove folder — assets are kept" />
        </View>
      ) : null}

      {filtered.length > 0 ? (
        <View style={styles.selectBar}>
          <Button label="Select all" small onPress={selectAllVisible} title="Select every asset in the current view" />
          <Button label="Clear" small disabled={selectedIds.length === 0} onPress={clearSelection} />
          <Text style={styles.selectCount}>{selectedIds.length > 0 ? `${selectedIds.length} selected` : 'Tap the circle to multi-select'}</Text>
        </View>
      ) : null}

      <View style={styles.gridContent}>
        {filtered.length === 0 ? (
          <Text style={styles.empty}>
            {assets.length === 0
              ? 'No sprites yet. Import transparent PNGs to begin.'
              : folderFilter !== 'all'
                ? 'No sprites in this folder.'
                : 'No matches.'}
          </Text>
        ) : (
          filtered.map((a) => {
            const assetFolder = normalizeAssetFolder(a.folder ?? '');
            const inFolderView = folderFilter !== 'all' && folderFilter !== 'unfiled';
            // Show × whenever selected and the asset is filed, or whenever we're inside a folder view.
            const showUnfile = selectedSet.has(a.id) && (!!assetFolder || inFolderView);
            return (
              <AssetTile
                key={a.id}
                asset={a}
                checked={selectedSet.has(a.id)}
                usage={usage(a.id)}
                showFolder={folderFilter === 'all'}
                showUnfile={showUnfile}
                onToggleCheck={() => toggleSelected(a.id)}
                onSelect={() => {
                  // Keep multi-select when already selecting; otherwise focus one for details.
                  if (selectedIds.length > 0) toggleSelected(a.id);
                  else selectOnly(a.id);
                }}
                onUnfile={() => {
                  // Never deletes the asset — only clears its folder (back to Unfiled).
                  if (scope === 'project') setAssetFolder(a.id, '');
                  else {
                    useProjectStore.getState().setGlobalAssets(
                      useProjectStore.getState().globalAssets.map((x) =>
                        x.id === a.id ? { ...x, folder: '', updatedAt: Date.now() } : x,
                      ),
                    );
                  }
                  setSelectedIds((prev) => prev.filter((id) => id !== a.id));
                  setStatus(`Removed "${a.name}" from folder (still in library)`, 'success');
                }}
                onOpen={() => openSpriteEditor(a.id)}
                onDrop={(world) => {
                  placeInstance(a, world);
                  setStatus(`Placed "${a.name}"`, 'success');
                }}
              />
            );
          })
        )}
      </View>
      {selectedIds.length > 1 ? (
        <View style={styles.details}>
          <Text style={styles.bulkTitle}>{selectedIds.length} assets selected</Text>
          <DropdownSelect
            label="Folder"
            value={
              selectedAssets.every((a) => normalizeAssetFolder(a.folder ?? '') === normalizeAssetFolder(selectedAssets[0]?.folder ?? ''))
                ? normalizeAssetFolder(selectedAssets[0]?.folder ?? '')
                : ('__mixed__' as string)
            }
            options={folderMoveOptions}
            onChange={moveSelectedToFolder}
            placeholder="Mixed folders…"
          />
          <View style={styles.actionRow}>
            <Button label="Clear selection" small onPress={clearSelection} />
            <Button label="Delete" small danger onPress={() => setConfirmDelete(true)} />
          </View>
        </View>
      ) : selectedAsset ? (
        <View style={styles.details}>
          <TextField value={selectedAsset.name} onChange={(v) => (scope === 'project' ? renameAsset(selectedAsset.id, v) : renameGlobal(selectedAsset.id, v))} />
          <Text style={styles.meta}>
            {selectedAsset.width}×{selectedAsset.height}px · pivot {Math.round(selectedAsset.pivot.x)},{Math.round(selectedAsset.pivot.y)} ·{' '}
            {selectedAsset.attachments.length} attachment{selectedAsset.attachments.length === 1 ? '' : 's'} · used {usage(selectedAsset.id)}× on stage
          </Text>
          <DropdownSelect
            label="Folder"
            value={normalizeAssetFolder(selectedAsset.folder ?? '')}
            options={folderMoveOptions}
            onChange={moveSelectedToFolder}
          />
          <View style={styles.actionRow}>
            <Button label="Place" small primary onPress={() => placeInstance(selectedAsset, canvasCentreWorld())} />
            <Button label="Edit sprite" small onPress={() => openSpriteEditor(selectedAsset.id)} />
            <Button label={scope === 'project' ? '→ Global' : '→ Project'} small onPress={() => copyToScope(selectedAsset, scope === 'project' ? 'global' : 'project')} />
            <Button label="Delete" small danger onPress={() => setConfirmDelete(true)} />
          </View>
        </View>
      ) : null}

      <ConfirmDialog
        visible={confirmDelete && selectedIds.length > 0}
        title={selectedIds.length > 1 ? 'Delete assets?' : 'Delete asset?'}
        message={
          selectedIds.length > 1
            ? `Delete ${selectedIds.length} selected assets from the ${scope} library? Sprites using them on the stage will be removed too. This cannot be undone.`
            : `Delete “${selectedAsset?.name ?? 'this asset'}” from the ${scope} library? Any stage sprites using it will be removed too. This cannot be undone.`
        }
        confirmLabel={selectedIds.length > 1 ? `Delete ${selectedIds.length}` : 'Delete'}
        danger
        onConfirm={removeSelectedAssets}
        onCancel={() => setConfirmDelete(false)}
      />

      <ConfirmDialog
        visible={confirmDeleteFolder && !!currentFolderPath}
        title="Delete folder?"
        message={`Remove folder “${currentFolderPath}”? Assets and subfolders inside are kept — they move up to the parent (or top level).`}
        confirmLabel="Delete folder"
        danger
        onConfirm={() => currentFolderPath && removeFolder(currentFolderPath)}
        onCancel={() => setConfirmDeleteFolder(false)}
      />
    </Panel>
  );
}

function FolderChip({
  label,
  active,
  onPress,
  onLongPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={400} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function renameGlobal(id: string, name: string) {
  const st = useProjectStore.getState();
  st.setGlobalAssets(st.globalAssets.map((a) => (a.id === id ? { ...a, name } : a)));
}

function AssetTile({
  asset,
  checked,
  usage,
  showFolder,
  showUnfile,
  onToggleCheck,
  onSelect,
  onUnfile,
  onOpen,
  onDrop,
}: {
  asset: SpriteAsset;
  checked: boolean;
  usage: number;
  showFolder: boolean;
  showUnfile: boolean;
  onToggleCheck: () => void;
  onSelect: () => void;
  onUnfile: () => void;
  onOpen: () => void;
  onDrop: (world: { x: number; y: number }) => void;
}) {
  const blob = blobStore.get(asset.imagePath);
  const lastTap = React.useRef(0);
  const setDrag = useEditorStore((s) => s.setDragAsset);
  const folder = normalizeAssetFolder(asset.folder ?? '');
  const pan = usePanGesture({
    runOnJS: true,
    minDistance: 6,
    activeCursor: 'grabbing',
    // Do not change selection on drag — that was wiping multi-select.
    onActivate: (e) => setDrag({ assetId: asset.id, x: e.absoluteX, y: e.absoluteY }),
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
    // Controls sit outside GestureDetector so checkbox / unfile taps are not stolen by pan.
    <View style={[styles.tile, checked && styles.tileSelected]} collapsable={false}>
      <Pressable
        onPress={onToggleCheck}
        hitSlop={6}
        style={[styles.roundCheck, checked && styles.roundCheckOn]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={`Select ${asset.name}`}
      >
        {checked ? <View style={styles.roundCheckDot} /> : null}
      </Pressable>
      {showUnfile ? (
        <Pressable
          onPress={onUnfile}
          hitSlop={8}
          style={styles.unfileBtn}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${asset.name} from folder (does not delete)`}
        >
          <Text style={styles.unfileX}>×</Text>
        </Pressable>
      ) : null}
      <GestureDetector gesture={pan}>
        <Pressable
          onPress={() => {
            const now = Date.now();
            if (now - lastTap.current < 350) onOpen();
            lastTap.current = now;
            onSelect();
          }}
          style={styles.tileBody}
        >
          <View style={styles.thumb}>
            <Checker />
            {blob ? <Image source={{ uri: blob.uri }} style={styles.thumbImg} resizeMode="contain" /> : <Text style={styles.missing}>missing</Text>}
            {usage > 0 ? (
              <Text style={styles.badge} accessibilityLabel={`Used ${usage} time${usage === 1 ? '' : 's'} on the stage`}>
                {usage}
              </Text>
            ) : null}
          </View>
          <Text style={styles.name} numberOfLines={1}>
            {asset.name}
          </Text>
          {showFolder && folder ? (
            <Text style={styles.folderTag} numberOfLines={1}>
              {folder}
            </Text>
          ) : (
            <Text style={styles.dims}>
              {asset.width}×{asset.height}
            </Text>
          )}
        </Pressable>
      </GestureDetector>
    </View>
  );
}

/** Lightweight CSS-free checkerboard made of two offset stripes. */
export function Checker() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.checkerB }]} />
      {[0, 1, 2, 3, 4, 5].map((r) =>
        [0, 1, 2, 3, 4, 5].map((c) =>
          (r + c) % 2 === 0 ? (
            <View
              key={`${r}-${c}`}
              style={{ position: 'absolute', left: `${c * 16.666}%`, top: `${r * 16.666}%`, width: '16.7%', height: '16.7%', backgroundColor: colors.checkerA }}
            />
          ) : null,
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  scopeRow: { flexDirection: 'row', gap: 2 },
  folderBar: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg1,
  },
  folderChips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  crumbSep: { color: colors.textDim, fontSize: font.xs, paddingHorizontal: 2 },
  chip: {
    paddingHorizontal: 8,
    height: 22,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg0,
    justifyContent: 'center',
    maxWidth: 140,
  },
  chipActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  chipText: { color: colors.textMuted, fontSize: font.xs },
  chipTextActive: { color: colors.text, fontWeight: '600' },
  folderEdit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg2,
  },
  folderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg1,
  },
  selectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  selectCount: { color: colors.textDim, fontSize: font.xs, flex: 1 },
  gridContent: { flexDirection: 'row', flexWrap: 'wrap', padding: spacing.sm, gap: spacing.sm },
  empty: { color: colors.textDim, fontSize: font.sm, padding: spacing.md },
  tile: { width: 84, borderRadius: 3, borderWidth: 1, borderColor: 'transparent', padding: 3, alignItems: 'center', position: 'relative' },
  tileSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  tileBody: { alignItems: 'center', width: '100%' },
  roundCheck: {
    position: 'absolute',
    left: 4,
    top: 4,
    zIndex: 3,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundCheckOn: { borderColor: colors.accent, backgroundColor: colors.accent },
  roundCheckDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  unfileBtn: {
    position: 'absolute',
    right: 2,
    top: 2,
    zIndex: 5,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
  },
  unfileX: { color: '#fff', fontSize: 14, lineHeight: 16, fontWeight: '700', marginTop: -1 },
  thumb: { width: 76, height: 64, overflow: 'hidden', borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  thumbImg: { width: 76, height: 64 },
  missing: { color: colors.danger, fontSize: font.xs },
  badge: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    zIndex: 2,
    backgroundColor: colors.accent,
    color: '#fff',
    fontSize: 9,
    paddingHorizontal: 4,
    borderRadius: 6,
    overflow: 'hidden',
  },
  name: { color: colors.text, fontSize: font.sm, marginTop: 2, maxWidth: 76 },
  dims: { color: colors.textDim, fontSize: font.xs },
  folderTag: { color: colors.textMuted, fontSize: 9, maxWidth: 76 },
  details: { borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.sm, gap: spacing.sm, backgroundColor: colors.bg2 },
  bulkTitle: { color: colors.text, fontSize: font.sm, fontWeight: '600' },
  meta: { color: colors.textMuted, fontSize: font.xs },
  actionRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
});
