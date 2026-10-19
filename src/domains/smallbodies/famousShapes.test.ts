import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { SPIN_STATES, decodeShape, spinPole, spinQuaternion } from './famousShapes';

const SHAPES = resolve(import.meta.dirname, '../../../public/data/smallbodies/shapes');

function volumeRadiusKm(g: THREE.BufferGeometry): number {
  const p = g.getAttribute('position');
  const idx = g.getIndex()!;
  let v6 = 0;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    const ax = p.getX(a), ay = p.getY(a), az = p.getZ(a);
    const bx = p.getX(b), by = p.getY(b), bz = p.getZ(b);
    const cx = p.getX(c), cy = p.getY(c), cz = p.getZ(c);
    v6 += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return Math.cbrt((3 * (v6 / 6)) / (4 * Math.PI));
}

describe('spin states', () => {
  it('maps the body +Z axis onto the published pole at any time', () => {
    const q = new THREE.Quaternion();
    for (const id of ['eros', 'bennu', '67p', 'didymos']) {
      const s = SPIN_STATES[id];
      const pole = spinPole(s, new THREE.Vector3());
      for (const t of [0, 946728000000, 1.7e12]) {
        const z = new THREE.Vector3(0, 0, 1).applyQuaternion(spinQuaternion(s, t, q));
        expect(z.distanceTo(pole)).toBeLessThan(1e-9);
      }
    }
  });

  it('Eros prime meridian at J2000 follows IAU W0 = 326.07° (Archinal et al. 2018)', () => {
    // The body +X axis lies in the equatorial plane at angle W from the node Q = ẑ × pole.
    const s = SPIN_STATES.eros;
    const x = new THREE.Vector3(1, 0, 0).applyQuaternion(spinQuaternion(s, 946728000000, new THREE.Quaternion()));
    const pole = spinPole(s, new THREE.Vector3());
    const node = new THREE.Vector3(0, 0, 1).cross(pole).normalize();
    const angle = Math.atan2(new THREE.Vector3().crossVectors(node, x).dot(pole), node.dot(x)) * (180 / Math.PI);
    expect(((angle % 360) + 360) % 360).toBeCloseTo(326.07, 3);
  });
});

describe('shape binaries', () => {
  // Volume-equivalent radii: Barnouin et al. 2019 (Bennu 0.2450 km), Watanabe et al. 2019 (Ryugu 0.448 km), Daly et al. 2024 (Dimorphos 0.0755 km).
  const expected: Record<string, number> = { bennu: 0.245, ryugu: 0.448, dimorphos: 0.0755 };
  for (const [id, r] of Object.entries(expected)) {
    it.skipIf(!existsSync(resolve(SHAPES, `${id}.bin`)))(`${id} decodes to a closed outward mesh of the published size`, () => {
      const buf = readFileSync(resolve(SHAPES, `${id}.bin`));
      const { geometry } = decodeShape(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      const rv = volumeRadiusKm(geometry);
      expect(rv).toBeGreaterThan(0);
      expect(Math.abs(rv - r) / r).toBeLessThan(0.02);
    });
  }
});
