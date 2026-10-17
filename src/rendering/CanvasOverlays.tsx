import React, { useMemo } from 'react';
import { Circle, Group, Line, Path, Rect, Skia } from '@shopify/react-native-skia';
import type { Vector2 } from '@elemental/asset-schema';
import { attachmentWorldPosition, imageWorldCorners, pivotWorldPosition, type EvaluatedPose } from '@elemental/animation-core';
import type { SnapIndicator, ViewState } from '@/state/editorStore';
import { colors } from '@/theme/tokens';
import { adaptiveGridStep, worldToScreen } from './viewTransform';

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
}

/** Selection outlines, pivots, attachment markers, joint lines, snap indicator (screen space). */
export function RigOverlays({ pose, view, selectedIds, hoveredId, showPivots, showAttachments, showJointLines, snap, marquee, linkDrag }: OverlayProps) {
  const selected = new Set(selectedIds);
  const items: React.ReactNode[] = [];

  // Joint lines: parent attachment (or pivot) → child pivot.
  if (showJointLines) {
    for (const [id, r] of pose.resolved) {
      const inst = r.instance;
      if (inst.parentId === null) continue;
      const cw = pose.world.get(id);
      const pr = pose.resolved.get(inst.parentId);
      const pw = pose.world.get(inst.parentId);
      if (!cw || !pr || !pw) continue;
      const att = inst.parentAttachmentId ? pr.asset.attachments.find((a) => a.id === inst.parentAttachmentId) : undefined;
      const from = worldToScreen(view, att ? attachmentWorldPosition(pw, att.position) : pivotWorldPosition(pw));
      const to = worldToScreen(view, pivotWorldPosition(cw));
      items.push(<Line key={`j-${id}`} p1={from} p2={to} color={colors.link} strokeWidth={1.5} opacity={0.8} />);
      items.push(<Circle key={`jp-${id}`} cx={from.x} cy={from.y} r={3} color={colors.link} />);
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
    if (showPivots && (isSel || isHover)) {
      const s = worldToScreen(view, pivotWorldPosition(w));
      items.push(<Circle key={`p-${id}`} cx={s.x} cy={s.y} r={6} color={colors.pivot} style="stroke" strokeWidth={1.5} />);
      items.push(<Line key={`ph-${id}`} p1={{ x: s.x - 9, y: s.y }} p2={{ x: s.x + 9, y: s.y }} color={colors.pivot} strokeWidth={1} />);
      items.push(<Line key={`pv-${id}`} p1={{ x: s.x, y: s.y - 9 }} p2={{ x: s.x, y: s.y + 9 }} color={colors.pivot} strokeWidth={1} />);
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
