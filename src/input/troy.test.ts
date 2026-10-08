import { describe, expect, it } from 'vitest';
import { toTroyInput, troyPressFor, yawOfView } from './troy';

const keys = (...codes: string[]) => new Set(codes);
const near = (a: { x: number; z: number }, b: { x: number; z: number }) => {
  expect(a.x).toBeCloseTo(b.x, 12);
  expect(a.z).toBeCloseTo(b.z, 12);
};

// M3: W A S D relative to the camera's yaw, rotated into the world frame (+x east, −z north). Camera yaw 0 looks
// north; +yaw turns left, so yaw π/2 looks west, π south, −π/2 east.
const NORTH = { x: 0, z: -1 };
const SOUTH = { x: 0, z: 1 };
const EAST = { x: 1, z: 0 };
const WEST = { x: -1, z: 0 };

describe('toTroyInput (M3)', () => {
  it('is still with nothing held, and with opposing keys', () => {
    expect(toTroyInput(keys(), 0)).toEqual({ move: { x: 0, z: 0 }, use: false });
    expect(toTroyInput(keys('KeyW', 'KeyS'), 1).move).toEqual({ x: 0, z: 0 });
    expect(toTroyInput(keys('KeyA', 'KeyD'), 1).move).toEqual({ x: 0, z: 0 });
  });

  it.each<[string, number, Record<'KeyW' | 'KeyS' | 'KeyA' | 'KeyD', { x: number; z: number }>]>([
    ['north (0, as in tests and ?script=)', 0, { KeyW: NORTH, KeyS: SOUTH, KeyA: WEST, KeyD: EAST }],
    ['west (π/2)', Math.PI / 2, { KeyW: WEST, KeyS: EAST, KeyA: SOUTH, KeyD: NORTH }],
    ['south (π)', Math.PI, { KeyW: SOUTH, KeyS: NORTH, KeyA: EAST, KeyD: WEST }],
    ['east (−π/2)', -Math.PI / 2, { KeyW: EAST, KeyS: WEST, KeyA: NORTH, KeyD: SOUTH }],
  ])('with the camera looking %s: W away from it, S toward it, A to its left, D to its right', (_, yaw, want) => {
    for (const [key, dir] of Object.entries(want)) near(toTroyInput(keys(key), yaw).move, dir);
  });

  it('a diagonal is unit length, between its two keys', () => {
    const m = toTroyInput(keys('KeyW', 'KeyD'), 0).move;
    expect(Math.hypot(m.x, m.z)).toBeCloseTo(1, 12);
    near(m, { x: Math.SQRT1_2, z: -Math.SQRT1_2 });
  });

  it('never sets use: E is a queued press (troyPressFor), not an axis', () => {
    expect(toTroyInput(keys('KeyE'), 0)).toEqual({ move: { x: 0, z: 0 }, use: false });
    expect(troyPressFor('KeyE')).toBe('use');
    expect(['KeyW', 'KeyQ', 'Digit1', 'KeyR'].map(troyPressFor)).toEqual([null, null, null, null]);
  });
});

describe('yawOfView', () => {
  it("reads a camera's forward vector as the sim's yaw, and keeps the fallback looking straight down", () => {
    expect(yawOfView(NORTH)).toBeCloseTo(0, 12);
    expect(yawOfView(WEST)).toBeCloseTo(Math.PI / 2, 12);
    expect(yawOfView(EAST)).toBeCloseTo(-Math.PI / 2, 12);
    expect(Math.abs(yawOfView(SOUTH))).toBeCloseTo(Math.PI, 12);
    expect(yawOfView({ x: 0, z: 0 }, 0.7)).toBe(0.7);
  });

  it('round-trips with the mapping: W walks the way the camera looks', () => {
    for (const yaw of [0, 0.4, 2, -2.5]) {
      const m = toTroyInput(keys('KeyW'), yaw).move;
      expect(yawOfView(m)).toBeCloseTo(yaw, 12);
    }
  });
});
