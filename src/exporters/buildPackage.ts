import type { ActionPackage, AssemblyManifest, AssemblyPackage, Project, SpriteAsset, UnitAssembly } from '@elemental/asset-schema';
import { SCHEMA_VERSION, slugify } from '@elemental/asset-schema';
import { getDescendantIds } from '@elemental/animation-core';

export const GENERATOR = 'Elemental Sprite Studio 0.1.0';

export interface ExportFile {
  /** Path relative to the package root (always forward slashes, never absolute). */
  path: string;
  data: Uint8Array | string;
}

export interface BuiltExport {
  pkg: AssemblyPackage;
  manifest: AssemblyManifest;
  files: ExportFile[];
  warnings: string[];
}

/** Assets referenced by the assembly (base rig + direction overrides). */
export function collectAssemblyAssets(assembly: UnitAssembly, lookup: (id: string) => SpriteAsset | undefined): { assets: SpriteAsset[]; missing: string[] } {
  const ids = new Set<string>();
  for (const s of assembly.sprites) ids.add(s.assetId);
  for (const d of assembly.directions) for (const id of Object.values(d.assetOverrides)) ids.add(id);
  const assets: SpriteAsset[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const a = lookup(id);
    if (a) assets.push(a);
    else missing.push(id);
  }
  return { assets, missing };
}

/** Deterministic, de-duplicated relative image paths inside the package. */
function assignPackagePaths(assets: SpriteAsset[]): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const a of [...assets].sort((x, y) => x.name.localeCompare(y.name))) {
    let base = slugify(a.name) || 'sprite';
    let path = `assets/${base}.png`;
    let n = 2;
    while (used.has(path)) path = `assets/${base}_${n++}.png`;
    used.add(path);
    out.set(a.id, path);
  }
  return out;
}

/**
 * Build a self-contained assembly package: `assembly.json` (complete), `manifest.json`,
 * per-action JSON, original PNG bytes, a static asset registry and a usage example.
 */
export function buildAssemblyExport(
  project: Project,
  assembly: UnitAssembly,
  lookup: (id: string) => SpriteAsset | undefined,
  getBytes: (imagePath: string) => Uint8Array | undefined,
): BuiltExport {
  const warnings: string[] = [];
  const { assets, missing } = collectAssemblyAssets(assembly, lookup);
  for (const id of missing) warnings.push(`Sprite references missing asset ${id}`);
  const pathFor = assignPackagePaths(assets);
  const files: ExportFile[] = [];

  const exportedAssets: SpriteAsset[] = assets.map((a) => {
    const path = pathFor.get(a.id)!;
    const bytes = getBytes(a.imagePath);
    if (bytes) files.push({ path, data: bytes });
    else warnings.push(`No image data for "${a.name}" (${a.imagePath})`);
    return { ...a, imagePath: path, folder: a.folder ?? '' };
  });

  const audio = project.audio.filter((au) => assembly.actions.some((ac) => ac.audioEvents.some((ev) => ev.assetId === au.id))).map((au) => {
    const path = `audio/${slugify(au.name)}${extOf(au.audioPath)}`;
    const bytes = getBytes(au.audioPath);
    if (bytes) files.push({ path, data: bytes });
    else warnings.push(`No audio data for "${au.name}"`);
    return { ...au, audioPath: path };
  });

  const exportedAssembly: UnitAssembly = { ...assembly, schemaVersion: SCHEMA_VERSION };
  const pkg: AssemblyPackage = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'elemental-assembly',
    assembly: exportedAssembly,
    assets: exportedAssets,
    audio,
    exportedAt: new Date().toISOString(),
    generator: GENERATOR,
  };

  const animationFiles: Record<string, string> = {};
  for (const action of assembly.actions) {
    const p = `animations/${slugify(action.name) || action.id}.json`;
    animationFiles[action.id] = p;
    const actionPkg = buildActionPackage(pkg, action.id);
    files.push({ path: p, data: JSON.stringify(actionPkg, null, 2) });
  }

  const supported = new Set<AssemblyManifest['supportedDirections'][number]>([assembly.defaultDirection, ...assembly.directions.map((d) => d.direction)]);
  const manifest: AssemblyManifest = {
    kind: 'elemental-assembly-manifest',
    schemaVersion: SCHEMA_VERSION,
    assemblyId: assembly.id,
    name: assembly.name,
    supportedDirections: [...supported],
    defaultDirection: assembly.defaultDirection,
    defaultActionId: assembly.defaultActionId,
    files: {
      assembly: 'assembly.json',
      animations: animationFiles,
      assets: Object.fromEntries(exportedAssets.map((a) => [a.id, a.imagePath])),
      audio: Object.fromEntries(audio.map((a) => [a.id, a.audioPath])),
    },
    actions: assembly.actions.map((a) => ({ id: a.id, name: a.name, duration: a.duration, loop: a.loop })),
    channels: assembly.channels.map((c) => ({ id: c.id, name: c.name })),
  };

  files.push({ path: 'assembly.json', data: JSON.stringify(pkg, null, 2) });
  files.push({ path: 'manifest.json', data: JSON.stringify(manifest, null, 2) });
  files.push({ path: 'assets.ts', data: renderStaticRegistry(exportedAssets) });
  files.push({ path: 'examples/BasicUsage.tsx', data: renderExample(assembly) });
  files.push({ path: 'README.md', data: renderReadme(assembly, manifest, warnings) });

  if (assembly.sprites.length === 0) warnings.push('Assembly has no sprites');
  if (assembly.actions.length === 0) warnings.push('Assembly has no actions');
  return { pkg, manifest, files, warnings };
}

/** Portable single-action package: the action plus the rig subset it needs. */
export function buildActionPackage(pkg: AssemblyPackage, actionId: string): ActionPackage {
  const asm = pkg.assembly;
  const action = asm.actions.find((a) => a.id === actionId);
  if (!action) throw new Error(`Unknown action ${actionId}`);
  // Include every targeted sprite and its ancestors + descendants so the pose is self-consistent.
  const needed = new Set<string>();
  const byId = new Map(asm.sprites.map((s) => [s.id, s]));
  for (const t of action.tracks) {
    let cur = byId.get(t.targetId);
    while (cur) {
      needed.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    for (const d of getDescendantIds(asm.sprites, t.targetId)) needed.add(d);
  }
  const sprites = needed.size ? asm.sprites.filter((s) => needed.has(s.id)) : asm.sprites;
  const assetIds = new Set(sprites.map((s) => s.assetId));
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'elemental-action',
    action,
    layers: asm.layers,
    sprites,
    channels: asm.channels,
    assets: pkg.assets.filter((a) => assetIds.has(a.id)),
    audio: pkg.audio.filter((a) => action.audioEvents.some((e) => e.assetId === a.id)),
  };
}

function extOf(p: string): string {
  const i = p.lastIndexOf('.');
  return i >= 0 ? p.slice(i) : '';
}

function renderStaticRegistry(assets: SpriteAsset[]): string {
  const lines = assets.map((a) => `  ${JSON.stringify(a.imagePath)}: require(${JSON.stringify('./' + a.imagePath)}),`);
  return [
    '// Generated by Elemental Sprite Studio. Maps package-relative image paths to Metro asset modules.',
    "import type { StaticAssetRegistry } from '@elemental/animation-runtime';",
    '',
    'export const assets: StaticAssetRegistry = {',
    ...lines,
    '};',
    '',
  ].join('\n');
}

function renderExample(assembly: UnitAssembly): string {
  const first = assembly.actions[0];
  return `// Generated example. Copy this folder into your React Native project and adjust the import paths.
import React from 'react';
import { ElementalUnit, loadAssemblyPackage } from '@elemental/animation-runtime';
import { assets } from '../assets';
import assemblyJson from '../assembly.json';

const pkg = loadAssemblyPackage(assemblyJson);

export function ${toComponentName(assembly.name)}Example() {
  return (
    <ElementalUnit
      assembly={pkg}
      resolveImage={(asset) => assets[asset.imagePath]}
      direction="${assembly.defaultDirection}"
      action=${first ? JSON.stringify(first.id) : 'undefined'}
      playing
      width={400}
      height={400}
    />
  );
}
`;
}

function toComponentName(name: string): string {
  const s = name.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  return /^[A-Za-z]/.test(s) ? s : `Unit${s}`;
}

function renderReadme(assembly: UnitAssembly, manifest: AssemblyManifest, warnings: string[]): string {
  const actions = manifest.actions.map((a) => `| \`${a.id}\` | ${a.name} | ${a.duration.toFixed(2)}s | ${a.loop ? 'loop' : 'once'} |`).join('\n');
  return `# ${assembly.name}

Exported by ${GENERATOR} (schema ${manifest.schemaVersion}).

## Contents

- \`assembly.json\` – complete assembly package (rig, directions, actions, channels, behaviours, asset metadata). Load with \`loadAssemblyPackage()\`.
- \`manifest.json\` – summary for tooling (supported directions, action list, file map).
- \`animations/*.json\` – each action as a standalone portable package.
- \`assets/*.png\` – original, unmodified sprite images. Paths are relative to this folder.
- \`assets.ts\` – static \`require()\` registry for Metro bundles.
- \`examples/BasicUsage.tsx\` – minimal usage with \`ElementalUnit\`.

## Actions

| id | name | duration | mode |
|----|------|----------|------|
${actions || '| – | – | – | – |'}

## Directions

Default: \`${manifest.defaultDirection}\`. Supported: ${manifest.supportedDirections.map((d) => `\`${d}\``).join(', ')}.

## Runtime

\`\`\`tsx
import { ElementalUnit, loadAssemblyPackage } from '@elemental/animation-runtime';
const pkg = loadAssemblyPackage(require('./assembly.json'));
<ElementalUnit assembly={pkg} resolveImage={(a) => assets[a.imagePath]} action="${manifest.defaultActionId ?? ''}" playing />
\`\`\`

Transform contract: y-down, positive Z rotation clockwise, \`node = parentFrame · T(position) · R(rotation Z) · S(scale ⊙ flip)\`, \`draw = node · P(rotationX, rotationY) · T(−pivot)\`. X/Y are projected foreshortening about the pivot and do not affect child parent frames.
Keyframe times are seconds; \`fps\` is only an authoring snap grid.
${warnings.length ? `\n## Export warnings\n\n${warnings.map((w) => `- ${w}`).join('\n')}\n` : ''}`;
}
