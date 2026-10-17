import type { Project } from '@elemental/asset-schema';
import { normalizeAssetFolder } from '@/engine/commands';

/**
 * Ensure folder metadata is complete before persist so Save keeps library folders
 * (including empty ones already listed, plus every path used by assets).
 */
export function prepareProjectForSave(project: Project): Project {
  const folders = new Set<string>();
  for (const f of project.settings?.assetFolders ?? []) {
    const n = normalizeAssetFolder(f);
    if (n) folders.add(n);
  }
  for (const a of project.assets) {
    const n = normalizeAssetFolder(a.folder ?? '');
    if (n) folders.add(n);
  }
  return {
    ...project,
    updatedAt: Date.now(),
    settings: {
      ...project.settings,
      assetFolders: [...folders].sort((a, b) => a.localeCompare(b)),
    },
    assets: project.assets.map((a) => ({
      ...a,
      folder: normalizeAssetFolder(a.folder ?? ''),
    })),
  };
}

