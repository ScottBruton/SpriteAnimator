import { z } from 'zod';

export const Vector2Schema = z.object({ x: z.number(), y: z.number() });
export type Vector2 = z.infer<typeof Vector2Schema>;

export const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export const DirectionSchema = z.enum(DIRECTIONS);
export type Direction = z.infer<typeof DirectionSchema>;

/**
 * Local transform of a sprite instance relative to its parent frame.
 * - `position`: location of the sprite's pivot in the parent frame (pixels).
 * - `rotation`: degrees; positive is clockwise on screen (y-down coordinates).
 * - `scale`: non-uniform scale about the pivot.
 * - `flipX` / `flipY`: mirror about the pivot (applied as negative scale).
 * See docs/TRANSFORM_CONTRACT.md for the exact composition order.
 */
export const Transform2DSchema = z.object({
  position: Vector2Schema,
  rotation: z.number(),
  scale: Vector2Schema,
  flipX: z.boolean().default(false),
  flipY: z.boolean().default(false),
});
export type Transform2D = z.infer<typeof Transform2DSchema>;

export const IdSchema = z.string().min(1);

export const identityTransform = (): Transform2D => ({
  position: { x: 0, y: 0 },
  rotation: 0,
  scale: { x: 1, y: 1 },
  flipX: false,
  flipY: false,
});
