// Small building blocks shared by the sound families. Every one-shot fades in from silence and out to silence
// (no hard gain steps while sounding, so no clicks) and disconnects itself when it has finished.

import type { Mixer } from './mixer';

/** Silence → peak over `attack`, held for `hold`, then an exponential fall over `decay` to silence. Returns the end time. */
export function envelope(p: AudioParam, t: number, peak: number, attack: number, decay: number, hold = 0): number {
  const top = Math.max(peak, 1e-4);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(top, t + attack);
  if (hold > 0) p.setValueAtTime(top, t + attack + hold);
  const end = t + attack + hold + decay;
  p.exponentialRampToValueAtTime(1e-4, end);
  p.linearRampToValueAtTime(0, end + 0.01);
  return end + 0.02;
}

/** A gain node into `dest` that disconnects once the sources feeding it have stopped. */
function voice(m: Mixer, dest: AudioNode, sources: AudioScheduledSourceNode[]): GainNode {
  const g = m.ctx.createGain();
  g.gain.value = 0;
  g.connect(dest);
  let left = sources.length;
  for (const s of sources) {
    s.onended = () => {
      left -= 1;
      if (left === 0) g.disconnect();
    };
  }
  return g;
}

export function osc(m: Mixer, type: OscillatorType, freq: number): OscillatorNode {
  const o = m.ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  return o;
}

export function filter(m: Mixer, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = m.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** A looping noise source started at a random point (so two never phase together). */
export function noise(m: Mixer, buffer: AudioBuffer): AudioBufferSourceNode {
  const s = m.ctx.createBufferSource();
  s.buffer = buffer;
  s.loop = true;
  return s;
}

export function startNoise(s: AudioBufferSourceNode, t: number, stop?: number): void {
  s.start(t, Math.random() * ((s.buffer?.duration ?? 2) - 0.1));
  if (stop !== undefined) s.stop(stop);
}

/** A falling sine: the body of every thud and boom. */
export function thump(m: Mixer, dest: AudioNode, t: number, peak: number, from: number, to: number, decay: number): void {
  const o = osc(m, 'sine', from);
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + decay * 0.8);
  const g = voice(m, dest, [o]);
  const end = envelope(g.gain, t, peak, 0.006, decay);
  o.connect(g);
  o.start(t);
  o.stop(end);
}

/** Struck steel: a few inharmonic partials, the higher ones dying first. */
export function metal(m: Mixer, dest: AudioNode, t: number, peak: number, base: number, decay: number): void {
  const partials: Array<[number, number, number]> = [
    [1, 1, 1],
    [1.51, 0.6, 0.7],
    [2.29, 0.4, 0.45],
    [3.17, 0.25, 0.3],
    [4.43, 0.15, 0.2],
  ];
  for (const [ratio, level, life] of partials) {
    const o = osc(m, 'sine', base * ratio * (1 + (Math.random() - 0.5) * 0.01));
    const g = voice(m, dest, [o]);
    const end = envelope(g.gain, t, peak * level, 0.002, decay * life);
    o.connect(g);
    o.start(t);
    o.stop(end);
  }
}

export interface Burst {
  peak: number;
  type: BiquadFilterType;
  freq: number;
  /** Sweep the filter to this frequency over the burst. */
  to?: number;
  q?: number;
  attack?: number;
  hold?: number;
  decay: number;
  brown?: boolean;
}

/** Filtered noise with an envelope: hiss, splash, crack, rumble. */
export function burst(m: Mixer, dest: AudioNode, t: number, b: Burst): void {
  const s = noise(m, b.brown ? m.brown : m.white);
  const f = filter(m, b.type, b.freq, b.q ?? 0.7);
  const attack = b.attack ?? 0.005;
  const length = attack + (b.hold ?? 0) + b.decay;
  if (b.to !== undefined) {
    f.frequency.setValueAtTime(b.freq, t);
    f.frequency.exponentialRampToValueAtTime(b.to, t + length);
  }
  const g = voice(m, dest, [s]);
  const end = envelope(g.gain, t, b.peak, attack, b.decay, b.hold ?? 0);
  s.connect(f).connect(g);
  startNoise(s, t, end);
}

/** A quick rising sine blip: one bubble, or one drip. */
export function chirp(m: Mixer, dest: AudioNode, t: number, peak: number, from: number, to: number, length: number): void {
  const o = osc(m, 'sine', from);
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + length);
  const g = voice(m, dest, [o]);
  const end = envelope(g.gain, t, peak, length * 0.15, length * 0.85);
  o.connect(g);
  o.start(t);
  o.stop(end);
}

/** A shaped tone: oscillators through a filter with an envelope. Returns the oscillators for further modulation. */
export function tone(
  m: Mixer,
  dest: AudioNode,
  t: number,
  spec: { types: OscillatorType[]; freqs: number[]; filter: [BiquadFilterType, number, number]; peak: number; attack: number; hold: number; decay: number },
): OscillatorNode[] {
  const oscs = spec.freqs.map((f, i) => osc(m, spec.types[i] ?? spec.types[0] ?? 'sine', f));
  const fl = filter(m, ...spec.filter);
  const g = voice(m, dest, oscs);
  const end = envelope(g.gain, t, spec.peak, spec.attack, spec.decay, spec.hold);
  for (const o of oscs) {
    o.connect(fl);
    o.start(t);
    o.stop(end);
  }
  fl.connect(g);
  return oscs;
}

/** A soft clipper for a horn's rasp. */
export function rasp(m: Mixer, amount: number): WaveShaperNode {
  const w = m.ctx.createWaveShaper();
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(amount * x) / Math.tanh(amount);
  }
  w.curve = curve;
  w.oversample = '2x';
  return w;
}

/** A constant-running loop: a source that starts now and plays for the session. */
export function loopGain(m: Mixer, dest: AudioNode): GainNode {
  const g = m.ctx.createGain();
  g.gain.value = 0;
  g.connect(dest);
  return g;
}

/** A slow sine wobble added onto a parameter: depth either side of the parameter's own value. */
export function lfo(m: Mixer, target: AudioParam, rate: number, depth: number): OscillatorNode {
  const o = osc(m, 'sine', rate);
  const d = m.ctx.createGain();
  d.gain.value = depth;
  o.connect(d).connect(target);
  o.start();
  return o;
}
