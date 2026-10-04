// Missiles and detonations.
//
// Recipes —
//   Launch: a 140 → 45 Hz pop as it leaves the tube, a whoosh of resonant band-passed noise sweeping 300 Hz →
//     2.6 kHz over 0.7 s, and a low sawtooth motor rising 90 → 160 Hz. (Under water the whole effects bus is
//     low-passed, so it reads as a muffled thunk-and-rush.)
//   Detonation: a deep 55 → 22 Hz boom over 1.6 s, a body of noise whose low-pass falls from ~5 kHz (close) to
//     ~200 Hz (far or under water), a sharp high crack that fades with the same dulling, and a 3 s brown rumble
//     tail. Gain falls with distance; it arrives late by distance over the speed of sound (1500 m/s in water,
//     343 in air), capped at 0.4 s.

import { LEVELS as L } from './levels';
import type { Mixer } from './mixer';
import { burst, thump, tone } from './synth';

export interface Weapons {
  missile(): void;
  detonation(distance: number, gain: number, muffle: number, underwater: boolean): void;
}

export function createWeapons(m: Mixer): Weapons {
  const ctx = m.ctx;
  const fx = m.effects;
  return {
    missile() {
      const t = ctx.currentTime + 0.01;
      thump(m, fx, t, L.missile * 0.8, 140, 45, 0.25);
      burst(m, fx, t, { peak: L.missile, type: 'bandpass', freq: 300, to: 2600, q: 3, attack: 0.02, decay: 0.8 });
      const [motor] = tone(m, fx, t, {
        types: ['sawtooth'], freqs: [90], filter: ['lowpass', 600, 0.7], peak: L.missile * 0.15, attack: 0.05, hold: 0.2, decay: 0.4,
      });
      motor?.frequency.setValueAtTime(90, t);
      motor?.frequency.exponentialRampToValueAtTime(160, t + 0.6);
    },

    detonation(distance, gain, muffle, underwater) {
      const delay = Math.min(distance / (underwater ? 1500 : 343), 0.4);
      const t = ctx.currentTime + 0.01 + delay;
      const g = L.detonation * gain;
      const clear = 1 - muffle;
      thump(m, fx, t, g, 55, 22, 1.6);
      burst(m, fx, t, { peak: g * 0.8, type: 'lowpass', freq: 180 + 4800 * clear, to: 120 + 600 * clear, attack: 0.004, decay: 1.8 });
      if (clear > 0.05) burst(m, fx, t, { peak: g * 0.5 * clear, type: 'highpass', freq: 2000, attack: 0.001, decay: 0.08 });
      burst(m, fx, t + 0.05, { peak: g * 0.5, type: 'lowpass', freq: 120, attack: 0.1, decay: 3, brown: true });
    },
  };
}
