import type { SpriteAsset, SpriteInstance } from '@elemental/asset-schema';
import { identityTransform } from '@elemental/asset-schema';
import {
  attachmentWorldFrame,
  attachmentWorldPosition,
  computeWorldTransforms,
  decomposeNodeMatrix,
  localNodeMatrix,
  matEquals,
  pivotWorldPosition,
  preserveWorldPose,
  snappedLocalTransform,
  transformPoint,
  wouldCreateCycle,
  type ResolvedInstance,
} from '@elemental/animation-core';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const expectPoint = (p: { x: number; y: number }, x: number, y: number) => {
  expect(near(p.x, x)).toBe(true);
  expect(near(p.y, y)).toBe(true);
};

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
const arm: SpriteAsset = {
  id: 'arm',
  name: 'arm',
  imagePath: 'arm.png',
  width: 20,
  height: 80,
  pivot: { x: 10, y: 5 },
  attachments: [{ id: 'hand', name: 'hand', position: { x: 10, y: 75 }, rotation: 0 }],
  projectilePoints: [],
  tags: [],
  folder: '',
};

function inst(partial: Partial<SpriteInstance> & Pick<SpriteInstance, 'id' | 'assetId'>): SpriteInstance {
  return {
    name: partial.id,
    parentId: null,
    transform: identityTransform(),
    layerId: 'L',
    orderInLayer: 0,
    visible: true,
    opacity: 1,
    locked: false,
    ...partial,
  };
}

function resolve(instances: SpriteInstance[], assets: SpriteAsset[]): Map<string, ResolvedInstance> {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const map = new Map<string, ResolvedInstance>();
  for (const i of instances) {
    const asset = byId.get(i.assetId)!;
    map.set(i.id, {
      instance: i,
      asset,
      pivot: asset.pivot,
      transform: structuredClone(i.transform),
      opacity: 1,
      visible: true,
      layerId: i.layerId,
      orderInLayer: i.orderInLayer,
    });
  }
  return map;
}

describe('world transforms', () => {
  test('root sprite: pivot lands at position, image offset by -pivot', () => {
    const b = inst({ id: 'b', assetId: 'body', transform: { ...identityTransform(), position: { x: 300, y: 400 } } });
    const world = computeWorldTransforms(resolve([b], [body]));
    const w = world.get('b')!;
    expectPoint(pivotWorldPosition(w), 300, 400);
    expectPoint(transformPoint(w.draw, { x: 0, y: 0 }), 250, 300);
    expectPoint(attachmentWorldPosition(w, body.attachments[0]!.position), 340, 340);
  });

  test('child attached to parent attachment follows parent translation and rotation', () => {
    const b = inst({ id: 'b', assetId: 'body', transform: { ...identityTransform(), position: { x: 300, y: 400 } } });
    const a = inst({ id: 'a', assetId: 'arm', parentId: 'b', parentAttachmentId: 'shoulder' });
    let world = computeWorldTransforms(resolve([b, a], [body, arm]));
    // Arm pivot sits exactly on the shoulder.
    expectPoint(pivotWorldPosition(world.get('a')!), 340, 340);

    // Rotate the body 90° clockwise about its pivot: shoulder offset (40,-60) -> (60,40).
    b.transform.rotation = 90;
    world = computeWorldTransforms(resolve([b, a], [body, arm]));
    expectPoint(pivotWorldPosition(world.get('a')!), 360, 440);
    // Arm's own x axis is rotated too.
    const armHand = attachmentWorldPosition(world.get('a')!, arm.attachments[0]!.position);
    // hand is 70px "down" the arm in local y -> after 90° cw rotation local +y maps to world -x.
    expectPoint(armHand, 360 - 70, 440);
  });

  test('child rotation rotates about its own pivot (the attachment), not the image corner', () => {
    const b = inst({ id: 'b', assetId: 'body' });
    const a = inst({
      id: 'a',
      assetId: 'arm',
      parentId: 'b',
      parentAttachmentId: 'shoulder',
      transform: { ...identityTransform(), rotation: 90 },
    });
    const world = computeWorldTransforms(resolve([b, a], [body, arm]));
    const w = world.get('a')!;
    expectPoint(pivotWorldPosition(w), 40, -60); // shoulder relative to body pivot
    // hand offset from pivot is (0, 70) locally -> rotated 90° cw -> (-70, 0)
    expectPoint(attachmentWorldPosition(w, arm.attachments[0]!.position), 40 - 70, -60);
  });

  test('nested chain with non-uniform scale and flip', () => {
    const b = inst({ id: 'b', assetId: 'body', transform: { ...identityTransform(), scale: { x: 2, y: 1 }, flipX: true } });
    const a = inst({ id: 'a', assetId: 'arm', parentId: 'b', parentAttachmentId: 'shoulder' });
    const world = computeWorldTransforms(resolve([b, a], [body, arm]));
    // shoulder offset (40,-60): scaled by (2,1) then mirrored in x -> (-80, -60)
    expectPoint(pivotWorldPosition(world.get('a')!), -80, -60);
  });

  test('attachment rotation defines the child frame orientation', () => {
    const turret: SpriteAsset = {
      ...body,
      id: 'turret',
      attachments: [{ id: 'mount', name: 'mount', position: { x: 50, y: 100 }, rotation: 90 }],
    };
    const t = inst({ id: 't', assetId: 'turret' });
    const a = inst({ id: 'a', assetId: 'arm', parentId: 't', parentAttachmentId: 'mount' });
    const world = computeWorldTransforms(resolve([t, a], [turret, arm]));
    // Arm's local +y (down the arm) now points along world -x.
    expectPoint(attachmentWorldPosition(world.get('a')!, arm.attachments[0]!.position), -70, 0);
  });

  test('plain parent (no attachment) uses the parent node frame', () => {
    const b = inst({ id: 'b', assetId: 'body', transform: { ...identityTransform(), position: { x: 10, y: 10 }, rotation: 180 } });
    const a = inst({ id: 'a', assetId: 'arm', parentId: 'b', transform: { ...identityTransform(), position: { x: 5, y: 0 } } });
    const world = computeWorldTransforms(resolve([b, a], [body, arm]));
    expectPoint(pivotWorldPosition(world.get('a')!), 5, 10);
  });
});

describe('re-parenting', () => {
  test('preserveWorldPose keeps the child exactly where it was', () => {
    const b = inst({ id: 'b', assetId: 'body', transform: { ...identityTransform(), position: { x: 300, y: 400 }, rotation: 33 } });
    const a = inst({ id: 'a', assetId: 'arm', transform: { ...identityTransform(), position: { x: 345, y: 310 }, rotation: -20 } });
    const before = computeWorldTransforms(resolve([b, a], [body, arm]));
    const frame = attachmentWorldFrame(before.get('b')!.node, body.attachments[0]!, body.pivot);
    const local = preserveWorldPose(before.get('a')!.node, frame, a.transform);
    const a2 = { ...a, parentId: 'b', parentAttachmentId: 'shoulder', transform: local };
    const after = computeWorldTransforms(resolve([b, a2], [body, arm]));
    expect(matEquals(before.get('a')!.node, after.get('a')!.node, 1e-6)).toBe(true);
  });

  test('snappedLocalTransform with pivot socket puts the pivot on the attachment', () => {
    const t = snappedLocalTransform({ childPivot: arm.pivot, rotation: 45, scale: { x: 1, y: 1 }, flipX: false, flipY: false });
    expectPoint(t.position, 0, 0);
    expect(t.rotation).toBe(45);
  });

  test('snappedLocalTransform with a non-pivot socket offsets the node so the socket hits the origin', () => {
    const t = snappedLocalTransform({
      childPivot: arm.pivot,
      childSocket: arm.attachments[0]!.position,
      rotation: 0,
      scale: { x: 1, y: 1 },
      flipX: false,
      flipY: false,
    });
    const m = localNodeMatrix(t);
    const socketInNode = { x: arm.attachments[0]!.position.x - arm.pivot.x, y: arm.attachments[0]!.position.y - arm.pivot.y };
    expectPoint(transformPoint(m, socketInNode), 0, 0);
  });

  test('decompose(localNodeMatrix(t)) round-trips including flips', () => {
    const cases = [
      { ...identityTransform(), position: { x: 3, y: 4 }, rotation: 25, scale: { x: 2, y: 0.5 } },
      { ...identityTransform(), rotation: -100, scale: { x: 1, y: 1 }, flipX: true },
      { ...identityTransform(), rotation: 10, scale: { x: 1.2, y: 0.8 }, flipY: true },
    ];
    for (const c of cases) {
      const m = localNodeMatrix(c);
      const d = decomposeNodeMatrix(m, c);
      expect(matEquals(localNodeMatrix(d), m, 1e-6)).toBe(true);
    }
  });

  test('cycle detection', () => {
    const b = inst({ id: 'b', assetId: 'body' });
    const a = inst({ id: 'a', assetId: 'arm', parentId: 'b' });
    const h = inst({ id: 'h', assetId: 'arm', parentId: 'a' });
    expect(wouldCreateCycle([b, a, h], 'b', 'h')).toBe(true);
    expect(wouldCreateCycle([b, a, h], 'h', 'b')).toBe(false);
    expect(wouldCreateCycle([b, a, h], 'a', 'a')).toBe(true);
  });
});
