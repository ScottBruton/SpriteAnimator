import { drawMatrixFromNode, eulerXYAffine, IDENTITY, localNodeMatrix, matEquals } from '@elemental/animation-core';
import { identityTransform } from '@elemental/asset-schema';

test('eulerXYAffine is identity at zero tilt', () => {
  expect(matEquals(eulerXYAffine(0, 0), IDENTITY)).toBe(true);
});

test('draw matrix matches zero-tilt overload when tilt is zero', () => {
  const t = { ...identityTransform(), position: { x: 10, y: 20 }, rotation: 30 };
  const node = localNodeMatrix(t);
  const a = drawMatrixFromNode(node, { x: 5, y: 8 }, { rotationX: 0, rotationY: 0 });
  const b = drawMatrixFromNode(node, { x: 5, y: 8 });
  expect(matEquals(a, b)).toBe(true);
});

test('non-zero tilt changes draw but not node', () => {
  const t = { ...identityTransform(), rotationX: 40, rotationY: -25 };
  const flat = { ...t, rotationX: 0, rotationY: 0 };
  expect(matEquals(localNodeMatrix(t), localNodeMatrix(flat))).toBe(true);
  const node = localNodeMatrix(t);
  const drawTilt = drawMatrixFromNode(node, { x: 16, y: 16 }, t);
  const drawFlat = drawMatrixFromNode(node, { x: 16, y: 16 }, flat);
  expect(matEquals(drawTilt, drawFlat)).toBe(false);
});
