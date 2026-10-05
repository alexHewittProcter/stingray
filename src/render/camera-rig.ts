import * as THREE from 'three';
import { confineCamera, northOfFace } from '../sim/interior';
import type { LaunchState } from '../sim/launch';
import type { Vec3 } from '../sim/vec3';
import type { World } from '../sim/world';
import { type ChaseTarget, createChaseCamera } from './chase-camera';
import { tunnelTightness } from './indoors';

// The camera (phase 2, L1 "the camera" and L6 "pen camera"): phase 1's chase camera, the pen camera, the blend
// between them, and the walls.
//
//   - The chase camera runs unchanged on a stand-in camera of its own, so its springs keep their own state.
//   - The pen camera frames Stingray on the cradle from the walkway side (TV_pen3_stingray_elevated) and follows
//     the craft's height, so it goes down through the surface with it.
//   - While the clamps are locked the view blends to the pen camera; once released it blends back to the chase
//     camera — each within BLEND_SECONDS (< 1.5 s).
//   - Whenever the camera is north of the cliff face, the boom from the sub is shortened to the first wall it
//     meets and the camera is held inside the interior volume less 1 m (confineCamera). South of the face, at sea,
//     nothing here touches phase 1's chase camera.
//   - T8: inside Marineville the chase boom is tighter and lower (indoors.ts tunnelTightness), so the view looks down
//     the bore over the craft instead of from under the crown; it eases back to phase 1's within TIGHT_ZONE of the
//     mouth out at sea, and beyond that it is phase 1's exactly.

const BLEND_SECONDS = 1.2;
/** The pen camera's place relative to the craft: out to starboard of the pen axis, a little forward and above. */
const PEN_CAMERA = { side: 27, ahead: 4, rise: 1.6, lookRise: 1.4, fov: 52 };
const BOOM_STEP = 0.25; // m between samples along the boom when looking for the first wall

export interface CameraRig {
  snap(target: ChaseTarget, clamps: LaunchState['clamps']): void;
  update(target: ChaseTarget, clamps: LaunchState['clamps'], dtSeconds: number): void;
  /** 1 while the pen camera has the view, 0 for the chase camera (for tests and debug). */
  penWeight(): number;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

export function createCameraRig(camera: THREE.PerspectiveCamera, world: World): CameraRig {
  const chaseCamera = new THREE.PerspectiveCamera(camera.fov, camera.aspect, camera.near, camera.far);
  const chase = createChaseCamera(chaseCamera, world.seabedHeight);
  const cradle = world.marineville.interior.cradle;
  let weight = 0;

  const penPos = new THREE.Vector3();
  const penLook = new THREE.Vector3();
  const penQuat = new THREE.Quaternion();
  const look = new THREE.Matrix4();
  const UP = new THREE.Vector3(0, 1, 0);

  function penPose(t: ChaseTarget): void {
    // Facing the pen's axis: the camera stands to the side of the cradle across the axis. The pen axis runs along z,
    // so "starboard of the axis" is +x — the east walkway, looking west at the stencilled wall.
    penPos.set(cradle.pos.x + PEN_CAMERA.side, t.pos.y + PEN_CAMERA.rise, cradle.pos.z + PEN_CAMERA.ahead);
    penLook.set(t.pos.x, t.pos.y + PEN_CAMERA.lookRise, t.pos.z);
    look.lookAt(penPos, penLook, UP);
    penQuat.setFromRotationMatrix(look);
  }

  function compose(t: ChaseTarget): void {
    const w = smooth(weight);
    if (w <= 0) {
      camera.position.copy(chaseCamera.position);
      camera.quaternion.copy(chaseCamera.quaternion);
      camera.fov = chaseCamera.fov;
    } else {
      penPose(t);
      camera.position.lerpVectors(chaseCamera.position, penPos, w);
      camera.quaternion.slerpQuaternions(chaseCamera.quaternion, penQuat, w);
      camera.fov = THREE.MathUtils.lerp(chaseCamera.fov, PEN_CAMERA.fov, w);
    }
    keepInside(t.pos);
    camera.updateProjectionMatrix();
  }

  /** L1: north of the face, shorten the boom to the first wall and hold the camera 1 m inside the drawn walls. */
  function keepInside(sub: Vec3): void {
    const p = camera.position;
    if (!northOfFace(p)) return;
    const interior = world.marineville.interior;
    const from = new THREE.Vector3(sub.x, sub.y, sub.z);
    if (confineCamera(from, interior).normal === null) {
      const span = p.distanceTo(from);
      const steps = Math.ceil(span / BOOM_STEP);
      const probe = new THREE.Vector3();
      for (let i = 1; i <= steps; i++) {
        probe.lerpVectors(from, p, i / steps);
        if (confineCamera(probe, interior).normal !== null) {
          p.lerpVectors(from, p, (i - 1) / steps);
          break;
        }
      }
    }
    const held = confineCamera(p, interior).pos;
    p.set(held.x, held.y, held.z);
  }

  return {
    snap(t, clamps) {
      chase.snap(t, tunnelTightness(t.pos, world.marineville.tunnelMouth));
      weight = clamps === 'locked' ? 1 : 0;
      compose(t);
    },
    update(t, clamps, dt) {
      chase.update(t, dt, tunnelTightness(t.pos, world.marineville.tunnelMouth));
      const want = clamps === 'locked' ? 1 : 0;
      const step = Math.max(dt, 0) / BLEND_SECONDS;
      weight = want > weight ? Math.min(weight + step, want) : Math.max(weight - step, want);
      compose(t);
    },
    penWeight: () => weight,
  };
}
