import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Canvas, Group, Rect } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';
import { attachmentWorldPosition, type EvaluatedPose } from '@elemental/animation-core';
import { RenderListView, sharedImageRegistry, useImageRegistry } from '@elemental/animation-runtime';
import { useEditorStore } from '@/state/editorStore';
import { useActiveAssembly, useAssetLookup, useProjectStore } from '@/state/projectStore';
import { colors, font } from '@/theme/tokens';
import { GridLayer, RigOverlays } from './CanvasOverlays';
import { canvasRegion } from './canvasRegion';
import { Rulers, RULER_SIZE } from './Rulers';
import { useCanvasInteraction } from './useCanvasInteraction';
import { viewToMatrix, worldToScreen } from './viewTransform';

export interface EditorCanvasProps {
  pose: EvaluatedPose | null;
}

/**
 * Main editing canvas. Draws the evaluated pose with the shared runtime renderer and adds editor
 * overlays on top. All interaction goes through `useCanvasInteraction`.
 */
export function EditorCanvas({ pose }: EditorCanvasProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const view = useEditorStore((s) => s.view);
  const setView = useEditorStore((s) => s.setView);
  const zoomAt = useEditorStore((s) => s.zoomAt);
  const showGrid = useEditorStore((s) => s.showGrid);
  const showRulers = useEditorStore((s) => s.showRulers);
  const showPivots = useEditorStore((s) => s.showPivots);
  const showAttachments = useEditorStore((s) => s.showAttachments);
  const showJointLines = useEditorStore((s) => s.showJointLines);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const hoveredId = useEditorStore((s) => s.hoveredId);
  const snap = useEditorStore((s) => s.snapIndicator);
  const tool = useEditorStore((s) => s.tool);
  const assembly = useActiveAssembly();
  const gridSize = useProjectStore((s) => s.project.settings.gridSize);
  const registry = useImageRegistry(sharedImageRegistry);
  const lookup = useAssetLookup();

  const poseRef = useRef<EvaluatedPose | null>(pose);
  useEffect(() => {
    poseRef.current = pose;
  }, [pose]);
  const { gesture, state } = useCanvasInteraction(poseRef);
  const containerRef = useRef<React.ComponentRef<typeof View>>(null);
  const centered = useRef(false);

  // Centre the world origin on first layout.
  useEffect(() => {
    if (size.width > 0 && !centered.current) {
      centered.current = true;
      setView({ panX: Math.round(size.width / 2), panY: Math.round(size.height / 2) });
    }
  }, [size, setView]);

  // Mouse wheel zoom / pan (web only).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = containerRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = node.getBoundingClientRect();
      const sx = e.clientX - rect.left - (showRulers ? RULER_SIZE : 0);
      const sy = e.clientY - rect.top - (showRulers ? RULER_SIZE : 0);
      if (e.shiftKey) {
        const v = useEditorStore.getState().view;
        setView({ panX: v.panX - e.deltaY, panY: v.panY - e.deltaX });
      } else if (e.altKey) {
        const v = useEditorStore.getState().view;
        setView({ panX: v.panX - e.deltaX, panY: v.panY - e.deltaY });
      } else {
        const factor = Math.exp(-e.deltaY * 0.0015);
        zoomAt(factor, sx, sy);
      }
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [zoomAt, setView, showRulers]);

  const imagePathForAsset = useMemo(() => (id: string) => lookup(id)?.imagePath, [lookup]);
  const viewMatrix = useMemo(() => {
    const m = viewToMatrix(view);
    return [m[0], m[2], m[4], m[1], m[3], m[5], 0, 0, 1];
  }, [view]);

  // Attachment labels for selected / hovered sprites (RN Text keeps fonts simple across platforms).
  const labels = useMemo(() => {
    if (!pose || !showAttachments) return [];
    const ids = new Set([...selectedIds, ...(hoveredId ? [hoveredId] : [])]);
    const out: { key: string; x: number; y: number; text: string }[] = [];
    for (const id of ids) {
      const r = pose.resolved.get(id);
      const w = pose.world.get(id);
      if (!r || !w) continue;
      for (const att of r.asset.attachments) {
        const s = worldToScreen(view, attachmentWorldPosition(w, att.position));
        out.push({ key: `${id}-${att.id}`, x: s.x + 8, y: s.y - 7, text: att.name });
      }
    }
    return out;
  }, [pose, selectedIds, hoveredId, view, showAttachments]);

  const inner = { width: Math.max(0, size.width - (showRulers ? RULER_SIZE : 0)), height: Math.max(0, size.height - (showRulers ? RULER_SIZE : 0)) };
  const cursor = tool === 'pan' ? 'grab' : tool === 'rotate' ? 'crosshair' : 'default';

  const onLayout = (e: { nativeEvent: { layout: { width: number; height: number } } }) => {
    setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
    containerRef.current?.measureInWindow((x, y, w, h) => {
      canvasRegion.x = x;
      canvasRegion.y = y;
      canvasRegion.width = w;
      canvasRegion.height = h;
      canvasRegion.rulers = showRulers;
    });
  };
  useEffect(() => {
    canvasRegion.rulers = showRulers;
  }, [showRulers]);

  return (
    <View ref={containerRef} style={styles.container} onLayout={onLayout}>
      {showRulers && size.width > 0 ? <Rulers view={view} width={size.width} height={size.height} /> : null}
      <View style={[styles.inner, showRulers && { left: RULER_SIZE, top: RULER_SIZE }, { cursor } as never]}>
        <GestureDetector gesture={gesture}>
          <View style={StyleSheet.absoluteFill} collapsable={false}>
            {inner.width > 0 && inner.height > 0 ? (
              <Canvas style={{ width: inner.width, height: inner.height }}>
                <Rect x={0} y={0} width={inner.width} height={inner.height} color={assembly?.canvas.backgroundColor ?? colors.canvas} />
                {showGrid ? <GridLayer view={view} width={inner.width} height={inner.height} base={gridSize} /> : null}
                {pose ? (
                  <Group>
                    <RenderListView renderList={pose.renderList} images={registry} imagePathForAsset={imagePathForAsset} matrix={viewMatrix} />
                    <RigOverlays
                      pose={pose}
                      view={view}
                      selectedIds={selectedIds}
                      hoveredId={hoveredId}
                      showPivots={showPivots}
                      showAttachments={showAttachments}
                      showJointLines={showJointLines}
                      snap={snap}
                      marquee={state.marquee}
                      linkDrag={state.linkDrag}
                    />
                  </Group>
                ) : null}
              </Canvas>
            ) : null}
            {labels.map((l) => (
              <Text key={l.key} style={[styles.label, { left: l.x, top: l.y }]} pointerEvents="none">
                {l.text}
              </Text>
            ))}
          </View>
        </GestureDetector>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg0, overflow: 'hidden' },
  inner: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, overflow: 'hidden' },
  label: {
    position: 'absolute',
    color: colors.attachmentLabel,
    fontSize: font.xs,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 3,
    borderRadius: 2,
    fontFamily: font.mono,
  },
});
