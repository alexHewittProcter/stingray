import { describe, expect, it } from 'vitest';
import { NO_INPUT, initialSubState, speedOf, stepSub, type SubInput, type SubState } from './sub';
import { TUNING as T } from './tuning';
import { COAST_Z, FIXED_DT, createWorld } from './world';

const world = createWorld(1964);
const DEG = Math.PI / 180;
const EAST = -Math.PI / 2;
const WEST = Math.PI / 2;
const NORTH = 0;
const SOUTH = Math.PI;

type Controller = SubInput | ((s: SubState, step: number) => SubInput);

/** Steps the real sim for `seconds`, calling `each` after every step. */
function run(start: SubState, control: Controller, seconds: number, each?: (s: SubState, step: number) => void): SubState {
  let s = start;
  const steps = Math.round(seconds / FIXED_DT);
  for (let k = 0; k < steps; k++) {
    const input = typeof control === 'function' ? control(s, k) : control;
    s = stepSub(s, input, FIXED_DT, world);
    each?.(s, k);
  }
  return s;
}

function at(x: number, y: number, z: number, yaw: number, extra: Partial<SubState> = {}): SubState {
  return { pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 }, yaw, pitch: 0, medium: 'submerged', ...extra };
}

const input = (partial: Partial<SubInput>): SubInput => ({ ...NO_INPUT, ...partial });
const FULL = input({ throttle: 1 });
const BOOST = input({ throttle: 1, boost: true });

/** Holds the nose near `pitch` with bang-bang climb input, keeping throttle/boost. */
const holdPitch = (pitch: number, base: SubInput) => (s: SubState) => input({ ...base, pitch: s.pitch < pitch ? 1 : 0 });

// Open water well away from landmarks, trench and edges.
const OPEN = { x: -600, y: -50, z: 400 };

describe('stepSub', () => {
  it('1. full throttle reaches and holds the cruise cap; boost reaches and holds the boost cap; reverse cap holds', () => {
    let peak = 0;
    let s = run(at(OPEN.x, OPEN.y, OPEN.z, EAST), FULL, 1.5, (st) => (peak = Math.max(peak, speedOf(st))));
    expect(speedOf(s)).toBeLessThan(T.cruiseSpeed); // not instant
    s = run(s, FULL, 1, (st) => (peak = Math.max(peak, speedOf(st))));
    expect(speedOf(s)).toBeCloseTo(T.cruiseSpeed, 6); // ≈ 2 s to cruise
    s = run(s, FULL, 5, (st) => (peak = Math.max(peak, speedOf(st))));
    expect(speedOf(s)).toBeCloseTo(T.cruiseSpeed, 6);
    expect(peak).toBeLessThanOrEqual(T.cruiseSpeed + 1e-9);

    let boostPeak = 0;
    s = run(s, BOOST, 6, (st) => (boostPeak = Math.max(boostPeak, speedOf(st))));
    expect(speedOf(s)).toBeCloseTo(T.boostSpeed, 6);
    expect(boostPeak).toBeLessThanOrEqual(T.boostSpeed + 1e-9);

    let reversePeak = 0;
    const r = run(at(OPEN.x, OPEN.y, OPEN.z, EAST), input({ throttle: -1 }), 6, (st) => {
      reversePeak = Math.max(reversePeak, speedOf(st));
    });
    expect(speedOf(r)).toBeCloseTo(T.reverseSpeed, 6);
    expect(reversePeak).toBeLessThanOrEqual(T.reverseSpeed + 1e-9);
    expect(r.pos.x).toBeLessThan(OPEN.x); // facing east, reversing moves west
  });

  it('2. releasing all input: coasts to rest, pitch returns to level, depth stops changing', () => {
    let s = run(at(OPEN.x, OPEN.y, OPEN.z, EAST), FULL, 3);
    s = run(s, input({ throttle: 1, pitch: 1 }), 0.5); // moving and nose up
    expect(s.pitch).toBeGreaterThan(20 * DEG);
    const released = run(s, NO_INPUT, 1.0);
    expect(released.pitch).toBe(0); // level within ≈ 1 s
    expect(speedOf(run(s, NO_INPUT, 2))).toBeGreaterThan(1); // coasting, not stopped dead
    const rested = run(s, NO_INPUT, 3.5);
    expect(speedOf(rested)).toBeLessThan(0.05);
    const later = run(rested, NO_INPUT, 5);
    expect(Math.abs(later.pos.y - rested.pos.y)).toBeLessThan(0.05);
    expect(Math.abs(later.vel.y)).toBeLessThan(1e-3);
  });

  it('3. yaw changes heading at no more than the tuned rate, turning on the spot at rest; slower at boost speed', () => {
    const start = at(OPEN.x, OPEN.y, OPEN.z, EAST);
    let prev = start.yaw;
    let maxStep = 0;
    const spun = run(start, input({ yaw: 1 }), 1, (s) => {
      maxStep = Math.max(maxStep, Math.abs(s.yaw - prev));
      prev = s.yaw;
    });
    expect(maxStep).toBeLessThanOrEqual(T.yawRate * FIXED_DT + 1e-12);
    expect(spun.yaw - start.yaw).toBeCloseTo(T.yawRate * 1, 6); // full rate at rest
    expect(Math.hypot(spun.pos.x - OPEN.x, spun.pos.z - OPEN.z)).toBeLessThan(1e-9); // on the spot

    const fast = run(start, BOOST, 6);
    expect(speedOf(fast)).toBeCloseTo(T.boostSpeed, 3);
    const turned = run(fast, input({ throttle: 1, boost: true, yaw: 1 }), 0.5);
    const boostRate = (turned.yaw - fast.yaw) / 0.5;
    expect(boostRate).toBeLessThan(0.75 * T.yawRate);
    expect(boostRate).toBeGreaterThan(0);
  });

  it('4. pitch is clamped to ±50°', () => {
    let worst = 0;
    const up = run(at(OPEN.x, -150, OPEN.z, EAST), input({ throttle: 1, pitch: 1 }), 3, (s) => {
      worst = Math.max(worst, Math.abs(s.pitch));
    });
    expect(up.pitch).toBeCloseTo(50 * DEG, 12);
    const down = run(at(OPEN.x, -60, OPEN.z, EAST), input({ pitch: -1 }), 3, (s) => {
      worst = Math.max(worst, Math.abs(s.pitch));
    });
    expect(down.pitch).toBeCloseTo(-50 * DEG, 12);
    expect(worst).toBeLessThanOrEqual(50 * DEG + 1e-12);
  });

  it('5. surface running: level near the surface settles awash; a gentle climb settles and never leaps; 30 s never flickers', () => {
    // Level within 3 m of the surface, no pitch input.
    const media = new Set<string>();
    let s = run(at(OPEN.x, -2.5, OPEN.z, EAST), FULL, 1);
    expect(s.medium).toBe('surface');
    s = run(s, BOOST, 30, (st) => {
      media.add(st.medium);
      expect(st.pos.y).toBeGreaterThanOrEqual(-3);
      expect(st.pos.y).toBeLessThanOrEqual(0);
    });
    expect([...media]).toEqual(['surface']);
    expect(s.pos.y).toBeCloseTo(T.surfaceY, 3);
    expect(speedOf(s)).toBeCloseTo(T.boostSpeed, 3); // full speed on the surface

    // A gentle climb (< 6 m/s upward) into the surface.
    let maxRise = 0;
    const seen = new Set<string>();
    let climb = run(at(-1000, -30, 500, EAST), holdPitch(10 * DEG, FULL), 30, (st) => {
      seen.add(st.medium);
      if (st.medium === 'submerged') maxRise = Math.max(maxRise, st.vel.y);
    });
    expect(maxRise).toBeLessThan(T.leapSpeed);
    expect(seen.has('airborne')).toBe(false);
    expect(climb.medium).toBe('surface');
    expect(Math.abs(climb.pos.y - T.surfaceY)).toBeLessThan(0.5);

    // Dive input leaves the surface immediately.
    climb = stepSub(climb, input({ throttle: 1, pitch: -1 }), FIXED_DT, world);
    expect(climb.medium).toBe('submerged');
  });

  it('6. boosted 30° climb from 40 m leaps ≥ 26 m, re-enters submerged keeping ≥ 60 % of its speed', () => {
    let s = at(-700, -40, 600, EAST);
    let entrySpeed = 0;
    let apex = -Infinity;
    let reentrySpeed = 0;
    for (let k = 0; k < 60 * 20 && reentrySpeed === 0; k++) {
      const control = s.medium === 'airborne' ? BOOST : holdPitch(30 * DEG, BOOST)(s);
      const next = stepSub(s, control, FIXED_DT, world);
      if (s.medium === 'submerged' && next.medium === 'airborne') entrySpeed = speedOf(s);
      if (next.medium === 'airborne') apex = Math.max(apex, next.pos.y);
      if (s.medium === 'airborne' && next.medium !== 'airborne') {
        expect(next.medium).toBe('submerged');
        reentrySpeed = speedOf(next);
      }
      s = next;
    }
    expect(entrySpeed).toBeGreaterThan(0);
    expect(apex).toBeGreaterThanOrEqual(26);
    expect(reentrySpeed).toBeGreaterThanOrEqual(0.6 * entrySpeed);
  });

  it('7. driving into the seabed for 10 s never puts the hull below seabedHeight + 4 m and it can climb away', () => {
    const x = 600;
    const z = 400;
    const start = at(x, world.seabedHeight(x, z) + 15, z, WEST);
    let lowest = Infinity;
    let slowest = Infinity;
    const pinned = run(start, input({ throttle: 1, pitch: -1 }), 10, (s, k) => {
      lowest = Math.min(lowest, s.pos.y - (world.seabedHeight(s.pos.x, s.pos.z) + T.hullRadius));
      if (k > 120) slowest = Math.min(slowest, Math.hypot(s.vel.x, s.vel.z));
    });
    expect(lowest).toBeGreaterThanOrEqual(-1e-9);
    expect(pinned.pos.y - world.seabedHeight(pinned.pos.x, pinned.pos.z)).toBeLessThan(T.hullRadius + 1); // really on it
    expect(slowest).toBeGreaterThan(5); // slides, never stopped dead

    const away = run(pinned, input({ throttle: 1, pitch: 1 }), 3);
    expect(away.pos.y - world.seabedHeight(away.pos.x, away.pos.z)).toBeGreaterThan(T.hullRadius + 20);
  });

  it('8. the three open edges, a leap at one, the coast and the shut marine door are never passed', () => {
    const half = world.bounds.halfSize;
    const inBounds = (s: SubState) => {
      expect(Math.abs(s.pos.x)).toBeLessThanOrEqual(half);
      expect(Math.abs(s.pos.z)).toBeLessThanOrEqual(half);
    };
    const pressOn = (start: SubState, isOut: (s: SubState) => void) => run(start, BOOST, 30, isOut);
    const east = pressOn(at(1200, -40, 0, EAST), inBounds);
    const west = pressOn(at(-1200, -40, 0, WEST), inBounds);
    const south = pressOn(at(0, -40, 1200, SOUTH), inBounds);
    // The current turns it back: after 30 s of pressing on, it is out of the current zone, heading inward.
    expect(east.pos.x).toBeLessThan(half - T.edgeZone);
    expect(west.pos.x).toBeGreaterThan(-half + T.edgeZone);
    expect(south.pos.z).toBeLessThan(half - T.edgeZone);

    // A boosted leap aimed off the east edge.
    let flew = false;
    run(at(1250, -40, 300, EAST), (s) => (s.medium === 'airborne' ? BOOST : holdPitch(30 * DEG, BOOST)(s)), 15, (s) => {
      if (s.medium === 'airborne') flew = true;
      inBounds(s);
    });
    expect(flew).toBe(true);

    const faceLimit = COAST_Z + T.hullRadius - 1e-9;
    const neverThroughCoast = (s: SubState) => expect(s.pos.z).toBeGreaterThanOrEqual(faceLimit);
    run(at(400, -40, -1000, NORTH), BOOST, 10, neverThroughCoast); // the cliff
    run(at(0, -40, -1040, NORTH), BOOST, 10, neverThroughCoast); // the door, square in the mouth
    // A leap at the coast: over the clifftop the land is still the limit.
    let leapt = false;
    run(at(-400, -40, -880, NORTH), (s) => (s.medium === 'airborne' ? BOOST : holdPitch(30 * DEG, BOOST)(s)), 15, (s) => {
      if (s.medium === 'airborne') leapt = true;
      neverThroughCoast(s);
    });
    expect(leapt).toBe(true);
  });

  it('11. determinism: two runs of a recorded 60 s input script end in identical state', () => {
    // A scripted minute: cruise, turn, dive, boost, climb hard (leap), surface, reverse.
    const script = (_s: SubState, k: number): SubInput => {
      const t = k * FIXED_DT;
      return {
        throttle: t < 50 ? 1 : -1,
        yaw: Math.sin(t * 0.7) > 0.5 ? 1 : Math.sin(t * 0.7) < -0.5 ? -1 : 0,
        pitch: t < 4 ? -1 : t < 12 ? 0 : t < 15 ? 1 : t < 25 ? 0 : t < 27 ? -1 : 0,
        boost: t > 8 && t < 30,
        fire: k % 30 === 0,
      };
    };
    const a = run(initialSubState(world), script, 60);
    const b = run(initialSubState(world), script, 60);
    const bits = (s: SubState) => [s.pos.x, s.pos.y, s.pos.z, s.vel.x, s.vel.y, s.vel.z, s.yaw, s.pitch];
    bits(a).forEach((v, k) => expect(Object.is(v, bits(b)[k])).toBe(true));
    expect(a.medium).toBe(b.medium);
    expect(a).toEqual(b);
  });
});
