import type { AnimationAction, AnimationChannel } from './animation';
import { BASE_CHANNEL_ID } from './animation';
import type { UnitAssembly } from './assembly';
import type { SpriteAsset } from './assets';
import { createId } from './ids';
import { identityTransform } from './primitives';
import type { Project } from './project';
import type { Layer, SpriteInstance } from './rig';
import { SCHEMA_VERSION } from './version';

export function createLayer(name: string): Layer {
  return { id: createId('layer'), name, visible: true, locked: false };
}

export function createBaseChannel(): AnimationChannel {
  return { id: BASE_CHANNEL_ID, name: 'Base', priority: 0, blendMode: 'override' };
}

export function createAssembly(name: string): UnitAssembly {
  const layer = createLayer('Default');
  return {
    id: createId('asm'),
    name,
    schemaVersion: SCHEMA_VERSION,
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
