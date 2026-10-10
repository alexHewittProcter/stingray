// DEV ONLY (phase 4 T5): the score's listening page, /score.html under `pnpm dev`. Imported by nothing in the game.
//
//   /score.html                    buttons: play any section, ROLL → MARCH (lands the brass hit), stop; sliders for
//                                  intensity and the music bus
//   /score.html?play=MARCH         also try to start a section on load (needs a gesture, or Chrome's
//                                  --autoplay-policy=no-user-gesture-required)
//   /score.html?render=MARCH&seconds=12
//                                  render offline (OfflineAudioContext — works in headless Chrome, which has no audio
//                                  out) and log peak / RMS / per-beat loudness to the console: proof the voices sound
//   …&dump=1                       also write the render as a base64 16-bit WAV into <pre id="wav"> (for --dump-dom)

import { playHit } from './audio/instruments';
import { createMixer, type Mixer } from './audio/mixer';
import { type Music, createMusic } from './audio/music';
import { SCORE, SECTION_IDS, type SectionId, stepSeconds } from './audio/score';
import { advance, begin } from './audio/sequence';

const params = new URLSearchParams(location.search);
const logEl = document.getElementById('log')!;
const log = (s: string) => {
  logEl.textContent += s + '\n';
  console.log(s);
};

let live: { ctx: AudioContext; mixer: Mixer; music: Music } | null = null;

function start(): NonNullable<typeof live> {
  if (live) return live;
  const ctx = new AudioContext();
  const mixer = createMixer(ctx, false);
  const music = createMusic(mixer);
  const tick = () => {
    music.frame();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  live = { ctx, mixer, music };
  return live;
}

const buttons = new Map<string, HTMLButtonElement>();
function button(label: string, run: () => void): void {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => {
    const l = start();
    void l.ctx.resume();
    run();
  };
  document.getElementById('sections')!.appendChild(b);
  buttons.set(label, b);
}

for (const id of SECTION_IDS) button(id, () => live!.music.play(id));
button('FANFARE → MARCH', () => live!.music.play('FANFARE', { then: 'MARCH' }));
button('ROLL → MARCH (lock-in)', () => live!.music.play('MARCH'));
button('Stop (1 s)', () => live!.music.stop(1));

const intensity = document.getElementById('intensity') as HTMLInputElement;
intensity.oninput = () => {
  document.getElementById('iv')!.textContent = Number(intensity.value).toFixed(2);
  live?.music.setIntensity(Number(intensity.value));
};
const level = document.getElementById('level') as HTMLInputElement;
level.oninput = () => {
  document.getElementById('lv')!.textContent = Number(level.value).toFixed(2);
  live?.music.setLevel(Number(level.value), 0.1);
};

setInterval(() => {
  const p = live?.music.playing() ?? null;
  for (const [label, b] of buttons) b.classList.toggle('on', label === p);
}, 100);

// ── ?play= ────────────────────────────────────────────────────────────────────────────────────────────────────

const autoplay = params.get('play') as SectionId | null;
if (autoplay && SECTION_IDS.includes(autoplay)) {
  const l = start();
  void l.ctx.resume();
  l.music.play(autoplay);
  setTimeout(() => log(`play ${autoplay}: state ${l.ctx.state}, t ${l.ctx.currentTime.toFixed(2)} s, playing() = ${l.music.playing()}`), 1500);
}

// ── ?render= (offline) ────────────────────────────────────────────────────────────────────────────────────────

const toRender = params.get('render') as SectionId | null;
if (toRender && SECTION_IDS.includes(toRender)) void render(toRender, Number(params.get('seconds') ?? 8));

async function render(id: SectionId, seconds: number): Promise<void> {
  const rate = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(rate * seconds), rate);
  const mixer = createMixer(ctx as unknown as AudioContext, false);
  const ss = stepSeconds(SCORE);
  // Schedule everything up front (offline there is no frame clock). A ROLL render leaves for MARCH halfway, to
  // hear the brass hit.
  let seq = begin(SCORE, 0, id, id === 'FANFARE' ? { then: 'MARCH' } : {});
  const all = [];
  if (id === 'ROLL') {
    all.push(...advance(SCORE, seq, 0, seconds / 2).hits.filter((h) => h.time < seconds / 2 + 0.05));
    seq = begin(SCORE, seconds / 2, 'MARCH', {}, seq);
  }
  all.push(...advance(SCORE, seq, id === 'ROLL' ? seconds / 2 : 0, seconds).hits);
  const dest = SCORE.sections[id].diegetic ? mixer.effects : mixer.music;
  for (const h of all) playHit(mixer, dest, h, ss);
  const t0 = performance.now();
  const buf = await ctx.startRendering();
  const ms = performance.now() - t0;
  const data = buf.getChannelData(0);
  let peak = 0;
  let sum = 0;
  let bad = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    if (!Number.isFinite(v)) bad++;
    peak = Math.max(peak, Math.abs(v));
    sum += v * v;
  }
  const rms = Math.sqrt(sum / data.length);
  log(`render ${id}: ${all.length} hits, ${seconds} s in ${ms.toFixed(0)} ms — peak ${peak.toFixed(3)}, rms ${rms.toFixed(4)}, non-finite ${bad}`);
  // Loudness per beat (first 8 beats), to see the pulse.
  const beat = Math.round(rate * ss * 4);
  const beats: string[] = [];
  for (let b = 0; b < Math.min(16, Math.floor(data.length / beat)); b++) {
    let s = 0;
    for (let i = b * beat; i < (b + 1) * beat; i++) s += (data[i] ?? 0) ** 2;
    beats.push(Math.sqrt(s / beat).toFixed(3));
  }
  log(`render ${id}: rms per beat ${beats.join(' ')}`);
  if (params.get('dump')) {
    const pre = document.createElement('pre');
    pre.id = 'wav';
    pre.textContent = wavBase64(data, rate);
    document.body.appendChild(pre);
  }
  document.title = `rendered ${id}`;
}

function wavBase64(data: Float32Array, rate: number): string {
  const bytes = new Uint8Array(44 + data.length * 2);
  const v = new DataView(bytes.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + data.length * 2, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i] ?? 0)) * 32767, true);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
