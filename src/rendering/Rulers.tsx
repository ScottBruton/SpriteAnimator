import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Canvas, Line, Path, Rect, Skia } from '@shopify/react-native-skia';
import type { ViewState } from '@/state/editorStore';
import { useProjectStore } from '@/state/projectStore';
import { colors, font } from '@/theme/tokens';
import { rulerStep } from './viewTransform';

export const RULER_SIZE = 18;

/** Horizontal + vertical rulers in the configured display unit (px / mm / cm). */
export function Rulers({ view, width, height }: { view: ViewState; width: number; height: number }) {
  const units = useProjectStore((s) => s.project.settings.units);
  const ppmm = useProjectStore((s) => s.project.settings.pixelsPerMillimetre);
  const unitScale = units === 'px' ? 1 : units === 'mm' ? ppmm : ppmm * 10; // world px per display unit
  const effectiveZoom = view.zoom * unitScale; // screen px per display unit

  const data = useMemo(() => {
    const step = rulerStep(effectiveZoom); // display units
    const minor = step / 5;
    const hPath = Skia.PathBuilder.Make();
    const vPath = Skia.PathBuilder.Make();
    const hLabels: { x: number; text: string }[] = [];
    const vLabels: { y: number; text: string }[] = [];
    const innerW = width - RULER_SIZE;
    const innerH = height - RULER_SIZE;
    const u0 = (0 - view.panX) / effectiveZoom;
    const u1 = (innerW - view.panX) / effectiveZoom;
    const w0 = (0 - view.panY) / effectiveZoom;
    const w1 = (innerH - view.panY) / effectiveZoom;
    let count = 0;
    for (let u = Math.floor(u0 / minor) * minor; u <= u1 && count < 2000; u += minor, count++) {
      const sx = Math.round(u * effectiveZoom + view.panX) + 0.5;
      const major = Math.abs(u / step - Math.round(u / step)) < 1e-6;
      hPath.moveTo(sx, RULER_SIZE);
      hPath.lineTo(sx, major ? 4 : 12);
      if (major) hLabels.push({ x: sx + 2, text: fmt(u) });
    }
    count = 0;
    for (let v = Math.floor(w0 / minor) * minor; v <= w1 && count < 2000; v += minor, count++) {
      const sy = Math.round(v * effectiveZoom + view.panY) + 0.5;
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      vPath.moveTo(RULER_SIZE, sy);
      vPath.lineTo(major ? 4 : 12, sy);
      if (major) vLabels.push({ y: sy + 1, text: fmt(v) });
    }
    return { hPath: hPath.detach(), vPath: vPath.detach(), hLabels, vLabels };
  }, [view, width, height, effectiveZoom]);

  return (
    <>
      <View style={[styles.h, { width }]} pointerEvents="none">
        <Canvas style={{ width, height: RULER_SIZE }}>
          <Rect x={0} y={0} width={width} height={RULER_SIZE} color={colors.bg2} />
          <Path path={data.hPath} color={colors.textDim} style="stroke" strokeWidth={1} transform={[{ translateX: RULER_SIZE }]} />
          <Line p1={{ x: 0, y: RULER_SIZE - 0.5 }} p2={{ x: width, y: RULER_SIZE - 0.5 }} color={colors.border} strokeWidth={1} />
        </Canvas>
        {data.hLabels.map((l) => (
          <Text key={l.x} style={[styles.hLabel, { left: l.x + RULER_SIZE }]}>
            {l.text}
          </Text>
        ))}
        <Text style={styles.unit}>{units}</Text>
      </View>
      <View style={[styles.v, { height }]} pointerEvents="none">
        <Canvas style={{ width: RULER_SIZE, height }}>
          <Rect x={0} y={0} width={RULER_SIZE} height={height} color={colors.bg2} />
          <Path path={data.vPath} color={colors.textDim} style="stroke" strokeWidth={1} transform={[{ translateY: RULER_SIZE }]} />
          <Line p1={{ x: RULER_SIZE - 0.5, y: 0 }} p2={{ x: RULER_SIZE - 0.5, y: height }} color={colors.border} strokeWidth={1} />
        </Canvas>
        {data.vLabels.map((l) => (
          <Text key={l.y} style={[styles.vLabel, { top: l.y + RULER_SIZE }]}>
            {l.text}
          </Text>
        ))}
      </View>
    </>
  );
}

function fmt(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/\.?0+$/, '');
}

const styles = StyleSheet.create({
  h: { position: 'absolute', left: 0, top: 0, height: RULER_SIZE, zIndex: 2 },
  v: { position: 'absolute', left: 0, top: 0, width: RULER_SIZE, zIndex: 2 },
  hLabel: { position: 'absolute', top: 1, color: colors.textMuted, fontSize: 9, fontFamily: font.mono },
  vLabel: { position: 'absolute', left: 1, color: colors.textMuted, fontSize: 9, fontFamily: font.mono, transform: [{ rotate: '-90deg' }], transformOrigin: 'left top', width: 40 } as never,
  unit: { position: 'absolute', left: 3, top: 3, color: colors.textDim, fontSize: 9 },
});
