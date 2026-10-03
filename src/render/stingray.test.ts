import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createStingray } from './stingray';

const TRIANGLE_BUDGET = 30_000;

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
