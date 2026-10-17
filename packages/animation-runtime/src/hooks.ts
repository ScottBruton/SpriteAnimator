import { useEffect, useMemo, useReducer, useRef } from 'react';
import type { AssemblyPackage, Direction, SpriteAsset } from '@elemental/asset-schema';
import { sharedClock, type AnimationClock } from './AnimationClock';
import { ImageRegistry, sharedImageRegistry } from './ImageRegistry';
import { createAssetLookup } from './loadAssembly';
import { UnitInstance } from './UnitInstance';

/** Re-render when the registry gains/loses images. */
export function useImageRegistry(registry: ImageRegistry = sharedImageRegistry): ImageRegistry {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => registry.subscribe(bump), [registry]);
  return registry;
}

/**
 * Load every PNG in a package into the registry. `resolveUri` maps a package-relative `imagePath`
 * to something Skia can fetch (http URL, file URI, data URI) — or returns bytes directly.
 */
export function useAssemblyImages(
  pkg: AssemblyPackage | null,
  resolve: (asset: SpriteAsset) => string | Uint8Array | undefined,
  registry: ImageRegistry = sharedImageRegistry,
): { loaded: number; total: number; ready: boolean } {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const total = pkg?.assets.length ?? 0;
  useEffect(() => {
    if (!pkg) return;
    let cancelled = false;
    (async () => {
      for (const asset of pkg.assets) {
        if (registry.has(asset.imagePath)) continue;
        const src = resolve(asset);
        if (!src) continue;
        if (typeof src === 'string') await registry.registerUri(asset.imagePath, src);
        else registry.registerBytes(asset.imagePath, src);
        if (!cancelled) bump();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkg, registry]);
  const loaded = pkg ? pkg.assets.filter((a) => registry.has(a.imagePath)).length : 0;
  return { loaded, total, ready: pkg !== null && loaded === total };
}

export interface UseUnitOptions {
  direction?: Direction;
  clock?: AnimationClock;
  /** When false the clock does not advance the unit. Default true. */
  playing?: boolean;
  speed?: number;
}

/**
 * Create a `UnitInstance` for a package and drive it from the shared clock. Returns the instance
 * and a frame counter that changes whenever the pose changed (use it as a render dependency).
 */
export function useUnit(pkg: AssemblyPackage | null, opts: UseUnitOptions = {}): { unit: UnitInstance | null; frame: number } {
  const lookup = useMemo(() => (pkg ? createAssetLookup(pkg.assets) : () => undefined), [pkg]);
  const unit = useMemo(() => (pkg ? new UnitInstance(pkg.assembly, lookup, opts.direction) : null), [pkg, lookup]); // eslint-disable-line react-hooks/exhaustive-deps
  const [frame, bump] = useReducer((n: number) => n + 1, 0);
  const playingRef = useRef(opts.playing ?? true);
  playingRef.current = opts.playing ?? true;
  const speedRef = useRef(opts.speed ?? 1);
  speedRef.current = opts.speed ?? 1;

  useEffect(() => {
    if (!unit) return;
    const clock = opts.clock ?? sharedClock;
    return clock.subscribe((dt) => {
      if (!playingRef.current) return;
      unit.advance(dt * speedRef.current);
      bump();
    });
  }, [unit, opts.clock]);

  useEffect(() => {
    if (unit && opts.direction) {
      unit.setDirection(opts.direction);
      bump();
    }
  }, [unit, opts.direction]);

  return { unit, frame };
}
