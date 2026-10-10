import { describe, expect, it } from 'vitest';
import { modeOf } from '../game/mode';
import { boreSlopeAt, capAt, confine, northOfFace } from './interior';
import {
  type GameState, type LaunchControl, type LaunchState, LAUNCH_CONTROLS, REFUSAL, cradleHeight, oceanStart, refusalFor,
  released, standby, stepGame, withoutDoor,
} from './launch';
import { type SubInput, type SubState, NO_INPUT, forwardOf, speedOf } from './sub';
import { TUNING as T } from './tuning';
import type { Vec3 } from './vec3';
import { COAST_Z, FIXED_DT as DT, MARINE_DOOR, createWorld } from './world';

const W = createWorld(1964);
const I = W.marineville.interior;
const MOUTH = W.marineville.tunnelMouth;
const CRADLE_DOWN: Vec3 = { x: I.cradle.pos.x, y: I.cradle.loweredY, z: I.cradle.pos.z };
const EPS = 1e-9;

const steps = (seconds: number) => Math.round(seconds / DT);
const input = (i: Partial<SubInput>): SubInput => ({ ...NO_INPUT, ...i });
const FULL: SubInput = { throttle: 1, yaw: 1, pitch: 1, boost: true, fire: true };

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const dist = (a: Vec3, b: Vec3) => len(sub(a, b));
const wrap = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
const clamp1 = (v: number) => Math.min(Math.max(v, -1), 1);
const along = (s: SubState) => dot(s.vel, forwardOf(s.yaw, s.pitch));

/** A released sub somewhere, at rest unless a velocity is given; launch as ?start=ocean with the given door. */
function freeAt(pos: Vec3, yaw: number, door: Partial<Pick<LaunchState, 'door' | 'doorDir'>> = {}, vel: Vec3 = { x: 0, y: 0, z: 0 }): GameState {
  const g = oceanStart(W);
  return {
    ...g, // phase 3 (M7): Troy aboard, no HUD line, as oceanStart gives them
    sub: { pos: { ...pos }, vel: { ...vel }, yaw, pitch: 0, medium: 'submerged' },
    combat: g.combat,
    launch: released({ door: door.door ?? 0, doorDir: door.doorDir ?? 0 }),
  };
}

const withLaunch = (g: GameState, l: Partial<LaunchState>): GameState => ({ ...g, launch: { ...g.launch, ...l } });

function run(g: GameState, n: number, i: SubInput = NO_INPUT, each?: (prev: GameState, next: GameState) => void): GameState {
  for (let k = 0; k < n; k++) {
    const next = stepGame(g, i, null, DT, W);
    each?.(g, next);
    g = next;
  }
  return g;
}

const press = (g: GameState, control: LaunchControl, i: SubInput = NO_INPUT) => stepGame(g, i, control, DT, W);

/** No step moves the hull further than its speed allows: at most what the step's speed (plus a step of the
 *  strongest acceleration) covers, or the cradle's carry rate while clamped. */
function expectNoJump(prev: GameState, next: GameState): void {
  const moved = dist(prev.sub.pos, next.sub.pos);
  const allowed = Math.max(speedOf(prev.sub) + 25 * DT, T.carrySpeed) * DT + 1e-9;
  expect(moved).toBeLessThanOrEqual(allowed);
}

/** How far the hull centre is outside the interior volume (0 inside). */
const outside = (p: Vec3) => dist(confine(p, I).pos, p);

// ---- A simple autopilot that follows a path (polyline) at a wanted speed: for the scripted runs ----

function pathLength(path: Vec3[]): number {
  let total = 0;
  for (let k = 1; k < path.length; k++) total += dist(path[k - 1]!, path[k]!);
  return total;
}

/** Arc length of the point on the path nearest p. */
function nearestArc(path: Vec3[], p: Vec3): number {
  let best = Infinity;
  let bestArc = 0;
  let arc = 0;
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1]!;
    const ab = sub(path[k]!, a);
    const l = len(ab);
    const s = Math.min(Math.max(dot(sub(p, a), ab) / (l * l), 0), 1);
    const d = dist(p, add(a, scale(ab, s)));
    if (d < best) [best, bestArc] = [d, arc + s * l];
    arc += l;
  }
  return bestArc;
}

function pointAt(path: Vec3[], arc: number): Vec3 {
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1]!;
    const l = dist(a, path[k]!);
    if (arc <= l) return add(a, scale(sub(path[k]!, a), arc / l));
    arc -= l;
  }
  return { ...path[path.length - 1]! };
}

const LOOK_AHEAD = 12;

/** Steer at a point LOOK_AHEAD along the path; slow to a stop at its end. */
function follow(path: Vec3[], s: SubState, cruise: number): SubInput {
  const here = nearestArc(path, s.pos);
  const remaining = pathLength(path) - here;
  const end = path[path.length - 1]!;
  const aim = pointAt(path, here + LOOK_AHEAD);
  const d = sub(aim, s.pos);
  const near = dist(s.pos, end) < 3;
  const wantYaw = Math.atan2(-d.x, -d.z);
  const wantPitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  const wantSpeed = Math.min(cruise, 0.8 * remaining);
  const cap = Math.min(capAt(s.pos, I), T.cruiseSpeed); // the sim scales the throttle to the cap below cruise (D6)
  return {
    throttle: Math.min(wantSpeed / cap, 1),
    yaw: near ? 0 : clamp1(wrap(wantYaw - s.yaw) * 3),
    pitch: near ? 0 : clamp1((wantPitch - s.pitch) * 3),
    boost: false,
    fire: false,
  };
}

const INWARD = I.tunnel.centreline;
const OUTWARD = [...INWARD].reverse();
const SEA = (metres: number): Vec3 => ({ x: MOUTH.x, y: MOUTH.y, z: COAST_Z + metres });
/** From the lowered cradle down the tunnel and out to sea. */
const LAUNCH_PATH: Vec3[] = [CRADLE_DOWN, ...OUTWARD, SEA(400)];
/** From the sea in through the tunnel to the lowered cradle. */
const RETURN_PATH: Vec3[] = [SEA(200), ...INWARD, CRADLE_DOWN];

interface Trace {
  /** Mode changes, in order. */
  modes: string[];
  each?: (prev: GameState, next: GameState) => void;
}

/** One step of a script: drive with `i`, pressing `control` if given, recording mode changes. */
function scriptStep(g: GameState, i: SubInput, control: LaunchControl | null, trace: Trace): GameState {
  const next = stepGame(g, i, control, DT, W);
  trace.each?.(g, next);
  const m = modeOf(next.sub.pos);
  if (m !== trace.modes[trace.modes.length - 1]) trace.modes.push(m);
  return next;
}

/** Standby → lowered → engines → released → the tunnel (asking for the door in range) → `out` metres out to sea. */
function scriptedLaunch(start: GameState, trace: Trace, out = 200): GameState {
  let g = scriptStep(start, NO_INPUT, 'cradle', trace);
  for (let k = 0; g.launch.cradle < 1 && k < steps(T.cradleTravel + 1); k++) g = scriptStep(g, NO_INPUT, null, trace);
  g = scriptStep(g, NO_INPUT, 'engines', trace);
  for (let k = 0; g.launch.engines !== 'on' && k < steps(T.engineStart + 1); k++) g = scriptStep(g, NO_INPUT, null, trace);
  g = scriptStep(g, NO_INPUT, 'clamps', trace);
  let asked = false;
  for (let k = 0; k < steps(90) && g.sub.pos.z < COAST_Z + out; k++) {
    const ask: boolean = !asked && dist(g.sub.pos, I.door.centre) <= I.door.requestRange;
    asked ||= ask;
    g = scriptStep(g, follow(LAUNCH_PATH, g.sub, T.cruiseSpeed), ask ? 'door' : null, trace);
  }
  return g;
}

/** At sea: a boosted run with the guns going, then round and home. */
function scriptedSortie(start: GameState, trace: Trace): GameState {
  let g = start;
  for (let k = 0; k < steps(4); k++) g = scriptStep(g, input({ throttle: 1, boost: true, fire: true, yaw: k < steps(2) ? 0 : 0.6 }), null, trace);
  return g;
}

/** Back from the sea: door, tunnel, over the cradle, lock, engines off, raise. */
function scriptedReturn(start: GameState, trace: Trace): GameState {
  let g = start;
  let asked = false;
  for (let k = 0; k < steps(120); k++) {
    const atCradle = dist(g.sub.pos, CRADLE_DOWN) < 1 && speedOf(g.sub) < 1;
    if (atCradle) break;
    const ask: boolean = !asked && dist(g.sub.pos, I.door.centre) <= I.door.requestRange;
    asked ||= ask;
    g = scriptStep(g, follow(RETURN_PATH, g.sub, T.cruiseSpeed), ask ? 'door' : null, trace);
  }
  g = scriptStep(g, NO_INPUT, 'clamps', trace);
  g = scriptStep(g, NO_INPUT, 'engines', trace);
  g = scriptStep(g, NO_INPUT, 'cradle', trace);
  for (let k = 0; k < steps(T.cradleTravel + 1); k++) g = scriptStep(g, NO_INPUT, null, trace);
  return g;
}

// ---- The tests ----

describe('launch machinery (L3)', () => {
  it('1. from standby, lower → engines → release each reach their state after the stated time and not before', () => {
    let g = press(standby(W), 'cradle');
    expect(g.launch.cradleDir).toBe(1);
    g = run(g, steps(T.cradleTravel) - 2); // 479 steps of the press's 480
    expect(g.launch.cradleDir).toBe(1);
    expect(g.launch.cradle).toBeLessThan(1);
    expect(stepGame(g, NO_INPUT, 'engines', DT, W).launch.refusal?.reason).toBe(REFUSAL.lowerCradle);
    g = run(g, 1); // the 8 s mark: 480 steps from the press, the press's own step included
    expect(g.launch).toMatchObject({ cradle: 1, cradleDir: 0, engines: 'off', clamps: 'locked' });
    expect(g.sub.pos).toEqual(CRADLE_DOWN);
    expect(g.sub.medium).toBe('submerged');

    g = press(g, 'engines');
    expect(g.launch.engines).toBe('starting');
    g = run(g, steps(T.engineStart) - 2);
    expect(g.launch.engines).toBe('starting');
    expect(stepGame(g, NO_INPUT, 'clamps', DT, W).launch.refusal?.reason).toBe(REFUSAL.startEngines);
    g = run(g, 1); // the 2 s mark
    expect(g.launch.engines).toBe('on');

    g = press(g, 'clamps');
    expect(g.launch).toMatchObject({ cradle: 1, engines: 'on', clamps: 'released', door: 0, refusal: null });
    // Release hands stepSub a submerged sub at rest, which does not shoot upward.
    expect(g.sub.medium).toBe('submerged');
    const later = run(g, steps(1));
    expect(later.sub.pos.y).toBeCloseTo(I.cradle.loweredY, 6);
    expect(later.sub.medium).toBe('submerged');
  });

  it('2. every out-of-order press is refused with its reason (first failing condition first) and changes nothing but refusal', () => {
    const lowered = withLaunch(standby(W), { cradle: 1 });
    const loweredState = { ...lowered, sub: { ...lowered.sub, pos: { ...CRADLE_DOWN }, medium: 'submerged' as const } };
    const running = withLaunch(loweredState, { engines: 'on' });
    const starting = withLaunch(loweredState, { engines: 'starting', engineStart: 0.5 });
    const moving = press(standby(W), 'cradle');
    const away = (pos: Vec3, yaw: number, vel?: Vec3, pitch = 0): GameState => {
      const g = freeAt(pos, yaw, {}, vel);
      return { ...g, sub: { ...g.sub, pitch } };
    };
    const cases: Array<[string, GameState, LaunchControl, string]> = [
      ['cradle: moving (lowering)', moving, 'cradle', REFUSAL.cradleMoving],
      ['cradle: moving (raising)', withLaunch(loweredState, { cradleDir: -1, cradle: 0.9 }), 'cradle', REFUSAL.cradleMoving],
      ['cradle: raise with Stingray away', away(CRADLE_DOWN, Math.PI), 'cradle', REFUSAL.away],
      ['cradle: raise with engines on', running, 'cradle', REFUSAL.stopEngines],
      ['cradle: raise with engines starting', starting, 'cradle', REFUSAL.stopEngines],
      ['engines: start when raised', standby(W), 'engines', REFUSAL.lowerCradle],
      ['engines: start while lowering', moving, 'engines', REFUSAL.lowerCradle],
      ['engines: stop with clamps released', away(CRADLE_DOWN, Math.PI), 'engines', REFUSAL.lockClamps],
      ['clamps: release when raised', standby(W), 'clamps', REFUSAL.lowerCradle],
      ['clamps: release while lowering', moving, 'clamps', REFUSAL.lowerCradle],
      ['clamps: release with engines off', loweredState, 'clamps', REFUSAL.startEngines],
      ['clamps: release with engines starting', starting, 'clamps', REFUSAL.startEngines],
      ['clamps: lock away from the cradle', away(add(CRADLE_DOWN, { x: 4.5, y: 0, z: 0 }), 0), 'clamps', REFUSAL.notOver],
      ['clamps: lock far and fast', away(add(CRADLE_DOWN, { x: 0, y: 0, z: 30 }), 0, { x: 0, y: 0, z: -10 }), 'clamps', REFUSAL.notOver],
      ['clamps: lock too fast', away(CRADLE_DOWN, 0, { x: 0, y: 0, z: -3 }), 'clamps', REFUSAL.tooFast],
      ['clamps: lock fast and crooked', away(CRADLE_DOWN, 1, { x: 0, y: 0, z: -5 }), 'clamps', REFUSAL.tooFast],
      ['clamps: lock off the axis', away(CRADLE_DOWN, 21 * (Math.PI / 180)), 'clamps', REFUSAL.notLinedUp],
      ['clamps: lock off the reversed axis', away(CRADLE_DOWN, Math.PI - 21 * (Math.PI / 180)), 'clamps', REFUSAL.notLinedUp],
      ['clamps: lock pitched', away(CRADLE_DOWN, 0, undefined, 16 * (Math.PI / 180)), 'clamps', REFUSAL.notLinedUp],
      ['door: from the cradle', standby(W), 'door', REFUSAL.onCradle],
      ['door: clamped and lowered', running, 'door', REFUSAL.onCradle],
      ['door: out of range at the pen\'s north end', away({ x: 0, y: I.cradle.loweredY, z: I.pen.min.z + T.hullRadius }, 0), 'door', REFUSAL.outOfRange],
      ['door: out of range at sea', away(SEA(I.door.requestRange + 1), 0), 'door', REFUSAL.outOfRange],
    ];
    const strip = (g: GameState) => ({ ...g, launch: { ...g.launch, refusal: null } });
    for (const [name, g, control, reason] of cases) {
      expect(refusalFor(control, g.launch, g.sub, I), name).toBe(reason);
      const refused = stepGame(g, NO_INPUT, control, DT, W);
      const idle = stepGame(g, NO_INPUT, null, DT, W);
      expect(refused.launch.refusal, name).toEqual({ control, reason, age: 0 });
      expect(strip(refused), name).toEqual(strip(idle));
      // The refusal ages.
      expect(run(refused, 30).launch.refusal?.age, name).toBeCloseTo(30 * DT, 12);
    }
    // Every control has at least one refusal walked.
    expect(new Set(cases.map((c) => c[2]))).toEqual(new Set(LAUNCH_CONTROLS));

    // The door already open or opening: no effect, no refusal.
    for (const door of [{ door: 1, doorDir: 0 as const }, { door: 0.4, doorDir: 1 as const }]) {
      const g = freeAt(SEA(50), 0, door);
      const pressed = stepGame(g, NO_INPUT, 'door', DT, W);
      expect(pressed).toEqual(stepGame(g, NO_INPUT, null, DT, W));
      expect(pressed.launch.refusal).toBeNull();
    }
    // The lock zone's edges are accepted: within 4 m, just under 3 m/s, 19° off either axis direction, 14° pitch.
    const edge = away(add(CRADLE_DOWN, { x: 3.9, y: 0, z: 0 }), Math.PI + 0.33, { x: 0, y: 0, z: 2.9 }, 0.24);
    expect(refusalFor('clamps', edge.launch, edge.sub, I)).toBeNull();
  });

  it('3. while clamped the sub follows the cradle exactly and no driving input moves it; throttle works only once engines are on and the clamps released', () => {
    let g = press(standby(W), 'cradle', FULL);
    const check = (s: GameState) => {
      expect(s.sub.pos).toEqual({ x: I.cradle.pos.x, y: cradleHeight(s.launch.cradle, I), z: I.cradle.pos.z });
      expect(s.sub.vel).toEqual({ x: 0, y: 0, z: 0 });
      expect(s.sub.yaw).toBe(I.cradle.yawOut);
      expect(s.sub.pitch).toBe(0);
      expect(s.sub.medium).toBe(s.sub.pos.y > 0 ? 'airborne' : 'submerged');
      expect(s.combat.missiles).toEqual([]);
      expect(s.combat.detonations).toEqual([]);
    };
    check(g);
    g = run(g, steps(T.cradleTravel), FULL, (_, next) => check(next));
    expect(g.launch.cradle).toBe(1);
    g = press(g, 'engines', FULL);
    g = run(g, steps(T.engineStart) + 30, FULL, (_, next) => check(next));
    expect(g.launch.engines).toBe('on');
    const before = g.sub.pos;
    g = press(g, 'clamps', input({ throttle: 1 }));
    g = run(g, steps(1), input({ throttle: 1 }));
    expect(dist(g.sub.pos, before)).toBeGreaterThan(3);
  });

  it('the carry: a locked sub is brought to the cradle pose at up to 6 m/s, 30°/s and 60°/s, then is that pose', () => {
    // Lock at the edge of the zone, crooked, then watch the carry.
    const start = freeAt(add(CRADLE_DOWN, { x: 2.5, y: -2, z: 2 }), 0.3, {}, { x: 0, y: 0, z: -1 });
    const pitched = { ...start, sub: { ...start.sub, pitch: 0.2 } };
    let g = press(pitched, 'clamps');
    expect(g.launch.clamps).toBe('locked');
    let k = 0;
    while (dist(g.sub.pos, CRADLE_DOWN) > 0 || g.sub.yaw !== 0 || g.sub.pitch !== 0) {
      const next = run(g, 1);
      expect(dist(next.sub.pos, g.sub.pos)).toBeLessThanOrEqual(T.carrySpeed * DT + EPS);
      expect(Math.abs(wrap(next.sub.yaw - g.sub.yaw))).toBeLessThanOrEqual(T.carryYawRate * DT + EPS);
      expect(Math.abs(next.sub.pitch - g.sub.pitch)).toBeLessThanOrEqual(T.carryPitchRate * DT + EPS);
      expect(next.sub.medium).toBe('submerged');
      g = next;
      k += 1;
      if (k > steps(2)) break;
    }
    expect(k * DT).toBeLessThan(1); // under a second from anywhere in the lock zone
    expect(g.sub.vel).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('confinement through stepGame (L1)', () => {
  const pushes: Array<[string, Vec3, number, SubInput, SubInput]> = [
    ['tunnel wall', { x: 0, y: -40, z: -1140 }, Math.PI / 2, input({ throttle: 1, boost: true }), input({ throttle: -1 })],
    ['pen west wall', { ...CRADLE_DOWN }, Math.PI / 2, input({ throttle: 1, boost: true }), input({ throttle: -1 })],
    ['pen north wall', { ...CRADLE_DOWN }, 0, input({ throttle: 1, boost: true }), input({ throttle: -1 })],
    ['pen east wall', { x: 10, y: -14, z: -1420 }, -Math.PI / 2, input({ throttle: 1, boost: true }), input({ throttle: -1 })],
    ['pool floor', { ...CRADLE_DOWN }, 0.4, input({ throttle: 1, pitch: -1, boost: true }), input({ throttle: 1, pitch: 1 })],
    ['tunnel–pen junction', { x: 0, y: -14, z: -1338 }, Math.PI / 2 + 0.3, input({ throttle: 1, yaw: 0.2 }), input({ throttle: -1 })],
  ];

  it.each(pushes)('4. full throttle into the %s for 10 s keeps the margin, never jumps, and can drive away', (_, pos, yaw, push, away) => {
    let g = freeAt(pos, yaw);
    let worst = 0;
    g = run(g, steps(10), push, (prev, next) => {
      expectNoJump(prev, next);
      worst = Math.max(worst, outside(next.sub.pos));
    });
    expect(worst).toBeLessThanOrEqual(1e-6);
    expect(northOfFace(g.sub.pos)).toBe(true);
    const pinned = g.sub.pos;
    g = run(g, steps(2), away, (prev, next) => expectNoJump(prev, next));
    expect(dist(g.sub.pos, pinned)).toBeGreaterThan(5);
    expect(outside(g.sub.pos)).toBeLessThanOrEqual(1e-6);
  });

  it('the shed: pressed into a wall, speed bleeds off rather than stopping dead', () => {
    // Glancing into the tunnel wall: it slides along the bore rather than stopping.
    const g = run(freeAt({ x: 0, y: -40, z: -1110 }, 0.4), steps(3), input({ throttle: 1 }));
    expect(-g.sub.vel.z).toBeGreaterThan(5);
  });
});

describe('the speed cap (L1, ramped by phase 4 D6)', () => {
  const WALL = I.pen.max.z;
  const TUNNEL = (south: number): Vec3 => {
    // On the incline's centreline, `south` metres south of the pen's south wall.
    const [, top, end] = I.tunnel.centreline as [Vec3, Vec3, Vec3];
    const u = south / (top.z - end.z);
    return { x: 0, y: end.y + (top.y - end.y) * u, z: WALL + south };
  };

  it('D6. capAt: 15 in the pen and at its south wall, the full boost cap 60 m out and beyond (the tunnel, the sea), linear between', () => {
    expect(T.capRamp).toBe(60);
    expect(capAt(CRADLE_DOWN, I)).toBe(T.interiorSpeedCap);
    expect(capAt({ x: 0, y: I.cradle.raisedY, z: I.pen.min.z + 5 }, I)).toBe(T.interiorSpeedCap);
    expect(capAt(TUNNEL(0), I)).toBe(T.interiorSpeedCap);
    expect(capAt(TUNNEL(30), I)).toBeCloseTo((T.interiorSpeedCap + T.boostSpeed) / 2, 12);
    expect(capAt(TUNNEL(60), I)).toBe(T.boostSpeed);
    expect(capAt(TUNNEL(120), I)).toBe(T.boostSpeed);
    expect(capAt({ x: 0, y: -40, z: COAST_Z - 35 }, I)).toBe(T.boostSpeed); // the door chamber
    expect(capAt(SEA(100), I)).toBe(T.boostSpeed);
    expect(capAt({ x: 300, y: -20, z: 0 }, I)).toBe(T.boostSpeed);
    // Monotone over the ramp.
    for (let d = 0; d < 60; d += 1) expect(capAt(TUNNEL(d + 1), I)).toBeGreaterThan(capAt(TUNNEL(d), I));
  });

  it('6a. in the pen, forward speed never exceeds 15 m/s with boost held', () => {
    let worst = 0;
    run(freeAt({ x: 0, y: -14, z: I.pen.min.z + 10 }, Math.PI), steps(4), input({ throttle: 1, boost: true }), (_, next) => {
      if (next.sub.pos.z > WALL) return;
      worst = Math.max(worst, along(next.sub));
    });
    expect(worst).toBeLessThanOrEqual(T.interiorSpeedCap + EPS);
    expect(worst).toBeGreaterThan(T.interiorSpeedCap - 0.01);
  });

  it('D6. boost is allowed in the tunnel: from the door chamber the sub reaches 60 m/s heading in or out', () => {
    for (const [pos, yaw] of [[{ x: 0, y: -40, z: COAST_Z - 10 }, 0], [TUNNEL(150), Math.PI]] as const) {
      let worst = 0;
      const g = run(freeAt(pos, yaw, { door: 1 }, scale(forwardOf(yaw, 0), T.cruiseSpeed)), steps(1.6), input({ throttle: 1, boost: true }), (prev, next) => {
        expectNoJump(prev, next);
        expect(northOfFace(next.sub.pos)).toBe(true);
        worst = Math.max(worst, along(next.sub));
      });
      expect(worst, `from z ${pos.z}`).toBeGreaterThan(T.cruiseSpeed + 25);
      expect(worst).toBeLessThanOrEqual(T.boostSpeed + EPS);
      expect(g.sub.pos.z).toBeGreaterThan(WALL + T.capRamp); // still in the full-cap part of the tunnel
    }
  });

  it.each([0, 3.5, -4])('6b. a sub arriving from the sea at 60 m/s (%s m off the axis) keeps its speed into the tunnel, is not flung sideways, and the ramp slows it to 15 at the pen', (x) => {
    let g = freeAt({ x, y: -40, z: COAST_Z + 30 }, 0, { door: 1 }, { x: 0, y: 0, z: -60 });
    let k = 0;
    while (!northOfFace(g.sub.pos)) {
      const next = stepGame(g, input({ throttle: 1, boost: true }), null, DT, W);
      expectNoJump(g, next);
      g = next;
      expect(++k).toBeLessThan(120);
    }
    // No snap at the mouth (phase 2's cap is gone from the tunnel).
    expect(along(g.sub)).toBeGreaterThan(T.boostSpeed - 1);
    let sideways = 0;
    g = run(g, steps(0.5), input({ throttle: 1, boost: true }), (prev, next) => {
      expectNoJump(prev, next);
      sideways = Math.max(sideways, Math.abs(next.sub.pos.x - prev.sub.pos.x));
    });
    expect(sideways).toBeLessThan(0.3);
    expect(Math.abs(g.sub.pos.x)).toBeLessThanOrEqual(T.tunnelHullReach + 1e-6);
    expect(along(g.sub)).toBeGreaterThan(T.boostSpeed - 1);
  });

  it('D6. coming home at 60 m/s down the straight bore: the cap slows the sub over the last 60 m, never above capAt, 15 at the wall', () => {
    // Boost straight up the incline (the autopilot steers; boost held throughout).
    const path = [SEA(40), ...INWARD, CRADLE_DOWN];
    let g = freeAt(SEA(40), 0, { door: 1 }, { x: 0, y: 0, z: -60 });
    let atWall = -1;
    let entered = 60;
    for (let k = 0; k < steps(20) && g.sub.pos.z > WALL - 5; k++) {
      const steer = follow(path, g.sub, T.boostSpeed);
      const next = stepGame(g, { ...steer, throttle: 1, boost: true }, null, DT, W);
      expectNoJump(g, next);
      expect(outside(next.sub.pos)).toBeLessThanOrEqual(1e-6);
      expect(along(next.sub)).toBeLessThanOrEqual(capAt(next.sub.pos, I) + EPS);
      if (g.sub.pos.z > WALL + T.capRamp && next.sub.pos.z <= WALL + T.capRamp) entered = along(g.sub);
      if (atWall < 0 && next.sub.pos.z <= WALL) atWall = along(next.sub);
      g = next;
    }
    expect(entered).toBeGreaterThan(T.boostSpeed - 2); // it was at full speed on the ramp's south end
    expect(atWall).toBeGreaterThan(0);
    expect(atWall).toBeLessThanOrEqual(T.interiorSpeedCap + EPS);
  });

  it('6c. leaving the pen, speed rises past the old 15 m/s cap within 2 s of clearing the ramp', () => {
    const out = (g: GameState): SubInput => ({ ...follow(LAUNCH_PATH, g.sub, T.boostSpeed), throttle: 1, boost: true });
    let g = freeAt(TUNNEL(T.capRamp - 1), Math.PI, { door: 1 }, scale(forwardOf(Math.PI, 0), 15));
    for (let k = 0; g.sub.pos.z < WALL + T.capRamp; k++) {
      g = stepGame(g, out(g), null, DT, W);
      expect(k).toBeLessThan(120);
    }
    for (let k = 0; k < steps(2); k++) g = stepGame(g, out(g), null, DT, W);
    expect(along(g.sub)).toBeGreaterThan(T.interiorSpeedCap + 10);
  });
});

describe('the bore\'s pitch assist (phase 4 D6)', () => {
  const DEG = Math.PI / 180;
  const INCLINE = Math.atan(26 / 170);
  const BOOST = input({ throttle: 1, boost: true });
  /** Held on throttle and boost with no pitch (or steer) input: the worst speed and pitch seen while on the incline. */
  function holdThrough(start: GameState, until: (g: GameState) => boolean) {
    let g = start;
    let slowest = Infinity;
    let fastest = 0;
    let shed = 0; // the most speed lost in one step on the incline: a hull scraping the bore loses it every step
    let k = 0;
    for (; k < steps(20) && !until(g); k++) {
      const next = stepGame(g, BOOST, null, DT, W);
      expectNoJump(g, next);
      expect(outside(next.sub.pos)).toBeLessThanOrEqual(1e-6);
      const prev = g;
      g = next;
      const z = g.sub.pos.z;
      // The incline's middle, clear of the joins' blends and the ramp: z −1190 … −1270.
      if (z < -1190 && z > -1270) {
        [slowest, fastest] = [Math.min(slowest, speedOf(g.sub)), Math.max(fastest, speedOf(g.sub))];
        // Off the ramp's 60 m (z > −1280) the cap is the full 60 m/s, so speed only falls by scraping.
        shed = Math.max(shed, speedOf(prev.sub) - speedOf(g.sub));
      }
    }
    return { g, slowest, fastest, shed, seconds: k * DT };
  }

  it('boreSlopeAt: the incline\'s slope along the heading (≈ ±8.7°), level in the chamber and the pen, 0 at sea and broadside', () => {
    const mid = { x: 0, y: -27, z: -1255 };
    expect(boreSlopeAt(mid, 0, I)).toBeCloseTo(INCLINE, 9); // facing in (north), up the incline
    expect(boreSlopeAt(mid, Math.PI, I)).toBeCloseTo(-INCLINE, 9); // facing out, down it
    expect(boreSlopeAt(mid, Math.PI / 2, I)).toBeCloseTo(0, 9);
    expect(INCLINE / DEG).toBeCloseTo(8.7, 1);
    expect(boreSlopeAt({ x: 0, y: -40, z: COAST_Z - 30 }, 0, I)).toBe(0); // the door chamber
    expect(boreSlopeAt(CRADLE_DOWN, 0, I)).toBe(0); // the pen
    expect(boreSlopeAt(SEA(50), 0, I)).toBe(0); // the sea
    expect(boreSlopeAt({ x: 40, y: -27, z: -1255 }, 0, I)).toBe(0); // outside the bore
    // Blended across the corner and faded to level at the pen's wall: continuous, never beyond the incline's.
    let prev = boreSlopeAt({ x: 0, y: -40, z: COAST_Z - 1 }, 0, I);
    for (let z = COAST_Z - 1; z > I.pen.max.z; z -= 0.5) {
      const y = z > -1170 ? -40 : -40 + (26 * (-1170 - z)) / 170; // on the centreline
      const here = boreSlopeAt({ x: 0, y, z }, 0, I);
      expect(Math.abs(here - prev), `z ${z}`).toBeLessThan(0.01);
      expect(here).toBeLessThanOrEqual(INCLINE + 1e-12);
      prev = here;
    }
    expect(boreSlopeAt({ x: 0, y: -14, z: I.pen.max.z + 0.01 }, 0, I)).toBeCloseTo(0, 3);
  });

  it('out: from the released cradle, held level on throttle and boost (no pitch input), the sub runs the incline at ≥ 55 m/s and reaches the sea', () => {
    // The door asked for from the cradle as the run starts (an open one would shut at once: the cradle is beyond 280 m).
    const start = press(freeAt(CRADLE_DOWN, I.cradle.yawOut), 'door', BOOST);
    const { g, fastest, shed, seconds } = holdThrough(start, (g) => g.sub.pos.z > COAST_Z + 60);
    // Still gathering speed off the ramp (boost accelerates at 20 m/s²): it passes 55 on the incline, never sheds any.
    expect(fastest).toBeGreaterThanOrEqual(55);
    expect(shed).toBeLessThan(0.05);
    expect(g.sub.pos.z).toBeGreaterThan(COAST_Z + 60);
    expect(seconds).toBeLessThan(11); // ≈ 10.2 s from the release to 60 m out at sea
  });

  it('in: from the sea, held on throttle and boost (no pitch input), the sub runs up the incline at ≥ 55 m/s, then the ramp slows it into the pen', () => {
    const start = freeAt(SEA(200), 0, { door: 1 });
    const { g, slowest, shed } = holdThrough(start, (g) => g.sub.pos.z < I.pen.max.z - 10);
    expect(slowest).toBeGreaterThanOrEqual(55);
    expect(shed).toBeLessThan(0.05);
    expect(g.sub.pos.z).toBeLessThan(I.pen.max.z - 10);
    expect(along(g.sub)).toBeLessThanOrEqual(T.interiorSpeedCap + EPS);
  });

  it('the door chamber stays level: a sub held on the throttle there keeps its nose at 0', () => {
    let g = freeAt({ x: 0, y: -40, z: COAST_Z - 10 }, 0, { door: 1 });
    for (let k = 0; k < steps(0.8); k++) {
      g = stepGame(g, BOOST, null, DT, W);
      if (g.sub.pos.z > COAST_Z - 70 + T.boreTrimBlend / 2) expect(g.sub.pitch).toBe(0);
    }
  });

  it('no effect at sea: a pitched sub there with no pitch input levels to 0 as phase 1\'s does', () => {
    let g = freeAt(SEA(300), 0);
    g = { ...g, sub: { ...g.sub, pitch: -20 * DEG } };
    g = run(g, steps(0.5), input({ throttle: 1 }));
    expect(g.sub.pitch).toBe(0);
  });
});

describe('the ocean door (L2)', () => {
  const into = input({ throttle: 1, boost: true });

  it.each([
    ['shut', { door: 0 }],
    ['half-open', { door: 0.5 }],
  ])('7a. a %s door stops the sub from both sides', (_, door) => {
    const fromSea = run(freeAt(SEA(40), 0, door), steps(5), into, (_, next) => expect(northOfFace(next.sub.pos)).toBe(false));
    expect(fromSea.sub.pos.z).toBeCloseTo(COAST_Z + T.hullRadius, 6);
    const fromInside = run(freeAt({ x: 0, y: -40, z: COAST_Z - 40 }, Math.PI, door), steps(5), into, (_, next) =>
      expect(northOfFace(next.sub.pos)).toBe(true),
    );
    expect(fromInside.sub.pos.z).toBeLessThan(COAST_Z - 6);
  });

  it('7b. a fully open door passes the sub both ways, and the first step after it opens moves nothing', () => {
    expect(run(freeAt(SEA(40), 0, { door: 1 }), steps(5), into).sub.pos.z).toBeLessThan(COAST_Z - 40);
    expect(run(freeAt({ x: 0, y: -40, z: COAST_Z - 40 }, Math.PI, { door: 1 }), steps(5), into).sub.pos.z).toBeGreaterThan(COAST_Z + 20);

    // Pressed against the door while it opens: no jump on any step, and through once it is open.
    let g = run(freeAt(SEA(10), 0), steps(2), into);
    g = stepGame(g, into, 'door', DT, W);
    expect(g.launch.doorDir).toBe(1);
    let openedAt = -1;
    for (let k = 0; k < steps(T.doorTravel + 2); k++) {
      const next = stepGame(g, into, null, DT, W);
      expectNoJump(g, next);
      if (next.launch.door < 1) expect(northOfFace(next.sub.pos)).toBe(false);
      if (openedAt < 0 && next.launch.door === 1) openedAt = k;
      g = next;
    }
    expect(openedAt).toBeGreaterThan(0);
    expect(northOfFace(g.sub.pos)).toBe(true);
  });

  it('7c. a request out of range is refused; at exactly the range it is accepted (and opens: the tower closes it beyond closeRange)', () => {
    expect(press(freeAt(SEA(I.door.requestRange + 0.01), 0), 'door').launch.refusal?.reason).toBe(REFUSAL.outOfRange);
    expect(press(freeAt({ x: 0, y: -40, z: COAST_Z - I.door.requestRange - 0.01 }, 0), 'door').launch.refusal?.reason).toBe(REFUSAL.outOfRange);
    const atRange = press(freeAt(SEA(I.door.requestRange), 0), 'door');
    expect(atRange.launch).toMatchObject({ doorDir: 1, refusal: null });
    // Within closeRange the tower leaves an open door open.
    const near = press(freeAt(SEA(I.door.closeRange), 0), 'door');
    const open = run(near, steps(T.doorTravel) + 60);
    expect(open.launch).toMatchObject({ door: 1, doorDir: 0 });
    // Inside the tunnel too, measured from the door's centre.
    expect(press(freeAt({ x: 0, y: -40, z: COAST_Z - 100 }, 0), 'door').launch.doorDir).toBe(1);
  });

  it('D6. the ranges: request 340 m and close 280 m (tuning.ts), carried by World.interior.door', () => {
    expect(I.door).toEqual({ centre: MOUTH, requestRange: T.doorRequestRange, closeRange: T.doorCloseRange });
    expect(T.doorRequestRange).toBe(340);
    expect(T.doorCloseRange).toBe(280);
    // A boosting sub can ask from the pen's mouth and pass without stopping.
    expect(T.doorRequestRange).toBeGreaterThanOrEqual(T.boostSpeed * T.doorTravel + 30);
  });

  it('D6. a request is possible from the cradle: released on the lowered cradle, the door opens', () => {
    expect(dist(CRADLE_DOWN, I.door.centre)).toBeGreaterThan(I.door.closeRange);
    expect(dist(CRADLE_DOWN, I.door.centre)).toBeLessThan(I.door.requestRange);
    const g = press(freeAt(CRADLE_DOWN, I.cradle.yawOut), 'door');
    expect(g.launch).toMatchObject({ doorDir: 1, refusal: null });
  });

  it('D6. close on dock: an open door shuts once the sub is locked on the cradle (beyond closeRange), lowered or raised', () => {
    // Locked on the lowered cradle with the door open: the tower closes it.
    let g = press(freeAt(CRADLE_DOWN, I.cradle.yawOut, { door: 1 }), 'clamps');
    expect(g.launch.clamps).toBe('locked');
    expect(g.launch.doorDir).toBe(-1);
    g = run(g, steps(T.doorTravel));
    expect(g.launch).toMatchObject({ door: 0, doorDir: 0 });
    // And the raised (docked) sub is further still.
    expect(dist({ ...CRADLE_DOWN, y: I.cradle.raisedY }, I.door.centre)).toBeGreaterThan(I.door.closeRange);
  });

  it('D6. close at sea: an open door shuts beyond closeRange, and stays open within it', () => {
    expect(run(freeAt(SEA(I.door.closeRange - 1), 0, { door: 1 }), 1).launch).toMatchObject({ door: 1, doorDir: 0 });
    expect(run(freeAt(SEA(I.door.closeRange + 1), 0, { door: 1 }), 1).launch.doorDir).toBe(-1);
  });

  it('7d. the tower closes the door once the sub is out of range, in 5 s', () => {
    let g = freeAt(SEA(I.door.closeRange + 1), Math.PI, { door: 1 });
    g = run(g, 1);
    expect(g.launch.doorDir).toBe(-1);
    g = run(g, steps(T.doorTravel) - 2);
    expect(g.launch.door).toBeGreaterThan(0);
    g = run(g, 1);
    expect(g.launch).toMatchObject({ door: 0, doorDir: 0 });
  });

  it('7e. a closing door reopens rather than close on the hull, runs fully open, and stays open while the sub is in range', () => {
    let g = freeAt(SEA(T.doorReopenDistance - 1), 0, { door: 0.6, doorDir: -1 });
    g = run(g, 1);
    expect(g.launch.doorDir).toBe(1);
    // Backing away while it reopens: it still runs to fully open.
    g = run(g, steps(3), input({ throttle: -1 }));
    expect(g.launch).toMatchObject({ door: 1, doorDir: 0 });
    expect(dist(g.sub.pos, I.door.centre)).toBeGreaterThan(T.doorReopenDistance);
    g = run(g, steps(10));
    expect(g.launch.door).toBe(1);
    // A sub beyond 20 m does not reverse a closing door.
    const closing = run(freeAt(SEA(40), 0, { door: 0.6, doorDir: -1 }), 1);
    expect(closing.launch.doorDir).toBe(-1);
  });

  it('7f. a sub held against the cliff 500 m from the mouth neither opens the door nor holds it open', () => {
    const hug = { x: 500, y: -40, z: COAST_Z + T.hullRadius };
    let g = run(freeAt(hug, 0), steps(1), into);
    expect(g.sub.pos.z).toBeCloseTo(COAST_Z + T.hullRadius, 6);
    expect(press(g, 'door', into).launch).toMatchObject({ door: 0, doorDir: 0, refusal: { reason: REFUSAL.outOfRange } });
    g = run(freeAt(hug, 0, { door: 1 }), steps(T.doorTravel) + 2, into);
    expect(g.launch).toMatchObject({ door: 0, doorDir: 0 });
  });

  it('builds the door-less world once and leaves the door in the plain world', () => {
    expect(withoutDoor(W)).toBe(withoutDoor(W));
    const colliders = (env: typeof W) => env.landmarks.flatMap((l) => l.colliders);
    expect(colliders(W)).toContain(MARINE_DOOR);
    expect(colliders(withoutDoor(W))).not.toContain(MARINE_DOOR);
    expect(colliders(withoutDoor(W)).length).toBe(colliders(W).length - 1);
  });
});

describe('continuity (L4)', () => {
  it('8. a scripted launch from standby to 300 m out: no step jumps, and the mode changes exactly once, at the mouth', () => {
    let crossing: Vec3 | null = null;
    const trace: Trace = {
      modes: [modeOf(standby(W).sub.pos)],
      each: (prev, next) => {
        expectNoJump(prev, next);
        expect(outside(next.sub.pos)).toBeLessThanOrEqual(1e-6);
        if (northOfFace(prev.sub.pos) && !northOfFace(next.sub.pos)) crossing = next.sub.pos;
      },
    };
    const g = scriptedLaunch(standby(W), trace, 300);
    expect(g.sub.pos.z).toBeGreaterThanOrEqual(COAST_Z + 300);
    expect(trace.modes).toEqual(['launch', 'piloting']);
    expect(crossing).not.toBeNull();
    expect(dist(crossing!, MOUTH)).toBeLessThan(T.tunnelHullReach + 1);
    expect(g.launch).toMatchObject({ clamps: 'released', engines: 'on' });
    // 300 m out is beyond the door's close range (D6: 280 m): the tower is closing it behind the sub.
    expect(g.launch.doorDir).toBe(-1);
  });
});

describe('weapons inside (L2)', () => {
  it('9a. fire inside the interior launches nothing — in the tunnel, the pen and on the cradle', () => {
    const fire = input({ fire: true });
    for (const g of [freeAt({ x: 0, y: -40, z: -1101 }, Math.PI, { door: 1 }), freeAt(CRADLE_DOWN, 0), standby(W)]) {
      run(g, steps(2), fire, (_, next) => {
        expect(next.combat.missiles).toEqual([]);
        expect(next.combat.detonations).toEqual([]);
      });
    }
  });

  it.each([0, 1])('9b. a missile fired from the sea at the mouth detonates there (door = %s), even from a sub pressed against it', (door) => {
    for (const start of [SEA(60), SEA(T.hullRadius)]) {
      let g = stepGame(freeAt(start, 0, { door }), input({ fire: true }), null, DT, W);
      const blasts: Vec3[] = [...g.combat.detonations];
      g = run(g, steps(2), NO_INPUT, (_, next) => {
        blasts.push(...next.combat.detonations);
        for (const m of next.combat.missiles) expect(northOfFace(m.pos)).toBe(false);
      });
      expect(blasts.length).toBe(1);
      // At the face (a launch point already past it), or on the door's face — the door is always solid to missiles.
      expect(blasts[0]!.z).toBeGreaterThanOrEqual(COAST_Z - EPS);
      expect(blasts[0]!.z).toBeLessThanOrEqual(COAST_Z + T.missileRadius + EPS);
      expect(g.combat.missiles).toEqual([]);
    }
  });
});

describe('determinism', () => {
  it('12. two runs of a scripted launch, sortie and return end in identical state — docked in standby, facing yawOut', () => {
    const play = () => {
      const trace: Trace = { modes: ['launch'] };
      let g = scriptedLaunch(standby(W), trace, 150);
      g = scriptedSortie(g, trace);
      g = scriptedReturn(g, trace);
      return { g, modes: trace.modes };
    };
    const a = play();
    const b = play();
    expect(a).toEqual(b);
    expect(a.modes).toEqual(['launch', 'piloting', 'launch']);
    expect(a.g.combat.t).toBeGreaterThan(40);
    const docked = standby(W, a.g.combat);
    expect(a.g.sub).toEqual(docked.sub);
    expect(a.g.launch).toMatchObject({ ...docked.launch, refusal: null });
  });
});

describe('return and dock (L3, test 10)', () => {
  /** The lowered cradle's place on the pen floor plan, at the cradle's height. */
  const POOL = (x: number, z: number): Vec3 => ({ x, y: I.cradle.loweredY, z });
  // Arriving nose-first (heading north, as the tunnel leaves the sub) or turned round in the pool to face the
  // tunnel (yawOut): out past the cradle, a loop at the north end, and back down the axis onto it.
  const ARRIVALS: Array<[string, Vec3[]]> = [
    ['nose-in (north)', [...RETURN_PATH]],
    ['turned round (facing yawOut)', [SEA(200), ...INWARD, POOL(0, -1360), POOL(8, -1395), POOL(12, -1425), POOL(4, -1438), POOL(-4, -1432), POOL(0, -1418), CRADLE_DOWN]],
  ];

  /** From the open sea: ask for the door in range, drive the path at the cap, and slow to a creep in the pool. */
  function driveHome(start: GameState, path: Vec3[], trace: Trace): { g: GameState; doorClosingBehind: boolean } {
    let g = start;
    let asked = false;
    let doorClosingBehind = false;
    for (let k = 0; k < steps(120); k++) {
      if (dist(g.sub.pos, CRADLE_DOWN) < 1 && speedOf(g.sub) < 1) break;
      const ask: boolean = !asked && dist(g.sub.pos, I.door.centre) <= I.door.requestRange;
      asked ||= ask;
      const inPool = g.sub.pos.z < I.pen.max.z;
      g = scriptStep(g, follow(path, g.sub, inPool ? 5 : T.cruiseSpeed), ask ? 'door' : null, trace);
      // D6: the tower starts closing the door once the hull is beyond closeRange (280 m) — in the pool, short of the cradle.
      if (inPool && g.launch.doorDir === -1) doorClosingBehind = true;
    }
    return { g, doorClosingBehind };
  }

  it.each(ARRIVALS)('10a. from the open sea, %s: door, tunnel, pool, lock, engines off, raise — exactly standby, facing yawOut, door shut behind (D6: by the dock)', (_, path) => {
    const trace: Trace = {
      modes: ['piloting'],
      each: (prev, next) => {
        expectNoJump(prev, next);
        expect(outside(next.sub.pos)).toBeLessThanOrEqual(1e-6);
      },
    };
    const start = freeAt(SEA(200), 0); // out at sea, facing home, door shut
    const { g: arrived, doorClosingBehind } = driveHome(start, path, trace);
    expect(trace.modes).toEqual(['piloting', 'launch']);
    expect(doorClosingBehind).toBe(true); // the tower is closing it behind the returning sub before it reaches the cradle
    expect(dist(arrived.sub.pos, CRADLE_DOWN)).toBeLessThan(1);
    expect(refusalFor('clamps', arrived.launch, arrived.sub, I)).toBeNull();
    const facing = Math.abs(wrap(arrived.sub.yaw - I.cradle.yawOut));
    if (path === ARRIVALS[0]![1]) expect(facing).toBeGreaterThan(Math.PI - T.lockHeading);
    else expect(facing).toBeLessThan(T.lockHeading);

    let g = press(arrived, 'clamps');
    expect(g.launch.clamps).toBe('locked');
    // Raise is refused while the engines run.
    g = press(g, 'cradle');
    expect(g.launch.refusal?.reason).toBe(REFUSAL.stopEngines);
    expect(g.launch.cradleDir).toBe(0);
    g = run(g, steps(1)); // the carry onto the cradle: under a second
    expect(g.sub.pos).toEqual(CRADLE_DOWN);
    g = press(g, 'engines');
    expect(g.launch.engines).toBe('off');
    g = press(g, 'cradle');
    expect(g.launch.cradleDir).toBe(-1);
    g = run(g, steps(T.cradleTravel), NO_INPUT, (_, next) => expect(northOfFace(next.sub.pos)).toBe(true));

    const docked = standby(W, g.combat);
    expect(g.sub).toEqual(docked.sub);
    expect(g.sub.yaw).toBe(I.cradle.yawOut);
    expect({ ...g.launch, refusal: null }).toEqual(docked.launch);
  });

  it('10b. a second launch straight after a return reaches the sea: launch → sea → home → dock → launch again', () => {
    const trace: Trace = { modes: ['launch'], each: expectNoJump };
    let g = scriptedLaunch(standby(W), trace, 150);
    expect(g.sub.pos.z).toBeGreaterThanOrEqual(COAST_Z + 150);
    g = scriptedReturn(g, trace);
    expect({ ...g.launch, refusal: null }).toEqual(standby(W).launch);
    g = scriptedLaunch(g, trace, 150);
    expect(g.sub.pos.z).toBeGreaterThanOrEqual(COAST_Z + 150);
    expect(trace.modes).toEqual(['launch', 'piloting', 'launch', 'piloting']);
    expect(g.launch).toMatchObject({ clamps: 'released', engines: 'on', cradle: 1 });
  });

  it.each([0, Math.PI])('10c. locked over the cradle at heading %s (a little off), engines off and raised, ends in standby facing yawOut', (yaw) => {
    let g = freeAt(add(CRADLE_DOWN, { x: 1, y: 0.5, z: -1 }), yaw + 0.2, {}, { x: 0, y: 0, z: 1 });
    g = press(g, 'clamps');
    g = press(g, 'cradle');
    expect(g.launch.refusal?.reason).toBe(REFUSAL.stopEngines);
    g = press(g, 'engines');
    g = press(g, 'cradle');
    g = run(g, steps(T.cradleTravel));
    const docked = standby(W, g.combat);
    expect(g.sub).toEqual(docked.sub);
    expect(g.launch).toMatchObject({ cradle: 0, cradleDir: 0, engines: 'off', clamps: 'locked', door: 0 });
  });

  it('10d. lock is refused outside the zone, at or above 3 m/s, and misaligned — and the refused press changes nothing else', () => {
    const DEG = Math.PI / 180;
    const cases: Array<[string, Vec3, number, number, Vec3, string]> = [
      ['4.1 m ahead', add(CRADLE_DOWN, { x: 0, y: 0, z: -4.1 }), 0, 0, { x: 0, y: 0, z: 0 }, REFUSAL.notOver],
      ['4.1 m below', add(CRADLE_DOWN, { x: 0, y: -4.1, z: 0 }), 0, 0, { x: 0, y: 0, z: 0 }, REFUSAL.notOver],
      ['3 m/s', CRADLE_DOWN, 0, 0, { x: 0, y: 0, z: -3 }, REFUSAL.tooFast],
      ['3 m/s sideways', CRADLE_DOWN, Math.PI, 0, { x: 3, y: 0, z: 0 }, REFUSAL.tooFast],
      ['broadside', CRADLE_DOWN, Math.PI / 2, 0, { x: 0, y: 0, z: 0 }, REFUSAL.notLinedUp],
      ['21° off north', CRADLE_DOWN, 21 * DEG, 0, { x: 0, y: 0, z: 0 }, REFUSAL.notLinedUp],
      ['21° off south', CRADLE_DOWN, Math.PI + 21 * DEG, 0, { x: 0, y: 0, z: 0 }, REFUSAL.notLinedUp],
      ['nose 16° down', CRADLE_DOWN, 0, -16 * DEG, { x: 0, y: 0, z: 0 }, REFUSAL.notLinedUp],
    ];
    for (const [name, pos, yaw, pitch, vel, reason] of cases) {
      const g0 = freeAt(pos, yaw, {}, vel);
      const g = { ...g0, sub: { ...g0.sub, pitch } };
      const pressed = stepGame(g, NO_INPUT, 'clamps', DT, W);
      expect(pressed.launch.refusal, name).toEqual({ control: 'clamps', reason, age: 0 });
      expect(pressed.launch.clamps, name).toBe('released');
      expect({ ...pressed, launch: { ...pressed.launch, refusal: null } }, name).toEqual(stepGame(g, NO_INPUT, null, DT, W));
    }
  });

  it('10e. raise is refused while the engines run or start, and the cradle stays down', () => {
    let g = press(freeAt(CRADLE_DOWN, 0), 'clamps');
    expect(g.launch.engines).toBe('on');
    g = press(g, 'cradle');
    expect(g.launch).toMatchObject({ cradle: 1, cradleDir: 0, refusal: { control: 'cradle', reason: REFUSAL.stopEngines } });
    g = press(g, 'engines');
    g = press(g, 'engines'); // restarting
    expect(g.launch.engines).toBe('starting');
    g = press(g, 'cradle');
    expect(g.launch).toMatchObject({ cradle: 1, cradleDir: 0, refusal: { control: 'cradle', reason: REFUSAL.stopEngines } });
  });
});
