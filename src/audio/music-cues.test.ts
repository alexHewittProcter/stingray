// Phase 4 S3: the score's cues, from fake state pairs (every row of the cue table) and over the real sim (the loop
// down, out to sea, home and back up — each cue on its edge, once).
import { describe, expect, it } from 'vitest';
import { onCentreline } from '../debug';
import type { MenuKind } from '../game/menu';
import { type GameState, type Press, oceanStart, released, standby } from '../sim/launch';
import { leaveSeat, sit } from '../sim/ride';
import { ROOMS, seatOf } from '../sim/rooms';
import { controlRoom, stepSession } from '../sim/session';
import { NO_INPUT, type SubInput } from '../sim/sub';
import { STAND_STILL, aboard, onFoot } from '../sim/troy';
import { TUNING as T } from '../sim/tuning';
import { FIXED_DT as DT, createWorld } from '../sim/world';
import {
  type CueMemory, type Moment, type MusicCommand, JUMP_FADE, ROLL_FLOOR, ROLL_PEAK, SEA_FADE, TITLE_FADE, describeCommand, memoryOf,
  musicCues, musicIntensity, stateCue,
} from './music-cues';

const W = createWorld(1964);
const HOME: CueMemory = { away: false };
const AWAY: CueMemory = { away: true };
const at = (g: GameState, menu: MenuKind | null = null): Moment => ({ g, menu });
const step = (a: GameState, b: GameState, mem = HOME) => musicCues(at(a), at(b), false, mem);
const cues = (cs: MusicCommand[]) => cs.map(describeCommand);

const atChair = (): GameState => {
  const c = ROOMS.chair;
  return { ...controlRoom(W, ROOMS), troy: onFoot({ pos: { x: c.pos.x, y: c.pos.y, z: c.pos.z + 1.5 }, yaw: c.yaw }) };
};
const riding = (g: GameState, ride: number, dir: 'down' | 'up'): GameState => ({
  ...g,
  troy: { ...(dir === 'down' ? sit(g.troy, ROOMS) : leaveSeat(g.troy, ROOMS, Math.PI)), ride },
});
const seat = seatOf(W.marineville.interior.cradle);

describe('the title (S3 row 1)', () => {
  it('from cold (the first gesture) the title plays FANFARE then MARCH; a jump under it, the MARCH', () => {
    expect(cues(stateCue(at(controlRoom(W, ROOMS), 'title'), true))).toEqual(["title: play('FANFARE', { then: 'MARCH' })"]);
    const r = musicCues(at(controlRoom(W, ROOMS), 'title'), at(standby(W), 'title'), true, HOME);
    expect(cues(r.commands)).toEqual([`jump: stop(${JUMP_FADE})`, "titleJump: play('MARCH')"]);
  });

  it('nothing else is heard while the title is up (the sim does not step under it)', () => {
    const a = atChair();
    const b = stepSession(a, NO_INPUT, STAND_STILL, 'use', DT, W, ROOMS);
    expect(b.troy.where).toBe('riding');
    expect(musicCues(at(a, 'title'), at(b, 'title'), false, HOME).commands).toEqual([]);
  });

  it('Start in the control room: the title fades over 4 s and the ALERT comes in once the fade is done', () => {
    const r = musicCues(at(controlRoom(W, ROOMS), 'title'), at(controlRoom(W, ROOMS)), true, HOME);
    expect(r.commands).toEqual([
      { kind: 'stop', fade: TITLE_FADE, cue: 'titleEnd' },
      { kind: 'play', id: 'ALERT', cue: 'alert', delay: TITLE_FADE },
    ]);
    expect(TITLE_FADE).toBe(4);
  });

  it('Skip to Pen 3 / open ocean: the fade, then nothing (aboard has no state cue)', () => {
    for (const g of [standby(W), oceanStart(W)]) {
      expect(cues(musicCues(at(controlRoom(W, ROOMS), 'title'), at(g), true, HOME).commands)).toEqual(['titleEnd: stop(4)']);
    }
  });
});

describe('on foot: the ALERT (S3 row 2)', () => {
  it('is the on-foot state cue — after R / a jump into the control room, stop(0.2) then ALERT', () => {
    expect(cues(stateCue(at(controlRoom(W, ROOMS)), false))).toEqual(["alert: play('ALERT')"]);
    const r = musicCues(at(oceanStart(W)), at(controlRoom(W, ROOMS)), true, AWAY);
    expect(cues(r.commands)).toEqual(['jump: stop(0.2)', "alert: play('ALERT')"]);
  });

  it('walking around does not restart it', () => {
    const a = controlRoom(W, ROOMS);
    const b = { ...a, troy: { ...a.troy, pos: { ...a.troy.pos, x: a.troy.pos.x + 0.02 } } };
    expect(step(a, b).commands).toEqual([]);
  });
});

describe('the drop (S3 rows 3, 4)', () => {
  it('sit: ROLL (it replaces the ALERT)', () => {
    const a = atChair();
    expect(cues(step(a, riding(a, 0.001, 'down')).commands)).toEqual(["sit: play('ROLL')"]);
  });

  it('lock-in: MARCH (ROLL\'s ending — the brass hit — plays first; the cue does not opt out of it)', () => {
    const a = riding(atChair(), 0.999, 'down');
    const r = step(a, { ...a, troy: aboard(seat) });
    expect(r.commands).toEqual([{ kind: 'play', id: 'MARCH', cue: 'lockIn' }]);
  });

  it('the mode becoming piloting (out through the door): stop(6); at sea, nothing', () => {
    const inside = { ...standby(W), launch: released(standby(W).launch), sub: { ...standby(W).sub, pos: onCentreline(10, 'out').pos } };
    const outside = { ...inside, sub: { ...inside.sub, pos: onCentreline(-10, 'out').pos } };
    expect(cues(step(inside, outside, AWAY).commands)).toEqual([`sea: stop(${SEA_FADE})`]);
    expect(SEA_FADE).toBe(6);
    const further = { ...outside, sub: { ...outside.sub, pos: onCentreline(-30, 'out').pos } };
    expect(step(outside, further, AWAY).commands).toEqual([]);
    // Back in and out again: the fade again, harmlessly (the march is long gone).
    expect(step(outside, inside, AWAY).commands).toEqual([]);
  });
});

describe('home and up (S3 rows 6, 7)', () => {
  const s = standby(W);
  const raising = { ...s, launch: { ...s.launch, cradle: 0.01, cradleDir: -1 as const } };

  it('the docked rising edge, after a voyage: STING_HOME, once', () => {
    const r = step(raising, s, AWAY);
    expect(cues(r.commands)).toEqual(["home: play('STING_HOME')"]);
    expect(r.mem.away).toBe(false);
    // The next step is still docked: no second sting.
    expect(step(s, s, r.mem).commands).toEqual([]);
  });

  it('a launch aborted on the cradle (lowered and raised with the clamps never let go) is not a homecoming', () => {
    expect(step(raising, s, HOME).commands).toEqual([]);
  });

  it('the clamps letting go marks the sub away', () => {
    const lowered = { ...s, launch: { ...s.launch, cradle: 1 } };
    const free = { ...lowered, launch: { ...lowered.launch, clamps: 'released' as const } };
    expect(step(lowered, free, HOME).mem.away).toBe(true);
  });

  it('the session starting docked (standby) is never heard as a dock — a jump, not an edge', () => {
    expect(memoryOf(standby(W)).away).toBe(false);
    expect(musicCues(at(controlRoom(W, ROOMS)), at(standby(W)), true, AWAY).commands).toEqual([{ kind: 'stop', fade: 0.2, cue: 'jump' }]);
  });

  it('leave: ROLL; stand-up: STING_END without the brass hit', () => {
    const a = standby(W);
    const up = { ...a, troy: leaveSeat(a.troy, ROOMS, Math.PI) };
    expect(cues(step(a, up).commands)).toEqual(["leave: play('ROLL')"]);
    const top = riding(a, 0.001, 'up');
    expect(step(top, controlRoom(W, ROOMS)).commands).toEqual([{ kind: 'play', id: 'STING_END', ending: false, cue: 'stand' }]);
  });
});

describe('pause, R and the jumps (S3 rows 8, 9)', () => {
  it('the pause menu opening or closing plays nothing (the context suspends)', () => {
    const g = atChair();
    expect(musicCues(at(g), at(g, 'pause'), false, HOME).commands).toEqual([]);
    expect(musicCues(at(g, 'pause'), at(g), false, HOME).commands).toEqual([]);
  });

  it('a jump never fires an edge: R mid-ride is stop(0.2) then the ALERT, not a stand-up', () => {
    const mid = riding(atChair(), 0.5, 'down');
    const r = musicCues(at(mid), at(controlRoom(W, ROOMS)), true, HOME);
    expect(cues(r.commands)).toEqual(['jump: stop(0.2)', "alert: play('ALERT')"]);
  });

  it('a teleport out to sea (the witness scripts): stop(0.2), nothing after it, and the sub counts as away', () => {
    const g = { ...oceanStart(W), troy: aboard(seat) };
    const r = musicCues(at(standby(W)), at(g), true, HOME);
    expect(cues(r.commands)).toEqual(['jump: stop(0.2)']);
    expect(r.mem.away).toBe(true);
  });
});

describe('the roll\'s intensity', () => {
  it('1 off the chair; riding, from ROLL_FLOOR at the top to ROLL_PEAK at the seat, never falling on the way down', () => {
    expect(musicIntensity(controlRoom(W, ROOMS))).toBe(1);
    expect(musicIntensity(standby(W))).toBe(1);
    const k = (ride: number) => musicIntensity(riding(atChair(), ride, 'down'));
    expect(k(0)).toBeCloseTo(ROLL_FLOOR, 6);
    expect(k(1)).toBeCloseTo(ROLL_PEAK, 6);
    let last = 0;
    for (let r = 0; r <= 1; r += 0.01) {
      expect(k(r)).toBeGreaterThanOrEqual(last - 1e-9);
      last = k(r);
    }
  });

  it('the ascent is the roll reversed: loud at the seat, thinning to the top', () => {
    const k = (ride: number) => musicIntensity(riding(standby(W), ride, 'up'));
    expect(k(1)).toBeCloseTo(ROLL_PEAK, 6);
    expect(k(0)).toBeCloseTo(ROLL_FLOOR, 6);
  });
});

// ---- Over the real sim: the loop, cue by cue, each once, on its edge ----

interface Log {
  t: number;
  line: string;
}

/** Steps the sim as Game does, feeding each step's pair to musicCues as audio.ts does. */
function drive(g: GameState, mem: CueMemory, log: Log[], t0: number, seconds: number, input: SubInput = NO_INPUT, presses: Press[] = []) {
  const queue = [...presses];
  let t = t0;
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    const next = stepSession(g, input, STAND_STILL, queue.shift() ?? null, DT, W, ROOMS);
    t += DT;
    const r = musicCues(at(g), at(next), false, mem);
    mem = r.mem;
    for (const c of r.commands) log.push({ t, line: describeCommand(c) });
    g = next;
  }
  return { g, mem, t };
}

const pressAfter = (seconds: number, p: Press): Press[] => [...new Array(Math.round(seconds / DT)).fill(null), p];

describe('the loop over the real sim', () => {
  it('sit → ROLL, 6.0 s → MARCH, piloting → stop(6) — each once', () => {
    const log: Log[] = [];
    let s = drive(atChair(), HOME, log, 0, 1, NO_INPUT, ['use']);
    s = drive(s.g, s.mem, log, s.t, 8);
    s = drive(s.g, s.mem, log, s.t, T.cradleTravel + 0.2 + T.engineStart + 0.5, NO_INPUT, ['cradle', ...pressAfter(T.cradleTravel + 0.2, 'engines')]);
    s = drive(s.g, s.mem, log, s.t, 12, { ...NO_INPUT, throttle: 1, boost: true }, ['clamps', 'door']);
    expect(s.g.troy.where).toBe('aboard');
    expect(log.map((l) => l.line)).toEqual(["sit: play('ROLL')", "lockIn: play('MARCH')", 'sea: stop(6)']);
    const [sat, locked] = log;
    expect(locked!.t - sat!.t).toBeCloseTo(T.rideSeconds, 1);
  });

  it('home: STING_HOME once on the dock, then leave → ROLL and the stand-up → STING_END, 6.0 s apart', () => {
    const log: Log[] = [];
    // As the witnessing "Coming home" script: 200 m out facing in, the door, a boosted run in, then docked and raised.
    const start = onCentreline(-200, 'in');
    const g0: GameState = { ...oceanStart(W), troy: aboard(seat), sub: { ...oceanStart(W).sub, pos: start.pos, yaw: start.yaw, vel: { x: 0, y: 0, z: 0 } } };
    let s = drive(g0, memoryOf(g0), log, 0, 11, { ...NO_INPUT, throttle: 1, boost: true }, ['door']);
    // dock=0: at rest on the lowered cradle (a teleport — a jump, so no edge), then clamps, engines off, raise.
    const c = W.marineville.interior.cradle;
    const g1 = { ...s.g, sub: { ...s.g.sub, pos: { x: c.pos.x, y: c.loweredY, z: c.pos.z }, yaw: Math.PI, vel: { x: 0, y: 0, z: 0 } } };
    const j = musicCues(at(s.g), at(g1), true, s.mem);
    s = drive(g1, j.mem, log, s.t, 1 + 0.5 + T.cradleTravel + 1, NO_INPUT, ['clamps', ...pressAfter(1, 'engines'), ...pressAfter(0.4, 'cradle')]);
    expect(log.map((l) => l.line)).toEqual(["home: play('STING_HOME')"]);
    s = drive(s.g, s.mem, log, s.t, 8, NO_INPUT, ['leave']);
    expect(s.g.troy.where).toBe('onFoot');
    expect(log.map((l) => l.line)).toEqual(["home: play('STING_HOME')", "leave: play('ROLL')", "stand: play('STING_END', { ending: false })"]);
    expect(log[2]!.t - log[1]!.t).toBeCloseTo(T.rideSeconds, 1);
  });
});
