import * as THREE from 'three';
import { confineCamera } from '../sim/interior';
import { RIDE_SECONDS, chairYaw, legsOf, rideProgressAt, rideTimeAt, shaftPointAt } from '../sim/ride';
import { FLOOR_Y, type Rooms, SHAFT_OPEN_TOP, SHAFT_RADIUS } from '../sim/rooms';
import { TUNING as T } from '../sim/tuning';
import type { Vec3 } from '../sim/vec3';
import type { Interior } from '../sim/world';
import { PORT_Y } from './boarding';
import { walkBoom } from './boom';
import { BORE_RADIUS } from './rooms';
import { ANNULUS_TOP_Y, COLLAR_DEPTH, PORT_RADIUS } from './shaft';

// The ride camera (phase 3, M4 "Transitions", T7): the view while Troy rides the injector chair down the shaft.
//
//   - The hold: for the chair's first rideHold (0.8 s since phase 4 D4) the camera stays in the room — it eases from where the follow
//     camera left it (the pose `begin` was given) to a point above the bore, rideBoom over the seat, turning from
//     Troy toward the shaft — so the player watches the chair drop away into the floor.
//   - The ride: then it follows the chair down the shaft — "behind and above it, boom 3 m shortened by the tube's
//     wall, looking down the shaft". The boom runs along the shaft itself (the camera is rideBoom behind the chair by
//     arc length, so it never cuts a corner through the rock), lifted off the axis by rideRise behind-and-above the
//     chair, held rideWallInset inside the wall — the wall's radius by height (rideWallRadius: the bore's 1.2 m
//     throat, the 2.2 m tube, then phase 4 D4's port: the annulus tapering to the port's 0.8 m at the hall ceiling,
//     the collar, and the hall opening below it) — and not just at the camera: the whole boom from the camera to the
//     chair stays inside that wall (boomRise), so passing the port the camera closes in on the axis rather than
//     looking at Troy through the annulus's cone. It looks rideLookAhead
//     ahead of the chair along the shaft. It catches up from the hold over rideCatchUp — eased, so it sets off from
//     rest and arrives at the chair's speed.
//   - The arrival: over the ride's final rideBlend (1.5 s) the pose blends into the camera rig's output — the pen
//     camera, its penWeight 1 throughout (the clamps are locked) — position lerped, orientation slerped, as L6's blend;
//     a blended position the walls would hide is walked back toward the chair (boom.ts) through the tube and the hall,
//     so the camera never looks through rock. At lock-in the weight is 1 and the rig has the view: no cut.
//
// Everything is a function of the ride's time (sim/ride.ts timetable): an interpolated frame lands between steps.
//
// The way back up (M6b; M4: "Going up reverses it"): the ascent runs the descent's timetable backwards, and main.ts
// passes `update` the descent's clock for where the chair is (rideTimeAt of its progress), so this same camera plays
// in reverse: it sets off on the rig's output (the pen camera, where the arrival blend ends), comes off it over the
// first rideBlend, follows the chair up the shaft from above it (the descent's boom side — ahead of the chair as it
// rises, looking back down at Troy coming up), and over the last rideHold eases into the pose `begin` was given — for
// the ascent the follow camera's stand-up pose in the control room (main.ts standUpView), which then takes over without a cut.

export interface CameraPose {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  fov: number;
}

export interface RideCamera {
  /**
   * The ride has begun (Troy sat): hold from this pose — the camera as last drawn — or, after a jump, from above the
   * bore. Going up (M6b): the pose to arrive on in the control room.
   */
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

/**
 * Below the port's collar the hall opens; the ride's wall radius widens back to the tube's over this height — gently,
 * so the camera swings back out to its full rise over a boom's length rather than in a frame.
 */
const HALL_OPENING = 3;
/** The camera's clearance from the drawn wall: rideWallInset and a hair. */
const WALL_MARGIN = T.rideWallInset + 0.05;

/**
 * The drawn wall's radius about the shaft's axis at arc length s from the top (the chair's point, at height topY):
 * the bore's throat (BORE_RADIUS) for the first SHAFT_OPEN_TOP, its flare to the tube's SHAFT_RADIUS; then, by height
 * (phase 4 D4 — the shaft is one vertical leg): the tube down to ANNULUS_TOP_Y, the annulus tapering linearly to
 * PORT_RADIUS at the hall's ceiling (PORT_Y), the collar at PORT_RADIUS for COLLAR_DEPTH below it, and the hall
 * widening back out below the collar (the pen camera and the pen's walls take over there). Beyond the shaft's ends
 * (s < 0: above the bore) the bore's radius.
 */
export function rideWallRadius(s: number, topY: number): number {
  if (s <= SHAFT_OPEN_TOP) return BORE_RADIUS;
  const flare = THREE.MathUtils.lerp(BORE_RADIUS, SHAFT_RADIUS, Math.min(1, (s - SHAFT_OPEN_TOP) / 1.2));
  return Math.min(flare, wallRadiusAtY(topY - s));
}

/** The tube's, the annulus's, the collar's and the hall's radius at height y (SHAFT_RADIUS above the annulus). */
export function wallRadiusAtY(y: number): number {
  if (y >= ANNULUS_TOP_Y) return SHAFT_RADIUS;
  if (y >= PORT_Y) return THREE.MathUtils.lerp(PORT_RADIUS, SHAFT_RADIUS, (y - PORT_Y) / (ANNULUS_TOP_Y - PORT_Y));
  const collarFoot = PORT_Y - COLLAR_DEPTH;
  if (y >= collarFoot) return PORT_RADIUS;
  return THREE.MathUtils.lerp(PORT_RADIUS, SHAFT_RADIUS, Math.min(1, (collarFoot - y) / HALL_OPENING));
}

/**
 * How far off the axis the camera may stand (≤ rideRise) with its boom's foot at arc length sCam, so that every point
 * of the straight line from the camera to the axis at arc length sTo (the chair, or where the camera looks) stays
 * WALL_MARGIN inside the wall — a point a fraction g of the way is (1 − g) of the rise off the axis, at arc length
 * sCam + g·(sTo − sCam). Sampled finely; continuous in both arguments, so the camera eases in toward the axis through
 * the port.
 */
export function boomRise(sCam: number, sTo: number, topY: number): number {
  let rise: number = T.rideRise;
  const SAMPLES = 40;
  for (let i = 0; i < SAMPLES; i++) {
    const g = i / SAMPLES;
    const room = rideWallRadius(sCam + g * (sTo - sCam), topY) - WALL_MARGIN;
    rise = Math.min(rise, room / (1 - g));
  }
  return Math.max(0, rise);
}

export function createRideCamera(camera: THREE.PerspectiveCamera, rooms: Rooms, interior: Interior, line: readonly Vec3[]): RideCamera {
  const shaft = rooms.shaft;
  const legs = legsOf(shaft);
  const length = legs.reduce((sum, leg) => sum + leg.length, 0);
  const startYaw = rooms.chair.yaw + Math.PI;
  const endYaw = interior.cradle.yawOut;
  const first = legs[0]!;
  const last = legs[legs.length - 1]!;
  const topY = shaft[0]!.y;
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
  const yawAt = (s: number) => (s <= 0 ? startYaw : chairYaw(shaft, s / length, startYaw, endYaw));
  const forwardOf = (yaw: number, out: THREE.Vector3) => out.set(-Math.sin(yaw), 0, -Math.cos(yaw));

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const along = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const off = new THREE.Vector3();
  const right = new THREE.Vector3();
  /** The camera's place with its boom's foot at arc length s (the chair at sChair): on the axis, lifted behind-and-above the chair. */
  const cameraAt = (s: number, sChair: number, out: THREE.Vector3): THREE.Vector3 => {
    along.subVectors(axis(s + 1.5, a), axis(s - 1.5, b)).normalize();
    const yaw = yawAt(s);
    forwardOf(yaw, fwd);
    // "Behind and above" the chair, less its part along the shaft: above it on a level leg, behind it on a vertical one
    // — and a little to its right, so Troy shows past the seat's tall back rather than hidden behind it.
    off.copy(Y).sub(fwd).addScaledVector(right.set(Math.cos(yaw), 0, -Math.sin(yaw)), T.rideSide);
    off.addScaledVector(along, -off.dot(along));
    if (off.lengthSq() < 1e-6) off.copy(Y);
    off.normalize();
    // The whole sightline from the camera to where it looks (rideLookAhead past the chair) stays inside the wall — so
    // the boom to the chair does too, and the camera starts closing in on the axis well before the port, not in a snap.
    const rise = boomRise(s, Math.max(s + T.rideBoom, sChair) + T.rideLookAhead, topY);
    return axis(s, out).addScaledVector(off, rise);
  };

  // When the place's blend starts: the end of the hold's rideBlend window, or — if later — the moment the camera, on
  // its boom rideBoom above the chair, has come down past the port's collar into the hall.
  const camClearsPort = rideTimeAt(Math.min(1, (topY - (PORT_Y - COLLAR_DEPTH) + T.rideBoom) / length));
  const placeBlendFrom = Math.min(RIDE_SECONDS - 0.5, Math.max(RIDE_SECONDS - T.rideBlend, camClearsPort));

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

  // The shaft is one vertical leg (phase 4 D1): its axis, as drawn (render/shaft.ts shaftLine).
  const axisX = line[0]!.x;
  const axisZ = line[0]!.z;
  /**
   * Inside the space the camera may see from during the arrival: the tube, the annulus and the port by their radius at
   * the point's height (D4: never the annulus's cone), or the pen hall.
   */
  const inRideSpace = (q: { x: number; y: number; z: number }): boolean =>
    (q.y < FLOOR_Y && Math.hypot(q.x - axisX, q.z - axisZ) <= wallRadiusAtY(q.y) - T.rideWallInset) || confineCamera(q, interior).normal === null;

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
      cameraAt(sCam, sChair, pos);
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
      // The view (orientation, fov) blends over the last rideBlend as phase 3 M4 had it; the place waits until the
      // camera has come down through the port (phase 4 D4) — blending it earlier would pull it toward the pen camera
      // through the annulus's rock, and the walk back would jump as the port opens into the hall below it.
      const k = smooth((t - (RIDE_SECONDS - T.rideBlend)) / T.rideBlend);
      if (k > 0) {
        rigPos.copy(camera.position);
        rigQuat.copy(camera.quaternion);
        const rigFov = camera.fov;
        pos.lerp(rigPos, smooth((t - placeBlendFrom) / (RIDE_SECONDS - placeBlendFrom)));
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
