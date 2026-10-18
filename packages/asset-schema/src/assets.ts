import { z } from 'zod';
import { DirectionSchema, IdSchema, Vector2Schema } from './primitives';

/**
 * A named point on a sprite in image-local pixel coordinates (origin top-left, y down).
 * `rotation` is the local orientation of the attachment frame in degrees.
 */
export const AttachmentPointSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  position: Vector2Schema,
  rotation: z.number().default(0),
  /** Optional semantic type used for compatibility checks (e.g. "shoulder", "grip"). */
  type: z.string().optional(),
  /** Attachment types this point accepts when acting as a parent socket. */
  accepts: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});
export type AttachmentPoint = z.infer<typeof AttachmentPointSchema>;

/**
 * A named muzzle / spawn point on a sprite in image-local pixels.
 * Runtime code can spawn projectiles from this transform (position + optional fire angle).
 */
export const ProjectilePointSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  position: Vector2Schema,
  /**
   * Preferred fire direction in image-local degrees (0 = +X / right, clockwise with y-down).
   * Omit or 0 when the game supplies aim separately.
   */
  angle: z.number().default(0),
  tags: z.array(z.string()).optional(),
});
export type ProjectilePoint = z.infer<typeof ProjectilePointSchema>;

export const SpriteSourceSchema = z.object({
  /** Asset id of the sheet this sprite was extracted from. */
  sheetAssetId: IdSchema,
  /** Crop rectangle on the source sheet in pixels. */
  rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
});
export type SpriteSource = z.infer<typeof SpriteSourceSchema>;

/**
 * Metadata for a PNG sprite. The PNG bytes are stored separately and referenced by `imagePath`
 * (relative path inside a package / storage key inside the editor). Editing metadata never
 * modifies the PNG.
 */
export const SpriteAssetSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  imagePath: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Primary pivot in image-local pixels. May lie outside the image bounds. */
  pivot: Vector2Schema,
  attachments: z.array(AttachmentPointSchema).default([]),
  /** Points where projectiles should originate (muzzle, cast origin, etc.). */
  projectilePoints: z.array(ProjectilePointSchema).default([]),
  /**
   * Optional 3D orbit handle in image-local pixels. When set, Animate mode shows a free-drag
   * manipulator at this point (drag → Z / X; Shift+drag → Y). Omit / clear to disable.
   */
  orbitHandle: Vector2Schema.optional(),
  direction: DirectionSchema.optional(),
  tags: z.array(z.string()).default([]),
  folder: z.string().default(''),
  source: SpriteSourceSchema.optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});
export type SpriteAsset = z.infer<typeof SpriteAssetSchema>;

export const AudioAssetSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  audioPath: z.string().min(1),
  /** Duration in seconds, if known. */
  duration: z.number().nonnegative().optional(),
  mimeType: z.string().optional(),
  /** Non-destructive edit metadata (seconds / 0..1). */
  trimStart: z.number().nonnegative().default(0),
  trimEnd: z.number().nonnegative().optional(),
  volume: z.number().min(0).max(1).default(1),
  fadeIn: z.number().nonnegative().default(0),
  fadeOut: z.number().nonnegative().default(0),
  tags: z.array(z.string()).default([]),
});
export type AudioAsset = z.infer<typeof AudioAssetSchema>;
