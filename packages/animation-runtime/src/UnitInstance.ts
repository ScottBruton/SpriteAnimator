import type { AnimationAction, AudioEvent, Direction, SpriteAsset, UnitAssembly } from '@elemental/asset-schema';
import { BASE_CHANNEL_ID } from '@elemental/asset-schema';
import { evaluatePose, resolveActionTime, type EvaluatedPose, type PlayingLayer } from '@elemental/animation-core';

export interface ChannelPlayback {
  channelId: string;
  actionId: string;
  /** Local time in seconds (unwrapped). */
  time: number;
  speed: number;
  playing: boolean;
  /** Set when a non-looping action has reached its end. */
  completed: boolean;
  /** Cross-fade weight 0..1. */
  weight: number;
  /** Previous action fading out, if any. */
  fadingOut?: { actionId: string; time: number; remaining: number; duration: number };
}

export interface UnitEvents {
  onActionComplete?: (channelId: string, actionId: string) => void;
  onAudioEvent?: (event: AudioEvent, action: AnimationAction, channelId: string) => void;
  onActionLoop?: (channelId: string, actionId: string) => void;
}

export interface PlayOptions {
  channelId?: string;
  speed?: number;
  /** Restart even if the same action is already playing. Default false. */
  restart?: boolean;
  /** Cross-fade duration in seconds. Default 0. */
  fade?: number;
  /** Start time in seconds. */
  startTime?: number;
  /** Keep the current normalised phase (used when switching directional variants). */
  preservePhase?: boolean;
}

/**
 * Per-instance animation state for one unit. Shares the immutable assembly + asset definitions
 * with every other instance; only playback state is per-instance.
 *
 * Deterministic: `advance(dt)` then `evaluate()` always produces the same pose for the same inputs.
 */
export class UnitInstance {
  readonly assembly: UnitAssembly;
  direction: Direction;
  /** World position of the unit origin (consumer-defined units, usually pixels). */
  x = 0;
  y = 0;
  scale = 1;
  visible = true;
  events: UnitEvents = {};

  private channels = new Map<string, ChannelPlayback>();
  private actionsById: Map<string, AnimationAction>;
  private lookupAsset: (id: string) => SpriteAsset | undefined;
  private cachedPose: EvaluatedPose | null = null;
  private dirty = true;

  constructor(assembly: UnitAssembly, lookupAsset: (id: string) => SpriteAsset | undefined, direction?: Direction) {
    this.assembly = assembly;
    this.lookupAsset = lookupAsset;
    this.direction = direction ?? assembly.defaultDirection;
    this.actionsById = new Map(assembly.actions.map((a) => [a.id, a]));
    if (assembly.defaultActionId && this.actionsById.has(assembly.defaultActionId)) {
      this.play(assembly.defaultActionId);
    }
  }

  setDirection(direction: Direction): void {
    if (this.direction === direction) return;
    this.direction = direction;
    this.dirty = true;
  }

  getAction(actionId: string): AnimationAction | undefined {
    return this.actionsById.get(actionId);
  }

  /** Play an action on a channel (defaults to the action's own channel or base). */
  play(actionId: string, opts: PlayOptions = {}): boolean {
    const action = this.actionsById.get(actionId);
    if (!action) return false;
    const channelId = opts.channelId ?? action.channelId ?? BASE_CHANNEL_ID;
    const current = this.channels.get(channelId);
    if (current && current.actionId === actionId && !opts.restart && !current.completed) {
      current.playing = true;
      if (opts.speed !== undefined) current.speed = opts.speed;
      return true;
    }
    let startTime = opts.startTime ?? 0;
    if (opts.preservePhase && current) {
      const prev = this.actionsById.get(current.actionId);
      if (prev) {
        const phase = resolveActionTime(current.time, prev.duration, prev.loop) / prev.duration;
        startTime = phase * action.duration;
      }
    }
    const fade = opts.fade ?? 0;
    this.channels.set(channelId, {
      channelId,
      actionId,
      time: startTime,
      speed: opts.speed ?? current?.speed ?? 1,
      playing: true,
      completed: false,
      weight: fade > 0 ? 0 : 1,
      fadingOut:
        fade > 0 && current ? { actionId: current.actionId, time: current.time, remaining: fade, duration: fade } : undefined,
    });
    this.dirty = true;
    return true;
  }

  /** Trigger a behaviour name (e.g. "attack") mapped in the assembly. */
  trigger(behavior: string, opts: PlayOptions = {}): boolean {
    const mapping = this.assembly.behaviors[behavior];
    if (!mapping) return false;
    const actionId = mapping.directional?.[this.direction] ?? mapping.actionId;
    return this.play(actionId, { channelId: mapping.channelId, ...opts });
  }

  stop(channelId?: string): void {
    if (channelId) this.channels.delete(channelId);
    else this.channels.clear();
    this.dirty = true;
  }

  pause(channelId?: string): void {
    for (const c of this.channels.values()) if (!channelId || c.channelId === channelId) c.playing = false;
  }

  resume(channelId?: string): void {
    for (const c of this.channels.values()) if (!channelId || c.channelId === channelId) c.playing = true;
  }

  /** Jump a channel to an absolute time (used by the editor timeline / scrubbing). */
  seek(time: number, channelId: string = BASE_CHANNEL_ID): void {
    const c = this.channels.get(channelId);
    if (c) {
      c.time = time;
      c.completed = false;
      this.dirty = true;
    }
  }

  getChannel(channelId: string = BASE_CHANNEL_ID): ChannelPlayback | undefined {
    return this.channels.get(channelId);
  }

  getChannels(): ChannelPlayback[] {
    return Array.from(this.channels.values());
  }

  /** Advance all channels. Fires completion / loop / audio events. */
  advance(dt: number): void {
    if (dt === 0) return;
    for (const c of this.channels.values()) {
      const action = this.actionsById.get(c.actionId);
      if (!action) continue;
      if (c.fadingOut) {
        c.fadingOut.remaining -= dt;
        c.fadingOut.time += dt * c.speed;
        c.weight = 1 - Math.max(0, c.fadingOut.remaining / c.fadingOut.duration);
        if (c.fadingOut.remaining <= 0) {
          c.fadingOut = undefined;
          c.weight = 1;
        }
      }
      if (!c.playing || c.completed) continue;
      const prev = c.time;
      const next = prev + dt * c.speed;
      this.fireAudioEvents(action, c.channelId, prev, next);
      if (action.loop) {
        if (Math.floor(next / action.duration) > Math.floor(prev / action.duration)) {
          this.events.onActionLoop?.(c.channelId, action.id);
        }
        c.time = next;
      } else if (next >= action.duration) {
        c.time = action.duration;
        c.completed = true;
        c.playing = false;
        this.events.onActionComplete?.(c.channelId, action.id);
        this.returnToDefault(c.channelId);
      } else {
        c.time = next;
      }
      this.dirty = true;
    }
  }

  private returnToDefault(channelId: string) {
    const channel = this.assembly.channels.find((ch) => ch.id === channelId);
    if (channel?.defaultActionId && this.actionsById.has(channel.defaultActionId)) {
      this.play(channel.defaultActionId, { channelId, restart: true });
    } else if (channelId !== BASE_CHANNEL_ID) {
      // Non-base channels release control when their one-shot action finishes.
      this.channels.delete(channelId);
    }
  }

  private fireAudioEvents(action: AnimationAction, channelId: string, prev: number, next: number) {
    if (!this.events.onAudioEvent || action.audioEvents.length === 0 || next <= prev) return;
    const d = action.duration;
    for (const ev of action.audioEvents) {
      if (action.loop) {
        // Count how many times `ev.time + k*d` falls in (prev, next].
        const kStart = Math.ceil((prev - ev.time) / d + 1e-9);
        const kEnd = Math.floor((next - ev.time) / d);
        for (let k = kStart; k <= kEnd; k++) {
          if (ev.time + k * d > prev && ev.time + k * d <= next) this.events.onAudioEvent(ev, action, channelId);
        }
      } else if (ev.time > prev && ev.time <= next) {
        this.events.onAudioEvent(ev, action, channelId);
      }
    }
  }

  /** Playing layers in evaluation form (including fade-out layers). */
  getPlayingLayers(): PlayingLayer[] {
    const layers: PlayingLayer[] = [];
    for (const c of this.channels.values()) {
      if (c.fadingOut) {
        layers.push({ actionId: c.fadingOut.actionId, time: c.fadingOut.time, channelId: c.channelId, weight: 1 });
      }
      layers.push({ actionId: c.actionId, time: c.time, channelId: c.channelId, weight: c.weight });
    }
    return layers;
  }

  /** Evaluate (cached until state changes). */
  evaluate(): EvaluatedPose {
    if (!this.dirty && this.cachedPose) return this.cachedPose;
    this.cachedPose = evaluatePose({
      assembly: this.assembly,
      direction: this.direction,
      layers: this.getPlayingLayers(),
      lookupAsset: this.lookupAsset,
    });
    this.dirty = false;
    return this.cachedPose;
  }

  invalidate(): void {
    this.dirty = true;
  }
}

/** Convert a movement vector into one of the eight viewing directions. */
export function directionFromVector(dx: number, dy: number, fallback: Direction = 'S'): Direction {
  if (dx === 0 && dy === 0) return fallback;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI; // 0 = east, 90 = south (y-down)
  const idx = Math.round(((angle + 360) % 360) / 45) % 8;
  const table: Direction[] = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
  return table[idx] ?? fallback;
}
