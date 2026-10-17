import type { AnimationAction, AnimationTrack, Interpolation, Transform2D, TrackProperty } from '@elemental/asset-schema';
import { upsertKeyframe } from './sampleTrack';

export type KeyableValue = {
  position: Transform2D['position'];
  rotation: number;
  rotationX: number;
  rotationY: number;
  scale: Transform2D['scale'];
  opacity: number;
  visible: boolean;
};

/**
 * Insert (or replace) a keyframe for `property` on `targetId` at `time`. Returns a new action.
 * Pure helper shared by the editor's undoable commands.
 */
export function insertKeyframe<P extends keyof KeyableValue>(
  action: AnimationAction,
  targetId: string,
  property: P,
  time: number,
  value: KeyableValue[P],
  interpolation: Interpolation = property === 'visible' ? 'step' : 'linear',
): AnimationAction {
  const tracks = [...action.tracks];
  const idx = tracks.findIndex((t) => t.targetId === targetId && t.property === property);
  const key = { time, value, interpolation } as never;
  if (idx === -1) {
    tracks.push({ targetId, property, keyframes: [key] } as AnimationTrack);
  } else {
    const track = tracks[idx] as AnimationTrack;
    tracks[idx] = { ...track, keyframes: upsertKeyframe(track.keyframes as never, key) } as AnimationTrack;
  }
  return { ...action, tracks };
}

export function removeKeyframe(action: AnimationAction, targetId: string, property: TrackProperty, time: number): AnimationAction {
  const tracks = action.tracks
    .map((t) => {
      if (t.targetId !== targetId || t.property !== property) return t;
      return { ...t, keyframes: t.keyframes.filter((k) => Math.abs(k.time - time) > 1e-6) } as AnimationTrack;
    })
    .filter((t) => t.keyframes.length > 0);
  return { ...action, tracks };
}

/** Snap a time (seconds) to the nearest frame boundary for the given fps. */
export function snapToFrame(time: number, fps: number): number {
  return Math.round(time * fps) / fps;
}

export function frameToTime(frame: number, fps: number): number {
  return frame / fps;
}

export function timeToFrame(time: number, fps: number): number {
  return Math.round(time * fps);
}

/** Distinct keyframe times across all tracks of an action (sorted). */
export function collectKeyTimes(action: AnimationAction, targetId?: string): number[] {
  const set = new Set<number>();
  for (const t of action.tracks) {
    if (targetId && t.targetId !== targetId) continue;
    for (const k of t.keyframes) set.add(Math.round(k.time * 1e6) / 1e6);
  }
  return [...set].sort((a, b) => a - b);
}
