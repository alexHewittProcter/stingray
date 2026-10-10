import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  INSTRUMENTS,
  LAUNCH_STATIONS,
  PITCHED,
  SCORE,
  SECTION_IDS,
  type Section,
  hitsBetween,
  midiHz,
  sectionSeconds,
  sectionSteps,
  stepSeconds,
} from './score';

const BAR = SCORE.stepsPerBeat * 4;

/** A PCM WAV's format and samples (16-bit). Walks the RIFF chunks, so a LIST chunk before `data` does not matter. */
function parseWav(b: Buffer): { channels: number; rate: number; bits: number; seconds: number; samples: Int16Array } {
  expect(b.toString('ascii', 0, 4)).toBe('RIFF');
  expect(b.toString('ascii', 8, 12)).toBe('WAVE');
  let channels = 0;
  let rate = 0;
  let bits = 0;
  for (let at = 12; at + 8 <= b.length; ) {
    const id = b.toString('ascii', at, at + 4);
    const size = b.readUInt32LE(at + 4);
    if (id === 'fmt ') {
      expect(b.readUInt16LE(at + 8)).toBe(1); // PCM
      channels = b.readUInt16LE(at + 10);
      rate = b.readUInt32LE(at + 12);
      bits = b.readUInt16LE(at + 22);
    } else if (id === 'data') {
      const samples = new Int16Array(b.buffer.slice(b.byteOffset + at + 8, b.byteOffset + at + 8 + size));
      return { channels, rate, bits, seconds: samples.length / channels / rate, samples };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error('no data chunk');
}

function allTracks(s: Section) {
  const out = [{ name: 'body', tracks: s.tracks, steps: sectionSteps(s) }];
  if (s.ending) out.push({ name: 'ending', tracks: s.ending.tracks, steps: s.ending.steps });
  return out;
}

describe('the score (S1, S2)', () => {
  it('is 4/4 at a brisk march tempo, sixteenth-note steps', () => {
    expect(SCORE.bpm).toBeGreaterThanOrEqual(132);
    expect(SCORE.bpm).toBeLessThanOrEqual(160);
    expect(SCORE.stepsPerBeat).toBe(4);
  });

  it('has the seven sections, with the bar counts and loop flags S1 gives', () => {
    expect(Object.keys(SCORE.sections).sort()).toEqual([...SECTION_IDS].sort());
    const s = SCORE.sections;
    expect(s.FANFARE).toMatchObject({ bars: 4, loop: false });
    expect(s.MARCH).toMatchObject({ bars: 16, loop: true });
    expect(s.BRIDGE).toMatchObject({ bars: 8, loop: false });
    expect(s.ROLL.loop).toBe(true);
    expect(s.STING_HOME).toMatchObject({ bars: 4, loop: false });
    expect(s.STING_END).toMatchObject({ bars: 2, loop: false });
    expect(s.ALERT).toMatchObject({ loop: true, diegetic: true });
  });

  it('ROLL is open-ended: it loops until it is left, and leaving it lands a brass hit', () => {
    const roll = SCORE.sections.ROLL;
    expect(roll.loop).toBe(true);
    expect(sectionSeconds(SCORE, 'ROLL')).toBe(Infinity);
    expect(roll.ending).toBeDefined();
    const brass = roll.ending?.tracks.brass ?? [];
    expect(brass.length).toBeGreaterThan(0);
    expect(brass[0]?.step).toBe(0);
    expect(roll.tracks.snare.every((h) => (h.roll ?? 0) > 0)).toBe(true); // it is a roll throughout
    expect(roll.tracks.timp.length).toBeGreaterThan(0);
  });

  it('ALERT is the Launch Stations clip alone — no synthesised tracks — looping, diegetic (the PA)', () => {
    const a = SCORE.sections.ALERT;
    expect(a.clip).toBe(LAUNCH_STATIONS);
    for (const inst of INSTRUMENTS) expect(a.tracks[inst]).toEqual([]);
    expect(a.diegetic).toBe(true);
    for (const id of SECTION_IDS) if (id !== 'ALERT') expect(SCORE.sections[id].diegetic ?? false).toBe(false);
    for (const id of SECTION_IDS) if (id !== 'ALERT') expect(SCORE.sections[id].clip).toBeUndefined();
  });

  it('the Launch Stations WAV (public/, committed) is what LAUNCH_STATIONS says: mono 16-bit, its length, small', () => {
    const bytes = readFileSync(join(process.cwd(), 'public', LAUNCH_STATIONS.url));
    const wav = parseWav(bytes);
    expect(wav.channels).toBe(1);
    expect(wav.bits).toBe(16);
    expect([44100, 48000]).toContain(wav.rate);
    expect(wav.seconds).toBeCloseTo(LAUNCH_STATIONS.seconds, 3);
    expect(bytes.length).toBeLessThan(400 * 1024);
    // Brief: ≈ 180 bpm, 3.5–4.0 s, ending on the bar — three 4/4 bars at 180 bpm is exactly 4 s.
    expect(LAUNCH_STATIONS.seconds).toBeGreaterThanOrEqual(3.5);
    expect(LAUNCH_STATIONS.seconds).toBeLessThanOrEqual(4.0);
    expect((LAUNCH_STATIONS.seconds / (60 / 180)) % 4).toBeCloseTo(0, 6);
    // It loops clean: the drums have rung out well before the end, and the very last samples are silence.
    const tail = wav.samples.subarray(wav.samples.length - Math.round(0.1 * wav.rate));
    expect(Math.max(...Array.from(tail, Math.abs))).toBeLessThan(10); // under −70 dBFS
    expect(wav.samples[wav.samples.length - 1]).toBe(0);
    // And it is a loud, finished asset: peak-normalised to about −1 dBFS.
    let peak = 0;
    for (const v of wav.samples) peak = Math.max(peak, Math.abs(v));
    expect(20 * Math.log10(peak / 32768)).toBeCloseTo(-1, 0);
  });

  it('the MARCH is the piece: a brass tune over the march snare with a bass line and timpani accents', () => {
    const m = SCORE.sections.MARCH.tracks;
    expect(m.brass.length).toBeGreaterThanOrEqual(48);
    expect(m.snare.length).toBeGreaterThanOrEqual(16 * 6);
    expect(m.bass.length).toBe(16 * 4); // a quarter-note bass, every bar
    expect(m.timp.length).toBeGreaterThanOrEqual(4);
    // every bar has a tune note in it
    for (let bar = 0; bar < 16; bar++) expect(m.brass.some((h) => Math.floor(h.step / BAR) === bar)).toBe(true);
  });

  it('the FANFARE opens with the snare alone, then brass in fourths and fifths', () => {
    const f = SCORE.sections.FANFARE.tracks;
    const firstTwoBars = (h: { step: number }) => h.step < 2 * BAR;
    expect(f.snare.filter(firstTwoBars).length).toBeGreaterThan(8);
    for (const inst of ['kick', 'timp', 'brass', 'bass'] as const) expect(f[inst].filter(firstTwoBars)).toEqual([]);
    const brass = f.brass.filter((h) => !firstTwoBars(h));
    expect(brass.length).toBeGreaterThan(4);
    const intervals = brass.flatMap((h) => (h.chord ?? []).map((c) => Math.abs(c) % 12));
    expect(intervals.length).toBeGreaterThan(0);
    for (const i of intervals) expect([0, 5, 7]).toContain(i); // fourths, fifths and octaves only
  });

  for (const id of SECTION_IDS) {
    describe(id, () => {
      const section = SCORE.sections[id];
      for (const { name, tracks, steps } of allTracks(section)) {
        it(`${name}: every hit lies within its bars`, () => {
          for (const inst of INSTRUMENTS) {
            for (const h of tracks[inst]) {
              expect(Number.isInteger(h.step)).toBe(true);
              expect(h.step).toBeGreaterThanOrEqual(0);
              expect(h.step + (h.len ?? 1)).toBeLessThanOrEqual(steps);
            }
          }
        });

        it(`${name}: vel is 0–1, lengths and rolls are positive`, () => {
          for (const inst of INSTRUMENTS) {
            for (const h of tracks[inst]) {
              expect(h.vel).toBeGreaterThan(0);
              expect(h.vel).toBeLessThanOrEqual(1);
              if (h.len !== undefined) expect(h.len).toBeGreaterThan(0);
              if (h.roll !== undefined) expect(Number.isInteger(h.roll) && h.roll > 0).toBe(true);
            }
          }
        });

        it(`${name}: every pitched hit has a note in a playable range; unpitched hits have none`, () => {
          for (const inst of INSTRUMENTS) {
            for (const h of tracks[inst]) {
              if (PITCHED.includes(inst)) {
                expect(h.note).toBeDefined();
                expect(h.note).toBeGreaterThanOrEqual(28);
                expect(h.note).toBeLessThanOrEqual(86);
                for (const c of h.chord ?? []) expect((h.note ?? 0) + c).toBeGreaterThanOrEqual(28);
              } else {
                expect(h.note).toBeUndefined();
                expect(h.chord).toBeUndefined();
              }
            }
          }
        });

        it(`${name}: no two hits of one instrument share a step, and no note overlaps the next`, () => {
          for (const inst of INSTRUMENTS) {
            const hits = [...tracks[inst]].sort((a, b) => a.step - b.step);
            const steps = hits.map((h) => h.step);
            expect(new Set(steps).size).toBe(steps.length);
            for (let i = 1; i < hits.length; i++) {
              const prev = hits[i - 1]!;
              expect(prev.step + (prev.len ?? 1)).toBeLessThanOrEqual(hits[i]!.step);
            }
          }
        });
      }
    });
  }
});

describe('the pure helpers', () => {
  it('stepSeconds is a sixteenth at the tempo', () => {
    expect(stepSeconds(SCORE)).toBeCloseTo(60 / SCORE.bpm / 4, 12);
    expect(stepSeconds({ ...SCORE, bpm: 120 })).toBeCloseTo(0.125, 12);
  });

  it('sectionSeconds is bars × 16 steps, Infinity for a loop', () => {
    expect(sectionSeconds(SCORE, 'FANFARE')).toBeCloseTo(4 * BAR * stepSeconds(SCORE), 12);
    expect(sectionSeconds(SCORE, 'STING_END')).toBeCloseTo(2 * BAR * stepSeconds(SCORE), 12);
    expect(sectionSeconds(SCORE, 'MARCH')).toBe(Infinity);
    expect(sectionSeconds(SCORE, 'ALERT')).toBe(Infinity);
  });

  it('midiHz: A4 is 440, an octave doubles', () => {
    expect(midiHz(69)).toBeCloseTo(440, 9);
    expect(midiHz(81)).toBeCloseTo(880, 9);
    expect(midiHz(60)).toBeCloseTo(261.6256, 3);
  });

  const tiny: Section = {
    bars: 1,
    loop: true,
    tracks: { snare: [{ step: 0, vel: 1 }, { step: 8, vel: 0.5 }], kick: [{ step: 4, vel: 1 }], timp: [], brass: [], bass: [] },
  };

  it('hitsBetween returns the hits in [from, to), in step order, with their instrument', () => {
    const h = hitsBetween(tiny, 0, 8);
    expect(h.map((x) => [x.inst, x.step])).toEqual([
      ['snare', 0],
      ['kick', 4],
    ]);
    expect(hitsBetween(tiny, 0, 9).map((x) => x.step)).toEqual([0, 4, 8]);
    expect(hitsBetween(tiny, 4.5, 8.5).map((x) => x.step)).toEqual([8]); // fractional bounds
  });

  it('hitsBetween wraps when the section loops, giving absolute steps', () => {
    expect(hitsBetween(tiny, 12, 22).map((x) => [x.inst, x.step])).toEqual([
      ['snare', 16],
      ['kick', 20],
    ]);
    expect(hitsBetween(tiny, 0, 48).length).toBe(9); // three passes
    expect(hitsBetween(tiny, 160, 161)[0]).toMatchObject({ inst: 'snare', step: 160, vel: 1 });
  });

  it('hitsBetween does not wrap a section that does not loop', () => {
    const once = { ...tiny, loop: false };
    expect(hitsBetween(once, 0, 100).map((x) => x.step)).toEqual([0, 4, 8]);
    expect(hitsBetween(once, 16, 100)).toEqual([]);
  });

  it('hitsBetween of an empty or inverted window is empty', () => {
    expect(hitsBetween(tiny, 5, 5)).toEqual([]);
    expect(hitsBetween(tiny, 9, 3)).toEqual([]);
  });

  it('consecutive windows hand every hit out exactly once', () => {
    const march = SCORE.sections.MARCH;
    const total = INSTRUMENTS.reduce((n, i) => n + march.tracks[i].length, 0);
    const edges: number[] = [];
    for (let e = 0; e < 512; e += 0.37) edges.push(e);
    edges.push(512); // two passes of 256 steps
    let got = 0;
    for (let i = 1; i < edges.length; i++) got += hitsBetween(march, edges[i - 1]!, edges[i]!).length;
    expect(got).toBe(total * 2);
  });
});
