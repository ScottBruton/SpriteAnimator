# Elemental Sprite Studio

A standalone 2D rigid-sprite rigging and animation editor (Expo Web + iOS) that exports portable
JSON + PNG assembly packages playable by a reusable React Native runtime
(`@elemental/animation-runtime`). The editor has no dependency on any game repository; the runtime
has no dependency on the editor UI.

## Status

Phase 1–4 of the master specification are implemented and verified end-to-end in the browser:

| Area | State |
| --- | --- |
| Project scaffold (Expo SDK 58, Expo Router, strict TypeScript) | done |
| `packages/asset-schema` – versioned Zod schemas, factories, migrations | done |
| `packages/animation-core` – Mat2D math, TRS/pivot/attachment transforms, keyframe sampling, pose evaluation, direction resolution, joint limits, 2-bone IK solver | done |
| `packages/animation-runtime` – assembly loader, animation clock, Skia renderer, `ElementalUnit` component, `UnitInstance` for game loops | done |
| Editor shell – menu bar, toolbar, explorer, Skia canvas, inspector, layers, asset library, timeline, status bar, dialogs, compact (<900 px) layout | done |
| PNG import (web file input / native DocumentPicker), project + global asset libraries, drag-to-place | done |
| Sprite editor – pivot presets/drag, attachment CRUD with rotation handle, pixel grid | done |
| Snap-linking by dragging a pivot/attachment onto another sprite's attachment, rotate/scale about pivot, unlink preserving world pose | done |
| Actions, keyframes (insert/move/delete, interpolation per key), auto-key, playback | done |
| Save/load (IndexedDB on web, FileSystem on native), autosave, project list, ZIP backup/restore | done |
| Export ZIP / JSON (assembly, animations, manifest, PNGs, `assets.ts`, example, README) and re-import | done |
| Standalone runtime verification screen (`/runtime-test`) and interactive test arena (Assembly tab) | done |

Verified vertical slice (Spec §32, Step 4): import `body.png` + `arm.png` → place → add `shoulder`
attachment on body → set arm pivot → snap arm onto shoulder → rotate about shoulder → action
`wave` with keys at 0 s / 0.5 s / 1.0 s → play → save → reload → export ZIP → load ZIP in the
standalone runtime screen → identical animation.

### Not yet implemented (honest list)

- Audio tracks / audio event playback (`expo-audio` is installed but not wired).
- Sprite-sheet extraction (import of packed sheets into individual assets).
- Animation channel layering UI (masks / priority / blend). The schema and evaluator support
  multiple channels, the editor only authors the base channel.
- Direction-override authoring UI. Direction resolution/mirroring exists in core and the runtime;
  the editor edits the shared rig only (direction selector in the toolbar previews resolution).
- Curve editor (per-key easing is selectable, bezier handles are not editable visually).
- Rig templates, IK handle UI (solver exists in `animation-core`, no editor tool yet).
- Live validation panel (schema validation runs on load/import/export only).
- iOS has not been built on this Windows machine; the code paths are platform-split
  (`Platform.OS`) and typed, but untested on device.

## Getting started

```bash
npm install                 # also copies canvaskit.wasm into public/ (postinstall)
npx expo start --web        # editor at http://localhost:8081
npx expo start --ios        # requires a development build (Skia, Reanimated, RNGH are native)
```

Scripts: `npm run typecheck`, `npm run lint`, `npm test`, `npm run export:web`, `npm run doctor`.

## Repository layout

```
packages/
  asset-schema/        Zod schemas + TS types for assets, rigs, assemblies, animations, projects
  animation-core/      pure math & evaluation (no React, no Skia)
  animation-runtime/   React Native Skia renderer + ElementalUnit (depends on core + schema only)
src/
  app/                 Expo Router routes (_layout, index = editor, runtime-test)
  components/          editor UI (shell, explorer, inspector, layers, assets, timeline, dialogs…)
  engine/              editor commands (undoable), picking, pose evaluation hook
  rendering/           Skia editor canvas, overlays, rulers, gesture controller
  state/               Zustand stores (project/undo, editor UI, pose overrides, image blobs)
  storage/             StorageAdapter (IndexedDB web / expo-file-system native), project service
  importers/           PNG import, file picking
  exporters/           package builder, ZIP, export/import service
tests/core/            Jest tests for animation-core
docs/                  ARCHITECTURE.md, TRANSFORM_CONTRACT.md
```

## Exported package format

```
<assembly-slug>.zip
  assembly.json          AssemblyPackage (schemaVersion, assembly, assets, actions)
  animations/<slug>.json one ActionPackage per action (optional, for lazy loading)
  manifest.json          summary for tooling: supported directions, action list, file map, generator
  assets/<slug>.png      original PNG bytes, unmodified
  assets.ts              static require() registry for Metro bundles
  examples/BasicUsage.tsx
  README.md
```

All paths are relative. IDs are stable across saves/exports. See
`docs/TRANSFORM_CONTRACT.md` for the exact math the runtime reproduces.

## Known limitations / platform notes

- **Skia on web** must be loaded before any `@shopify/react-native-skia` import; `src/app/_layout.tsx`
  awaits `LoadSkiaWeb()` and lazy-loads screens. `canvaskit.wasm` is served from `public/`.
- **Pan gesture start point.** RNGH measures `translationX/Y` from the activation point, so the
  canvas controller records the press point in `onBegin` and uses it for hit tests.
- **IndexedDB** via `idb-keyval` uses one object store per database → three DBs
  (`…-projects`, `…-blobs`, `…-settings`).
- Playhead at `t === duration` on a looping action wraps to `t = 0` (matches runtime).
- Keyframe times are stored in seconds; `fps` is a snapping/display aid only.
