import { describe, expect, it } from 'vitest';
import { type GameState, REFUSAL, oceanStart, standby } from '../sim/launch';
import { initialSubState } from '../sim/sub';
import type { Vec3 } from '../sim/vec3';
import { COAST_Z, FIXED_DT as DT, createWorld } from '../sim/world';
import { ROOMS } from '../sim/rooms';
import { controlRoom } from '../sim/session';
import { NO_INPUT } from '../sim/sub';
import { onFoot } from '../sim/troy';
import { DEFAULT_START, Game, startPlace, startState } from './game';
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
  const game = new Game(W, oceanStart(W));
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

function expectStandby(game: Game, before: GameState, want: GameState = standby(W, before.combat)): void {
  const g = game.state;
  expect(g).toEqual(want);
  expect(g.launch).toMatchObject({ door: 0, doorDir: 0, clamps: 'locked', engines: 'off', cradle: 0 });
  expect(g.combat.missiles).toEqual([]);
  expect(g.combat.t).toBe(before.combat.t);
  expect(g.combat.targets.find((t) => t.id === 'buoy-1')?.alive).toBe(false);
  expect(game.lastState).toBe(g);
  expect(game.jumped).toBe(true);
}

describe('the game owner (L3, L4)', () => {
  // Phase 3 (M3, M9, M7's amendment list): R goes to the game's start — Troy in the control room, the sub in standby —
  // where L4's went to standby in the pen. Everything else the R tests asked of L4 holds of the sub's half.
  it.each<[string, Vec3, number]>([
    ['the open sea', { x: 200, y: -40, z: -800 }, 0],
    ['the tunnel', { x: 0, y: -40, z: COAST_Z - 50 }, 0],
    ['the pen', { x: 10, y: -14, z: -1400 }, 1],
  ])('11. R from %s gives the control room, the sub in standby: door shut, no missiles in flight, combat clock kept, destroyed targets stay destroyed', (_, pos, yaw) => {
    const game = sortie();
    // Put the sub there without touching the door or the missile, then R.
    game.place(at(pos, yaw));
    const before = game.state;
    expect(before.combat.missiles.length).toBe(1);
    expect(before.launch.doorDir).toBe(1);
    game.restartNow();
    expectStandby(game, before, controlRoom(W, ROOMS, before.combat));
    expect(game.mode).toBe('onFoot');
  });

  it('11. the R key calls it once per press, before the step it was held for', () => {
    const game = sortie();
    const before = game.state;
    game.step(held('KeyR'), DT);
    // R, then one step from the control room (nothing moves while docked; Troy stands still; the clock runs).
    const start = controlRoom(W, ROOMS, before.combat);
    expect(game.state.sub).toEqual(start.sub);
    expect(game.state.launch).toEqual(start.launch);
    expect(game.state.troy).toEqual(start.troy);
    expect(game.state.combat.t).toBeCloseTo(before.combat.t + DT, 12);
    // Held: no repeat — the pen (the menu's Return to Pen 3) stays the pen while R is still down.
    game.toStandby();
    game.step(held('KeyR'), DT);
    expect(game.state.troy.where).toBe('aboard');
    // Released and pressed again: back to the control room.
    game.step(NOTHING, DT);
    game.step(held('KeyR'), DT);
    expect(game.state.troy.where).toBe('onFoot');
  });

  it('11. a game started at sea (?start=ocean) also returns to the start on R, keeping the targets and shutting the door', () => {
    const game = new Game(W, oceanStart(W));
    game.place(at({ x: 0, y: -40, z: COAST_Z + 80 }, 0));
    game.press('door');
    stepFor(game, 1);
    expect(game.state.launch.doorDir).toBe(1);
    const before = game.state;
    game.restartNow();
    expect(game.state).toEqual(controlRoom(W, ROOMS, before.combat));
    expect(game.state.launch).toMatchObject({ door: 0, doorDir: 0, clamps: 'locked', cradle: 0 });
  });

  it("L4. the menu's Return to Pen 3 (toStandby) still gives standby in the pen", () => {
    const game = sortie();
    game.place(at({ x: 200, y: -40, z: -800 }, 0));
    const before = game.state;
    game.toStandby();
    expectStandby(game, before);
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

  // M7's amendment list (T8): a plain load now starts in the control room — see 'starts where the URL says' below.
  it.each<[string, 'standby' | 'ocean']>([
    ['?start=pen', 'standby'],
    ['?start=pen&seed=7', 'standby'],
    ['?start=ocean', 'ocean'],
    ['?at=0,-40,-1040&yaw=0', 'ocean'],
    ['?start=pen&at=0,-40,-900', 'ocean'],
  ])('L4. ?start=pen starts in standby in Pen 3; ?start=ocean or ?at= start at sea (%s)', (search, expected) => {
    const g = startState(W, new URLSearchParams(search));
    expect(g).toEqual(expected === 'standby' ? standby(W) : oceanStart(W));
  });

  it('11. presses queued in one frame are consumed one per step, first in first out', () => {
    const game = new Game(W, standby(W));
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
    const game = new Game(W, oceanStart(W));
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
});

describe('the step listener (L7)', () => {
  it('hears every fixed step once with its (previous, current) pair, and never a pair across a jump', () => {
    const game = new Game(W, standby(W));
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

describe('detonations between frames (T8)', () => {
  it('keeps every step\'s detonations until a frame takes them, so a frame that ran two steps shows both', () => {
    const game = new Game(W, oceanStart(W));
    game.place(at({ x: 300, y: -30, z: -1040 }, 0)); // facing the cliff, 60 m off it
    game.takeDetonations();
    stepFor(game, 1 / 60, held('Space'));
    let seen = 0;
    for (let k = 0; k < 120; k++) {
      game.step(NOTHING, DT);
      game.step(NOTHING, DT); // two steps per drawn frame
      seen += game.takeDetonations().length;
    }
    expect(seen).toBe(1);
    expect(game.state.combat.detonations).toEqual([]);
  });
});


describe('the session owner (phase 3, M3, M7)', () => {
  it.each<[string, 'pen' | 'control' | 'ocean']>([
    ['', 'control'],
    ['?seed=7', 'control'],
    ['?start=pen', 'pen'],
    ['?start=control', 'control'],
    ['?start=nonsense', 'control'],
    ['?start=nonsense&script=1', 'pen'],
    ['?start=ocean', 'ocean'],
    ['?at=0,-40,-1040', 'ocean'],
    ['?start=control&at=0,-40,-1040', 'ocean'],
    ['?script=cradle,8', 'pen'],
    ['?script=cradle,8&start=control', 'control'],
    ['?script=cradle,8&start=ocean', 'ocean'],
    ['?view=port', 'pen'],
    ['?view=hatch', 'pen'],
    ['?view=port&start=control', 'control'],
    ['?view=control', 'control'],
  ])('starts where the URL says (%s → %s); the control room is the default (M9)', (search, place) => {
    const params = new URLSearchParams(search);
    expect(startPlace(params)).toBe(place);
    const want = place === 'pen' ? standby(W) : place === 'control' ? controlRoom(W, ROOMS) : oceanStart(W);
    expect(startState(W, params)).toEqual(want);
  });

  it('M9: the control room is the default start, and ?script= implies the pen whatever the default (M7)', () => {
    expect(DEFAULT_START).toBe('control');
    expect(startState(W, new URLSearchParams(''))).toEqual(startState(W, new URLSearchParams('?start=control')));
    expect(startPlace(new URLSearchParams('?script=1'))).toBe('pen');
  });

  it('toControlRoom: Troy standing at the start, the sub in standby, combat kept, a jump', () => {
    const game = sortie();
    const before = game.state;
    game.toControlRoom();
    expect(game.state).toEqual(controlRoom(W, ROOMS, before.combat));
    expect(game.state.troy).toEqual(onFoot(ROOMS.start));
    expect(game.mode).toBe('onFoot');
    expect(game.jumped).toBe(true);
    expect(game.lastState).toBe(game.state);
  });

  it('consumes the press union one per step, in order, use and leave included', () => {
    const game = new Game(W, standby(W));
    game.press('use');
    game.press('leave');
    game.press('cradle');
    expect(game.queued).toEqual(['use', 'leave', 'cradle']);
    game.step(NOTHING, DT);
    expect(game.state.launch.refusal).toBeNull();
    game.step(NOTHING, DT);
    expect(game.state.launch.refusal).toBeNull(); // docked and raised: leave is accepted (M6b: he rides up)
    expect(game.state.troy).toMatchObject({ where: 'riding', rideDir: 'up' });
    game.step(NOTHING, DT);
    // He has left the seat: the cradle press finds nobody aboard (M6).
    expect(game.state.launch.refusal).toMatchObject({ control: 'cradle', reason: REFUSAL.notAboard });
    expect(game.state.launch.cradleDir).toBe(0);
    expect(game.queued).toEqual([]);
  });

  it("gives the sub NO_INPUT while Troy is not aboard, and refuses the launch keys' presses 'Not aboard'", () => {
    const game = new Game(W, { ...oceanStart(W), troy: onFoot(ROOMS.start) });
    const before = game.state.sub;
    game.press('door');
    stepFor(game, 1, held('KeyW', 'Space'));
    expect(game.input).toEqual(NO_INPUT);
    expect(game.state.sub.pos).toEqual(before.pos);
    expect(game.state.combat.missiles).toEqual([]);
    expect(game.state.launch.refusal).toMatchObject({ control: 'door', reason: REFUSAL.notAboard });
  });

  it('latches the keys held across a jump: ignored until released, then live again', () => {
    const game = new Game(W, standby(W));
    game.toOcean();
    stepFor(game, 0.5, held('KeyW'));
    expect(game.state.sub.vel).toEqual({ x: 0, y: 0, z: 0 }); // W held across the jump does nothing
    expect([...game.latchedKeys]).toEqual(['KeyW']);
    // A key pressed after the jump is live; the latched one still is not.
    stepFor(game, 0.5, held('KeyW', 'KeyA'));
    expect(game.input.yaw).toBe(1);
    expect(game.input.throttle).toBe(0);
    // Released, then pressed again: live.
    game.step(NOTHING, DT);
    expect(game.latchedKeys.size).toBe(0);
    stepFor(game, 0.5, held('KeyW'));
    expect(game.input.throttle).toBe(1);
    expect(Math.hypot(game.state.sub.vel.x, game.state.sub.vel.z)).toBeGreaterThan(1);
  });

  it('latches on R, toStandby and toControlRoom too, but not on a debug teleport (place)', () => {
    for (const jump of [(g: Game) => g.toStandby(), (g: Game) => g.toControlRoom(), (g: Game) => g.restartNow()]) {
      const game = new Game(W, oceanStart(W));
      jump(game);
      game.step(held('KeyW', 'Space'), DT);
      expect([...game.latchedKeys].sort()).toEqual(['KeyW', 'Space']);
    }
    const game = new Game(W, oceanStart(W));
    game.place(at({ x: 0, y: -30, z: -1000 }, Math.PI));
    stepFor(game, 0.1, held('KeyW'));
    expect(game.latchedKeys.size).toBe(0);
    expect(game.input.throttle).toBe(1);
  });
});

describe('walkTo with a facing (T9 — the face= witness word)', () => {
  it('keeps his facing when none is given, and takes the given one otherwise; a jump either way', () => {
    const game = new Game(W, controlRoom(W, ROOMS));
    // In front of Troy's chair (phase 4: the station at the room's centre, 1.6 m south of the chair).
    const front = { x: ROOMS.chair.pos.x, z: ROOMS.chair.pos.z + 1.6 };
    game.walkTo(front.x, front.z);
    expect(game.state.troy.yaw).toBe(ROOMS.start.yaw);
    expect(game.state.troy.pos.x).toBeCloseTo(front.x, 9);
    expect(game.state.troy.pos.z).toBeCloseTo(front.z, 9);
    game.walkTo(front.x, front.z, Math.PI);
    expect(game.state.troy).toMatchObject({ where: 'onFoot', yaw: Math.PI });
    expect(game.jumped).toBe(true);
  });
});
