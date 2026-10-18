import type { AssemblyPackage, Project, SpriteAsset, UnitAssembly } from '@elemental/asset-schema';
import { createId, migrateDocument, ProjectSchema, slugify } from '@elemental/asset-schema';
import { loadAssemblyPackage } from '@elemental/animation-runtime';
import { blobStore } from '@/state/blobStore';
import { useEditorStore } from '@/state/editorStore';
import { getAssetLookup, useProjectStore } from '@/state/projectStore';
import { utf8Decode, utf8Encode } from '@/utils/base64';
import { buildAssemblyExport, type BuiltExport, type ExportFile } from './buildPackage';
import {
  buildV2UnitPack,
  requiredVariantsFor,
  type Faction,
  type UnitKind,
  type V2VariantSource,
} from './v2UnitPack';
import { deliverFile, filesToZip, unzip } from './zip';

export function buildCurrentAssemblyExport(): BuiltExport | null {
  const { project } = useProjectStore.getState();
  const assembly = project.assemblies.find((a) => a.id === project.activeAssemblyId);
  if (!assembly) return null;
  return buildAssemblyExport(project, assembly, getAssetLookup(), (p) => blobStore.get(p)?.bytes);
}

export async function exportAssemblyZip(): Promise<{ message: string; warnings: string[] } | null> {
  const built = buildCurrentAssemblyExport();
  if (!built) return null;
  const zip = await filesToZip(built.files);
  const message = await deliverFile(`${slugify(built.manifest.name) || 'assembly'}.zip`, zip, 'application/zip');
  return { message, warnings: built.warnings };
}

export async function exportAssemblyJson(): Promise<{ message: string; warnings: string[] } | null> {
  const built = buildCurrentAssemblyExport();
  if (!built) return null;
  const message = await deliverFile(`${slugify(built.manifest.name) || 'assembly'}.json`, utf8Encode(JSON.stringify(built.pkg, null, 2)), 'application/json');
  return { message, warnings: built.warnings };
}

export interface V2ExportRequest {
  kind: UnitKind;
  faction: Faction;
  /** variantId → assemblyId. Missing required keys produce warnings. */
  variantAssemblyIds: Record<string, string>;
}

/** Elemental game drop-in pack for assets/v2/units/ (+ control.js). */
export async function exportV2UnitPackZip(req: V2ExportRequest): Promise<{ message: string; warnings: string[] } | null> {
  const { project } = useProjectStore.getState();
  const variants: V2VariantSource[] = [];
  for (const [variantId, assemblyId] of Object.entries(req.variantAssemblyIds)) {
    const assembly = project.assemblies.find((a) => a.id === assemblyId);
    if (!assembly) throw new Error(`Assembly not found for variant "${variantId}"`);
    variants.push({ variantId, assembly });
  }
  if (variants.length === 0) {
    const assembly = project.assemblies.find((a) => a.id === project.activeAssemblyId) ?? project.assemblies[0];
    if (!assembly) return null;
    const fallback = requiredVariantsFor(req.kind, req.faction)[0] ?? 'equipped';
    variants.push({ variantId: fallback, assembly });
  }
  const built = buildV2UnitPack(project, { kind: req.kind, faction: req.faction, variants }, getAssetLookup(), (p) => blobStore.get(p)?.bytes);
  const zip = await filesToZip(built.files);
  const base = slugify(`${req.kind}-${req.faction}`) || 'unit-pack';
  const message = await deliverFile(`${base}-v2-unit-pack.zip`, zip, 'application/zip');
  return { message: `${message} — drop into assets/v2/units/ then run sync scripts`, warnings: built.warnings };
}

/** Whole project (document + every blob) as a ZIP for Save As / backup. */
export async function exportProjectBackup(filenameBase?: string): Promise<string> {
  const { project, globalAssets } = useProjectStore.getState();
  const files: ExportFile[] = [
    { path: 'project.json', data: JSON.stringify(project, null, 2) },
    { path: 'global-assets.json', data: JSON.stringify(globalAssets, null, 2) },
  ];
  const paths = new Set([...project.assets.map((a) => a.imagePath), ...globalAssets.map((a) => a.imagePath), ...project.audio.map((a) => a.audioPath)]);
  for (const p of paths) {
    const b = blobStore.get(p);
    if (b) files.push({ path: `blobs/${p}`, data: b.bytes });
  }
  const zip = await filesToZip(files);
  const base = slugify(filenameBase?.trim() || project.name) || 'project';
  return deliverFile(`${base}.ess.zip`, zip, 'application/zip');
}

/**
 * Import an exported package (ZIP or bare assembly.json) into the current project as a new
 * assembly. Image bytes are keyed by their package path prefixed with the assembly slug to avoid
 * clobbering existing project assets.
 */
export async function importAssemblyPackage(file: { name: string; bytes: Uint8Array }): Promise<{ assemblyId: string; warnings: string[] }> {
  const warnings: string[] = [];
  let pkg: AssemblyPackage;
  const images = new Map<string, Uint8Array>();
  if (file.name.toLowerCase().endsWith('.zip')) {
    const entries = await unzip(file.bytes);
    const asm = entries.find((e) => e.path === 'assembly.json' || e.path.endsWith('/assembly.json'));
    if (!asm) throw new Error('ZIP does not contain assembly.json');
    const root = asm.path.slice(0, asm.path.length - 'assembly.json'.length);
    pkg = loadAssemblyPackage(utf8Decode(asm.bytes));
    for (const e of entries) if (e.path.startsWith(root) && e.path !== asm.path) images.set(e.path.slice(root.length), e.bytes);
  } else {
    pkg = loadAssemblyPackage(utf8Decode(file.bytes));
    warnings.push('Bare JSON import: image files must be re-imported manually (ZIP exports include them).');
  }
  const prefix = `imported/${slugify(pkg.assembly.name) || 'assembly'}-${createId('').slice(-6)}/`;
  const assets: SpriteAsset[] = pkg.assets.map((a) => {
    const key = prefix + a.imagePath;
    const bytes = images.get(a.imagePath);
    if (bytes) blobStore.put(key, bytes, 'image/png');
    else if (images.size) warnings.push(`Missing image ${a.imagePath}`);
    return { ...a, imagePath: key };
  });
  const assembly: UnitAssembly = { ...pkg.assembly, id: createId('asm') };
  useProjectStore.getState().commit('Import assembly', (d) => {
    const existing = new Set(d.assets.map((a) => a.id));
    for (const a of assets) if (!existing.has(a.id)) d.assets.push(a);
    d.assemblies.push(assembly);
    d.activeAssemblyId = assembly.id;
  });
  useEditorStore.getState().select([]);
  useEditorStore.getState().setActiveAction(assembly.actions[0]?.id ?? null);
  return { assemblyId: assembly.id, warnings };
}

/** Restore a project pack created by Save As / Backup (`project.json` + `blobs/`). */
export async function importProjectBackup(bytes: Uint8Array): Promise<Project> {
  const entries = await unzip(bytes);
  const doc = entries.find((e) => e.path === 'project.json' || e.path.endsWith('/project.json'));
  if (!doc) throw new Error('Not a project file (project.json missing)');
  const parsed = ProjectSchema.safeParse(migrateDocument(JSON.parse(utf8Decode(doc.bytes))));
  if (!parsed.success) throw new Error(`Invalid project.json: ${parsed.error.issues[0]?.message ?? 'parse failed'}`);
  const project = parsed.data;
  for (const e of entries) {
    if (!e.path.includes('blobs/')) continue;
    const key = e.path.replace(/^.*blobs\//, '');
    if (!key) continue;
    blobStore.put(key, e.bytes, key.endsWith('.png') ? 'image/png' : 'application/octet-stream');
  }
  const globalEntry = entries.find((e) => e.path === 'global-assets.json' || e.path.endsWith('/global-assets.json'));
  if (globalEntry) {
    try {
      const globals = JSON.parse(utf8Decode(globalEntry.bytes)) as SpriteAsset[];
      if (Array.isArray(globals)) useProjectStore.getState().setGlobalAssets(globals);
    } catch {
      /* ignore corrupt global list */
    }
  }
  useProjectStore.getState().setProject(project, { dirty: true });
  useEditorStore.getState().select([]);
  useEditorStore.getState().setActiveAction(project.assemblies.find((a) => a.id === project.activeAssemblyId)?.actions[0]?.id ?? project.assemblies[0]?.actions[0]?.id ?? null);
  return project;
}
