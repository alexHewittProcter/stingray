import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ARCH, createWorld, type Collider, type LandmarkId } from '../sim/world';
import { TUNING } from '../sim/tuning';
import { DRESSING_MAX_HEIGHT, createDressing } from './dressing';
import { createLandmarks } from './landmarks';

// What you see is what you hit: solid scenery stays inside its colliders, and the free scenery on the bed stays
// under the hull's clearance, so the sub never visibly passes through rock.

const world = createWorld(1964);
const landmarks = createLandmarks(world);
landmarks.updateMatrixWorld(true);
const EPSILON = 1e-3;

function insideCollider(c: Collider, p: THREE.Vector3): boolean {
  if (c.kind === 'sphere') return p.distanceTo(new THREE.Vector3(c.centre.x, c.centre.y, c.centre.z)) <= c.radius + EPSILON;
  return (
    p.x >= c.min.x - EPSILON && p.x <= c.max.x + EPSILON &&
    p.y >= c.min.y - EPSILON && p.y <= c.max.y + EPSILON &&
    p.z >= c.min.z - EPSILON && p.z <= c.max.z + EPSILON
  );
}

/** Every solid triangle of the named landmarks, in world space: its corners and its edge midpoints. */
function solidSamples(ids: LandmarkId[]): THREE.Vector3[] {
  const meshes: THREE.Mesh[] = [];
  landmarks.traverse((o) => {
    if (o instanceof THREE.Mesh && o.userData.solid) meshes.push(o);
  });
  const out: THREE.Vector3[] = [];
  for (const mesh of meshes) {
    if (!ids.includes(mesh.userData.landmark as LandmarkId)) continue;
    const position = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const index = mesh.geometry.index;
    const count = index ? index.count : position.count;
    const at = (k: number) => new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(k) : k).applyMatrix4(mesh.matrixWorld);
    for (let k = 0; k < count; k += 3) {
      const [a, b, c] = [at(k), at(k + 1), at(k + 2)];
      out.push(a, b, c, a.clone().lerp(b, 0.5), b.clone().lerp(c, 0.5), c.clone().lerp(a, 0.5));
    }
  }
  return out;
}

describe('solid landmarks', () => {
  for (const id of ['arch', 'stacks', 'wreck'] as const) {
    it(`draws the ${id} inside its colliders`, () => {
      const colliders = world.landmarks.find((l) => l.id === id)!.colliders;
      const samples = solidSamples([id]);
      expect(samples.length).toBeGreaterThan(100);
      const outside = samples.filter((p) => !colliders.some((c) => insideCollider(c, p)));
      expect(outside.slice(0, 3)).toEqual([]);
    });
  }

  it('keeps the arch opening clear of rock', () => {
    const floor = world.seabedHeight(ARCH.x, ARCH.z);
    const blocking = solidSamples(['arch']).filter(
      (p) =>
        Math.abs(p.x - ARCH.x) < ARCH.openingHalfWidth - EPSILON &&
        p.y > floor + EPSILON &&
        p.y < floor + ARCH.openingHeight - EPSILON,
    );
    expect(blocking).toEqual([]);
  });
});

describe('dressing on the bed', () => {
  it('keeps every free-standing piece under the hull clearance', () => {
    expect(DRESSING_MAX_HEIGHT).toBeLessThan(TUNING.hullRadius);
    const dressing = createDressing(world);
    const box = new THREE.Box3();
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    let checked = 0;
    let worst = -Infinity;
    dressing.traverse((o) => {
      if (!(o instanceof THREE.InstancedMesh)) return;
      o.geometry.computeBoundingBox();
      const position = o.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        checked++;
        // Quick bound first: the top of the piece's rotated bounds over the lowest bed at its corners.
        box.copy(o.geometry.boundingBox!).applyMatrix4(m);
        const corners = [[box.min.x, box.min.z], [box.min.x, box.max.z], [box.max.x, box.min.z], [box.max.x, box.max.z]] as const;
        const bed = Math.min(...corners.map(([x, z]) => world.seabedHeight(x, z)));
        if (box.max.y - bed < TUNING.hullRadius - 0.2) {
          worst = Math.max(worst, box.max.y - bed);
          continue;
        }
        // Otherwise, exactly: every vertex against the bed directly beneath it.
        for (let k = 0; k < position.count; k++) {
          v.fromBufferAttribute(position, k).applyMatrix4(m);
          worst = Math.max(worst, v.y - world.seabedHeight(v.x, v.z));
        }
      }
    });
    expect(checked).toBeGreaterThan(10_000);
    expect(worst).toBeLessThan(TUNING.hullRadius - 0.2);
  });
});
