import * as THREE from 'three';
import type { Box, Rooms } from '../sim/rooms';
import type { TroyState } from '../sim/troy';
import { TUNING as T } from '../sim/tuning';
import type { Vec3 } from '../sim/vec3';
import { type Point, walkBoom } from './boom';
import { type OrbitView, orbitPosition } from './orbit';

// The on-foot camera (phase 3, M4): third-person, behind and above Troy, in the rooms. Its own camera, written after
// the rig (main.ts keeps the rig updating in every mode so the chase springs stay warm, and lets this one have the
// view whenever the session mode is 'onFoot').
//
//   - M4: boom T.followBoom (3.6 m) from a pivot T.followPivotRise (1.5 m) above his feet, T.followPitch (18°) above
//     the horizontal behind him, looking at the pivot; fov T.followFov (60).
//   - Spring-damped: the pivot follows his feet on a spring, and the boom's heading follows his facing with a
//     T.followYawLag (0.6 s) lag — only while he walks (speed > 0); standing still the heading, and the orbit, hold.
//   - The orbit (T9's orbit.ts) swings the boom about the pivot before the walls apply, as the rig's does about the sub.
//     While he walks main.ts hands the orbit's yaw to the heading (orbit.ts orbitTakeYaw, turn below): he walks the
//     way the camera looks, so a yaw kept as an offset would have the heading chase him round in circles.
//   - Walls (M4): the boom walk (boom.ts, phase 2's keepInside generalised) against the rooms — the boom is
//     shortened to the first room wall or prop it meets, and the camera is held T.followWallInset (≥ 0.3 m) inside
//     the room's box and clear of the props. "The room" is every box sharing an id with a box his feet are in (the
//     corridor is two boxes; in a doorway he is in two rooms), so it never leaves the room he is in. A boom the walls
//     shortened lengthens again at T.followBoomOutRate; shortening is instant, so it never sees through a wall.
//   - Phase 2's keepInside against the Interior never runs here (Global constraints, indoors switches).

export interface FollowTarget {
  /** Feet. */
  pos: Vec3;
  yaw: number;
  speed: number;
}

export interface FollowCamera {
  /** Jump straight to the resting pose behind him (start, R, a walkTo): heading = his facing, the boom at full length. */
  snap(target: FollowTarget, orbit?: OrbitView): void;
  update(target: FollowTarget, dtSeconds: number, orbit?: OrbitView): void;
  /** Turn the boom's heading by this much (radians, + left) — the orbit's yaw handed over while he walks (orbitTakeYaw). */
  turn(radians: number): void;
  /** The boom's heading (the sim's yaw convention): the way the un-orbited camera looks. For tests and debug. */
  heading(): number;
}

/** Troy for a drawn frame: alpha of the way from the previous step's state to this one (as render/troy.ts draws him). */
export function troyAt(previous: TroyState, current: TroyState, alpha: number): FollowTarget {
  const p = previous.where === current.where ? previous : current;
  const turn = Math.atan2(Math.sin(current.yaw - p.yaw), Math.cos(current.yaw - p.yaw));
  return {
    pos: {
      x: p.pos.x + (current.pos.x - p.pos.x) * alpha,
      y: p.pos.y + (current.pos.y - p.pos.y) * alpha,
      z: p.pos.z + (current.pos.z - p.pos.z) * alpha,
    },
    yaw: p.yaw + turn * alpha,
    speed: current.speed,
  };
}

const BOOM_STEP = 0.1; // m between samples along the boom (the rooms are small)
const BOOM_REFINE = 6; // bisections between the last inside and first outside sample (≈ 1.5 mm)

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

const inBox = (p: Point, b: Box, grow: number) =>
  p.x >= b.min.x - grow && p.x <= b.max.x + grow
  && p.y >= b.min.y - grow && p.y <= b.max.y + grow
  && p.z >= b.min.z - grow && p.z <= b.max.z + grow;

/**
 * The boxes the follow camera may be in for Troy's feet at `feet`: every room sharing an id with a room his feet are
 * in (x and z inside, at its floor), shrunk by the wall inset on every side (floor and ceiling too).
 */
export function cameraBoxes(rooms: Rooms, feet: Vec3, inset: number = T.followWallInset): Box[] {
  const ids = new Set(rooms.rooms
    .filter((r) => feet.x >= r.min.x && feet.x <= r.max.x && feet.z >= r.min.z && feet.z <= r.max.z
      && feet.y >= r.min.y - 0.01 && feet.y <= r.max.y)
    .map((r) => r.id));
  const mine = ids.size > 0 ? rooms.rooms.filter((r) => ids.has(r.id)) : rooms.rooms;
  return mine.map((r) => ({
    min: { x: r.min.x + inset, y: r.min.y + inset, z: r.min.z + inset },
    max: { x: r.max.x - inset, y: r.max.y - inset, z: r.max.z - inset },
  }));
}

/** M4's confine: inside one of the room's shrunk boxes and at least the inset clear of every prop. */
export function followConfine(rooms: Rooms, feet: Vec3, inset: number = T.followWallInset): (p: Point) => boolean {
  const boxes = cameraBoxes(rooms, feet, inset);
  return (p) => boxes.some((b) => inBox(p, b, 0)) && rooms.props.every((b) => !inBox(p, b, inset));
}

/** The nearest point of the room's shrunk boxes to p (the fallback when the pivot itself is outside them). */
function clampInto(p: Point, rooms: Rooms, feet: Vec3): Point {
  let best: Point = p;
  let bestD = Infinity;
  for (const b of cameraBoxes(rooms, feet)) {
    const q = {
      x: THREE.MathUtils.clamp(p.x, b.min.x, b.max.x),
      y: THREE.MathUtils.clamp(p.y, b.min.y, b.max.y),
      z: THREE.MathUtils.clamp(p.z, b.min.z, b.max.z),
    };
    const d = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
    if (d < bestD) [best, bestD] = [q, d];
  }
  return best;
}

/**
 * Where the boom from `pivot` toward `want` may put the camera for Troy's feet at `feet` (M4 walls): the walk's
 * start (the pivot, or the nearest point inside the room if it is not), and the farthest point the walk reached.
 */
export function resolveBoom(pivot: Point, want: Point, rooms: Rooms, feet: Vec3): { from: Point; to: Point } {
  const inside = followConfine(rooms, feet);
  const from = inside(pivot) ? pivot : clampInto(pivot, rooms, feet);
  return { from, to: walkBoom(from, want, inside, BOOM_STEP, BOOM_REFINE) };
}

export function createFollowCamera(camera: THREE.PerspectiveCamera, rooms: Rooms): FollowCamera {
  const pivot = new THREE.Vector3();
  const goal = new THREE.Vector3();
  let heading = 0;
  let boomLength: number = T.followBoom;

  function compose(t: FollowTarget, dt: number | null, orbit?: OrbitView): void {
    // The un-orbited boom: behind him along the heading (forward(h) = (−sin h, ·, −cos h)), up by the pitch.
    const out = T.followBoom * Math.cos(T.followPitch);
    const free = {
      x: pivot.x + Math.sin(heading) * out,
      y: pivot.y + T.followBoom * Math.sin(T.followPitch),
      z: pivot.z + Math.cos(heading) * out,
    };
    const want = orbit && orbit.k > 0 ? orbitPosition(free, pivot, orbit) : free;
    const { from, to } = resolveBoom(pivot, want, rooms, t.pos);
    const reach = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    // Shortening is instant; lengthening again is eased, along the same (already walked) segment.
    boomLength = dt === null ? reach : Math.min(reach, boomLength + T.followBoomOutRate * Math.max(dt, 0));
    const k = reach > 1e-9 ? boomLength / reach : 0;
    camera.position.set(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k, from.z + (to.z - from.z) * k);
    camera.lookAt(pivot);
    camera.fov = T.followFov;
    camera.near = T.followNear;
    camera.updateProjectionMatrix();
  }

  const aim = (t: FollowTarget) => goal.set(t.pos.x, t.pos.y + T.followPivotRise, t.pos.z);

  return {
    snap(t, orbit) {
      pivot.copy(aim(t));
      heading = t.yaw;
      compose(t, null, orbit);
    },
    update(t, dt, orbit) {
      const d = Math.max(dt, 0);
      pivot.lerp(aim(t), 1 - Math.exp(-T.followPivotRate * d));
      // M4: the heading turns with him only while he walks.
      if (t.speed > 0) heading = wrap(heading + wrap(t.yaw - heading) * (1 - Math.exp(-d / T.followYawLag)));
      compose(t, d, orbit);
    },
    turn(radians) {
      heading = wrap(heading + radians);
    },
    heading: () => heading,
  };
}
