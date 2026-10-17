import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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
}

export function Dialog({ visible, title, onClose, children, footer, width = 520, height, noScroll }: DialogProps) {
  const win = useWindowDimensions();
  const w = Math.min(width, win.width - 16);
  const h = height ? Math.min(height, win.height - 16) : undefined;
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.dialog, { width: w }, h ? { height: h } : { maxHeight: win.height - 32 }]}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Button icon="✕" onPress={onClose} small title="Close" />
          </View>
          {noScroll ? <View style={styles.bodyNoScroll}>{children}</View> : <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>{children}</ScrollView>}
          {footer ? <View style={styles.footer}>{footer}</View> : null}
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
  dialog: { backgroundColor: colors.bg1, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 4, overflow: 'hidden' },
  header: { height: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: spacing.lg, paddingRight: spacing.sm, backgroundColor: colors.bg2, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { color: colors.text, fontSize: font.lg, fontWeight: '600' },
  body: { flexGrow: 0 },
  bodyContent: { padding: spacing.lg, gap: spacing.md },
  bodyNoScroll: { flex: 1, minHeight: 0 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg2 },
  message: { color: colors.text, fontSize: font.md, lineHeight: 18 },
});
