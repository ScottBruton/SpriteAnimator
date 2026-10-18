import { z } from 'zod';
import { AnimationActionSchema, AnimationChannelSchema } from './animation';
import { AudioAssetSchema, SpriteAssetSchema } from './assets';
import { DirectionSchema, IdSchema, Transform2DSchema, Vector2Schema } from './primitives';
import { IkConstraintSchema, LayerSchema, SpriteInstanceSchema } from './rig';
import { SCHEMA_VERSION } from './version';

/** Per-direction overrides keyed by sprite instance id (or slot id). */
export const DirectionConfigurationSchema = z.object({
  direction: DirectionSchema,
  assetOverrides: z.record(z.string(), IdSchema).default({}),
  transformOverrides: z.record(z.string(), Transform2DSchema).default({}),
  pivotOverrides: z.record(z.string(), Vector2Schema).default({}),
  /** instanceId -> layerId */
  layerOverrides: z.record(z.string(), IdSchema).default({}),
  /** instanceId -> orderInLayer */
  orderOverrides: z.record(z.string(), z.number().int()).default({}),
  visibilityOverrides: z.record(z.string(), z.boolean()).default({}),
  /** Full layer order override (array of layer ids, back to front). */
  layerOrder: z.array(IdSchema).optional(),
});
export type DirectionConfiguration = z.infer<typeof DirectionConfigurationSchema>;

export const StateKindSchema = z.enum(['default', 'loop', 'oneShot', 'transition']);

export const StateTransitionSchema = z.object({
  id: IdSchema,
  from: IdSchema.or(z.literal('*')),
  to: IdSchema,
  /** Named trigger raised by the game (e.g. "attack"). Undefined = evaluated on completion. */
  trigger: z.string().optional(),
  priority: z.number().int().default(0),
  interruptible: z.boolean().default(true),
  /** Seconds of cross-fade, 0 = cut. */
  duration: z.number().nonnegative().default(0),
  onComplete: z.boolean().default(false),
});
export type StateTransition = z.infer<typeof StateTransitionSchema>;

export const AnimationStateSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  kind: StateKindSchema.default('loop'),
  actionId: IdSchema,
  channelId: IdSchema.optional(),
  speed: z.number().positive().default(1),
});
export type AnimationState = z.infer<typeof AnimationStateSchema>;

export const StateMachineSchema = z.object({
  /** Independent machines per channel. */
  channels: z
    .array(
      z.object({
        channelId: IdSchema,
        initialStateId: IdSchema,
        states: z.array(AnimationStateSchema),
        transitions: z.array(StateTransitionSchema).default([]),
      }),
    )
    .default([]),
});
export type StateMachine = z.infer<typeof StateMachineSchema>;

/** Behaviour mapping: "attack" -> action, optionally per direction. */
export const BehaviorMappingSchema = z.object({
  actionId: IdSchema,
  channelId: IdSchema.optional(),
  directional: z.record(z.string(), IdSchema).optional(),
});
export type BehaviorMapping = z.infer<typeof BehaviorMappingSchema>;

/** Gameplay/content category used when creating assemblies from templates. */
export const AssemblyCategorySchema = z.enum(['unit', 'structure', 'resource', 'terrain']);
export type AssemblyCategory = z.infer<typeof AssemblyCategorySchema>;

/**
 * A complete game unit: shared logical rig, direction overrides, actions and behaviours.
 * Assets are referenced by id and are resolved from the owning project (editor) or the package
 * (export).
 */
export const UnitAssemblySchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  schemaVersion: z.string().default(SCHEMA_VERSION),
  /** Content type (unit / structure / resource / terrain). */
  category: AssemblyCategorySchema.default('unit'),
  /** Project explorer path (e.g. `Units/Frost Snowman`). Empty = unfiled. */
  folder: z.string().default(''),
  /** Back-to-front render order. */
  layers: z.array(LayerSchema),
  sprites: z.array(SpriteInstanceSchema),
  ikConstraints: z.array(IkConstraintSchema).default([]),
  directions: z.array(DirectionConfigurationSchema).default([]),
  defaultDirection: DirectionSchema.default('S'),
  actions: z.array(AnimationActionSchema).default([]),
  channels: z.array(AnimationChannelSchema).default([]),
  behaviors: z.record(z.string(), BehaviorMappingSchema).default({}),
  defaultActionId: IdSchema.optional(),
  stateMachine: StateMachineSchema.optional(),
  /** Canvas-only presentation settings. */
  canvas: z
    .object({
      backgroundColor: z.string().default('#1e1f24'),
      gridSize: z.number().positive().default(16),
    })
    .default({ backgroundColor: '#1e1f24', gridSize: 16 }),
});
export type UnitAssembly = z.infer<typeof UnitAssemblySchema>;

/**
 * Self-contained exported package: the assembly plus every referenced asset with paths relative
 * to the package root. This is what the runtime loads.
 */
export const AssemblyPackageSchema = z.object({
  schemaVersion: z.string(),
  kind: z.literal('elemental-assembly'),
  assembly: UnitAssemblySchema,
  assets: z.array(SpriteAssetSchema),
  audio: z.array(AudioAssetSchema).default([]),
  exportedAt: z.string().optional(),
  generator: z.string().optional(),
});
export type AssemblyPackage = z.infer<typeof AssemblyPackageSchema>;

export const AssemblyManifestSchema = z.object({
  kind: z.literal('elemental-assembly-manifest'),
  schemaVersion: z.string(),
  assemblyId: IdSchema,
  name: z.string(),
  supportedDirections: z.array(DirectionSchema),
  defaultDirection: DirectionSchema,
  defaultActionId: IdSchema.optional(),
  files: z.object({
    assembly: z.string(),
    animations: z.record(z.string(), z.string()),
    assets: z.record(z.string(), z.string()),
    audio: z.record(z.string(), z.string()),
  }),
  actions: z.array(z.object({ id: IdSchema, name: z.string(), duration: z.number(), loop: z.boolean() })),
  channels: z.array(z.object({ id: IdSchema, name: z.string() })),
});
export type AssemblyManifest = z.infer<typeof AssemblyManifestSchema>;

/** Single exported action with just the data needed to replay it. */
export const ActionPackageSchema = z.object({
  schemaVersion: z.string(),
  kind: z.literal('elemental-action'),
  action: AnimationActionSchema,
  /** Rig subset required by the action (setup pose). */
  layers: z.array(LayerSchema),
  sprites: z.array(SpriteInstanceSchema),
  channels: z.array(AnimationChannelSchema).default([]),
  assets: z.array(SpriteAssetSchema),
  audio: z.array(AudioAssetSchema).default([]),
});
export type ActionPackage = z.infer<typeof ActionPackageSchema>;
