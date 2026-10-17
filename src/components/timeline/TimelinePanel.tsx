import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture, useTapGesture, useSimultaneousGestures } from 'react-native-gesture-handler';
import type { AnimationAction, Interpolation, TrackProperty } from '@elemental/asset-schema';
import { INTERPOLATIONS } from '@elemental/asset-schema';
import { collectKeyTimes, snapToFrame, type EvaluatedPose } from '@elemental/animation-core';
import { deleteKeyframes, keyAllTransform, moveKeyframes, patchAction, setKeyframeInterpolation } from '@/engine/commands';
import { useEditorStore } from '@/state/editorStore';
import { usePoseOverrideStore } from '@/state/poseOverrideStore';
import { useActiveAssembly, useProjectStore } from '@/state/projectStore';
import { colors, font, spacing } from '@/theme/tokens';
import { Button } from '../ui/Button';
import { Checkbox, NumberField, Select } from '../ui/Fields';

const LABEL_W = 170;
const ROW_H = 22;
const RULER_H = 22;
const PROPS: TrackProperty[] = ['position', 'rotation', 'scale', 'opacity', 'visible'];
const PROP_LABEL: Record<string, string> = { position: 'Position', rotation: 'Rotation', scale: 'Scale', opacity: 'Opacity', visible: 'Visible', ikTarget: 'IK target', ikInfluence: 'IK influence' };

type KeyRef = { targetId: string; property: TrackProperty; time: number };
const keyId = (k: KeyRef) => `${k.targetId}|${k.property}|${k.time.toFixed(6)}`;

/**
 * Keyframe timeline for the active action. Time is stored in seconds; frames are a snapping and
 * display convenience derived from the action's fps.
 */
export function TimelinePanel({ pose }: { pose: EvaluatedPose | null }) {
  const assembly = useActiveAssembly();
  const activeActionId = useEditorStore((s) => s.activeActionId);
  const action = assembly?.actions.find((a) => a.id === activeActionId);
  if (!assembly) return null;
  if (!action) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.empty}>Select or create an action in the Explorer to begin animating.</Text>
      </View>
    );
  }
  return <TimelineBody action={action} pose={pose} spriteNames={new Map(assembly.sprites.map((s) => [s.id, s.name]))} />;
}

function TimelineBody({ action, pose, spriteNames }: { action: AnimationAction; pose: EvaluatedPose | null; spriteNames: Map<string, string> }) {
  const playhead = useEditorStore((s) => s.playhead);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const playing = useEditorStore((s) => s.playing);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const speed = useEditorStore((s) => s.playbackSpeed);
  const setSpeed = useEditorStore((s) => s.setPlaybackSpeed);
  const autoKey = useEditorStore((s) => s.autoKey);
  const toggle = useEditorStore((s) => s.toggle);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const select = useEditorStore((s) => s.select);
  const selectedKeys = useEditorStore((s) => s.selectedKeys) as KeyRef[];
  const setSelectedKeys = useEditorStore((s) => s.setSelectedKeys);
  const clearOverrides = usePoseOverrideStore((s) => s.clear);
  const overrides = usePoseOverrideStore((s) => s.overrides);

  const [pxPerSecond, setPxPerSecond] = useState(240);
  const [scrollX, setScrollX] = useState(0);
  const [trackWidth, setTrackWidth] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const fps = action.fps;

  // Playback loop driven by requestAnimationFrame.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = ((now - last) / 1000) * speed;
      last = now;
      const st = useEditorStore.getState();
      let t = st.playhead + dt;
      if (t >= action.duration) {
        if (action.loop || st.loopPreview) t = t % action.duration;
        else {
          setPlayhead(action.duration);
          setPlaying(false);
          return;
        }
      }
      setPlayhead(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, action.duration, action.loop, setPlayhead, setPlaying]);

  const timeToX = (t: number) => t * pxPerSecond - scrollX;
  const xToTime = (x: number) => Math.max(0, Math.min(action.duration, (x + scrollX) / pxPerSecond));

  // Rows: one per instance with tracks (or selected), then property sub-rows.
  const rows = useMemo(() => {
    const targets = new Set<string>();
    for (const t of action.tracks) targets.add(t.targetId);
    for (const id of selectedIds) targets.add(id);
    const out: { kind: 'target' | 'prop'; targetId: string; property?: TrackProperty; keys: KeyRef[]; interp: Map<number, Interpolation> }[] = [];
    for (const targetId of targets) {
      const keyTimes = collectKeyTimes(action, targetId);
      out.push({ kind: 'target', targetId, keys: keyTimes.map((time) => ({ targetId, property: 'position', time })), interp: new Map() });
      if (collapsed.has(targetId)) continue;
      for (const property of PROPS) {
        const track = action.tracks.find((t) => t.targetId === targetId && t.property === property);
        if (!track && !selectedIds.includes(targetId)) continue;
        out.push({
          kind: 'prop',
          targetId,
          property,
          keys: (track?.keyframes ?? []).map((k) => ({ targetId, property, time: k.time })),
          interp: new Map((track?.keyframes ?? []).map((k) => [k.time, k.interpolation])),
        });
      }
    }
    return out;
  }, [action, selectedIds, collapsed]);

  const selectedKeySet = useMemo(() => new Set(selectedKeys.map(keyId)), [selectedKeys]);
  const dragRef = useRef<{ mode: 'scrub' | 'keys' | 'none'; startTime: number; lastDelta: number; keys: KeyRef[] } | null>(null);

  const keysForRow = (row: (typeof rows)[number]): KeyRef[] =>
    row.kind === 'target' ? action.tracks.filter((t) => t.targetId === row.targetId).flatMap((t) => t.keyframes.filter((k) => row.keys.some((rk) => Math.abs(rk.time - k.time) < 1e-6)).map((k) => ({ targetId: t.targetId, property: t.property, time: k.time }))) : row.keys;

  const hitKey = (x: number, y: number): { row: (typeof rows)[number]; time: number } | null => {
    const rowIdx = Math.floor((y - RULER_H) / ROW_H);
    const row = rows[rowIdx];
    if (!row) return null;
    const t = xToTime(x);
    let best: number | null = null;
    for (const k of row.keys) if (Math.abs(timeToX(k.time) - timeToX(t)) < 7 && (best === null || Math.abs(k.time - t) < Math.abs(best - t))) best = k.time;
    return best === null ? null : { row, time: best };
  };

  const pan = usePanGesture({
    runOnJS: true,
    minDistance: 0,
    onBegin: (e) => {
      if (e.y < RULER_H) {
        dragRef.current = { mode: 'scrub', startTime: 0, lastDelta: 0, keys: [] };
        setPlaying(false);
        setPlayhead(snapToFrame(xToTime(e.x), fps));
        return;
      }
      const hit = hitKey(e.x, e.y);
      if (hit) {
        const rowKeys = keysForRow(hit.row).filter((k) => Math.abs(k.time - hit.time) < 1e-6);
        const already = rowKeys.every((k) => selectedKeySet.has(keyId(k)));
        const keys = already ? selectedKeys : rowKeys;
        if (!already) setSelectedKeys(keys);
        useProjectStore.getState().beginTransaction('Move keyframes');
        dragRef.current = { mode: 'keys', startTime: xToTime(e.x), lastDelta: 0, keys };
      } else {
        dragRef.current = { mode: 'scrub', startTime: 0, lastDelta: 0, keys: [] };
        setSelectedKeys([]);
        setPlaying(false);
        setPlayhead(snapToFrame(xToTime(e.x), fps));
      }
    },
    onUpdate: (e) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.mode === 'scrub') setPlayhead(snapToFrame(xToTime(e.x), fps));
      else if (d.mode === 'keys') {
        const delta = snapToFrame(xToTime(e.x) - d.startTime, fps);
        if (delta !== d.lastDelta) {
          // Preview by moving in one undo step at the end: we move incrementally and merge visually.
          const step = delta - d.lastDelta;
          moveKeyframes(action.id, d.keys, step);
          d.keys = d.keys.map((k) => ({ ...k, time: Math.max(0, Math.min(action.duration, k.time + step)) }));
          setSelectedKeys(d.keys);
          d.lastDelta = delta;
        }
      }
    },
    onFinalize: () => {
      if (dragRef.current?.mode === 'keys') useProjectStore.getState().endTransaction();
      dragRef.current = null;
    },
  });
  const tap = useTapGesture({
    runOnJS: true,
    onDeactivate: (e) => {
      if (e.canceled) return;
      if (e.y < RULER_H) return;
      const hit = hitKey(e.x, e.y);
      if (hit) {
        setPlayhead(hit.time);
        select([hit.row.targetId]);
      }
    },
  });
  const gesture = useSimultaneousGestures(pan, tap);

  const insertKeyForSelection = () => {
    if (!pose) return;
    for (const id of selectedIds) {
      const r = pose.resolved.get(id);
      if (r) keyAllTransform(action.id, id, snapToFrame(playhead, fps), r.transform, r.opacity, r.visible);
    }
    clearOverrides(selectedIds);
  };
  const deleteSelected = () => {
    if (selectedKeys.length) {
      deleteKeyframes(action.id, selectedKeys);
      setSelectedKeys([]);
    }
  };
  const allKeyTimes = collectKeyTimes(action);
  const jump = (dir: 1 | -1) => {
    const next = dir > 0 ? allKeyTimes.find((t) => t > playhead + 1e-6) : [...allKeyTimes].reverse().find((t) => t < playhead - 1e-6);
    if (next !== undefined) setPlayhead(next);
  };
  const frame = Math.round(playhead * fps);
  const hasPendingEdits = overrides.size > 0;

  // Ruler ticks.
  const ticks = useMemo(() => {
    const out: { x: number; label?: string; major: boolean }[] = [];
    const frameW = pxPerSecond / fps;
    const every = frameW >= 24 ? 1 : frameW >= 12 ? 2 : frameW >= 6 ? 5 : frameW >= 2.4 ? 10 : Math.ceil(fps);
    const totalFrames = Math.ceil(action.duration * fps);
    for (let f = 0; f <= totalFrames; f += every) {
      const x = timeToX(f / fps);
      if (x < -20 || x > trackWidth + 20) continue;
      const major = f % fps === 0 || every >= fps;
      out.push({ x, major, label: major || every >= 5 || frameW >= 40 ? String(f) : undefined });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pxPerSecond, fps, action.duration, scrollX, trackWidth]);

  const selectedInterp: Interpolation | '' = selectedKeys.length ? (rows.find((r) => r.kind === 'prop' && r.targetId === selectedKeys[0]!.targetId && r.property === selectedKeys[0]!.property)?.interp.get(selectedKeys[0]!.time) ?? 'linear') : '';

  return (
    <View style={styles.wrap}>
      <View style={styles.transport}>
        <Button icon="⏮" small onPress={() => setPlayhead(0)} title="Go to start" />
        <Button icon="◀◆" small onPress={() => jump(-1)} title="Previous keyframe" />
        <Button icon={playing ? '⏸' : '▶'} small primary onPress={() => setPlaying(!playing)} title="Play / pause (Space)" />
        <Button icon="■" small onPress={() => { setPlaying(false); setPlayhead(0); }} title="Stop" />
        <Button icon="◆▶" small onPress={() => jump(1)} title="Next keyframe" />
        <Button icon="⏭" small onPress={() => setPlayhead(action.duration)} title="Go to end" />
        <View style={styles.sep} />
        <Text style={styles.time}>
          {playhead.toFixed(3)}s · f{frame}
        </Text>
        <View style={styles.sep} />
        <Button icon="◆" label="Key" small active={hasPendingEdits} onPress={insertKeyForSelection} title="Insert keyframe for selection (K)" disabled={selectedIds.length === 0} />
        <Button icon="✕" label="Key" small onPress={deleteSelected} title="Delete selected keyframes" disabled={selectedKeys.length === 0} />
        <Checkbox label="Auto-key" value={autoKey} onChange={() => toggle('autoKey')} />
        {hasPendingEdits ? <Button label="Discard edits" small onPress={() => clearOverrides()} title="Discard un-keyed pose edits" /> : null}
        <View style={styles.sep} />
        {selectedKeys.length ? (
          <Select<Interpolation> value={(selectedInterp || 'linear') as Interpolation} options={INTERPOLATIONS.map((i) => ({ value: i, label: i }))} compact onChange={(interpolation) => setKeyframeInterpolation(action.id, selectedKeys, interpolation)} />
        ) : null}
        <View style={{ flex: 1 }} />
        <NumberField label="Duration" value={action.duration} min={1 / fps} step={0.1} suffix="s" onChange={(duration) => patchAction(action.id, { duration }, 'Action duration')} width={84} />
        <NumberField label="FPS" value={fps} min={1} max={240} precision={0} onChange={(v) => patchAction(action.id, { fps: Math.round(v) }, 'Action fps')} width={66} />
        <Checkbox label="Loop" value={action.loop} onChange={(loop) => patchAction(action.id, { loop }, 'Action loop')} />
        <NumberField label="Speed" value={speed} min={0.05} max={4} step={0.25} suffix="×" onChange={setSpeed} width={74} />
        <Button icon="−" small onPress={() => setPxPerSecond((p) => Math.max(40, p / 1.25))} title="Zoom out" />
        <Button icon="+" small onPress={() => setPxPerSecond((p) => Math.min(4000, p * 1.25))} title="Zoom in" />
      </View>

      <View style={styles.body}>
        <View style={[styles.labels, { width: LABEL_W }]}>
          <View style={[styles.rulerLabel, { height: RULER_H }]}>
            <Text style={styles.meta}>{action.name}</Text>
          </View>
          <ScrollView scrollEnabled={false}>
            {rows.map((r) => (
              <Pressable
                key={`${r.targetId}-${r.property ?? '*'}`}
                onPress={() => {
                  if (r.kind === 'target')
                    setCollapsed((c) => {
                      const n = new Set(c);
                      if (n.has(r.targetId)) n.delete(r.targetId);
                      else n.add(r.targetId);
                      return n;
                    });
                  select([r.targetId]);
                }}
                style={[styles.labelRow, { height: ROW_H }, r.kind === 'prop' && styles.labelRowProp, selectedIds.includes(r.targetId) && r.kind === 'target' && styles.labelRowSel]}
              >
                <Text style={[styles.labelText, r.kind === 'prop' && styles.labelTextProp]} numberOfLines={1}>
                  {r.kind === 'target' ? `${collapsed.has(r.targetId) ? '▸' : '▾'} ${spriteNames.get(r.targetId) ?? r.targetId}` : PROP_LABEL[r.property!]}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <View style={styles.tracks} onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}>
          <GestureDetector gesture={gesture}>
            <View style={StyleSheet.absoluteFill} collapsable={false}>
              <View style={[styles.ruler, { height: RULER_H }]}>
                {ticks.map((t, i) => (
                  <View key={i} style={[styles.tick, { left: t.x, height: t.major ? 10 : 5 }]}>
                    {t.label !== undefined ? <Text style={styles.tickLabel}>{t.label}</Text> : null}
                  </View>
                ))}
              </View>
              {rows.map((r, ri) => (
                <View key={`${r.targetId}-${r.property ?? '*'}`} style={[styles.trackRow, { top: RULER_H + ri * ROW_H, height: ROW_H }, r.kind === 'target' && styles.trackRowTarget]}>
                  {r.keys.map((k) => {
                    const sel = r.kind === 'target' ? keysForRow(r).some((kk) => Math.abs(kk.time - k.time) < 1e-6 && selectedKeySet.has(keyId(kk))) : selectedKeySet.has(keyId(k));
                    const interp = r.interp.get(k.time);
                    return <View key={k.time} style={[styles.key, { left: timeToX(k.time) - 5 }, r.kind === 'target' && styles.keySummary, sel && styles.keySel, interp === 'step' && styles.keyStep]} />;
                  })}
                </View>
              ))}
              <View style={[styles.endLine, { left: timeToX(action.duration) }]} />
              <View style={[styles.playhead, { left: timeToX(playhead) }]} pointerEvents="none">
                <View style={styles.playheadHead} />
              </View>
            </View>
          </GestureDetector>
        </View>
      </View>
      <View style={styles.scroller}>
        <ScrollView
          horizontal
          onScroll={(e) => setScrollX(e.nativeEvent.contentOffset.x)}
          scrollEventThrottle={16}
          showsHorizontalScrollIndicator
          style={{ marginLeft: LABEL_W }}
        >
          <View style={{ width: Math.max(trackWidth, action.duration * pxPerSecond + 60), height: 8 }} />
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg1 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg1 },
  empty: { color: colors.textDim, fontSize: font.sm },
  transport: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, height: 30, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg2, flexWrap: 'nowrap' },
  sep: { width: 1, height: 16, backgroundColor: colors.border, marginHorizontal: 2 },
  time: { color: colors.text, fontSize: font.sm, fontFamily: font.mono, minWidth: 92 },
  body: { flex: 1, flexDirection: 'row' },
  labels: { backgroundColor: colors.bg2, borderRightWidth: 1, borderRightColor: colors.border },
  rulerLabel: { justifyContent: 'center', paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  labelRow: { justifyContent: 'center', paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  labelRowProp: { paddingLeft: spacing.xl + spacing.sm },
  labelRowSel: { backgroundColor: colors.accentSoft },
  labelText: { color: colors.text, fontSize: font.sm },
  labelTextProp: { color: colors.textMuted, fontSize: font.xs },
  meta: { color: colors.textDim, fontSize: font.xs },
  tracks: { flex: 1, overflow: 'hidden', backgroundColor: colors.bg0 },
  ruler: { position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: colors.bg2, borderBottomWidth: 1, borderBottomColor: colors.border },
  tick: { position: 'absolute', bottom: 0, width: 1, backgroundColor: colors.textDim },
  tickLabel: { position: 'absolute', bottom: 10, left: 2, color: colors.textMuted, fontSize: 9, fontFamily: font.mono },
  trackRow: { position: 'absolute', left: 0, right: 0, borderBottomWidth: 1, borderBottomColor: colors.border },
  trackRowTarget: { backgroundColor: colors.bg1 },
  key: { position: 'absolute', top: ROW_H / 2 - 5, width: 10, height: 10, backgroundColor: colors.keyframe, transform: [{ rotate: '45deg' }], borderWidth: 1, borderColor: colors.bg0 },
  keySummary: { backgroundColor: colors.textMuted },
  keyStep: { borderRadius: 0, transform: [], width: 8, height: 8, top: ROW_H / 2 - 4 },
  keySel: { backgroundColor: '#fff', borderColor: colors.accent },
  endLine: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: colors.borderStrong },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: colors.playhead },
  playheadHead: { position: 'absolute', top: 0, left: -5, width: 11, height: 11, backgroundColor: colors.playhead, borderBottomLeftRadius: 5, borderBottomRightRadius: 5 },
  scroller: { height: 10, backgroundColor: colors.bg2, borderTopWidth: 1, borderTopColor: colors.border },
});
