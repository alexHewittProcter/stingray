// The decision layer (L7): what should sound, read from the sim's state and its step-to-step change.
// Pure — no Web Audio, no DOM — so it is unit-tested; the synth modules only play what this returns.
//
// Events come from one fixed step's (previous, current) pair, so a frame that runs several steps hears each
// step once and a frame that runs none hears nothing twice. Continuous parameters come from the current state.
// The listener (phase 3, M6 "Sound") follows Troy on foot and riding, and the sub aboard (the chase camera rides a few
// metres behind it); the ambience is picked by the session mode (M7) — the rooms' console hum on foot, the shaft's rush
// riding (the hall's hum joining as the chair drops into Pen 3), and aboard phase 2's beds by the sub's medium
// (submerged → the underwater beds; surface or airborne → the above-water beds).

import type { GameMode } from '../game/mode';
import { sessionMode } from '../game/mode';
import type { GameState } from '../sim/launch';
import { rideSpeedAt, rideTimeAt } from '../sim/ride';
import { speedOf } from '../sim/sub';
import { TUNING as T } from '../sim/tuning';
import type { Vec3 } from '../sim/vec3';
import { MARINEVILLE } from '../sim/world';
import { LEVELS as L } from './levels';

export type SoundEvent =
  | { kind: 'klaxon' } // the cradle starts to lower
  | { kind: 'cradleStart'; dir: 1 | -1 } // hydraulic valves open (1 = lowering)
  | { kind: 'cradleStop' } // the clunk at either end of travel
  | { kind: 'engineStart' } // the 2 s start begins
  | { kind: 'engineStop' }
  | { kind: 'clampsRelease' }
  | { kind: 'clampsLock' }
  | { kind: 'hullUnder' } // the clamped craft goes under (y = 0, downward)
  | { kind: 'hullOut' } // and comes out
  | { kind: 'doorStart'; gain: number } // the door starts to move (either way)
  | { kind: 'doorOpened'; gain: number } // it reaches fully open
  | { kind: 'doorSeal'; gain: number } // it shuts
  | { kind: 'leap'; speed: number } // the released sub leaves the water
  | { kind: 'reentry'; speed: number } // and comes back in
  | { kind: 'missile' }
  | { kind: 'detonation'; distance: number; gain: number; muffle: number }
  | { kind: 'refusal' }
  | { kind: 'chairStart' } // phase 3 (M6): Troy sits and the injector chair's carriage lets go
  | { kind: 'lockIn' } // and it locks into Stingray's cabin as the pilot's seat
  | { kind: 'chairUnlock' } // M6b: the way back up — the seat unlocks from the cabin with the lock-in's clunk
  | { kind: 'chairHome' }; // and it latches home at the station, where Troy stands up

export interface Soundscape {
  /** 0 off … 1 running (follows the 2 s start); speed and boost in 0…1. */
  engine: { level: number; speed: number; boost: number };
  /** The cradle's hydraulics: 1 while it moves; dir 1 lowering, -1 raising. */
  hydraulics: { level: number; dir: -1 | 0 | 1 };
  /** Door machinery: 1 × distance gain while it moves, else 0. */
  door: number;
  /**
   * Ambience beds, each 0 or 1 (the synth crossfades); depth 0 at the surface … 1 at 200 m. Phase 3: `rooms` is the
   * control tower's console hum (on foot).
   */
  ambience: { seaUnder: number; seaAbove: number; tunnel: number; hall: number; rooms: number; depth: number };
  /**
   * Phase 3 (M6): the injector shaft's rush while riding — level 0/1, speed 0…1 of the chair's cruise. The ascent (M6b)
   * runs the descent's timetable backwards, so the speed at a point is the same both ways: rising from the seat,
   * falling to rest at the top.
   */
  shaft: { level: number; speed: number };
  /** The listener is under water: muffle effects and the engine. */
  underwater: boolean;
}

/** A step this long or longer is a discontinuity (teleport, R) even if nobody said so. 60 m/s is 1 m a step. */
export const JUMP_DISTANCE = 10;

/** Loudness of a source this far away: 1 at the listener, ½ at the reference distance. */
export function distanceGain(distance: number, reference: number): number {
  return reference / (reference + Math.max(distance, 0));
}

/** 0 (crisp) … 1 (fully dulled) for a detonation this far away, or under water. */
export function muffleFor(distance: number, underwater: boolean): number {
  const far = distance / (distance + 150);
  return Math.min(1, underwater ? 0.35 + 0.65 * far : far);
}

/** The events one fixed step produced. None across a discontinuity. */
export function stepEvents(prev: GameState, cur: GameState, jumped = false): SoundEvent[] {
  if (jumped || distance(prev.sub.pos, cur.sub.pos) >= JUMP_DISTANCE) return [];
  if (distance(listenerOf(prev), listenerOf(cur)) >= JUMP_DISTANCE) return [];
  const a = prev.launch;
  const b = cur.launch;
  const out: SoundEvent[] = [];
  const ear = listenerOf(cur);

  // The injector chair (phase 3, M6): the sit, and the lock-in at the foot of the shaft; M6b "the same reversed up": the
  // unlock from the cabin, and the chair home at the station as Troy stands up.
  if (prev.troy.where === 'onFoot' && cur.troy.where === 'riding') out.push({ kind: 'chairStart' });
  if (prev.troy.where === 'riding' && cur.troy.where === 'aboard') out.push({ kind: 'lockIn' });
  if (prev.troy.where === 'aboard' && cur.troy.where === 'riding') out.push({ kind: 'chairUnlock' });
  if (prev.troy.where === 'riding' && cur.troy.where === 'onFoot') out.push({ kind: 'chairHome' });

  // Cradle
  if (a.cradleDir === 0 && b.cradleDir !== 0) {
    if (b.cradleDir === 1) out.push({ kind: 'klaxon' });
    out.push({ kind: 'cradleStart', dir: b.cradleDir });
  }
  if (a.cradleDir !== 0 && b.cradleDir === 0) out.push({ kind: 'cradleStop' });

  // Engines
  if (a.engines === 'off' && b.engines === 'starting') out.push({ kind: 'engineStart' });
  if (a.engines !== 'off' && b.engines === 'off') out.push({ kind: 'engineStop' });

  // Clamps
  if (a.clamps === 'locked' && b.clamps === 'released') out.push({ kind: 'clampsRelease' });
  if (a.clamps === 'released' && b.clamps === 'locked') out.push({ kind: 'clampsLock' });

  // Water: the clamped craft crossing y = 0; the released one leaping and re-entering
  const y0 = prev.sub.pos.y;
  const y1 = cur.sub.pos.y;
  if (a.clamps === 'locked' && b.clamps === 'locked') {
    if (y0 > 0 && y1 <= 0) out.push({ kind: 'hullUnder' });
    if (y0 <= 0 && y1 > 0) out.push({ kind: 'hullOut' });
  } else if (a.clamps === 'released' && b.clamps === 'released') {
    const m0 = prev.sub.medium;
    const m1 = cur.sub.medium;
    if (m0 !== 'airborne' && m1 === 'airborne') out.push({ kind: 'leap', speed: speedOf(prev.sub) });
    if (m0 === 'airborne' && m1 !== 'airborne') out.push({ kind: 'reentry', speed: speedOf(prev.sub) });
  }

  // The ocean door
  const doorGain = distanceGain(distance(ear, DOOR_CENTRE), L.doorReference);
  if (a.doorDir === 0 && b.doorDir !== 0) out.push({ kind: 'doorStart', gain: doorGain });
  if (a.door < 1 && b.door >= 1) out.push({ kind: 'doorOpened', gain: doorGain });
  if (a.door > 0 && b.door <= 0) out.push({ kind: 'doorSeal', gain: doorGain });

  // Weapons: a launch resets the cooldown upward (it covers a launch that detonates at the door, too)
  if (cur.combat.cooldown > prev.combat.cooldown) out.push({ kind: 'missile' });
  const blasts = cur.combat.detonations
    .map((p) => distance(ear, p))
    .sort((x, y) => x - y)
    .slice(0, L.detonationMaxPerStep);
  const underwater = listenerUnderwater(cur);
  for (const d of blasts) {
    out.push({ kind: 'detonation', distance: d, gain: distanceGain(d, L.detonationReference), muffle: muffleFor(d, underwater) });
  }

  // A press refused during this step (a fresh refusal is age 0; the step after, it has aged)
  if (b.refusal && b.refusal.age === 0) out.push({ kind: 'refusal' });
  return out;
}

/** Phase 3 (M6): where the sound is heard from — Troy on foot or riding, the sub aboard. */
export function listenerOf(g: GameState): Vec3 {
  return g.troy.where === 'aboard' ? g.sub.pos : g.troy.pos;
}

/** The listener is under water only aboard a submerged sub (Troy's rooms and the shaft are dry). */
export function listenerUnderwater(g: GameState): boolean {
  return g.troy.where === 'aboard' && g.sub.medium === 'submerged';
}

/** The continuous parameters for the current state; the ambience by the session mode (M7). */
export function soundscape(cur: GameState, mode: GameMode = sessionMode(cur)): Soundscape {
  const l = cur.launch;
  const speed = speedOf(cur.sub);
  const level = l.engines === 'on' ? 1 : l.engines === 'starting' ? clamp01(l.engineStart / T.engineStart) : 0;
  const underwater = listenerUnderwater(cur);
  const aboard = mode === 'launch' || mode === 'piloting';
  const inside = mode === 'launch';
  const riding = mode === 'transport';
  // Riding, the hall's hum joins as the chair drops out of the tube into Pen 3.
  const inHall = riding && cur.troy.pos.y < MARINEVILLE.interior.pen.max.y + 2;
  return {
    engine: {
      level,
      speed: level > 0 ? clamp01(speed / T.cruiseSpeed) : 0,
      boost: level > 0 ? clamp01((speed - T.cruiseSpeed) / (T.boostSpeed - T.cruiseSpeed)) : 0,
    },
    hydraulics: { level: l.cradleDir !== 0 ? 1 : 0, dir: l.cradleDir },
    door: l.doorDir !== 0 ? distanceGain(distance(listenerOf(cur), DOOR_CENTRE), L.doorReference) : 0,
    ambience: {
      seaUnder: aboard && !inside && underwater ? 1 : 0,
      seaAbove: aboard && !inside && !underwater ? 1 : 0,
      tunnel: inside && underwater ? 1 : 0,
      hall: (inside && !underwater) || inHall ? 1 : 0,
      rooms: mode === 'onFoot' ? 1 : 0,
      depth: aboard ? clamp01(-cur.sub.pos.y / 200) : 0,
    },
    shaft: { level: riding ? 1 : 0, speed: riding ? rideSpeedAt(rideTimeAt(cur.troy.ride)) : 0 },
    underwater,
  };
}

// The door's centre is tunnelMouth (L1), fixed for the session.
const DOOR_CENTRE: Vec3 = MARINEVILLE.interior.door.centre;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
