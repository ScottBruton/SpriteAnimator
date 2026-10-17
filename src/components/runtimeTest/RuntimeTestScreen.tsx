import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import type { AssemblyPackage, Direction } from '@elemental/asset-schema';
import { DIRECTIONS } from '@elemental/asset-schema';
import { ElementalUnit, ImageRegistry, loadAssemblyPackage } from '@elemental/animation-runtime';
import { unzip } from '@/exporters/zip';
import { pickFiles } from '@/importers/pickFiles';
import { utf8Decode } from '@/utils/base64';
import { colors, font, spacing } from '@/theme/tokens';
import { Button } from '../ui/Button';
import { Checkbox, NumberField, Row, Select } from '../ui/Fields';

/**
 * Loads an exported package from disk and renders it with `ElementalUnit` using a private image
 * registry, exactly as a consuming game would. Nothing here touches editor stores.
 */
export function RuntimeTestScreen() {
  const [pkg, setPkg] = useState<AssemblyPackage | null>(null);
  const [images, setImages] = useState<Map<string, Uint8Array>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | undefined>(undefined);
  const [direction, setDirection] = useState<Direction>('S');
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [scale, setScale] = useState(1);
  const [events, setEvents] = useState<string[]>([]);
  const registry = useMemo(() => new ImageRegistry(), []);

  const load = async () => {
    setError(null);
    try {
      const [f] = await pickFiles({ types: ['application/zip', 'application/json', '.zip', '.json'], multiple: false });
      if (!f) return;
      const map = new Map<string, Uint8Array>();
      let loaded: AssemblyPackage;
      if (f.name.toLowerCase().endsWith('.zip')) {
        const entries = await unzip(f.bytes);
        const asm = entries.find((e) => e.path.endsWith('assembly.json'));
        if (!asm) throw new Error('assembly.json not found in ZIP');
        const root = asm.path.slice(0, asm.path.length - 'assembly.json'.length);
        loaded = loadAssemblyPackage(utf8Decode(asm.bytes));
        for (const e of entries) if (e.path.startsWith(root)) map.set(e.path.slice(root.length), e.bytes);
      } else {
        loaded = loadAssemblyPackage(utf8Decode(f.bytes));
      }
      registry.dispose();
      setImages(map);
      setPkg(loaded);
      setAction(loaded.assembly.defaultActionId ?? loaded.assembly.actions[0]?.id);
      setDirection(loaded.assembly.defaultDirection);
      setEvents([]);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const resolveImage = (asset: { imagePath: string }) => images.get(asset.imagePath);
  const pushEvent = (s: string) => setEvents((ev) => [`${new Date().toLocaleTimeString()} ${s}`, ...ev].slice(0, 20));

  return (
    <View style={styles.root}>
      <View style={styles.bar}>
        <Text style={styles.title}>Runtime test (standalone @elemental/animation-runtime)</Text>
        <Button label="Load exported ZIP / JSON…" primary onPress={load} />
        <View style={{ flex: 1 }} />
        <Link href="/" asChild>
          <Button label="← Back to editor" />
        </Link>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {pkg ? (
        <View style={styles.body}>
          <ScrollView style={styles.side} contentContainerStyle={styles.sideContent}>
            <Text style={styles.h}>{pkg.assembly.name}</Text>
            <Text style={styles.meta}>
              schema {pkg.schemaVersion} · {pkg.assembly.sprites.length} sprites · {pkg.assets.length} images ({images.size ? `${[...pkg.assets].filter((a) => images.has(a.imagePath)).length} found in ZIP` : 'no image files — JSON only'})
            </Text>
            <Text style={styles.meta}>generator: {pkg.generator ?? '–'} · exported {pkg.exportedAt ?? '–'}</Text>
            <Select label="Action" value={action ?? ''} options={pkg.assembly.actions.map((a) => ({ value: a.id, label: a.name }))} onChange={setAction} compact />
            <Select label="Direction" value={direction} options={DIRECTIONS.map((d) => ({ value: d, label: d }))} onChange={setDirection} compact />
            <Row>
              <Checkbox label="Playing" value={playing} onChange={setPlaying} />
              <NumberField label="Speed" value={speed} min={0} max={4} step={0.25} onChange={setSpeed} width={80} />
              <NumberField label="Scale" value={scale} min={0.1} max={8} step={0.25} onChange={setScale} width={80} />
            </Row>
            <Text style={styles.h}>Events</Text>
            {events.length === 0 ? <Text style={styles.meta}>Action complete / loop / audio events appear here.</Text> : null}
            {events.map((e, i) => (
              <Text key={i} style={styles.event}>
                {e}
              </Text>
            ))}
            <Text style={styles.h}>Actions</Text>
            {pkg.assembly.actions.map((a) => (
              <Text key={a.id} style={styles.meta}>
                {a.name} — {a.duration.toFixed(2)}s, {a.fps} fps, {a.loop ? 'loop' : 'once'}, {a.tracks.length} tracks
              </Text>
            ))}
          </ScrollView>
          <View style={styles.stage}>
            <ElementalUnit
              assembly={pkg}
              resolveImage={resolveImage}
              registry={registry}
              action={action}
              direction={direction}
              playing={playing}
              speed={speed}
              scale={scale}
              width={600}
              height={600}
              onActionComplete={(ch, id) => pushEvent(`complete ${ch}:${id}`)}
              onActionLoop={(ch, id) => pushEvent(`loop ${ch}:${id}`)}
              onAudioEvent={(ev) => pushEvent(`audio ${ev.assetId}`)}
              style={styles.unit}
            />
          </View>
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.meta}>Export an assembly from the editor (File → Export assembly…), then load the ZIP here to verify the runtime reproduces it without the editor.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg0 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, backgroundColor: colors.bg2, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  error: { color: colors.danger, padding: spacing.md },
  body: { flex: 1, flexDirection: 'row' },
  side: { width: 360, backgroundColor: colors.bg1, borderRightWidth: 1, borderRightColor: colors.border },
  sideContent: { padding: spacing.lg, gap: spacing.sm },
  h: { color: colors.text, fontSize: font.lg, fontWeight: '600', marginTop: spacing.md },
  meta: { color: colors.textMuted, fontSize: font.sm, lineHeight: 16 },
  event: { color: colors.textMuted, fontSize: font.xs, fontFamily: font.mono },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  unit: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.canvas },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
});
