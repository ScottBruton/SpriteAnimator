/**
 * Elemental V2 unit pack exporter — produces drop-in packs for assets/v2/units/.
 * Contract: elemental.assembly-pack.v1 / elemental.assembly.v1 (flat layered 8-direction frames).
 */
import type { Direction, Project, SpriteAsset, UnitAssembly, Vector2 } from '@elemental/asset-schema';
import { DIRECTIONS, slugify } from '@elemental/asset-schema';
import {
  evaluatePose,
  getRotationDeg,
  getScale,
  pivotWorldPosition,
} from '@elemental/animation-core';
import type { AssetLookup } from '@elemental/animation-core';
import type { ExportFile } from './buildPackage';

// ---- Contract constants --------------------------------------------------------------------

export const V2_PACK_SCHEMA = 'elemental.assembly-pack.v1' as const;
export const V2_UNIT_SCHEMA = 'elemental.assembly.v1' as const;

export const UNIT_KINDS = ['workers', 'melee', 'scouts', 'ranged', 'support'] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

export const FACTIONS = ['water', 'fire', 'earth', 'nature'] as const;
export type Faction = (typeof FACTIONS)[number];

export const ANGLE_TABLE = [
  { angle: 0, direction: 'front', stem: '000', compass: 'S' as Direction },
  { angle: 45, direction: 'front_left', stem: '045', compass: 'SW' as Direction },
  { angle: 90, direction: 'left', stem: '090', compass: 'W' as Direction },
  { angle: 135, direction: 'back_left', stem: '135', compass: 'NW' as Direction },
  { angle: 180, direction: 'back', stem: '180', compass: 'N' as Direction },
  { angle: 225, direction: 'back_right', stem: '225', compass: 'NE' as Direction },
  { angle: 270, direction: 'right', stem: '270', compass: 'E' as Direction },
  { angle: 315, direction: 'front_right', stem: '315', compass: 'SE' as Direction },
] as const;

const ANIMATED_LAYER_IDS = new Set([
  'body',
  'grip_hand',
  'crystal_bag',
  'weapon',
  'pickaxe',
  'hammer',
]);

const SCOUT_VARIANTS: Record<Faction, [string, string]> = {
  water: ['ice', 'steam'],
  fire: ['flame', 'smoke'],
  earth: ['visible', 'hidden'],
  nature: ['visible', 'hidden'],
};

export function requiredVariantsFor(kind: UnitKind, faction: Faction): string[] {
  switch (kind) {
    case 'workers':
      return ['pickaxe', 'hammer', 'crystal_bag'];
    case 'scouts':
      return [...SCOUT_VARIANTS[faction]];
    case 'melee':
    case 'ranged':
    case 'support':
      return ['equipped'];
  }
}

export function defaultCanvasFor(kind: UnitKind): [number, number] {
  return kind === 'workers' || kind === 'melee' ? [1024, 1024] : [640, 640];
}

export function defaultRootPivotFor(kind: UnitKind): Vector2 {
  const [w, h] = defaultCanvasFor(kind);
  // Contract typical: 1024 → (512, 728); 640 → (320, 560)
  if (w === 1024) return { x: 512, y: 728 };
  return { x: Math.round(w / 2), y: Math.round(h * 0.875) };
}

export interface V2VariantSource {
  /** Variant key in assemblies.json (e.g. equipped, pickaxe). */
  variantId: string;
  assembly: UnitAssembly;
}

export interface V2ExportOptions {
  kind: UnitKind;
  faction: Faction;
  variants: V2VariantSource[];
  /** Override canvas; defaults from kind. */
  canvas?: [number, number];
  /** Override root pivot; defaults from kind. */
  rootPivot?: Vector2;
  /** Extra projectile assets (PNG art). Auto-detected from project when omitted. */
  projectileAssets?: SpriteAsset[];
}

export interface BuiltV2Pack {
  unitId: string;
  files: ExportFile[];
  warnings: string[];
  unit: V2Unit;
}

interface V2Layer {
  id: string;
  file: string;
  pivot: { x: number; y: number };
  position: { x: number; y: number };
  scale: number;
  rotation_degrees: number;
  z: number;
}

interface V2Frame {
  angle: number;
  direction: string;
  canvas: [number, number];
  root_pivot: { x: number; y: number };
  layers: V2Layer[];
}

interface V2Unit {
  schema: typeof V2_UNIT_SCHEMA;
  unit: string;
  canvas: [number, number];
  root_pivot: { x: number; y: number };
  coordinates: string;
  variants: Record<string, V2Frame[]>;
}

// ---- Helpers -------------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function partSlug(name: string): string {
  return slugify(name).replace(/-/g, '_') || 'part';
}

/** Map instance name/slot to a contract layer id when possible. */
export function resolveLayerId(inst: { name: string; slotId?: string }): string {
  const raw = (inst.slotId || inst.name || '').trim();
  const key = raw.toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
  if (ANIMATED_LAYER_IDS.has(key)) return key;
  if (key.endsWith('_fist') || key === 'left_fist' || key === 'right_fist') return key;
  // Common aliases
  const aliases: Record<string, string> = {
    sword: 'weapon',
    katana: 'weapon',
    blade: 'weapon',
    gun: 'weapon',
    bow: 'weapon',
    staff: 'weapon',
    tool: 'pickaxe',
    hand: 'grip_hand',
    hands: 'grip_hand',
    grip: 'grip_hand',
    bag: 'crystal_bag',
    crystal: 'crystal_bag',
    torso: 'body',
    character: 'body',
    unit: 'body',
  };
  if (aliases[key]) return aliases[key]!;
  if (key.includes('fist')) return key.includes('left') ? 'left_fist' : key.includes('right') ? 'right_fist' : `${partSlug(raw)}_fist`;
  if (key.includes('weapon') || key.includes('sword') || key.includes('katana')) return 'weapon';
  if (key.includes('pickaxe')) return 'pickaxe';
  if (key.includes('hammer')) return 'hammer';
  if (key.includes('grip') || key.includes('hand_overlay')) return 'grip_hand';
  if (key.includes('bag') || key.includes('crystal')) return 'crystal_bag';
  if (key.includes('body') || key.includes('samurai') || key.includes('gunner')) return 'body';
  return partSlug(raw);
}

function defaultZ(layerId: string, index: number): number {
  if (layerId === 'body') return 20;
  if (layerId === 'crystal_bag') return 25;
  if (layerId === 'weapon' || layerId === 'pickaxe' || layerId === 'hammer' || layerId.endsWith('_fist')) return 30;
  if (layerId === 'grip_hand') return 40;
  return 10 + index;
}

function pivotKind(layerId: string): string {
  if (layerId === 'body') return 'body';
  if (layerId === 'crystal_bag') return 'bag';
  if (layerId.endsWith('_fist')) return 'fist';
  if (layerId === 'grip_hand') return 'tool/weapon grip';
  if (layerId === 'weapon' || layerId === 'pickaxe' || layerId === 'hammer') return 'tool/weapon grip';
  return 'body';
}

/** Detect projectile PNG assets (not muzzle points) from the project library. */
export function detectProjectileAssets(project: Project, usedAsLayers: Set<string>): SpriteAsset[] {
  const out: SpriteAsset[] = [];
  for (const a of project.assets) {
    if (usedAsLayers.has(a.id)) continue;
    const folder = (a.folder || '').toLowerCase();
    const name = a.name.toLowerCase();
    const tags = (a.tags || []).map((t) => t.toLowerCase());
    if (folder.includes('projectile') || name.includes('projectile') || tags.includes('projectile') || tags.includes('proj')) {
      out.push(a);
    }
  }
  return out;
}

// ---- Bake one variant ----------------------------------------------------------------------

function bakeVariantFrames(
  assembly: UnitAssembly,
  lookup: AssetLookup,
  unitId: string,
  canvas: [number, number],
  rootPivot: Vector2,
  getBytes: (imagePath: string) => Uint8Array | undefined,
  files: ExportFile[],
  writtenPngs: Set<string>,
  warnings: string[],
): V2Frame[] {
  const frames: V2Frame[] = [];
  const layerOrderIndex = new Map(assembly.layers.map((l, i) => [l.id, i]));

  for (const row of ANGLE_TABLE) {
    const pose = evaluatePose({
      assembly,
      direction: row.compass,
      layers: [],
      lookupAsset: lookup,
      applyAnimation: false,
    });

    // Anchor: body layer pivot if present, else first root-most visible sprite.
    let anchorWorld: Vector2 | null = null;
    const visible = [...pose.resolved.values()].filter((r) => r.visible);
    const body = visible.find((r) => resolveLayerId(r.instance) === 'body');
    if (body) {
      const w = pose.world.get(body.instance.id);
      if (w) anchorWorld = pivotWorldPosition(w);
    }
    if (!anchorWorld && visible[0]) {
      const w = pose.world.get(visible[0].instance.id);
      if (w) anchorWorld = pivotWorldPosition(w);
    }
    if (!anchorWorld) anchorWorld = { x: 0, y: 0 };

    // Stable draw order: assembly layer order, then orderInLayer
    const sorted = [...visible].sort((a, b) => {
      const la = layerOrderIndex.get(a.layerId) ?? 0;
      const lb = layerOrderIndex.get(b.layerId) ?? 0;
      if (la !== lb) return la - lb;
      return a.orderInLayer - b.orderInLayer;
    });

    const layers: V2Layer[] = [];
    sorted.forEach((r, index) => {
      const world = pose.world.get(r.instance.id);
      if (!world) return;
      const layerId = resolveLayerId(r.instance);
      // Part folder: prefer asset name so art folders stay stable; fall back to layer id
      const part = partSlug(r.asset.name || layerId);
      const relPng = `${unitId}/${part}/${row.stem}.png`;
      const bytes = getBytes(r.asset.imagePath);
      if (!bytes) {
        warnings.push(`Missing PNG bytes for ${r.asset.name} (${row.direction})`);
        return;
      }
      if (!writtenPngs.has(relPng)) {
        files.push({ path: relPng, data: bytes });
        writtenPngs.add(relPng);
        const pivot = r.pivot;
        const sidecar = {
          file: relPng,
          angle: row.angle,
          direction: row.direction,
          size: [r.asset.width, r.asset.height] as [number, number],
          pivot: {
            x: round2(pivot.x),
            y: round2(pivot.y),
            normalized_x: round2(pivot.x / r.asset.width),
            normalized_y: round2(pivot.y / r.asset.height),
            kind: pivotKind(layerId),
            status: 'authored',
          },
        };
        files.push({ path: `${unitId}/${part}/${row.stem}.json`, data: JSON.stringify(sidecar, null, 2) });
      }

      const wp = pivotWorldPosition(world);
      const sc = getScale(world.node);
      const uniform = (Math.abs(sc.x) + Math.abs(sc.y)) / 2;
      if (Math.abs(Math.abs(sc.x) - Math.abs(sc.y)) > 0.05) {
        warnings.push(`Non-uniform scale on ${layerId} @ ${row.direction}; using average ${round2(uniform)}`);
      }
      layers.push({
        id: layerId,
        file: relPng,
        pivot: { x: round2(r.pivot.x), y: round2(r.pivot.y) },
        position: {
          x: round2(wp.x - anchorWorld!.x + rootPivot.x),
          y: round2(wp.y - anchorWorld!.y + rootPivot.y),
        },
        scale: round2(uniform || 1),
        rotation_degrees: round2(getRotationDeg(world.node)),
        z: defaultZ(layerId, index),
      });
    });

    if (layers.length === 0) warnings.push(`No visible layers for ${row.direction} (${row.stem})`);

    frames.push({
      angle: row.angle,
      direction: row.direction,
      canvas: [...canvas] as [number, number],
      root_pivot: { ...rootPivot },
      layers,
    });
  }

  // Ensure every direction has a config warning
  const configured = new Set(assembly.directions.map((d) => d.direction));
  for (const row of ANGLE_TABLE) {
    if (!configured.has(row.compass) && assembly.directions.length > 0) {
      // overrides optional — base rig used; soft hint once
    }
  }
  const missingDirs = DIRECTIONS.filter((d) => !configured.has(d));
  if (missingDirs.length && assembly.directions.length > 0 && assembly.directions.length < 8) {
    warnings.push(`Only ${assembly.directions.length}/8 direction configs; missing ${missingDirs.join(', ')} use base rig`);
  }

  return frames;
}

// ---- Control helper ------------------------------------------------------------------------

function renderControlJs(unit: V2Unit, projectiles: { file: string; name: string; pivot: Vector2; size: [number, number] }[]): string {
  const unitId = unit.unit;
  const variantKeys = Object.keys(unit.variants);
  const projectilesExport = JSON.stringify(
    projectiles.map((p) => ({
      name: p.name,
      file: p.file,
      pivot: p.pivot,
      size: p.size,
      fitWidth: 110,
      forward_screen_vector: [1, 0],
      runtime_rotation: true,
    })),
    null,
    2,
  );

  return `/**
 * Elemental V2 unit controller — generated by Elemental Sprite Studio.
 * Drop the pack under assets/v2/units/, run:
 *   node scripts/sync-v2-assemblies.mjs
 *   node scripts/gen-v2-unit-assets.mjs
 * Then use this helper (or Elemental's drawV2Assembly) to drive the unit.
 *
 * Coordinate contract (y-down, clockwise degrees):
 *   translate(unitScreen) → scale(unitScale) → translate(-root_pivot)
 *   for each layer sorted by z:
 *     translate(position) → rotate(rotation_degrees + swing) → scale(layer.scale)
 *     drawImage(png, -pivot.x, -pivot.y)
 */

export const UNIT_ID = ${JSON.stringify(unitId)};
export const PACK_SCHEMA = ${JSON.stringify(V2_PACK_SCHEMA)};

const ANGLE_STEMS = [0, 45, 90, 135, 180, 225, 270, 315];
const DIRECTION_NAMES = [
  'front', 'front_left', 'left', 'back_left',
  'back', 'back_right', 'right', 'front_right',
];

/** Facing degrees → frame index 0..7 (Elemental: round(facingDeg / 45) % 8). */
export function frameIndexFromFacing(facingDeg) {
  const d = ((Number(facingDeg) % 360) + 360) % 360;
  return Math.round(d / 45) % 8;
}

export function stemForIndex(i) {
  const a = ANGLE_STEMS[((i % 8) + 8) % 8];
  return String(a).padStart(3, '0');
}

export function directionNameForIndex(i) {
  return DIRECTION_NAMES[((i % 8) + 8) % 8];
}

/**
 * Stateful controller for one unit instance on the battlefield / preview.
 * Does not load PNGs — pass resolveImage(path) from your asset map.
 */
export function createUnitController(options = {}) {
  const state = {
    unitId: UNIT_ID,
    variant: options.variant ?? ${JSON.stringify(variantKeys[0] ?? 'equipped')},
    facingDeg: options.facingDeg ?? 0,
    swingDegrees: 0,
    punchPixels: 0,
    walkPhase: 0,
  };

  const api = {
    get state() {
      return { ...state };
    },
    setVariant(variantId) {
      state.variant = String(variantId);
      return api;
    },
    setFacing(facingDeg) {
      state.facingDeg = Number(facingDeg) || 0;
      return api;
    },
    /** Face toward a screen-space delta (y-down). */
    faceVector(dx, dy) {
      if (dx === 0 && dy === 0) return api;
      // atan2(dx, dy): 0 = +Y (screen down / front), clockwise positive to match packing
      const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
      state.facingDeg = ((deg % 360) + 360) % 360;
      return api;
    },
    setSwing(degrees) {
      state.swingDegrees = Number(degrees) || 0;
      return api;
    },
    setPunch(pixels) {
      state.punchPixels = Number(pixels) || 0;
      return api;
    },
    setWalkPhase(t01) {
      state.walkPhase = Math.max(0, Math.min(1, Number(t01) || 0));
      return api;
    },
    frameIndex() {
      return frameIndexFromFacing(state.facingDeg);
    },
    /**
     * Look up the baked frame from assemblies.json unit.variants.
     * @param {object} unitDoc — the unit object from assemblies.json
     */
    getFrame(unitDoc) {
      const frames = unitDoc?.variants?.[state.variant];
      if (!frames || !Array.isArray(frames)) {
        throw new Error(\`Unknown variant "\${state.variant}" on \${state.unitId}\`);
      }
      return frames[api.frameIndex()];
    },
    /**
     * Layers ready for drawV2Assembly-style drawing (swing/punch applied).
     * Swing applies to weapon/pickaxe/hammer; punch to *_fist; walk sway to those too.
     */
    getDrawLayers(unitDoc) {
      const frame = api.getFrame(unitDoc);
      const sway = Math.sin(state.walkPhase * Math.PI * 2) * 4;
      return [...frame.layers]
        .sort((a, b) => a.z - b.z)
        .map((layer) => {
          const id = layer.id;
          let rotation = layer.rotation_degrees;
          let position = { ...layer.position };
          const swings = id === 'weapon' || id === 'pickaxe' || id === 'hammer';
          const fists = typeof id === 'string' && id.endsWith('_fist');
          if (swings) rotation += state.swingDegrees + sway * 0.15;
          if (fists) {
            position = { x: position.x + state.punchPixels, y: position.y };
            rotation += sway * 0.1;
          }
          if (swings || fists) {
            position = { x: position.x + sway * 0.05, y: position.y };
          }
          return { ...layer, rotation_degrees: rotation, position };
        });
    },
  };
  return api;
}

export const projectiles = ${projectilesExport};

/** Default export for Metro / RN: controller factory + constants. */
export default {
  UNIT_ID,
  PACK_SCHEMA,
  canvas: ${JSON.stringify(unit.canvas)},
  root_pivot: ${JSON.stringify(unit.root_pivot)},
  variants: ${JSON.stringify(variantKeys)},
  projectiles,
  frameIndexFromFacing,
  createUnitController,
};
`;
}

function renderUsageMd(unit: V2Unit, warnings: string[]): string {
  const unitId = unit.unit;
  const variants = Object.keys(unit.variants);
  return `# ${unitId} — Elemental V2 pack

Generated by Elemental Sprite Studio for the Elemental mobile game (Expo / React Native / Skia).

## Install

1. Unzip so the pack root contents land in \`assets/v2/units/\` (you should see \`assemblies.json\` and \`${unitId}/\`).
2. Run:
   \`\`\`bash
   node scripts/sync-v2-assemblies.mjs
   node scripts/gen-v2-unit-assets.mjs
   \`\`\`
3. Do **not** hand-edit sync outputs; this pack's \`assemblies.json\` + PNGs are the source of truth.

## Unit

| Field | Value |
|-------|-------|
| unit | \`${unitId}\` |
| canvas | \`${JSON.stringify(unit.canvas)}\` |
| root_pivot | \`${JSON.stringify(unit.root_pivot)}\` |
| variants | ${variants.map((v) => `\`${v}\``).join(', ')} |

## Control in React Native

\`control.js\` exports \`createUnitController()\` — facing, variant, swing/punch/walk hooks matching Elemental's draw contract.

\`\`\`js
import assemblies from '../assemblies.json';
import { createUnitController, UNIT_ID } from './${unitId}/control.js';

const unitDoc = assemblies.units.find((u) => u.unit === UNIT_ID);
const ctrl = createUnitController({ variant: ${JSON.stringify(variants[0] ?? 'equipped')}, facingDeg: 0 });

// Face the unit (degrees; 0 = front / screen-down)
ctrl.setFacing(90);          // left
ctrl.faceVector(dx, dy);     // from movement

// Equipment / scout form
ctrl.setVariant(${JSON.stringify(variants[0] ?? 'equipped')});

// Combat juice (game adds these on top of exported base pose)
ctrl.setSwing(25);
ctrl.setPunch(8);
ctrl.setWalkPhase(t);        // 0..1

const layers = ctrl.getDrawLayers(unitDoc);
// Then for each layer (Skia / drawV2Assembly):
//   translate(position) → rotate(rotation_degrees) → scale(scale)
//   drawImage(resolve(layer.file), -pivot.x, -pivot.y)
\`\`\`

Draw pipeline (engine):

\`\`\`
translate(unitScreen) → scale(unitScale) → translate(-root_pivot)
for layer of layers sorted by z ascending:
  translate(layer.position)
  rotate(layer.rotation_degrees)   // + runtime swing already folded in getDrawLayers
  scale(layer.scale)
  drawImage(png, -layer.pivot.x, -layer.pivot.y)
\`\`\`

Animated layer ids Elemental hooks: \`body\`, \`grip_hand\`, \`crystal_bag\`, \`weapon\`, \`pickaxe\`, \`hammer\`, \`*_fist\`.

## Files

- \`assemblies.json\` — pack index (\`${V2_PACK_SCHEMA}\`)
- \`${unitId}/**/*.png\` — component sprites (\`000\`…\`315\`)
- \`${unitId}/**/*.json\` — pivot sidecars
- \`${unitId}/control.js\` — RN controller
- \`${unitId}/projectiles/\` — ranged art (if any)
- \`projectiles.manifest.json\` — optional path list for stage wiring

${warnings.length ? `## Export warnings\n\n${warnings.map((w) => `- ${w}`).join('\n')}\n` : ''}`;
}

// ---- Public API ----------------------------------------------------------------------------

export function buildV2UnitPack(
  project: Project,
  options: V2ExportOptions,
  lookup: AssetLookup,
  getBytes: (imagePath: string) => Uint8Array | undefined,
): BuiltV2Pack {
  const warnings: string[] = [];
  const kind = options.kind;
  const faction = options.faction;
  const unitId = `${kind}/${faction}`;
  const canvas = options.canvas ?? defaultCanvasFor(kind);
  const rootPivot = options.rootPivot ?? defaultRootPivotFor(kind);
  const required = requiredVariantsFor(kind, faction);

  if (!options.variants.length) throw new Error('At least one variant assembly is required');

  const variantMap: Record<string, V2Frame[]> = {};
  const files: ExportFile[] = [];
  const writtenPngs = new Set<string>();
  const usedAssetIds = new Set<string>();

  for (const v of options.variants) {
    const id = v.variantId.trim();
    if (!id) {
      warnings.push('Skipped variant with empty id');
      continue;
    }
    if (variantMap[id]) warnings.push(`Duplicate variant "${id}" — later entry overwrites`);
    for (const s of v.assembly.sprites) usedAssetIds.add(s.assetId);
    for (const d of v.assembly.directions) for (const aid of Object.values(d.assetOverrides)) usedAssetIds.add(aid);

    variantMap[id] = bakeVariantFrames(v.assembly, lookup, unitId, canvas, rootPivot, getBytes, files, writtenPngs, warnings);
  }

  for (const req of required) {
    if (!variantMap[req]) {
      warnings.push(`Missing required variant "${req}" for ${unitId} (need: ${required.join(', ')})`);
    }
  }

  // Projectiles
  const projAssets = options.projectileAssets ?? detectProjectileAssets(project, usedAssetIds);
  const projectileMeta: { file: string; name: string; pivot: Vector2; size: [number, number] }[] = [];
  for (const a of projAssets) {
    const name = partSlug(a.name);
    const file = `${unitId}/projectiles/${name}.png`;
    const bytes = getBytes(a.imagePath);
    if (!bytes) {
      warnings.push(`Missing projectile PNG for ${a.name}`);
      continue;
    }
    files.push({ path: file, data: bytes });
    const pivot = a.pivot ?? { x: a.width / 2, y: a.height / 2 };
    const sidecar = {
      file,
      size: [a.width, a.height],
      pivot: {
        x: round2(pivot.x),
        y: round2(pivot.y),
        normalized_x: round2(pivot.x / a.width),
        normalized_y: round2(pivot.y / a.height),
        kind: 'projectile_center',
        coordinate_origin: 'top_left',
      },
      forward_screen_vector: [1, 0],
      runtime_rotation: true,
      view: 'single',
      name,
    };
    files.push({ path: `${unitId}/projectiles/${name}.json`, data: JSON.stringify(sidecar, null, 2) });
    projectileMeta.push({ file, name, pivot: { x: round2(pivot.x), y: round2(pivot.y) }, size: [a.width, a.height] });
  }

  if (kind === 'ranged' && projectileMeta.length === 0) {
    warnings.push('ranged unit has no projectile PNGs — add assets under a Projectiles folder or tag them "projectile"');
  }

  const unit: V2Unit = {
    schema: V2_UNIT_SCHEMA,
    unit: unitId,
    canvas,
    root_pivot: rootPivot,
    coordinates: 'top-left pixels, clockwise degrees; layer file paths relative to pack root',
    variants: variantMap,
  };

  const pack = {
    schema: V2_PACK_SCHEMA,
    units: [unit],
  };

  files.push({ path: 'assemblies.json', data: JSON.stringify(pack, null, 2) });
  files.push({
    path: 'projectiles.manifest.json',
    data: JSON.stringify(
      {
        unit: unitId,
        projectiles: projectileMeta.map((p) => ({
          file: p.file,
          pivot: p.pivot,
          fitWidth: 110,
          name: p.name,
          size: p.size,
        })),
      },
      null,
      2,
    ),
  });
  files.push({ path: `${unitId}/control.js`, data: renderControlJs(unit, projectileMeta) });
  files.push({ path: 'README.md', data: renderUsageMd(unit, warnings) });
  files.push({ path: `${unitId}/CONTROL.md`, data: renderUsageMd(unit, warnings) });

  // Soft validation checklist
  for (const [vid, frames] of Object.entries(variantMap)) {
    if (frames.length !== 8) warnings.push(`Variant "${vid}" has ${frames.length} frames (need 8)`);
    const angles = new Set(frames.map((f) => f.angle));
    for (const row of ANGLE_TABLE) {
      if (!angles.has(row.angle)) warnings.push(`Variant "${vid}" missing angle ${row.angle}`);
    }
    for (const f of frames) {
      for (const layer of f.layers) {
        if (!layer.file.endsWith('.png')) warnings.push(`Layer file must end in .png: ${layer.file}`);
        if (layer.file.includes('\\')) warnings.push(`Backslash in path: ${layer.file}`);
      }
    }
  }

  return { unitId, files, warnings, unit };
}
