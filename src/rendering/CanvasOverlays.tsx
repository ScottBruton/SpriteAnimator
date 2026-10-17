import React, { useMemo } from 'react';
import { Circle, Group, Line, Path, Rect, Skia } from '@shopify/react-native-skia';
import type { Vector2 } from '@elemental/asset-schema';
import {
  attachmentWorldPosition,
  imageWorldCenter,
  imageWorldCorners,
  pivotWorldPosition,
  transformPoint,
  type EvaluatedPose,
} from '@elemental/animation-core';
import type { BoxHandleKind } from '@/engine/picking';
import type { SnapIndicator, ViewState } from '@/state/editorStore';
import { colors } from '@/theme/tokens';
import { adaptiveGridStep, worldToScreen } from './viewTransform';

function dashedSegmentPath(a: Vector2, b: Vector2, dash = 5, gap = 4) {
  const p = Skia.PathBuilder.Make();
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return p.detach();
  const ux = dx / len;
  const uy = dy / len;
  let t = 0;
  let draw = true;
  while (t < len) {
    const seg = Math.min(draw ? dash : gap, len - t);
    if (draw) {
      p.moveTo(a.x + ux * t, a.y + uy * t);
      p.lineTo(a.x + ux * (t + seg), a.y + uy * (t + seg));
    }
    t += seg;
    draw = !draw;
  }
  return p.detach();
}

export function GridLayer({ view, width, height, base }: { view: ViewState; width: number; height: number; base: number }) {
  const { minorPath, majorPath, axisPath } = useMemo(() => {
    const { minor, major } = adaptiveGridStep(base, view.zoom);
    const minorP = Skia.PathBuilder.Make();
    const majorP = Skia.PathBuilder.Make();
    const axisP = Skia.PathBuilder.Make();
    const x0 = (0 - view.panX) / view.zoom;
    const x1 = (width - view.panX) / view.zoom;
    const y0 = (0 - view.panY) / view.zoom;
    const y1 = (height - view.panY) / view.zoom;
    const startX = Math.floor(x0 / minor) * minor;
    const startY = Math.floor(y0 / minor) * minor;
    const maxLines = 400;
    let n = 0;
    for (let x = startX; x <= x1 && n < maxLines; x += minor, n++) {
      const sx = Math.round(x * view.zoom + view.panX) + 0.5;
      const isMajor = Math.abs(x / major - Math.round(x / major)) < 1e-6;
      const p = isMajor ? majorP : minorP;
      p.moveTo(sx, 0);
      p.lineTo(sx, height);
    }
    n = 0;
    for (let y = startY; y <= y1 && n < maxLines; y += minor, n++) {
      const sy = Math.round(y * view.zoom + view.panY) + 0.5;
      const isMajor = Math.abs(y / major - Math.round(y / major)) < 1e-6;
      const p = isMajor ? majorP : minorP;
      p.moveTo(0, sy);
      p.lineTo(width, sy);
    }
    const ox = Math.round(view.panX) + 0.5;
    const oy = Math.round(view.panY) + 0.5;
    axisP.moveTo(ox, 0);
    axisP.lineTo(ox, height);
    axisP.moveTo(0, oy);
    axisP.lineTo(width, oy);
    return { minorPath: minorP.detach(), majorPath: majorP.detach(), axisPath: axisP.detach() };
  }, [view, width, height, base]);
  return (
    <Group>
      <Path path={minorPath} color={colors.grid} style="stroke" strokeWidth={1} />
      <Path path={majorPath} color={colors.gridMajor} style="stroke" strokeWidth={1} />
      <Path path={axisPath} color={colors.axis} style="stroke" strokeWidth={1} />
    </Group>
  );
}

export function CheckerLayer({ width, height, size = 12 }: { width: number; height: number; size?: number }) {
  const path = useMemo(() => {
    const p = Skia.PathBuilder.Make();
    const cols = Math.ceil(width / size);
    const rows = Math.ceil(height / size);
    if (cols * rows > 40000) return p.detach();
    for (let r = 0; r < rows; r++) {
      for (let c = (r % 2); c < cols; c += 2) {
        p.addRect(Skia.XYWHRect(c * size, r * size, size, size));
      }
    }
    return p.detach();
  }, [width, height, size]);
  return (
    <Group>
      <Rect x={0} y={0} width={width} height={height} color={colors.checkerB} />
      <Path path={path} color={colors.checkerA} />
    </Group>
  );
}

export interface OverlayProps {
  pose: EvaluatedPose;
  view: ViewState;
  selectedIds: readonly string[];
  hoveredId: string | null;
  showPivots: boolean;
  showAttachments: boolean;
  showJointLines: boolean;
  snap: SnapIndicator | null;
  marquee: { a: Vector2; b: Vector2 } | null;
  linkDrag: { from: Vector2; to: Vector2 } | null;
  /** When true, draw Animate-mode corner / edge / orbit rotation handles on the selection. */
  showBoxHandles?: boolean;
  hoverHandle?: { instanceId: string; kind: BoxHandleKind } | null;
}

/** Selection outlines, pivots, attachment markers, joint lines, snap indicator (screen space). */
export function RigOverlays({
  pose,
  view,
  selectedIds,
  hoveredId,
  showPivots,
  showAttachments,
  showJointLines,
  snap,
  marquee,
  linkDrag,
  showBoxHandles = false,
  hoverHandle = null,
}: OverlayProps) {
  const selected = new Set(selectedIds);
  const items: React.ReactNode[] = [];

  // Tan dotted: image centres. Green dotted: pink pivots (rotation centres) when they differ.
  if (showJointLines) {
    for (const [id, r] of pose.resolved) {
      const inst = r.instance;
      if (inst.parentId === null) continue;
      const cw = pose.world.get(id);
      const pr = pose.resolved.get(inst.parentId);
      const pw = pose.world.get(inst.parentId);
      if (!cw || !pr || !pw) continue;
      const childCenter = worldToScreen(view, imageWorldCenter(cw, r.asset.width, r.asset.height));
      const parentCenter = worldToScreen(view, imageWorldCenter(pw, pr.asset.width, pr.asset.height));
      items.push(
        <Path key={`j-${id}`} path={dashedSegmentPath(parentCenter, childCenter, 5, 4)} color={colors.link} style="stroke" strokeWidth={1.5} opacity={0.85} />,
      );
      const childPivot = pivotWorldPosition(cw);
      const parentPivot = pivotWorldPosition(pw);
      if (Math.hypot(childPivot.x - parentPivot.x, childPivot.y - parentPivot.y) > 1.5) {
        const from = worldToScreen(view, parentPivot);
        const to = worldToScreen(view, childPivot);
        items.push(
          <Path key={`pvlink-${id}`} path={dashedSegmentPath(from, to, 4, 4)} color={colors.attachment} style="stroke" strokeWidth={1.25} opacity={0.9} />,
        );
      }
    }
  }

  for (const [id, r] of pose.resolved) {
    const w = pose.world.get(id);
    if (!w) continue;
    const isSel = selected.has(id);
    const isHover = hoveredId === id;
    if (isSel || isHover) {
      const corners = imageWorldCorners(w, r.asset.width, r.asset.height).map((c) => worldToScreen(view, c));
      const p = Skia.PathBuilder.Make();
      p.moveTo(corners[0]!.x, corners[0]!.y);
      for (let i = 1; i < 4; i++) p.lineTo(corners[i]!.x, corners[i]!.y);
      p.close();
      items.push(<Path key={`o-${id}`} path={p.detach()} color={isSel ? colors.selection : 'rgba(255,255,255,0.45)'} style="stroke" strokeWidth={isSel ? 1.5 : 1} />);
    }
    if (showAttachments && (isSel || isHover || r.asset.attachments.length > 0)) {
      for (const att of r.asset.attachments) {
        const s = worldToScreen(view, attachmentWorldPosition(w, att.position));
        const rad = isSel ? 5 : 3.5;
        items.push(<Circle key={`a-${id}-${att.id}`} cx={s.x} cy={s.y} r={rad} color={colors.attachment} opacity={isSel || isHover ? 1 : 0.55} style="stroke" strokeWidth={1.5} />);
        items.push(<Circle key={`ad-${id}-${att.id}`} cx={s.x} cy={s.y} r={1.5} color={colors.attachment} />);
      }
    }
    // Always draw pivots when the toggle is on so the pink rotation centre is never mistaken for a green attachment.
    if (showPivots) {
      const s = worldToScreen(view, pivotWorldPosition(w));
      const emphasis = isSel || isHover;
      items.push(<Circle key={`p-${id}`} cx={s.x} cy={s.y} r={emphasis ? 7 : 5} color={colors.pivot} style="stroke" strokeWidth={emphasis ? 2 : 1.5} opacity={emphasis ? 1 : 0.75} />);
      items.push(<Line key={`ph-${id}`} p1={{ x: s.x - 10, y: s.y }} p2={{ x: s.x + 10, y: s.y }} color={colors.pivot} strokeWidth={emphasis ? 1.5 : 1} opacity={emphasis ? 1 : 0.75} />);
      items.push(<Line key={`pv-${id}`} p1={{ x: s.x, y: s.y - 10 }} p2={{ x: s.x, y: s.y + 10 }} color={colors.pivot} strokeWidth={emphasis ? 1.5 : 1} opacity={emphasis ? 1 : 0.75} />);
    }
    // Box rotation handles only when this is the sole selection (matches interaction).
    if (showBoxHandles && isSel && selectedIds.length === 1) {
      const cornersWorld = imageWorldCorners(w, r.asset.width, r.asset.height);
      const tl = worldToScreen(view, cornersWorld[0]);
      const tr = worldToScreen(view, cornersWorld[1]);
      const br = worldToScreen(view, cornersWorld[2]);
      const bl = worldToScreen(view, cornersWorld[3]);
      const mids = [
        { kind: 'edge-x' as const, p: { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 } },
        { kind: 'edge-x' as const, p: { x: (bl.x + br.x) / 2, y: (bl.y + br.y) / 2 } },
        { kind: 'edge-y' as const, p: { x: (tl.x + bl.x) / 2, y: (tl.y + bl.y) / 2 } },
        { kind: 'edge-y' as const, p: { x: (tr.x + br.x) / 2, y: (tr.y + br.y) / 2 } },
      ];
      const corners = [tl, tr, br, bl];
      for (let ci = 0; ci < corners.length; ci++) {
        const c = corners[ci]!;
        const hot = hoverHandle?.instanceId === id && hoverHandle.kind === 'corner-z';
        // Rotate (Z) cue: filled corner disc + small arc ticks.
        items.push(<Circle key={`bz-${id}-${ci}`} cx={c.x} cy={c.y} r={hot ? 7 : 5.5} color={colors.selection} style={hot ? 'fill' : 'stroke'} strokeWidth={2} />);
        const tick = 5;
        items.push(
          <Path
            key={`bza-${id}-${ci}`}
            path={(() => {
              const p = Skia.PathBuilder.Make();
              p.moveTo(c.x + tick, c.y - tick * 0.2);
              p.lineTo(c.x + tick, c.y - tick);
              p.lineTo(c.x + tick * 0.2, c.y - tick);
              return p.detach();
            })()}
            color={colors.selection}
            style="stroke"
            strokeWidth={1.5}
          />,
        );
      }
      for (let mi = 0; mi < mids.length; mi++) {
        const m = mids[mi]!;
        const hot = hoverHandle?.instanceId === id && hoverHandle.kind === m.kind;
        const col = m.kind === 'edge-x' ? colors.warning : colors.orbitHandle;
        items.push(<Rect key={`be-${id}-${mi}`} x={m.p.x - (hot ? 5 : 4)} y={m.p.y - (hot ? 5 : 4)} width={hot ? 10 : 8} height={hot ? 10 : 8} color={col} style={hot ? 'fill' : 'stroke'} strokeWidth={1.5} />);
      }
      if (r.asset.orbitHandle) {
        const ow = worldToScreen(view, transformPoint(w.draw, r.asset.orbitHandle));
        const hot = hoverHandle?.instanceId === id && hoverHandle.kind === 'orbit';
        items.push(<Circle key={`orb-${id}`} cx={ow.x} cy={ow.y} r={hot ? 8 : 6} color={colors.orbitHandle} style="stroke" strokeWidth={2} />);
        items.push(<Circle key={`orbd-${id}`} cx={ow.x} cy={ow.y} r={2} color={colors.orbitHandle} />);
        items.push(<Line key={`orbx-${id}`} p1={{ x: ow.x - 10, y: ow.y }} p2={{ x: ow.x + 10, y: ow.y }} color={colors.orbitHandle} strokeWidth={1} opacity={0.85} />);
        items.push(<Line key={`orby-${id}`} p1={{ x: ow.x, y: ow.y - 10 }} p2={{ x: ow.x, y: ow.y + 10 }} color={colors.orbitHandle} strokeWidth={1} opacity={0.85} />);
      }
    }
  }

  if (linkDrag) {
    const a = worldToScreen(view, linkDrag.from);
    const b = worldToScreen(view, linkDrag.to);
    items.push(<Line key="ld" p1={a} p2={b} color={colors.link} strokeWidth={1} />);
  }
  if (snap) {
    const s = worldToScreen(view, { x: snap.worldX, y: snap.worldY });
    items.push(<Circle key="snap1" cx={s.x} cy={s.y} r={10} color={colors.success} style="stroke" strokeWidth={2} />);
    items.push(<Circle key="snap2" cx={s.x} cy={s.y} r={3} color={colors.success} />);
  }
  if (marquee) {
    const a = worldToScreen(view, marquee.a);
    const b = worldToScreen(view, marquee.b);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const wdt = Math.abs(a.x - b.x);
    const hgt = Math.abs(a.y - b.y);
    items.push(<Rect key="mq1" x={x} y={y} width={wdt} height={hgt} color={colors.accentSoft} />);
    items.push(<Rect key="mq2" x={x} y={y} width={wdt} height={hgt} color={colors.accent} style="stroke" strokeWidth={1} />);
  }
  return <Group>{items}</Group>;
}
