import { describe, expect, it } from 'vitest';
import { type GameState, REFUSAL, oceanStart, standby } from '../sim/launch';
import { initialSubState } from '../sim/sub';
import type { Vec3 } from '../sim/vec3';
import { COAST_Z, FIXED_DT as DT, createWorld } from '../sim/world';
import { Game, launchStatus } from './game';
import { modeOf } from './mode';

const W = createWorld(1964);
const NOTHING = new Set<string>();
const held = (...codes: string[]) => new Set(codes);
const at = (pos: Vec3, yaw: number) => ({ pos, vel: { x: 0, y: 0, z: 0 }, yaw, pitch: 0, medium: 'submerged' as const });

function stepFor(game: Game, seconds: number, keys: ReadonlySet<string> = NOTHING): void {
  for (let k = 0; k < Math.round(seconds / DT); k++) game.step(keys, DT);
}

/** A session at sea that has shot buoy-1 dead, has a missile in flight and the door opening. */
function sortie(): Game {
  const game = new Game(W, oceanStart(W), 'standby');
  game.place(at({ x: 0, y: -30, z: -1000 }, Math.PI)); // buoy-1 is 100 m dead ahead
  stepFor(game, 0.1, held('Space'));
  stepFor(game, 2);
  expect(game.state.combat.targets.find((t) => t.id === 'buoy-1')?.alive).toBe(false);
  game.place(at({ x: 0, y: -40, z: COAST_Z + 60 }, Math.PI));
  game.press('door');
  stepFor(game, 1 / 60, held('Space'));
  expect(game.state.launch.doorDir).toBe(1);
  expect(game.state.combat.missiles.length).toBe(1);
  return game;
}

function expectStandby(game: Game, before: GameState): void {
  const g = game.state;
  expect(g).toEqual(standby(W, before.combat));
  expect(g.launch).toMatchObject({ door: 0, doorDir: 0, clamps: 'locked', engines: 'off', cradle: 0 });
  expect(g.combat.missiles).toEqual([]);
  expect(g.combat.t).toBe(before.combat.t);
  expect(g.combat.targets.find((t) => t.id === 'buoy-1')?.alive).toBe(false);
  expect(game.lastState).toBe(g);
  expect(game.jumped).toBe(true);
}

describe('the game owner (L3, L4)', () => {
  it.each<[string, Vec3, number]>([
    ['the open sea', { x: 200, y: -40, z: -800 }, 0],
    ['the tunnel', { x: 0, y: -40, z: COAST_Z - 50 }, 0],
    ['the pen', { x: 10, y: -14, z: -1400 }, 1],
  ])('11. R from %s gives standby: door shut, no missiles in flight, combat clock kept, destroyed targets stay destroyed', (_, pos, yaw) => {
    const game = sortie();
    // Put the sub there without touching the door or the missile, then R.
    game.place(at(pos, yaw));
    const before = game.state;
    expect(before.combat.missiles.length).toBe(1);
    expect(before.launch.doorDir).toBe(1);
    game.restartNow();
    expectStandby(game, before);
  });

  it('11. the R key calls it once per press, before the step it was held for', () => {
    const game = sortie();
    const before = game.state;
    game.step(held('KeyR'), DT);
    // R, then one step from standby (nothing moves while docked; the clock runs).
    const docked = standby(W, before.combat);
    expect(game.state.sub).toEqual(docked.sub);
    expect(game.state.launch).toEqual(docked.launch);
    expect(game.state.combat.t).toBeCloseTo(before.combat.t + DT, 12);
    // Held: no repeat.
    game.press('cradle');
    game.step(held('KeyR'), DT);
    expect(game.state.launch.cradleDir).toBe(1);
  });

  it("11. a game started at sea keeps phase 1's R: back to the spawn, released, engines on, the door left as it is", () => {
    const game = new Game(W, oceanStart(W), 'spawn');
    game.place(at({ x: 0, y: -40, z: COAST_Z + 80 }, 0));
    game.press('door');
    stepFor(game, 1);
    const door = game.state.launch.door;
    game.restartNow();
    expect(game.state.sub).toEqual(initialSubState(W));
    expect(game.state.launch).toMatchObject({ clamps: 'released', engines: 'on', cradle: 1, door, doorDir: 1 });
  });

  it("11. ?start=ocean's state is released, engines on, cradle lowered, door shut, at phase 1's spawn", () => {
    const g = oceanStart(W);
    expect(g.sub).toEqual(initialSubState(W));
    expect(g.launch).toEqual({
      cradle: 1, cradleDir: 0, engines: 'on', clamps: 'released', door: 0, doorDir: 0, refusal: null, engineStart: 0,
    });
    expect(modeOf(g.sub.pos)).toBe('piloting');
    expect(modeOf(standby(W).sub.pos)).toBe('launch');
  });

  it('11. presses queued in one frame are consumed one per step, first in first out', () => {
    const game = new Game(W, standby(W), 'standby');
    game.press('engines');
    game.press('cradle');
    game.press('cradle');
    expect(game.queued).toEqual(['engines', 'cradle', 'cradle']);
    game.step(NOTHING, DT);
    expect(game.state.launch.refusal).toMatchObject({ control: 'engines', reason: REFUSAL.lowerCradle });
    expect(game.state.launch.cradleDir).toBe(0);
    expect(game.queued).toEqual(['cradle', 'cradle']);
    game.step(NOTHING, DT);
    expect(game.state.launch.cradleDir).toBe(1);
    game.step(NOTHING, DT);
    expect(game.state.launch.refusal).toMatchObject({ control: 'cradle', reason: REFUSAL.cradleMoving });
    expect(game.queued).toEqual([]);
    // A frame with no steps loses nothing; a frame with several consumes them in order.
    game.press('door');
    game.press('clamps');
    expect(game.queued).toEqual(['door', 'clamps']);
    game.step(NOTHING, DT);
    expect(game.state.launch.refusal).toMatchObject({ control: 'door', reason: REFUSAL.onCradle });
    game.step(NOTHING, DT);
    expect(game.state.launch.refusal).toMatchObject({ control: 'clamps', reason: REFUSAL.lowerCradle });
  });

  it('nothing resets on crossing the mouth: the mode is derived from the one state', () => {
    const game = new Game(W, oceanStart(W), 'spawn');
    game.place(at({ x: 0, y: -40, z: COAST_Z + 30 }, 0));
    game.press('door');
    stepFor(game, 5.2);
    expect(game.state.launch.door).toBe(1);
    game.override = { throttle: 1 };
    const seen: string[] = [game.mode];
    for (let k = 0; k < 240; k++) {
      const before = game.state;
      game.step(NOTHING, DT);
      expect(game.lastState).toBe(before);
      if (game.mode !== seen[seen.length - 1]) seen.push(game.mode);
    }
    expect(seen).toEqual(['piloting', 'launch']);
    expect(game.jumped).toBe(true); // only the place() set it; stepping never does
  });

  it('the status line: a fresh refusal first, then what the machinery is doing', () => {
    const game = new Game(W, standby(W), 'standby');
    expect(launchStatus(game.state)).toBe('STINGRAY DOCKED — PEN 3');
    game.press('clamps');
    game.step(NOTHING, DT);
    expect(launchStatus(game.state)).toBe(REFUSAL.lowerCradle.toUpperCase());
    stepFor(game, 2.9);
    expect(launchStatus(game.state)).toBe(REFUSAL.lowerCradle.toUpperCase());
    stepFor(game, 0.2);
    expect(launchStatus(game.state)).toBe('STINGRAY DOCKED — PEN 3');
    game.press('cradle');
    game.step(NOTHING, DT);
    expect(launchStatus(game.state)).toBe('CRADLE LOWERING');
  });
});

describe('the step listener (L7)', () => {
  it('hears every fixed step once with its (previous, current) pair, and never a pair across a jump', () => {
    const game = new Game(W, standby(W), 'standby');
    const pairs: Array<[GameState, GameState]> = [];
    game.onStep = (previous, current) => pairs.push([previous, current]);
    game.press('cradle');
    stepFor(game, 0.5);
    expect(pairs.length).toBe(30);
    expect(pairs[0]![0]).toEqual(standby(W));
    for (let k = 1; k < pairs.length; k++) expect(pairs[k]![0]).toBe(pairs[k - 1]![1]);
    expect(pairs[29]![1]).toBe(game.state);
    // After a jump the next pair starts from where the sub was put, not from before it.
    game.place(at({ x: 0, y: -40, z: -500 }, 0));
    const placed = game.state;
    game.step(NOTHING, DT);
    expect(pairs[30]![0]).toBe(placed);
  });
});
