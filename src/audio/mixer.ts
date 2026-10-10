// The shared mixer: four buses, an underwater muffle, a room, and a master chain that cannot clip.
//
//   engine bus ─┐
//   effects bus ┴→ muffle (low-pass: shut under water) ─→ dry ─────────────→ master → compressor → limiter → out
//                                                     └→ room send → reverb ┘
//   ambience bus ─────────────────────────────────────────────────────────→ master
//   ui (refusal buzz) ─────────────────────────────────────────────────────→ master
//   music bus (phase 4 S2: the score — non-diegetic, so no muffle, no room) ─→ master
//
// The reverb's impulse is generated noise (no file); the room send is wide in the pen and tunnel, slight at sea.

import { LEVELS as L } from './levels';

export interface Mixer {
  ctx: AudioContext;
  engine: GainNode;
  effects: GainNode;
  ambience: GainNode;
  ui: GainNode;
  /** The score (music.ts). Straight to master: the muffle and the room never touch it; master mutes it with the rest. */
  music: GainNode;
  /** Two seconds of white noise and of brown (deep, rumbling) noise, for looping and bursts. */
  white: AudioBuffer;
  brown: AudioBuffer;
  setMuted(muted: boolean): void;
  /** Smoothly follow where the listener is: under water or not, and how much room (0 open sea … 1 the pen). */
  setPlace(underwater: boolean, room: number): void;
}

export function createMixer(ctx: AudioContext, muted: boolean): Mixer {
  const master = gain(ctx, muted ? 0 : L.master);

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.knee.value = 12;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.25;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;
  master.connect(compressor).connect(limiter).connect(ctx.destination);

  const muffle = ctx.createBiquadFilter();
  muffle.type = 'lowpass';
  const open = Math.min(L.airCutoff, ctx.sampleRate * 0.45);
  muffle.frequency.value = open;
  muffle.Q.value = 0.5;
  muffle.connect(master);

  const roomSend = gain(ctx, 0.2);
  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, 2.4);
  muffle.connect(roomSend).connect(reverb).connect(master);

  const engine = gain(ctx, L.engineBus);
  const effects = gain(ctx, L.effectsBus);
  engine.connect(muffle);
  effects.connect(muffle);
  const ambience = gain(ctx, L.ambienceBus);
  ambience.connect(master);
  const ui = gain(ctx, L.effectsBus);
  ui.connect(master);
  // LEVELS.musicBus arrives with T6 (levels.ts is another task's file in T5); until then the readme's 0.35.
  const music = gain(ctx, (L as unknown as { musicBus?: number }).musicBus ?? 0.35);
  music.connect(master);

  return {
    ctx,
    engine,
    effects,
    ambience,
    ui,
    music,
    white: noiseBuffer(ctx, 'white'),
    brown: noiseBuffer(ctx, 'brown'),
    setMuted(m) {
      master.gain.setTargetAtTime(m ? 0 : L.master, ctx.currentTime, 0.05);
    },
    setPlace(underwater, room) {
      const now = ctx.currentTime;
      muffle.frequency.setTargetAtTime(underwater ? L.underwaterCutoff : open, now, 0.08);
      roomSend.gain.setTargetAtTime(room, now, 0.5);
    },
  };
}

function gain(ctx: AudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

function noiseBuffer(ctx: AudioContext, colour: 'white' | 'brown'): AudioBuffer {
  const length = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    if (colour === 'white') data[i] = white;
    else {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  }
  // Fade the loop seam so looping it does not tick.
  const seam = Math.floor(ctx.sampleRate * 0.01);
  for (let i = 0; i < seam; i++) {
    const k = i / seam;
    data[i] = (data[i] ?? 0) * k;
    data[length - 1 - i] = (data[length - 1 - i] ?? 0) * k;
  }
  return buffer;
}

/** A stereo room: decaying noise, darker as it decays, with a short pre-delay. */
function impulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  const pre = Math.floor(ctx.sampleRate * 0.02);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let smooth = 0;
    for (let i = pre; i < length; i++) {
      const t = (i - pre) / (length - pre);
      const k = 0.15 + 0.8 * t; // more smoothing (darker) later in the tail
      smooth = smooth * k + (Math.random() * 2 - 1) * (1 - k);
      data[i] = smooth * Math.pow(1 - t, 3) * 2;
    }
  }
  return buffer;
}
