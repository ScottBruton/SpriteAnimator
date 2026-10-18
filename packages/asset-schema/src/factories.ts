import type { AnimationAction, AnimationChannel } from './animation';
import { BASE_CHANNEL_ID } from './animation';
import type { AssemblyCategory, DirectionConfiguration, UnitAssembly } from './assembly';
import type { SpriteAsset } from './assets';
import { createId } from './ids';
import { DIRECTIONS, identityTransform } from './primitives';
import type { Project } from './project';
import type { Layer, SpriteInstance } from './rig';
import { SCHEMA_VERSION } from './version';

/** Root project folder for each assembly category (Create New templates). */
export const ASSEMBLY_CATEGORY_ROOT: Record<AssemblyCategory, string> = {
  unit: 'Units',
  structure: 'Structures',
  resource: 'Resources',
  terrain: 'Terrain',
};

/**
 * Per-facing art folders created under each entity’s asset path (Elemental V2 stems).
 * Hold the PNGs for that camera angle; export maps these to 000.png…315.png.
 */
export const FACING_ANGLE_STEMS = ['000', '045', '090', '135', '180', '225', '270', '315'] as const;

/** Asset-library subfolders created with every new entity. */
export function entityAssetSubfolders(entityFolder: string, category: AssemblyCategory): string[] {
  const root = entityFolder.replace(/\/+$/, '');
  if (!root) return [];
  const out: string[] = [root];
  for (const stem of FACING_ANGLE_STEMS) out.push(`${root}/${stem}`);
  if (category === 'unit') out.push(`${root}/Projectiles`);
  return out;
}

const STARTER_ACTIONS: Record<AssemblyCategory, string[]> = {
  unit: ['Idle', 'Walk', 'Attack'],
  structure: ['Idle'],
  resource: ['Idle'],
  terrain: ['Idle'],
};

export function emptyDirectionConfigs(): DirectionConfiguration[] {
  return DIRECTIONS.map((direction) => ({
    direction,
    assetOverrides: {},
    transformOverrides: {},
    pivotOverrides: {},
    layerOverrides: {},
    orderOverrides: {},
    visibilityOverrides: {},
  }));
}

export function createLayer(name: string): Layer {
  return { id: createId('layer'), name, visible: true, locked: false };
}

export function createBaseChannel(): AnimationChannel {
  return { id: BASE_CHANNEL_ID, name: 'Base', priority: 0, blendMode: 'override' };
}

export function createAssembly(name: string, opts?: { category?: AssemblyCategory; folder?: string }): UnitAssembly {
  const layer = createLayer('Default');
  const category = opts?.category ?? 'unit';
  return {
    id: createId('asm'),
    name,
    schemaVersion: SCHEMA_VERSION,
    category,
    folder: opts?.folder ?? '',
    layers: [layer],
    sprites: [],
    ikConstraints: [],
    directions: [],
    defaultDirection: 'S',
    actions: [],
    channels: [createBaseChannel()],
    behaviors: {},
    canvas: { backgroundColor: '#1e1f24', gridSize: 16 },
  };
}

export function createProject(name: string): Project {
  const now = Date.now();
  const assembly = createAssembly(name);
  return {
    id: createId('proj'),
    name,
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    assets: [],
    audio: [],
    assemblies: [assembly],
    activeAssemblyId: assembly.id,
    settings: {
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
      assemblyFolders: [],
    },
  };
}

export function createSpriteAsset(input: {
  name: string;
  imagePath: string;
  width: number;
  height: number;
}): SpriteAsset {
  const now = Date.now();
  return {
    id: createId('spr'),
    name: input.name,
    imagePath: input.imagePath,
    width: input.width,
    height: input.height,
    pivot: { x: input.width / 2, y: input.height / 2 },
    attachments: [],
    projectilePoints: [],
    tags: [],
    folder: '',
    createdAt: now,
    updatedAt: now,
  };
}

export function createSpriteInstance(input: {
  asset: SpriteAsset;
  layerId: string;
  position: { x: number; y: number };
  orderInLayer?: number;
  name?: string;
}): SpriteInstance {
  const id = createId('inst');
  return {
    id,
    name: input.name ?? input.asset.name,
    assetId: input.asset.id,
    slotId: id,
    parentId: null,
    transform: { ...identityTransform(), position: { ...input.position } },
    layerId: input.layerId,
    orderInLayer: input.orderInLayer ?? 0,
    visible: true,
    opacity: 1,
    locked: false,
  };
}

export function createAction(name: string, fps = 30, durationSeconds = 1): AnimationAction {
  return {
    id: createId('act'),
    name,
    duration: durationSeconds,
    fps,
    loop: true,
    tracks: [],
    audioEvents: [],
    channelId: BASE_CHANNEL_ID,
  };
}

/**
 * Template used by Create New: folder under Units/Structures/…, starter actions,
 * and empty direction configs so the compass has all eight facings ready.
 */
export function createEntityAssembly(category: AssemblyCategory, name: string, fps = 30): UnitAssembly {
  const trimmed = name.trim() || 'Untitled';
  const root = ASSEMBLY_CATEGORY_ROOT[category];
  const folder = `${root}/${trimmed}`;
  const asm = createAssembly(trimmed, { category, folder });
  asm.directions = emptyDirectionConfigs();
  asm.actions = STARTER_ACTIONS[category].map((n) => createAction(n, fps));
  asm.defaultActionId = asm.actions[0]?.id;
  return asm;
}
