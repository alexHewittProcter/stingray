import * as THREE from 'three';
import type { Vec3 } from '../sim/vec3';

// Third-person camera behind and above the craft, spring-damped, widening with speed.
//
// Phase 2 (T8): `tight` (0 … 1, default 0) brings the boom in lower and shorter for the launch tunnel and the pen,
// where phase 1's 11 m rise put the camera under the crown. At 0 every number is phase 1's, exactly.

export interface ChaseTarget {
  pos: Vec3;
  yaw: number;
  pitch: number;
  speed: number;
}

export interface ChaseCamera {
  /** Jump straight to the resting pose (spawn, teleport). */
  snap(target: ChaseTarget, tight?: number): void;
  update(target: ChaseTarget, dtSeconds: number, tight?: number): void;
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
/** The tight boom (inside Marineville): close behind, just above the hull, looking down the bore over the craft. */
const TIGHT = { distance: 30, height: 7.6, lookAhead: 40, lookRise: 4.2 };

export function createChaseCamera(
  camera: THREE.PerspectiveCamera,
  seabedHeight: (x: number, z: number) => number,
): ChaseCamera {
  const desired = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const look = new THREE.Vector3();

  function aim(t: ChaseTarget, tight: number): void {
    const k = Math.min(Math.max(tight, 0), 1);
    const distance = DISTANCE + (TIGHT.distance - DISTANCE) * k;
    const height = HEIGHT + (TIGHT.height - HEIGHT) * k;
    const ahead = LOOK_AHEAD + (TIGHT.lookAhead - LOOK_AHEAD) * k;
    const rise = TIGHT.lookRise * k;
    const pitch = t.pitch * PITCH_FOLLOW;
    // Craft forward is local -Z; yaw turns about +Y, pitch > 0 lifts the nose.
    const fx = -Math.sin(t.yaw) * Math.cos(pitch);
    const fy = Math.sin(pitch);
    const fz = -Math.cos(t.yaw) * Math.cos(pitch);
    desired.set(
      t.pos.x - fx * distance,
      t.pos.y - fy * distance + height,
      t.pos.z - fz * distance,
    );
    lookAt.set(t.pos.x + fx * ahead, t.pos.y + fy * ahead + rise, t.pos.z + fz * ahead);
  }

  function keepAboveBed(): void {
    const floor = seabedHeight(camera.position.x, camera.position.z) + BED_CLEARANCE;
    if (camera.position.y < floor) camera.position.y = floor;
  }

  return {
    snap(t, tight = 0) {
      aim(t, tight);
      camera.position.copy(desired);
      look.copy(lookAt);
      keepAboveBed();
      camera.lookAt(look);
    },
    update(t, dt, tight = 0) {
      aim(t, tight);
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
