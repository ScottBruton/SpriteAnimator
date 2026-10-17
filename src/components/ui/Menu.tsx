import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, spacing } from '@/theme/tokens';

export interface MenuItem {
  label: string;
  shortcut?: string;
  onPress?: () => void;
  disabled?: boolean;
  checked?: boolean;
  separator?: boolean;
}

export interface MenuProps {
  label: string;
  items: MenuItem[];
}

/**
 * Menu-bar dropdown. Uses a Modal so it overlays everything on web and native; position is
 * measured from the trigger.
 */
export function Menu({ label, items }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const triggerRef = React.useRef<React.ComponentRef<typeof View>>(null);

  const openMenu = () => {
    triggerRef.current?.measureInWindow((x, y, _w, h) => {
      setAnchor({ x, y: y + h });
      setOpen(true);
    });
  };

  return (
    <>
      <Pressable ref={triggerRef} onPress={openMenu} style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.trigger, (open || hovered) && styles.triggerOpen]}>
        <Text style={styles.triggerText}>{label}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
        <View style={[styles.menu, { left: anchor.x, top: anchor.y }]}>
          {items.map((item, i) =>
            item.separator ? (
              <View key={i} style={styles.separator} />
            ) : (
              <Pressable
                key={i}
                disabled={item.disabled}
                onPress={() => {
                  setOpen(false);
                  item.onPress?.();
                }}
                style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.item, hovered && !item.disabled && styles.itemHover, item.disabled && styles.itemDisabled]}
              >
                <Text style={styles.itemText}>
                  {item.checked ? '✓ ' : '   '}
                  {item.label}
                </Text>
                {item.shortcut ? <Text style={styles.shortcut}>{item.shortcut}</Text> : null}
              </Pressable>
            ),
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { paddingHorizontal: spacing.lg, height: '100%', justifyContent: 'center' },
  triggerOpen: { backgroundColor: colors.bg3 },
  triggerText: { color: colors.text, fontSize: font.md },
  menu: { position: 'absolute', minWidth: 220, backgroundColor: colors.bg2, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 3, paddingVertical: 4, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 8, elevation: 8 },
  item: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.md, height: 24 },
  itemHover: { backgroundColor: colors.accentSoft },
  itemDisabled: { opacity: 0.4 },
  itemText: { color: colors.text, fontSize: font.md, fontFamily: font.mono },
  shortcut: { color: colors.textDim, fontSize: font.xs, marginLeft: 24 },
  separator: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
});
