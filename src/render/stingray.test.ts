import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CHAIR_RADIUS, SEATS_LOCAL } from '../sim/rooms';
import { CHAIR_LOWEST_Y, CHAIR_UPPER_POLE_NAME, createInjectorChair } from './injector-chair';
import {
  DOME_Z, DUMMY_HATCH, PERISCOPE_Z, SEAT_HATCH, WINDOW_BAND_TOP, cabinRoofY, createStingray,
} from './stingray';

const TRIANGLE_BUDGET = 45_000;

function triangles(object: THREE.Object3D): number {
  let count = 0;
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const geometry = child.geometry as THREE.BufferGeometry;
      count += (geometry.index ? geometry.index.count : geometry.attributes.position!.count) / 3;
    }
  });
  return count;
}

describe('createStingray', () => {
  const model = createStingray();
  const box = new THREE.Box3().setFromObject(model.group);

  it('is 26 m long along Z', () => {
    expect(box.max.z - box.min.z).toBeGreaterThan(25.5);
    expect(box.max.z - box.min.z).toBeLessThan(26.5);
  });

  it('points its nose at −Z with the drive at the stern', () => {
    const hull = model.group.getObjectByName('hull')!;
    const hullBox = new THREE.Box3().setFromObject(hull);
    expect(hullBox.min.z).toBeCloseTo(-13, 1);
    expect(model.drive.getWorldPosition(new THREE.Vector3()).z).toBeGreaterThan(10);
    // The nose is a point; the stern is the wide drive.
    expect(box.min.z).toBeCloseTo(-13, 1);
    expect(box.max.z).toBeCloseTo(13, 1);
  });

  it('is symmetric about the X = 0 plane and carries a tall periscope', () => {
    expect(Math.abs(box.min.x + box.max.x)).toBeLessThan(0.05);
    expect(box.max.y).toBeGreaterThan(5); // periscope
  });

  it('spins the drive about Z', () => {
    const fin = model.drive.children[1]!;
    const before = fin.getWorldPosition(new THREE.Vector3());
    model.setDriveSpin(Math.PI / 3);
    model.group.updateMatrixWorld(true);
    const after = fin.getWorldPosition(new THREE.Vector3());
    expect(model.drive.rotation.z).toBeCloseTo(Math.PI / 3);
    expect(after.distanceTo(before)).toBeGreaterThan(0.5);
    expect(after.z).toBeCloseTo(before.z); // turned about the long axis only
  });

  it('stays within the triangle budget', () => {
    expect(triangles(model.group)).toBeLessThan(TRIANGLE_BUDGET);
  });
});

describe('the seats, hatches and pedestals on the cabin (phase 4, D3)', () => {
  const model = createStingray();
  model.group.updateMatrixWorld(true);
  const boxOf = (name: string) => new THREE.Box3().setFromObject(model.group.getObjectByName(name)!);
  const verts = (name: string): THREE.Vector3[] => {
    const out: THREE.Vector3[] = [];
    model.group.getObjectByName(name)!.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const p = o.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) out.push(new THREE.Vector3().fromBufferAttribute(p, k).applyMatrix4(o.matrixWorld));
    });
    return out;
  };

  it("Troy's hatch (r 0.65) is centred on his seat point, Phones's dummy (r 0.45) on his", () => {
    expect([SEAT_HATCH.x, SEAT_HATCH.z]).toEqual([SEATS_LOCAL.troy.x, SEATS_LOCAL.troy.z]);
    expect(SEAT_HATCH.radius).toBe(0.65);
    expect([DUMMY_HATCH.x, DUMMY_HATCH.z, DUMMY_HATCH.radius]).toEqual([SEATS_LOCAL.phones.x, SEATS_LOCAL.phones.z, 0.45]);
    for (const [name, h] of [['seat-hatch-bezel', SEAT_HATCH], ['seat-hatch-coaming', SEAT_HATCH], ['dummy-hatch', DUMMY_HATCH]] as const) {
      const c = boxOf(name).getCenter(new THREE.Vector3());
      expect(c.x, name).toBeCloseTo(h.x, 2);
      expect(c.z, name).toBeCloseTo(h.z, 2);
    }
    // The shut lid covers the hatch; the dummy is a disc of its radius.
    const lid = boxOf('seat-hatch-lid');
    expect(lid.max.x - lid.min.x).toBeGreaterThanOrEqual(2 * SEAT_HATCH.radius);
    const dummy = boxOf('dummy-hatch');
    expect((dummy.max.x - dummy.min.x) / 2).toBeCloseTo(DUMMY_HATCH.radius, 2);
  });

  it('cabinRoofY is the drawn cabin loft’s roof', () => {
    const cabin = model.group.getObjectByName('cabin') as THREE.Mesh;
    const p = cabin.geometry.getAttribute('position') as THREE.BufferAttribute;
    let checked = 0;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k);
      const y = p.getY(k);
      const z = p.getZ(k);
      if (y < 2.5 || z < -4 || z > 2) continue;
      expect(cabinRoofY(x, z), `${x}, ${z}`).toBeCloseTo(y, 3);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('every hatch rim stays above y 2.85 and clear of the window band (WINDOW_Y 2.6 ± 0.23)', () => {
    expect(WINDOW_BAND_TOP).toBeCloseTo(2.83, 6);
    for (const h of [SEAT_HATCH, DUMMY_HATCH]) {
      for (let k = 0; k < 72; k++) {
        const a = (k / 72) * Math.PI * 2;
        const y = cabinRoofY(h.x + Math.cos(a) * h.radius, h.z + Math.sin(a) * h.radius);
        expect(y).toBeGreaterThan(2.85);
        expect(y).toBeGreaterThan(WINDOW_BAND_TOP);
      }
    }
    for (const name of ['seat-hatch-coaming', 'seat-hatch-bezel', 'seat-hatch-lid', 'dummy-hatch', 'dummy-hatch-bezel']) {
      expect(boxOf(name).min.y, name).toBeGreaterThan(2.85);
    }
  });

  it('the shut lid covers the chair aboard (its pole above the head bar is hidden there); open, it lies forward, clear of the pole', () => {
    const chair = createInjectorChair();
    chair.getObjectByName(CHAIR_UPPER_POLE_NAME)!.removeFromParent();
    chair.position.set(SEATS_LOCAL.troy.x, SEATS_LOCAL.troy.y, SEATS_LOCAL.troy.z);
    chair.updateMatrixWorld(true);
    const { x: cx, z: cz, radius: a, coamingY, rise, power } = SEAT_HATCH;
    const lidAt = (d: number) => coamingY + rise * Math.pow(Math.max(0, 1 - Math.pow(d / (a + 0.01), power)), 1 / power);
    const v = new THREE.Vector3();
    let above = 0;
    chair.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const p = o.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) {
        v.fromBufferAttribute(p, k).applyMatrix4(o.matrixWorld);
        const d = Math.hypot(v.x - cx, v.z - cz);
        expect(d).toBeLessThan(a);
        if (v.y > cabinRoofY(v.x, v.z)) {
          above++;
          expect(v.y).toBeLessThan(lidAt(d));
        }
      }
    });
    expect(above).toBeGreaterThan(0); // the head bar does stand above the roof: the lid is what covers it
    expect(lidAt(0)).toBeGreaterThan(3.55); // Troy's head, seated, ≈ 3.51
    // Open, the lid has swung up and forward of its front hinge — away from the pole, 0.48 m aft of the centre.
    model.setHatch(1);
    model.group.updateMatrixWorld(true);
    const open = boxOf('seat-hatch-lid');
    expect(open.max.z).toBeLessThan(cz - a + 0.5);
    expect(open.max.z).toBeLessThan(cz + 0.48 - 0.06);
    expect(open.max.y).toBeGreaterThan(coamingY + 1);
    model.setHatch(0);
  });

  it('the dome and the periscope have moved aft, clear of both hatches', () => {
    expect(DOME_Z).toBeGreaterThanOrEqual(0);
    expect(DOME_Z).toBeLessThanOrEqual(1);
    expect(PERISCOPE_Z).toBeGreaterThanOrEqual(0);
    expect(PERISCOPE_Z).toBeLessThanOrEqual(1);
    const hatchesAftEdge = Math.max(SEAT_HATCH.z + SEAT_HATCH.radius, DUMMY_HATCH.z + DUMMY_HATCH.radius);
    for (const name of ['dome', 'periscope', 'periscope-collar']) {
      expect(boxOf(name).min.z, name).toBeGreaterThan(hatchesAftEdge + 0.3);
    }
  });

  it('a short pedestal stands in the cabin under each seat, up to just under the chair', () => {
    for (const [name, seat] of [['seat-pedestal-troy', SEATS_LOCAL.troy], ['seat-pedestal-phones', SEATS_LOCAL.phones]] as const) {
      const b = boxOf(name);
      const c = b.getCenter(new THREE.Vector3());
      expect(c.x, name).toBeCloseTo(seat.x, 3);
      expect(c.z, name).toBeCloseTo(seat.z, 3);
      expect(b.max.y).toBeLessThanOrEqual(seat.y + CHAIR_LOWEST_Y);
      expect(b.max.y).toBeGreaterThan(seat.y + CHAIR_LOWEST_Y - 0.03);
      expect(b.max.y - b.min.y).toBeLessThan(0.6); // short
      expect(Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2).toBeLessThan(CHAIR_RADIUS);
    }
    expect(verts('seat-pedestal-troy').length).toBeGreaterThan(0);
  });
});
