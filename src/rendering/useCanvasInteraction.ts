import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  useHoverGesture,
  useLongPressGesture,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import type { Transform2D, Vector2 } from '@elemental/asset-schema';
import {
  attachmentWorldPosition,
  decomposeNodeMatrix,
  invert,
  localNodeMatrix,
  multiply,
  pivotWorldPosition,
  radToDeg,
  transformVector,
  translation,
  type EvaluatedPose,
  type Mat2D,
} from '@elemental/animation-core';
import { keyAllTransform, linkInstance, setAssetPivot, setInstanceTransform, updateAttachment, addAttachment } from '@/engine/commands';
import { findSnapTarget, pickBoxHandle, pickHandle, pickInstance, snapToGrid, type BoxHandleKind } from '@/engine/picking';
import { useEditorStore } from '@/state/editorStore';
import { usePoseOverrideStore } from '@/state/poseOverrideStore';
import { useProjectStore } from '@/state/projectStore';
import { modifiers } from './modifiers';
import { screenToWorld } from './viewTransform';

type DragMode =
  | { kind: 'none' }
  | { kind: 'pan'; startPanX: number; startPanY: number }
  | { kind: 'marquee'; start: Vector2 }
  | { kind: 'move'; ids: string[]; start: Map<string, { transform: Transform2D; parentFrame: Mat2D }>; startWorld: Vector2 }
  | { kind: 'rotate'; ids: string[]; start: Map<string, { transform: Transform2D; pivotWorld: Vector2; parentFrame: Mat2D }>; startAngle: Map<string, number> }
  | { kind: 'scale'; ids: string[]; start: Map<string, { transform: Transform2D; pivotWorld: Vector2 }>; startDist: Map<string, number> }
  | { kind: 'link'; id: string; socketAttachmentId?: string; start: { transform: Transform2D; parentFrame: Mat2D }; socketOffsetWorld: Vector2 }
  | { kind: 'pivot'; id: string; assetId: string; startPivot: Vector2; startWorldPivot: Vector2 }
  | { kind: 'attachment'; id: string; assetId: string; attachmentId: string; draw: Mat2D }
  | { kind: 'orbit3d'; id: string; start: Transform2D; startScreen: Vector2 }
  | { kind: 'tilt-x'; id: string; start: Transform2D; startScreenY: number }
  | { kind: 'tilt-y'; id: string; start: Transform2D; startScreenX: number }
  | { kind: 'box-z'; id: string; start: Transform2D; pivotWorld: Vector2; parentFrame: Mat2D; startAngle: number };

export interface InteractionState {
  marquee: { a: Vector2; b: Vector2 } | null;
  linkDrag: { from: Vector2; to: Vector2 } | null;
  /** Animate-mode box / orbit handle under the cursor (for overlays + cursor). */
  hoverHandle: { instanceId: string; kind: BoxHandleKind } | null;
}

const HANDLE_RADIUS_PX = 9;
/** Degrees of Euler change per screen pixel for orbit / edge tilts. */
const TILT_DEG_PER_PX = 0.45;

export type CanvasContextMenuRequest = {
  /** Local coords inside the gesture view (canvas overlay). */
  localX: number;
  localY: number;
  instanceId: string;
};

/**
 * Canvas gesture controller. Rigging mode edits the setup pose (undoable transactions);
 * Animate mode edits pending pose overrides which are keyed explicitly or by auto-key.
 */
export function useCanvasInteraction(
  poseRef: React.MutableRefObject<EvaluatedPose | null>,
  onContextMenu?: (req: CanvasContextMenuRequest) => void,
) {
  const drag = useRef<DragMode>({ kind: 'none' });
  const [state, setState] = useState<InteractionState>({ marquee: null, linkDrag: null, hoverHandle: null });
  const lastTap = useRef<{ t: number; id: string | null }>({ t: 0, id: null });
  const pinchStart = useRef<{ zoom: number; panX: number; panY: number; fx: number; fy: number } | null>(null);
  const panPointers = useRef(1);
  const pressPoint = useRef<Vector2>({ x: 0, y: 0 });

  const ed = useEditorStore;
  const proj = useProjectStore;

  const isAnimate = () => ed.getState().workspace === 'animate' && !!ed.getState().activeActionId;

  const toWorld = useCallback((sx: number, sy: number) => screenToWorld(ed.getState().view, { x: sx, y: sy }), [ed]);

  const applyTransform = (id: string, t: Transform2D) => {
    const asm = proj.getState().project.assemblies.find((a) => a.id === proj.getState().project.activeAssemblyId);
    if (asm?.sprites.find((s) => s.id === id)?.locked) return;
    if (isAnimate()) usePoseOverrideStore.getState().merge(id, { transform: t });
    else setInstanceTransform(id, t, true);
  };

  const finishTransformEdit = (ids: string[]) => {
    if (isAnimate()) {
      const s = ed.getState();
      const ov = usePoseOverrideStore.getState();
      if (s.autoKey && s.activeActionId && poseRef.current) {
        for (const id of ids) {
          const r = poseRef.current.resolved.get(id);
          if (r) keyAllTransform(s.activeActionId, id, s.playhead, r.transform, r.opacity, r.visible);
        }
        ov.endTransaction();
        ov.clear(ids);
      } else {
        ov.endTransaction();
      }
    } else {
      proj.getState().endTransaction();
    }
  };

  const beginEdit = (label: string) => {
    if (isAnimate()) usePoseOverrideStore.getState().beginTransaction(label);
    else proj.getState().beginTransaction(label);
  };

  const lockedIds = () => {
    const asm = proj.getState().project.assemblies.find((a) => a.id === proj.getState().project.activeAssemblyId);
    const locked = new Set<string>();
    if (!asm) return locked;
    const lockedLayers = new Set(asm.layers.filter((l) => l.locked).map((l) => l.id));
    for (const s of asm.sprites) if (s.locked || lockedLayers.has(s.layerId)) locked.add(s.id);
    return locked;
  };

  // ---- Pan / drag ----------------------------------------------------------------------------
  const onDragBegin = (sx: number, sy: number) => {
    const pose = poseRef.current;
    const s = ed.getState();
    const world = toWorld(sx, sy);
    const tool = s.tool;
    const handleRadius = HANDLE_RADIUS_PX / s.view.zoom;

    if (tool === 'pan' || modifiers.space || panPointers.current > 1) {
      drag.current = { kind: 'pan', startPanX: s.view.panX, startPanY: s.view.panY };
      return;
    }
    if (!pose) return;

    // Bounds / orbit rotation handles — single unlocked selection (Rigging or Animate).
    if (
      s.selectedIds.length === 1 &&
      !lockedIds().has(s.selectedIds[0]!) &&
      (tool === 'select' || tool === 'move' || tool === 'rotate')
    ) {
      const onlyId = s.selectedIds[0]!;
      const box = pickBoxHandle(pose, onlyId, world, s.view.zoom);
      if (box) {
        const r = pose.resolved.get(box.instanceId);
        const w = pose.world.get(box.instanceId);
        if (r && w) {
          const startT = {
            ...r.transform,
            position: { ...r.transform.position },
            scale: { ...r.transform.scale },
            rotationX: r.transform.rotationX ?? 0,
            rotationY: r.transform.rotationY ?? 0,
          };
          beginEdit('Rotate sprite');
          if (box.kind === 'orbit') {
            drag.current = { kind: 'orbit3d', id: box.instanceId, start: startT, startScreen: { x: sx, y: sy } };
          } else if (box.kind === 'edge-x') {
            drag.current = { kind: 'tilt-x', id: box.instanceId, start: startT, startScreenY: sy };
          } else if (box.kind === 'edge-y') {
            drag.current = { kind: 'tilt-y', id: box.instanceId, start: startT, startScreenX: sx };
          } else {
            const pv = pivotWorldPosition(w);
            drag.current = {
              kind: 'box-z',
              id: box.instanceId,
              start: startT,
              pivotWorld: pv,
              parentFrame: w.parentFrame,
              startAngle: Math.atan2(world.y - pv.y, world.x - pv.x),
            };
          }
          return;
        }
      }
    }

    // Handle hits on selected sprites first (pivot / attachment markers).
    const handle = pickHandle(pose, s.selectedIds, world, handleRadius);
    if (handle) {
      const r = pose.resolved.get(handle.instanceId)!;
      const w = pose.world.get(handle.instanceId)!;
      if (tool === 'pivot' && handle.kind === 'pivot' && !isAnimate()) {
        beginEdit('Move pivot');
        drag.current = { kind: 'pivot', id: handle.instanceId, assetId: r.asset.id, startPivot: { ...r.pivot }, startWorldPivot: handle.world };
        return;
      }
      if (tool === 'attachment' && handle.kind === 'attachment' && handle.attachmentId) {
        beginEdit('Move attachment');
        drag.current = { kind: 'attachment', id: handle.instanceId, assetId: r.asset.id, attachmentId: handle.attachmentId, draw: w.draw };
        return;
      }
      if ((tool === 'select' || tool === 'move' || tool === 'link') && !isAnimate()) {
        // Link drag: carry the sprite by its socket and snap to another sprite's attachment.
        const socketWorld = handle.world;
        const piv = pivotWorldPosition(w);
        beginEdit('Link sprite');
        drag.current = {
          kind: 'link',
          id: handle.instanceId,
          socketAttachmentId: handle.kind === 'attachment' ? handle.attachmentId : undefined,
          start: { transform: r.transform, parentFrame: w.parentFrame },
          socketOffsetWorld: { x: socketWorld.x - piv.x, y: socketWorld.y - piv.y },
        };
        setState((st) => ({ ...st, marquee: null, linkDrag: { from: socketWorld, to: socketWorld } }));
        return;
      }
    }

    if (tool === 'attachment') {
      // Click on a selected sprite's image adds an attachment at that point.
      const hit = pickInstance(pose, world, lockedIds());
      if (hit && s.selectedIds.includes(hit.instanceId)) {
        const r = pose.resolved.get(hit.instanceId)!;
        const local = transformPointInv(hit.matrix, world);
        const name = `attach_${r.asset.attachments.length + 1}`;
        const attId = addAttachment(r.asset.id, name, local);
        const w = pose.world.get(hit.instanceId)!;
        beginEdit('Move attachment');
        drag.current = { kind: 'attachment', id: hit.instanceId, assetId: r.asset.id, attachmentId: attId, draw: w.draw };
        return;
      }
    }

    const hit = pickInstance(pose, world, lockedIds());
    if (hit) {
      // Rotate / scale always affect exactly one sprite. Shift only keeps multi-select for move.
      // Parenting still swings children when the *parent* is rotated — that is intentional.
      const effectiveTool = tool === 'select' ? 'move' : tool;
      const isolate = effectiveTool === 'rotate' || effectiveTool === 'scale' || !modifiers.shift;
      const ids = isolate
        ? [hit.instanceId]
        : s.selectedIds.includes(hit.instanceId)
          ? s.selectedIds
          : [...s.selectedIds, hit.instanceId];
      if (ids.length !== s.selectedIds.length || ids.some((id, i) => id !== s.selectedIds[i])) s.select(ids);

      // Locked sprites can be selected via Layers/Inspector unlock, but not moved here.
      if (lockedIds().has(hit.instanceId)) return;

      if (effectiveTool === 'move' || effectiveTool === 'link' || effectiveTool === 'pivot' || effectiveTool === 'attachment') {
        const start = new Map<string, { transform: Transform2D; parentFrame: Mat2D }>();
        for (const id of ids) {
          const r = pose.resolved.get(id);
          const w = pose.world.get(id);
          if (r && w) start.set(id, { transform: { ...r.transform, position: { ...r.transform.position }, scale: { ...r.transform.scale } }, parentFrame: w.parentFrame });
        }
        beginEdit('Move sprite');
        drag.current = { kind: 'move', ids, start, startWorld: world };
      } else if (effectiveTool === 'rotate') {
        const start = new Map<string, { transform: Transform2D; pivotWorld: Vector2; parentFrame: Mat2D }>();
        const startAngle = new Map<string, number>();
        const id = hit.instanceId;
        const r = pose.resolved.get(id);
        const w = pose.world.get(id);
        if (r && w) {
          const pv = pivotWorldPosition(w);
          start.set(id, {
            transform: { ...r.transform, position: { ...r.transform.position }, scale: { ...r.transform.scale } },
            pivotWorld: pv,
            parentFrame: w.parentFrame,
          });
          startAngle.set(id, Math.atan2(world.y - pv.y, world.x - pv.x));
          beginEdit('Rotate sprite');
          drag.current = { kind: 'rotate', ids: [id], start, startAngle };
        }
      } else if (effectiveTool === 'scale') {
        const start = new Map<string, { transform: Transform2D; pivotWorld: Vector2 }>();
        const startDist = new Map<string, number>();
        const id = hit.instanceId;
        const r = pose.resolved.get(id);
        const w = pose.world.get(id);
        if (r && w) {
          const pv = pivotWorldPosition(w);
          start.set(id, {
            transform: { ...r.transform, position: { ...r.transform.position }, scale: { ...r.transform.scale } },
            pivotWorld: pv,
          });
          startDist.set(id, Math.max(1e-3, Math.hypot(world.x - pv.x, world.y - pv.y)));
          beginEdit('Scale sprite');
          drag.current = { kind: 'scale', ids: [id], start, startDist };
        }
      }
      return;
    }

    if (tool === 'select') {
      // Track marquee start, but only paint after the pointer moves (avoids click flash).
      drag.current = { kind: 'marquee', start: world };
    } else {
      drag.current = { kind: 'pan', startPanX: s.view.panX, startPanY: s.view.panY };
    }
  };

  const onDragUpdate = (sx: number, sy: number, tx: number, ty: number) => {
    const d = drag.current;
    const s = ed.getState();
    const pose = poseRef.current;
    const world = toWorld(sx, sy);
    const settings = proj.getState().project.settings;

    switch (d.kind) {
      case 'pan':
        s.setView({ panX: d.startPanX + tx, panY: d.startPanY + ty });
        return;
      case 'marquee': {
        const moved = Math.abs(world.x - d.start.x) > 1 || Math.abs(world.y - d.start.y) > 1;
        if (moved) setState((st) => ({ ...st, marquee: { a: d.start, b: world }, linkDrag: null }));
        return;
      }
      case 'orbit3d': {
        const dx = sx - d.startScreen.x;
        const dy = sy - d.startScreen.y;
        if (modifiers.shift) {
          applyTransform(d.id, { ...d.start, rotationY: d.start.rotationY + dx * TILT_DEG_PER_PX });
        } else {
          let rotZ = d.start.rotation + dx * TILT_DEG_PER_PX;
          let rotX = d.start.rotationX + dy * TILT_DEG_PER_PX;
          if (modifiers.ctrl) {
            rotZ = Math.round(rotZ / 15) * 15;
            rotX = Math.round(rotX / 15) * 15;
          }
          applyTransform(d.id, { ...d.start, rotation: rotZ, rotationX: rotX });
        }
        return;
      }
      case 'tilt-x': {
        let rotX = d.start.rotationX + (sy - d.startScreenY) * TILT_DEG_PER_PX;
        if (modifiers.shift) rotX = Math.round(rotX / 15) * 15;
        applyTransform(d.id, { ...d.start, rotationX: rotX });
        return;
      }
      case 'tilt-y': {
        let rotY = d.start.rotationY + (sx - d.startScreenX) * TILT_DEG_PER_PX;
        if (modifiers.shift) rotY = Math.round(rotY / 15) * 15;
        applyTransform(d.id, { ...d.start, rotationY: rotY });
        return;
      }
      case 'box-z': {
        const a1 = Math.atan2(world.y - d.pivotWorld.y, world.x - d.pivotWorld.x);
        let delta = radToDeg(a1 - d.startAngle);
        const det = d.parentFrame[0] * d.parentFrame[3] - d.parentFrame[1] * d.parentFrame[2];
        if (det < 0) delta = -delta;
        if (d.start.flipX !== d.start.flipY) delta = -delta;
        let rot = d.start.rotation + delta;
        if (modifiers.shift) rot = Math.round(rot / 15) * 15;
        applyTransform(d.id, { ...d.start, rotation: rot });
        return;
      }
      case 'move': {
        const dw = { x: world.x - d.startWorld.x, y: world.y - d.startWorld.y };
        for (const id of d.ids) {
          const st = d.start.get(id);
          if (!st) continue;
          // World delta → parent-frame delta.
          const inv = invert(st.parentFrame);
          const dl = transformVector(inv, dw);
          let pos = { x: st.transform.position.x + dl.x, y: st.transform.position.y + dl.y };
          if (settings.snapToGrid || modifiers.ctrl) pos = snapToGrid(pos, settings.gridSize);
          applyTransform(id, { ...st.transform, position: pos });
        }
        return;
      }
      case 'rotate': {
        for (const id of d.ids) {
          const st = d.start.get(id);
          const a0 = d.startAngle.get(id);
          if (!st || a0 === undefined) continue;
          const a1 = Math.atan2(world.y - st.pivotWorld.y, world.x - st.pivotWorld.x);
          let delta = radToDeg(a1 - a0);
          const det = st.parentFrame[0] * st.parentFrame[3] - st.parentFrame[1] * st.parentFrame[2];
          if (det < 0) delta = -delta;
          if (st.transform.flipX !== st.transform.flipY) delta = -delta;
          let rot = st.transform.rotation + delta;
          if (modifiers.shift) rot = Math.round(rot / 15) * 15;
          applyTransform(id, { ...st.transform, rotation: rot });
        }
        return;
      }
      case 'scale': {
        for (const id of d.ids) {
          const st = d.start.get(id);
          const d0 = d.startDist.get(id);
          if (!st || !d0) continue;
          const d1 = Math.hypot(world.x - st.pivotWorld.x, world.y - st.pivotWorld.y);
          const k = Math.max(0.01, d1 / d0);
          applyTransform(id, { ...st.transform, scale: { x: st.transform.scale.x * k, y: st.transform.scale.y * k } });
        }
        return;
      }
      case 'link': {
        if (!pose) return;
        const target = settings.snapToAttachments ? findSnapTarget(pose, world, new Set([d.id, ...descendants(pose, d.id)]), settings.snapTolerance / s.view.zoom) : null;
        const socketWorld = target ? target.world : world;
        const pivotWorld = { x: socketWorld.x - d.socketOffsetWorld.x, y: socketWorld.y - d.socketOffsetWorld.y };
        const inv = invert(d.start.parentFrame);
        const local = transformPointInv(d.start.parentFrame, pivotWorld);
        void inv;
        setInstanceTransform(d.id, { ...d.start.transform, position: local }, true);
        s.setSnapIndicator(
          target
            ? {
                worldX: target.world.x,
                worldY: target.world.y,
                parentInstanceId: target.instanceId,
                attachmentId: target.attachmentId,
              }
            : null,
        );
        setState((st) => ({ ...st, marquee: null, linkDrag: { from: pivotWorld, to: socketWorld } }));
        return;
      }
      case 'pivot': {
        if (!pose) return;
        const w = pose.world.get(d.id);
        const r = pose.resolved.get(d.id);
        if (!w || !r) return;
        // New pivot in image-local coordinates; keep the image where it is.
        let newPivotLocal = transformPointInv(w.draw, world);
        if (settings.snapToGrid || modifiers.ctrl) newPivotLocal = snapToGrid(newPivotLocal, 1);
        const asm = proj.getState().project.assemblies.find((a) => a.id === proj.getState().project.activeAssemblyId);
        if (!asm) return;
        const delta = { x: newPivotLocal.x - r.pivot.x, y: newPivotLocal.y - r.pivot.y };
        // local' = local · T(delta) for every instance of this asset so nothing moves on screen.
        for (const inst of asm.sprites) {
          if (inst.assetId !== d.assetId) continue;
          const rr = pose.resolved.get(inst.id);
          if (!rr) continue;
          const m = multiply(localNodeMatrix(rr.transform), translation(delta.x, delta.y));
          setInstanceTransform(inst.id, decomposeNodeMatrix(m, rr.transform), true);
        }
        setAssetPivot(d.assetId, newPivotLocal, true);
        return;
      }
      case 'attachment': {
        const local = transformPointInv(d.draw, world);
        const snapped = settings.snapToGrid || modifiers.ctrl ? snapToGrid(local, 1) : local;
        updateAttachment(d.assetId, d.attachmentId, { position: snapped }, true);
        return;
      }
      default:
        return;
    }
  };

  /** Abort any in-progress drag (stuck pointer, context menu, blur). Does not commit edits. */
  const cancelDrag = useCallback(() => {
    const d = drag.current;
    if (d.kind === 'none') {
      setState((st) => (st.marquee || st.linkDrag ? { ...st, marquee: null, linkDrag: null } : st));
      return;
    }
    drag.current = { kind: 'none' };
    setState((st) => ({ ...st, marquee: null, linkDrag: null }));
    ed.getState().setSnapIndicator(null);
    if (
      d.kind === 'move' ||
      d.kind === 'rotate' ||
      d.kind === 'scale' ||
      d.kind === 'link' ||
      d.kind === 'pivot' ||
      d.kind === 'attachment' ||
      d.kind === 'orbit3d' ||
      d.kind === 'tilt-x' ||
      d.kind === 'tilt-y' ||
      d.kind === 'box-z'
    ) {
      if (isAnimate()) usePoseOverrideStore.getState().cancelTransaction();
      else proj.getState().cancelTransaction();
    }
  }, [ed, proj]);

  const onDragEnd = () => {
    const d = drag.current;
    const s = ed.getState();
    const pose = poseRef.current;
    drag.current = { kind: 'none' };
    switch (d.kind) {
      case 'marquee': {
        const m = state.marquee ?? (pose ? { a: d.start, b: d.start } : null);
        if (pose && m) {
          const x0 = Math.min(m.a.x, m.b.x);
          const x1 = Math.max(m.a.x, m.b.x);
          const y0 = Math.min(m.a.y, m.b.y);
          const y1 = Math.max(m.a.y, m.b.y);
          // Ignore click-jitter marquees (activation threshold can still be tiny).
          if (x1 - x0 > 2 || y1 - y0 > 2) {
            const hits: string[] = [];
            for (const [id, w] of pose.world) {
              const p = pivotWorldPosition(w);
              if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) hits.push(id);
            }
            s.select(modifiers.shift ? [...new Set([...s.selectedIds, ...hits])] : hits);
          }
        }
        setState((st) => ({ ...st, marquee: null, linkDrag: null }));
        return;
      }
      case 'move':
      case 'rotate':
      case 'scale':
        finishTransformEdit(d.ids);
        return;
      case 'orbit3d':
      case 'tilt-x':
      case 'tilt-y':
      case 'box-z':
        finishTransformEdit([d.id]);
        return;
      case 'link': {
        const snap = s.snapIndicator;
        s.setSnapIndicator(null);
        setState((st) => ({ ...st, marquee: null, linkDrag: null }));
        if (snap && pose) {
          // The moved pose (captured in the latest evaluation) is only used for the alignment
          // math; revert the transient move so the link is a single undo step.
          const fresh = poseRef.current ?? pose;
          proj.getState().cancelTransaction();
          linkInstance({
            childId: d.id,
            parentId: snap.parentInstanceId,
            parentAttachmentId: snap.attachmentId,
            childAttachmentId: d.socketAttachmentId,
            mode: 'snap',
            resolved: fresh.resolved,
          });
          s.setStatus(
            snap.attachmentId ? 'Linked to parent attachment' : 'Linked to parent pivot (move pivot or use an attachment for joints)',
            'success',
          );
        } else {
          proj.getState().endTransaction();
        }
        return;
      }
      case 'pivot':
      case 'attachment':
        proj.getState().endTransaction();
        return;
      default:
        return;
    }
  };

  // Safety net: if pointer-up is lost (modal / capture), clear a stuck marquee after RNGH has had a chance to end.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const mopUp = () => {
      requestAnimationFrame(() => {
        if (drag.current.kind === 'marquee' || drag.current.kind === 'pan') cancelDrag();
      });
    };
    const onBlur = () => cancelDrag();
    window.addEventListener('pointerup', mopUp, true);
    window.addEventListener('pointercancel', mopUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointerup', mopUp, true);
      window.removeEventListener('pointercancel', mopUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [cancelDrag]);

  // ---- Gestures ------------------------------------------------------------------------------
  const pan = usePanGesture({
    runOnJS: true,
    minDistance: 6,
    maxPointers: 1,
    onBegin: (e) => {
      panPointers.current = e.numberOfPointers;
      // RNGH measures translation from the activation point, not the press point; remember
      // where the pointer actually went down so handle hit-tests use the real press location.
      pressPoint.current = { x: e.x, y: e.y };
    },
    onActivate: () => {
      onDragBegin(pressPoint.current.x, pressPoint.current.y);
    },
    onUpdate: (e) => onDragUpdate(e.x, e.y, e.x - pressPoint.current.x, e.y - pressPoint.current.y),
    onDeactivate: () => onDragEnd(),
    onFinalize: () => {
      if (drag.current.kind !== 'none') onDragEnd();
    },
  });

  const twoFingerPan = usePanGesture({
    runOnJS: true,
    minPointers: 2,
    maxPointers: 2,
    minDistance: 0,
    onActivate: () => {
      const v = ed.getState().view;
      drag.current = { kind: 'pan', startPanX: v.panX, startPanY: v.panY };
    },
    onUpdate: (e) => {
      const d = drag.current;
      if (d.kind === 'pan') ed.getState().setView({ panX: d.startPanX + e.translationX, panY: d.startPanY + e.translationY });
    },
    onDeactivate: () => {
      drag.current = { kind: 'none' };
    },
  });

  const pinch = usePinchGesture({
    runOnJS: true,
    onActivate: (e) => {
      const v = ed.getState().view;
      pinchStart.current = { zoom: v.zoom, panX: v.panX, panY: v.panY, fx: e.focalX, fy: e.focalY };
    },
    onUpdate: (e) => {
      const st = pinchStart.current;
      if (!st) return;
      const zoom = Math.min(64, Math.max(0.05, st.zoom * e.scale));
      const k = zoom / st.zoom;
      ed.getState().setView({ zoom, panX: e.focalX - (st.fx - st.panX) * k, panY: e.focalY - (st.fy - st.panY) * k });
    },
    onDeactivate: () => {
      pinchStart.current = null;
    },
  });

  const tap = useTapGesture({
    runOnJS: true,
    maxDistance: 6,
    onDeactivate: (e) => {
      if (e.canceled) return;
      const pose = poseRef.current;
      const s = ed.getState();
      const world = toWorld(e.x, e.y);
      if (!pose) return;
      const hit = pickInstance(pose, world, lockedIds());
      const now = Date.now();
      const id = hit?.instanceId ?? null;
      if (id && lastTap.current.id === id && now - lastTap.current.t < 350) {
        const r = pose.resolved.get(id);
        if (r) s.openSpriteEditor(r.asset.id);
        lastTap.current = { t: 0, id: null };
        return;
      }
      lastTap.current = { t: now, id };
      if (s.tool === 'attachment' || s.tool === 'pivot') {
        if (id && !s.selectedIds.includes(id)) s.select([id]);
        return;
      }
      if (id) s.select([id], { toggle: modifiers.shift });
      else if (!modifiers.shift) s.select([]);
    },
  });

  const longPress = useLongPressGesture({
    runOnJS: true,
    enabled: Platform.OS !== 'web',
    minDuration: 450,
    maxDistance: 8,
    onActivate: (e) => {
      const pose = poseRef.current;
      if (!pose) return;
      const hit = pickInstance(pose, toWorld(e.x, e.y), lockedIds());
      if (!hit) return;
      const s = ed.getState();
      if (!s.selectedIds.includes(hit.instanceId)) s.select([hit.instanceId]);
      onContextMenu?.({ localX: e.x, localY: e.y, instanceId: hit.instanceId });
    },
  });

  const hover = useHoverGesture({
    runOnJS: true,
    onUpdate: (e) => {
      const pose = poseRef.current;
      const s = ed.getState();
      const world = toWorld(e.x, e.y);
      s.setCursorWorld(world);
      if (pose && drag.current.kind === 'none') {
        const hit = pickInstance(pose, world, lockedIds());
        const id = hit?.instanceId ?? null;
        if (id !== s.hoveredId) s.setHovered(id);
        let hoverHandle: InteractionState['hoverHandle'] = null;
        if (s.selectedIds.length === 1 && !lockedIds().has(s.selectedIds[0]!)) {
          const box = pickBoxHandle(pose, s.selectedIds[0]!, world, s.view.zoom);
          if (box) hoverHandle = { instanceId: box.instanceId, kind: box.kind };
        }
        setState((st) =>
          st.hoverHandle?.instanceId === hoverHandle?.instanceId && st.hoverHandle?.kind === hoverHandle?.kind
            ? st
            : { ...st, hoverHandle },
        );
      }
    },
    onDeactivate: () => {
      ed.getState().setCursorWorld(null);
      ed.getState().setHovered(null);
      setState((st) => ({ ...st, hoverHandle: null }));
    },
  });

  const gesture = useSimultaneousGestures(pan, twoFingerPan, pinch, tap, longPress, hover);

  return useMemo(() => ({ gesture, state, cancelDrag }), [gesture, state, cancelDrag]);
}

function transformPointInv(m: Mat2D, p: Vector2): Vector2 {
  const inv = invert(m);
  return { x: inv[0] * p.x + inv[2] * p.y + inv[4], y: inv[1] * p.x + inv[3] * p.y + inv[5] };
}

function descendants(pose: EvaluatedPose, rootId: string): string[] {
  const out: string[] = [];
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const [id, r] of pose.resolved) {
      if (r.instance.parentId === cur) {
        out.push(id);
        stack.push(id);
      }
    }
  }
  return out;
}

export { attachmentWorldPosition };
