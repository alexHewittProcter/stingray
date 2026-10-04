// Pen 3's machinery and the ocean door: heavy, slow, hydraulic. Plus the panel's refusal buzz.
//
// Recipes —
//   Klaxon: three 0.55 s blasts, 0.3 s apart; two rasping sawtooths a sixth apart (155 + 233 Hz) that scoop up
//     into pitch, soft-clipped and band-passed at 750 Hz so it honks rather than beeps. The room reverb carries it.
//   Hydraulics (while the cradle moves): a 48 Hz pump drone, low-passed noise for fluid, and a faint valve whine
//     (190 Hz lowering, 240 Hz raising) with a slow vibrato. A valve hiss and a clank as it starts.
//   Cradle stop: a falling 55 → 35 Hz thud, a struck-steel ring at 180 Hz and a short low click.
//   Clamps: release — two clanks a beat apart (port, starboard) and a pneumatic hiss; lock — a heavier thud and
//     clank, a shorter hiss.
//   Door machinery (while it moves): a 41 Hz geared drone pulsed at 6.5 Hz (the teeth), deep rumble and a
//     band-passed grind; all scaled by distance from the door. Starts with a clank, stops open with a thud, and
//     shuts with the seal: a big 48 → 28 Hz boom, a low rumble burst, a long dark steel ring and a water-pressure hiss.
//   Refusal: two quick 98 + 104 Hz square buzzes, low-passed — a dull "bzz-bzz", not a beep.

import type { Soundscape } from './cues';
import { LEVELS as L } from './levels';
import type { Mixer } from './mixer';
import { burst, filter, lfo, loopGain, metal, noise, osc, rasp, startNoise, thump, tone } from './synth';

export interface Machinery {
  update(s: Soundscape): void;
  klaxon(): void;
  cradleStart(dir: 1 | -1): void;
  cradleStop(): void;
  clamps(release: boolean): void;
  doorStart(gain: number): void;
  doorOpened(gain: number): void;
  doorSeal(gain: number): void;
  refusal(): void;
}

export function createMachinery(m: Mixer): Machinery {
  const ctx = m.ctx;
  const fx = m.effects;

  // Hydraulics bed
  const hyd = loopGain(m, fx);
  const pump = osc(m, 'sawtooth', 48);
  const pumpLp = filter(m, 'lowpass', 160);
  pump.connect(pumpLp).connect(hyd);
  const fluid = noise(m, m.brown);
  const fluidLevel = ctx.createGain();
  fluidLevel.gain.value = 0.6;
  fluid.connect(filter(m, 'lowpass', 260)).connect(fluidLevel).connect(hyd);
  const valve = osc(m, 'sine', 190);
  const valveLevel = ctx.createGain();
  valveLevel.gain.value = 0.08;
  valve.connect(valveLevel).connect(hyd);
  lfo(m, valve.frequency, 5, 4);

  // Door bed
  const door = loopGain(m, fx);
  const gears = ctx.createGain();
  gears.gain.value = 0.6;
  const gearSaw = osc(m, 'sawtooth', 41);
  gearSaw.connect(filter(m, 'lowpass', 300)).connect(gears).connect(door);
  lfo(m, gears.gain, 6.5, 0.4);
  const rumble = noise(m, m.brown);
  rumble.connect(filter(m, 'lowpass', 110)).connect(door);
  const grind = noise(m, m.white);
  const grindLevel = ctx.createGain();
  grindLevel.gain.value = 0.12;
  grind.connect(filter(m, 'bandpass', 600, 3)).connect(grindLevel).connect(door);
  lfo(m, grindLevel.gain, 6.5, 0.08);

  for (const o of [pump, valve, gearSaw]) o.start();
  for (const n of [fluid, rumble, grind]) startNoise(n, ctx.currentTime);

  const soon = () => ctx.currentTime + 0.01;

  return {
    update(s) {
      const now = ctx.currentTime;
      hyd.gain.setTargetAtTime(L.hydraulics * s.hydraulics.level, now, 0.15);
      if (s.hydraulics.dir !== 0) valve.frequency.setTargetAtTime(s.hydraulics.dir === 1 ? 190 : 240, now, 0.3);
      door.gain.setTargetAtTime(L.doorMachinery * s.door, now, 0.25);
    },

    klaxon() {
      const t0 = soon();
      for (let k = 0; k < 3; k++) {
        const t = t0 + k * 0.85;
        // Two sawtooths → soft clip → band-pass → the klaxon's level → the effects bus.
        const out = ctx.createGain();
        out.gain.value = L.klaxon;
        out.connect(fx);
        const shaper = rasp(m, 3);
        shaper.connect(filter(m, 'bandpass', 750, 1.2)).connect(out);
        const oscs = tone(m, shaper, t, {
          types: ['sawtooth', 'sawtooth'], freqs: [155, 233], filter: ['lowpass', 4000, 0.7], peak: 1, attack: 0.03, hold: 0.5, decay: 0.08,
        });
        // The horn scoops up into pitch.
        for (const o of oscs) {
          const f = o.frequency.value;
          o.frequency.setValueAtTime(f * 0.94, t);
          o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
        }
        oscs[0]?.addEventListener('ended', () => out.disconnect());
      }
    },

    cradleStart() {
      const t = soon();
      burst(m, fx, t, { peak: L.clamps * 0.5, type: 'highpass', freq: 2500, attack: 0.02, decay: 0.6 });
      metal(m, fx, t, L.clunk * 0.3, 210, 0.5);
    },

    cradleStop() {
      const t = soon();
      thump(m, fx, t, L.clunk, 55, 35, 0.5);
      metal(m, fx, t, L.clunk * 0.35, 180, 0.9);
      burst(m, fx, t, { peak: L.clunk * 0.5, type: 'lowpass', freq: 900, decay: 0.08 });
    },

    clamps(release) {
      const t = soon();
      if (release) {
        metal(m, fx, t, L.clamps * 0.6, 340, 0.5);
        metal(m, fx, t + 0.09, L.clamps * 0.5, 310, 0.5);
        thump(m, fx, t, L.clamps * 0.5, 90, 60, 0.2);
        burst(m, fx, t + 0.05, { peak: L.clamps * 0.45, type: 'highpass', freq: 1800, attack: 0.02, decay: 0.7 });
      } else {
        thump(m, fx, t, L.clamps * 0.9, 70, 40, 0.35);
        metal(m, fx, t, L.clamps * 0.6, 260, 0.6);
        metal(m, fx, t + 0.06, L.clamps * 0.45, 245, 0.5);
        burst(m, fx, t + 0.04, { peak: L.clamps * 0.35, type: 'highpass', freq: 1800, attack: 0.01, decay: 0.3 });
      }
    },

    doorStart(gain) {
      const t = soon();
      metal(m, fx, t, L.doorSeal * 0.3 * gain, 120, 0.8);
      thump(m, fx, t, L.doorSeal * 0.4 * gain, 50, 35, 0.4);
    },

    doorOpened(gain) {
      const t = soon();
      thump(m, fx, t, L.doorSeal * 0.6 * gain, 60, 40, 0.6);
      metal(m, fx, t, L.doorSeal * 0.25 * gain, 150, 1.0);
    },

    doorSeal(gain) {
      const t = soon();
      thump(m, fx, t, L.doorSeal * gain, 48, 28, 1.4);
      burst(m, fx, t, { peak: L.doorSeal * 0.6 * gain, type: 'lowpass', freq: 220, decay: 1.0, brown: true });
      metal(m, fx, t, L.doorSeal * 0.3 * gain, 95, 1.6);
      burst(m, fx, t + 0.05, { peak: L.doorSeal * 0.2 * gain, type: 'bandpass', freq: 1200, q: 1, attack: 0.02, decay: 0.5 });
    },

    refusal() {
      const t = soon();
      for (const at of [0, 0.17]) {
        tone(m, m.ui, t + at, {
          types: ['square', 'square'], freqs: [98, 104], filter: ['lowpass', 900, 0.7], peak: L.refusal, attack: 0.01, hold: 0.1, decay: 0.04,
        });
      }
    },
  };
}
