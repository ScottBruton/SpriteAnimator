import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, font, sizes, spacing } from '@/theme/tokens';

export interface PanelProps {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  /** When set, the body scrolls and the panel grows with flex. */
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
  flex?: number;
  padded?: boolean;
}

/** Dock panel with a dense header, optional actions and collapse toggle. */
export function Panel({ title, children, actions, collapsible = true, defaultCollapsed, scroll, style, flex, padded = true }: PanelProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? false);
  return (
    <View style={[styles.panel, flex !== undefined && !collapsed ? { flex } : null, style]}>
      <View style={styles.header}>
        <Pressable onPress={() => collapsible && setCollapsed((c) => !c)} style={styles.titleRow} accessibilityRole="button">
          {collapsible ? <Text style={styles.chevron}>{collapsed ? '▸' : '▾'}</Text> : null}
          <Text style={styles.title}>{title}</Text>
        </Pressable>
        <View style={styles.actions}>{actions}</View>
      </View>
      {collapsed ? null : scroll ? (
        <ScrollView style={styles.body} contentContainerStyle={padded ? styles.bodyPadding : undefined}>
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.body, padded && styles.bodyPadding]}>{children}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.bg1, borderBottomWidth: 1, borderBottomColor: colors.border, minHeight: sizes.panelHeader },
  header: {
    height: sizes.panelHeader,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    backgroundColor: colors.bg2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1, height: '100%' },
  chevron: { color: colors.textDim, fontSize: font.xs, width: 10 },
  title: { color: colors.textMuted, fontSize: font.xs, letterSpacing: 1, textTransform: 'uppercase', fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  body: { flex: 1, minHeight: 0 },
  bodyPadding: { padding: spacing.md, gap: spacing.sm },
});
