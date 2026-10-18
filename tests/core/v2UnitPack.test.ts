import { createAssembly, createProject, createSpriteAsset, createSpriteInstance } from '@elemental/asset-schema';
import type { Project } from '@elemental/asset-schema';
import { ANGLE_TABLE, buildV2UnitPack, resolveLayerId } from '../../src/exporters/v2UnitPack';

function tinyPng(): Uint8Array {
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

describe('v2UnitPack', () => {
  it('maps layer aliases to animated ids', () => {
    expect(resolveLayerId({ name: 'Katana' })).toBe('weapon');
    expect(resolveLayerId({ name: 'Samurai', slotId: 'body' })).toBe('body');
    expect(resolveLayerId({ name: 'left fist' })).toBe('left_fist');
  });

  it('exports assemblies.json with 8 frames and relative png paths', () => {
    const asset = createSpriteAsset({ name: 'Body', imagePath: 'assets/body.png', width: 64, height: 64 });
    asset.pivot = { x: 32, y: 56 };
    const asm = createAssembly('Fire Melee');
    const inst = createSpriteInstance({ asset, layerId: asm.layers[0]!.id, position: { x: 100, y: 200 }, name: 'Body' });
    inst.slotId = 'body';
    asm.sprites = [inst];
    asm.directions = [];

    const project: Project = createProject('Test');
    project.assets = [asset];
    project.assemblies = [asm];
    project.activeAssemblyId = asm.id;

    const bytes = tinyPng();
    const built = buildV2UnitPack(
      project,
      { kind: 'melee', faction: 'fire', variants: [{ variantId: 'equipped', assembly: asm }] },
      (id) => (id === asset.id ? asset : undefined),
      () => bytes,
    );

    expect(built.unitId).toBe('melee/fire');
    expect(built.unit.schema).toBe('elemental.assembly.v1');
    expect(built.unit.variants.equipped).toHaveLength(8);
    expect(built.unit.variants.equipped!.map((f) => f.angle)).toEqual(ANGLE_TABLE.map((r) => r.angle));

    const packJson = built.files.find((f) => f.path === 'assemblies.json');
    expect(packJson).toBeTruthy();
    const pack = JSON.parse(packJson!.data as string);
    expect(pack.schema).toBe('elemental.assembly-pack.v1');

    const layer = built.unit.variants.equipped![0]!.layers[0]!;
    expect(layer.id).toBe('body');
    expect(layer.file).toMatch(/^melee\/fire\/.+\.png$/);
    expect(layer.file.includes('\\')).toBe(false);
    expect(built.files.some((f) => f.path === layer.file)).toBe(true);
    expect(built.files.some((f) => f.path.endsWith('control.js'))).toBe(true);
    expect(built.files.some((f) => f.path === 'README.md')).toBe(true);
  });
});
