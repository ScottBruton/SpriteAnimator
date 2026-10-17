import { z } from 'zod';
import { IdSchema, Vector2Schema } from './primitives';

export const INTERPOLATIONS = ['step', 'linear', 'ease-in', 'ease-out', 'ease-in-out', 'bezier'] as const;
export const InterpolationSchema = z.enum(INTERPOLATIONS);
export type Interpolation = z.infer<typeof InterpolationSchema>;

/** Cubic Bézier easing control points (CSS-style, x in [0,1]). */
export const BezierHandlesSchema = z.object({
  x1: z.number().min(0).max(1),
  y1: z.number(),
  x2: z.number().min(0).max(1),
  y2: z.number(),
});
export type BezierHandles = z.infer<typeof BezierHandlesSchema>;

function keyframeSchema<T extends z.ZodTypeAny>(value: T) {
  return z.object({
    /** Seconds from the start of the action. Independent of render frame rate. */
    time: z.number().nonnegative(),
    value,
    /** Interpolation used from this keyframe to the next one. */
    interpolation: InterpolationSchema.default('linear'),
    bezier: BezierHandlesSchema.optional(),
  });
}

export const NumberKeyframeSchema = keyframeSchema(z.number());
export const Vector2KeyframeSchema = keyframeSchema(Vector2Schema);
export const BooleanKeyframeSchema = keyframeSchema(z.boolean());
export type NumberKeyframe = z.infer<typeof NumberKeyframeSchema>;
export type Vector2Keyframe = z.infer<typeof Vector2KeyframeSchema>;
export type BooleanKeyframe = z.infer<typeof BooleanKeyframeSchema>;
export type Keyframe<T> = { time: number; value: T; interpolation: Interpolation; bezier?: BezierHandles };

export const TRACK_PROPERTIES = ['position', 'rotation', 'scale', 'opacity', 'visible', 'ikTarget', 'ikInfluence'] as const;
export type TrackProperty = (typeof TRACK_PROPERTIES)[number];

/**
 * Typed animation tracks. `targetId` references a sprite instance (or IK constraint for ik* tracks).
 * Instances are matched by `slotId` when the assembly is evaluated in a different direction.
 */
export const AnimationTrackSchema = z.discriminatedUnion('property', [
  z.object({ targetId: IdSchema, property: z.literal('position'), keyframes: z.array(Vector2KeyframeSchema) }),
  z.object({ targetId: IdSchema, property: z.literal('rotation'), keyframes: z.array(NumberKeyframeSchema) }),
  z.object({ targetId: IdSchema, property: z.literal('scale'), keyframes: z.array(Vector2KeyframeSchema) }),
  z.object({ targetId: IdSchema, property: z.literal('opacity'), keyframes: z.array(NumberKeyframeSchema) }),
  z.object({ targetId: IdSchema, property: z.literal('visible'), keyframes: z.array(BooleanKeyframeSchema) }),
  z.object({ targetId: IdSchema, property: z.literal('ikTarget'), keyframes: z.array(Vector2KeyframeSchema) }),
  z.object({ targetId: IdSchema, property: z.literal('ikInfluence'), keyframes: z.array(NumberKeyframeSchema) }),
]);
export type AnimationTrack = z.infer<typeof AnimationTrackSchema>;

export const AudioEventSchema = z.object({
  id: IdSchema,
  assetId: IdSchema,
  /** Seconds from the start of the action. */
  time: z.number().nonnegative(),
  volume: z.number().min(0).max(1).default(1),
  playbackRate: z.number().positive().default(1),
  trimStart: z.number().nonnegative().optional(),
  trimEnd: z.number().nonnegative().optional(),
  fadeIn: z.number().nonnegative().optional(),
  fadeOut: z.number().nonnegative().optional(),
  loop: z.boolean().default(false),
});
export type AudioEvent = z.infer<typeof AudioEventSchema>;

/** Restricts which instances / properties an action (or channel) may drive. */
export const AnimationMaskSchema = z.object({
  instanceIds: z.array(IdSchema).optional(),
  properties: z.array(z.enum(TRACK_PROPERTIES)).optional(),
});
export type AnimationMask = z.infer<typeof AnimationMaskSchema>;

export const AnimationActionSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  /** Seconds. */
  duration: z.number().positive(),
  /** Authoring frame rate used for timeline snapping only. */
  fps: z.number().positive().default(30),
  loop: z.boolean().default(true),
  tracks: z.array(AnimationTrackSchema).default([]),
  audioEvents: z.array(AudioEventSchema).default([]),
  /** Default channel this action plays on. */
  channelId: IdSchema.optional(),
  mask: AnimationMaskSchema.optional(),
});
export type AnimationAction = z.infer<typeof AnimationActionSchema>;

export const BlendModeSchema = z.enum(['override', 'additive']);
export type BlendMode = z.infer<typeof BlendModeSchema>;

/**
 * Independent animation channel. Channels are evaluated in ascending `priority`; later (higher
 * priority) channels override or add to earlier ones according to `blendMode`, limited by `mask`.
 */
export const AnimationChannelSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  priority: z.number().int().default(0),
  blendMode: BlendModeSchema.default('override'),
  mask: AnimationMaskSchema.optional(),
  defaultActionId: IdSchema.optional(),
});
export type AnimationChannel = z.infer<typeof AnimationChannelSchema>;

export const BASE_CHANNEL_ID = 'base';
