// Stingray's drive: a low throb with a turbine whine over it and water rushing past the hull.
//
// Recipe — throb: two slightly detuned sawtooths (32 Hz rising to ~60 Hz with speed and boost) through a 220 Hz
// low-pass, pulsed by a sine (4 Hz at rest → ~18 Hz flat out) for the screw's beat. Whine: a triangle plus a
// sine an octave and a hair above (380 Hz at idle → ~2 kHz on boost), louder with speed and boost. Wash: noise
// through a band-pass that opens with speed. All three pitches scale with the spin (0…1), so the 2 s start winds
// the hum up and stopping winds it down. The start adds a rising starter whine and five quickening ignition
// chuffs; the stop adds a sigh of released pressure.

import type { Soundscape } from './cues';
import { LEVELS as L } from './levels';
import type { Mixer } from './mixer';
import { burst, filter, lfo, loopGain, noise, osc, startNoise, thump, tone } from './synth';

export interface Engine {
  update(e: Soundscape['engine']): void;
  ignition(): void;
  stop(): void;
}

export function createEngine(m: Mixer): Engine {
  const ctx = m.ctx;

  // Throb
  const throbOut = loopGain(m, m.engine);
  const throbPulse = ctx.createGain();
  throbPulse.gain.value = 0.65;
  const throbLp = filter(m, 'lowpass', 220, 1.5);
  const sawA = osc(m, 'sawtooth', 32);
  const sawB = osc(m, 'sawtooth', 32 * 1.015);
  sawA.connect(throbLp);
  sawB.connect(throbLp);
  throbLp.connect(throbPulse).connect(throbOut);
  const beat = lfo(m, throbPulse.gain, 4, 0.35);

  // Whine
  const whineOut = loopGain(m, m.engine);
  const whineHp = filter(m, 'highpass', 200);
  const tri = osc(m, 'triangle', 380);
  const over = osc(m, 'sine', 380 * 2.01);
  const overLevel = ctx.createGain();
  overLevel.gain.value = 0.35;
  tri.connect(whineHp);
  over.connect(overLevel).connect(whineHp);
  whineHp.connect(whineOut);

  // Wash
  const washOut = loopGain(m, m.engine);
  const washBp = filter(m, 'bandpass', 500, 0.8);
  const wash = noise(m, m.white);
  wash.connect(washBp).connect(washOut);

  for (const o of [sawA, sawB, tri, over]) o.start();
  startNoise(wash, ctx.currentTime);

  let running = 0;
  return {
    update({ level, speed, boost }) {
      const now = ctx.currentTime;
      const tc = level < running ? L.engineSpinDown : L.engineSmoothing;
      running = level;
      const spin = 0.35 + 0.65 * level;
      const throbHz = (32 + 18 * speed + 10 * boost) * spin;
      sawA.frequency.setTargetAtTime(throbHz, now, tc);
      sawB.frequency.setTargetAtTime(throbHz * 1.015, now, tc);
      beat.frequency.setTargetAtTime((4 + 8 * speed + 6 * boost) * spin, now, tc);
      const whineHz = (380 + 900 * speed + 700 * boost) * spin;
      tri.frequency.setTargetAtTime(whineHz, now, tc);
      over.frequency.setTargetAtTime(whineHz * 2.01, now, tc);
      washBp.frequency.setTargetAtTime(500 + 1500 * speed, now, tc);

      throbOut.gain.setTargetAtTime(L.engineThrob * level * (0.6 + 0.4 * speed), now, tc);
      whineOut.gain.setTargetAtTime(L.engineWhine * level * (0.35 + 0.65 * speed + 0.6 * boost), now, tc);
      washOut.gain.setTargetAtTime(L.engineWash * level * (Math.pow(speed, 1.5) + 0.5 * boost), now, tc);
    },

    ignition() {
      const t = ctx.currentTime + 0.01;
      const [starter] = tone(m, m.engine, t, {
        types: ['sawtooth'], freqs: [60], filter: ['bandpass', 900, 2], peak: L.engineIgnition * 0.5, attack: 0.15, hold: 1.6, decay: 0.6,
      });
      starter?.frequency.setValueAtTime(60, t);
      starter?.frequency.exponentialRampToValueAtTime(520, t + 2);
      for (const at of [0.15, 0.55, 0.9, 1.2, 1.45]) {
        burst(m, m.engine, t + at, { peak: L.engineIgnition, type: 'lowpass', freq: 420, decay: 0.14, brown: true });
        thump(m, m.engine, t + at, L.engineIgnition * 0.8, 70, 45, 0.18);
      }
    },

    stop() {
      burst(m, m.engine, ctx.currentTime + 0.01, { peak: L.engineIgnition * 0.4, type: 'highpass', freq: 1500, attack: 0.03, decay: 0.8 });
    },
  };
}
