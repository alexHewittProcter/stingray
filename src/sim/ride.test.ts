import { describe, expect, it } from 'vitest';
import { Game } from '../game/game';
import { sessionMode } from '../game/mode';
import { type GameState, LAUNCH_CONTROLS, type Press, REFUSAL, stepGame } from './launch';
import { RIDE_SECONDS, chairYaw, legsOf, rideProgressAt, rideTimeAt, shaftPoint, stepRide } from './ride';
import { ROOMS, SEAT, shaftLength } from './rooms';
import { controlRoom, stepSession } from './session';
import { NO_INPUT, type SubInput } from './sub';
import { STAND_STILL, type TroyInput, aboard, onFoot } from './troy';
import { TUNING as T } from './tuning';
import { FIXED_DT as DT, createWorld } from './world';

// Phase 3, M6 (down): the sit, the descent's timetable and path, the lock-in — and that the ride touches nothing but
// Troy (M6 "Lock-in", M7). The way back up (M6b) is T9's.

const W = createWorld(1964);
const YAW_OUT = W.marineville.interior.cradle.yawOut;
const FULL: SubInput = { throttle: 1, yaw: 0.5, pitch: 0.3, boost: true, fire: true };
const WALK_NORTH: TroyInput = { move: { x: 0, z: -1 }, use: false };
const step = (g: GameState, p: Press | null = null, i: SubInput = NO_INPUT, t: TroyInput = STAND_STILL) =>
  stepSession(g, i, t, p, DT, W, ROOMS);

/** Troy on foot 1 m in front of his chair, facing it — where M5's prompt shows. */
const atChair = (): GameState => {
  const c = ROOMS.chair;
  return { ...controlRoom(W, ROOMS), troy: onFoot({ pos: { x: c.pos.x, y: c.pos.y, z: c.pos.z + 1.5 }, yaw: c.yaw }) };
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

describe('the timetable (M6: RIDE_SECONDS, 1.5 s ease-in, 1 s ease-out, constant between)', () => {
  it('runs 0 → 1 over RIDE_SECONDS, and its inverse agrees', () => {
    expect(RIDE_SECONDS).toBe(10);
    expect(rideProgressAt(0)).toBe(0);
    expect(rideProgressAt(RIDE_SECONDS)).toBe(1);
    for (let t = 0; t <= RIDE_SECONDS; t += 0.37) expect(rideTimeAt(rideProgressAt(t))).toBeCloseTo(t, 9);
  });

  it('eases in over the first 1.5 s and out over the last 1 s, with a constant speed between (smoothstep slices)', () => {
    const v = (t: number) => (rideProgressAt(t + 1e-4) - rideProgressAt(t - 1e-4)) / 2e-4;
    const cruise = v(5);
    expect(v(1e-4)).toBeLessThan(cruise * 1e-3);
    for (const t of [1.6, 3, 5, 7, 8.9]) expect(v(t)).toBeCloseTo(cruise, 6);
    // Smoothstep inside the slices: half speed half way through each.
    expect(v(T.rideEaseIn / 2) / cruise).toBeCloseTo(0.5, 4);
    expect(v(RIDE_SECONDS - T.rideEaseOut / 2) / cruise).toBeCloseTo(0.5, 4);
    expect(v(RIDE_SECONDS - 1e-4)).toBeLessThan(cruise * 1e-3);
    // ≈ 22 m/s over the ≈ 210 m shaft (M6).
    expect(cruise * shaftLength(ROOMS.shaft)).toBeGreaterThan(20);
    expect(cruise * shaftLength(ROOMS.shaft)).toBeLessThan(26);
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

describe('the path (M6: by arc length; the chair faces along it)', () => {
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

  it("faces along a level leg, turns over a vertical one, and lands facing the sub's yaw (π)", () => {
    const [leg1, leg2, leg3] = legsOf(ROOMS.shaft);
    const yawAt = (s: number) => chairYaw(ROOMS.shaft, s / L, ROOMS.chair.yaw + Math.PI, YAW_OUT);
    const same = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 1e-9;
    // The top: the seat's own facing. The level run north: heading 0 (north). The seat: the sub's yaw.
    expect(same(yawAt(0), ROOMS.chair.yaw + Math.PI)).toBe(true);
    const north = Math.atan2(-(leg2!.to.x - leg2!.from.x), -(leg2!.to.z - leg2!.from.z));
    expect(same(north, 0)).toBe(true);
    for (let s = leg2!.start; s <= leg2!.start + leg2!.length; s += 7) expect(same(yawAt(s), north)).toBe(true);
    expect(same(yawAt(leg1!.length), north)).toBe(true); // turned by the foot of leg 1
    expect(same(yawAt(leg3!.start), north)).toBe(true);
    expect(same(yawAt(L), YAW_OUT)).toBe(true);
    // The turn is continuous: no step turns the chair more than ≈ 9° (leg 3's half-turn takes its ≈ 1.1 s).
    const states = ride();
    for (let k = 2; k < states.length; k++) {
      const a = states[k - 1]!.troy.yaw;
      const b = states[k]!.troy.yaw;
      expect(Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)))).toBeLessThan(0.15);
    }
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

  it('riding up (M6b) is left as it is — T9 builds it', () => {
    const up = { ...aboard(SEAT), where: 'riding' as const, rideDir: 'up' as const, ride: 1 };
    expect(stepRide(up, DT, ROOMS, YAW_OUT)).toBe(up);
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
