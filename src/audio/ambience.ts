// The places and the water: four ambience beds crossfaded by where the sub is, and the water one-shots.
// The beds follow the sub's medium (the listener is the sub; the chase camera rides just behind it).
//
// Recipes —
//   Sea, below: brown noise low-passed at 320 Hz (darker with depth, down to 140 Hz at 200 m), breathing on a
//     16 s swell, over a faint 38 Hz pressure tone.
//   Sea, above: band-passed noise at 500 Hz swelling every 9 s (waves), a high spray hiss on its own 6 s cycle,
//     and a narrow resonant wind band at 250 Hz that drifts.
//   Tunnel (inside Marineville, under water): 50 Hz machinery hum with its 100 Hz harmonic, a 25 Hz sawtooth
//     under 90 Hz, and the bore's resonance — brown noise through a narrow 180 Hz band-pass that drifts slowly.
//   Hall (Pen 3, in air): 60 Hz mains hum and 120 Hz, air-handling hiss above 2.5 kHz, a soft pool lap.
//   Rooms (phase 3, on foot in the control tower): a low console hum — 50 Hz and a faint 150 Hz, a soft 3 kHz
//     relay hiss, and a slow 0.2 Hz swell.
//   Shaft rush (phase 3, riding the injector chair): white noise through a band-pass that climbs 250 Hz → 1.4 kHz
//     with the chair's speed, over brown-noise rumble low-passed at 160 Hz; both rise with the speed.
//   Hull under (clamped, going down): noise low-passed from 3 kHz down to 250 Hz over 1.3 s, with fourteen
//     rising bubble blips. Hull out (coming up): a 2.5 s pour of band-passed noise and scattered drips.
//   Splash: leap — a bright band-passed burst falling 1.4 kHz → 700 Hz and a few bubbles; re-entry — a 70 Hz
//     whump, a broad burst falling 2.5 kHz → 400 Hz and a cloud of bubbles. Both scale with speed.

import type { Soundscape } from './cues';
import { LEVELS as L } from './levels';
import type { Mixer } from './mixer';
import { burst, chirp, filter, lfo, loopGain, noise, osc, startNoise, thump } from './synth';

export interface Ambience {
  update(s: Soundscape): void;
  hullUnder(): void;
  hullOut(): void;
  splash(speed: number, reentry: boolean): void;
}

export function createAmbience(m: Mixer): Ambience {
  const ctx = m.ctx;
  const bus = m.ambience;
  const sources: Array<OscillatorNode | AudioBufferSourceNode> = [];
  const looped = (buffer: AudioBuffer) => {
    const n = noise(m, buffer);
    sources.push(n);
    return n;
  };
  const tonal = (type: OscillatorType, freq: number) => {
    const o = osc(m, type, freq);
    sources.push(o);
    return o;
  };
  const level = (value: number) => {
    const g = ctx.createGain();
    g.gain.value = value;
    return g;
  };

  // Sea, below
  const seaUnder = loopGain(m, bus);
  const underLp = filter(m, 'lowpass', 320, 0.6);
  const underBreath = level(0.75);
  looped(m.brown).connect(underLp).connect(underBreath).connect(seaUnder);
  lfo(m, underBreath.gain, 1 / 16, 0.25);
  tonal('sine', 38).connect(level(0.12)).connect(seaUnder);

  // Sea, above
  const seaAbove = loopGain(m, bus);
  const waves = level(0.6);
  looped(m.white).connect(filter(m, 'bandpass', 500, 0.5)).connect(waves).connect(seaAbove);
  lfo(m, waves.gain, 1 / 9, 0.45);
  const spray = level(0.08);
  looped(m.white).connect(filter(m, 'highpass', 3500)).connect(spray).connect(seaAbove);
  lfo(m, spray.gain, 1 / 6, 0.06);
  const windBp = filter(m, 'bandpass', 250, 4);
  looped(m.white).connect(windBp).connect(level(0.5)).connect(seaAbove);
  lfo(m, windBp.frequency, 1 / 20, 60);

  // Tunnel
  const tunnel = loopGain(m, bus);
  tonal('sine', 50).connect(level(0.3)).connect(tunnel);
  tonal('sine', 100).connect(level(0.1)).connect(tunnel);
  tonal('sawtooth', 25).connect(filter(m, 'lowpass', 90)).connect(level(0.4)).connect(tunnel);
  const boreBp = filter(m, 'bandpass', 180, 6);
  looped(m.brown).connect(boreBp).connect(level(1.4)).connect(tunnel);
  lfo(m, boreBp.frequency, 1 / 30, 25);

  // Hall
  const hall = loopGain(m, bus);
  tonal('sine', 60).connect(level(0.2)).connect(hall);
  tonal('sine', 120).connect(level(0.06)).connect(hall);
  looped(m.white).connect(filter(m, 'highpass', 2500)).connect(level(0.05)).connect(hall);
  const lap = level(0.3);
  looped(m.brown).connect(filter(m, 'lowpass', 400)).connect(lap).connect(hall);
  lfo(m, lap.gain, 0.3, 0.15);

  // Rooms (phase 3)
  const rooms = loopGain(m, bus);
  tonal('sine', 50).connect(level(0.25)).connect(rooms);
  tonal('sine', 150).connect(level(0.05)).connect(rooms);
  const relay = level(0.03);
  looped(m.white).connect(filter(m, 'bandpass', 3000, 2)).connect(relay).connect(rooms);
  lfo(m, relay.gain, 0.2, 0.015);

  // The shaft's rush (phase 3)
  const rush = loopGain(m, bus);
  const rushBp = filter(m, 'bandpass', 250, 0.8);
  looped(m.white).connect(rushBp).connect(level(0.7)).connect(rush);
  looped(m.brown).connect(filter(m, 'lowpass', 160)).connect(level(1.2)).connect(rush);

  for (const s of sources) {
    if (s instanceof AudioBufferSourceNode) startNoise(s, ctx.currentTime);
    else s.start();
  }

  const fx = m.effects;
  const bubbles = (t: number, count: number, spread: number, peak: number) => {
    for (let i = 0; i < count; i++) {
      const at = t + Math.random() * spread;
      const f = 250 + Math.random() * 450;
      chirp(m, fx, at, peak * (0.5 + Math.random() * 0.5), f, f * 1.8, 0.04 + Math.random() * 0.04);
    }
  };

  return {
    update(s) {
      const now = ctx.currentTime;
      const a = s.ambience;
      seaUnder.gain.setTargetAtTime(L.seaUnder * a.seaUnder, now, L.ambienceFade);
      seaAbove.gain.setTargetAtTime(L.seaAbove * a.seaAbove, now, L.ambienceFade);
      tunnel.gain.setTargetAtTime(L.tunnel * a.tunnel, now, L.ambienceFade);
      hall.gain.setTargetAtTime(L.hall * a.hall, now, L.ambienceFade);
      rooms.gain.setTargetAtTime(L.rooms * a.rooms, now, L.ambienceFade);
      // The rush rises with the chair's speed (quickly — it is the ride's sense of speed).
      rush.gain.setTargetAtTime(L.shaftRush * s.shaft.level * s.shaft.speed, now, 0.12);
      rushBp.frequency.setTargetAtTime(250 + 1150 * s.shaft.speed, now, 0.15);
      underLp.frequency.setTargetAtTime(320 - 180 * a.depth, now, 1);
    },

    hullUnder() {
      const t = ctx.currentTime + 0.01;
      burst(m, fx, t, { peak: L.water, type: 'lowpass', freq: 3000, to: 250, attack: 0.05, hold: 0.2, decay: 1.1 });
      bubbles(t + 0.1, 14, 1.2, L.water * 0.25);
    },

    hullOut() {
      const t = ctx.currentTime + 0.01;
      burst(m, fx, t, { peak: L.water * 0.8, type: 'bandpass', freq: 1800, q: 0.6, attack: 0.2, hold: 0.4, decay: 2.0 });
      for (let i = 0; i < 10; i++) {
        const at = t + 0.3 + Math.pow(Math.random(), 1.5) * 2.5;
        const f = 900 + Math.random() * 700;
        chirp(m, fx, at, L.water * 0.15, f, f * 1.6, 0.03);
      }
    },

    splash(speed, reentry) {
      const t = ctx.currentTime + 0.01;
      const k = Math.min(1, Math.max(0.3, speed / 40));
      if (reentry) {
        thump(m, fx, t, L.splash * k, 70, 40, 0.5);
        burst(m, fx, t, { peak: L.splash * k, type: 'lowpass', freq: 2500, to: 400, attack: 0.01, decay: 1.2 });
        bubbles(t + 0.1, 18, 1.0, L.splash * 0.2 * k);
      } else {
        burst(m, fx, t, { peak: L.splash * 0.8 * k, type: 'bandpass', freq: 1400, to: 700, q: 0.7, attack: 0.01, decay: 0.6 });
        bubbles(t, 6, 0.3, L.splash * 0.15 * k);
      }
    },
  };
}
