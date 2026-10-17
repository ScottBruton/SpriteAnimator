import {
  compose,
  getRotationDeg,
  getScale,
  invert,
  matEquals,
  multiply,
  rotationDeg,
  scaling,
  transformPoint,
  translation,
  trs,
} from '@elemental/animation-core';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

describe('mat2d', () => {
  test('translation moves points', () => {
    expect(transformPoint(translation(10, -5), { x: 1, y: 2 })).toEqual({ x: 11, y: -3 });
  });

  test('positive rotation is clockwise on a y-down screen', () => {
    // +90° should take the +x axis to +y (down on screen).
    const p = transformPoint(rotationDeg(90), { x: 1, y: 0 });
    expect(near(p.x, 0)).toBe(true);
    expect(near(p.y, 1)).toBe(true);
  });

  test('multiply applies the right-hand matrix first', () => {
    const m = multiply(translation(10, 0), rotationDeg(90));
    const p = transformPoint(m, { x: 1, y: 0 });
    expect(near(p.x, 10)).toBe(true);
    expect(near(p.y, 1)).toBe(true);
  });

  test('compose is left-to-right multiply', () => {
    const a = compose(translation(1, 2), rotationDeg(30), scaling(2, 3));
    const b = multiply(multiply(translation(1, 2), rotationDeg(30)), scaling(2, 3));
    expect(matEquals(a, b)).toBe(true);
  });

  test('invert round-trips', () => {
    const m = trs({ x: 12, y: -7 }, 37, { x: 1.5, y: -2 });
    const p = { x: 3, y: 4 };
    const q = transformPoint(invert(m), transformPoint(m, p));
    expect(near(q.x, p.x)).toBe(true);
    expect(near(q.y, p.y)).toBe(true);
  });

  test('decomposition recovers rotation and signed scale', () => {
    const m = trs({ x: 0, y: 0 }, -60, { x: 2, y: -0.5 });
    expect(near(getRotationDeg(m), -60)).toBe(true);
    const s = getScale(m);
    expect(near(s.x, 2)).toBe(true);
    expect(near(s.y, -0.5)).toBe(true);
  });
});
