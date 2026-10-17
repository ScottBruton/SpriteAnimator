import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, font, spacing } from '@/theme/tokens';

export interface ButtonProps {
  label?: string;
  icon?: string;
  onPress?: () => void;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  primary?: boolean;
  small?: boolean;
  title?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Compact editor button. `icon` is a short glyph/text rendered before the label. */
export function Button({ label, icon, onPress, active, disabled, danger, primary, small, title, style, testID }: ButtonProps) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={title ?? label ?? icon}
      testID={testID}
      {...(title ? ({ title } as object) : {})}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.base,
        small && styles.small,
        active && styles.active,
        primary && styles.primary,
        danger && styles.danger,
        hovered && !disabled && styles.hover,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <View style={styles.row}>
        {icon ? <Text style={[styles.icon, active && styles.activeText, primary && styles.primaryText]}>{icon}</Text> : null}
        {label ? <Text style={[styles.label, small && styles.smallLabel, active && styles.activeText, primary && styles.primaryText, danger && styles.dangerText]}>{label}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: spacing.md,
    height: 24,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'transparent',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  small: { height: 20, paddingHorizontal: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  icon: { color: colors.textMuted, fontSize: font.md, fontFamily: font.mono },
  label: { color: colors.text, fontSize: font.md },
  smallLabel: { fontSize: font.sm },
  hover: { backgroundColor: colors.hover },
  pressed: { backgroundColor: colors.bg4 },
  active: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  activeText: { color: '#cfe0ff' },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  primaryText: { color: '#fff' },
  danger: { borderColor: colors.danger },
  dangerText: { color: colors.danger },
  disabled: { opacity: 0.4 },
});
