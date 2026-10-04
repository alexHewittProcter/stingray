// The decision layer (L7): what should sound, read from the sim's state and its step-to-step change.
// Pure — no Web Audio, no DOM — so it is unit-tested; the synth modules only play what this returns.
//
// Events come from one fixed step's (previous, current) pair, so a frame that runs several steps hears each
// step once and a frame that runs none hears nothing twice. Continuous parameters come from the current state.
// The listener is the sub: the chase camera rides a few metres behind it, and the ambience follows the sub's
// medium (submerged → the underwater beds; surface or airborne → the above-water beds).

import type { GameMode } from '../game/mode';
import { modeOf } from '../game/mode';
import type { GameState } from '../sim/launch';
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
  | { kind: 'refusal' };

export interface Soundscape {
  /** 0 off … 1 running (follows the 2 s start); speed and boost in 0…1. */
  engine: { level: number; speed: number; boost: number };
  /** The cradle's hydraulics: 1 while it moves; dir 1 lowering, -1 raising. */
  hydraulics: { level: number; dir: -1 | 0 | 1 };
  /** Door machinery: 1 × distance gain while it moves, else 0. */
  door: number;
  /** Ambience beds, each 0 or 1 (the synth crossfades); depth 0 at the surface … 1 at 200 m. */
  ambience: { seaUnder: number; seaAbove: number; tunnel: number; hall: number; depth: number };
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
  const a = prev.launch;
  const b = cur.launch;
  const out: SoundEvent[] = [];

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
  const doorGain = distanceGain(distance(cur.sub.pos, DOOR_CENTRE), L.doorReference);
  if (a.doorDir === 0 && b.doorDir !== 0) out.push({ kind: 'doorStart', gain: doorGain });
  if (a.door < 1 && b.door >= 1) out.push({ kind: 'doorOpened', gain: doorGain });
  if (a.door > 0 && b.door <= 0) out.push({ kind: 'doorSeal', gain: doorGain });

  // Weapons: a launch resets the cooldown upward (it covers a launch that detonates at the door, too)
  if (cur.combat.cooldown > prev.combat.cooldown) out.push({ kind: 'missile' });
  const blasts = cur.combat.detonations
    .map((p) => distance(cur.sub.pos, p))
    .sort((x, y) => x - y)
    .slice(0, L.detonationMaxPerStep);
  const underwater = cur.sub.medium === 'submerged';
  for (const d of blasts) {
    out.push({ kind: 'detonation', distance: d, gain: distanceGain(d, L.detonationReference), muffle: muffleFor(d, underwater) });
  }

  // A press refused during this step (a fresh refusal is age 0; the step after, it has aged)
  if (b.refusal && b.refusal.age === 0) out.push({ kind: 'refusal' });
  return out;
}

/** The continuous parameters for the current state. */
export function soundscape(cur: GameState, mode: GameMode = modeOf(cur.sub.pos)): Soundscape {
  const l = cur.launch;
  const speed = speedOf(cur.sub);
  const level = l.engines === 'on' ? 1 : l.engines === 'starting' ? clamp01(l.engineStart / T.engineStart) : 0;
  const underwater = cur.sub.medium === 'submerged';
  const inside = mode === 'launch';
  return {
    engine: {
      level,
      speed: level > 0 ? clamp01(speed / T.cruiseSpeed) : 0,
      boost: level > 0 ? clamp01((speed - T.cruiseSpeed) / (T.boostSpeed - T.cruiseSpeed)) : 0,
    },
    hydraulics: { level: l.cradleDir !== 0 ? 1 : 0, dir: l.cradleDir },
    door: l.doorDir !== 0 ? distanceGain(distance(cur.sub.pos, DOOR_CENTRE), L.doorReference) : 0,
    ambience: {
      seaUnder: !inside && underwater ? 1 : 0,
      seaAbove: !inside && !underwater ? 1 : 0,
      tunnel: inside && underwater ? 1 : 0,
      hall: inside && !underwater ? 1 : 0,
      depth: clamp01(-cur.sub.pos.y / 200),
    },
    underwater,
  };
}

// The door's centre is tunnelMouth (L1), fixed for the session.
const DOOR_CENTRE: Vec3 = MARINEVILLE.interior.door.centre;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
