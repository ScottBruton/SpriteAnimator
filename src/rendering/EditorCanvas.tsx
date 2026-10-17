import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Canvas, Group, Rect } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';
import { attachmentWorldPosition, pivotWorldPosition, type EvaluatedPose } from '@elemental/animation-core';
import { RenderListView, sharedImageRegistry, useImageRegistry } from '@elemental/animation-runtime';
import { spriteContextMenuItems } from '@/components/canvas/spriteContextMenu';
import { ContextMenu } from '@/components/ui/Menu';
import { pickInstance } from '@/engine/picking';
import { useEditorStore } from '@/state/editorStore';
import { useActiveAssembly, useAssetLookup, useProjectStore } from '@/state/projectStore';
import { colors, font } from '@/theme/tokens';
import { GridLayer, RigOverlays } from './CanvasOverlays';
import { canvasRegion } from './canvasRegion';
import { Rulers, RULER_SIZE } from './Rulers';
import { poseStageBounds } from './stageBounds';
import { useCanvasInteraction, type CanvasContextMenuRequest } from './useCanvasInteraction';
import { screenToWorld, viewToMatrix, worldToScreen } from './viewTransform';

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
  const workspace = useEditorStore((s) => s.workspace);
  const activeActionId = useEditorStore((s) => s.activeActionId);
  const assembly = useActiveAssembly();
  const gridSize = useProjectStore((s) => s.project.settings.gridSize);
  const registry = useImageRegistry(sharedImageRegistry);
  const lookup = useAssetLookup();

  const poseRef = useRef<EvaluatedPose | null>(pose);
  useEffect(() => {
    poseRef.current = pose;
  }, [pose]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; instanceId: string } | null>(null);
  const select = useEditorStore((s) => s.select);

  const openSpriteContextMenu = useCallback(
    (req: CanvasContextMenuRequest) => {
      // Gesture local coords are relative to the stage overlay (inside rulers).
      const x = canvasRegion.x + (showRulers ? RULER_SIZE : 0) + req.localX;
      const y = canvasRegion.y + (showRulers ? RULER_SIZE : 0) + req.localY;
      setContextMenu({ x, y, instanceId: req.instanceId });
    },
    [showRulers],
  );

  const { gesture, state, cancelDrag } = useCanvasInteraction(poseRef, openSpriteContextMenu);
  const containerRef = useRef<React.ComponentRef<typeof View>>(null);
  const hScrollRef = useRef<{ scrollTo: (o: { x?: number; y?: number; animated?: boolean }) => void } | null>(null);
  const vScrollRef = useRef<{ scrollTo: (o: { x?: number; y?: number; animated?: boolean }) => void } | null>(null);
  const syncingScroll = useRef(false);
  const scrollSyncGen = useRef(0);
  const middlePanning = useRef(false);
  const centered = useRef(false);

  const bounds = useMemo(() => poseStageBounds(pose), [pose]);

  // Centre the world origin on first layout.
  useEffect(() => {
    if (size.width > 0 && !centered.current) {
      centered.current = true;
      setView({ panX: Math.round(size.width / 2), panY: Math.round(size.height / 2) });
    }
  }, [size, setView]);

  // Mouse wheel zoom / pan, and middle-button drag pan (web only).
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

    // Middle mouse (wheel click): hold and drag to pan.
    // Listen on window (not setPointerCapture) so we don't steal capture from RNGH / leave clicks stuck.
    let middlePan: { lastX: number; lastY: number; panX: number; panY: number } | null = null;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      cancelDrag();
      const v = useEditorStore.getState().view;
      middlePan = { lastX: e.clientX, lastY: e.clientY, panX: v.panX, panY: v.panY };
      middlePanning.current = true;
      node.style.cursor = 'grabbing';
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!middlePan || (e.buttons & 4) === 0) return;
      e.preventDefault();
      const dx = e.clientX - middlePan.lastX;
      const dy = e.clientY - middlePan.lastY;
      middlePan.lastX = e.clientX;
      middlePan.lastY = e.clientY;
      middlePan.panX += dx;
      middlePan.panY += dy;
      setView({ panX: middlePan.panX, panY: middlePan.panY });
    };
    const endMiddlePan = (e: PointerEvent) => {
      if (!middlePan) return;
      if (e.type === 'pointerup' && e.button !== 1) return;
      e.preventDefault();
      middlePan = null;
      middlePanning.current = false;
      node.style.cursor = '';
    };
    // Prevent the browser's default middle-click autoscroll affordance.
    const preventMiddleDefault = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      cancelDrag();
      const poseNow = poseRef.current;
      if (!poseNow || !assembly) return;
      const rect = node.getBoundingClientRect();
      const localX = e.clientX - rect.left - (showRulers ? RULER_SIZE : 0);
      const localY = e.clientY - rect.top - (showRulers ? RULER_SIZE : 0);
      const world = screenToWorld(useEditorStore.getState().view, { x: localX, y: localY });
      const locked = new Set<string>();
      const lockedLayers = new Set(assembly.layers.filter((l) => l.locked).map((l) => l.id));
      for (const s of assembly.sprites) if (s.locked || lockedLayers.has(s.layerId)) locked.add(s.id);
      const hit = pickInstance(poseNow, world, locked);
      if (!hit) {
        setContextMenu(null);
        return;
      }
      const sel = useEditorStore.getState().selectedIds;
      if (!sel.includes(hit.instanceId)) select([hit.instanceId]);
      setContextMenu({ x: e.clientX, y: e.clientY, instanceId: hit.instanceId });
    };

    node.addEventListener('wheel', onWheel, { passive: false });
    node.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endMiddlePan);
    window.addEventListener('pointercancel', endMiddlePan);
    node.addEventListener('mousedown', preventMiddleDefault, true);
    node.addEventListener('auxclick', preventMiddleDefault);
    node.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      node.removeEventListener('wheel', onWheel);
      node.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endMiddlePan);
      window.removeEventListener('pointercancel', endMiddlePan);
      node.removeEventListener('mousedown', preventMiddleDefault, true);
      node.removeEventListener('auxclick', preventMiddleDefault);
      node.removeEventListener('contextmenu', onContextMenu, true);
      middlePanning.current = false;
      node.style.cursor = '';
    };
  }, [zoomAt, setView, showRulers, assembly, select, cancelDrag]);

  const imagePathForAsset = useMemo(() => (id: string) => lookup(id)?.imagePath, [lookup]);
  const viewMatrix = useMemo(() => {
    const m = viewToMatrix(view);
    return [m[0], m[2], m[4], m[1], m[3], m[5], 0, 0, 1];
  }, [view]);

  // Labels (RN Text). Pink pivots always labeled when visible; green attachments keep their names.
  const labels = useMemo(() => {
    if (!pose) return [];
    const out: { key: string; x: number; y: number; text: string; color?: string }[] = [];
    if (showPivots) {
      for (const [id, w] of pose.world) {
        const s = worldToScreen(view, pivotWorldPosition(w));
        out.push({ key: `pivot-${id}`, x: s.x + 10, y: s.y + 4, text: 'pivot', color: colors.pivot });
      }
    }
    if (showAttachments) {
      const ids = new Set([...selectedIds, ...(hoveredId ? [hoveredId] : [])]);
      for (const id of ids) {
        const r = pose.resolved.get(id);
        const w = pose.world.get(id);
        if (!r || !w) continue;
        for (const att of r.asset.attachments) {
          const s = worldToScreen(view, attachmentWorldPosition(w, att.position));
          out.push({ key: `${id}-${att.id}`, x: s.x + 8, y: s.y - 7, text: att.name, color: colors.attachmentLabel });
        }
      }
    }
    return out;
  }, [pose, selectedIds, hoveredId, view, showAttachments, showPivots]);

  const inner = { width: Math.max(0, size.width - (showRulers ? RULER_SIZE : 0)), height: Math.max(0, size.height - (showRulers ? RULER_SIZE : 0)) };
  const animate = workspace === 'animate' && !!activeActionId;
  const cursor =
    tool === 'pan'
      ? 'grab'
      : state.hoverHandle?.kind === 'corner-z' || tool === 'rotate'
        ? 'crosshair'
        : state.hoverHandle?.kind === 'edge-x'
          ? 'ns-resize'
          : state.hoverHandle?.kind === 'edge-y' || state.hoverHandle?.kind === 'orbit'
            ? 'ew-resize'
            : 'default';

  // Scrollable stage size in screen px (content bounds × zoom, at least the viewport).
  const stageW = Math.max(inner.width, (bounds.maxX - bounds.minX) * view.zoom + inner.width);
  const stageH = Math.max(inner.height, (bounds.maxY - bounds.minY) * view.zoom + inner.height);
  const scrollFromPan = (panX: number, panY: number) => ({
    x: Math.min(Math.max(0, -panX - bounds.minX * view.zoom), Math.max(0, stageW - inner.width)),
    y: Math.min(Math.max(0, -panY - bounds.minY * view.zoom), Math.max(0, stageH - inner.height)),
  });
  const panFromScroll = (sx: number, sy: number) => ({
    panX: -bounds.minX * view.zoom - sx,
    panY: -bounds.minY * view.zoom - sy,
  });

  // Keep scrollbar thumbs in sync when pan/zoom changes from gestures or wheel.
  // Never let programmatic scrollTo write pan back — that clamps free pan (middle-mouse) to the stage.
  useEffect(() => {
    if (inner.width <= 0 || inner.height <= 0) return;
    const { x, y } = scrollFromPan(view.panX, view.panY);
    const gen = ++scrollSyncGen.current;
    syncingScroll.current = true;
    hScrollRef.current?.scrollTo({ x, animated: false });
    vScrollRef.current?.scrollTo({ y, animated: false });
    const t = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (scrollSyncGen.current === gen) syncingScroll.current = false;
      });
    });
    return () => cancelAnimationFrame(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.panX, view.panY, view.zoom, bounds.minX, bounds.minY, stageW, stageH, inner.width, inner.height]);

  const onStageScroll = (e: NativeSyntheticEvent<NativeScrollEvent>, axis: 'x' | 'y') => {
    if (syncingScroll.current || middlePanning.current) return;
    // ScrollViews are indicators unless the pan tool has scrollEnabled — avoid fighting free pan.
    if (tool !== 'pan') return;
    const { contentOffset } = e.nativeEvent;
    const cur = scrollFromPan(view.panX, view.panY);
    const next = panFromScroll(axis === 'x' ? contentOffset.x : cur.x, axis === 'y' ? contentOffset.y : cur.y);
    setView(next);
  };

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

  const contextItems =
    contextMenu && assembly
      ? spriteContextMenuItems({ instanceId: contextMenu.instanceId, pose, assembly, lookup })
      : [];

  return (
    <View ref={containerRef} style={styles.container} onLayout={onLayout}>
      {showRulers && size.width > 0 ? <Rulers view={view} width={size.width} height={size.height} /> : null}
      <View style={[styles.inner, showRulers && { left: RULER_SIZE, top: RULER_SIZE }, { cursor } as never]}>
        {/* Stage ScrollViews provide scrollbars; pan tool (or trackpad on the bars) moves the view. */}
        <ScrollView
          ref={hScrollRef as never}
          horizontal
          style={styles.stageScroll}
          contentContainerStyle={{ width: stageW, height: Math.max(inner.height, 1) }}
          onScroll={(e) => onStageScroll(e, 'x')}
          scrollEventThrottle={16}
          showsHorizontalScrollIndicator
          showsVerticalScrollIndicator={false}
          scrollEnabled={tool === 'pan'}
        >
          <ScrollView
            ref={vScrollRef as never}
            style={{ width: stageW, height: Math.max(inner.height, 1) }}
            contentContainerStyle={{ width: stageW, height: stageH }}
            onScroll={(e) => onStageScroll(e, 'y')}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator
            showsHorizontalScrollIndicator={false}
            scrollEnabled={tool === 'pan'}
          >
            <View style={{ width: stageW, height: stageH }} collapsable={false} />
          </ScrollView>
        </ScrollView>

        <View style={styles.stageOverlay} pointerEvents={tool === 'pan' ? 'none' : 'auto'}>
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
                      showBoxHandles={(workspace === 'rigging' || animate) && selectedIds.length === 1}
                      hoverHandle={state.hoverHandle}
                      />
                    </Group>
                  ) : null}
                </Canvas>
              ) : null}
              {labels.map((l) => (
                <Text key={l.key} style={[styles.label, { left: l.x, top: l.y, color: l.color ?? colors.attachmentLabel }]} pointerEvents="none">
                  {l.text}
                </Text>
              ))}
            </View>
          </GestureDetector>
        </View>
      </View>
      <ContextMenu
        visible={!!contextMenu && contextItems.length > 0}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        items={contextItems}
        onClose={() => {
          cancelDrag();
          setContextMenu(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg0, overflow: 'hidden', minHeight: 0 },
  inner: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, overflow: 'hidden' },
  stageScroll: { ...StyleSheet.absoluteFill },
  stageOverlay: { ...StyleSheet.absoluteFill },
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
