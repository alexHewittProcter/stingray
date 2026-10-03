import * as THREE from 'three';
import type { Vec3 } from '../sim/vec3';

// Third-person camera behind and above the craft, spring-damped, widening with speed.

export interface ChaseTarget {
  pos: Vec3;
  yaw: number;
  pitch: number;
  speed: number;
}

export interface ChaseCamera {
  /** Jump straight to the resting pose (spawn, teleport). */
  snap(target: ChaseTarget): void;
  update(target: ChaseTarget, dtSeconds: number): void;
}

const DISTANCE = 40;
const HEIGHT = 11;
const LOOK_AHEAD = 22;
const PITCH_FOLLOW = 0.55; // how much of the craft's pitch the camera swings with
const POSITION_RATE = 4.5;
const LOOK_RATE = 9;
const FOV_REST = 58;
const FOV_FAST = 80;
const FAST_SPEED = 60;
const BED_CLEARANCE = 3;

export function createChaseCamera(
  camera: THREE.PerspectiveCamera,
  seabedHeight: (x: number, z: number) => number,
): ChaseCamera {
  const desired = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const look = new THREE.Vector3();

  function aim(t: ChaseTarget): void {
    const pitch = t.pitch * PITCH_FOLLOW;
    // Craft forward is local -Z; yaw turns about +Y, pitch > 0 lifts the nose.
    const fx = -Math.sin(t.yaw) * Math.cos(pitch);
    const fy = Math.sin(pitch);
    const fz = -Math.cos(t.yaw) * Math.cos(pitch);
    desired.set(
      t.pos.x - fx * DISTANCE,
      t.pos.y - fy * DISTANCE + HEIGHT,
      t.pos.z - fz * DISTANCE,
    );
    lookAt.set(t.pos.x + fx * LOOK_AHEAD, t.pos.y + fy * LOOK_AHEAD, t.pos.z + fz * LOOK_AHEAD);
  }

  function keepAboveBed(): void {
    const floor = seabedHeight(camera.position.x, camera.position.z) + BED_CLEARANCE;
    if (camera.position.y < floor) camera.position.y = floor;
  }

  return {
    snap(t) {
      aim(t);
      camera.position.copy(desired);
      look.copy(lookAt);
      keepAboveBed();
      camera.lookAt(look);
    },
    update(t, dt) {
      aim(t);
      camera.position.lerp(desired, 1 - Math.exp(-POSITION_RATE * dt));
      look.lerp(lookAt, 1 - Math.exp(-LOOK_RATE * dt));
      keepAboveBed();
      camera.lookAt(look);

      const fov = THREE.MathUtils.lerp(FOV_REST, FOV_FAST, Math.min(Math.abs(t.speed) / FAST_SPEED, 1));
      camera.fov = THREE.MathUtils.lerp(camera.fov, fov, 1 - Math.exp(-3 * dt));
      camera.updateProjectionMatrix();
    },
  };
}
