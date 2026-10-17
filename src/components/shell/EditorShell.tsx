import React, { useEffect, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { deleteInstances, deleteKeyframes, keyAllTransform } from '@/engine/commands';
import { useEvaluatedPose } from '@/engine/useEvaluatedPose';
import { importPngFiles } from '@/importers/importPng';
import { EditorCanvas } from '@/rendering/EditorCanvas';
import { modifiers } from '@/rendering/modifiers';
import { blobStore } from '@/state/blobStore';
import { useEditorStore, type Tool } from '@/state/editorStore';
import { usePoseOverrideStore } from '@/state/poseOverrideStore';
import { useActiveAssembly, useProjectStore } from '@/state/projectStore';
import { saveCurrentProject } from '@/storage/projectService';
import { colors, font, sizes } from '@/theme/tokens';
import { AssemblyWorkspace } from '../assembly/AssemblyWorkspace';
import { AssetLibraryPanel } from '../assets/AssetLibraryPanel';
import { Dialogs } from '../dialogs/Dialogs';
import { ExplorerPanel } from '../explorer/ExplorerPanel';
import { InspectorPanel } from '../inspector/InspectorPanel';
import { LayersPanel } from '../layers/LayersPanel';
import { SpriteEditorDialog } from '../spriteEditor/SpriteEditorDialog';
import { TimelinePanel } from '../timeline/TimelinePanel';
import { Button } from '../ui/Button';
import { Splitter } from '../ui/Splitter';
import { MenuBar } from './MenuBar';
import { StatusBar } from './StatusBar';
import { ToolBar } from './ToolBar';

const TOOL_KEYS: Record<string, Tool> = { v: 'select', r: 'rotate', s: 'scale', p: 'pivot', a: 'attachment', l: 'link', h: 'pan' };

/** Top-level editor layout: menu, tools, explorer | canvas | right dock, timeline, status bar. */
export function EditorShell() {
  const win = useWindowDimensions();
  const compact = win.width < 900;
  const ed = useEditorStore();
  const pose = useEvaluatedPose();
  useEffect(() => {
    latestPose.current = pose;
  }, [pose]);
  const [fps, setFps] = useState(0);
  const [mobileDock, setMobileDock] = useState<'canvas' | 'explorer' | 'right' | 'timeline'>('canvas');
  useKeyboardShortcuts();
  useAutosave();

  // FPS meter for the status bar.
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      frames++;
      if (t - last >= 1000) {
        setFps(frames);
        frames = 0;
        last = t;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const rightDock = (
    <View style={[styles.rightDock, compact ? styles.dockFill : { width: ed.rightWidth }]}>
      <InspectorPanel pose={pose} />
      <LayersPanel />
      <AssetLibraryPanel />
    </View>
  );
  const explorer = (
    <View style={[styles.explorer, compact ? styles.dockFill : { width: ed.explorerWidth }]}>
      <ExplorerPanel />
    </View>
  );
  const centre =
    ed.workspace === 'assembly' ? (
      <AssemblyWorkspace />
    ) : (
      <View style={styles.centre}>
        <View style={{ flex: 1 }}>
          <EditorCanvas pose={pose} />
        </View>
        {ed.workspace === 'animate' && ed.timelineOpen && !compact ? (
          <>
            <Splitter orientation="horizontal" size={ed.timelineHeight} min={120} max={Math.max(140, win.height * 0.7)} sign={-1} onResize={(v) => ed.setPanelSize('timelineHeight', v)} />
            <View style={{ height: ed.timelineHeight }}>
              <TimelinePanel pose={pose} />
            </View>
          </>
        ) : null}
      </View>
    );

  return (
    <View style={styles.root}>
      <MenuBar />
      {ed.workspace !== 'assembly' ? <ToolBar /> : null}
      {compact ? (
        <View style={styles.body}>
          <View style={{ flex: 1 }}>
            {mobileDock === 'canvas' ? centre : null}
            {mobileDock === 'explorer' ? explorer : null}
            {mobileDock === 'right' ? rightDock : null}
            {mobileDock === 'timeline' ? <TimelinePanel pose={pose} /> : null}
          </View>
          <View style={styles.mobileTabs}>
            <Button label="Canvas" active={mobileDock === 'canvas'} onPress={() => setMobileDock('canvas')} />
            <Button label="Explorer" active={mobileDock === 'explorer'} onPress={() => setMobileDock('explorer')} />
            <Button label="Panels" active={mobileDock === 'right'} onPress={() => setMobileDock('right')} />
            <Button label="Timeline" active={mobileDock === 'timeline'} onPress={() => setMobileDock('timeline')} disabled={ed.workspace !== 'animate'} />
          </View>
        </View>
      ) : (
        <View style={styles.body}>
          {ed.explorerOpen ? (
            <>
              {explorer}
              <Splitter orientation="vertical" size={ed.explorerWidth} min={160} max={480} onResize={(v) => ed.setPanelSize('explorerWidth', v)} />
            </>
          ) : null}
          {centre}
          {ed.rightOpen && ed.workspace !== 'assembly' ? (
            <>
              <Splitter orientation="vertical" size={ed.rightWidth} min={220} max={560} sign={-1} onResize={(v) => ed.setPanelSize('rightWidth', v)} />
              {rightDock}
            </>
          ) : null}
        </View>
      )}
      <StatusBar fps={fps} />
      <DragGhost />
      <SpriteEditorDialog />
      <Dialogs />
    </View>
  );
}

/** Thumbnail following the pointer while dragging an asset from the library. */
function DragGhost() {
  const drag = useEditorStore((s) => s.dragAsset);
  const asset = useProjectStore((s) => (drag ? (s.project.assets.find((a) => a.id === drag.assetId) ?? s.globalAssets.find((a) => a.id === drag.assetId)) : undefined));
  const rootRef = useRef<React.ComponentRef<typeof View>>(null);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  useEffect(() => {
    rootRef.current?.measureInWindow((x, y) => setOrigin({ x, y }));
  }, [drag?.assetId]);
  if (!drag || !asset) return <View ref={rootRef} style={styles.ghostAnchor} pointerEvents="none" />;
  const blob = blobStore.get(asset.imagePath);
  return (
    <View ref={rootRef} style={styles.ghostAnchor} pointerEvents="none">
      <View style={[styles.ghost, { left: drag.x - origin.x - 32, top: drag.y - origin.y - 32 }]}>
        {blob ? <Image source={{ uri: blob.uri }} style={{ width: 64, height: 64 }} resizeMode="contain" /> : null}
        <Text style={styles.ghostText}>{asset.name}</Text>
      </View>
    </View>
  );
}

function useAutosave() {
  const dirty = useProjectStore((s) => s.dirty);
  useEffect(() => {
    if (!dirty) return;
    const id = setTimeout(() => {
      saveCurrentProject().catch((e: Error) => useEditorStore.getState().setStatus(`Autosave failed: ${e.message}`, 'error'));
    }, 4000);
    return () => clearTimeout(id);
  }, [dirty]);
}

function useKeyboardShortcuts() {
  const assembly = useActiveAssembly();
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const s = useEditorStore.getState();
      const p = useProjectStore.getState();
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveCurrentProject().then(() => s.setStatus('Saved', 'success')).catch((err: Error) => s.setStatus(`Save failed: ${err.message}`, 'error'));
        return;
      }
      if (typing) return;
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        const poseOv = usePoseOverrideStore.getState();
        if (e.shiftKey) {
          if (s.workspace === 'animate' && poseOv.redo()) return;
          p.redo();
        } else if (s.workspace === 'animate' && poseOv.undo()) {
          return;
        } else {
          p.undo();
        }
        return;
      }
      if (meta && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        if (s.workspace === 'animate' && usePoseOverrideStore.getState().redo()) return;
        p.redo();
        return;
      }
      if (meta && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        importPngFiles().catch((err: Error) => s.setStatus(err.message, 'error'));
        return;
      }
      if (meta && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        s.openDialog('export');
        return;
      }
      if (meta && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        s.openDialog('projects');
        return;
      }
      if (meta && e.key.toLowerCase() === 'a' && assembly) {
        e.preventDefault();
        s.select(assembly.sprites.filter((x) => !x.locked).map((x) => x.id));
        return;
      }
      if (meta) return;
      if (s.dialog || s.spriteEditorAssetId) return;
      const key = e.key.toLowerCase();
      if (key === 'escape') {
        s.select([]);
        s.setSelectedKeys([]);
        return;
      }
      if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        if (s.workspace === 'animate' && s.activeActionId && s.selectedKeys.length) {
          deleteKeyframes(s.activeActionId, s.selectedKeys as never);
          s.setSelectedKeys([]);
        } else if (s.selectedIds.length) deleteInstances(s.selectedIds);
        return;
      }
      if (key === ' ') {
        e.preventDefault();
        if (s.workspace === 'animate' && s.activeActionId && !modifiers.space) {
          s.setPlaying(!s.playing);
        }
        return;
      }
      if (key === 'g') return s.toggle('showGrid');
      if (key === 'k' && s.workspace === 'animate' && s.activeActionId) {
        const pose = latestPose.current;
        if (!pose) return;
        for (const id of s.selectedIds) {
          const r = pose.resolved.get(id);
          if (r) keyAllTransform(s.activeActionId, id, Math.round(s.playhead * 1e4) / 1e4, r.transform, r.opacity, r.visible);
        }
        usePoseOverrideStore.getState().clear(s.selectedIds);
        return;
      }
      if (key === '1') return s.setView({ zoom: 1 });
      if (key === '=' || key === '+') return s.setView({ zoom: Math.min(32, s.view.zoom * 1.25) });
      if (key === '-') return s.setView({ zoom: Math.max(0.05, s.view.zoom / 1.25) });
      if (s.workspace === 'animate' && s.activeActionId && assembly) {
        const action = assembly.actions.find((a) => a.id === s.activeActionId);
        if (action) {
          if (key === ',') return s.setPlayhead(Math.max(0, Math.round(s.playhead * action.fps - 1) / action.fps));
          if (key === '.') return s.setPlayhead(Math.min(action.duration, Math.round(s.playhead * action.fps + 1) / action.fps));
          if (key === 'home') return s.setPlayhead(0);
          if (key === 'end') return s.setPlayhead(action.duration);
        }
      }
      const tool = TOOL_KEYS[key];
      if (tool) s.setTool(tool);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [assembly]);
}

/** Latest evaluated pose, shared with keyboard handlers without re-subscribing. */
const latestPose: { current: ReturnType<typeof useEvaluatedPose> } = { current: null };

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg0 },
  body: { flex: 1, flexDirection: 'row', minHeight: 0 },
  explorer: {
    backgroundColor: colors.bg1,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    minHeight: 0,
    overflow: 'hidden',
    flexShrink: 0,
  },
  rightDock: {
    backgroundColor: colors.bg1,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    minHeight: 0,
    overflow: 'hidden',
    flexShrink: 0,
  },
  /** Mobile tab body: take remaining height so nested panel ScrollViews can scroll. */
  dockFill: { flex: 1, width: '100%', minHeight: 0 },
  centre: { flex: 1, minWidth: 0, minHeight: 0 },
  mobileTabs: { position: 'absolute', bottom: 0, left: 0, right: 0, height: sizes.touchTarget + 4, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', backgroundColor: colors.bg2, borderTopWidth: 1, borderTopColor: colors.border },
  ghostAnchor: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
  ghost: { position: 'absolute', alignItems: 'center', opacity: 0.85 },
  ghostText: { color: colors.text, fontSize: font.xs, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 4, borderRadius: 2 },
});
