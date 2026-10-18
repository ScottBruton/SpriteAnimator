import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AssemblyCategory } from '@elemental/asset-schema';
import { ASSEMBLY_CATEGORY_ROOT, FACING_ANGLE_STEMS } from '@elemental/asset-schema';
import { createNewEntity } from '@/engine/commands';
import { useEditorStore } from '@/state/editorStore';
import { colors, font, spacing } from '@/theme/tokens';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Select, TextField } from '../ui/Fields';

const CATEGORIES: { value: AssemblyCategory; label: string; hint: string }[] = [
  { value: 'unit', label: 'Unit', hint: 'Idle, Walk, Attack · 8 facings' },
  { value: 'structure', label: 'Structure', hint: 'Idle · 8 facings' },
  { value: 'resource', label: 'Resource', hint: 'Idle · 8 facings' },
  { value: 'terrain', label: 'Terrain', hint: 'Idle · 8 facings' },
];

export function CreateEntityDialog({ onClose }: { onClose: () => void }) {
  const [category, setCategory] = useState<AssemblyCategory>('unit');
  const [name, setName] = useState('');
  const setStatus = useEditorStore((s) => s.setStatus);
  const root = ASSEMBLY_CATEGORY_ROOT[category];
  const base = name.trim() ? `${root}/${name.trim()}` : `${root}/…`;
  const anglesPreview = FACING_ANGLE_STEMS.join(', ');

  const create = () => {
    const n = name.trim();
    if (!n) {
      setStatus('Enter a name', 'error');
      return;
    }
    createNewEntity(category, n);
    setStatus(`Created ${category} “${n}” with facing folders ${anglesPreview}`, 'success');
    onClose();
  };

  return (
    <Dialog
      visible
      title="Create new"
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button label="Cancel" onPress={onClose} />
          <Button label="Create" primary onPress={create} />
        </>
      }
    >
      <Select
        label="Type"
        value={category}
        options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
        onChange={setCategory}
      />
      <Text style={styles.hint}>{CATEGORIES.find((c) => c.value === category)?.hint}</Text>
      <TextField label="Name" value={name} onChange={setName} placeholder="e.g. Frost Snowman" autoFocus onSubmit={create} />
      <View style={styles.pathBox}>
        <Text style={styles.pathLabel}>Assembly + asset library</Text>
        <Text style={styles.path}>{base}</Text>
        <Text style={styles.path}>
          {base}/{'{'}
          {anglesPreview}
          {'}'}
        </Text>
        {category === 'unit' ? <Text style={styles.path}>{base}/Projectiles</Text> : null}
        <Text style={styles.hint}>
          Eight facing folders hold that angle’s PNGs (import into Asset Library → pick 000, 045, …). Compass directions are wired to
          match. These folders appear under Assets, not under Assemblies.
        </Text>
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.textDim, fontSize: font.xs, lineHeight: 15 },
  pathBox: { gap: spacing.xs, marginTop: spacing.sm, padding: spacing.md, backgroundColor: colors.bg0, borderRadius: 3, borderWidth: 1, borderColor: colors.border },
  pathLabel: { color: colors.textMuted, fontSize: font.xs, letterSpacing: 1, textTransform: 'uppercase' },
  path: { color: colors.text, fontSize: font.md, fontFamily: font.mono },
});
