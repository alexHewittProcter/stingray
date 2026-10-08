import * as THREE from 'three';
import type { TroyState } from '../sim/troy';
import { TUNING as T } from '../sim/tuning';
import { FIXED_DT } from '../sim/world';
import { troyAt } from './follow-camera';

// Troy Tempest, built from code (phase 3, T3 — M8). Boxes, cylinders and spheres in flat colours after
// goals/testbed-stingray/references/stingray_phase1_reference/01_TROY_TEMPEST/ (front, three-quarter with the badge,
// face, rear): the silver-grey uniform with a gold placket, the red stand collar and red cuffs, black-edged gold
// epaulettes, the white belt and the white holster on his right hip with its strap round the thigh, white boots with a
// black top band, dark swept-back hair, and the WASP badge on the left sleeve. The head is the puppet's — a little
// large for the body, as the series' marionettes are — with eyes, brows, nose, mouth and ears as primitives.
//
// Conventions (as the sub's model): +Y up, forward −Z, metres, +X his right. The group's origin is on the floor under
// his hip joints; standing he is T.troyHeight (1.8 m) feet to crown.
//
// M8 animation, from the sim's numbers only (TroyState and the previous step's):
//   - Walk: legs and arms swing with `gait` (cos — the left heel strikes at gait 0, the right at π, where M6's
//     footsteps fall), the amplitude scaled by speed / WALK, the swing leg's knee bending, a small double-time bob.
//   - Lean: the torso pitches forward into acceleration (the speed's change over the last step) and back on braking,
//     plus a little forward lean at a walk. Smoothed in the render.
//   - Head: turns a little toward the turn (the yaw's change over the last step) — he looks where he is going.
//   - Idle: a 3 s breathing bob (the chest swells, the shoulders rise), faded out as he walks.
//   - Sit: hips and knees at 90°, hips down onto the seat, forearms forward as on armrests — blended in over 0.4 s
//     when `where` leaves 'onFoot', out when it returns. The blend is the view's own state, advanced by the frame's
//     wall time (frame.dt); frame.snap (R, the menu, ?start=) sets it at once.
//   - Yaw and position interpolate between the last two steps (follow-camera.ts troyAt, as the follow camera reads him).
//
// Placement: on foot the group stands at his feet; riding, his seat point (TROY_SEAT) is at troy.pos (M2: "the chair's
// seat point along the shaft"); aboard he is hidden. T7 re-parents him to the chair: pass `frame.place = false` and
// the caller owns the group's transform and visibility while pose() still animates the limbs and the sit blend.
// Near the camera (the follow camera's boom walked short against a wall) he fades out, so he never fills the frame.

export interface TroyFrame {
  /** Wall seconds this drawn frame stands for — advances the sit blend and the breathing. 0 holds them. */
  dt?: number;
  /** The drawing camera: within FADE_FAR of his body axis he fades, within FADE_NEAR he is hidden. */
  camera?: THREE.Camera;
  /** A jump (R, the menu, ?start=): the sit blend goes straight to its target. */
  snap?: boolean;
  /** false: the caller places and shows the group (T7, the chair); pose() animates the body only. Default true. */
  place?: boolean;
}

export interface TroyView {
  readonly group: THREE.Group;
  /** Place and animate him for a drawn frame: alpha of the way from the previous step's state to this one. */
  pose(t: TroyState, alpha: number, previous?: TroyState, frame?: TroyFrame): void;
  /** 0 standing … 1 seated: the sit blend as drawn (eased). For tests and the chair. */
  sitWeight(): number;
}

// ---- Dimensions (metres) -------------------------------------------------------------------

const HIP_Y = 0.88; // hip joints above the floor, standing
const HIP_HALF = 0.1; // hip joint either side of the centre line
const THIGH = 0.42;
const SHIN = 0.46; // knee to sole, the boot included
const SIT_HIP_Y = SHIN; // seated: thighs level, shins upright, soles on the floor
const PELVIS_TOP = 0.14; // belt line above the hip joints
const CHEST = 0.40; // pelvis top to the shoulder line
const SHOULDER_HALF = 0.25;
const UPPER_ARM = 0.29;
const FOREARM = 0.27;
const HEAD_RADIUS = 0.13;

/**
 * Where his seat rests in the full sit pose, in the group's frame: under the buttocks, centred, just behind the hip
 * joints. The chair (T5/T7) puts its cushion's top centre here; his soles are then on the floor 0.42 m ahead (−Z).
 */
export const TROY_SEAT: Readonly<{ x: number; y: number; z: number }> = Object.freeze({ x: 0, y: SIT_HIP_Y - 0.09, z: 0.03 });

// ---- Animation ------------------------------------------------------------------------------

const SIT_SECONDS = 0.4; // M8
const BREATH_SECONDS = 3; // M8: the idle bob's period
const LEG_SWING = 0.48; // rad, hip swing at full walking speed
const KNEE_BEND = 0.85; // rad, the swing leg's knee at the top of its arc
const ARM_SWING = 0.42; // rad
const WALK_BOB = 0.028; // m, at full speed
const LEAN_WALK = 4 * (Math.PI / 180); // forward lean at a full-speed walk
const LEAN_ACCEL = 7 * (Math.PI / 180); // extra lean at T.walkAccel (back on braking, as far as T.walkDecel)
const LEAN_RATE = 6; // 1/s, the lean's smoothing
const HEAD_TURN = 22 * (Math.PI / 180); // the head's lead at T.walkTurnRate
const HEAD_RATE = 8; // 1/s
const FADE_NEAR = 0.45; // m from the body axis: hidden inside this
const FADE_FAR = 0.95; // m: fully drawn beyond this

// ---- Colours (01_TROY_TEMPEST/) --------------------------------------------------------------

const UNIFORM = 0xaab0b8; // the silver-grey tunic and trousers
const RED = 0xb32028; // collar and cuffs
const GOLD = 0xc69a5c; // epaulette plates, piping, the placket
const BLACK = 0x15171c; // epaulette edging, boot bands
const WHITE = 0xf1efe8; // boots, belt, holster
const SKIN = 0xe8b088;
const HAIR = 0x17130f;
const EYE_WHITE = 0xf6f4ef;
const EYE_BLUE = 0x3d7fcf;
const LIP = 0xc98270;
const BADGE_BLUE = 0x7cc6e6;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => x * x * (3 - 2 * x);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function createTroy(): TroyView {
  const group = new THREE.Group();
  group.name = 'troy';

  // Per-instance materials, so the near-camera fade can set their opacity without touching anyone else's.
  const materials: THREE.MeshStandardMaterial[] = [];
  const paint = (colour: number, roughness = 0.6, metalness = 0.05) => {
    const mat = new THREE.MeshStandardMaterial({ color: colour, roughness, metalness });
    materials.push(mat);
    return mat;
  };
  const m = {
    uniform: paint(UNIFORM, 0.45, 0.25),
    red: paint(RED, 0.6),
    gold: paint(GOLD, 0.4, 0.4),
    black: paint(BLACK, 0.5),
    white: paint(WHITE, 0.45),
    skin: paint(SKIN, 0.7),
    hair: paint(HAIR, 0.8),
    eyeWhite: paint(EYE_WHITE, 0.4),
    eyeBlue: paint(EYE_BLUE, 0.4),
    lip: paint(LIP, 0.7),
    badge: paint(BADGE_BLUE, 0.5),
  };

  const box = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    return mesh;
  };
  const cyl = (rTop: number, rBottom: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, segments = 14) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), mat);
    mesh.position.set(x, y, z);
    return mesh;
  };
  const ball = (r: number, mat: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    return mesh;
  };
  const pivot = (name: string, x = 0, y = 0, z = 0) => {
    const o = new THREE.Group();
    o.name = name;
    o.position.set(x, y, z);
    return o;
  };

  // The body root sits at the hip joints' height; sitting lowers it, the walk and the breath bob it.
  const hips = pivot('hips', 0, HIP_Y, 0);
  group.add(hips);

  // Pelvis: the trousers' seat, the white belt and its buckle.
  const pelvis = cyl(0.19, 0.17, 0.22, m.uniform, 0, 0.04, 0.01, 18);
  pelvis.scale.z = 0.62;
  hips.add(pelvis);
  const belt = cyl(0.196, 0.196, 0.05, m.white, 0, PELVIS_TOP - 0.02, 0, 18);
  belt.scale.z = 0.64;
  hips.add(belt);
  hips.add(box(0.06, 0.055, 0.01, m.gold, 0, PELVIS_TOP - 0.02, -0.127));

  // Torso: pitches about the belt for the lean; scales a touch for the breath.
  const torso = pivot('torso', 0, PELVIS_TOP, 0);
  hips.add(torso);
  // The tunic: an elliptical cylinder widening to the shoulders, capped by a flattened dome over the shoulder line.
  const tunic = cyl(0.235, 0.19, CHEST - 0.04, m.uniform, 0, (CHEST - 0.04) / 2, 0, 20);
  tunic.scale.z = 0.6;
  torso.add(tunic);
  torso.add(ball(0.235, m.uniform, 0, CHEST - 0.04, 0, 1, 0.3, 0.6));
  torso.add(box(0.016, CHEST - 0.04, 0.01, m.gold, -0.035, CHEST / 2, -0.136)); // the placket, off-centre as the tunic's
  // The red stand collar with gold piping, and the neck.
  torso.add(cyl(0.08, 0.085, 0.08, m.red, 0, CHEST + 0.035, 0));
  torso.add(cyl(0.087, 0.087, 0.012, m.gold, 0, CHEST - 0.002, 0));
  torso.add(cyl(0.05, 0.055, 0.08, m.skin, 0, CHEST + 0.09, 0, 10));
  // Epaulettes: a gold plate on each shoulder, edged black, with three red bars at the collar end.
  for (const side of [1, -1]) {
    const ep = pivot(side > 0 ? 'epauletteR' : 'epauletteL', side * 0.16, CHEST + 0.012, 0);
    ep.rotation.z = -side * 0.32;
    ep.add(box(0.16, 0.025, 0.17, m.black));
    ep.add(box(0.14, 0.03, 0.14, m.gold, side * 0.005, 0.004, 0));
    for (let i = 0; i < 3; i++) ep.add(box(0.012, 0.035, 0.12, m.red, -side * 0.055 + side * i * 0.02, 0.01, 0));
    torso.add(ep);
  }

  // Head: turns on the neck for M8's look toward the movement.
  const head = pivot('head', 0, CHEST + 0.07, 0);
  head.scale.setScalar(1.08); // the marionette's head, a little large for the body
  torso.add(head);
  head.add(ball(HEAD_RADIUS, m.skin, 0, 0.14, 0, 0.92, 1.05, 1.0));
  head.add(ball(0.09, m.skin, 0, 0.07, -0.025, 1.12, 0.7, 1.0)); // the square jaw
  // Hair: a dark cap set back over the crown and down the back (the forehead shows), and the swept quiff on top.
  head.add(ball(HEAD_RADIUS, m.hair, 0, 0.17, 0.035, 0.98, 0.92, 1.04));
  head.add(ball(0.105, m.hair, 0, 0.235, -0.035, 1.0, 0.45, 1.05));
  // Face (front is −Z): brows, eyes with blue irises, nose, mouth, ears.
  for (const side of [1, -1]) {
    head.add(box(0.06, 0.014, 0.02, m.hair, side * 0.045, 0.195, -0.113));
    head.add(ball(0.019, m.eyeWhite, side * 0.043, 0.168, -0.11, 1.3, 0.8, 0.6));
    head.add(ball(0.0105, m.eyeBlue, side * 0.043, 0.168, -0.121, 1, 1, 0.5));
    head.add(ball(0.025, m.skin, side * 0.12, 0.15, 0.0, 0.5, 1.1, 0.8));
  }
  head.add(box(0.024, 0.05, 0.028, m.skin, 0, 0.135, -0.13));
  head.add(box(0.065, 0.016, 0.02, m.lip, 0, 0.085, -0.116));

  // Arms: a pivot at each shoulder (rotation.x swings it, + forward), an elbow below (+ bends the forearm forward).
  const arm = (side: 1 | -1) => {
    const shoulder = pivot(side > 0 ? 'shoulderR' : 'shoulderL', side * SHOULDER_HALF, CHEST - 0.06, 0);
    shoulder.add(cyl(0.058, 0.05, UPPER_ARM, m.uniform, 0, -UPPER_ARM / 2, 0));
    shoulder.add(ball(0.062, m.uniform, 0, 0, 0));
    const elbow = pivot(side > 0 ? 'elbowR' : 'elbowL', 0, -UPPER_ARM, 0);
    shoulder.add(elbow);
    elbow.add(cyl(0.05, 0.045, FOREARM, m.uniform, 0, -FOREARM / 2, 0));
    // The red cuff with two gold rings, then the hand.
    elbow.add(cyl(0.052, 0.052, 0.08, m.red, 0, -FOREARM + 0.04, 0));
    elbow.add(cyl(0.054, 0.054, 0.008, m.gold, 0, -FOREARM + 0.055, 0));
    elbow.add(cyl(0.054, 0.054, 0.008, m.gold, 0, -FOREARM + 0.025, 0));
    elbow.add(box(0.04, 0.1, 0.075, m.skin, 0, -FOREARM - 0.05, 0));
    torso.add(shoulder);
    return { shoulder, elbow };
  };
  const armR = arm(1);
  const armL = arm(-1);
  // The WASP badge on the left sleeve: a pale-blue disc with a gold rim, facing out.
  const badge = pivot('badge', -0.056, -0.1, 0);
  badge.rotation.z = Math.PI / 2;
  badge.add(cyl(0.04, 0.04, 0.008, m.gold, 0, 0, 0, 16));
  badge.add(cyl(0.033, 0.033, 0.012, m.badge, 0, 0, 0, 16));
  armL.shoulder.add(badge);

  // Legs: a pivot at each hip joint (rotation.x swings it, + forward), a knee below (− bends it back).
  const leg = (side: 1 | -1) => {
    const hip = pivot(side > 0 ? 'hipR' : 'hipL', side * HIP_HALF, 0, 0);
    hip.add(cyl(0.085, 0.07, THIGH, m.uniform, 0, -THIGH / 2, 0));
    const knee = pivot(side > 0 ? 'kneeR' : 'kneeL', 0, -THIGH, 0);
    hip.add(knee);
    knee.add(cyl(0.066, 0.06, SHIN - 0.36, m.uniform, 0, -(SHIN - 0.36) / 2, 0));
    // The boot: black top band, white shaft, the foot pointing forward.
    knee.add(cyl(0.067, 0.067, 0.04, m.black, 0, -(SHIN - 0.36) - 0.01, 0));
    knee.add(cyl(0.063, 0.06, 0.32, m.white, 0, -SHIN + 0.2, 0));
    knee.add(box(0.11, 0.07, 0.24, m.white, 0, -SHIN + 0.035, -0.05));
    hips.add(hip);
    return { hip, knee };
  };
  const legR = leg(1);
  const legL = leg(-1);
  // The holster rides the right thigh (it swings with the leg), with the white strap round it.
  const holster = box(0.06, 0.24, 0.13, m.white, 0.095, -0.12, 0.0);
  holster.name = 'holster';
  legR.hip.add(holster);
  legR.hip.add(cyl(0.088, 0.088, 0.025, m.white, 0, -THIGH + 0.06, 0));

  group.visible = false;

  // The view's own animation state: the sit blend, the breath clock, the smoothed lean and head turn.
  let sit = 0; // linear 0…1, eased when applied
  let breath = 0;
  let lean = 0;
  let look = 0;
  const feet = new THREE.Vector3();
  const eye = new THREE.Vector3();

  function fadeFor(camera: THREE.Camera | undefined): number {
    if (!camera || !group.visible) return 1;
    group.updateWorldMatrix(true, false);
    feet.setFromMatrixPosition(group.matrixWorld);
    camera.getWorldPosition(eye);
    const dy = THREE.MathUtils.clamp(eye.y, feet.y + 0.2, feet.y + T.troyHeight - 0.1) - eye.y;
    const d = Math.hypot(eye.x - feet.x, dy, eye.z - feet.z);
    return smooth(clamp01((d - FADE_NEAR) / (FADE_FAR - FADE_NEAR)));
  }

  return {
    group,
    sitWeight: () => smooth(sit),
    pose(t, alpha, previous, frame = {}) {
      const dt = Math.max(frame.dt ?? 0, 0);
      const place = frame.place ?? true;
      const prev = previous ?? t;
      const at = troyAt(prev, t, alpha);

      if (place) {
        group.visible = t.where !== 'aboard';
        if (t.where === 'onFoot') group.position.set(at.pos.x, at.pos.y, at.pos.z);
        else group.position.set(at.pos.x - TROY_SEAT.x, at.pos.y - TROY_SEAT.y, at.pos.z - TROY_SEAT.z);
        group.rotation.set(0, at.yaw, 0);
      }

      // Sit (M8): 0.4 s each way, on the view's own clock.
      const sitTarget = t.where === 'onFoot' ? 0 : 1;
      if (frame.snap) sit = sitTarget;
      else sit += Math.sign(sitTarget - sit) * Math.min(Math.abs(sitTarget - sit), dt / SIT_SECONDS);
      const s = smooth(sit);
      const standing = 1 - s;

      // Walk (M8): amplitude by speed / WALK; the gait interpolated across its wrap.
      const walking = t.where === 'onFoot' && prev.where === 'onFoot';
      const pace = walking ? clamp01(t.speed / T.walkSpeed) : 0;
      const gait = walking ? prev.gait + wrap(t.gait - prev.gait) * alpha : 0;
      const swingL = Math.cos(gait);
      const swingR = -swingL;
      // The swing leg is the one moving forward (its swing rising): its knee bends.
      const liftL = Math.max(0, -Math.sin(gait));
      const liftR = Math.max(0, Math.sin(gait));

      // Idle breath (M8): a 3 s bob, faded out by the walk and the sit.
      breath = (breath + dt / BREATH_SECONDS) % 1;
      const inhale = Math.sin(breath * 2 * Math.PI) * (1 - pace) * standing;

      // Lean into acceleration and the head's lead into a turn, from the last step's change, smoothed per frame.
      const accel = walking ? (t.speed - prev.speed) / FIXED_DT : 0;
      const accelLean = accel >= 0 ? clamp01(accel / T.walkAccel) : -clamp01(-accel / T.walkDecel);
      const wantLean = (LEAN_WALK * pace + LEAN_ACCEL * accelLean) * standing;
      const turnRate = walking ? wrap(t.yaw - prev.yaw) / FIXED_DT : 0;
      const wantLook = HEAD_TURN * THREE.MathUtils.clamp(turnRate / T.walkTurnRate, -1, 1) * standing;
      if (frame.snap) [lean, look] = [wantLean, wantLook];
      else {
        lean += (wantLean - lean) * (1 - Math.exp(-LEAN_RATE * dt));
        look += (wantLook - look) * (1 - Math.exp(-HEAD_RATE * dt));
      }

      // Hips: down onto the seat as he sits; the walk's double-time bob (lowest as the feet pass); the breath.
      const bob = -WALK_BOB * pace * Math.abs(Math.sin(gait)) * standing;
      hips.position.y = HIP_Y + (SIT_HIP_Y - HIP_Y) * s + bob + 0.004 * inhale;
      // Torso: lean is a forward pitch (− about X tips the top toward −Z); seated he sits up, a touch back.
      torso.rotation.x = -lean + 0.05 * s;
      torso.scale.set(1, 1 + 0.008 * inhale, 1 + 0.02 * inhale);
      head.rotation.y = look;
      head.rotation.x = -0.03 * s;

      // Legs: the swing at a walk, 90° at hip and knee seated.
      const hipAngle = (swing: number) => LEG_SWING * pace * swing * standing + (Math.PI / 2) * s;
      legL.hip.rotation.x = hipAngle(swingL);
      legR.hip.rotation.x = hipAngle(swingR);
      legL.knee.rotation.x = -KNEE_BEND * pace * liftL * standing - (Math.PI / 2) * s;
      legR.knee.rotation.x = -KNEE_BEND * pace * liftR * standing - (Math.PI / 2) * s;

      // Arms: opposite to the legs, hanging a little out from the body; seated, the forearms forward as on rails.
      const shoulderAngle = (swing: number) => -ARM_SWING * pace * swing * standing + 0.2 * s;
      armL.shoulder.rotation.x = shoulderAngle(swingL);
      armR.shoulder.rotation.x = shoulderAngle(swingR);
      armL.shoulder.rotation.z = -0.07 - 0.03 * inhale;
      armR.shoulder.rotation.z = 0.07 + 0.03 * inhale;
      const elbowBend = (swing: number) => 0.12 + 0.25 * pace * Math.max(0, swing) * standing + 1.2 * s;
      armL.elbow.rotation.x = elbowBend(-swingL);
      armR.elbow.rotation.x = elbowBend(-swingR);

      // Near the camera he fades, then goes (a boom walked short against a wall would fill the frame with him).
      const opacity = place ? fadeFor(frame.camera) : 1;
      if (opacity <= 0) group.visible = false;
      const transparent = opacity < 1;
      for (const mat of materials) {
        if (mat.transparent !== transparent) {
          mat.transparent = transparent;
          mat.depthWrite = !transparent;
          mat.needsUpdate = true;
        }
        mat.opacity = opacity;
      }
    },
  };
}
