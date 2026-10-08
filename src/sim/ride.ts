// The injector chair's ride (phase 3, M6 — down; M6b — back up). Pure and deterministic like the rest of src/sim: the
// chair is a point moving along ROOMS.shaft by arc length, on a fixed timetable.
//
//   - Sit (M6): on 'use' of the chair while on foot (session.ts applyUse) Troy becomes where 'riding', rideDir 'down',
//     ride 0, pos = shaft[0], facing the way the chair faces (chair.yaw + π). The sub is not touched.
//   - Descent (M6): ride advances so the chair covers the shaft in RIDE_SECONDS with a 1.5 s ease-in and a 1 s ease-out —
//     the speed is a smoothstep over those time slices of the 10 s, constant between — and pos is the shaft polyline
//     sampled at ride by arc length. The state carries only `ride`; the time is recovered from it (rideTimeAt, the
//     timetable's inverse), so TroyState keeps M2's shape.
//   - Facing (M6: "the chair faces along the path (yaw from the current leg; on the last leg it turns to the sub's
//     yaw, π)"): a level leg's yaw is its own heading; a vertical leg has none, so over it the chair turns from the
//     heading it came in with (the chair's own yaw + π, at the top) to the next leg's heading — or, on the last leg, to
//     the sub's yaw — eased by its progress along the leg.
//   - Lock-in (M6): the step on which the timetable reaches RIDE_SECONDS ends with ride at 1 and, in the same step,
//     where 'aboard' — Troy's aboard state exactly as phase 2's standby has it (seat, the sub's yaw, ride 0) — and
//     nothing else changes: sub, launch and combat are stepGame's alone.
//   - The way back up (M6b): an accepted 'leave' (session.ts) sets where 'riding', rideDir 'up', ride 1 at the seat, and
//     the ride runs back to 0 over the same RIDE_SECONDS — the descent's timetable run backwards in time ("Going up
//     reverses it", M4), so the ascent eases in from the seat over the descent's last slice (1 s) and eases out at
//     the top over its first (1.5 s), and the chair passes each point at the same speed both ways. M6b: "on the way up
//     it faces up" — the facing rule run over the reversed polyline (chairYawUp). At 0 Troy stands up: on foot, facing
//     chair.yaw + π, still — at standPoint, the walkable point in front of the chair (see there).

import type { Rooms } from './rooms';
import { type TroyState, aboard, nearestWalkable, onFoot, walkable } from './troy';
import { TUNING as T } from './tuning';
import type { Vec3 } from './vec3';

/** M6: the descent's whole time, s. */
export const RIDE_SECONDS: number = T.rideSeconds;

const EASE_IN = T.rideEaseIn;
const EASE_OUT = T.rideEaseOut;
/** The cruising speed as a fraction of the shaft per second: the eased slices cover half their time's worth each. */
const CRUISE = 1 / (RIDE_SECONDS - EASE_IN / 2 - EASE_OUT / 2);
/** The timetable lands on its end this close (s), so N whole steps reach RIDE_SECONDS on the Nth despite float error. */
const ARRIVE = 1e-9;

/** ∫₀ˣ smoothstep = x³ − x⁴/2: the distance an eased slice covers, as a fraction of its length at cruise. */
const easedDistance = (x: number) => x * x * x - (x * x * x * x) / 2;
const smooth = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** M6's timetable: progress 0…1 along the shaft `seconds` after the chair sets off. */
export function rideProgressAt(seconds: number): number {
  const t = Math.min(Math.max(seconds, 0), RIDE_SECONDS);
  if (t >= RIDE_SECONDS) return 1;
  if (t < EASE_IN) return CRUISE * EASE_IN * easedDistance(t / EASE_IN);
  const slowFrom = RIDE_SECONDS - EASE_OUT;
  if (t <= slowFrom) return CRUISE * (EASE_IN / 2 + (t - EASE_IN));
  return 1 - CRUISE * EASE_OUT * easedDistance((RIDE_SECONDS - t) / EASE_OUT);
}

/** The chair's speed `seconds` into the ride as a fraction of its cruising speed: 0 at rest … 1 (for sound). */
export function rideSpeedAt(seconds: number): number {
  const t = Math.min(Math.max(seconds, 0), RIDE_SECONDS);
  if (t < EASE_IN) return smooth(t / EASE_IN);
  if (t > RIDE_SECONDS - EASE_OUT) return smooth((RIDE_SECONDS - t) / EASE_OUT);
  return 1;
}

/** The timetable's inverse: the seconds since setting off at which the chair is at `ride`. Bisection (it is monotonic). */
export function rideTimeAt(ride: number): number {
  if (ride <= 0) return 0;
  if (ride >= 1) return RIDE_SECONDS;
  let lo = 0;
  let hi = RIDE_SECONDS;
  for (let k = 0; k < 64; k++) {
    const mid = (lo + hi) / 2;
    if (rideProgressAt(mid) < ride) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The shaft's legs: start, end, length, and where along the whole each begins (m). */
export interface Leg {
  from: Vec3;
  to: Vec3;
  length: number;
  start: number;
}

export function legsOf(shaft: readonly Vec3[]): Leg[] {
  const legs: Leg[] = [];
  let start = 0;
  for (let k = 1; k < shaft.length; k++) {
    const from = shaft[k - 1]!;
    const to = shaft[k]!;
    const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    legs.push({ from, to, length, start });
    start += length;
  }
  return legs;
}

/** The point at arc length `s` (m) along the shaft, clamped to its ends. */
export function shaftPointAt(shaft: readonly Vec3[], s: number): Vec3 {
  const legs = legsOf(shaft);
  const leg = legAt(legs, s);
  if (!leg) return { ...shaft[0]! };
  const f = leg.length > 0 ? clamp01((s - leg.start) / leg.length) : 0;
  return lerp(leg.from, leg.to, f);
}

/** M6: the chair's seat point at progress `ride` (0…1) along the shaft, by arc length. */
export function shaftPoint(shaft: readonly Vec3[], ride: number): Vec3 {
  return shaftPointAt(shaft, clamp01(ride) * totalLength(shaft));
}

/** A leg is level enough to have a heading of its own when it runs more along than down. */
const headingOf = (leg: Leg): number | null => {
  const dx = leg.to.x - leg.from.x;
  const dz = leg.to.z - leg.from.z;
  const run = Math.hypot(dx, dz);
  // forward(yaw) = (−sin yaw, −cos yaw), so the heading of a direction (x, z) is atan2(−x, −z).
  return run > Math.abs(leg.to.y - leg.from.y) ? Math.atan2(-dx, -dz) : null;
};

/**
 * M6: the chair's facing at progress `ride`: a level leg's own heading; over a vertical leg a turn, eased by the
 * progress along it, from the heading it came in with (`startYaw` at the top) to the next leg's heading, or to
 * `endYaw` (the sub's) on the last leg.
 */
export function chairYaw(shaft: readonly Vec3[], ride: number, startYaw: number, endYaw: number): number {
  const legs = legsOf(shaft);
  const s = clamp01(ride) * totalLength(shaft);
  const k = Math.max(0, legs.indexOf(legAt(legs, s)!));
  const own = headingOf(legs[k]!);
  if (own !== null) return own;
  let before = startYaw;
  for (let j = k - 1; j >= 0; j--) {
    const h = headingOf(legs[j]!);
    if (h !== null) { before = h; break; }
  }
  let after = endYaw;
  for (let j = k + 1; j < legs.length; j++) {
    const h = headingOf(legs[j]!);
    if (h !== null) { after = h; break; }
  }
  const leg = legs[k]!;
  const f = smooth(clamp01(leg.length > 0 ? (s - leg.start) / leg.length : 1));
  return wrapAngle(before + wrapAngle(after - before) * f);
}

/**
 * M6b: the chair's facing on the way up at progress `ride` (running 1 → 0): M6's rule over the polyline reversed — a
 * level leg's own heading the way the chair now travels; over a vertical leg a turn from the heading it came in with
 * (`bottomYaw`, the sub's, at the seat) to the next leg's, or to `topYaw` (the way Troy faces standing up) on the bore.
 */
export function chairYawUp(shaft: readonly Vec3[], ride: number, topYaw: number, bottomYaw: number): number {
  return chairYaw([...shaft].reverse(), 1 - clamp01(ride), bottomYaw, topYaw);
}

/**
 * M6b: where Troy stands up. The contract says shaft[0] (the chair's own point), but that is on the injector bay's
 * plinth — a prop Troy may never stand in (M2) — so he stands at the faithful nearest thing: the first walkable point
 * straight out in front of the chair along the way its seat faces (chair.yaw + π), ≈ 1.5 m out (the plinth's front edge
 * is 1.1 m from the chair, plus his radius), where he stood to sit. Falls back on the nearest walkable point.
 */
export function standPoint(rooms: Rooms): Vec3 {
  const c = rooms.chair;
  const yaw = c.yaw + Math.PI;
  for (let d = 0; d <= 4; d += 0.01) {
    const p = { x: c.pos.x - Math.sin(yaw) * d, y: c.pos.y, z: c.pos.z - Math.cos(yaw) * d };
    if (walkable(p, rooms)) return p;
  }
  return nearestWalkable(c.pos.x, c.pos.z, rooms);
}

/** M6b: an accepted 'leave' — Troy riding up from the pilot's seat (the shaft's last point), ride 1, still. */
export function leaveSeat(t: TroyState, rooms: Rooms, seatYaw: number): TroyState {
  return { ...t, where: 'riding', rideDir: 'up', ride: 1, pos: { ...rooms.shaft[rooms.shaft.length - 1]! }, yaw: seatYaw, speed: 0 };
}

/** M6's sit: Troy into the chair at the top of the shaft, facing the way the seat faces, still. */
export function sit(t: TroyState, rooms: Rooms): TroyState {
  return { ...t, where: 'riding', rideDir: 'down', ride: 0, pos: { ...rooms.shaft[0]! }, yaw: rooms.chair.yaw + Math.PI, speed: 0 };
}

/**
 * One step of the ride (M6, M6b): a no-op unless Troy is riding. `seatYaw` is the sub's heading on the cradle
 * (phase 2's yawOut, π) — the way the chair lands facing, and the way it sets off back up.
 */
export function stepRide(t: TroyState, dt: number, rooms: Rooms, seatYaw: number): TroyState {
  if (t.where !== 'riding') return t;
  if (t.rideDir === 'up') return stepRideUp(t, dt, rooms, seatYaw);
  const time = rideTimeAt(t.ride) + dt;
  const seat = rooms.shaft[rooms.shaft.length - 1]!;
  // Lock-in (M6): the chair reaches the seat and Troy is aboard in the same step.
  if (time >= RIDE_SECONDS - ARRIVE) return { ...aboard(seat), yaw: seatYaw };
  const ride = rideProgressAt(time);
  return {
    ...t,
    ride,
    pos: shaftPoint(rooms.shaft, ride),
    yaw: chairYaw(rooms.shaft, ride, rooms.chair.yaw + Math.PI, seatYaw),
  };
}

/**
 * M6b: one step of the way back up — the descent's timetable backwards: `elapsed` seconds into the ascent the chair
 * is where the descent has it RIDE_SECONDS − elapsed in. At the top, in the same step, Troy stands up (standPoint).
 */
function stepRideUp(t: TroyState, dt: number, rooms: Rooms, seatYaw: number): TroyState {
  const elapsed = RIDE_SECONDS - rideTimeAt(t.ride) + dt;
  const topYaw = rooms.chair.yaw + Math.PI;
  if (elapsed >= RIDE_SECONDS - ARRIVE) return onFoot({ pos: standPoint(rooms), yaw: wrapAngle(topYaw) });
  const ride = rideProgressAt(RIDE_SECONDS - elapsed);
  return { ...t, ride, pos: shaftPoint(rooms.shaft, ride), yaw: chairYawUp(rooms.shaft, ride, topYaw, seatYaw) };
}

function legAt(legs: readonly Leg[], s: number): Leg | undefined {
  for (const leg of legs) if (s <= leg.start + leg.length) return leg;
  return legs[legs.length - 1];
}

function totalLength(shaft: readonly Vec3[]): number {
  return legsOf(shaft).reduce((sum, leg) => sum + leg.length, 0);
}

const lerp = (a: Vec3, b: Vec3, f: number): Vec3 => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f });
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
