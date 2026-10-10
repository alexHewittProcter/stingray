// The score's five instruments (phase 4 S2), synthesised from the synth.ts building blocks like every other sound
// in the game. Each takes the time to sound at and a velocity, and cleans up after itself. music.ts calls `playHit`
// for every hit the scheduler hands it.

import { LEVELS } from './levels';
import type { Mixer } from './mixer';
import { midiHz, type Instrument } from './score';
import { burst, envelope, filter, osc, thump, tone } from './synth';

// Instrument levels live in levels.ts (LEVELS.music), with every other sound's.
const L = LEVELS.music;

export interface Strike {
  inst: Instrument;
  /** Audio-clock time. */
  time: number;
  vel: number;
  /** Length in seconds. */
  seconds: number;
  note?: number;
  roll?: number;
  len?: number;
  flam?: boolean;
  chord?: number[];
}

/** One hit of the score on `dest`. `stepSec` spaces a roll's sub-hits; `scale` multiplies the velocity (intensity). */
export function playHit(m: Mixer, dest: AudioNode, h: Strike, stepSec: number, scale = 1): void {
  const vel = Math.max(0, Math.min(1.5, h.vel * scale));
  if (vel <= 0) return;
  switch (h.inst) {
    case 'snare':
      return snare(m, dest, h.time, vel, h.roll, h.len ?? 1, stepSec, h.flam);
    case 'kick':
      return kick(m, dest, h.time, vel);
    case 'timp':
      return timp(m, dest, h.time, vel, h.note ?? 43, h.seconds, h.roll, h.len ?? 1, stepSec);
    case 'brass':
      return brass(m, dest, h.time, vel, [h.note ?? 67, ...(h.chord ?? []).map((c) => (h.note ?? 67) + c)], h.seconds);
    case 'bass':
      return bass(m, dest, h.time, vel, h.note ?? 43, h.seconds);
  }
}

/** The times and velocities of a roll's sub-hits: `roll` a step across `len` steps, rising to `vel`. */
export function rollStrokes(t: number, vel: number, roll: number, len: number, stepSec: number): Array<[number, number]> {
  const n = Math.max(1, Math.round(roll * len));
  const rise = len >= 8 ? L.longRollRise : L.rollRise;
  const gap = stepSec / roll;
  return Array.from({ length: n }, (_, i) => [t + i * gap, vel * (1 - rise + rise * (n === 1 ? 1 : i / (n - 1)))]);
}

// ── Snare: wires, stick, shell ────────────────────────────────────────────────────────────────────────────────

function snareStroke(m: Mixer, dest: AudioNode, t: number, g: number, short: boolean): void {
  const h = 1 + (Math.random() - 0.5) * 0.08; // a hand is never exactly even
  burst(m, dest, t, { peak: g * h * L.snareNoise, type: 'bandpass', freq: 1800 * h, q: 0.8, attack: 0.001, decay: short ? 0.06 : 0.12 });
  burst(m, dest, t, { peak: g * L.snareCrack, type: 'highpass', freq: 4500, attack: 0.0005, decay: 0.03 });
  thump(m, dest, t, g * L.snareBody * (short ? 0.6 : 1), 205, 170, short ? 0.04 : 0.07);
}

function snare(m: Mixer, dest: AudioNode, t: number, vel: number, roll: number | undefined, len: number, stepSec: number, flam?: boolean): void {
  if (flam) snareStroke(m, dest, Math.max(m.ctx.currentTime, t - L.flamAhead), vel * L.snareFlam, true);
  if (roll && roll > 0) {
    for (const [at, g] of rollStrokes(t, vel, roll, len, stepSec)) snareStroke(m, dest, at, g, true);
  } else {
    snareStroke(m, dest, t, vel, false);
  }
}

// ── Bass drum ─────────────────────────────────────────────────────────────────────────────────────────────────

function kick(m: Mixer, dest: AudioNode, t: number, vel: number): void {
  thump(m, dest, t, vel * L.kick, 115, 48, 0.34);
  burst(m, dest, t, { peak: vel * L.kick * 0.25, type: 'lowpass', freq: 500, attack: 0.001, decay: 0.04 });
}

// ── Timpani: a pitched thump with a long decay, its partials dying first ──────────────────────────────────────

function timpStroke(m: Mixer, dest: AudioNode, t: number, g: number, f: number, decay: number): void {
  thump(m, dest, t, g * L.timp, f * 1.04, f, decay);
  thump(m, dest, t, g * L.timp * 0.32, f * 1.52, f * 1.5, decay * 0.45);
  thump(m, dest, t, g * L.timp * 0.16, f * 2.02, f * 1.99, decay * 0.3);
  burst(m, dest, t, { peak: g * L.timp * 0.2, type: 'lowpass', freq: 700, attack: 0.001, decay: 0.05 });
}

function timp(m: Mixer, dest: AudioNode, t: number, vel: number, note: number, seconds: number, roll: number | undefined, len: number, stepSec: number): void {
  const f = midiHz(note);
  if (roll && roll > 0) {
    for (const [at, g] of rollStrokes(t, vel, roll, len, stepSec)) timpStroke(m, dest, at, g * 0.75, f, 0.35);
  } else {
    timpStroke(m, dest, t, vel, f, Math.max(0.9, seconds + 0.5));
  }
}

// ── Brass: per pitch, three sawtooths ±7 cents through a low-pass that opens with the envelope, light vibrato ───

function brass(m: Mixer, dest: AudioNode, t: number, vel: number, pitches: number[], seconds: number): void {
  const peak = (vel * L.brass) / Math.sqrt(pitches.length);
  for (const p of pitches) brassVoice(m, dest, t, peak, midiHz(p), vel, seconds);
}

function brassVoice(m: Mixer, dest: AudioNode, t: number, peak: number, f: number, vel: number, seconds: number): void {
  const ctx = m.ctx;
  const g = ctx.createGain();
  g.gain.value = 0;
  g.connect(dest);
  const attack = 0.022;
  const hold = Math.max(0, seconds - attack - 0.04);
  const end = envelope(g.gain, t, peak, attack, 0.13, hold);

  // The low-pass opens with the attack (brighter the harder it is played), then settles a little: the "blat".
  const lp = filter(m, 'lowpass', f * 1.3, 1.1);
  const open = Math.min(f * (3 + 5 * vel), ctx.sampleRate * 0.45);
  lp.frequency.setValueAtTime(f * 1.3, t);
  lp.frequency.linearRampToValueAtTime(open, t + attack * 1.4);
  lp.frequency.setTargetAtTime(Math.max(f * 1.6, open * 0.6), t + attack * 1.4, 0.18);
  lp.connect(g);

  // Vibrato, coming in only on held notes.
  const vib = osc(m, 'sine', 5.4);
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, t);
  depth.gain.linearRampToValueAtTime(seconds > 0.3 ? L.brassVibrato : 0, t + Math.min(0.35, seconds));
  vib.connect(depth);

  const saws = [-7, 0, 7].map((cents) => {
    const o = osc(m, 'sawtooth', f);
    o.detune.value = cents;
    o.frequency.setValueAtTime(f * 0.985, t); // a small scoop up into the note
    o.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    depth.connect(o.detune);
    o.connect(lp);
    o.start(t);
    o.stop(end);
    return o;
  });
  vib.start(t);
  vib.stop(end);
  saws[saws.length - 1]!.onended = () => {
    g.disconnect();
    lp.disconnect();
    depth.disconnect();
  };
}

// ── Bass: a triangle, with a quiet octave above so it speaks on small speakers ───────────────────────────────

function bass(m: Mixer, dest: AudioNode, t: number, vel: number, note: number, seconds: number): void {
  const f = midiHz(note);
  const hold = Math.max(0, seconds * 0.8 - 0.006);
  tone(m, dest, t, { types: ['triangle'], freqs: [f], filter: ['lowpass', 1400, 0.7], peak: vel * L.bass, attack: 0.006, hold, decay: 0.09 });
  tone(m, dest, t, { types: ['triangle'], freqs: [f * 2], filter: ['lowpass', 1400, 0.7], peak: vel * L.bass * 0.22, attack: 0.006, hold, decay: 0.07 });
}
