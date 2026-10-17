import { z } from 'zod';
import { UnitAssemblySchema } from './assembly';
import { AudioAssetSchema, SpriteAssetSchema } from './assets';
import { IdSchema } from './primitives';
import { SCHEMA_VERSION } from './version';

export const UnitSystemSchema = z.enum(['px', 'mm', 'cm']);
export type UnitSystem = z.infer<typeof UnitSystemSchema>;

export const ProjectSettingsSchema = z.object({
  units: UnitSystemSchema.default('px'),
  pixelsPerMillimetre: z.number().positive().default(4),
  gridSize: z.number().positive().default(16),
  snapToGrid: z.boolean().default(false),
  snapToAttachments: z.boolean().default(true),
  snapTolerance: z.number().positive().default(12),
  showRulers: z.boolean().default(true),
  showGrid: z.boolean().default(true),
  defaultFps: z.number().positive().default(30),
  /** Empty or known asset library folders (paths like `arms` or `angles/front`). */
  assetFolders: z.array(z.string()).default([]),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

/**
 * Editable project document. Binary PNG/audio data lives in the blob store keyed by
 * `imagePath` / `audioPath`; the document itself is small JSON suitable for undo snapshots.
 */
export const ProjectSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  schemaVersion: z.string().default(SCHEMA_VERSION),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** Project-scoped assets. Global assets live in the global library store. */
  assets: z.array(SpriteAssetSchema).default([]),
  audio: z.array(AudioAssetSchema).default([]),
  assemblies: z.array(UnitAssemblySchema).default([]),
  activeAssemblyId: IdSchema.optional(),
  settings: ProjectSettingsSchema.default({
    units: 'px',
    pixelsPerMillimetre: 4,
    gridSize: 16,
    snapToGrid: false,
    snapToAttachments: true,
    snapTolerance: 12,
    showRulers: true,
    showGrid: true,
    defaultFps: 30,
    assetFolders: [],
  }),
});
export type Project = z.infer<typeof ProjectSchema>;

export const ProjectSummarySchema = z.object({
  id: IdSchema,
  name: z.string(),
  updatedAt: z.number(),
  createdAt: z.number(),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

/** Reusable rig template (phase 5). Declared now so the schema is stable. */
export const RigTemplateSlotSchema = z.object({
  slotId: IdSchema,
  name: z.string(),
  parentSlotId: IdSchema.nullable().default(null),
  parentAttachmentName: z.string().optional(),
  layerName: z.string().optional(),
  /** Normalised (0..1 of image size) default pivot and attachment positions. */
  pivot: z.object({ x: z.number(), y: z.number() }).optional(),
  attachments: z
    .array(
      z.object({
        name: z.string(),
        position: z.object({ x: z.number(), y: z.number() }),
        rotation: z.number().default(0),
        type: z.string().optional(),
      }),
    )
    .default([]),
  defaultTransform: z
    .object({
      position: z.object({ x: z.number(), y: z.number() }),
      rotation: z.number(),
      rotationX: z.number().default(0),
      rotationY: z.number().default(0),
      scale: z.object({ x: z.number(), y: z.number() }),
      flipX: z.boolean().default(false),
      flipY: z.boolean().default(false),
    })
    .optional(),
  joint: z
    .object({
      type: z.enum(['fixed', 'rotation', 'free']).default('free'),
      minRotation: z.number().optional(),
      maxRotation: z.number().optional(),
    })
    .optional(),
});

export const RigTemplateSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  schemaVersion: z.string().default(SCHEMA_VERSION),
  description: z.string().default(''),
  layers: z.array(z.string()).default([]),
  slots: z.array(RigTemplateSlotSchema),
  /** Left/right slot pairs used for mirroring. */
  mirrorPairs: z.array(z.tuple([IdSchema, IdSchema])).default([]),
});
export type RigTemplate = z.infer<typeof RigTemplateSchema>;
