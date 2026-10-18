import type { AnimationAction, SpriteAsset, UnitAssembly } from '@elemental/asset-schema';
import { createAssembly, createSpriteInstance, identityTransform } from '@elemental/asset-schema';
import {
  cubicBezierEase,
  evaluatePose,
  insertKeyframe,
  pivotWorldPosition,
  resolveActionTime,
  sampleNumber,
  sampleVector2,
  solveTwoBoneIk,
} from '@elemental/animation-core';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

describe('interpolation', () => {
  test('linear number sampling, clamped outside range', () => {
    const keys = [
      { time: 0, value: 0, interpolation: 'linear' as const },
      { time: 1, value: 10, interpolation: 'linear' as const },
    ];
    expect(sampleNumber(keys, -1)).toBe(0);
    expect(sampleNumber(keys, 0.25)).toBe(2.5);
    expect(sampleNumber(keys, 2)).toBe(10);
  });

  test('step holds the previous value until the next key', () => {
    const keys = [
      { time: 0, value: 0, interpolation: 'step' as const },
      { time: 1, value: 10, interpolation: 'step' as const },
    ];
    expect(sampleNumber(keys, 0.999)).toBe(0);
    expect(sampleNumber(keys, 1)).toBe(10);
  });

  test('rotation beyond 360 is interpolated raw (0 -> 720 spins twice)', () => {
    const keys = [
      { time: 0, value: 0, interpolation: 'linear' as const },
      { time: 2, value: 720, interpolation: 'linear' as const },
    ];
    expect(sampleNumber(keys, 1)).toBe(360);
    expect(sampleNumber(keys, 0.5)).toBe(180);
  });

  test('vector sampling', () => {
    const keys = [
      { time: 0, value: { x: 0, y: 0 }, interpolation: 'linear' as const },
      { time: 1, value: { x: 10, y: -10 }, interpolation: 'linear' as const },
    ];
    expect(sampleVector2(keys, 0.5)).toEqual({ x: 5, y: -5 });
  });

  test('bezier easing endpoints and midpoint for symmetric curve', () => {
    const h = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 };
    expect(cubicBezierEase(0, h)).toBe(0);
    expect(cubicBezierEase(1, h)).toBe(1);
    expect(near(cubicBezierEase(0.5, h), 0.5, 1e-4)).toBe(true);
    // linear bezier equals identity
    expect(near(cubicBezierEase(0.3, { x1: 0.3, y1: 0.3, x2: 0.7, y2: 0.7 }), 0.3, 1e-4)).toBe(true);
  });

  test('loop boundary wraps, non-loop clamps', () => {
    expect(near(resolveActionTime(2.5, 2, true), 0.5)).toBe(true);
    expect(resolveActionTime(2.5, 2, false)).toBe(2);
    expect(resolveActionTime(-0.5, 2, true)).toBe(1.5);
  });
});

function makeRig(): { assembly: UnitAssembly; assets: Map<string, SpriteAsset> } {
  const body: SpriteAsset = {
    id: 'body',
    name: 'body',
    imagePath: 'body.png',
    width: 100,
    height: 200,
    pivot: { x: 50, y: 100 },
    attachments: [{ id: 'shoulder', name: 'shoulder', position: { x: 90, y: 40 }, rotation: 0 }],
    projectilePoints: [],
    tags: [],
    folder: '',
  };
  const arm: SpriteAsset = { ...body, id: 'arm', name: 'arm', width: 20, height: 80, pivot: { x: 10, y: 5 }, attachments: [], projectilePoints: [] };
  const assembly = createAssembly('test');
  const layer = assembly.layers[0]!;
  const b = createSpriteInstance({ asset: body, layerId: layer.id, position: { x: 0, y: 0 } });
  b.id = 'b';
  const a = createSpriteInstance({ asset: arm, layerId: layer.id, position: { x: 0, y: 0 } });
  a.id = 'a';
  a.parentId = 'b';
  a.parentAttachmentId = 'shoulder';
  assembly.sprites = [b, a];
  return { assembly, assets: new Map([[body.id, body], [arm.id, arm]]) };
}

describe('evaluatePose', () => {
  test('keyframed rotation animates the arm about the shoulder', () => {
    const { assembly, assets } = makeRig();
    let wave: AnimationAction = { id: 'wave', name: 'wave', duration: 1, fps: 30, loop: true, tracks: [], audioEvents: [] };
    wave = insertKeyframe(wave, 'a', 'rotation', 0, 0);
    wave = insertKeyframe(wave, 'a', 'rotation', 1, 90);
    assembly.actions = [wave];

    const lookup = (id: string) => assets.get(id);
    const p0 = evaluatePose({ assembly, direction: 'S', layers: [{ actionId: 'wave', time: 0 }], lookupAsset: lookup });
    const p5 = evaluatePose({ assembly, direction: 'S', layers: [{ actionId: 'wave', time: 0.5 }], lookupAsset: lookup });
    expect(p0.resolved.get('a')!.transform.rotation).toBe(0);
    expect(p5.resolved.get('a')!.transform.rotation).toBe(45);
    // pivot stays on the shoulder regardless of rotation
    const piv0 = pivotWorldPosition(p0.world.get('a')!);
    const piv5 = pivotWorldPosition(p5.world.get('a')!);
    expect(near(piv0.x, piv5.x) && near(piv0.y, piv5.y)).toBe(true);
    expect(near(piv0.x, 40) && near(piv0.y, -60)).toBe(true);
  });

  test('setup pose is unchanged when no layers play; render list is layer-ordered', () => {
    const { assembly, assets } = makeRig();
    const pose = evaluatePose({ assembly, direction: 'S', layers: [], lookupAsset: (id) => assets.get(id) });
    expect(pose.renderList.map((r) => r.instanceId)).toEqual(['a', 'b'].sort());
    expect(pose.missingAssets).toEqual([]);
  });

  test('child renders behind parent when its orderInLayer is lower, independent of hierarchy', () => {
    const { assembly, assets } = makeRig();
    assembly.sprites[0]!.orderInLayer = 5; // body on top
    assembly.sprites[1]!.orderInLayer = 1; // arm (child) behind
    const pose = evaluatePose({ assembly, direction: 'S', layers: [], lookupAsset: (id) => assets.get(id) });
    expect(pose.renderList.map((r) => r.instanceId)).toEqual(['a', 'b']);
  });

  test('two channels: locomotion drives body position, upper body drives arm rotation simultaneously', () => {
    const { assembly, assets } = makeRig();
    assembly.channels = [
      { id: 'base', name: 'Base', priority: 0, blendMode: 'override' },
      { id: 'upper', name: 'Upper', priority: 10, blendMode: 'override', mask: { instanceIds: ['a'] } },
    ];
    let walk: AnimationAction = { id: 'walk', name: 'walk', duration: 1, fps: 30, loop: true, tracks: [], audioEvents: [], channelId: 'base' };
    walk = insertKeyframe(walk, 'b', 'position', 0, { x: 0, y: 0 });
    walk = insertKeyframe(walk, 'b', 'position', 1, { x: 100, y: 0 });
    // walk also tries to rotate the arm; the upper channel should override it.
    walk = insertKeyframe(walk, 'a', 'rotation', 0, 10);
    let attack: AnimationAction = { id: 'attack', name: 'attack', duration: 1, fps: 30, loop: false, tracks: [], audioEvents: [], channelId: 'upper' };
    attack = insertKeyframe(attack, 'a', 'rotation', 0, -90);
    attack = insertKeyframe(attack, 'a', 'rotation', 1, 90);
    // attack tries to move the body, but the channel mask restricts it to the arm.
    attack = insertKeyframe(attack, 'b', 'position', 0, { x: 999, y: 999 });
    assembly.actions = [walk, attack];

    const pose = evaluatePose({
      assembly,
      direction: 'S',
      layers: [
        { actionId: 'walk', time: 0.5 },
        { actionId: 'attack', time: 0.5 },
      ],
      lookupAsset: (id) => assets.get(id),
    });
    expect(pose.resolved.get('b')!.transform.position.x).toBe(50);
    expect(pose.resolved.get('a')!.transform.rotation).toBe(0); // -90 -> 90 at t=0.5
  });

  test('joint rotation limits clamp animated rotation', () => {
    const { assembly, assets } = makeRig();
    assembly.sprites[1]!.joint = { type: 'rotation', minRotation: -30, maxRotation: 30 };
    let act: AnimationAction = { id: 'x', name: 'x', duration: 1, fps: 30, loop: true, tracks: [], audioEvents: [] };
    act = insertKeyframe(act, 'a', 'rotation', 0, 120);
    assembly.actions = [act];
    const pose = evaluatePose({ assembly, direction: 'S', layers: [{ actionId: 'x', time: 0 }], lookupAsset: (id) => assets.get(id) });
    expect(pose.resolved.get('a')!.transform.rotation).toBe(30);
  });

  test('direction asset override swaps the sprite while keeping the rig', () => {
    const { assembly, assets } = makeRig();
    const bodyN: SpriteAsset = { ...assets.get('body')!, id: 'body_n', name: 'body_n' };
    assets.set('body_n', bodyN);
    assembly.directions = [
      {
        direction: 'N',
        assetOverrides: { b: 'body_n' },
        transformOverrides: {},
        pivotOverrides: {},
        layerOverrides: {},
        orderOverrides: {},
        visibilityOverrides: {},
      },
    ];
    const pose = evaluatePose({ assembly, direction: 'N', layers: [], lookupAsset: (id) => assets.get(id) });
    expect(pose.resolved.get('b')!.asset.id).toBe('body_n');
    expect(pose.renderList.find((r) => r.instanceId === 'b')!.assetId).toBe('body_n');
  });
});

describe('two-bone IK', () => {
  test('reaches a target within range', () => {
    const r = solveTwoBoneIk({ root: { x: 0, y: 0 }, upperLength: 50, lowerLength: 50, target: { x: 70, y: 0 }, bendDirection: 'positive' });
    expect(r.reachable).toBe(true);
    const u = (r.upperRotation * Math.PI) / 180;
    const l = (r.lowerRotation * Math.PI) / 180;
    const end = { x: 50 * Math.cos(u) + 50 * Math.cos(l), y: 50 * Math.sin(u) + 50 * Math.sin(l) };
    expect(near(end.x, 70, 1e-6)).toBe(true);
    expect(near(end.y, 0, 1e-6)).toBe(true);
  });

  test('clamps when target is out of reach', () => {
    const r = solveTwoBoneIk({ root: { x: 0, y: 0 }, upperLength: 50, lowerLength: 50, target: { x: 500, y: 0 }, bendDirection: 'positive' });
    expect(r.reachable).toBe(false);
    expect(near(r.upperRotation, 0, 1e-2)).toBe(true);
    expect(near(r.lowerRotation, 0, 1e-2)).toBe(true);
  });
});

test('identityTransform helper', () => {
  expect(identityTransform()).toEqual({
    position: { x: 0, y: 0 },
    rotation: 0,
    rotationX: 0,
    rotationY: 0,
    scale: { x: 1, y: 1 },
    flipX: false,
    flipY: false,
  });
});
