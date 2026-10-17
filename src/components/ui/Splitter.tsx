import React, { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { colors } from '@/theme/tokens';

export interface SplitterProps {
  orientation: 'vertical' | 'horizontal';
  /** Current size of the panel being resized. */
  size: number;
  onResize: (size: number) => void;
  min?: number;
  max?: number;
  /** Direction multiplier: +1 when dragging right/down grows the panel, -1 otherwise. */
  sign?: 1 | -1;
}

/** Draggable divider between panels. */
export function Splitter({ orientation, size, onResize, min = 120, max = 800, sign = 1 }: SplitterProps) {
  const start = useRef(size);
  const pan = usePanGesture({
    runOnJS: true,
    minDistance: 0,
    activeCursor: orientation === 'vertical' ? 'col-resize' : 'row-resize',
    onBegin: () => {
      start.current = size;
    },
    onUpdate: (e) => {
      const delta = orientation === 'vertical' ? e.translationX : e.translationY;
      onResize(Math.max(min, Math.min(max, start.current + sign * delta)));
    },
  });
  return (
    <GestureDetector gesture={pan}>
      <View style={[styles.base, orientation === 'vertical' ? styles.vertical : styles.horizontal]} />
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: colors.border },
  vertical: { width: 4, height: '100%', cursor: 'col-resize' } as never,
  horizontal: { height: 4, width: '100%', cursor: 'row-resize' } as never,
});
