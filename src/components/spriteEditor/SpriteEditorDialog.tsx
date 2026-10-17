import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Canvas, Circle, Group, Image as SkiaImage, Line, Path, Rect, Skia } from '@shopify/react-native-skia';
import { GestureDetector, usePanGesture, useTapGesture, useSimultaneousGestures } from 'react-native-gesture-handler';
import type { AttachmentPoint, Vector2 } from '@elemental/asset-schema';
import { sharedImageRegistry, useImageRegistry } from '@elemental/animation-runtime';
import { addAttachment, duplicateAttachment, removeAttachment, setAssetOrbitHandle, setAssetPivot, updateAttachment } from '@/engine/commands';
import { useEditorStore } from '@/state/editorStore';
import { useProjectStore } from '@/state/projectStore';
import { colors, font, spacing } from '@/theme/tokens';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Checkbox, NumberField, Row, SectionTitle, TextField } from '../ui/Fields';

type DragTarget = { kind: 'pivot' } | { kind: 'orbit' } | { kind: 'attachment'; id: string } | { kind: 'attachmentRot'; id: string } | null;

const PIVOT_PRESETS: { label: string; fx: number; fy: number }[] = [
  { label: '↖', fx: 0, fy: 0 },
  { label: '↑', fx: 0.5, fy: 0 },
  { label: '↗', fx: 1, fy: 0 },
  { label: '←', fx: 0, fy: 0.5 },
  { label: '•', fx: 0.5, fy: 0.5 },
  { label: '→', fx: 1, fy: 0.5 },
  { label: '↙', fx: 0, fy: 1 },
  { label: '↓', fx: 0.5, fy: 1 },
  { label: '↘', fx: 1, fy: 1 },
];

/**
 * Sprite editor: edits the asset's pivot and attachment points in image pixel space on an
 * enlarged, checkerboarded view. Changes apply to every instance of the asset.
 */
export function SpriteEditorDialog() {
  const assetId = useEditorStore((s) => s.spriteEditorAssetId);
  const close = useEditorStore((s) => s.openSpriteEditor);
  const asset = useProjectStore((s) => s.project.assets.find((a) => a.id === assetId) ?? s.globalAssets.find((a) => a.id === assetId));
  const isGlobal = useProjectStore((s) => !s.project.assets.some((a) => a.id === assetId) && s.globalAssets.some((a) => a.id === assetId));
  const win = useWindowDimensions();
  if (!asset) return null;
  const dialogW = Math.min(980, win.width - 16);
  const dialogH = Math.min(720, win.height - 16);
  return (
    <Dialog visible title={`Sprite editor — ${asset.name}`} onClose={() => close(null)} width={dialogW} height={dialogH} noScroll>
      {isGlobal ? (
        <Text style={styles.warn}>This is a global library asset. Copy it to the project to edit pivot and attachments.</Text>
      ) : (
        <SpriteEditorBody key={asset.id} assetId={asset.id} width={dialogW} height={dialogH - 31} />
      )}
    </Dialog>
  );
}

function SpriteEditorBody({ assetId, width, height }: { assetId: string; width: number; height: number }) {
  const asset = useProjectStore((s) => s.project.assets.find((a) => a.id === assetId))!;
  const registry = useImageRegistry(sharedImageRegistry);
  const image = registry.get(asset.imagePath) ?? null;
  const [selectedAtt, setSelectedAtt] = useState<string | null>(asset.attachments[0]?.id ?? null);
  const [snapPixels, setSnapPixels] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const sideW = 300;
  const canvasW = Math.max(100, width - sideW);
  const canvasH = height;
  const [canvasSize, setCanvasSize] = useState({ width: canvasW, height: canvasH });
  const fitted = useRef(false);

  const fitView = (w: number, h: number) => {
    const pad = 40;
    const z = Math.max(0.1, Math.min((w - pad * 2) / asset.width, (h - pad * 2) / asset.height));
    setView({ zoom: z, panX: (w - asset.width * z) / 2, panY: (h - asset.height * z) / 2 });
  };
  const onCanvasLayout = (e: { nativeEvent: { layout: { width: number; height: number } } }) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setCanvasSize({ width: w, height: h });
    if (!fitted.current && w > 0 && h > 0) {
      fitted.current = true;
      fitView(w, h);
    }
  };

  const toImage = (sx: number, sy: number): Vector2 => ({ x: (sx - view.panX) / view.zoom, y: (sy - view.panY) / view.zoom });
  const toScreen = (p: Vector2) => ({ x: p.x * view.zoom + view.panX, y: p.y * view.zoom + view.panY });
  const snap = (p: Vector2): Vector2 => (snapPixels ? { x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2 } : p);

  const dragRef = useRef<{ target: DragTarget; mode: 'pan' | 'edit'; startPan: { x: number; y: number }; attStart?: AttachmentPoint } | null>(null);
  const containerRef = useRef<React.ComponentRef<typeof View>>(null);
  const hitTest = (sx: number, sy: number): DragTarget => {
    const r = 10;
    for (const att of [...asset.attachments].reverse()) {
      const s = toScreen(att.position);
      const rotHandle = { x: s.x + Math.cos((att.rotation * Math.PI) / 180) * 24, y: s.y + Math.sin((att.rotation * Math.PI) / 180) * 24 };
      if (Math.hypot(rotHandle.x - sx, rotHandle.y - sy) < 7 && att.id === selectedAtt) return { kind: 'attachmentRot', id: att.id };
      if (Math.hypot(s.x - sx, s.y - sy) < r) return { kind: 'attachment', id: att.id };
    }
    if (asset.orbitHandle) {
      const o = toScreen(asset.orbitHandle);
      if (Math.hypot(o.x - sx, o.y - sy) < r) return { kind: 'orbit' };
    }
    const p = toScreen(asset.pivot);
    if (Math.hypot(p.x - sx, p.y - sy) < r) return { kind: 'pivot' };
    return null;
  };

  const pan = usePanGesture({
    runOnJS: true,
    minDistance: 0,
    maxPointers: 1,
    onBegin: (e) => {
      const target = hitTest(e.x, e.y);
      if (target?.kind === 'attachment' || target?.kind === 'attachmentRot') setSelectedAtt(target.id);
      const attStart =
        target && (target.kind === 'attachment' || target.kind === 'attachmentRot')
          ? asset.attachments.find((a) => a.id === target.id)
          : undefined;
      dragRef.current = { target, mode: target ? 'edit' : 'pan', startPan: { x: view.panX, y: view.panY }, attStart: attStart ? { ...attStart, position: { ...attStart.position } } : undefined };
      if (target)
        useProjectStore.getState().beginTransaction(
          target.kind === 'pivot' ? 'Set pivot' : target.kind === 'orbit' ? 'Move 3D handle' : 'Edit attachment',
        );
    },
    onUpdate: (e) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.mode === 'pan') {
        setView((v) => ({ ...v, panX: d.startPan.x + e.translationX, panY: d.startPan.y + e.translationY }));
        return;
      }
      const p = snap(toImage(e.x, e.y));
      if (d.target?.kind === 'pivot') setAssetPivot(asset.id, p, true);
      else if (d.target?.kind === 'orbit') setAssetOrbitHandle(asset.id, p, true);
      else if (d.target?.kind === 'attachment') updateAttachment(asset.id, d.target.id, { position: p }, true);
      else if (d.target?.kind === 'attachmentRot' && d.attStart) {
        const c = d.attStart.position;
        const raw = toImage(e.x, e.y);
        let deg = (Math.atan2(raw.y - c.y, raw.x - c.x) * 180) / Math.PI;
        if (snapPixels) deg = Math.round(deg / 5) * 5;
        updateAttachment(asset.id, d.target.id, { rotation: deg }, true);
      }
    },
    onFinalize: () => {
      if (dragRef.current?.mode === 'edit') useProjectStore.getState().endTransaction();
      dragRef.current = null;
    },
  });
  const doubleTap = useTapGesture({
    runOnJS: true,
    numberOfTaps: 2,
    onDeactivate: (e) => {
      if (e.canceled) return;
      if (hitTest(e.x, e.y)) return;
      // Double-tap places the rotation centre (shoulder, hinge, etc.) — not an attachment.
      setAssetPivot(asset.id, snap(toImage(e.x, e.y)));
    },
  });
  const gesture = useSimultaneousGestures(pan, doubleTap);

  // Wheel zoom on web.
  useEffect(() => {
    const node = containerRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = node.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      setView((v) => {
        const z = Math.max(0.1, Math.min(64, v.zoom * Math.exp(-e.deltaY * 0.0015)));
        return { zoom: z, panX: sx - ((sx - v.panX) / v.zoom) * z, panY: sy - ((sy - v.panY) / v.zoom) * z };
      });
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  const gridPath = useMemo(() => {
    const path = Skia.PathBuilder.Make();
    if (!showGrid || view.zoom < 4) return path.detach();
    for (let x = 0; x <= asset.width; x++) {
      const s = toScreen({ x, y: 0 });
      path.moveTo(s.x, view.panY);
      path.lineTo(s.x, view.panY + asset.height * view.zoom);
    }
    for (let y = 0; y <= asset.height; y++) {
      const s = toScreen({ x: 0, y });
      path.moveTo(view.panX, s.y);
      path.lineTo(view.panX + asset.width * view.zoom, s.y);
    }
    return path.detach();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGrid, view, asset.width, asset.height]);

  const checker = useMemo(() => {
    const path = Skia.PathBuilder.Make();
    const size = 8;
    for (let y = 0; y < canvasSize.height; y += size) for (let x = (y / size) % 2 === 0 ? 0 : size; x < canvasSize.width; x += size * 2) path.addRect(Skia.XYWHRect(x, y, size, size));
    return path.detach();
  }, [canvasSize]);

  const att = asset.attachments.find((a) => a.id === selectedAtt);
  const pivotS = toScreen(asset.pivot);
  const orbitS = asset.orbitHandle ? toScreen(asset.orbitHandle) : null;
  const setPivotPreset = (fx: number, fy: number) => setAssetPivot(asset.id, { x: Math.round(asset.width * fx * 2) / 2, y: Math.round(asset.height * fy * 2) / 2 });

  return (
    <View style={[styles.body, { height }]}>
      <View ref={containerRef} style={styles.canvasWrap} onLayout={onCanvasLayout}>
        <GestureDetector gesture={gesture}>
          <View style={StyleSheet.absoluteFill} collapsable={false}>
            <Canvas style={{ width: canvasSize.width, height: canvasSize.height }}>
              <Rect x={0} y={0} width={canvasSize.width} height={canvasSize.height} color={colors.checkerB} />
              <Path path={checker} color={colors.checkerA} />
              {image ? <SkiaImage image={image} x={view.panX} y={view.panY} width={asset.width * view.zoom} height={asset.height * view.zoom} fit="fill" sampling={{ filter: view.zoom >= 3 ? 0 : 1 }} /> : null}
              <Rect x={view.panX} y={view.panY} width={asset.width * view.zoom} height={asset.height * view.zoom} color={colors.borderStrong} style="stroke" strokeWidth={1} />
              {showGrid ? <Path path={gridPath} color={colors.grid} style="stroke" strokeWidth={1} /> : null}
              {asset.attachments.map((a) => {
                const s = toScreen(a.position);
                const sel = a.id === selectedAtt;
                const rad = (a.rotation * Math.PI) / 180;
                return (
                  <Group key={a.id}>
                    <Line p1={s} p2={{ x: s.x + Math.cos(rad) * 24, y: s.y + Math.sin(rad) * 24 }} color={colors.attachment} strokeWidth={sel ? 2 : 1} />
                    {sel ? <Circle cx={s.x + Math.cos(rad) * 24} cy={s.y + Math.sin(rad) * 24} r={4} color={colors.attachment} /> : null}
                    <Circle cx={s.x} cy={s.y} r={sel ? 7 : 5} color={colors.attachment} style="stroke" strokeWidth={2} />
                    <Circle cx={s.x} cy={s.y} r={1.5} color={colors.attachment} />
                  </Group>
                );
              })}
              <Group>
                <Line p1={{ x: pivotS.x - 12, y: pivotS.y }} p2={{ x: pivotS.x + 12, y: pivotS.y }} color={colors.pivot} strokeWidth={1.5} />
                <Line p1={{ x: pivotS.x, y: pivotS.y - 12 }} p2={{ x: pivotS.x, y: pivotS.y + 12 }} color={colors.pivot} strokeWidth={1.5} />
                <Circle cx={pivotS.x} cy={pivotS.y} r={6} color={colors.pivot} style="stroke" strokeWidth={2} />
              </Group>
              {orbitS ? (
                <Group>
                  <Circle cx={orbitS.x} cy={orbitS.y} r={7} color={colors.orbitHandle} style="stroke" strokeWidth={2} />
                  <Circle cx={orbitS.x} cy={orbitS.y} r={2} color={colors.orbitHandle} />
                  <Line p1={{ x: orbitS.x - 11, y: orbitS.y }} p2={{ x: orbitS.x + 11, y: orbitS.y }} color={colors.orbitHandle} strokeWidth={1} />
                  <Line p1={{ x: orbitS.x, y: orbitS.y - 11 }} p2={{ x: orbitS.x, y: orbitS.y + 11 }} color={colors.orbitHandle} strokeWidth={1} />
                </Group>
              ) : null}
            </Canvas>
            {asset.attachments.map((a) => {
              const s = toScreen(a.position);
              return (
                <Text key={a.id} style={[styles.label, { left: s.x + 9, top: s.y - 16 }]} pointerEvents="none">
                  {a.name}
                </Text>
              );
            })}
            <Text style={[styles.label, { left: pivotS.x + 9, top: pivotS.y + 6, color: colors.pivot }]} pointerEvents="none">
              pivot
            </Text>
            {orbitS ? (
              <Text style={[styles.label, { left: orbitS.x + 9, top: orbitS.y + 6, color: colors.orbitHandle }]} pointerEvents="none">
                3D
              </Text>
            ) : null}
          </View>
        </GestureDetector>
        <View style={styles.canvasHud} pointerEvents="box-none">
          <Text style={styles.hud}>
            {asset.width}×{asset.height} · {Math.round(view.zoom * 100)}% · drag empty to pan · wheel zoom · double-tap to set pivot
          </Text>
          <Button label="Fit" small onPress={() => fitView(canvasSize.width, canvasSize.height)} style={styles.fitBtn} />
        </View>
      </View>

      <ScrollView style={[styles.side, { width: sideW }]} contentContainerStyle={styles.sideContent}>
        <SectionTitle>Pivot — pink crosshair (rotation centre)</SectionTitle>
        <Text style={styles.hint}>
          Put this on the shoulder / hinge. Drag the pink crosshair, double-tap the image, or use a preset. New sprites start at the image centre only until you move it.
        </Text>
        <Row>
          <NumberField label="X" value={asset.pivot.x} onChange={(x) => setAssetPivot(asset.id, { ...asset.pivot, x })} width={90} step={0.5} />
          <NumberField label="Y" value={asset.pivot.y} onChange={(y) => setAssetPivot(asset.id, { ...asset.pivot, y })} width={90} step={0.5} />
        </Row>
        <View style={styles.presets}>
          {PIVOT_PRESETS.map((p) => (
            <Button key={p.label} label={p.label} small onPress={() => setPivotPreset(p.fx, p.fy)} style={styles.preset} />
          ))}
        </View>
        <Row>
          <Checkbox label="Snap ½px / 5°" value={snapPixels} onChange={setSnapPixels} />
          <Checkbox label="Pixel grid" value={showGrid} onChange={setShowGrid} />
        </Row>

        <SectionTitle>3D orbit handle</SectionTitle>
        <Checkbox
          label="Enable 3D handle"
          value={!!asset.orbitHandle}
          onChange={(on) => {
            if (on) setAssetOrbitHandle(asset.id, { x: Math.round(asset.width / 2), y: Math.round(asset.height / 2) });
            else setAssetOrbitHandle(asset.id, null);
          }}
        />
        {asset.orbitHandle ? (
          <Row>
            <NumberField
              label="X"
              value={asset.orbitHandle.x}
              step={0.5}
              onChange={(x) => setAssetOrbitHandle(asset.id, { ...asset.orbitHandle!, x })}
              width={90}
            />
            <NumberField
              label="Y"
              value={asset.orbitHandle.y}
              step={0.5}
              onChange={(y) => setAssetOrbitHandle(asset.id, { ...asset.orbitHandle!, y })}
              width={90}
            />
          </Row>
        ) : (
          <Text style={styles.hint}>Off by default. When enabled, Animate shows a free-drag node (drag = Z/X, Shift+drag = Y).</Text>
        )}

        <SectionTitle>Attachments — green (parent sockets)</SectionTitle>
        <Text style={styles.hint}>
          On the parent (e.g. torso): green = where a child hangs (shoulder socket). On the child (e.g. arm): put the pink pivot on the shoulder — use Add only for sockets, not for the spin point.
        </Text>
        <Row>
          <Button
            icon="+"
            label="Add"
            small
            onPress={() => {
              let n = asset.attachments.length + 1;
              while (asset.attachments.some((a) => a.name === `attach_${n}`)) n++;
              setSelectedAtt(addAttachment(asset.id, `attach_${n}`, { x: Math.round(asset.width / 2), y: Math.round(asset.height / 2) }));
            }}
          />
          <Button icon="⧉" label="Duplicate" small disabled={!att} onPress={() => att && duplicateAttachment(asset.id, att.id)} />
          <Button
            icon="🗑"
            label="Remove"
            small
            danger
            disabled={!att}
            onPress={() => {
              if (!att) return;
              removeAttachment(asset.id, att.id);
              setSelectedAtt(asset.attachments.find((a) => a.id !== att.id)?.id ?? null);
            }}
          />
        </Row>
        <View style={styles.list}>
          {asset.attachments.length === 0 ? <Text style={styles.hint}>No attachments. Press Add to place a socket on a parent sprite.</Text> : null}
          {asset.attachments.map((a) => (
            <Pressable key={a.id} onPress={() => setSelectedAtt(a.id)} style={[styles.listRow, a.id === selectedAtt && styles.listRowSel]}>
              <View style={styles.dot} />
              <Text style={styles.listText} numberOfLines={1}>
                {a.name}
              </Text>
              <Text style={styles.listMeta}>
                {Math.round(a.position.x)},{Math.round(a.position.y)} {Math.round(a.rotation)}°
              </Text>
            </Pressable>
          ))}
        </View>
        {att ? (
          <>
            <SectionTitle>Selected attachment</SectionTitle>
            <TextField label="Name" value={att.name} onChange={(name) => updateAttachment(asset.id, att.id, { name })} />
            <Row>
              <NumberField label="X" value={att.position.x} step={0.5} onChange={(x) => updateAttachment(asset.id, att.id, { position: { ...att.position, x } })} width={90} />
              <NumberField label="Y" value={att.position.y} step={0.5} onChange={(y) => updateAttachment(asset.id, att.id, { position: { ...att.position, y } })} width={90} />
            </Row>
            <Row>
              <NumberField label="Rot" value={att.rotation} suffix="°" onChange={(rotation) => updateAttachment(asset.id, att.id, { rotation })} width={90} />
              <TextField label="Type" value={att.type ?? ''} placeholder="e.g. shoulder" onChange={(type) => updateAttachment(asset.id, att.id, { type: type || undefined })} />
            </Row>
            <Button
              label="Move pivot here"
              small
              primary
              onPress={() => setAssetPivot(asset.id, { ...att.position })}
              title="Copy this green point onto the pink pivot (use if you placed the shoulder as green by mistake)"
            />
            <TextField label="Tags" value={(att.tags ?? []).join(', ')} placeholder="comma separated" onChange={(v) => updateAttachment(asset.id, att.id, { tags: v.split(',').map((s) => s.trim()).filter(Boolean) })} />
          </>
        ) : null}
        <Text style={styles.hint}>
          Arm: pink pivot at shoulder. Body: green attachment at shoulder socket, then link child pivot → parent attachment.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flexDirection: 'row', flex: 1 },
  canvasWrap: { flex: 1, backgroundColor: colors.bg0, overflow: 'hidden' },
  canvasHud: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.sm, backgroundColor: 'rgba(0,0,0,0.45)', flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  fitBtn: { marginLeft: 'auto' },
  hud: { color: colors.textMuted, fontSize: font.xs },
  side: { backgroundColor: colors.bg1, borderLeftWidth: 1, borderLeftColor: colors.border },
  sideContent: { padding: spacing.lg, gap: spacing.sm },
  presets: { flexDirection: 'row', flexWrap: 'wrap', width: 3 * 34, gap: 2 },
  preset: { width: 32, paddingHorizontal: 0, alignItems: 'center' },
  list: { borderWidth: 1, borderColor: colors.border, borderRadius: 3, backgroundColor: colors.bg0, maxHeight: 180 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, height: 24 },
  listRowSel: { backgroundColor: colors.accentSoft },
  dot: { width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: colors.attachment },
  listText: { color: colors.text, fontSize: font.sm, flex: 1 },
  listMeta: { color: colors.textDim, fontSize: font.xs, fontFamily: font.mono },
  hint: { color: colors.textDim, fontSize: font.xs, lineHeight: 15, marginTop: spacing.sm },
  warn: { color: colors.warning, padding: spacing.lg },
  label: { position: 'absolute', color: colors.attachmentLabel, fontSize: font.xs, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 3, borderRadius: 2, fontFamily: font.mono },
});
