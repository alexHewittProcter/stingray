import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { onFoot, type TroyState } from '../sim/troy';
import { TUNING as T } from '../sim/tuning';
import { TROY_SEAT, createTroy } from './troy';

// M8: the model is ≈ 1.8 m from primitives, faces −Z, and animates from the sim's numbers only.

const standing = onFoot({ pos: { x: 0, y: 0, z: 0 }, yaw: 0 });
const walking = (gait: number): TroyState => ({ ...standing, speed: T.walkSpeed, gait });

function worldOf(group: THREE.Object3D, name: string): THREE.Vector3 {
  group.updateMatrixWorld(true);
  return group.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
}

/** The lowest point of a named part's meshes (a boot's sole, say). */
function lowest(group: THREE.Object3D, name: string): THREE.Vector3 {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group.getObjectByName(name)!);
  return box.min;
}

describe('createTroy (M8)', () => {
  it('builds from primitives only, ≈ 1.8 m tall, feet on the floor, centred', () => {
    const troy = createTroy();
    troy.pose(standing, 1, standing, { snap: true });
    const box = new THREE.Box3().setFromObject(troy.group);
    expect(box.max.y - box.min.y).toBeGreaterThan(1.75);
    expect(box.max.y - box.min.y).toBeLessThan(1.85);
    expect(box.min.y).toBeCloseTo(0, 1);
    expect(Math.abs(box.max.x + box.min.x)).toBeLessThan(0.15); // the holster is on one side only
    troy.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        expect(['BoxGeometry', 'CylinderGeometry', 'SphereGeometry']).toContain(o.geometry.type);
      }
    });
  });

  it('carries the parts the reference shows', () => {
    const troy = createTroy();
    for (const name of ['head', 'torso', 'shoulderL', 'shoulderR', 'hipL', 'hipR', 'badge', 'holster', 'epauletteL', 'epauletteR']) {
      expect(troy.group.getObjectByName(name), name).toBeDefined();
    }
    // The badge is on his left sleeve (−X, his right is +X), the holster on his right hip.
    troy.pose(standing, 1, standing, { snap: true });
    expect(worldOf(troy.group, 'badge').x).toBeLessThan(-0.2);
    expect(worldOf(troy.group, 'holster').x).toBeGreaterThan(0.1);
  });

  it('is shown on foot at his feet and yaw, hidden aboard', () => {
    const troy = createTroy();
    const t = onFoot({ pos: { x: 4, y: 92, z: -1250 }, yaw: Math.PI / 2 });
    troy.pose(t, 1, t);
    expect(troy.group.visible).toBe(true);
    expect(troy.group.position.toArray()).toEqual([4, 92, -1250]);
    expect(troy.group.rotation.y).toBeCloseTo(Math.PI / 2);
    troy.pose({ ...t, where: 'aboard' }, 1, t);
    expect(troy.group.visible).toBe(false);
  });

  it('interpolates position and yaw between the last two steps', () => {
    const troy = createTroy();
    const a = onFoot({ pos: { x: 0, y: 0, z: 0 }, yaw: 0.2 });
    const b = { ...a, pos: { x: 1, y: 0, z: -2 }, yaw: 0.4 };
    troy.pose(b, 0.5, a);
    expect(troy.group.position.x).toBeCloseTo(0.5);
    expect(troy.group.position.z).toBeCloseTo(-1);
    expect(troy.group.rotation.y).toBeCloseTo(0.3);
  });

  it('swings the legs with gait: left forward at 0, right forward at π, still when standing', () => {
    const troy = createTroy();
    troy.pose(walking(0), 1, walking(0));
    const left0 = lowest(troy.group, 'kneeL').z;
    const right0 = lowest(troy.group, 'kneeR').z;
    troy.pose(walking(Math.PI), 1, walking(Math.PI));
    const leftPi = lowest(troy.group, 'kneeL').z;
    const rightPi = lowest(troy.group, 'kneeR').z;
    expect(left0).toBeLessThan(right0 - 0.3); // forward is −Z
    expect(rightPi).toBeLessThan(leftPi - 0.3);
    // The arms swing against the legs.
    expect(worldOf(troy.group, 'elbowR').z).toBeGreaterThan(worldOf(troy.group, 'elbowL').z);
    // Standing still, the same gait does nothing.
    const still = { ...standing, gait: 1.2 };
    troy.pose(still, 1, still);
    expect(Math.abs(lowest(troy.group, 'kneeL').z - lowest(troy.group, 'kneeR').z)).toBeLessThan(0.02);
  });

  it('sits over 0.4 s when he leaves his feet: hips down to the seat, back up on standing', () => {
    const troy = createTroy();
    troy.pose(standing, 1, standing, { snap: true });
    const hipStanding = worldOf(troy.group, 'hipL').y;
    const riding: TroyState = { ...standing, where: 'riding' };
    troy.pose(riding, 1, standing, { dt: 0.2 });
    expect(troy.sitWeight()).toBeGreaterThan(0.2);
    expect(troy.sitWeight()).toBeLessThan(0.8);
    troy.pose(riding, 1, riding, { dt: 0.21 });
    expect(troy.sitWeight()).toBe(1);
    // Riding, the seat point is at troy.pos: the hips stand just above it, the knees forward at hip height.
    const hipSeated = worldOf(troy.group, 'hipL');
    expect(hipStanding - (hipSeated.y - troy.group.position.y)).toBeGreaterThan(0.35);
    expect(hipSeated.y).toBeCloseTo(standing.pos.y + (0.46 - TROY_SEAT.y), 2);
    const knee = worldOf(troy.group, 'kneeL');
    expect(knee.y).toBeCloseTo(hipSeated.y, 2);
    expect(knee.z).toBeLessThan(hipSeated.z - 0.4);
    // Back on foot it blends out.
    troy.pose(standing, 1, riding, { dt: 0.1 });
    expect(troy.sitWeight()).toBeLessThan(1);
    troy.pose(standing, 1, standing, { dt: 0.5 });
    expect(troy.sitWeight()).toBe(0);
  });

  it('snaps the sit on a jump, and leaves placement to the caller with place: false', () => {
    const troy = createTroy();
    troy.pose({ ...standing, where: 'aboard' }, 1, standing, { snap: true, place: false });
    expect(troy.sitWeight()).toBe(1);
    expect(troy.group.position.toArray()).toEqual([0, 0, 0]);
  });

  it('fades out when the camera is on top of him', () => {
    const troy = createTroy();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 1.5, 3);
    troy.pose(standing, 1, standing, { camera });
    expect(troy.group.visible).toBe(true);
    const mesh = troy.group.getObjectByProperty('type', 'Mesh') as THREE.Mesh;
    expect((mesh.material as THREE.Material).opacity).toBe(1);
    camera.position.set(0, 1.5, 0.7);
    camera.updateMatrixWorld();
    troy.pose(standing, 1, standing, { camera });
    expect((mesh.material as THREE.Material).opacity).toBeLessThan(1);
    expect((mesh.material as THREE.Material).transparent).toBe(true);
    camera.position.set(0, 1.5, 0.3);
    camera.updateMatrixWorld();
    troy.pose(standing, 1, standing, { camera });
    expect(troy.group.visible).toBe(false);
  });
});
