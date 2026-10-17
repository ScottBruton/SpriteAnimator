# Architecture

```
┌──────────────────────────── editor (src/) ────────────────────────────┐
│ components/*  ──►  engine/commands  ──►  state/projectStore (undo)    │
│      ▲                                     │                          │
│      │ hooks (zustand selectors)           ▼                          │
│ rendering/EditorCanvas ◄── engine/useEvaluatedPose ◄── core.evaluatePose
│      │                                                                 │
│ exporters/ ──► packages/animation-runtime  (also used by test arena)   │
└────────────────────────────────────────────────────────────────────────┘
          packages/asset-schema  ◄──  packages/animation-core  ◄──  packages/animation-runtime
          (zod + types)               (pure math, no React)         (Skia + React Native)
```

The three packages are plain TypeScript workspaces resolved through `tsconfig.json` `paths`
(`@elemental/*`) and Metro aliases; they have **no imports from `src/`**. A game only needs
`animation-runtime` (which pulls in `core` and `schema`).

## Packages

### `asset-schema`

Zod schemas and inferred types. Every persisted document carries `schemaVersion`;
`migrations.ts` upgrades older versions on load (`migrateDocument`).

| File | Contents |
| --- | --- |
| `primitives.ts` | `Vector2`, `Transform2D`, `Direction` (8-way), `Id` |
| `assets.ts` | `SpriteAsset` (image path, size, pivot, attachment points, tags), `AssetLibrary` |
| `rig.ts` | `SpriteInstance` (asset ref, parent / parentAttachmentId, transform, layer, order, joint, IK chain) |
| `assembly.ts` | `UnitAssembly` (instances, layers, directions, channels, actions, behaviours → actions, states) |
| `animation.ts` | `AnimationAction`, `AnimationTrack`, `Keyframe<T>`, `AnimationChannel`, masks, `ActionPackage` |
| `project.ts` | `Project` (name, settings, assemblies, project asset library), `EditorSettings` |
| `factories.ts` | `createProject`, `createAssembly`, `createSpriteAsset`, … stable id generation (`ids.ts`) |
| `version.ts` | `SCHEMA_VERSION`, `AssemblyPackage`, `AssemblyManifest` |

### `animation-core`

Pure functions; fully unit-tested in `tests/core`.

- `math/` – `Mat2D` ops, `vec2`, angle helpers (`normalizeDeg`, `lerpAngle`).
- `transforms/` – node/draw/attachment matrices, `computeWorldTransforms` (parent-first walk).
- `rigging/` – `attach.ts` (snap / preserve re-parenting), `hierarchy.ts` (children, descendants, cycle checks).
- `animation/` – `easing`, `sampleTrack`, `keyframeEditing` (insert/move/delete/retime), `resolveDirection` (direction configs, mirroring), `evaluatePose` (channels → overrides → constraints → world → render list).
- `constraints/` – `joint.ts` (rotation limits), `ik.ts` (analytic 2-bone IK).

See `TRANSFORM_CONTRACT.md` for the exact math.

### `animation-runtime`

- `loadAssembly.ts` – parse/validate/migrate an `AssemblyPackage`, build `AssetLookup`.
- `ImageRegistry.ts` – decodes PNG bytes (or `require()`d images) into Skia images, ref-counted.
- `AnimationClock.ts` – shared requestAnimationFrame clock (`sharedClock`) that ticks subscribed units with a delta time and speed.
- `UnitInstance.ts` – imperative unit (assembly + playing layers + direction + overrides) producing a render list and firing `onActionComplete` / `onActionLoop` / `onAudioEvent`; for game loops with hundreds of units.
- `render/RenderListView.tsx` + `drawRenderList.ts` – declarative and imperative Skia drawing of a render list.
- `ElementalUnit.tsx` – React component wrapping `UnitInstance` for simple use.
- `hooks.ts` – `useImageRegistry`, `useAssemblyImages`, `useUnit`.

## Editor

### State (`src/state`)

| Store | Purpose |
| --- | --- |
| `projectStore` | The `Project` document. Immer-based `commit(label, recipe)` pushes undo snapshots; `beginTransaction / update / endTransaction / cancelTransaction` coalesce drags into one undo step; `dirty`, `lastSavedAt`. |
| `editorStore` | UI state: workspace tab, tool, selection, hover, view (pan/zoom), active assembly/action, playhead, playing, auto-key, selected keys, key clipboard, dialogs, status message, drag ghost, snap indicator. |
| `poseOverrideStore` | Un-keyed Animate-mode edits (`PoseOverride` per instance) until keyed or discarded. |
| `blobStore` | In-memory PNG bytes + Skia images keyed by asset image key; versioned for re-render (`useBlobVersion`). |

### Commands (`src/engine/commands.ts`)

All mutations go through named, undoable commands: asset CRUD (`importAsset`, `setAssetPivot`,
`addAttachment`, `updateAttachment`, …), instance CRUD (`placeInstance`, `setInstanceTransform`,
`linkInstance`, `unlinkInstance`, layer/order moves), actions and keyframes (`addAction`,
`setKeyframe`, `keyAllTransform`, `moveKeyframes`, `deleteKeyframes`, `setKeyframeInterpolation`),
settings. Components never write the project directly.

### Rendering (`src/rendering`)

- `EditorCanvas` – Skia `<Canvas>`: background, `GridLayer`, shared `RenderListView` (same renderer
  as the runtime), `RigOverlays` (selection boxes, pivots, attachments, joint lines, marquee, link
  line, snap indicator), RN text labels, `Rulers`.
- `viewTransform` – `view {panX, panY, zoom}` ⇄ world; wheel zoom-at-cursor.
- `useCanvasInteraction` – RNGH hook-API gestures (pan, two-finger pan, pinch, tap, long-press,
  hover) → tools: select/move, rotate, scale, pivot, attachment, link, pan. Press point is captured
  in `onBegin` (RNGH translation is relative to activation).
- `canvasRegion` – window-space rect of the canvas for cross-panel drag-and-drop.

### Pose evaluation (`src/engine/useEvaluatedPose.ts`)

Memoised `evaluatePose` over the active assembly, direction, active action + playhead (Animate
mode) or setup pose (Rigging mode), plus pose overrides. All panels receive the same
`EvaluatedPose`.

### Storage (`src/storage`)

`StorageAdapter` interface with `webStorage` (idb-keyval, one DB per store) and `nativeStorage`
(expo-file-system `Paths.document`). `projectService` handles save/load/list/delete, autosave,
session restore and ZIP backup/restore (project JSON + all PNG blobs).

### Import / export (`src/importers`, `src/exporters`)

- `importPng` reads the PNG header for dimensions (`decodeImageSize`), stores bytes in
  `blobStore` and the adapter, creates a `SpriteAsset` in the project or global library.
- `buildPackage.buildAssemblyExport` collects referenced assets, rewrites image paths to relative
  `assets/<slug>.png`, emits `assembly.json`, `animations/*.json`, `manifest.json`, `assets.ts`,
  `examples/BasicUsage.tsx`, `README.md`. `zip.ts` wraps JSZip and platform file delivery.
- `exportService.importAssemblyPackage` reverses it (ZIP or JSON) into the current project.

### Routes (`src/app`)

- `_layout.tsx` – loads CanvasKit on web before rendering, wraps in `GestureHandlerRootView`.
- `index.tsx` – lazy `EditorShell`; restores last session.
- `runtime-test.tsx` – `RuntimeTestScreen`: loads an exported ZIP/JSON with only
  `animation-runtime` APIs (no editor stores) to prove the package is self-contained.

## Conventions

- Strict TypeScript, no `any`; `React.ComponentRef<typeof View>` for RN refs.
- React Compiler lint rules are enforced (`react-hooks/*`): no setState in effect bodies, no ref
  reads during render, no impure calls in render.
- Skia paths are built with `Skia.PathBuilder.Make()…detach()`.
- IDs come from `createId(prefix)` (`crypto.randomUUID` or time+random fallback) and are never
  regenerated on save/export.
- Keep original PNG bytes untouched; the editor only reads them.
