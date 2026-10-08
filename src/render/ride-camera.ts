import * as THREE from 'three';
import { confineCamera } from '../sim/interior';
import { RIDE_SECONDS, chairYaw, legsOf, rideProgressAt, shaftPointAt } from '../sim/ride';
import { FLOOR_Y, type Rooms, SHAFT_OPEN_TOP, SHAFT_RADIUS } from '../sim/rooms';
import { TUNING as T } from '../sim/tuning';
import type { Vec3 } from '../sim/vec3';
import type { Interior } from '../sim/world';
import { walkBoom } from './boom';
import { BORE_RADIUS } from './rooms';
import { distanceToLine } from './shaft';

// The ride camera (phase 3, M4 "Transitions", T7): the view while Troy rides the injector chair down the shaft.
//
//   - The hold: for the chair's first rideHold (1.5 s) the camera stays in the lounge — it eases from where the follow
//     camera left it (the pose `begin` was given) to a point above the bore, rideBoom over the seat, turning from
//     Troy toward the shaft — so the player watches the chair drop away into the floor.
//   - The ride: then it follows the chair down the shaft — "behind and above it, boom 3 m shortened by the tube's
//     wall, looking down the shaft". The boom runs along the shaft itself (the camera is rideBoom behind the chair by
//     arc length, so it never cuts a corner through the rock), lifted off the axis by rideRise behind-and-above the
//     chair, held rideWallInset inside the wall (the bore's throat is only 0.95 m across), and looking rideLookAhead
//     ahead of the chair along the shaft. It catches up from the hold over rideCatchUp — eased, so it sets off from
//     rest and arrives at the chair's speed.
//   - The arrival: over the ride's final rideBlend (1.5 s) the pose blends into the camera rig's output — the pen
//     camera, its penWeight 1 throughout (the clamps are locked) — position lerped, orientation slerped, as L6's blend;
//     a blended position the walls would hide is walked back toward the chair (boom.ts) through the tube and the hall,
//     so the camera never looks through rock. At lock-in the weight is 1 and the rig has the view: no cut.
//
// Everything is a function of the ride's time (sim/ride.ts timetable): an interpolated frame lands between steps.

export interface CameraPose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  fov: number;
}

export interface RideCamera {
  /** The ride has begun (Troy sat): hold from this pose — the camera as last drawn — or, after a jump, from above the bore. */
  begin(from: CameraPose | null): void;
  /**
   * Write the camera for `time` seconds into the ride (rideTimeAt of the interpolated ride). The camera holds the rig's
   * output for this frame on entry (main.ts runs the rig first); the arrival blends into it.
   */
  update(time: number): void;
}

const Y = new THREE.Vector3(0, 1, 0);
const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

export function createRideCamera(camera: THREE.PerspectiveCamera, rooms: Rooms, interior: Interior, line: readonly Vec3[]): RideCamera {
  const shaft = rooms.shaft;
  const legs = legsOf(shaft);
  const length = legs.reduce((sum, leg) => sum + leg.length, 0);
  const startYaw = rooms.chair.yaw + Math.PI;
  const endYaw = interior.cradle.yawOut;
  const first = legs[0]!;
  const last = legs[legs.length - 1]!;
  const unit = (leg: (typeof legs)[number]) =>
    new THREE.Vector3(leg.to.x - leg.from.x, leg.to.y - leg.from.y, leg.to.z - leg.from.z).normalize();
  const firstDir = unit(first);
  const lastDir = unit(last);

  /** The shaft's axis at arc length s, extended straight on past either end (above the bore, below the seat). */
  const axis = (s: number, out = new THREE.Vector3()): THREE.Vector3 => {
    if (s < 0) return out.set(shaft[0]!.x, shaft[0]!.y, shaft[0]!.z).addScaledVector(firstDir, s);
    if (s > length) return out.set(last.to.x, last.to.y, last.to.z).addScaledVector(lastDir, s - length);
    const p = shaftPointAt(shaft, s);
    return out.set(p.x, p.y, p.z);
  };
  /** The drawn wall's radius at arc length s: the bore's throat, its flare, the tube. */
  const radiusAt = (s: number): number => {
    if (s <= SHAFT_OPEN_TOP) return BORE_RADIUS;
    return THREE.MathUtils.lerp(BORE_RADIUS, SHAFT_RADIUS, Math.min(1, (s - SHAFT_OPEN_TOP) / 1.2));
  };
  const yawAt = (s: number) => (s <= 0 ? startYaw : chairYaw(shaft, s / length, startYaw, endYaw));
  const forwardOf = (yaw: number, out: THREE.Vector3) => out.set(-Math.sin(yaw), 0, -Math.cos(yaw));

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const along = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const off = new THREE.Vector3();
  const right = new THREE.Vector3();
  /** The camera's place with its boom's foot at arc length s: on the axis, lifted behind-and-above the chair. */
  const cameraAt = (s: number, out: THREE.Vector3): THREE.Vector3 => {
    along.subVectors(axis(s + 1.5, a), axis(s - 1.5, b)).normalize();
    const yaw = yawAt(s);
    forwardOf(yaw, fwd);
    // "Behind and above" the chair, less its part along the shaft: above it on a level leg, behind it on a vertical one
    // — and a little to its right, so Troy shows past the seat's tall back rather than hidden behind it.
    off.copy(Y).sub(fwd).addScaledVector(right.set(Math.cos(yaw), 0, -Math.sin(yaw)), T.rideSide);
    off.addScaledVector(along, -off.dot(along));
    if (off.lengthSq() < 1e-6) off.copy(Y);
    off.normalize();
    const rise = Math.max(0, Math.min(T.rideRise, radiusAt(s) - T.rideWallInset - 0.05));
    return axis(s, out).addScaledVector(off, rise);
  };

  const holdPos = new THREE.Vector3();
  const holdQuat = new THREE.Quaternion();
  let holdFov: number = T.rideFov;
  let held = false;

  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const chair = new THREE.Vector3();
  const up = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const lookQuat = new THREE.Quaternion();
  const rigPos = new THREE.Vector3();
  const rigQuat = new THREE.Quaternion();
  const from = new THREE.Vector3();

  /** Inside the space the camera may see from during the arrival: the tube (and housing) or the pen hall. */
  const inRideSpace = (q: { x: number; y: number; z: number }): boolean =>
    (q.y < FLOOR_Y && distanceToLine(q, line) <= SHAFT_RADIUS - T.rideWallInset) || confineCamera(q, interior).normal === null;

  return {
    begin(start) {
      held = start !== null;
      if (start) {
        holdPos.copy(start.pos);
        holdQuat.copy(start.quat);
        holdFov = start.fov;
      }
    },
    update(time) {
      const t = Math.min(Math.max(time, 0), RIDE_SECONDS);
      const sChair = rideProgressAt(t) * length;
      axis(sChair, chair);
      const boomFoot = -T.rideBoom; // above the bore, before the chair has gone anywhere
      // The hold, then the catch-up: the boom's foot eases from above the bore onto the chair's boom.
      const w = smooth((t - T.rideHold) / T.rideCatchUp);
      const sCam = (1 - w) * boomFoot + w * (sChair - T.rideBoom);
      cameraAt(sCam, pos);
      const settle = smooth(t / T.rideHold);
      if (held && t < T.rideHold) pos.lerpVectors(holdPos, pos, settle);

      // Look: from Troy in the chair (the hold) to down the shaft ahead of him.
      const ahead = axis(sChair + T.rideLookAhead, a);
      look.set(chair.x, chair.y + 1.0, chair.z).lerp(ahead, smooth((t - T.rideHold * 0.5) / (T.rideHold * 0.5 + T.rideCatchUp)));
      // Arriving, the look comes back onto Troy as the view blends toward the pen camera, so he stays in frame.
      const arriving = smooth((t - (RIDE_SECONDS - T.rideBlend)) / (T.rideBlend * 0.6));
      if (arriving > 0) look.lerp(b.set(chair.x, chair.y + 0.8, chair.z), arriving);
      dir.subVectors(look, pos).normalize();
      // Looking straight down a vertical leg, "up" on screen is the way the chair faces.
      forwardOf(yawAt(sChair), fwd);
      const steep = Math.abs(dir.y);
      up.copy(Y).multiplyScalar(1 - steep).addScaledVector(fwd, steep).normalize();
      m.lookAt(pos, look, up);
      quat.setFromRotationMatrix(m);
      let fov: number = T.rideFov;
      if (held && t < T.rideHold) {
        // The view turns onto the chair quickly (it is dropping out of the follow camera's frame); the place eases.
        // (slerpQuaternions copies its first argument into `this` before reading the second: never pass `this` there.)
        quat.copy(lookQuat.copy(holdQuat).slerp(quat, smooth(t / (T.rideHold / 3))));
        fov = THREE.MathUtils.lerp(holdFov, T.rideFov, settle);
      }

      // The arrival: blend into the rig's pose (the camera holds it now), walking a hidden position back toward the chair.
      const k = smooth((t - (RIDE_SECONDS - T.rideBlend)) / T.rideBlend);
      if (k > 0) {
        rigPos.copy(camera.position);
        rigQuat.copy(camera.quaternion);
        const rigFov = camera.fov;
        pos.lerp(rigPos, k);
        from.set(chair.x, chair.y + 1.3, chair.z);
        const walked = walkBoom(from, pos, inRideSpace, 0.2, 6);
        pos.set(walked.x, walked.y, walked.z);
        quat.slerp(rigQuat, k);
        fov = THREE.MathUtils.lerp(fov, rigFov, k);
      }

      camera.position.copy(pos);
      camera.quaternion.copy(quat);
      camera.fov = fov;
      camera.updateProjectionMatrix();
    },
  };
}
