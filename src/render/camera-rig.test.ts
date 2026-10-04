import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { confineCamera, northOfFace } from '../sim/interior';
import { createWorld } from '../sim/world';
import { createCameraRig } from './camera-rig';
import { type ChaseTarget, createChaseCamera } from './chase-camera';

// L1 "the camera" and L6 "pen camera": phase 1's chase camera is untouched at sea; inside, the camera stays inside
// the drawn interior less 1 m with the sub in view; the pen camera takes over while clamped, blending within 1.5 s.

const world = createWorld(1964);
const interior = world.marineville.interior;
const DT = 1 / 60;

const target = (x: number, y: number, z: number, yaw: number): ChaseTarget => ({ pos: { x, y, z }, yaw, pitch: 0, speed: 0 });
const camera = () => new THREE.PerspectiveCamera(58, 16 / 9, 0.5, 8000);

describe('the camera rig', () => {
  it('is phase 1\'s chase camera at sea', () => {
    const real = camera();
    const alone = camera();
    const rig = createCameraRig(real, world);
    const chase = createChaseCamera(alone, world.seabedHeight);
    const t = target(120, -30, -700, 0.4);
    rig.snap(t, 'released');
    chase.snap(t);
    for (let i = 0; i < 120; i++) {
      t.pos.z += 0.3;
      t.yaw += 0.004;
      rig.update(t, 'released', DT);
      chase.update(t, DT);
    }
    expect(real.position.distanceTo(alone.position)).toBeLessThan(1e-9);
    expect(real.quaternion.angleTo(alone.quaternion)).toBeLessThan(1e-6);
    expect(real.fov).toBeCloseTo(alone.fov, 9);
  });

  it('keeps the camera inside the pen, with the sub in view, when the boom would reach through a wall', () => {
    const real = camera();
    const rig = createCameraRig(real, world);
    // Facing out of the pen (south) against the north wall: the chase boom points north through the wall.
    const t = target(0, -14, interior.pen.min.z + 6, interior.cradle.yawOut);
    rig.snap(t, 'released');
    for (let i = 0; i < 60; i++) rig.update(t, 'released', DT);
    expect(northOfFace(real.position)).toBe(true);
    expect(confineCamera(real.position, interior).normal).toBeNull();
    expect(real.position.z).toBeGreaterThan(interior.pen.min.z);
    // Looking at the sub: it is in front of the camera.
    const toSub = new THREE.Vector3(t.pos.x, t.pos.y, t.pos.z).sub(real.position).normalize();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(real.quaternion);
    expect(forward.dot(toSub)).toBeGreaterThan(0.7);
  });

  it('never leaves the camera behind the cliff face when the sub is at sea beside it', () => {
    const real = camera();
    const rig = createCameraRig(real, world);
    // At sea 300 m along the coast, facing out to sea: the boom points north into the rock.
    const t = target(300, -30, -1090, Math.PI);
    rig.snap(t, 'released');
    for (let i = 0; i < 60; i++) rig.update(t, 'released', DT);
    expect(northOfFace(real.position)).toBe(false);
  });

  it('frames the craft from the pen camera while clamped and blends to the chase camera within 1.5 s of release', () => {
    const real = camera();
    const rig = createCameraRig(real, world);
    const c = interior.cradle;
    const t = target(c.pos.x, c.raisedY, c.pos.z, c.yawOut);
    rig.snap(t, 'locked');
    expect(rig.penWeight()).toBe(1);
    expect(confineCamera(real.position, interior).normal).toBeNull();
    let frames = 0;
    while (rig.penWeight() > 0 && frames < 600) {
      rig.update(t, 'released', DT);
      frames++;
    }
    expect(frames * DT).toBeLessThanOrEqual(1.5);
    frames = 0;
    while (rig.penWeight() < 1 && frames < 600) {
      rig.update(t, 'locked', DT);
      frames++;
    }
    expect(frames * DT).toBeLessThanOrEqual(1.5);
  });

  it('follows the craft down through the surface as the cradle lowers', () => {
    const real = camera();
    const rig = createCameraRig(real, world);
    const c = interior.cradle;
    const t = target(c.pos.x, c.raisedY, c.pos.z, c.yawOut);
    rig.snap(t, 'locked');
    expect(real.position.y).toBeGreaterThan(0);
    t.pos.y = c.loweredY;
    rig.update(t, 'locked', DT);
    expect(real.position.y).toBeLessThan(0);
  });
});
