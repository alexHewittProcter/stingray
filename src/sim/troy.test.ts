import { describe, expect, it } from 'vitest';
import { FLOOR_Y, ROOMS, type Rooms, SEAT } from './rooms';
import { type TroyInput, type TroyState, STAND_STILL, aboard, onFoot, stepTroy, walkable } from './troy';
import { TUNING as T } from './tuning';
import type { Vec3 } from './vec3';
import { FIXED_DT as DT } from './world';

const R = ROOMS;
const DEG = Math.PI / 180;
const go = (x: number, z: number): TroyInput => ({ move: { x, z }, use: false });
const NORTH = go(0, -1);
const at = (x: number, z: number, yaw = 0): TroyState => onFoot({ pos: { x, y: FLOOR_Y, z }, yaw });

function run(t: TroyState, input: TroyInput, seconds: number, rooms: Rooms = R): TroyState {
  let s = t;
  for (let k = 0; k < Math.round(seconds / DT); k++) s = stepTroy(s, input, DT, rooms);
  return s;
}

/** A tiny seeded LCG (Numerical Recipes constants) → [0, 1). The sim and its tests never use Math.random. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// An open test floor: one 20 m room, one prop in the middle.
const OPEN: Rooms = {
  rooms: [{ id: 'controlRoom', min: { x: -10, y: 0, z: -10 }, max: { x: 10, y: 4, z: 10 } }],
  props: [{ min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 1, z: 1 } }],
  chair: { pos: { x: 5, y: 0, z: 5 }, yaw: 0 },
  shaft: [],
  start: { pos: { x: 0, y: 0, z: 5 }, yaw: 0 },
};
const open = (x: number, z: number, yaw = 0): TroyState => onFoot({ pos: { x, y: 0, z }, yaw });

describe('Troy on foot (M2)', () => {
  it('reaches WALK within its acceleration, and stops within its deceleration', () => {
    let t = open(0, 8);
    const rise = Math.ceil(T.walkSpeed / T.walkAccel / DT);
    for (let k = 0; k < rise - 1; k++) t = stepTroy(t, NORTH, DT, OPEN);
    expect(t.speed).toBeLessThan(T.walkSpeed);
    t = stepTroy(t, NORTH, DT, OPEN);
    expect(t.speed).toBeCloseTo(T.walkSpeed, 9);
    t = run(t, NORTH, 0.5, OPEN);
    expect(t.speed).toBe(T.walkSpeed);
    const fall = Math.ceil(T.walkSpeed / T.walkDecel / DT);
    for (let k = 0; k < fall - 1; k++) t = stepTroy(t, STAND_STILL, DT, OPEN);
    expect(t.speed).toBeGreaterThan(0);
    t = stepTroy(t, STAND_STILL, DT, OPEN);
    expect(t.speed).toBe(0);
  });

  it('walks at WALK × |move| and keeps to the floor', () => {
    const t = run(open(-8, 8, Math.PI / 2), go(0.5, 0), 1.5, OPEN); // east, half stick
    expect(t.speed).toBeCloseTo(T.walkSpeed * 0.5, 9);
    expect(t.pos.y).toBe(0);
  });

  it('turns to face his movement rather than strafing, at up to 540°/s, slowing to half while the turn left is over 90°', () => {
    let t = run(open(0, 8), NORTH, 1, OPEN);
    expect(t.yaw).toBeCloseTo(0, 9);
    // Reverse: south. The first step turns 9° and does not move him backwards.
    const before = t.pos;
    t = stepTroy(t, go(0, 1), DT, OPEN);
    expect(Math.abs(t.yaw)).toBeCloseTo(T.walkTurnRate * DT, 9);
    expect(t.pos.z).toBeLessThan(before.z); // still moving north, along his facing
    expect(t.speed).toBeLessThan(T.walkSpeed); // slowing toward half while the turn is over 90°
    // He completes the turn in 180° / 540°/s = ⅓ s, then walks south.
    t = run(t, go(0, 1), 1 / 3, OPEN);
    expect(Math.abs(Math.abs(t.yaw) - Math.PI)).toBeLessThan(1e-9);
    const z = t.pos.z;
    t = run(t, go(0, 1), 0.5, OPEN);
    expect(t.pos.z).toBeGreaterThan(z);
    expect(Math.abs(t.pos.x)).toBeLessThan(1); // the turn is a tight arc, not a pivot
  });

  it('moves only along his facing', () => {
    let t = open(-5, 5, 0);
    for (let k = 0; k < 120; k++) {
      const next = stepTroy(t, go(Math.cos(k / 9), -Math.sin(k / 13)), DT, OPEN);
      const dx = next.pos.x - t.pos.x;
      const dz = next.pos.z - t.pos.z;
      const along = -Math.sin(next.yaw) * dx - Math.cos(next.yaw) * dz;
      expect(Math.hypot(dx, dz)).toBeCloseTo(Math.max(along, 0), 9);
      t = next;
    }
  });

  it('slides along a wall he walks into at an angle', () => {
    // 30° off the north wall's normal, from 1 m short of it: he reaches the wall and carries on west along it.
    let t = open(0, -8, 30 * DEG);
    t = run(t, go(-Math.sin(30 * DEG), -Math.cos(30 * DEG)), 3, OPEN);
    expect(t.pos.z).toBeCloseTo(-10 + T.troyRadius, 9);
    const x = t.pos.x;
    t = run(t, go(-Math.sin(30 * DEG), -Math.cos(30 * DEG)), 1, OPEN);
    expect(t.pos.z).toBeCloseTo(-10 + T.troyRadius, 9);
    expect(t.pos.x).toBeLessThan(x - 1);
  });

  it('is pushed out of a prop, never through it', () => {
    let t = open(0, 4, 0); // facing north, the prop 3 m ahead
    for (let k = 0; k < 120; k++) {
      t = stepTroy(t, NORTH, DT, OPEN);
      expect(walkable(t.pos, OPEN)).toBe(true);
    }
    expect(t.pos.z).toBeGreaterThanOrEqual(1 + T.troyRadius - 1e-9);
  });

  it('advances gait with distance walked, wrapping at 2π', () => {
    let t = open(-8, 8, -Math.PI / 2);
    let wraps = 0;
    for (let k = 0; k < 300; k++) {
      const next = stepTroy(t, go(1, 0), DT, OPEN);
      expect(next.gait).toBeGreaterThanOrEqual(0);
      expect(next.gait).toBeLessThan(2 * Math.PI);
      if (next.gait < t.gait) wraps += 1;
      t = next;
    }
    // ≈ 15 m walked at 1.4 m a cycle (the wall stops him at x = 9.6, but gait follows speed).
    expect(wraps).toBeGreaterThanOrEqual(9);
    const still = run(t, STAND_STILL, 1, OPEN);
    expect(run(still, STAND_STILL, 1, OPEN).gait).toBe(still.gait);
  });

  it('is unchanged when riding or aboard', () => {
    const riding: TroyState = { ...at(R.chair.pos.x, R.chair.pos.z), where: 'riding', ride: 0.3 };
    const seated = aboard(SEAT);
    for (const t of [riding, seated]) {
      expect(stepTroy(t, NORTH, DT, R)).toBe(t);
      expect(run(t, go(1, 1), 2)).toBe(t);
    }
  });

  // Phase 4 (D2): the control room is the only room; it runs three times the seeds the three rooms shared, so the walks
  // still find the station's dais and chairs and the re-laid furniture.
  it.each(['controlRoom'] as const)(
    'cannot leave the rooms or enter a prop from the %s under 10 s of seeded random input',
    (id) => {
      const rooms = R.rooms.filter((r) => r.id === id);
      for (let seed = 1; seed <= 18; seed++) {
        const rand = lcg(seed * 7919 + id.length);
        const room = rooms[Math.floor(rand() * rooms.length)]!;
        let t: TroyState | null = null;
        while (!t) {
          const p: Vec3 = {
            x: room.min.x + rand() * (room.max.x - room.min.x), y: FLOOR_Y, z: room.min.z + rand() * (room.max.z - room.min.z),
          };
          if (walkable(p, R)) t = onFoot({ pos: p, yaw: rand() * 2 * Math.PI });
        }
        let input = STAND_STILL;
        for (let k = 0; k < 600; k++) {
          if (k % 20 === 0) {
            const a = rand() * 2 * Math.PI;
            const m = rand() < 0.15 ? 0 : 0.3 + rand() * 0.7;
            input = go(Math.cos(a) * m, Math.sin(a) * m);
          }
          const next = stepTroy(t, input, DT, R);
          expect(walkable(next.pos, R), `seed ${seed} step ${k}`).toBe(true);
          // No step moves him further than his speed allows.
          expect(Math.hypot(next.pos.x - t.pos.x, next.pos.z - t.pos.z)).toBeLessThanOrEqual(T.walkSpeed * DT + 1e-9);
          t = next;
        }
      }
    },
  );
});
