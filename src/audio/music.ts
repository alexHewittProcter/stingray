// The music engine (phase 4 S2): plays the score's sections through the mixer's music bus with a look-ahead
// scheduler — every frame it asks the pure core (sequence.ts) what falls in the next LOOK_AHEAD seconds of the
// audio clock and schedules those hits sample-accurately, the usual Web Audio pattern. The clock is the
// AudioContext's, so suspending the context (the pause menu) pauses the music and resuming carries on in place.
//
// Each play gets its own output gain (for its fade-in and its fade-out); the previous play's is faded out under it.
// A section marked `diegetic` (ALERT: the base's PA) goes to the effects bus instead, taking the room and muffle.

import { playHit } from './instruments';
import type { Mixer } from './mixer';
import { SCORE, type Score, type SectionId, stepSeconds } from './score';
import { type PlayOptions, type Sequence, advance, begin, bodyStart, finished, playingAt } from './sequence';

export interface MusicPlayOptions extends PlayOptions {
  /** Seconds to fade the new section in from silence (default: none). */
  fadeIn?: number;
}

export interface Music {
  /**
   * Play a section from its top, replacing whatever plays. A looping section (MARCH, ROLL, ALERT) plays until the
   * next play or stop; a one-shot plays once, then its `then` if given, then nothing. Leaving ROLL lands its brass
   * hit first (one bar) unless `ending: false`.
   */
  play(id: SectionId, opts?: MusicPlayOptions): void;
  /** Fade out over `fadeOut` seconds and stop scheduling. */
  stop(fadeOut?: number): void;
  /** The section asked for, while it sounds; null when nothing is playing. */
  playing(): SectionId | null;
  /** Once per drawn frame: schedule what falls in the look-ahead. */
  frame(): void;
  /** The music bus's gain (S4's Music switch: 0 = off); glides over `seconds`. */
  setLevel(gain: number, seconds?: number): void;
  /** Scale the velocity of every hit scheduled from now on (S3: the roll builds with the descent). 1 = as written. */
  setIntensity(k: number): void;
}

/** How long a finished play's output stays connected for its last notes to ring out. */
const TAIL = 3;
/** The crossfade when one play replaces another. */
const HANDOVER = 0.03;

export function createMusic(m: Mixer, score: Score = SCORE): Music {
  const ctx = m.ctx;
  const ss = stepSeconds(score);
  let seq: Sequence | null = null;
  let out: GainNode | null = null;
  let intensity = 1;

  const release = (node: GainNode, fade: number) => {
    const now = ctx.currentTime;
    const g = node.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + Math.max(fade, 0.005));
    setTimeout(() => node.disconnect(), (Math.max(fade, 0) + 0.5) * 1000);
  };

  const frame = () => {
    if (!seq || !out) return;
    const now = ctx.currentTime;
    const r = advance(score, seq, now);
    seq = r.seq;
    for (const h of r.hits) playHit(m, out, h, ss, intensity);
    if (finished(seq, now)) {
      const done = out;
      setTimeout(() => done.disconnect(), TAIL * 1000);
      seq = null;
      out = null;
    }
  };

  return {
    play(id, opts = {}) {
      const now = ctx.currentTime;
      const next = begin(score, now, id, opts, seq);
      if (out) release(out, HANDOVER);
      out = ctx.createGain();
      out.connect(score.sections[id].diegetic ? m.effects : m.music);
      if (opts.fadeIn && opts.fadeIn > 0) {
        const from = next.segments[0]?.part === 'ending' ? now : bodyStart(next);
        out.gain.setValueAtTime(0, from);
        out.gain.linearRampToValueAtTime(1, from + opts.fadeIn);
      } else {
        out.gain.value = 1;
      }
      seq = next;
      frame();
    },
    stop(fadeOut = 1) {
      if (out) release(out, fadeOut);
      out = null;
      seq = null;
    },
    playing: () => playingAt(seq, ctx.currentTime),
    frame,
    setLevel(gain, seconds = 0.3) {
      m.music.gain.setTargetAtTime(Math.max(0, gain), ctx.currentTime, Math.max(seconds, 0.01) / 3);
    },
    setIntensity(k) {
      intensity = Math.max(0, Math.min(1.5, k));
    },
  };
}
