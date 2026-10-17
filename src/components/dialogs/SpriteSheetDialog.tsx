import React, { useEffect, useMemo, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { normalizeAssetFolder } from '@/engine/commands';
import {
  defaultSheetOptions,
  encodeRgbaPng,
  extractGridCells,
  importExtractedCells,
  loadDecodedSheet,
  partLetter,
  type DecodedSheet,
  type ExtractedCell,
  type SheetExtractOptions,
} from '@/importers/spriteSheet';
import type { PickedFile } from '@/importers/pickFiles';
import { bytesToBase64 } from '@/utils/base64';
import { useEditorStore } from '@/state/editorStore';
import { useProjectStore } from '@/state/projectStore';
import { colors, font, spacing } from '@/theme/tokens';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Checkbox, CollapsibleSection, DropdownSelect, NumberField, Row, TextField } from '../ui/Fields';
import { Checker } from '../assets/AssetLibraryPanel';

/** Module-held pending file so Asset Library can open the dialog after picking. */
let pendingSheetFile: PickedFile | null = null;

export function setPendingSpriteSheet(file: PickedFile | null) {
  pendingSheetFile = file;
}

function bytesToImageUri(bytes: Uint8Array): string {
  if (Platform.OS === 'web') return URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
  return `data:image/png;base64,${bytesToBase64(bytes)}`;
}

function revokeImageUri(uri: string | null) {
  if (uri && Platform.OS === 'web' && uri.startsWith('blob:')) URL.revokeObjectURL(uri);
}

function displayCellName(prefix: string, cell: ExtractedCell): string {
  const base = `${prefix}_${String(cell.index + 1).padStart(2, '0')}_r${cell.row}c${cell.column}`;
  return cell.partCount > 1 ? `${base}_${partLetter(cell.partIndex)}` : base;
}

function displayCellFolder(assigned: string, cell: ExtractedCell): string {
  const base = normalizeAssetFolder(assigned);
  if (cell.partCount <= 1) return base || 'Unfiled';
  const group = `r${cell.row}c${cell.column}`;
  return base ? `${base}/${group}` : group;
}

export function SpriteSheetDialog({ onClose }: { onClose: () => void }) {
  const setStatus = useEditorStore((s) => s.setStatus);
  const projectFolders = useProjectStore((s) => s.project.settings.assetFolders ?? []);
  const projectAssets = useProjectStore((s) => s.project.assets);
  const [sheet] = useState<DecodedSheet | null>(() => {
    if (!pendingSheetFile) return null;
    const decoded = loadDecodedSheet(pendingSheetFile);
    pendingSheetFile = null;
    return decoded;
  });
  const [opts, setOpts] = useState<SheetExtractOptions>(defaultSheetOptions);
  const [namePrefix, setNamePrefix] = useState(sheet?.baseName ?? 'sprite');
  /** Per extracted-cell folder, keyed by cell.index. */
  const [folderByCellIndex, setFolderByCellIndex] = useState<Record<number, string>>({});
  const [previewIndex, setPreviewIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  const folderOptions = useMemo(() => {
    const set = new Set<string>();
    for (const f of projectFolders) {
      const n = normalizeAssetFolder(f);
      if (n) set.add(n);
    }
    for (const a of projectAssets) {
      const n = normalizeAssetFolder(a.folder ?? '');
      if (n) set.add(n);
    }
    for (const f of Object.values(folderByCellIndex)) {
      const n = normalizeAssetFolder(f);
      if (n) set.add(n);
    }
    const list = [{ value: '', label: 'Unfiled', depth: 0 }];
    for (const f of [...set].sort((a, b) => a.localeCompare(b))) {
      list.push({ value: f, label: f, depth: f.split('/').length - 1 });
    }
    return list;
  }, [projectFolders, projectAssets, folderByCellIndex]);

  const sheetUri = useMemo(() => (sheet ? bytesToImageUri(sheet.sourceBytes) : null), [sheet]);

  const extraction = useMemo(() => {
    if (!sheet) return null;
    return extractGridCells(sheet.pixels, sheet.width, sheet.height, opts);
  }, [sheet, opts]);

  const nonEmptyCells = useMemo(() => extraction?.cells.filter((c) => !c.empty) ?? [], [extraction]);

  useEffect(() => {
    if (previewIndex >= nonEmptyCells.length) setPreviewIndex(Math.max(0, nonEmptyCells.length - 1));
  }, [nonEmptyCells.length, previewIndex]);

  const activeCell = nonEmptyCells[previewIndex] ?? null;
  const activeFolder = activeCell ? normalizeAssetFolder(folderByCellIndex[activeCell.index] ?? '') : '';

  const previewUri = useMemo(() => {
    if (!activeCell) return null;
    const png = encodeRgbaPng(activeCell.pixels, activeCell.width, activeCell.height);
    if (!png) return null;
    return bytesToImageUri(png);
  }, [activeCell]);

  useEffect(() => () => revokeImageUri(sheetUri), [sheetUri]);
  useEffect(() => () => revokeImageUri(previewUri), [previewUri]);

  if (!sheet) {
    return (
      <Dialog visible title="Extract sprite sheet" onClose={onClose} width={420}>
        <Text style={styles.hint}>Could not decode the PNG. Pick another file.</Text>
      </Dialog>
    );
  }

  const patch = (p: Partial<SheetExtractOptions>) => setOpts((o) => ({ ...o, ...p }));
  const patchInset = (key: keyof SheetExtractOptions['insets'], v: number) =>
    setOpts((o) => ({ ...o, insets: { ...o.insets, [key]: Math.max(0, Math.round(v)) } }));

  const setActiveFolder = (folder: string) => {
    if (!activeCell) return;
    const f = normalizeAssetFolder(folder);
    setFolderByCellIndex((prev) => ({ ...prev, [activeCell.index]: f }));
  };

  const applyFolderToAll = () => {
    if (!activeCell) return;
    const f = normalizeAssetFolder(folderByCellIndex[activeCell.index] ?? '');
    const next: Record<number, string> = {};
    for (const c of nonEmptyCells) next[c.index] = f;
    setFolderByCellIndex(next);
    setStatus(f ? `Folder “${f}” applied to all ${nonEmptyCells.length} sprites` : `All ${nonEmptyCells.length} sprites set to Unfiled`, 'info');
  };

  const bg = extraction?.background;
  const prefix = namePrefix.trim() || sheet.baseName;

  const onExtract = () => {
    setBusy(true);
    try {
      const named = { ...sheet, baseName: prefix };
      const result = importExtractedCells(named, opts, { folderByCellIndex });
      const skipped = result.skippedEmpty ? ` (${result.skippedEmpty} empty skipped)` : '';
      setStatus(`Extracted ${result.assets.length} sprite${result.assets.length === 1 ? '' : 's'}${skipped}`, 'success');
      onClose();
    } catch (e) {
      setStatus(`Sheet extract failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const previewW = Math.min(360, sheet.width);
  const scale = previewW / sheet.width;
  const previewH = sheet.height * scale;

  return (
    <Dialog
      visible
      title="Extract sprite sheet"
      onClose={onClose}
      width={900}
      height={680}
      resizable
      noScroll
      footer={
        <>
          <Button label="Cancel" onPress={onClose} />
          <Button
            label={busy ? 'Extracting…' : `Extract ${nonEmptyCells.length} sprite${nonEmptyCells.length === 1 ? '' : 's'}`}
            primary
            disabled={busy || nonEmptyCells.length === 0}
            onPress={onExtract}
          />
        </>
      }
    >
      <View style={styles.root}>
        <ScrollView style={styles.previewCol} contentContainerStyle={styles.previewInner} keyboardShouldPersistTaps="handled">
          <Text style={styles.caption}>
            Sheet {sheet.width}×{sheet.height} · {opts.columns}×{opts.rows} grid
          </Text>
          <View style={[styles.sheetBox, { width: previewW, height: previewH }]}>
            {sheetUri ? <Image source={{ uri: sheetUri }} style={{ width: previewW, height: previewH }} resizeMode="stretch" /> : null}
            {Array.from({ length: opts.columns * opts.rows }, (_, i) => {
              const col = i % opts.columns;
              const row = Math.floor(i / opts.columns);
              const cellW = previewW / opts.columns;
              const cellH = previewH / opts.rows;
              const nonEmptyIdx = nonEmptyCells.findIndex((c) => c.column === col && c.row === row);
              const selected = nonEmptyIdx === previewIndex;
              return (
                <Pressable
                  key={i}
                  onPress={() => {
                    if (nonEmptyIdx >= 0) setPreviewIndex(nonEmptyIdx);
                  }}
                  style={[
                    styles.gridCell,
                    {
                      left: col * cellW,
                      top: row * cellH,
                      width: cellW,
                      height: cellH,
                    },
                    selected && styles.gridCellSelected,
                  ]}
                />
              );
            })}
          </View>

          <View style={styles.selectedRow}>
            <View style={styles.selectedPreview}>
              <Text style={styles.caption}>
                {opts.splitParts ? 'Selected part (after chroma + split)' : 'Selected cell (after chroma + trim)'}
              </Text>
              <View style={styles.cellPreview}>
                <Checker />
                {previewUri ? <Image source={{ uri: previewUri }} style={styles.cellImg} resizeMode="contain" /> : <Text style={styles.hint}>No opaque content</Text>}
              </View>
              {nonEmptyCells.length > 0 ? (
                <Row>
                  <Button label="◀" small disabled={previewIndex <= 0} onPress={() => setPreviewIndex((i) => Math.max(0, i - 1))} />
                  <Text style={styles.caption}>
                    {previewIndex + 1} / {nonEmptyCells.length}
                    {activeCell
                      ? ` · r${activeCell.row}c${activeCell.column}${activeCell.partCount > 1 ? ` · ${partLetter(activeCell.partIndex)}/${activeCell.partCount}` : ''}`
                      : ''}
                  </Text>
                  <Button
                    label="▶"
                    small
                    disabled={previewIndex >= nonEmptyCells.length - 1}
                    onPress={() => setPreviewIndex((i) => Math.min(nonEmptyCells.length - 1, i + 1))}
                  />
                </Row>
              ) : null}
            </View>

            <View style={styles.folderBeside}>
              <Text style={styles.folderTitle}>Folder for this sprite</Text>
              <Text style={styles.caption} numberOfLines={1}>
                {activeCell ? displayCellName(prefix, activeCell) : '—'}
              </Text>
              <Text style={styles.hint}>
                Library folder for the sprite shown on the left
                {activeCell && activeCell.partCount > 1 ? ' (shared by all parts of this cell; nested under rNcM)' : ''}.
              </Text>
              <DropdownSelect
                label="Folder"
                value={activeFolder}
                options={folderOptions}
                onChange={setActiveFolder}
                placeholder="Unfiled"
                placement="up"
                minWidth={180}
              />
              <TextField
                label="Path"
                value={activeFolder}
                onChange={(v) => activeCell && setActiveFolder(v)}
                placeholder="e.g. Water Faction/Frost Snowman/000"
              />
              <Text style={styles.caption} numberOfLines={1}>
                → {activeCell ? displayCellFolder(activeFolder, activeCell) : 'Unfiled'}
              </Text>
              <Button label="Apply this folder to all sprites" small onPress={applyFolderToAll} disabled={!activeCell} />
            </View>
          </View>
        </ScrollView>

        <ScrollView style={styles.controls} contentContainerStyle={styles.controlsInner} keyboardShouldPersistTaps="handled">
          <CollapsibleSection title="Grid">
            <NumberField label="Columns" value={opts.columns} min={1} max={64} precision={0} onChange={(v) => patch({ columns: Math.max(1, Math.round(v)) })} width={90} />
            <NumberField label="Rows" value={opts.rows} min={1} max={64} precision={0} onChange={(v) => patch({ rows: Math.max(1, Math.round(v)) })} width={90} />
            <TextField label="Name prefix" value={namePrefix} onChange={setNamePrefix} />
          </CollapsibleSection>

          <CollapsibleSection title="Assignments">
            <ScrollView style={styles.assignList} contentContainerStyle={styles.assignListInner} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              {nonEmptyCells.length === 0 ? <Text style={[styles.hint, { padding: 8 }]}>No opaque cells yet.</Text> : null}
              {nonEmptyCells.map((c, i) => {
                const folder = displayCellFolder(folderByCellIndex[c.index] ?? '', c);
                const sel = i === previewIndex;
                return (
                  <Pressable
                    key={`${c.index}-${c.partIndex}`}
                    onPress={() => setPreviewIndex(i)}
                    style={[styles.assignRow, sel && styles.assignRowSel]}
                  >
                    <Text style={styles.assignName} numberOfLines={1}>
                      {displayCellName(prefix, c)}
                    </Text>
                    <Text style={styles.assignFolder} numberOfLines={1}>
                      {folder}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </CollapsibleSection>

          <CollapsibleSection title="Background" defaultCollapsed>
            <Text style={styles.hint}>Sampled from the four corners. Raise tolerance if fringes remain.</Text>
            <View style={styles.swatchRow}>
              <View style={[styles.swatch, bg ? { backgroundColor: `rgb(${bg.r},${bg.g},${bg.b})` } : null]} />
              <Text style={styles.caption}>{bg ? `rgb(${bg.r}, ${bg.g}, ${bg.b})` : '—'}</Text>
            </View>
            <NumberField label="Tolerance" value={opts.tolerance} min={0} max={200} precision={0} onChange={(v) => patch({ tolerance: Math.max(0, Math.round(v)) })} width={90} />
          </CollapsibleSection>

          <CollapsibleSection title="Crop" defaultCollapsed>
            <Checkbox label="Trim empty margins" value={opts.trim} onChange={(v) => patch({ trim: v })} />
            <NumberField label="Trim padding" value={opts.trimPadding} min={0} max={64} precision={0} disabled={!opts.trim} onChange={(v) => patch({ trimPadding: Math.max(0, Math.round(v)) })} width={90} />
            <Checkbox
              label="Split disconnected parts"
              value={opts.splitParts}
              onChange={(v) => patch({ splitParts: v })}
            />
            <Text style={styles.hint}>
              Separates arms/wings/etc. inside a cell into their own sprites, named _a/_b and nested under rNcM so the pair stays grouped.
              Tiny fringe/shadow blobs are dropped unless they are close in size to the largest part.
            </Text>
            <NumberField
              label="Min part pixels"
              value={opts.minPartPixels}
              min={1}
              max={100000}
              precision={0}
              disabled={!opts.splitParts}
              onChange={(v) => patch({ minPartPixels: Math.max(1, Math.round(v)) })}
              width={90}
            />
            <NumberField
              label="Min size % of largest"
              value={Math.round(opts.minPartRatio * 100)}
              min={0}
              max={100}
              precision={0}
              disabled={!opts.splitParts}
              onChange={(v) => patch({ minPartRatio: Math.max(0, Math.min(100, Math.round(v))) / 100 })}
              width={90}
            />
            <NumberField label="Inset L" value={opts.insets.left} min={0} precision={0} onChange={(v) => patchInset('left', v)} width={80} />
            <NumberField label="Inset R" value={opts.insets.right} min={0} precision={0} onChange={(v) => patchInset('right', v)} width={80} />
            <NumberField label="Inset T" value={opts.insets.top} min={0} precision={0} onChange={(v) => patchInset('top', v)} width={80} />
            <NumberField label="Inset B" value={opts.insets.bottom} min={0} precision={0} onChange={(v) => patchInset('bottom', v)} width={80} />
          </CollapsibleSection>
        </ScrollView>
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 0,
    minWidth: 0,
    padding: spacing.lg,
    overflow: 'hidden',
  },
  previewCol: { flex: 1, minWidth: 0, minHeight: 0 },
  previewInner: { gap: spacing.sm, paddingBottom: spacing.lg },
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.lg,
    flexWrap: 'wrap',
  },
  selectedPreview: { gap: spacing.sm, flexShrink: 0 },
  folderBeside: {
    flex: 1,
    minWidth: 200,
    maxWidth: 320,
    gap: spacing.sm,
    paddingTop: 2,
  },
  folderTitle: {
    color: colors.textDim,
    fontSize: font.xs,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  controls: {
    width: 300,
    maxWidth: '42%',
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 220,
    minHeight: 0,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    paddingLeft: spacing.md,
  },
  controlsInner: { gap: spacing.xs, paddingBottom: spacing.xl },
  caption: { color: colors.textMuted, fontSize: font.xs },
  hint: { color: colors.textDim, fontSize: font.xs, lineHeight: 16 },
  sheetBox: { position: 'relative', backgroundColor: colors.bg0, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', alignSelf: 'flex-start' },
  gridCell: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(80,180,255,0.45)' },
  gridCellSelected: { borderColor: colors.accent, borderWidth: 2, backgroundColor: 'rgba(80,180,255,0.12)' },
  cellPreview: {
    width: 140,
    height: 140,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  cellImg: { width: 140, height: 140 },
  assignList: {
    height: 180,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 3,
    backgroundColor: colors.bg0,
  },
  assignListInner: { flexGrow: 1 },
  assignRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, height: 24, borderBottomWidth: 1, borderBottomColor: colors.border },
  assignRowSel: { backgroundColor: colors.accentSoft },
  assignName: { color: colors.text, fontSize: font.xs, flex: 1, fontFamily: font.mono },
  assignFolder: { color: colors.textMuted, fontSize: font.xs, maxWidth: 120 },
  swatchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  swatch: { width: 28, height: 28, borderRadius: 3, borderWidth: 1, borderColor: colors.borderStrong },
});
