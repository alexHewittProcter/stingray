import { describe, expect, it } from 'vitest';
import { Game } from '../game/game';
import { sessionMode } from '../game/mode';
import { type GameState, LAUNCH_CONTROLS, type Press, REFUSAL, oceanStart, standby, stepGame } from './launch';
import { RIDE_SECONDS, chairYaw, chairYawUp, legsOf, rideProgressAt, rideTimeAt, shaftPoint, standPoint, stepRide } from './ride';
import { ROOMS, SEAT, shaftLength } from './rooms';
import { controlRoom, stepSession } from './session';
import { NO_INPUT, type SubInput } from './sub';
import { STAND_STILL, type TroyInput, aboard, onFoot, walkable } from './troy';
import { TUNING as T } from './tuning';
import { FIXED_DT as DT, createWorld } from './world';

// Phase 3, M6 (down): the sit, the descent's timetable and path, the lock-in — and that the ride touches nothing but
// Troy (M6 "Lock-in", M7); and the way back up (M6b).

const W = createWorld(1964);
const YAW_OUT = W.marineville.interior.cradle.yawOut;
const FULL: SubInput = { throttle: 1, yaw: 0.5, pitch: 0.3, boost: true, fire: true };
const WALK_NORTH: TroyInput = { move: { x: 0, z: -1 }, use: false };
const step = (g: GameState, p: Press | null = null, i: SubInput = NO_INPUT, t: TroyInput = STAND_STILL) =>
  stepSession(g, i, t, p, DT, W, ROOMS);

/** Troy on foot 1.6 m in front of his chair (south of it, phase 4 D2), facing it — where M5's prompt shows. */
const atChair = (): GameState => {
  const c = ROOMS.chair;
  return { ...controlRoom(W, ROOMS), troy: onFoot({ pos: { x: c.pos.x, y: c.pos.y, z: c.pos.z + 1.6 }, yaw: c.yaw }) };
};

/** Sit, then step until Troy is aboard (or a limit): the states along the way, the sit's included. */
function ride(from: GameState = atChair(), each: (g: GameState) => [Press | null, SubInput, TroyInput] = () => [null, NO_INPUT, STAND_STILL]) {
  const states: GameState[] = [];
  let g = step(from, 'use');
  states.push(g);
  for (let k = 0; k < 2 * RIDE_SECONDS / DT && g.troy.where === 'riding'; k++) {
    const [p, i, t] = each(g);
    g = step(g, p, i, t);
    states.push(g);
  }
  return states;
}

describe('the sit (M6)', () => {
  it("'use' at the chair: riding down from shaft[0], ride 0, facing the way the seat faces; the sub not touched", () => {
    const g = atChair();
    const sat = step(g, 'use');
    expect(sat.troy).toMatchObject({ where: 'riding', rideDir: 'down', ride: 0, pos: ROOMS.shaft[0], speed: 0 });
    expect(sat.troy.yaw).toBeCloseTo(ROOMS.chair.yaw + Math.PI, 12);
    expect(sat.sub).toEqual(g.sub);
    expect(sat.launch).toEqual(g.launch);
    expect(sessionMode(sat)).toBe('transport');
  });

  it("a use elsewhere does not sit him (the control room's start)", () => {
    expect(step(controlRoom(W, ROOMS), 'use').troy.where).toBe('onFoot');
  });
});

describe('the timetable (M6; phase 4 D4: RIDE_SECONDS 6, 1 s ease-in, 1 s ease-out, constant between)', () => {
  it('runs 0 → 1 over RIDE_SECONDS, and its inverse agrees', () => {
    expect(RIDE_SECONDS).toBe(6);
    expect(T.rideEaseIn).toBe(1);
    expect(T.rideEaseOut).toBe(1);
    expect(rideProgressAt(0)).toBe(0);
    expect(rideProgressAt(RIDE_SECONDS)).toBe(1);
    for (let t = 0; t <= RIDE_SECONDS; t += 0.37) expect(rideTimeAt(rideProgressAt(t))).toBeCloseTo(t, 9);
  });

  it('eases in over the first slice and out over the last, with a constant speed between (smoothstep slices)', () => {
    const v = (t: number) => (rideProgressAt(t + 1e-4) - rideProgressAt(t - 1e-4)) / 2e-4;
    const cruise = v(RIDE_SECONDS / 2);
    expect(v(1e-4)).toBeLessThan(cruise * 1e-3);
    for (const t of [T.rideEaseIn + 0.1, 2, 3, 4, RIDE_SECONDS - T.rideEaseOut - 0.1]) expect(v(t)).toBeCloseTo(cruise, 6);
    // Smoothstep inside the slices: half speed half way through each.
    expect(v(T.rideEaseIn / 2) / cruise).toBeCloseTo(0.5, 4);
    expect(v(RIDE_SECONDS - T.rideEaseOut / 2) / cruise).toBeCloseTo(0.5, 4);
    expect(v(RIDE_SECONDS - 1e-4)).toBeLessThan(cruise * 1e-3);
    // D4: ≈ 14 m/s on average over the ≈ 84 m shaft — ≈ 17 m/s at cruise.
    expect(shaftLength(ROOMS.shaft) / RIDE_SECONDS).toBeGreaterThan(12);
    expect(shaftLength(ROOMS.shaft) / RIDE_SECONDS).toBeLessThan(16);
    expect(cruise * shaftLength(ROOMS.shaft)).toBeGreaterThan(15);
    expect(cruise * shaftLength(ROOMS.shaft)).toBeLessThan(19);
    // Monotonic.
    for (let t = 0; t < RIDE_SECONDS; t += 0.05) expect(rideProgressAt(t + 0.05)).toBeGreaterThanOrEqual(rideProgressAt(t));
  });

  it('the descent takes RIDE_SECONDS, ± one step, from the sit to the lock-in', () => {
    const states = ride();
    expect(states.at(-1)!.troy.where).toBe('aboard');
    const steps = states.length - 1; // the steps after the sit's
    expect(Math.abs(steps * DT - RIDE_SECONDS)).toBeLessThanOrEqual(DT + 1e-9);
    // Each step's ride is the timetable at that step's time.
    states.slice(1, -1).forEach((g, k) => expect(g.troy.ride).toBeCloseTo(rideProgressAt((k + 1) * DT), 9));
  });
});

describe('the path (M6: by arc length; phase 4 D4: one vertical leg)', () => {
  const L = shaftLength(ROOMS.shaft);

  it('pos is the shaft polyline sampled at ride by arc length', () => {
    expect(shaftPoint(ROOMS.shaft, 0)).toEqual(ROOMS.shaft[0]);
    expect(shaftPoint(ROOMS.shaft, 1)).toEqual(SEAT);
    for (const leg of legsOf(ROOMS.shaft)) {
      expect(shaftPoint(ROOMS.shaft, leg.start / L)).toMatchObject({ x: expect.closeTo(leg.from.x, 9), y: expect.closeTo(leg.from.y, 9), z: expect.closeTo(leg.from.z, 9) });
    }
    // Equal steps of ride are equal distances along the path, across the corners too.
    const d = (a: number, b: number) => {
      const p = shaftPoint(ROOMS.shaft, a);
      const q = shaftPoint(ROOMS.shaft, b);
      return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    };
    for (let r = 0.01; r < 0.99; r += 0.03) {
      const corner = legsOf(ROOMS.shaft).some((leg) => leg.start / L > r && leg.start / L < r + 0.001);
      if (!corner) expect(d(r, r + 0.001)).toBeCloseTo(L * 0.001, 6);
    }
    for (const g of ride()) {
      if (g.troy.where === 'riding') expect(g.troy.pos).toEqual(shaftPoint(ROOMS.shaft, g.troy.ride));
    }
  });

  it("D4: down the one vertical leg the chair keeps the seat's yaw (π, facing the windows) and lands facing the sub's", () => {
    const top = ROOMS.chair.yaw + Math.PI;
    const same = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 1e-9;
    expect(same(top, YAW_OUT)).toBe(true);
    for (let r = 0; r <= 1; r += 0.01) expect(same(chairYaw(ROOMS.shaft, r, top, YAW_OUT), top)).toBe(true);
    for (const g of ride()) expect(same(g.troy.yaw, YAW_OUT)).toBe(true);
    // chairYaw stays general: a vertical leg between different start and end yaws still turns, continuously.
    expect(same(chairYaw(ROOMS.shaft, 0.5, 0, Math.PI / 2), Math.PI / 4)).toBe(true);
  });

  it('legsOf, shaftPoint and chairYaw still take any polyline (a level leg between two drops faces along itself)', () => {
    const bent = [{ x: 0, y: 10, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -20 }, { x: 0, y: -10, z: -20 }];
    const legs = legsOf(bent);
    expect(legs.map((l) => l.length)).toEqual([10, 20, 10]);
    expect(legs.map((l) => l.start)).toEqual([0, 10, 30]);
    expect(shaftPoint(bent, 0.5)).toEqual({ x: 0, y: 0, z: -10 });
    const same = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 1e-9;
    expect(same(chairYaw(bent, 0.5, Math.PI, Math.PI), 0)).toBe(true); // the level run north: heading 0
    expect(same(chairYaw(bent, 10 / 40, Math.PI, Math.PI), 0)).toBe(true); // turned by the foot of the first drop
    expect(same(chairYaw(bent, 1, Math.PI, Math.PI), Math.PI)).toBe(true); // and lands facing the end yaw
  });
});

describe('the lock-in (M6) — and the ride touches nothing but Troy (M7)', () => {
  it('ends aboard, in the seat, facing the sub, as phase 2 standby has Troy; the mode goes transport → launch with no flicker', () => {
    const states = ride();
    const last = states.at(-1)!;
    expect(last.troy).toEqual(aboard(SEAT));
    expect(sessionMode(states.at(-2)!)).toBe('transport');
    expect(sessionMode(last)).toBe('launch');
  });

  it('launch and sub are deep-equal before and after the whole ride; combat equals a parallel run with no ride', () => {
    const start = atChair();
    // Whatever is held or pressed during the ride: the sub's input is NO_INPUT, launch presses are refused.
    const states = ride(start, (g) => [g.combat.t % 1 < DT ? 'cradle' : null, FULL, WALK_NORTH]);
    const last = states.at(-1)!;
    expect(last.sub).toEqual(start.sub);
    expect({ ...last.launch, refusal: null }).toEqual(start.launch);
    let parallel = start;
    for (let k = 0; k < states.length; k++) parallel = stepGame(parallel, NO_INPUT, null, DT, W);
    expect(last.combat).toEqual(parallel.combat);
  });

  it("launch presses are refused 'Not aboard' before lock-in", () => {
    const sat = step(atChair(), 'use');
    let g = sat;
    for (let k = 0; k < 120; k++) g = step(g);
    for (const control of LAUNCH_CONTROLS) {
      const pressed = step(g, control);
      expect(pressed.launch.refusal).toEqual({ control, reason: REFUSAL.notAboard, age: 0 });
      expect(pressed.launch.cradleDir).toBe(0);
    }
  });

  it("after lock-in the first '1' (cradle) press lowers the cradle exactly as phase 2's does from standby", () => {
    const last = ride().at(-1)!;
    const pressed = step(last, 'cradle');
    expect(pressed.launch.cradleDir).toBe(1);
    expect(pressed.launch.refusal).toBeNull();
    expect(pressed).toEqual(stepGame(last, NO_INPUT, 'cradle', DT, W));
  });

  it('stepRide leaves Troy as he is unless he is riding', () => {
    for (const t of [aboard(SEAT), onFoot(ROOMS.start)]) expect(stepRide(t, DT, ROOMS, YAW_OUT)).toBe(t);
  });
});

describe("R (M3, M9) from riding", () => {
  it('gives the start state: Troy standing in the control room, the sub in standby, combat kept', () => {
    const states = ride();
    const mid = states[Math.floor(states.length / 2)]!;
    expect(mid.troy.where).toBe('riding');
    const game = new Game(W, mid);
    game.step(new Set(['KeyR']), DT);
    const combat = game.state.combat;
    // R jumps, then that same step runs: compare with a step from the control room keeping the riding state's combat.
    expect(game.state).toEqual(step(controlRoom(W, ROOMS, mid.combat)));
    expect(combat.t).toBeCloseTo(mid.combat.t + DT, 12);
  });
});

// ---- M6b: the way back up ----

/** Press 'leave' aboard the docked standby sub, then step until Troy is on foot (or a limit): the states along the way. */
function ascent(from: GameState = standby(W), each: (g: GameState) => [Press | null, SubInput, TroyInput] = () => [null, NO_INPUT, STAND_STILL]) {
  const states: GameState[] = [];
  let g = step(from, 'leave');
  states.push(g);
  for (let k = 0; k < 2 * RIDE_SECONDS / DT && g.troy.where === 'riding'; k++) {
    const [p, i, t] = each(g);
    g = step(g, p, i, t);
    states.push(g);
  }
  return states;
}

const same = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 1e-9;

describe("'leave' (M6b: refused 'Dock first' unless docked and raised)", () => {
  const refused = (g: GameState) => {
    const next = step(g, 'leave');
    expect(next.launch.refusal).toEqual({ control: 'leave', reason: REFUSAL.notDocked, age: 0 });
    expect(next.troy.where).toBe(g.troy.where);
    expect(next.sub).toEqual(step(g).sub);
  };

  it('is accepted aboard the docked, raised sub: riding up from the seat, ride 1, still; the sub not touched', () => {
    const g = standby(W);
    const left = step(g, 'leave');
    expect(left.troy).toMatchObject({ where: 'riding', rideDir: 'up', ride: 1, pos: SEAT, speed: 0 });
    expect(left.launch.refusal).toBeNull();
    expect(left.sub).toEqual(g.sub);
    expect(left.launch).toEqual(g.launch);
    expect(sessionMode(left)).toBe('transport');
  });

  it('is refused with the clamps released, the cradle lowered, the cradle moving, and at sea', () => {
    // The cradle moving (lowering), then lowered and still, then the engines on and the clamps released.
    let g = step(standby(W), 'cradle');
    expect(g.launch.cradleDir).toBe(1);
    refused(g);
    while (g.launch.cradleDir !== 0) g = step(g);
    expect(g.launch.cradle).toBe(1);
    refused(g);
    g = step(g, 'engines');
    for (let k = 0; k < 3 / DT; k++) g = step(g);
    g = step(g, 'clamps');
    expect(g.launch.clamps).toBe('released');
    refused(g);
    refused(oceanStart(W));
    // Raising again: the cradle moving up.
    const raising = { ...standby(W), launch: { ...standby(W).launch, cradle: 0.5, cradleDir: -1 as const } };
    refused(raising);
  });

  it('is refused off the sub: on foot, or riding', () => {
    refused(controlRoom(W, ROOMS));
    refused(ride().at(5)!);
    refused(ascent().at(5)!);
  });
});

describe('the ascent (M6b: back to 0 over the same RIDE_SECONDS, facing up, standing up in front of the chair)', () => {
  it('takes RIDE_SECONDS, ± one step, from the leave to standing up', () => {
    const states = ascent();
    expect(states.at(-1)!.troy.where).toBe('onFoot');
    const steps = states.length - 1;
    expect(Math.abs(steps * DT - RIDE_SECONDS)).toBeLessThanOrEqual(DT + 1e-9);
  });

  it('runs the polyline backwards: k steps in, the chair is where the descent has it RIDE_SECONDS − k·DT in', () => {
    const states = ascent();
    states.slice(1, -1).forEach((g, k) => {
      expect(g.troy.where).toBe('riding');
      expect(g.troy.ride).toBeCloseTo(rideProgressAt(RIDE_SECONDS - (k + 1) * DT), 9);
      expect(g.troy.pos).toEqual(shaftPoint(ROOMS.shaft, g.troy.ride));
    });
    // Monotonic up the shaft; eases in at the seat and out at the top (each slice's first step covers next to nothing).
    for (let k = 2; k < states.length - 1; k++) expect(states[k]!.troy.ride).toBeLessThan(states[k - 1]!.troy.ride);
    const rides = states.slice(0, -1).map((g) => g.troy.ride);
    const mid = rides[Math.floor(rides.length / 2)]! - rides[Math.floor(rides.length / 2) + 1]!;
    expect(rides[0]! - rides[1]!).toBeLessThan(mid * 0.05);
    expect(rides.at(-2)! - rides.at(-1)!).toBeLessThan(mid * 0.05);
  });

  it("D4: faces the windows all the way up (the seat's yaw, π), no turn", () => {
    const top = ROOMS.chair.yaw + Math.PI;
    for (let r = 0; r <= 1; r += 0.01) expect(same(chairYawUp(ROOMS.shaft, r, top, YAW_OUT), top)).toBe(true);
    for (const g of ascent()) expect(same(g.troy.yaw, top)).toBe(true);
  });

  it('lands on foot at the walkable point in front of the chair, facing chair.yaw + π, still', () => {
    const last = ascent().at(-1)!;
    const c = ROOMS.chair;
    const p = standPoint(ROOMS);
    expect(last.troy).toEqual(onFoot({ pos: p, yaw: last.troy.yaw }));
    expect(same(last.troy.yaw, c.yaw + Math.PI)).toBe(true);
    expect(walkable(p, ROOMS)).toBe(true);
    // In front of the chair (along the way its seat faces), not beside it, and within M5's reach of it.
    const out = { x: -Math.sin(c.yaw + Math.PI), z: -Math.cos(c.yaw + Math.PI) };
    const d = { x: p.x - c.pos.x, z: p.z - c.pos.z };
    expect(d.x * out.z - d.z * out.x).toBeCloseTo(0, 9);
    expect(d.x * out.x + d.z * out.z).toBeGreaterThan(1);
    expect(Math.hypot(d.x, d.z)).toBeLessThan(2.2);
    expect(p.y).toBe(c.pos.y);
    expect(sessionMode(last)).toBe('onFoot');
    // A still step on foot leaves him where he stood up (no push out of a prop).
    expect(step(last).troy.pos).toEqual(p);
  });

  it('sub and launch are deep-equal before and after the whole ascent; combat equals a parallel run with no ride', () => {
    const start = standby(W);
    const states = ascent(start, (g) => [g.combat.t % 1 < DT ? 'cradle' : g.combat.t % 1 < 2 * DT ? 'leave' : null, FULL, WALK_NORTH]);
    for (const g of states) {
      expect(g.sub).toEqual(start.sub);
      expect({ ...g.launch, refusal: null }).toEqual(start.launch);
    }
    let parallel = start;
    for (let k = 0; k < states.length; k++) parallel = stepGame(parallel, NO_INPUT, null, DT, W);
    expect(states.at(-1)!.combat).toEqual(parallel.combat);
  });

  it("R from the ascent gives the start state", () => {
    const states = ascent();
    const mid = states[Math.floor(states.length / 2)]!;
    expect(mid.troy).toMatchObject({ where: 'riding', rideDir: 'up' });
    const game = new Game(W, mid);
    game.step(new Set(['KeyR']), DT);
    expect(game.state).toEqual(step(controlRoom(W, ROOMS, mid.combat)));
  });

  it('the loop repeats: turned back to the chair after standing up, use sits him again and he rides down to lock in', () => {
    let g = ascent().at(-1)!;
    // Turn round toward the chair (north): he faces away from it standing up, and M5 wants it within 60° of his facing.
    for (let k = 0; k < 30 && !same(g.troy.yaw, ROOMS.chair.yaw); k++) g = step(g, null, NO_INPUT, WALK_NORTH);
    for (let k = 0; k < 60; k++) g = step(g);
    const states = ride(g);
    expect(states[0]!.troy).toMatchObject({ where: 'riding', rideDir: 'down', ride: 0 });
    expect(states.at(-1)!.troy).toEqual(aboard(SEAT));
    // And back up again.
    expect(ascent(states.at(-1)!).at(-1)!.troy.where).toBe('onFoot');
  });
});
