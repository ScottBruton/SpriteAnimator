import { z } from 'zod';
import { IdSchema, Transform2DSchema } from './primitives';

export const LayerSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
});
export type Layer = z.infer<typeof LayerSchema>;

export const JointTypeSchema = z.enum(['fixed', 'rotation', 'free']);
export type JointType = z.infer<typeof JointTypeSchema>;

export const JointConstraintSchema = z.object({
  type: JointTypeSchema.default('free'),
  /** Degrees, relative to the setup-pose rotation. Only used for `rotation` joints. */
  minRotation: z.number().optional(),
  maxRotation: z.number().optional(),
});
export type JointConstraint = z.infer<typeof JointConstraintSchema>;

/**
 * A placed sprite. Instances form a tree via `parentId`. Render order is independent of the tree:
 * it is defined by the owning layer's position in `UnitAssembly.layers` and `orderInLayer`.
 */
export const SpriteInstanceSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  assetId: IdSchema,
  /** Stable logical slot id shared across directions (e.g. "left_arm"). Defaults to the instance id. */
  slotId: IdSchema.optional(),
  parentId: IdSchema.nullable().default(null),
  /** Attachment on the parent that defines this instance's parent frame. */
  parentAttachmentId: IdSchema.optional(),
  /** Attachment on this instance that was snapped to the parent attachment (informational / re-align). */
  childAttachmentId: IdSchema.optional(),
  transform: Transform2DSchema,
  layerId: IdSchema,
  orderInLayer: z.number().int().default(0),
  visible: z.boolean().default(true),
  opacity: z.number().min(0).max(1).default(1),
  locked: z.boolean().default(false),
  joint: JointConstraintSchema.optional(),
});
export type SpriteInstance = z.infer<typeof SpriteInstanceSchema>;

export const IkConstraintSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  /** Two-bone chain: upper (root) bone instance id, then lower bone instance id. */
  rootInstanceId: IdSchema,
  midInstanceId: IdSchema,
  /** Target position in the root bone's parent frame. */
  target: z.object({ x: z.number(), y: z.number() }),
  bendDirection: z.enum(['positive', 'negative']).default('positive'),
  influence: z.number().min(0).max(1).default(1),
  enabled: z.boolean().default(true),
});
export type IkConstraint = z.infer<typeof IkConstraintSchema>;
