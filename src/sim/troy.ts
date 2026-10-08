// Troy Tempest on foot (phase 3, M2): a vertical capsule walking the rooms' floors. Pure and deterministic like the
// rest of src/sim. The ride (M6) owns 'riding' and the way 'aboard' ends; stepTroy leaves those states as they are.
//
// Each step on foot: turn toward the wanted heading (TroyInput.move, already in the world frame — input/troy.ts
// rotates the keys by the camera's yaw, M3), ease the speed toward WALK × |move| (half while the turn left is more
// than 90°), move along the facing, then resolve: clamp the foot centre into the nearest room box shrunk by his radius
// if it left the union, and push the foot circle out of every prop along the shortest axis, twice over. A step that
// still ends somewhere unwalkable (a prop wedged against a wall) keeps the last walkable point.

import { type Box, type Rooms } from './rooms';
import { TUNING as T } from './tuning';
import type { Vec3 } from './vec3';

export interface TroyState {
  where: 'onFoot' | 'riding' | 'aboard';
  /** Feet, on the floor (onFoot) or the chair's seat point along the shaft (riding); unused aboard. */
  pos: Vec3;
  /** Facing; +yaw turns left as the sub's does (yaw 0 faces north, −Z). */
  yaw: number;
  /** m/s along the facing, 0…WALK. */
  speed: number;
  /** Walk-cycle phase in radians, advanced by speed — for the renderer's legs; wraps at 2π. */
  gait: number;
  /** 0…1 progress along the shaft while riding; 0 otherwise. */
  ride: number;
  rideDir: 'down' | 'up';
}

/** move is in the world frame (+x east, −z north), |move| ≤ 1. */
export interface TroyInput {
  move: { x: number; z: number };
  use: boolean;
}

export const STAND_STILL: TroyInput = Object.freeze({ move: Object.freeze({ x: 0, z: 0 }), use: false });

/** Troy standing on foot at a place (the start, a debug walkTo). */
export function onFoot(at: { pos: Vec3; yaw: number }): TroyState {
  return { where: 'onFoot', pos: { ...at.pos }, yaw: at.yaw, speed: 0, gait: 0, ride: 0, rideDir: 'down' };
}

/** Troy in the pilot's seat (standby, ?start=ocean, every teleport): pos is the seat, unused while aboard. */
export function aboard(seat: Vec3): TroyState {
  return { where: 'aboard', pos: { ...seat }, yaw: Math.PI, speed: 0, gait: 0, ride: 0, rideDir: 'down' };
}

const TWO_PI = 2 * Math.PI;
const ARRIVE = 1e-9;
// A stick this small is no stick.
const DEAD = 1e-6;

export function stepTroy(t: TroyState, input: TroyInput, dt: number, rooms: Rooms): TroyState {
  if (t.where !== 'onFoot') return t;

  // M2 walk: turn to face the movement; no strafing — he moves along his facing once turned.
  const mx = input.move.x;
  const mz = input.move.z;
  const stick = Math.min(1, Math.hypot(mx, mz));
  let yaw = t.yaw;
  let target = 0;
  if (stick > DEAD) {
    // forward(yaw) = (−sin yaw, −cos yaw), so the heading of a direction (x, z) is atan2(−x, −z).
    const want = Math.atan2(-mx, -mz);
    yaw = turnToward(yaw, want, T.walkTurnRate * dt);
    target = T.walkSpeed * stick * (Math.abs(wrapAngle(want - yaw)) > Math.PI / 2 ? T.walkTurnSlow : 1);
  }
  let speed = target > t.speed ? Math.min(t.speed + T.walkAccel * dt, target) : Math.max(t.speed - T.walkDecel * dt, target);
  // Land on the target when this close, so float error never leaves him creeping at 1e-16 m/s.
  if (Math.abs(speed - target) < ARRIVE) speed = target;

  const floor = t.pos.y;
  const moved: Vec3 = { x: t.pos.x - Math.sin(yaw) * speed * dt, y: floor, z: t.pos.z - Math.cos(yaw) * speed * dt };
  const pos = resolve(moved, rooms) ?? { ...t.pos };

  return { ...t, pos, yaw: wrapAngle(yaw), speed, gait: wrapGait(t.gait + (speed * dt * TWO_PI) / T.walkStride) };
}

// ---- Walkable (M1) ----

/** Troy's foot centre is inside some room shrunk by his radius on x and z, on its floor, and clear of every prop. */
export function walkable(p: Vec3, rooms: Rooms): boolean {
  return inShrunkRoom(p, rooms) && rooms.props.every((b) => !circleInBox(p, b));
}

/** The foot centre inside some room box shrunk by Troy's radius on x and z, at that room's floor. */
export function inShrunkRoom(p: Vec3, rooms: Rooms): boolean {
  const r = T.troyRadius;
  return rooms.rooms.some((b) =>
    onFloor(p, b) && p.x >= b.min.x + r - ON_EDGE && p.x <= b.max.x - r + ON_EDGE && p.z >= b.min.z + r - ON_EDGE && p.z <= b.max.z - r + ON_EDGE);
}

// On the edge counts as inside, with a hair of slack so a clamped point is left alone on the next step.
const ON_EDGE = 1e-9;
const FLOOR_MATCH = 1e-6;
const onFloor = (p: Vec3, b: Box) => Math.abs(p.y - b.min.y) <= FLOOR_MATCH;

/**
 * The walkable point nearest (x, z), on whichever room's floor that is (M10's walkTo, the ?script= word walk=x:z): the
 * point clamped into each shrunk room box and resolved out of the props, the closest of those that is walkable.
 */
export function nearestWalkable(x: number, z: number, rooms: Rooms): Vec3 {
  const r = T.troyRadius;
  let best: Vec3 | null = null;
  let bestD = Infinity;
  for (const b of rooms.rooms) {
    const q = resolve({ x: clamp(x, b.min.x + r, b.max.x - r), y: b.min.y, z: clamp(z, b.min.z + r, b.max.z - r) }, rooms);
    if (q === null) continue;
    const d = Math.hypot(q.x - x, q.z - z);
    if (d < bestD) [best, bestD] = [q, d];
  }
  return best ?? { ...rooms.start.pos };
}

// ---- Collision (M2) ----

const PASSES = 3;

/** The resolved foot centre, or null when no walkable point was found near p (the caller keeps the last one). */
function resolve(p: Vec3, rooms: Rooms): Vec3 | null {
  let q = clampIntoRooms(p, rooms);
  for (let k = 0; k < PASSES; k++) {
    q = pushOutOfProps(pushOutOfProps(q, rooms.props), rooms.props);
    if (walkable(q, rooms)) return q;
    q = clampIntoRooms(q, rooms);
    if (walkable(q, rooms)) return q;
  }
  return null;
}

/** If p left the union of shrunk rooms, the nearest point of the nearest shrunk room on p's floor. */
function clampIntoRooms(p: Vec3, rooms: Rooms): Vec3 {
  if (inShrunkRoom(p, rooms)) return p;
  const r = T.troyRadius;
  let best: Vec3 = p;
  let bestD = Infinity;
  for (const b of rooms.rooms) {
    if (!onFloor(p, b)) continue;
    const q = { x: clamp(p.x, b.min.x + r, b.max.x - r), y: b.min.y, z: clamp(p.z, b.min.z + r, b.max.z - r) };
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < bestD) [best, bestD] = [q, d];
  }
  return best;
}

/**
 * Push the foot circle out of each prop it overlaps by exactly the overlap: away from the prop's nearest point when the
 * centre is outside its footprint (along a face's axis, or out from a corner), out through the nearest face when inside.
 */
function pushOutOfProps(p: Vec3, props: readonly Box[]): Vec3 {
  const r = T.troyRadius;
  let q = p;
  for (const b of props) {
    if (!circleInBox(q, b)) continue;
    const cx = clamp(q.x, b.min.x, b.max.x);
    const cz = clamp(q.z, b.min.z, b.max.z);
    const d = Math.hypot(q.x - cx, q.z - cz);
    if (d > 0) {
      const k = r / d;
      q = { x: cx + (q.x - cx) * k, y: q.y, z: cz + (q.z - cz) * k };
      continue;
    }
    // The centre inside the footprint: out along the shortest axis.
    const exits: Array<[number, number]> = [
      [b.min.x - r - q.x, 0],
      [b.max.x + r - q.x, 0],
      [0, b.min.z - r - q.z],
      [0, b.max.z + r - q.z],
    ];
    let [dx, dz] = exits[0]!;
    for (const e of exits) if (Math.hypot(e[0], e[1]) < Math.hypot(dx, dz)) [dx, dz] = e;
    q = { x: q.x + dx, y: q.y, z: q.z + dz };
  }
  return q;
}

/** The foot circle overlaps the prop's footprint (strictly), and the prop stands in the capsule's height. */
function circleInBox(p: Vec3, b: Box): boolean {
  if (b.max.y <= p.y || b.min.y >= p.y + T.troyHeight) return false;
  const cx = clamp(p.x, b.min.x, b.max.x);
  const cz = clamp(p.z, b.min.z, b.max.z);
  return Math.hypot(p.x - cx, p.z - cz) < T.troyRadius - ON_EDGE;
}

// ---- Small arithmetic ----

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

function wrapGait(g: number): number {
  const w = g % TWO_PI;
  return w < 0 ? w + TWO_PI : w;
}

/** Turns the shorter way; on arrival the heading is exactly the target. */
function turnToward(yaw: number, target: number, step: number): number {
  const d = wrapAngle(target - yaw);
  if (Math.abs(d) <= step) return target;
  return yaw + Math.sign(d) * step;
}

export function wrapAngle(a: number): number {
  return a - TWO_PI * Math.round(a / TWO_PI);
}
