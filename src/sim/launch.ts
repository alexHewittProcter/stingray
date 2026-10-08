// The launch (phase 2, L2 and L3): the machinery in Pen 3 and the ocean door, and stepGame — the one step
// function, called every fixed step in every mode. Pure and deterministic like the rest of src/sim.
//
// Each step, in order: the machinery (the press, if any, then the timed motions and the tower) → the sub
// (carried on the cradle while clamped, else stepSub with the interior's speed cap, the door and confinement
// applied around it) → stepCombat (with fire forced off north of the cliff face, and always the full world).

import { type CombatState, initialCombatState, stepCombat } from './combat';
import { confine, northOfFace } from './interior';
import { seatOf } from './rooms';
import { type SubInput, type SubState, forwardOf, initialSubState, speedOf, stepSub } from './sub';
import { type TroyState, aboard } from './troy';
import { TUNING as T } from './tuning';
import type { Vec3 } from './vec3';
import { type Env, type Interior, MARINE_DOOR } from './world';

export type LaunchControl = 'cradle' | 'engines' | 'clamps' | 'door';

export const LAUNCH_CONTROLS: readonly LaunchControl[] = Object.freeze(['cradle', 'engines', 'clamps', 'door']);

/** Phase 3, M7: everything Game.press() can queue — the launch controls, Troy's use (E) and leaving the seat (5). */
export type Press = LaunchControl | 'use' | 'leave';

export interface Refusal {
  /** Phase 3 widens this to the Press union (M6: 'leave' refused "Dock first"). */
  control: Press;
  reason: string;
  /** Seconds since the press was refused. */
  age: number;
}

export interface LaunchState {
  /** 0 = raised (standby) … 1 = lowered (submerged). */
  cradle: number;
  cradleDir: -1 | 0 | 1;
  /** 'starting' lasts TUNING.engineStart. */
  engines: 'off' | 'starting' | 'on';
  clamps: 'locked' | 'released';
  /** 0 shut … 1 open (L2). */
  door: number;
  doorDir: -1 | 0 | 1;
  /** The last refused press, for the HUD. */
  refusal: Refusal | null;
  /** Additive to L3: seconds the engines have been starting (0 unless engines = 'starting'). */
  engineStart: number;
}

/** Phase 3, M5: the HUD's flavour line; `until` is in combat.t seconds (the HUD compares, the sim does not time it). */
export interface HudLines {
  line: { text: string; until: number } | null;
}

export interface GameState {
  sub: SubState;
  combat: CombatState;
  launch: LaunchState;
  /** Phase 3, M7: Troy — aboard in every phase-2 starting state; stepGame passes it through untouched. */
  troy: TroyState;
  /** Phase 3, M5/M7: passed through untouched by stepGame. */
  hud: HudLines;
}

/** L3's refusal reasons, in the table's words. */
export const REFUSAL = Object.freeze({
  cradleMoving: 'Cradle is moving',
  away: 'Stingray is away',
  stopEngines: 'Stop engines first',
  lowerCradle: 'Lower the cradle first',
  lockClamps: 'Lock the clamps first',
  startEngines: 'Start engines first',
  notOver: 'Not over the cradle',
  tooFast: 'Too fast',
  notLinedUp: 'Not lined up',
  onCradle: 'Still on the cradle',
  outOfRange: 'Out of door range',
  // Phase 3 (M6): launch presses need a pilot; leaving the seat needs Stingray docked and raised.
  notAboard: 'Not aboard',
  notDocked: 'Dock first',
});

// Timed motions land on their end value when this close, so N steps of 1/60 s reach a whole-second travel
// on the Nth step and not before, despite float error.
const ARRIVE = 1e-9;

// ---- Starting states ----

/** Docked in Pen 3: raised, engines off, clamps locked, door shut. Keeps combat's clock and targets if given. */
export function standby(env: Env, combat?: CombatState): GameState {
  const c = env.marineville.interior.cradle;
  return {
    sub: {
      pos: { x: c.pos.x, y: c.raisedY, z: c.pos.z },
      vel: { x: 0, y: 0, z: 0 },
      yaw: c.yawOut,
      pitch: 0,
      medium: mediumOnCradle(c.raisedY),
    },
    combat: freshCombat(env, combat),
    launch: {
      cradle: 0, cradleDir: 0, engines: 'off', clamps: 'locked', door: 0, doorDir: 0, refusal: null, engineStart: 0,
    },
    troy: aboard(seatOf(c)),
    hud: { line: null },
  };
}

/** ?start=ocean: at phase 1's spawn, engines on, clamps released, cradle lowered, door shut. */
export function oceanStart(env: Env, combat?: CombatState): GameState {
  return {
    sub: initialSubState(env),
    combat: freshCombat(env, combat),
    launch: released({ door: 0, doorDir: 0 }),
    troy: aboard(seatOf(env.marineville.interior.cradle)),
    hud: { line: null },
  };
}

/**
 * The launch state ?start=ocean sets — cradle lowered, engines on, clamps released — keeping the door as it is.
 * Every debug teleport (L8) and phase 1's return-to-spawn use it.
 */
export function released(door: Pick<LaunchState, 'door' | 'doorDir'>): LaunchState {
  return {
    cradle: 1, cradleDir: 0, engines: 'on', clamps: 'released', door: door.door, doorDir: door.doorDir, refusal: null, engineStart: 0,
  };
}

// R (L4) keeps combat's clock and the targets (destroyed ones stay destroyed) and clears missiles in flight.
function freshCombat(env: Env, combat: CombatState | undefined): CombatState {
  if (!combat) return initialCombatState(env);
  return { ...combat, cooldown: 0, missiles: [], detonations: [], targets: combat.targets.map((t) => ({ ...t })) };
}

// ---- The step ----

export function stepGame(g: GameState, input: SubInput, pressed: LaunchControl | null, dt: number, env: Env): GameState {
  const interior = env.marineville.interior;

  let launch = g.launch.refusal ? { ...g.launch, refusal: { ...g.launch.refusal, age: g.launch.refusal.age + dt } } : g.launch;
  if (pressed !== null) launch = press(launch, g.sub, pressed, interior);
  launch = advance(launch, g.sub, dt, interior);

  const sub = launch.clamps === 'locked' ? carry(g.sub, launch, dt, interior) : drive(g.sub, input, launch, dt, env);

  // Weapons are safe inside Marineville; missiles always meet the full world, door included (L2).
  const fire = input.fire && !northOfFace(sub.pos);
  const combat = stepCombat(g.combat, sub, fire, dt, env);
  return { sub, combat, launch, troy: g.troy, hud: g.hud };
}

// ---- The controls (L3's table) ----

/** Why a press would be refused right now, or null if it would be accepted. The first failing condition wins. */
export function refusalFor(control: LaunchControl, l: LaunchState, sub: SubState, interior: Interior): string | null {
  switch (control) {
    case 'cradle':
      if (l.cradleDir !== 0) return REFUSAL.cradleMoving;
      if (l.cradle <= 0) return null; // lower
      if (l.clamps === 'released') return REFUSAL.away;
      if (l.engines !== 'off') return REFUSAL.stopEngines;
      return null; // raise
    case 'engines':
      if (l.engines === 'off') return l.cradle >= 1 && l.cradleDir === 0 ? null : REFUSAL.lowerCradle;
      return l.clamps === 'locked' ? null : REFUSAL.lockClamps;
    case 'clamps':
      if (l.clamps === 'locked') {
        if (l.cradle < 1 || l.cradleDir !== 0) return REFUSAL.lowerCradle;
        return l.engines === 'on' ? null : REFUSAL.startEngines;
      }
      return lockRefusal(sub, interior);
    case 'door':
      if (l.clamps === 'locked') return REFUSAL.onCradle;
      return distance(sub.pos, interior.door.centre) <= interior.door.range ? null : REFUSAL.outOfRange;
  }
}

function lockRefusal(sub: SubState, interior: Interior): string | null {
  const c = interior.cradle;
  if (distance(sub.pos, { x: c.pos.x, y: c.loweredY, z: c.pos.z }) > T.lockRadius) return REFUSAL.notOver;
  if (speedOf(sub) >= T.lockSpeed) return REFUSAL.tooFast;
  const offAxis = Math.min(Math.abs(wrapAngle(sub.yaw - c.yawOut)), Math.abs(wrapAngle(sub.yaw - c.yawOut - Math.PI)));
  if (offAxis > T.lockHeading || Math.abs(sub.pitch) > T.lockPitch) return REFUSAL.notLinedUp;
  return null;
}

function press(l: LaunchState, sub: SubState, control: LaunchControl, interior: Interior): LaunchState {
  const reason = refusalFor(control, l, sub, interior);
  if (reason !== null) return { ...l, refusal: { control, reason, age: 0 } };
  switch (control) {
    case 'cradle':
      return { ...l, cradleDir: l.cradle <= 0 ? 1 : -1 };
    case 'engines':
      return l.engines === 'off' ? { ...l, engines: 'starting', engineStart: 0 } : { ...l, engines: 'off', engineStart: 0 };
    case 'clamps':
      return { ...l, clamps: l.clamps === 'locked' ? 'released' : 'locked' };
    case 'door':
      // Already open or opening: no effect, no refusal. Shut or closing: open.
      return l.door >= 1 || l.doorDir === 1 ? l : { ...l, doorDir: 1 };
  }
}

// ---- Timed motions and the tower ----

function advance(l: LaunchState, sub: SubState, dt: number, interior: Interior): LaunchState {
  const n = { ...l };

  if (n.cradleDir !== 0) {
    n.cradle += (n.cradleDir * dt) / T.cradleTravel;
    if (n.cradle >= 1 - ARRIVE) [n.cradle, n.cradleDir] = [1, 0];
    else if (n.cradle <= ARRIVE) [n.cradle, n.cradleDir] = [0, 0];
  }

  if (n.engines === 'starting') {
    n.engineStart += dt;
    if (n.engineStart >= T.engineStart - ARRIVE) [n.engines, n.engineStart] = ['on', 0];
  }

  // The tower: an open door closes once the hull centre is beyond range; a closing door never closes on the hull.
  const away = distance(sub.pos, interior.door.centre);
  if (n.doorDir === -1 && away <= T.doorReopenDistance) n.doorDir = 1;
  if (n.door >= 1 && n.doorDir === 0 && away > interior.door.range) n.doorDir = -1;
  if (n.doorDir !== 0) {
    n.door += (n.doorDir * dt) / T.doorTravel;
    if (n.door >= 1 - ARRIVE) [n.door, n.doorDir] = [1, 0];
    else if (n.door <= ARRIVE) [n.door, n.doorDir] = [0, 0];
  }
  return n;
}

// ---- The sub on the cradle ----

/** The hull-centre height the cradle holds the sub at. */
export function cradleHeight(cradle: number, interior: Interior): number {
  const c = interior.cradle;
  return c.raisedY + (c.loweredY - c.raisedY) * cradle;
}

/** Clamped: carried toward the cradle's pose (level, at rest), then held there exactly. Driving does nothing. */
function carry(s: SubState, l: LaunchState, dt: number, interior: Interior): SubState {
  const c = interior.cradle;
  const target = { x: c.pos.x, y: cradleHeight(l.cradle, interior), z: c.pos.z };
  const pos = moveTowardPoint(s.pos, target, T.carrySpeed * dt);
  // Either way along the pen's axis; while the cradle raises, round to face the tunnel.
  const want = l.cradleDir === -1 ? c.yawOut : nearerAxis(s.yaw, c.yawOut);
  return {
    pos,
    vel: { x: 0, y: 0, z: 0 },
    yaw: turnToward(s.yaw, want, T.carryYawRate * dt),
    pitch: moveToward(s.pitch, 0, T.carryPitchRate * dt),
    medium: mediumOnCradle(pos.y),
  };
}

// Never 'surface' while clamped, so release always hands stepSub a submerged sub (L3).
const mediumOnCradle = (y: number): SubState['medium'] => (y > 0 ? 'airborne' : 'submerged');

/** Of the pen axis's two headings (yawOut and its reverse), the one nearer to yaw. */
function nearerAxis(yaw: number, yawOut: number): number {
  return Math.abs(wrapAngle(yaw - yawOut)) <= Math.PI / 2 ? yawOut : wrapAngle(yawOut + Math.PI);
}

// ---- The sub driven ----

function drive(s: SubState, input: SubInput, l: LaunchState, dt: number, env: Env): SubState {
  const inside = northOfFace(s.pos);
  // L1's cap: no boost north of the face, and the throttle scaled to the cap. Reverse is unchanged.
  const given = inside
    ? { ...input, boost: false, throttle: input.throttle > 0 ? (input.throttle * T.interiorSpeedCap) / T.cruiseSpeed : input.throttle }
    : input;
  // L2: the door is solid unless fully open.
  const n = stepSub(s, given, dt, l.door >= 1 ? withoutDoor(env) : env);
  confineHull(n, env.marineville.interior, dt);
  if (northOfFace(n.pos)) capAlongNose(n);
  return n;
}

/** L1 confinement with C3's solid-landmark rule: slide along the wall, shed speed, never stop dead. */
function confineHull(n: SubState, interior: Interior, dt: number): void {
  const c = confine(n.pos, interior);
  if (c.normal === null) return;
  n.pos = c.pos;
  const into = dot(n.vel, c.normal);
  if (into < 0) n.vel = sub(n.vel, scale(c.normal, into));
  n.vel = scale(n.vel, Math.exp(-T.contactDrag * dt));
}

/** The hard clamp: speed along the nose no more than the cap (a sub arriving from the sea snaps down at the mouth). */
function capAlongNose(n: SubState): void {
  const f = forwardOf(n.yaw, n.pitch);
  const along = dot(n.vel, f);
  if (along > T.interiorSpeedCap) n.vel = sub(n.vel, scale(f, along - T.interiorSpeedCap));
}

// The world stepSub sees while the door is fully open: the same world less the door's collider. Built once per world.
const doorless = new WeakMap<Env, Env>();

export function withoutDoor(env: Env): Env {
  let open = doorless.get(env);
  if (!open) {
    open = Object.freeze({
      ...env,
      landmarks: env.landmarks.map((landmark) =>
        landmark.colliders.includes(MARINE_DOOR)
          ? Object.freeze({ ...landmark, colliders: landmark.colliders.filter((c) => c !== MARINE_DOOR) })
          : landmark,
      ),
    });
    doorless.set(env, open);
  }
  return open;
}

// ---- Small arithmetic ----

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function moveTowardPoint(from: Vec3, to: Vec3, step: number): Vec3 {
  const d = distance(from, to);
  if (d <= step) return { ...to };
  const k = step / d;
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, z: from.z + (to.z - from.z) * k };
}

function moveToward(v: number, target: number, step: number): number {
  if (v < target) return Math.min(v + step, target);
  return Math.max(v - step, target);
}

/** Turns the shorter way; on arrival the heading is exactly the target. */
function turnToward(yaw: number, target: number, step: number): number {
  const d = wrapAngle(target - yaw);
  if (Math.abs(d) <= step) return target;
  return yaw + Math.sign(d) * step;
}

function wrapAngle(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}
