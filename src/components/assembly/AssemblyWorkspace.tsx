import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Canvas, Rect } from '@shopify/react-native-skia';
import { router } from 'expo-router';
import { GestureDetector, useTapGesture } from 'react-native-gesture-handler';
import type { AssemblyPackage, Direction } from '@elemental/asset-schema';
import { BASE_CHANNEL_ID, DIRECTIONS } from '@elemental/asset-schema';
import { RenderListView, UnitInstance, createAssetLookup, directionFromVector, sharedClock, sharedImageRegistry, useImageRegistry } from '@elemental/animation-runtime';
import { setBehavior, setDefaultAction } from '@/engine/commands';
import { buildCurrentAssemblyExport } from '@/exporters/exportService';
import { useEditorStore } from '@/state/editorStore';
import { useActiveAssembly, useProjectStore } from '@/state/projectStore';
import { colors, font, spacing } from '@/theme/tokens';
import { Button } from '../ui/Button';
import { Checkbox, NumberField, Row, SectionTitle, Select, TextField } from '../ui/Fields';
import { Panel } from '../ui/Panel';

const STANDARD_BEHAVIORS = ['idle', 'walk', 'run', 'attack', 'hit', 'death', 'cast', 'jump'];

/**
 * Assembly workspace: behaviour mapping + interactive test arena. The arena renders real
 * `UnitInstance`s from a freshly built export package, so what you see is exactly what the
 * exported runtime will produce.
 */
export function AssemblyWorkspace() {
  const assembly = useActiveAssembly();
  const project = useProjectStore((s) => s.project);
  const [customBehavior, setCustomBehavior] = useState('');
  const openDialog = useEditorStore((s) => s.openDialog);
  if (!assembly) return null;
  const actionOptions = [{ value: '', label: '— none —' }, ...assembly.actions.map((a) => ({ value: a.id, label: a.name }))];
  const behaviors = Array.from(new Set([...STANDARD_BEHAVIORS, ...Object.keys(assembly.behaviors)]));

  return (
    <View style={styles.wrap}>
      <ScrollView style={styles.side} contentContainerStyle={styles.sideContent}>
        <Panel title="Behaviours → actions" collapsible={false}>
          <Text style={styles.hint}>{"Game code calls unit.trigger('attack'); the mapping below decides which action plays."}</Text>
          <Row>
            <Text style={styles.label}>Default</Text>
            <Select value={assembly.defaultActionId ?? ''} options={actionOptions} onChange={(v) => setDefaultAction(v || undefined)} compact />
          </Row>
          {behaviors.map((b) => (
            <Row key={b}>
              <Text style={styles.label}>{b}</Text>
              <Select value={assembly.behaviors[b]?.actionId ?? ''} options={actionOptions} onChange={(v) => setBehavior(b, v || null)} compact />
            </Row>
          ))}
          <Row>
            <TextField value={customBehavior} onChange={setCustomBehavior} placeholder="custom behaviour name" />
            <Button
              label="Add"
              small
              disabled={!customBehavior.trim()}
              onPress={() => {
                const a = assembly.actions[0];
                if (a) setBehavior(customBehavior.trim(), a.id);
                setCustomBehavior('');
              }}
            />
          </Row>
        </Panel>
        <Panel title="Summary" collapsible={false}>
          <Text style={styles.body}>
            {assembly.sprites.length} sprites · {assembly.layers.length} layers · {assembly.actions.length} actions · {assembly.channels.length} channels
          </Text>
          <Text style={styles.body}>Directions: {[assembly.defaultDirection, ...assembly.directions.map((d) => d.direction)].join(', ')}</Text>
          <Text style={styles.body}>Project assets: {project.assets.length}</Text>
          <Row>
            <Button label="Export assembly…" primary onPress={() => openDialog('export')} />
            <Button label="Runtime test screen" onPress={() => router.push('/runtime-test')} />
          </Row>
        </Panel>
      </ScrollView>
      <TestArena key={assembly.id} />
    </View>
  );
}

interface ArenaUnit {
  unit: UnitInstance;
  vx: number;
  vy: number;
  walking: boolean;
}

function TestArena() {
  const assembly = useActiveAssembly();
  const projectVersion = useProjectStore((s) => s.project.updatedAt);
  const registry = useImageRegistry(sharedImageRegistry);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [count, setCount] = useState(1);
  const [scale, setScale] = useState(1);
  const [wander, setWander] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [direction, setDirection] = useState<Direction | 'auto'>('auto');
  const [, bump] = useState(0);
  const [stats, setStats] = useState({ fps: 0, evalMs: 0 });
  const [log, setLog] = useState<string[]>([]);
  const pushLog = (s: string) => setLog((l) => [`${new Date().toLocaleTimeString()} ${s}`, ...l].slice(0, 30));

  // Build an export package from the current project state (same data the ZIP would contain).
  const pkg: AssemblyPackage | null = useMemo(() => buildCurrentAssemblyExport()?.pkg ?? null, [projectVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const lookup = useMemo(() => (pkg ? createAssetLookup(pkg.assets) : () => undefined), [pkg]);
  const imagePathForAsset = useMemo(() => {
    // Exported assets have package-relative paths; the registry is keyed by project imagePath.
    const map = new Map<string, string>();
    if (assembly) for (const s of assembly.sprites) {
      const a = useProjectStore.getState().project.assets.find((x) => x.id === s.assetId) ?? useProjectStore.getState().globalAssets.find((x) => x.id === s.assetId);
      if (a) map.set(a.id, a.imagePath);
    }
    return (id: string) => map.get(id);
  }, [assembly]);

  // Units are plain runtime objects; (re)created when the package or arena settings change.
  const units = useMemo<ArenaUnit[]>(() => {
    if (!pkg) return [];
    const out: ArenaUnit[] = [];
    const cols = Math.ceil(Math.sqrt(count));
    for (let i = 0; i < count; i++) {
      const u = new UnitInstance(pkg.assembly, lookup);
      u.x = ((i % cols) + 0.5) * (size.width / Math.max(1, cols));
      u.y = (Math.floor(i / cols) + 0.5) * (size.height / Math.max(1, Math.ceil(count / cols)));
      u.scale = scale;
      u.events = {
        onActionComplete: (ch, id) => pushLog(`complete ${ch}:${pkg.assembly.actions.find((a) => a.id === id)?.name ?? id}`),
        onAudioEvent: (ev) => pushLog(`audio ${ev.assetId} @${ev.time.toFixed(2)}s`),
      };
      out.push({ unit: u, vx: 0, vy: 0, walking: false });
    }
    return out;
  }, [pkg, lookup, count, size.width, size.height, scale]);

  // Shared clock drives all units, exactly like the runtime.
  useEffect(() => {
    let frames = 0;
    let acc = 0;
    let evalAcc = 0;
    return sharedClock.subscribe((dt) => {
      const t0 = performance.now();
      for (const au of units) {
        const u = au.unit;
        if (wander) {
          if (Math.random() < 0.01) {
            au.vx = (Math.random() - 0.5) * 120;
            au.vy = (Math.random() - 0.5) * 120;
          }
          u.x += au.vx * dt;
          u.y += au.vy * dt;
          if (u.x < 0 || u.x > size.width) au.vx *= -1;
          if (u.y < 0 || u.y > size.height) au.vy *= -1;
          const moving = Math.hypot(au.vx, au.vy) > 5;
          if (moving !== au.walking) {
            au.walking = moving;
            if (moving) u.trigger('walk');
            else if (!u.trigger('idle') && u.assembly.defaultActionId) u.play(u.assembly.defaultActionId);
          }
          if (direction === 'auto' && moving) u.setDirection(directionFromVector(au.vx, au.vy, u.direction));
        }
        if (direction !== 'auto') u.setDirection(direction);
        u.advance(dt * speed);
        u.evaluate();
      }
      evalAcc += performance.now() - t0;
      frames++;
      acc += dt;
      if (acc >= 0.5) {
        setStats({ fps: Math.round(frames / acc), evalMs: Math.round((evalAcc / frames) * 100) / 100 });
        frames = 0;
        acc = 0;
        evalAcc = 0;
      }
      bump((n) => n + 1);
    });
  }, [units, wander, speed, direction, size.width, size.height]);

  const tap = useTapGesture({
    runOnJS: true,
    onDeactivate: (e) => {
      if (e.canceled) return;
      // Nearest unit gets an attack trigger.
      let best: ArenaUnit | null = null;
      let bd = Infinity;
      for (const au of units) {
        const d = Math.hypot(au.unit.x - e.x, au.unit.y - e.y);
        if (d < bd) {
          bd = d;
          best = au;
        }
      }
      if (best) {
        const ok = best.unit.trigger('attack');
        pushLog(ok ? 'trigger attack' : 'no "attack" behaviour mapped');
      }
    },
  });

  const triggerAll = (b: string) => {
    let n = 0;
    for (const au of units) if (au.unit.trigger(b)) n++;
    pushLog(`trigger ${b} → ${n}/${units.length}`);
  };
  const playAll = (actionId: string) => {
    for (const au of units) au.unit.play(actionId, { channelId: BASE_CHANNEL_ID, restart: true });
  };

  if (!assembly || !pkg) return null;
  return (
    <View style={styles.arena}>
      <View style={styles.arenaBar}>
        <Text style={styles.arenaTitle}>Test arena</Text>
        <NumberField label="Units" value={count} min={1} max={500} precision={0} onChange={(v) => setCount(Math.max(1, Math.round(v)))} width={74} />
        <NumberField label="Scale" value={scale} min={0.05} max={8} step={0.1} onChange={setScale} width={74} />
        <NumberField label="Speed" value={speed} min={0} max={4} step={0.25} onChange={setSpeed} width={74} />
        <Checkbox label="Wander" value={wander} onChange={setWander} />
        <Select<Direction | 'auto'> value={direction} options={[{ value: 'auto', label: 'auto' }, ...DIRECTIONS.map((d) => ({ value: d, label: d }))]} onChange={setDirection} compact />
        <View style={{ flex: 1 }} />
        <Text style={styles.stats}>
          {stats.fps} fps · eval {stats.evalMs} ms/frame · {pkg.assembly.sprites.length * count} sprites
        </Text>
      </View>
      <View style={styles.arenaBar}>
        {Object.keys(assembly.behaviors).map((b) => (
          <Button key={b} label={b} small onPress={() => triggerAll(b)} />
        ))}
        <View style={styles.sep} />
        {assembly.actions.map((a) => (
          <Button key={a.id} label={`▶ ${a.name}`} small onPress={() => playAll(a.id)} />
        ))}
        <Button
          label="Stop"
          small
          onPress={() => {
            for (const au of units) au.unit.stop();
          }}
        />
      </View>
      <View style={styles.arenaCanvas} onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
        <GestureDetector gesture={tap}>
          <View style={StyleSheet.absoluteFill} collapsable={false}>
            {size.width > 0 ? (
              <Canvas style={{ width: size.width, height: size.height }}>
                <Rect x={0} y={0} width={size.width} height={size.height} color={colors.bg0} />
                {units.map((au, i) => {
                  const pose = au.unit.evaluate();
                  return <RenderListView key={i} renderList={pose.renderList} images={registry} imagePathForAsset={imagePathForAsset} matrix={[au.unit.scale, 0, au.unit.x, 0, au.unit.scale, au.unit.y, 0, 0, 1]} />;
                })}
              </Canvas>
            ) : null}
          </View>
        </GestureDetector>
        <View style={styles.log} pointerEvents="none">
          {log.slice(0, 6).map((l, i) => (
            <Text key={i} style={styles.logLine}>
              {l}
            </Text>
          ))}
          <Text style={styles.logHint}>Tap a unit → trigger “attack”. Units are real runtime UnitInstances driven by the shared clock.</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, flexDirection: 'row' },
  side: { width: 340, backgroundColor: colors.bg1, borderRightWidth: 1, borderRightColor: colors.border },
  sideContent: { paddingBottom: spacing.xl },
  hint: { color: colors.textDim, fontSize: font.xs, lineHeight: 15 },
  body: { color: colors.textMuted, fontSize: font.sm },
  label: { color: colors.text, fontSize: font.sm, width: 70 },
  arena: { flex: 1, backgroundColor: colors.bg0 },
  arenaBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, minHeight: 30, backgroundColor: colors.bg2, borderBottomWidth: 1, borderBottomColor: colors.border, flexWrap: 'wrap', paddingVertical: 2 },
  arenaTitle: { color: colors.textMuted, fontSize: font.xs, letterSpacing: 1, textTransform: 'uppercase', fontWeight: '600', marginRight: spacing.sm },
  stats: { color: colors.textDim, fontSize: font.xs, fontFamily: font.mono },
  sep: { width: 1, height: 16, backgroundColor: colors.border, marginHorizontal: 2 },
  arenaCanvas: { flex: 1, overflow: 'hidden' },
  log: { position: 'absolute', left: spacing.sm, bottom: spacing.sm, backgroundColor: 'rgba(0,0,0,0.5)', padding: spacing.sm, borderRadius: 3 },
  logLine: { color: colors.textMuted, fontSize: font.xs, fontFamily: font.mono },
  logHint: { color: colors.textDim, fontSize: font.xs, marginTop: 2 },
});

export { SectionTitle };
