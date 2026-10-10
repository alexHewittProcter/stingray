import { describe, expect, it } from 'vitest';
import { type GameState, type LaunchControl, type Press, oceanStart, standby, stepGame } from '../sim/launch';
import { ROOMS } from '../sim/rooms';
import { controlRoom, stepSession } from '../sim/session';
import { STAND_STILL, onFoot } from '../sim/troy';
import { NO_INPUT, type SubInput, type SubState } from '../sim/sub';
import { TUNING as T } from '../sim/tuning';
import { COAST_Z, FIXED_DT as DT, MARINEVILLE, createWorld } from '../sim/world';
import { type SoundEvent, distanceGain, listenerOf, listenerUnderwater, muffleFor, soundscape, stepEvents } from './cues';
import { LEVELS as L } from './levels';

const W = createWorld(1964);
const DOOR = MARINEVILLE.interior.door.centre;

/** Steps the real sim, collecting each step's events, as the audio system hears them via Game.onStep. */
function run(g: GameState, seconds: number, input: SubInput = NO_INPUT, presses: LaunchControl[] = []) {
  const events: SoundEvent[] = [];
  const queue = [...presses];
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    const next = stepGame(g, input, queue.shift() ?? null, DT, W);
    events.push(...stepEvents(g, next));
    g = next;
  }
  return { g, events, kinds: events.map((e) => e.kind) };
}

const count = (kinds: string[], kind: string) => kinds.filter((k) => k === kind).length;
const withSub = (g: GameState, sub: Partial<SubState>): GameState => ({ ...g, sub: { ...g.sub, ...sub } });

/** Standby → lowered → engines on, clamps still locked. */
function poweredOnCradle(): GameState {
  return run(standby(W), T.cradleTravel + T.engineStart + 0.5, NO_INPUT, ['cradle', ...wait(T.cradleTravel + 0.1), 'engines']).g;
}
// A press queued after `seconds` of null steps (the queue is consumed one per step).
function wait(seconds: number): LaunchControl[] {
  return new Array(Math.round(seconds / DT)).fill(null);
}

describe('sound cues: the pen (L7)', () => {
  it('standby, untouched, is silent of events', () => {
    expect(run(standby(W), 3).events).toEqual([]);
  });

  it('lowering the cradle sounds the klaxon once, opens the hydraulics, and clunks once at the bottom', () => {
    const { kinds, g } = run(standby(W), T.cradleTravel + 1, NO_INPUT, ['cradle']);
    expect(count(kinds, 'klaxon')).toBe(1);
    expect(kinds.indexOf('klaxon')).toBe(0);
    expect(count(kinds, 'cradleStart')).toBe(1);
    expect(count(kinds, 'cradleStop')).toBe(1);
    expect(g.launch.cradle).toBe(1);
  });

  it('the hull goes under exactly once on the way down, and comes out once on the way up', () => {
    const down = run(standby(W), T.cradleTravel + 1, NO_INPUT, ['cradle']);
    expect(count(down.kinds, 'hullUnder')).toBe(1);
    expect(count(down.kinds, 'hullOut')).toBe(0);
    const up = run(down.g, T.cradleTravel + 1, NO_INPUT, ['cradle']);
    expect(count(up.kinds, 'hullOut')).toBe(1);
    expect(count(up.kinds, 'hullUnder')).toBe(0);
    // Raising has hydraulics and a clunk but no klaxon.
    expect(count(up.kinds, 'klaxon')).toBe(0);
    expect(up.events).toContainEqual({ kind: 'cradleStart', dir: -1 });
    expect(count(up.kinds, 'cradleStop')).toBe(1);
  });

  it('engines: one start event, then a hum that rises over the 2 s start and holds; one stop event, then silence', () => {
    const lowered = run(standby(W), T.cradleTravel + 0.5, NO_INPUT, ['cradle']).g;
    const half = run(lowered, T.engineStart / 2, NO_INPUT, ['engines']);
    expect(half.kinds).toEqual(['engineStart']);
    expect(soundscape(lowered).engine.level).toBe(0);
    expect(soundscape(half.g).engine.level).toBeGreaterThan(0.4);
    expect(soundscape(half.g).engine.level).toBeLessThan(0.6);
    const on = run(half.g, T.engineStart);
    expect(on.g.launch.engines).toBe('on');
    expect(soundscape(on.g).engine.level).toBe(1);
    const off = run(on.g, 0.5, NO_INPUT, ['engines']);
    expect(off.kinds).toEqual(['engineStop']);
    expect(soundscape(off.g).engine).toEqual({ level: 0, speed: 0, boost: 0 });
  });

  it('clamps: release and lock each sound once', () => {
    const released = run(poweredOnCradle(), 0.2, NO_INPUT, ['clamps']);
    expect(released.kinds).toEqual(['clampsRelease']);
    const locked = run(released.g, 0.2, NO_INPUT, ['clamps']);
    expect(locked.kinds).toEqual(['clampsLock']);
  });

  it('a refused press buzzes exactly once, however long the refusal is shown', () => {
    const { kinds, g } = run(standby(W), T.refusalShow + 1, NO_INPUT, ['engines']);
    expect(g.launch.refusal?.reason).toBe('Lower the cradle first');
    expect(kinds).toEqual(['refusal']);
  });

  it('two refused presses buzz twice', () => {
    expect(run(standby(W), 1, NO_INPUT, ['engines', 'clamps']).kinds).toEqual(['refusal', 'refusal']);
  });

  it('the hydraulics sound only while the cradle moves', () => {
    const moving = run(standby(W), 1, NO_INPUT, ['cradle']).g;
    expect(soundscape(moving).hydraulics).toEqual({ level: 1, dir: 1 });
    expect(soundscape(standby(W)).hydraulics).toEqual({ level: 0, dir: 0 });
  });
});

describe('sound cues: the door (L7)', () => {
  const nearDoor = (g: GameState, dz: number) => withSub(g, { pos: { x: 0, y: -40, z: COAST_Z + dz } });

  it('a request starts the machinery, runs it while moving, and the open stop sounds; then the tower closes it and the seal thuds', () => {
    const start = nearDoor(oceanStart(W), 60);
    const opening = run(start, 1, NO_INPUT, ['door']);
    expect(opening.kinds).toEqual(['doorStart']);
    expect(soundscape(opening.g).door).toBeGreaterThan(0);
    const open = run(opening.g, T.doorTravel);
    expect(open.kinds).toEqual(['doorOpened']);
    expect(soundscape(open.g).door).toBe(0);
    // Out of range: the tower closes it and the seal thuds once.
    const away = withSub(open.g, { pos: { x: 0, y: -40, z: COAST_Z + 300 } });
    const closing = run(away, T.doorTravel + 1);
    expect(closing.kinds).toEqual(['doorStart', 'doorSeal']);
  });

  it('door sounds are quieter with distance from the door', () => {
    const near = run(nearDoor(oceanStart(W), 20), 0.1, NO_INPUT, ['door']).events[0];
    const far = run(nearDoor(oceanStart(W), 110), 0.1, NO_INPUT, ['door']).events[0];
    expect(near?.kind).toBe('doorStart');
    expect(far?.kind).toBe('doorStart');
    expect((near as { gain: number }).gain).toBeGreaterThan((far as { gain: number }).gain);
  });
});

describe('sound cues: the sea and weapons (L7)', () => {
  it('a missile launch sounds once per missile', () => {
    const { kinds } = run(oceanStart(W), T.missileCooldown * 2.5, { ...NO_INPUT, fire: true });
    expect(count(kinds, 'missile')).toBe(3);
  });

  it('detonations carry their distance, quieter and duller further away', () => {
    const g = oceanStart(W);
    const near = { x: g.sub.pos.x, y: g.sub.pos.y, z: g.sub.pos.z - 20 };
    const far = { x: g.sub.pos.x, y: g.sub.pos.y, z: g.sub.pos.z - 400 };
    const after: GameState = { ...g, combat: { ...g.combat, detonations: [far, near] } };
    const events = stepEvents(g, after).filter((e) => e.kind === 'detonation');
    expect(events.length).toBe(2);
    const [a, b] = events as Array<Extract<SoundEvent, { kind: 'detonation' }>>;
    expect(a!.distance).toBeCloseTo(20);
    expect(b!.distance).toBeCloseTo(400);
    expect(a!.gain).toBeGreaterThan(b!.gain);
    expect(a!.muffle).toBeLessThan(b!.muffle);
  });

  it('a pile of detonations in one step plays as at most a few, nearest first', () => {
    const g = oceanStart(W);
    const blasts = Array.from({ length: 10 }, (_, i) => ({ x: g.sub.pos.x, y: g.sub.pos.y, z: g.sub.pos.z - 10 * (10 - i) }));
    const events = stepEvents(g, { ...g, combat: { ...g.combat, detonations: blasts } });
    expect(events.length).toBe(L.detonationMaxPerStep);
    expect((events[0] as { distance: number }).distance).toBeCloseTo(10);
  });

  it('a leap splashes once on leaving the water and once on re-entry', () => {
    // At the surface, running fast, pulling up.
    const g = withSub(oceanStart(W), { pos: { x: 0, y: T.surfaceY, z: -200 }, vel: { x: 0, y: 0, z: -40 }, yaw: 0, medium: 'surface' });
    const up = run(g, 1.5, { ...NO_INPUT, throttle: 1, boost: true, pitch: 1 });
    expect(count(up.kinds, 'leap')).toBe(1);
    const down = run(up.g, 6, { ...NO_INPUT, throttle: 1 });
    expect(count(down.kinds, 'reentry')).toBe(1);
    expect((down.events.find((e) => e.kind === 'reentry') as { speed: number }).speed).toBeGreaterThan(0);
  });

  it('no events across a discontinuity — flagged, or a step longer than any sub can travel', () => {
    const a = standby(W);
    const b = run(a, 0.1, NO_INPUT, ['cradle']).g; // klaxon territory
    expect(stepEvents(a, b).length).toBeGreaterThan(0);
    expect(stepEvents(a, b, true)).toEqual([]);
    const teleported = withSub(b, { pos: { x: 0, y: -40, z: -500 } });
    expect(stepEvents(a, teleported)).toEqual([]);
  });
});

describe('sound cues: ambience and the listener (L7)', () => {
  it('picks one bed by where the sub is: tunnel/pool underwater inside, hall in air inside, sea below or above outside', () => {
    const docked = standby(W); // raised, in air, inside
    expect(soundscape(docked).ambience).toMatchObject({ hall: 1, tunnel: 0, seaUnder: 0, seaAbove: 0 });
    const lowered = run(docked, T.cradleTravel + 0.5, NO_INPUT, ['cradle']).g;
    expect(soundscape(lowered).ambience).toMatchObject({ hall: 0, tunnel: 1, seaUnder: 0, seaAbove: 0 });
    expect(soundscape(lowered).underwater).toBe(true);
    const sea = oceanStart(W);
    expect(soundscape(sea).ambience).toMatchObject({ seaUnder: 1, seaAbove: 0, tunnel: 0, hall: 0 });
    const surfaced = withSub(sea, { pos: { ...sea.sub.pos, y: T.surfaceY }, medium: 'surface' });
    expect(soundscape(surfaced).ambience).toMatchObject({ seaUnder: 0, seaAbove: 1 });
    expect(soundscape(surfaced).underwater).toBe(false);
  });

  it('the hum follows speed and boost', () => {
    const sea = oceanStart(W);
    const at = (v: number) => soundscape(withSub(sea, { vel: { x: 0, y: 0, z: -v } })).engine;
    expect(at(0)).toEqual({ level: 1, speed: 0, boost: 0 });
    expect(at(T.cruiseSpeed / 2).speed).toBeCloseTo(0.5);
    expect(at(T.cruiseSpeed)).toEqual({ level: 1, speed: 1, boost: 0 });
    expect(at(T.boostSpeed)).toEqual({ level: 1, speed: 1, boost: 1 });
  });

  it('distance gain halves at the reference and dulling grows with distance and water', () => {
    expect(distanceGain(0, 80)).toBe(1);
    expect(distanceGain(80, 80)).toBe(0.5);
    expect(muffleFor(0, false)).toBe(0);
    expect(muffleFor(300, false)).toBeGreaterThan(muffleFor(30, false));
    expect(muffleFor(30, true)).toBeGreaterThan(muffleFor(30, false));
    expect(DOOR).toEqual(MARINEVILLE.interior.door.centre);
  });
});

// ---- Phase 3 (M6 "Sound", T7): the listener follows Troy, the ambience by session mode, the chair's cues ----

describe('phase 3: the ride heard (M6)', () => {
  const atChair = (): GameState => {
    const c = ROOMS.chair;
    return { ...controlRoom(W, ROOMS), troy: onFoot({ pos: { x: c.pos.x, y: c.pos.y, z: c.pos.z + 1.5 }, yaw: c.yaw }) };
  };
  const session = (g: GameState, p: Press | null = null) => stepSession(g, NO_INPUT, STAND_STILL, p, DT, W, ROOMS);

  it('on foot: the listener is Troy, the rooms hum plays, and neither the pen hall nor the sea does', () => {
    const g = controlRoom(W, ROOMS);
    expect(listenerOf(g)).toEqual(g.troy.pos);
    expect(soundscape(g).ambience).toMatchObject({ rooms: 1, hall: 0, tunnel: 0, seaUnder: 0, seaAbove: 0 });
    expect(soundscape(g).shaft.level).toBe(0);
    expect(listenerUnderwater({ ...oceanStart(W), troy: onFoot(ROOMS.start) })).toBe(false);
  });

  it('aboard, the listener is the sub and the beds are phase 2s (standby: the hall)', () => {
    expect(listenerOf(standby(W))).toEqual(standby(W).sub.pos);
    expect(soundscape(standby(W)).ambience).toMatchObject({ rooms: 0, hall: 1 });
  });

  it('riding: the chair sets off with a clunk, the rush rises with its speed, the hall joins at the foot, and it locks in', () => {
    let g = session(atChair(), 'use');
    const kinds: string[] = [...stepEvents(atChair(), g).map((e) => e.kind)];
    const rush: number[] = [];
    const hall: number[] = [];
    while (g.troy.where === 'riding') {
      const next = session(g);
      kinds.push(...stepEvents(g, next).map((e) => e.kind));
      g = next;
      if (g.troy.where === 'riding') {
        expect(listenerOf(g)).toEqual(g.troy.pos);
        rush.push(soundscape(g).shaft.speed);
        hall.push(soundscape(g).ambience.hall);
      }
    }
    expect(count(kinds, 'chairStart')).toBe(1);
    expect(count(kinds, 'lockIn')).toBe(1);
    expect(kinds.at(-1)).toBe('lockIn');
    // Rising from rest to the cruise, then easing off at the seat.
    expect(rush[0]!).toBeLessThan(0.01);
    expect(Math.max(...rush)).toBe(1);
    expect(rush.at(-1)!).toBeLessThan(0.05);
    for (let k = 1; k < 60; k++) expect(rush[k]!).toBeGreaterThanOrEqual(rush[k - 1]!);
    expect(hall[0]).toBe(0);
    expect(hall.at(-1)).toBe(1);
  });
});

describe('phase 3: the way back up heard (M6b — "the same reversed up")', () => {
  const session = (g: GameState, p: Press | null = null) => stepSession(g, NO_INPUT, STAND_STILL, p, DT, W, ROOMS);

  it('the seat unlocks with a clunk, the rush rises from the seat and falls at the top, and the rooms hum returns', () => {
    const start = standby(W);
    let g = session(start, 'leave');
    const kinds: string[] = [...stepEvents(start, g).map((e) => e.kind)];
    expect(kinds).toEqual(['chairUnlock']);
    const rush: number[] = [];
    while (g.troy.where === 'riding') {
      const next = session(g);
      kinds.push(...stepEvents(g, next).map((e) => e.kind));
      g = next;
      if (g.troy.where === 'riding') {
        expect(listenerOf(g)).toEqual(g.troy.pos);
        rush.push(soundscape(g).shaft.speed);
      }
    }
    expect(count(kinds, 'chairUnlock')).toBe(1);
    expect(count(kinds, 'chairHome')).toBe(1);
    expect(count(kinds, 'lockIn') + count(kinds, 'chairStart')).toBe(0);
    expect(kinds.at(-1)).toBe('chairHome');
    // From rest at the seat to the cruise, then falling to rest at the top.
    expect(rush[0]!).toBeLessThan(0.05);
    expect(Math.max(...rush)).toBe(1);
    expect(rush.at(-1)!).toBeLessThan(0.01);
    for (let k = rush.length - 60; k < rush.length; k++) expect(rush[k]!).toBeLessThanOrEqual(rush[k - 1]!);
    // Standing in the control room: the rooms' hum, no rush, no hall.
    expect(soundscape(g).ambience).toMatchObject({ rooms: 1, hall: 0 });
    expect(soundscape(g).shaft.level).toBe(0);
  });
});
