import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { colors, font, spacing } from '@/theme/tokens';
import { Button } from './Button';

export interface DialogProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  height?: number;
  /** Disable scrolling of the body (for canvases). */
  noScroll?: boolean;
  /**
   * When true, the dialog can be dragged larger from the bottom-right corner.
   * `width` / `height` are the preferred size and the resize floor when the
   * window is large enough; the dialog is always clamped to the viewport.
   */
  resizable?: boolean;
}

export function Dialog({
  visible,
  title,
  onClose,
  children,
  footer,
  width = 520,
  height,
  noScroll,
  resizable = false,
}: DialogProps) {
  const win = useWindowDimensions();
  // Always fit inside the window — preferred size must not force overflow.
  const maxW = Math.max(280, win.width - 16);
  const maxH = Math.max(200, win.height - 16);
  const minW = Math.min(width, maxW);
  const minH = Math.min(height ?? 320, maxH);
  const [size, setSize] = useState({ w: minW, h: height != null ? minH : undefined });
  const resizeStart = useRef({ w: minW, h: minH });

  // Re-clamp when the window or preferred size changes.
  useEffect(() => {
    setSize((s) => ({
      w: Math.min(Math.max(s.w, minW), maxW),
      h: height != null || s.h != null ? Math.min(Math.max(s.h ?? minH, minH), maxH) : undefined,
    }));
  }, [minW, minH, maxW, maxH, height]);

  const resizePan = usePanGesture({
    runOnJS: true,
    minDistance: 0,
    activeCursor: 'nwse-resize',
    onBegin: () => {
      resizeStart.current = { w: size.w, h: size.h ?? minH };
    },
    onUpdate: (e) => {
      setSize({
        w: Math.max(minW, Math.min(maxW, resizeStart.current.w + e.translationX)),
        h: Math.max(minH, Math.min(maxH, resizeStart.current.h + e.translationY)),
      });
    },
  });

  const w = Math.min(resizable ? size.w : width, maxW);
  const h = height != null || (resizable && size.h != null) ? Math.min(resizable ? (size.h ?? minH) : height!, maxH) : undefined;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.dialog, { width: w, maxWidth: maxW }, h ? { height: h, maxHeight: maxH } : { maxHeight: maxH }]}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Button icon="✕" onPress={onClose} small title="Close" />
          </View>
          {noScroll ? <View style={styles.bodyNoScroll}>{children}</View> : <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>{children}</ScrollView>}
          {footer ? <View style={styles.footer}>{footer}</View> : null}
          {resizable ? (
            <GestureDetector gesture={resizePan}>
              <View style={styles.resizeHandle} accessibilityLabel="Resize dialog">
                <View style={styles.resizeGrip} />
              </View>
            </GestureDetector>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

export function ConfirmDialog({ visible, title, message, confirmLabel = 'OK', danger, onConfirm, onCancel }: { visible: boolean; title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Dialog
      visible={visible}
      title={title}
      onClose={onCancel}
      width={380}
      footer={
        <>
          <Button label="Cancel" onPress={onCancel} />
          <Button label={confirmLabel} onPress={onConfirm} primary={!danger} danger={danger} />
        </>
      }
    >
      <Text style={styles.message}>{message}</Text>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  dialog: { backgroundColor: colors.bg1, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 4, overflow: 'hidden', position: 'relative' },
  header: { height: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: spacing.lg, paddingRight: spacing.sm, backgroundColor: colors.bg2, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { color: colors.text, fontSize: font.lg, fontWeight: '600' },
  body: { flexGrow: 0 },
  bodyContent: { padding: spacing.lg, gap: spacing.md },
  bodyNoScroll: { flex: 1, minHeight: 0, minWidth: 0 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg2 },
  message: { color: colors.text, fontSize: font.md, lineHeight: 18 },
  resizeHandle: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 18,
    height: 18,
    zIndex: 10,
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    padding: 3,
    cursor: 'nwse-resize',
  } as never,
  resizeGrip: {
    width: 10,
    height: 10,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: colors.textDim,
    opacity: 0.85,
  },
});
