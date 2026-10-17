import type { AnimationTrack, Keyframe, Vector2 } from '@elemental/asset-schema';
import { lerp } from '../math/angles';
import { vlerp } from '../math/vec2';
import { applyInterpolation } from './easing';

export const TIME_EPSILON = 1e-6;

/** Index of the last keyframe with `time <= t` (binary search). -1 if `t` precedes all keys. */
export function findKeyIndex<T>(keys: readonly Keyframe<T>[], t: number): number {
  let lo = 0;
  let hi = keys.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((keys[mid] as Keyframe<T>).time <= t + TIME_EPSILON) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

function sampleGeneric<T>(keys: readonly Keyframe<T>[], t: number, mix: (a: T, b: T, u: number) => T): T | undefined {
  if (keys.length === 0) return undefined;
  const i = findKeyIndex(keys, t);
  if (i < 0) return (keys[0] as Keyframe<T>).value;
  if (i >= keys.length - 1) return (keys[keys.length - 1] as Keyframe<T>).value;
  const a = keys[i] as Keyframe<T>;
  const b = keys[i + 1] as Keyframe<T>;
  const span = b.time - a.time;
  if (span <= TIME_EPSILON) return b.value;
  const u = (t - a.time) / span;
  const e = applyInterpolation(u, a.interpolation, a.bezier);
  return mix(a.value, b.value, e);
}

/**
 * Rotation keyframes interpolate raw values (no shortest-path wrapping) so that deliberate
 * rotations past 360° (e.g. 0 → 720) spin as authored.
 */
export const sampleNumber = (keys: readonly Keyframe<number>[], t: number) => sampleGeneric(keys, t, lerp);
export const sampleVector2 = (keys: readonly Keyframe<Vector2>[], t: number) => sampleGeneric(keys, t, vlerp);
export const sampleBoolean = (keys: readonly Keyframe<boolean>[], t: number) =>
  sampleGeneric(keys, t, (a, b, u) => (u >= 1 ? b : a));

export type TrackValue = number | Vector2 | boolean;

export function sampleTrack(track: AnimationTrack, t: number): TrackValue | undefined {
  switch (track.property) {
    case 'position':
    case 'scale':
    case 'ikTarget':
      return sampleVector2(track.keyframes, t);
    case 'rotation':
    case 'opacity':
    case 'ikInfluence':
      return sampleNumber(track.keyframes, t);
    case 'visible':
      return sampleBoolean(track.keyframes, t);
    default:
      return undefined;
  }
}

/** Wrap or clamp an absolute time into the action's range. */
export function resolveActionTime(time: number, duration: number, loop: boolean): number {
  if (duration <= 0) return 0;
  if (loop) {
    const t = time % duration;
    return t < 0 ? t + duration : t;
  }
  return time < 0 ? 0 : time > duration ? duration : time;
}

/** Keyframe times that fall exactly (within epsilon) on `time`, used by the timeline editor. */
export function hasKeyAt<T>(keys: readonly Keyframe<T>[], time: number): boolean {
  const i = findKeyIndex(keys, time);
  return i >= 0 && Math.abs((keys[i] as Keyframe<T>).time - time) <= TIME_EPSILON;
}

/** Insert or replace a keyframe keeping the array sorted by time. Returns a new array. */
export function upsertKeyframe<T>(keys: readonly Keyframe<T>[], key: Keyframe<T>): Keyframe<T>[] {
  const out = keys.filter((k) => Math.abs(k.time - key.time) > TIME_EPSILON);
  out.push(key);
  out.sort((a, b) => a.time - b.time);
  return out;
}
