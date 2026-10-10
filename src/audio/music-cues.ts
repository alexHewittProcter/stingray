// The score's cues (phase 4 S3): what plays when. Pure — no Web Audio, no DOM, no clock — like cues.ts's stepEvents,
// so every row of S3's table is unit-tested from fake state pairs; audio.ts applies the commands to music.ts.
//
// Two kinds of moment change the music:
//   - an EDGE between two consecutive fixed steps (Game.onStep's pair): the sit, the lock-in, the mode going to
//     'piloting', the dock, the leave, the stand-up — each heard on the one step it happens, so none fires twice;
//   - a DISCONTINUITY — R, the menu's jumps, ?start=, a debug walkTo/teleport — or the title menu closing: what was
//     playing stops and the new state's own cue (`stateCue`) starts. Edges never fire across one (a jump is not a sit),
//     and the session's start is one, so standby's being docked is never heard as a dock.
//
// The menu is part of the moment because the title cue needs it (S2: "frame gains the menu's state").

import type { MenuKind } from '../game/menu';
import { sessionMode } from '../game/mode';
import type { GameState } from '../sim/launch';
import { RIDE_SECONDS, rideSpeedAt, rideTimeAt } from '../sim/ride';
import { docked } from '../sim/session';
import type { SectionId } from './score';

/** Why a command fired — for the ?debug=music log and the tests. */
export type Cue =
  | 'title' // the title menu, from cold: FANFARE then MARCH
  | 'titleJump' // a jump with the title menu still up: the title's MARCH
  | 'titleEnd' // the title menu closed (Start / Skip to…): the 4 s fade
  | 'jump' // R, the menu's jumps, a debug walkTo/teleport: stop(0.2)
  | 'alert' // on foot in the control room: the PA's tattoo
  | 'sit' // onFoot → riding (down): ROLL
  | 'lockIn' // riding → aboard: MARCH (ROLL's brass hit first, on the step)
  | 'sea' // the mode becomes 'piloting': the march fades over 6 s
  | 'home' // the docked rising edge, after a voyage: STING_HOME
  | 'leave' // aboard → riding (up): ROLL, thinning
  | 'stand'; // riding (up) → onFoot: STING_END, without the brass hit

export type MusicCommand =
  | {
      kind: 'play';
      id: SectionId;
      cue: Cue;
      then?: SectionId;
      /** false: skip the left section's ending (ROLL's brass hit). */
      ending?: boolean;
      /** Seconds of audio clock to wait before playing (cancelled by any later command). */
      delay?: number;
    }
  | { kind: 'stop'; fade: number; cue: Cue };

/** What the cues read: the session's state and which menu is up. */
export interface Moment {
  g: GameState;
  menu: MenuKind | null;
}

/**
 * The little the cues remember: whether the sub has been released since it was last docked — so the dock sting
 * marks a homecoming, not a launch aborted on the cradle (lowered, then raised again with the clamps never let go).
 */
export interface CueMemory {
  away: boolean;
}

/** S3: the title's fade when "Start in the control room" / "Skip to…" closes it. */
export const TITLE_FADE = 4;
/** S3: the march's fade once the sub is out through the ocean door. */
export const SEA_FADE = 6;
/** S3: `R`, the menu's jumps, `?start=` — stop(0.2), then the new state's cue. */
export const JUMP_FADE = 0.2;
/** The ROLL's intensity at the top of the shaft and at the seat (T5's hand-off: "about 0.4 → 1.2 should give the build"). */
export const ROLL_FLOOR = 0.4;
export const ROLL_PEAK = 1.2;

const stop = (fade: number, cue: Cue): MusicCommand => ({ kind: 'stop', fade, cue });

/**
 * The cue that belongs to a state on its own — after a discontinuity, after the title closes, or when sound first
 * starts (`fresh`: the browser's first gesture). The title menu, if up, wins: FANFARE then MARCH from cold, the
 * title's MARCH after a jump. Otherwise on foot in the control room is the ALERT; anywhere else, nothing (S3: "the
 * cue for the new state (the title's MARCH if the menu is up; otherwise none)" — the ALERT being the on-foot state's
 * own cue). `delay` starts it after a fade that is still running.
 */
export function stateCue(m: Moment, fresh: boolean, delay = 0): MusicCommand[] {
  const later = delay > 0 ? { delay } : {};
  if (m.menu === 'title') {
    return [fresh ? { kind: 'play', id: 'FANFARE', then: 'MARCH', cue: 'title' } : { kind: 'play', id: 'MARCH', cue: 'titleJump' }];
  }
  if (m.g.troy.where === 'onFoot') return [{ kind: 'play', id: 'ALERT', cue: 'alert', ...later }];
  return [];
}

/** The memory for a state arrived at by a discontinuity: away if the sub is out of its clamps. */
export function memoryOf(g: GameState): CueMemory {
  return { away: g.launch.clamps === 'released' };
}

/**
 * The commands between two moments. `jumped`: they are not consecutive steps (a discontinuity lies between).
 * The order of precedence: the title closing; the title still up (a jump under it plays the title's MARCH, and edges
 * are not heard — the sim does not step under it); a jump; then the edges of one step.
 */
export function musicCues(prev: Moment, cur: Moment, jumped: boolean, mem: CueMemory): { commands: MusicCommand[]; mem: CueMemory } {
  // S3: the title's fanfare/march fades over 4 s on Start / Skip to…; the new state's cue waits out the fade (the
  // PA's tattoo coming in over the march's own snare would fight it — two snares in different time).
  if (prev.menu === 'title' && cur.menu !== 'title') {
    return { commands: [stop(TITLE_FADE, 'titleEnd'), ...stateCue(cur, false, TITLE_FADE)], mem: memoryOf(cur.g) };
  }
  if (cur.menu === 'title') {
    if (prev.menu !== 'title') return { commands: [stop(JUMP_FADE, 'jump'), ...stateCue(cur, true)], mem: memoryOf(cur.g) };
    return { commands: jumped ? [stop(JUMP_FADE, 'jump'), ...stateCue(cur, false)] : [], mem: jumped ? memoryOf(cur.g) : mem };
  }
  if (jumped) return { commands: [stop(JUMP_FADE, 'jump'), ...stateCue(cur, false)], mem: memoryOf(cur.g) };

  const a = prev.g;
  const b = cur.g;
  const out: MusicCommand[] = [];
  let away = mem.away;
  const was = a.troy.where;
  const is = b.troy.where;

  // The chair (S3; T4's edges): sit, lock-in 6.0 s later, leave, stand-up 6.0 s after that.
  if (was === 'onFoot' && is === 'riding') out.push({ kind: 'play', id: 'ROLL', cue: 'sit' });
  // MARCH from its top; leaving ROLL lands its brass hit on this step, and the march starts one bar later.
  if (was === 'riding' && is === 'aboard') out.push({ kind: 'play', id: 'MARCH', cue: 'lockIn' });
  if (was === 'aboard' && is === 'riding') out.push({ kind: 'play', id: 'ROLL', cue: 'leave' });
  // Without `ending: false` the big lock-in brass hit would play first (T5).
  if (was === 'riding' && is === 'onFoot') out.push({ kind: 'play', id: 'STING_END', ending: false, cue: 'stand' });

  if (was === 'aboard' && is === 'aboard') {
    // Out through the ocean door: the march fades; at sea, phase 1's ambience alone.
    if (sessionMode(a) !== 'piloting' && sessionMode(b) === 'piloting') out.push(stop(SEA_FADE, 'sea'));
    if (a.launch.clamps === 'locked' && b.launch.clamps === 'released') away = true;
    // T4: "Key on the `docked` edge" (clamps locked, cradle 0, still) — the readme's "clamps becomes locked with
    // cradle === 0" cannot happen literally (they lock at cradle 1).
    if (away && !docked(a.launch) && docked(b.launch)) {
      out.push({ kind: 'play', id: 'STING_HOME', cue: 'home' });
      away = false;
    }
  }
  return { commands: out, mem: { away } };
}

/**
 * The music's intensity (music.ts setIntensity): 1 except riding, where the ROLL builds with the descent — it follows
 * `rideSpeedAt` as the chair gathers speed (S3: "`vel` follows `rideSpeedAt`"), then keeps building through the
 * cruise and on through the ease-out into the brass hit at lock-in, rather than sagging as the chair slows:
 * ROLL_FLOOR at the top of the shaft, ROLL_PEAK at the seat. A function of the point on the shaft, so the ascent
 * (which runs the timetable backwards) gets the same roll reversed: loud at the seat, thinning to the top.
 */
export function musicIntensity(g: GameState): number {
  if (g.troy.where !== 'riding') return 1;
  const t = rideTimeAt(g.troy.ride);
  const gathering = t < RIDE_SECONDS / 2 ? rideSpeedAt(t) : 1;
  const span = ROLL_PEAK - ROLL_FLOOR;
  return ROLL_FLOOR + span * (0.75 * gathering + 0.25 * (t / RIDE_SECONDS));
}

/** A one-line description of a command, for the ?debug=music log. */
export function describeCommand(c: MusicCommand): string {
  if (c.kind === 'stop') return `${c.cue}: stop(${c.fade})`;
  const opts = [c.then ? `then: '${c.then}'` : '', c.ending === false ? 'ending: false' : '', c.delay ? `after ${c.delay} s` : '']
    .filter(Boolean)
    .join(', ');
  return `${c.cue}: play('${c.id}'${opts ? `, { ${opts} }` : ''})`;
}
