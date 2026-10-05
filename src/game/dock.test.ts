import { describe, expect, it } from 'vitest';
import { type GameState, oceanStart, refusalFor, released, standby, stepGame } from '../sim/launch';
import { NO_INPUT, type SubInput } from '../sim/sub';
import { TUNING as T } from '../sim/tuning';
import type { Vec3 } from '../sim/vec3';
import { FIXED_DT as DT, createWorld } from '../sim/world';
import { DOCK_GUIDE_RANGE, dockView } from './dock';
import type { PanelMemory } from './panel';

const W = createWorld(1964);
const I = W.marineville.interior;
const BERTH: Vec3 = { x: I.cradle.pos.x, y: I.cradle.loweredY, z: I.cradle.pos.z };
const HOME: PanelMemory = { shown: 'launch', trip: 'home', launched: true };
const DEG = Math.PI / 180;

function free(offset: Partial<Vec3>, yaw: number, vel: Partial<Vec3> = {}, pitch = 0): GameState {
  const g = oceanStart(W);
  return {
    ...g,
    sub: {
      pos: { x: BERTH.x + (offset.x ?? 0), y: BERTH.y + (offset.y ?? 0), z: BERTH.z + (offset.z ?? 0) },
      vel: { x: vel.x ?? 0, y: vel.y ?? 0, z: vel.z ?? 0 },
      yaw,
      pitch,
      medium: 'submerged',
    },
    launch: released({ door: 0, doorDir: 0 }),
  };
}

describe('dock guidance (L6, T6)', () => {
  it('shows only on the way home, released, in launch presentation, within range of the cradle', () => {
    const g = free({ z: 20 }, 0);
    expect(dockView(g, HOME, I)).not.toBeNull();
    expect(dockView(g, { ...HOME, trip: 'out' }, I)).toBeNull(); // just released on the way out
    expect(dockView(g, { ...HOME, shown: 'piloting' }, I)).toBeNull();
    expect(dockView({ ...g, launch: { ...g.launch, clamps: 'locked' } }, HOME, I)).toBeNull();
    expect(dockView(free({ z: DOCK_GUIDE_RANGE - 1 }, 0), HOME, I)).not.toBeNull();
    expect(dockView(free({ z: DOCK_GUIDE_RANGE + 1 }, 0), HOME, I)).toBeNull();
    expect(dockView(standby(W), HOME, I)).toBeNull();
  });

  it('is ready — and says press 3 — exactly when the sim would accept the lock, across the zone and its edges', () => {
    let checked = 0;
    let ready = 0;
    for (const dz of [-5, -4.2, -3.9, -2, 0, 2, 3.9, 4.2, 5]) {
      for (const dy of [-4.2, -2.5, 0, 2.5, 4.2]) {
        for (const speed of [0, 2.9, 3.1]) {
          for (const yaw of [0, 19 * DEG, 21 * DEG, Math.PI, Math.PI - 19 * DEG, Math.PI + 25 * DEG, Math.PI / 2]) {
            for (const pitch of [0, 14 * DEG, -16 * DEG]) {
              const g = free({ z: dz, y: dy, x: 0.5 }, yaw, { z: -speed }, pitch);
              const v = dockView(g, HOME, I)!;
              const accepted = refusalFor('clamps', g.launch, g.sub, I) === null;
              expect(v.ready).toBe(accepted);
              expect(v.hint === 'PRESS 3 — LOCK THE CLAMPS').toBe(accepted);
              expect(v.ready).toBe(v.over && v.slow && v.lined);
              checked += 1;
              if (accepted) ready += 1;
            }
          }
        }
      }
    }
    expect(ready).toBeGreaterThan(50);
    expect(checked - ready).toBeGreaterThan(1000);
  });

  it('places the cradle in the craft frame — ahead, starboard, above — and the berth turned to the nearer axis', () => {
    // Facing north 10 m south of the cradle, 3 m west of the axis and 2 m low: the cradle is ahead, to starboard, above.
    let v = dockView(free({ z: 10, x: -3, y: -2 }, 0), HOME, I)!;
    expect(v.berth.ahead).toBeCloseTo(10, 9);
    expect(v.berth.right).toBeCloseTo(3, 9);
    expect(v.berth.up).toBeCloseTo(2, 9);
    expect(v.berthTurn).toBeCloseTo(0, 9);
    // Facing south from north of the cradle: still ahead; west of the axis is now to starboard... of a south-facing craft, port.
    v = dockView(free({ z: -10, x: -3 }, Math.PI), HOME, I)!;
    expect(v.berth.ahead).toBeCloseTo(10, 9);
    expect(v.berth.right).toBeCloseTo(-3, 9);
    // 30° left of north: the nearer axis direction is north, 30° clockwise of the nose — a turn right.
    v = dockView(free({ z: 2 }, 30 * DEG), HOME, I)!;
    expect(v.berthTurn).toBeCloseTo(-30 * DEG, 9);
    expect(v.alignDegrees).toBeCloseTo(30, 9);
    expect(v.hint).toBe('LINE UP — TURN RIGHT (D) 30°');
    // And D (yaw < 0) does reduce it.
    let g = free({ z: 2 }, 30 * DEG);
    for (let k = 0; k < 30; k++) g = stepGame(g, { ...NO_INPUT, yaw: -1 }, null, DT, W);
    expect(dockView(g, HOME, I)!.alignDegrees).toBeLessThan(30);
    // The lock ring at the craft's height: the full 4 m when level with the cradle, none when 4 m off it.
    expect(dockView(free({ z: 10 }, 0), HOME, I)!.ringRadius).toBeCloseTo(T.lockRadius, 9);
    expect(dockView(free({ z: 10, y: 4 }, 0), HOME, I)!.ringRadius).toBe(0);
  });

  it('predicts where the craft comes to rest if the pilot lets go — as the sim then does', () => {
    for (const [offset, yaw, vel] of [
      [{ z: 25 }, 0, { z: -15 }],
      [{ z: 12, x: 2 }, 0.1, { z: -8, x: 1.5 }],
      [{ z: -14 }, Math.PI, { z: 6 }],
      [{ z: 3 }, 0, { z: 4 }], // backing away, astern
    ] as Array<[Partial<Vec3>, number, Partial<Vec3>]>) {
      let g = free(offset, yaw, vel);
      const v = dockView(g, HOME, I)!;
      for (let k = 0; k < 300; k++) g = stepGame(g, NO_INPUT, null, DT, W);
      const after = dockView(g, HOME, I)!;
      expect(after.speed).toBeLessThan(1e-6);
      // The prediction is in the frame at the moment of letting go; the craft does not turn while coasting.
      expect(Math.abs(after.berth.ahead - v.coast.ahead)).toBeLessThan(0.3);
      expect(Math.abs(after.berth.right - v.coast.right)).toBeLessThan(0.3);
    }
  });

  it('says the next thing to do, in L3 order: get over it, slow down, line up, lock', () => {
    const hint = (g: GameState) => dockView(g, HOME, I)!.hint;
    expect(hint(free({ z: 30 }, 0))).toBe('CRADLE 30 M AHEAD — W');
    expect(hint(free({ z: -6 }, 0))).toBe('CRADLE 6.0 M ASTERN — S TO BACK UP');
    expect(hint(free({ z: 1, x: -7 }, 0))).toBe('CRADLE 7.0 M TO STARBOARD');
    expect(hint(free({ z: 1, y: -5 }, 0))).toBe('CLIMB 5.0 M — E');
    expect(hint(free({ z: 1, y: 4.5 }, 0))).toBe('DIVE 4.5 M — Q');
    expect(hint(free({ z: 13 }, 0, { z: -15 }))).toBe('LET GO OF W — SHE WILL COAST ONTO THE CRADLE');
    expect(hint(free({ z: 5 }, 0, { z: -15 }))).toBe('EASE OFF — YOU WILL OVERSHOOT');
    expect(hint(free({ z: 1 }, 0, { z: -3.5 }))).toBe('TOO FAST — LET GO OF W, UNDER 3 M/S');
    expect(hint(free({ z: 1 }, Math.PI - 40 * DEG))).toBe('LINE UP — TURN LEFT (A) 40°');
    expect(hint(free({ z: 1 }, 0, {}, 20 * DEG))).toBe('LEVEL OFF');
    expect(hint(free({ z: 1 }, 0))).toBe('PRESS 3 — LOCK THE CLAMPS');
  });

  it('a pilot who lets go of W when the guide says so — up to a quarter second late — ends in the lock zone and can lock', () => {
    // Up the pen's axis at a steady speed, letting go `late` seconds after the guide first says to.
    for (const speed of [15, 9, 5]) {
      for (const late of [0, 0.25]) {
        let g = free({ z: 50 }, 0, { z: -speed });
        let saidAt = -1;
        let k = 0;
        for (; k < 60 * 20; k++) {
          if (saidAt < 0 && dockView(g, HOME, I)!.hint.includes('LET GO')) saidAt = k;
          const held = saidAt < 0 || k < saidAt + Math.round(late / DT);
          const i: SubInput = held ? { ...NO_INPUT, throttle: speed / T.interiorSpeedCap } : NO_INPUT;
          g = stepGame(g, i, null, DT, W);
        }
        const name = `${speed} m/s, ${late} s late`;
        expect(saidAt, name).toBeGreaterThan(0);
        expect(dockView(g, HOME, I)!.ready, name).toBe(true);
      }
    }
  });
});
