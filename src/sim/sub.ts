// Stingray's motion: pure, deterministic, advanced only by stepSub at a fixed dt.
// Forward is local -Z; yaw/pitch in radians (world.ts has the heading convention); pitch > 0 = nose up.

import { contact } from './collide';
import { TUNING as T } from './tuning';
import type { Vec3 } from './vec3';
import { CLIFF_TOP, COAST_Z, type Env, type World } from './world';

/** Axes in [-1, 1]. yaw > 0 turns left (the yaw angle grows); pitch > 0 = climb (nose up). */
export interface SubInput {
  throttle: number;
  yaw: number;
  pitch: number;
  boost: boolean;
  /** Read by the combat step (a later task), not here. */
  fire: boolean;
}

export type Medium = 'submerged' | 'surface' | 'airborne';

export interface SubState {
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  medium: Medium;
}

export const NO_INPUT: SubInput = Object.freeze({ throttle: 0, yaw: 0, pitch: 0, boost: false, fire: false });

export function initialSubState(world: World): SubState {
  return { pos: { ...world.spawn.pos }, vel: { x: 0, y: 0, z: 0 }, yaw: world.spawn.yaw, pitch: 0, medium: 'submerged' };
}

/** Unit vector along the nose. */
export function forwardOf(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}

export function speedOf(s: SubState): number {
  return Math.hypot(s.vel.x, s.vel.y, s.vel.z);
}

export function stepSub(s: SubState, i: SubInput, dt: number, env: Env): SubState {
  const n: SubState = { pos: { ...s.pos }, vel: { ...s.vel }, yaw: s.yaw, pitch: s.pitch, medium: s.medium };
  // Dive input leaves the surface immediately.
  if (n.medium === 'surface' && i.pitch < 0) n.medium = 'submerged';

  const current = edgeCurrent(n.pos, env.bounds.halfSize);
  if (n.medium === 'airborne') fly(n, i, dt);
  else swim(n, i, dt, current);
  n.vel.x += current.x * T.edgePush * dt;
  n.vel.z += current.z * T.edgePush * dt;

  n.pos.x += n.vel.x * dt;
  n.pos.y += n.vel.y * dt;
  n.pos.z += n.vel.z * dt;

  changeMedium(n, i);
  collideLandmarks(n, env, dt);
  collideSeabed(n, env, dt);
  keepInBounds(n, env.bounds.halfSize);
  return n;
}

// ---- In the water (submerged or on the surface) ----

function swim(n: SubState, i: SubInput, dt: number, current: Vec3): void {
  n.yaw += i.yaw * yawRate(speedOf(n)) * dt;
  steerWithCurrent(n, current, dt);

  if (n.medium === 'surface') n.pitch = towardZero(n.pitch, T.levelRate * dt);
  else if (i.pitch !== 0) n.pitch += i.pitch * T.pitchRate * dt;
  else n.pitch = towardZero(n.pitch, T.levelRate * dt);
  n.pitch = clampPitch(n.pitch);

  // Split velocity into speed along the nose and drift off it; thrust drives the first, drag kills the second.
  const f = forwardOf(n.yaw, n.pitch);
  const along = dot(n.vel, f);
  const keep = Math.exp(-T.sideDrag * dt);
  const speed = thrust(along, i, dt);
  n.vel = {
    x: speed * f.x + (n.vel.x - along * f.x) * keep,
    y: speed * f.y + (n.vel.y - along * f.y) * keep,
    z: speed * f.z + (n.vel.z - along * f.z) * keep,
  };

  // Surface running: the one buoyancy — the hull settles half-awash.
  if (n.medium === 'surface') n.vel.y = (T.surfaceY - n.pos.y) * T.surfaceSettle;
}

/** New speed along the nose: thrust toward the throttle's target speed, otherwise coast toward rest. */
function thrust(along: number, i: SubInput, dt: number): number {
  const cap = i.boost ? T.boostSpeed : T.cruiseSpeed;
  const target = i.throttle > 0 ? i.throttle * cap : i.throttle * T.reverseSpeed;
  const thrusting = i.throttle !== 0 && Math.sign(target - along) === Math.sign(i.throttle);
  if (!thrusting) return moveToward(along, target, T.coastDecel * dt);
  const accel = along >= T.cruiseSpeed ? T.boostAccel : T.thrustAccel;
  return moveToward(along, target, accel * dt);
}

/** Full rate up to cruise speed (and on the spot at rest), easing down to boostYawFactor at boost speed. */
export function yawRate(speed: number): number {
  const overCruise = clamp01((speed - T.cruiseSpeed) / (T.boostSpeed - T.cruiseSpeed));
  return T.yawRate * (1 - (1 - T.boostYawFactor) * overCruise);
}

// ---- In the air ----

function fly(n: SubState, i: SubInput, dt: number): void {
  n.vel.y -= T.gravity * dt;
  // The nose follows the arc, with a little pitch authority either side of it.
  const arc = Math.atan2(n.vel.y, Math.hypot(n.vel.x, n.vel.z));
  const want = arc + i.pitch * T.airPitchAuthority;
  n.pitch = clampPitch(n.pitch + (want - n.pitch) * (1 - Math.exp(-T.airNoseFollow * dt)));
}

// ---- Surface, leap and re-entry ----

function changeMedium(n: SubState, i: SubInput): void {
  const y = n.pos.y;
  if (n.medium === 'airborne') {
    if (y < 0) {
      n.medium = 'submerged';
      n.vel = scale(n.vel, T.reentryKeep);
    }
    return;
  }
  if (n.medium !== 'submerged') return;
  const rising = n.vel.y;
  if (y >= 0) n.medium = rising >= T.leapSpeed ? 'airborne' : 'surface';
  // A climb slower than leapSpeed reaching the awash line settles onto the surface.
  else if (y >= T.surfaceY && rising > 0 && rising < T.leapSpeed) n.medium = 'surface';
  else if (y >= -T.surfaceBand && i.pitch === 0 && Math.abs(n.pitch) < T.surfaceLevelEpsilon) n.medium = 'surface';
}

// ---- Collisions ----

function collideLandmarks(n: SubState, env: Env, dt: number): void {
  for (const landmark of env.landmarks) {
    if (!landmark.solid) continue;
    for (const c of landmark.colliders) {
      const hit = contact(c, n.pos, T.hullRadius);
      if (!hit) continue;
      n.pos = hit.pos;
      const into = dot(n.vel, hit.normal);
      if (into < 0) n.vel = sub(n.vel, scale(hit.normal, into));
      n.vel = scale(n.vel, Math.exp(-T.contactDrag * dt));
    }
  }
}

// The hull rides at least hullRadius above the bed, sliding along it with the nose lifted to the slope.
function collideSeabed(n: SubState, env: Env, dt: number): void {
  const bed = env.seabedHeight(n.pos.x, n.pos.z);
  const floor = bed + T.hullRadius;
  if (n.pos.y >= floor) return;
  n.pos.y = floor;
  if (n.vel.y < 0) n.vel.y = 0;
  const shed = Math.exp(-T.bedDrag * dt);
  n.vel.x *= shed;
  n.vel.z *= shed;
  const ahead = forwardOf(n.yaw, 0);
  const slope = env.seabedHeight(n.pos.x + ahead.x, n.pos.z + ahead.z) - bed;
  n.pitch = clampPitch(Math.max(n.pitch, Math.atan(slope)));
}

// Hard limits behind the edge current and the cliff: the sub cannot leave, in the water or in the air.
function keepInBounds(n: SubState, half: number): void {
  const limit = half - T.hullRadius;
  if (n.pos.x > limit) [n.pos.x, n.vel.x] = [limit, Math.min(n.vel.x, 0)];
  if (n.pos.x < -limit) [n.pos.x, n.vel.x] = [-limit, Math.max(n.vel.x, 0)];
  if (n.pos.z > limit) [n.pos.z, n.vel.z] = [limit, Math.min(n.vel.z, 0)];
  // Above the clifftop the land is still the limit: no flying over Marineville.
  const north = n.pos.y > CLIFF_TOP ? COAST_Z + T.hullRadius : -limit;
  if (n.pos.z < north) [n.pos.z, n.vel.z] = [north, Math.max(n.vel.z, 0)];
}

// ---- Edge current ----

/** Inward direction near the east, west and south bounds, its length growing 0 → 1 across the zone. */
function edgeCurrent(p: Vec3, half: number): Vec3 {
  const inner = half - T.edgeZone;
  const east = clamp01((p.x - inner) / T.edgeZone);
  const west = clamp01((-p.x - inner) / T.edgeZone);
  const south = clamp01((p.z - inner) / T.edgeZone);
  return { x: west - east, y: 0, z: -south };
}

function steerWithCurrent(n: SubState, current: Vec3, dt: number): void {
  const strength = Math.min(Math.hypot(current.x, current.z), 1);
  if (strength === 0) return;
  const inward = Math.atan2(-current.x, -current.z);
  const turn = wrapAngle(inward - n.yaw);
  const most = T.edgeTurnRate * strength * dt;
  n.yaw += Math.min(Math.max(turn, -most), most);
}

// ---- Small arithmetic ----

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const clampPitch = (p: number) => Math.min(Math.max(p, -T.maxPitch), T.maxPitch);
const towardZero = (v: number, step: number) => moveToward(v, 0, step);

function moveToward(v: number, target: number, step: number): number {
  if (v < target) return Math.min(v + step, target);
  return Math.max(v - step, target);
}

function wrapAngle(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}
