import React, { useEffect, useMemo, useState } from 'react';
import { Image, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { normalizeAssetFolder } from '@/engine/commands';
import {
  defaultSheetOptions,
  encodeRgbaPng,
  extractGridCells,
  importExtractedCells,
  loadDecodedSheet,
  type DecodedSheet,
  type SheetExtractOptions,
} from '@/importers/spriteSheet';
import type { PickedFile } from '@/importers/pickFiles';
import { bytesToBase64 } from '@/utils/base64';
import { useEditorStore } from '@/state/editorStore';
import { useProjectStore } from '@/state/projectStore';
import { colors, font, spacing } from '@/theme/tokens';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Checkbox, DropdownSelect, NumberField, Row, SectionTitle, TextField } from '../ui/Fields';
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
  const [importFolder, setImportFolder] = useState('');
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
    const opts = [{ value: '', label: 'Unfiled', depth: 0 }];
    for (const f of [...set].sort((a, b) => a.localeCompare(b))) {
      opts.push({ value: f, label: f, depth: f.split('/').length - 1 });
    }
    return opts;
  }, [projectFolders, projectAssets]);

  const sheetUri = useMemo(() => (sheet ? bytesToImageUri(sheet.sourceBytes) : null), [sheet]);

  const extraction = useMemo(() => {
    if (!sheet) return null;
    return extractGridCells(sheet.pixels, sheet.width, sheet.height, opts);
  }, [sheet, opts]);

  const previewUri = useMemo(() => {
    if (!extraction || !sheet) return null;
    const cells = extraction.cells.filter((c) => !c.empty);
    if (cells.length === 0) return null;
    const cell = cells[Math.min(previewIndex, cells.length - 1)]!;
    const png = encodeRgbaPng(cell.pixels, cell.width, cell.height);
    if (!png) return null;
    return bytesToImageUri(png);
  }, [extraction, sheet, previewIndex]);

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

  const nonEmpty = extraction?.cells.filter((c) => !c.empty).length ?? 0;
  const bg = extraction?.background;

  const onExtract = () => {
    setBusy(true);
    try {
      const named = { ...sheet, baseName: namePrefix.trim() || sheet.baseName };
      const folder = normalizeAssetFolder(importFolder);
      const result = importExtractedCells(named, opts, { folder });
      const skipped = result.skippedEmpty ? ` (${result.skippedEmpty} empty skipped)` : '';
      const where = folder ? ` → ${folder}` : '';
      setStatus(`Extracted ${result.assets.length} sprite${result.assets.length === 1 ? '' : 's'}${skipped}${where}`, 'success');
      onClose();
    } catch (e) {
      setStatus(`Sheet extract failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const previewW = Math.min(420, sheet.width);
  const scale = previewW / sheet.width;
  const previewH = sheet.height * scale;

  return (
    <Dialog
      visible
      title="Extract sprite sheet"
      onClose={onClose}
      width={760}
      height={640}
      noScroll
      footer={
        <>
          <Button label="Cancel" onPress={onClose} />
          <Button
            label={busy ? 'Extracting…' : `Extract ${nonEmpty} sprite${nonEmpty === 1 ? '' : 's'}`}
            primary
            disabled={busy || nonEmpty === 0}
            onPress={onExtract}
          />
        </>
      }
    >
      <View style={styles.root}>
        <View style={styles.previewCol}>
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
              return (
                <View
                  key={i}
                  pointerEvents="none"
                  style={[
                    styles.gridCell,
                    {
                      left: col * cellW,
                      top: row * cellH,
                      width: cellW,
                      height: cellH,
                    },
                  ]}
                />
              );
            })}
          </View>
          <Text style={styles.caption}>Cell preview (after chroma + trim)</Text>
          <View style={styles.cellPreview}>
            <Checker />
            {previewUri ? <Image source={{ uri: previewUri }} style={styles.cellImg} resizeMode="contain" /> : <Text style={styles.hint}>No opaque content</Text>}
          </View>
          {nonEmpty > 1 ? (
            <Row>
              <Button label="◀" small disabled={previewIndex <= 0} onPress={() => setPreviewIndex((i) => Math.max(0, i - 1))} />
              <Text style={styles.caption}>
                {Math.min(previewIndex + 1, nonEmpty)} / {nonEmpty}
              </Text>
              <Button label="▶" small disabled={previewIndex >= nonEmpty - 1} onPress={() => setPreviewIndex((i) => Math.min(nonEmpty - 1, i + 1))} />
            </Row>
          ) : null}
        </View>

        <ScrollView style={styles.controls} contentContainerStyle={styles.controlsInner} keyboardShouldPersistTaps="handled">
          <SectionTitle>Grid</SectionTitle>
          <NumberField label="Columns" value={opts.columns} min={1} max={64} precision={0} onChange={(v) => patch({ columns: Math.max(1, Math.round(v)) })} width={90} />
          <NumberField label="Rows" value={opts.rows} min={1} max={64} precision={0} onChange={(v) => patch({ rows: Math.max(1, Math.round(v)) })} width={90} />
          <TextField label="Name prefix" value={namePrefix} onChange={setNamePrefix} />

          <SectionTitle>Library folder</SectionTitle>
          <Text style={styles.hint}>All extracted sprites go into this folder (or Unfiled). Pick an existing path or type a new one.</Text>
          <DropdownSelect
            label="Folder"
            value={normalizeAssetFolder(importFolder)}
            options={folderOptions}
            onChange={setImportFolder}
            placeholder="Unfiled"
            placement="up"
          />
          <TextField
            label="Path"
            value={importFolder}
            onChange={setImportFolder}
            placeholder="e.g. Water Faction/Frost Snowman/000"
          />

          <SectionTitle>Background</SectionTitle>
          <Text style={styles.hint}>Sampled from the four corners (black, navy, white, …). Raise tolerance if fringes remain.</Text>
          <View style={styles.swatchRow}>
            <View
              style={[
                styles.swatch,
                bg ? { backgroundColor: `rgb(${bg.r},${bg.g},${bg.b})` } : null,
              ]}
            />
            <Text style={styles.caption}>{bg ? `rgb(${bg.r}, ${bg.g}, ${bg.b})` : '—'}</Text>
          </View>
          <NumberField label="Tolerance" value={opts.tolerance} min={0} max={200} precision={0} onChange={(v) => patch({ tolerance: Math.max(0, Math.round(v)) })} width={90} />

          <SectionTitle>Crop</SectionTitle>
          <Checkbox label="Trim empty margins" value={opts.trim} onChange={(v) => patch({ trim: v })} />
          <NumberField label="Trim padding" value={opts.trimPadding} min={0} max={64} precision={0} disabled={!opts.trim} onChange={(v) => patch({ trimPadding: Math.max(0, Math.round(v)) })} width={90} />
          <Text style={styles.hint}>Insets shrink each cell (useful later if you want to cut label bands before extract). You can also crop labels in the Sprite editor after import.</Text>
          <NumberField label="Inset L" value={opts.insets.left} min={0} precision={0} onChange={(v) => patchInset('left', v)} width={80} />
          <NumberField label="Inset R" value={opts.insets.right} min={0} precision={0} onChange={(v) => patchInset('right', v)} width={80} />
          <NumberField label="Inset T" value={opts.insets.top} min={0} precision={0} onChange={(v) => patchInset('top', v)} width={80} />
          <NumberField label="Inset B" value={opts.insets.bottom} min={0} precision={0} onChange={(v) => patchInset('bottom', v)} width={80} />
        </ScrollView>
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', gap: spacing.md, minHeight: 0 },
  previewCol: { flex: 1, gap: spacing.sm, minWidth: 0 },
  controls: { width: 280, minHeight: 0 },
  controlsInner: { gap: spacing.sm, paddingBottom: spacing.lg },
  caption: { color: colors.textMuted, fontSize: font.xs },
  hint: { color: colors.textDim, fontSize: font.xs, lineHeight: 16 },
  sheetBox: { position: 'relative', backgroundColor: colors.bg0, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  gridCell: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(80,180,255,0.55)' },
  cellPreview: { width: 160, height: 160, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  cellImg: { width: 160, height: 160 },
  swatchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  swatch: { width: 28, height: 28, borderRadius: 3, borderWidth: 1, borderColor: colors.borderStrong },
});
