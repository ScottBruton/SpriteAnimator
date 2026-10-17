# Transform contract

This document is the single source of truth for how a sprite instance's numbers in `assembly.json`
become pixels. The editor canvas, the test arena and `@elemental/animation-runtime` all call the
same functions in `packages/animation-core`, so an exported assembly is reproduced exactly.

## Coordinate conventions

- **Units**: image pixels. World space is unscaled sprite pixels; the host (editor view, game
  camera) applies its own view matrix on top.
- **Axes**: x right, **y down** (screen convention). Positive rotation is **clockwise** on screen.
- **Angles**: degrees in all data and APIs (`Transform2D.rotation`, `AttachmentPoint.rotation`,
  joint limits). Radians appear only inside `math/mat2d.ts`.
- **Image-local space**: origin at the PNG's top-left pixel, `(width, height)` bottom-right.
  Pivots and attachment points are stored in this space, as floats (half-pixel values allowed).
- **Time**: seconds (float). `fps` on an action is only a snapping/display aid.

## Matrices

`Mat2D = [a, b, c, d, tx, ty]` — column-major affine matrix

```
| a  c  tx |
| b  d  ty |
| 0  0  1  |
```

`multiply(A, B)` means "apply B, then A" (standard matrix product `A·B`). Skia receives
`toSkiaMatrixValues(m) = [a, c, tx, b, d, ty, 0, 0, 1]`.

## Instance transform

`Transform2D = { position, rotation, scale, flipX, flipY }` is always expressed **in the parent
frame** (see below), with the instance's **pivot at the node origin**.

```
S' = scale ⊙ (flipX ? -1 : 1, flipY ? -1 : 1)
M_node = T(position) · R(rotation) · S(S')             localNodeMatrix()
M_draw = M_node · T(-pivot)                            drawMatrixFromNode()
```

- `M_node` maps the pivot-centred frame into the parent frame. Rotation and scale therefore
  always happen **about the pivot**.
- `M_draw` maps image-local pixels into the parent frame and is what the renderer uses to draw the
  PNG (`<Image x=0 y=0 width height>` under `Group matrix=M_draw_world`).

## Parent frames and attachments

For a root instance the parent frame is the identity (world). For a child:

```
parentFrame = parentWorldNode · M_attachment            if parentAttachmentId is set
parentFrame = parentWorldNode                           otherwise
M_attachment = T(attachment.position - parentPivot) · R(attachment.rotation)   attachmentFrameMatrix()
worldNode(child) = parentFrame · M_node(child)
```

`attachment.position` is in the **parent's image-local** space; subtracting the parent pivot moves
it into the parent's node frame. This is what makes an arm "hang from the shoulder": with
`position = (0,0)` the child's pivot sits exactly on the attachment, and rotating the child
rotates it around the attachment.

Linking (`linkInstance`) supports two modes:

- `snap` — `snappedLocalTransform()`: child socket (its pivot, or one of its own attachments)
  coincides with the parent attachment; rotation/scale/flip are kept.
- `preserve` — `preserveWorldPose()`: `local = inverse(parentFrame) · childWorldNode`,
  decomposed back to a `Transform2D` with `decomposeNodeMatrix()` (mirroring is folded into
  `flipY`, or kept as `flipX` + 180° if that was the previous representation).

Unlinking uses `preserveWorldPose` against the identity so the sprite does not move.

## Pose evaluation order (`evaluatePose`)

1. **Setup pose**: `resolveSetupPose()` copies every instance's rig transform, applies the
   direction configuration (per-direction overrides, mirroring) and resolves assets.
2. **Animation**: channels sorted by `priority` (base channel first). For every playing layer on
   that channel: `t = resolveActionTime(time, duration, loop)` (loop → `time mod duration`,
   otherwise clamp), sample each track with `sampleTrack()` (per-key interpolation:
   `step | linear | ease-in | ease-out | ease-in-out | bezier`), apply with the channel's
   `blendMode` (`override` = lerp by weight, `additive` = add × weight), subject to the action mask
   and channel mask (`instanceIds`, `properties`).
3. **Overrides**: per-instance `PoseOverride`s (editor un-keyed edits, game-side procedural
   adjustments) replace transform fields / opacity / visibility.
4. **Constraints**: `constrainRotation()` clamps rotation relative to the rest rotation when
   `instance.joint` is set (`free | rotation (min/max) | fixed`).
5. **World matrices**: `computeWorldTransforms()` walks parents before children (stable order,
   cycle-safe) producing `{ parentFrame, node, draw }` for every instance.
6. **Render list**: `buildRenderList()` — visible instances only, hidden layers and hidden
   ancestors excluded, sorted by layer order (back → front) then `orderInLayer`; each
   `RenderItem` carries `matrix = draw`, `opacity`, `width`, `height`.

## Keyframes

```
AnimationTrack { targetId, property: position|rotation|scale|opacity|visible|ikTarget|ikInfluence, keys[] }
Keyframe { time (s), value, interpolation, bezier? }
```

- Keys are kept sorted by time; `setKeyframe` replaces an existing key at the same time.
- Sampling before the first key holds the first value; after the last key holds the last value
  (so a looping action with keys at 0 and 0.5 holds from 0.5 until it wraps).
- `visible` is `step`-sampled; `opacity` is clamped to `[0, 1]`.

## Invariants the editor relies on

- Dragging a pivot with the canvas **Pivot tool** does not move the image: the controller
  compensates the selected instance's position by the pivot delta transformed through `M_node`
  (`useCanvasInteraction`, `case 'pivot'`). Editing the pivot in the Sprite Editor dialog changes
  asset data only, so placed instances shift accordingly (they rotate about the new pivot).
- Dragging the shared pivot/attachment markers edits **asset** data (all instances of the asset
  update); dragging the sprite edits **instance** data.
- Snapping tolerance is measured in screen pixels (`settings.snapTolerance / view.zoom` in world).
