import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, font, spacing } from '@/theme/tokens';

export interface NumberFieldProps {
  label?: string;
  value: number;
  onChange: (v: number) => void;
  /** Called on each keystroke with a valid number (transient). */
  onChangeLive?: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  precision?: number;
  suffix?: string;
  width?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Numeric input that commits on blur/submit and supports +/- nudges. */
export function NumberField({ label, value, onChange, onChangeLive, step = 1, min, max, precision = 2, suffix, width, disabled, style }: NumberFieldProps) {
  const fmt = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 10 ** precision) / 10 ** precision) : '');
  const [text, setText] = useState(fmt(value));
  const [focused, setFocused] = useState(false);
  // Sync the displayed text when the external value changes while not editing.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (!focused) setText(fmt(value));
  }

  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const commit = (raw: string) => {
    const v = Number(raw.replace(',', '.'));
    if (Number.isFinite(v)) onChange(clamp(v));
    else setText(fmt(value));
  };
  const nudge = (d: number) => {
    const v = clamp(value + d);
    setText(fmt(v));
    onChange(v);
  };

  return (
    <View style={[styles.fieldRow, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.numberBox, disabled && styles.disabled, width ? { width } : null]}>
        <Pressable onPress={() => nudge(-step)} style={styles.nudge} disabled={disabled}>
          <Text style={styles.nudgeText}>−</Text>
        </Pressable>
        <TextInput
          value={text}
          editable={!disabled}
          onChangeText={(t) => {
            setText(t);
            const v = Number(t.replace(',', '.'));
            if (onChangeLive && Number.isFinite(v) && t.trim() !== '') onChangeLive(clamp(v));
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commit(text);
          }}
          onSubmitEditing={() => commit(text)}
          keyboardType="numbers-and-punctuation"
          selectTextOnFocus
          style={styles.input}
        />
        {suffix ? <Text style={styles.suffix}>{suffix}</Text> : null}
        <Pressable onPress={() => nudge(step)} style={styles.nudge} disabled={disabled}>
          <Text style={styles.nudgeText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

export interface TextFieldProps {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: number;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
  onSubmit?: () => void;
}

export function TextField({ label, value, onChange, placeholder, width, autoFocus, style, onSubmit }: TextFieldProps) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (!focused) setText(value);
  }
  return (
    <View style={[styles.fieldRow, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        value={text}
        onChangeText={setText}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (text !== value) onChange(text);
        }}
        onSubmitEditing={() => {
          if (text !== value) onChange(text);
          onSubmit?.();
        }}
        placeholder={placeholder}
        placeholderTextColor={colors.textDim}
        autoFocus={autoFocus}
        style={[styles.textInput, width ? { width } : { flex: 1 }]}
      />
    </View>
  );
}

export function Checkbox({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Pressable onPress={() => !disabled && onChange(!value)} style={[styles.checkRow, disabled && styles.disabled]} accessibilityRole="checkbox" accessibilityState={{ checked: value }}>
      <View style={[styles.checkBox, value && styles.checkBoxOn]}>{value ? <Text style={styles.checkMark}>✓</Text> : null}</View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

/** Compact segmented/select control. Renders as a row of toggles for ≤ 5 options, cycling button otherwise. */
export function Select<T extends string>({ label, value, options, onChange, compact }: { label?: string; value: T; options: SelectOption<T>[]; onChange: (v: T) => void; compact?: boolean }) {
  if (options.length <= 5 && !compact) {
    return (
      <View style={styles.fieldRow}>
        {label ? <Text style={styles.label}>{label}</Text> : null}
        <View style={styles.segment}>
          {options.map((o) => (
            <Pressable key={o.value} onPress={() => onChange(o.value)} style={[styles.segmentItem, o.value === value && styles.segmentItemOn]}>
              <Text style={[styles.segmentText, o.value === value && styles.segmentTextOn]}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const next = () => onChange(options[(idx + 1) % options.length]!.value);
  return (
    <View style={styles.fieldRow}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Pressable onPress={next} style={styles.cycle}>
        <Text style={styles.segmentTextOn}>{options[idx]?.label ?? value} ▾</Text>
      </Pressable>
    </View>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Label({ children, dim }: { children: React.ReactNode; dim?: boolean }) {
  return <Text style={[styles.label, dim && { color: colors.textDim }]}>{children}</Text>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

const styles = StyleSheet.create({
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  label: { color: colors.textMuted, fontSize: font.sm, minWidth: 14 },
  sectionTitle: { color: colors.textDim, fontSize: font.xs, letterSpacing: 1, textTransform: 'uppercase', marginTop: spacing.md, marginBottom: spacing.xs },
  numberBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 3,
    height: 22,
    minWidth: 72,
  },
  nudge: { width: 16, height: 20, alignItems: 'center', justifyContent: 'center' },
  nudgeText: { color: colors.textDim, fontSize: font.md },
  input: { flex: 1, color: colors.text, fontSize: font.sm, paddingVertical: 0, paddingHorizontal: 2, textAlign: 'right', minWidth: 34, fontFamily: font.mono, outlineStyle: 'none' } as never,
  suffix: { color: colors.textDim, fontSize: font.xs, paddingRight: 2 },
  textInput: {
    backgroundColor: colors.bg0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 3,
    height: 22,
    color: colors.text,
    fontSize: font.sm,
    paddingHorizontal: 6,
    paddingVertical: 0,
    outlineStyle: 'none',
  } as never,
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 22 },
  checkBox: { width: 14, height: 14, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg0 },
  checkBoxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkMark: { color: '#fff', fontSize: 10, lineHeight: 12 },
  segment: { flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: 3, overflow: 'hidden' },
  segmentItem: { paddingHorizontal: 8, height: 20, justifyContent: 'center', backgroundColor: colors.bg0 },
  segmentItemOn: { backgroundColor: colors.accentSoft },
  segmentText: { color: colors.textMuted, fontSize: font.sm },
  segmentTextOn: { color: colors.text, fontSize: font.sm },
  cycle: { paddingHorizontal: 8, height: 22, justifyContent: 'center', backgroundColor: colors.bg0, borderWidth: 1, borderColor: colors.border, borderRadius: 3 },
  disabled: { opacity: 0.4 },
});
