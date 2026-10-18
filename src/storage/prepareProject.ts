import type { Project } from '@elemental/asset-schema';
import { normalizeAssetFolder } from '@/engine/commands';

/**
 * Ensure folder metadata is complete before persist so Save keeps library folders
 * (including empty ones already listed, plus every path used by assets / assemblies).
 */
export function prepareProjectForSave(project: Project): Project {
  const assetFolders = new Set<string>();
  for (const f of project.settings?.assetFolders ?? []) {
    const n = normalizeAssetFolder(f);
    if (n) assetFolders.add(n);
  }
  for (const a of project.assets) {
    const n = normalizeAssetFolder(a.folder ?? '');
    if (n) assetFolders.add(n);
  }
  const assemblyFolders = new Set<string>();
  for (const f of project.settings?.assemblyFolders ?? []) {
    const n = normalizeAssetFolder(f);
    if (n) assemblyFolders.add(n);
  }
  for (const asm of project.assemblies) {
    const n = normalizeAssetFolder(asm.folder ?? '');
    if (n) {
      assemblyFolders.add(n);
      // Also register parent segments so empty parent folders stay listed.
      const parts = n.split('/');
      for (let i = 1; i < parts.length; i++) assemblyFolders.add(parts.slice(0, i).join('/'));
    }
  }
  return {
    ...project,
    updatedAt: Date.now(),
    settings: {
      ...project.settings,
      assetFolders: [...assetFolders].sort((a, b) => a.localeCompare(b)),
      assemblyFolders: [...assemblyFolders].sort((a, b) => a.localeCompare(b)),
    },
    assets: project.assets.map((a) => ({
      ...a,
      folder: normalizeAssetFolder(a.folder ?? ''),
    })),
    assemblies: project.assemblies.map((a) => ({
      ...a,
      folder: normalizeAssetFolder(a.folder ?? ''),
      category: a.category ?? 'unit',
    })),
  };
}

