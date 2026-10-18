import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { colors, font, spacing } from '@/theme/tokens';
import { applyDomTitle, mergeTitleRef } from '@/utils/domTitle';

export interface MenuItem {
  label: string;
  shortcut?: string;
  /** Hover tooltip (browser `title` / accessibility hint). */
  tooltip?: string;
  onPress?: () => void;
  disabled?: boolean;
  checked?: boolean;
  separator?: boolean;
}

export interface MenuProps {
  label: string;
  /** Tooltip for the top-level menu trigger (File, Edit, …). */
  tooltip?: string;
  items: MenuItem[];
}

function MenuList({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return (
    <>
      {items.map((item, i) =>
        item.separator ? (
          <View key={i} style={styles.separator} />
        ) : (
          <Pressable
            key={i}
            ref={mergeTitleRef(item.tooltip ?? item.label)}
            disabled={item.disabled}
            accessibilityHint={item.tooltip}
            accessibilityLabel={item.label}
            onPress={() => {
              onClose();
              item.onPress?.();
            }}
            style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.item, hovered && !item.disabled && styles.itemHover, item.disabled && styles.itemDisabled]}
          >
            <Text style={styles.itemText} pointerEvents="none">
              {item.checked ? '✓ ' : '   '}
              {item.label}
            </Text>
            {item.shortcut ? (
              <Text style={styles.shortcut} pointerEvents="none">
                {item.shortcut}
              </Text>
            ) : null}
          </Pressable>
        ),
      )}
    </>
  );
}

/**
 * Menu-bar dropdown. Uses a Modal so it overlays everything on web and native; position is
 * measured from the trigger.
 */
export function Menu({ label, tooltip, items }: MenuProps) {
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
      <Pressable
        ref={(node) => {
          (triggerRef as React.MutableRefObject<typeof node>).current = node;
          applyDomTitle(node, tooltip);
        }}
        onPress={openMenu}
        accessibilityHint={tooltip}
        accessibilityLabel={label}
        style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.trigger, (open || hovered) && styles.triggerOpen]}
      >
        <Text style={styles.triggerText} pointerEvents="none">
          {label}
        </Text>
      </Pressable>
      <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
        <View style={[styles.menu, { left: anchor.x, top: anchor.y }]}>
          <MenuList items={items} onClose={() => setOpen(false)} />
        </View>
      </Modal>
    </>
  );
}

export interface ContextMenuProps {
  visible: boolean;
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/** Absolute-positioned context menu (right-click / long-press). `x`/`y` are window coordinates. */
export function ContextMenu({ visible, x, y, items, onClose }: ContextMenuProps) {
  const { width, height } = useWindowDimensions();
  const menuW = 240;
  const menuH = Math.min(items.length * 24 + 16, height - 16);
  const left = Math.max(8, Math.min(x, width - menuW - 8));
  const top = Math.max(8, Math.min(y, height - menuH - 8));

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={[styles.menu, { left, top, minWidth: menuW }]}>
        <MenuList items={items} onClose={onClose} />
      </View>
    </Modal>
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
