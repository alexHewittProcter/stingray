// The music scheduler's pure core (S2: `due` over a fake clock). music.ts itself is the thin Web Audio shell that
// calls `advance` each frame on ctx.currentTime and schedules what comes back.
import { describe, expect, it } from 'vitest';
import { INSTRUMENTS, SCORE, type SectionId, hitsBetween, sectionSteps, stepSeconds } from './score';
import { LOOK_AHEAD, START_DELAY, type Sequence, type Timed, advance, begin, bodyStart, due, finished, playingAt } from './sequence';

const SS = stepSeconds(SCORE);
const BAR = 16 * SS;

/** Run the scheduler over a fake clock: frames every `dt` (with an optional wobble), from `t0` to `t1`. */
/** Only hits before `t1` are kept (the last frames look ahead past it). */
function run(seq: Sequence, t0: number, t1: number, dt = 1 / 60, wobble = 0): { hits: Timed[]; seq: Sequence } {
  const hits: Timed[] = [];
  let i = 0;
  for (let now = t0; now < t1; now += dt + (wobble ? Math.sin(i++ * 1.7) * wobble : 0)) {
    const r = advance(SCORE, seq, now);
    hits.push(...r.hits);
    seq = r.seq;
  }
  return { hits: hits.filter((h) => h.time < t1 - 1e-9), seq };
}

function count(id: SectionId, passes = 1): number {
  const s = SCORE.sections[id];
  return hitsBetween(s, 0, sectionSteps(s) * passes).length;
}

describe('due', () => {
  const seg = { id: 'FANFARE' as const, part: 'body' as const, start: 10, end: 10 + 64 * SS };

  it('gives the hits in [from, to) at start + step × stepSeconds, with their length in seconds', () => {
    const hits = due(SCORE, seg, 10, 10 + BAR);
    expect(hits.length).toBe(hitsBetween(SCORE.sections.FANFARE, 0, 16).length);
    for (const h of hits) {
      expect(h.time).toBeCloseTo(10 + h.step * SS, 9);
      expect(h.seconds).toBeCloseTo((h.len ?? 1) * SS, 9);
      expect(h.id).toBe('FANFARE');
    }
    expect(hits[0]?.time).toBe(10); // the tattoo's first flam on the downbeat
  });

  it('clips to the segment', () => {
    expect(due(SCORE, seg, 0, 10)).toEqual([]);
    expect(due(SCORE, seg, seg.end, seg.end + 5)).toEqual([]);
    expect(due(SCORE, seg, 0, 1000).length).toBe(count('FANFARE'));
  });
});

describe('the scheduler over a fake clock', () => {
  it('hands out every hit of a section exactly once, in time order, never more than the look-ahead early', () => {
    const now0 = 3;
    let seq = begin(SCORE, now0, 'STING_HOME');
    const hits: Timed[] = [];
    let i = 0;
    for (let now = now0; now < now0 + 10; now += 1 / 60 + Math.sin(i++) * 0.004) {
      const r = advance(SCORE, seq, now);
      for (const h of r.hits) {
        expect(h.time).toBeGreaterThanOrEqual(now);
        expect(h.time).toBeLessThan(now + LOOK_AHEAD);
      }
      hits.push(...r.hits);
      seq = r.seq;
    }
    expect(hits.length).toBe(count('STING_HOME'));
    const keys = hits.map((h) => `${h.inst}@${h.step}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (let k = 1; k < hits.length; k++) expect(hits[k]!.time).toBeGreaterThanOrEqual(hits[k - 1]!.time);
    expect(hits[0]!.time).toBeCloseTo(now0 + START_DELAY, 9);
  });

  it('a looping section keeps going: MARCH twice through and into a third pass', () => {
    const seq = begin(SCORE, 0, 'MARCH');
    const { hits } = run(seq, 0, START_DELAY + 2 * 256 * SS + BAR);
    const third = hitsBetween(SCORE.sections.MARCH, 512, 528).length;
    expect(hits.length).toBe(count('MARCH', 2) + third);
    // the second pass is the first, shifted by the section's length
    const first = hits.filter((h) => h.step < 256).map((h) => h.inst + h.step);
    const second = hits.filter((h) => h.step >= 256 && h.step < 512).map((h) => h.inst + (h.step - 256));
    expect(second).toEqual(first);
  });

  it('ALERT loops two bars indefinitely', () => {
    const { hits } = run(begin(SCORE, 0, 'ALERT'), 0, START_DELAY + 10 * 32 * SS);
    expect(hits.length).toBe(count('ALERT') * 10);
    expect(hits.every((h) => h.inst === 'snare')).toBe(true);
  });

  it('`then` follows on the beat: FANFARE ends exactly where MARCH begins', () => {
    const seq = begin(SCORE, 1, 'FANFARE', { then: 'MARCH' });
    expect(seq.segments.map((s) => s.id)).toEqual(['FANFARE', 'MARCH']);
    const fanEnd = 1 + START_DELAY + 64 * SS;
    expect(seq.segments[1]!.start).toBeCloseTo(fanEnd, 9);
    const { hits } = run(seq, 1, fanEnd + 2 * BAR);
    const fan = hits.filter((h) => h.id === 'FANFARE');
    const march = hits.filter((h) => h.id === 'MARCH');
    expect(fan.length).toBe(count('FANFARE'));
    expect(march.length).toBe(hitsBetween(SCORE.sections.MARCH, 0, 32).length);
    expect(march[0]!.time).toBeCloseTo(fanEnd, 9);
    expect(Math.max(...fan.map((h) => h.time))).toBeLessThan(fanEnd);
  });

  it('playing() reports the section, then the `then`, then null once a one-shot ends', () => {
    const seq = begin(SCORE, 0, 'STING_END', { then: 'STING_END' });
    const len = 32 * SS;
    expect(playingAt(seq, 0)).toBe('STING_END');
    expect(playingAt(seq, START_DELAY + len * 1.5)).toBe('STING_END');
    expect(playingAt(seq, START_DELAY + len * 2 + 0.01)).toBeNull();
    expect(finished(seq, START_DELAY + len * 2 + 0.01)).toBe(true);
    expect(playingAt(null, 0)).toBeNull();
    expect(playingAt(begin(SCORE, 0, 'MARCH'), 1e6)).toBe('MARCH');
  });

  it('leaving ROLL lands its brass hit at once, then the next section after the ending', () => {
    let seq = begin(SCORE, 0, 'ROLL');
    const r = run(seq, 0, 5);
    seq = r.seq;
    expect(r.hits.every((h) => h.id === 'ROLL' && h.part === 'body')).toBe(true);
    const next = begin(SCORE, 5, 'MARCH', {}, seq);
    expect(next.segments.map((s) => [s.id, s.part])).toEqual([
      ['ROLL', 'ending'],
      ['MARCH', 'body'],
    ]);
    const { hits } = run(next, 5, 5 + START_DELAY + BAR + BAR);
    const hit = hits.filter((h) => h.part === 'ending');
    expect(hit.find((h) => h.inst === 'brass')?.time).toBeCloseTo(5 + START_DELAY, 9);
    expect(hits.find((h) => h.id === 'MARCH')?.time).toBeCloseTo(5 + START_DELAY + BAR, 9);
    expect(bodyStart(next)).toBeCloseTo(5 + START_DELAY + BAR, 9);
    expect(playingAt(next, 5.1)).toBe('MARCH'); // the ending counts as the section asked for
  });

  it('the ending can be skipped (`ending: false`), and sections without one never add it', () => {
    const roll = begin(SCORE, 0, 'ROLL');
    expect(begin(SCORE, 1, 'STING_END', { ending: false }, roll).segments.map((s) => s.part)).toEqual(['body']);
    const march = begin(SCORE, 0, 'MARCH');
    expect(begin(SCORE, 1, 'ROLL', {}, march).segments.map((s) => s.id)).toEqual(['ROLL']);
  });

  it('a stalled frame skips the missed span instead of playing it late in a burst', () => {
    let seq = begin(SCORE, 0, 'ALERT');
    seq = advance(SCORE, seq, 0).seq;
    const late = advance(SCORE, seq, 3); // three seconds with no frames
    for (const h of late.hits) expect(h.time).toBeGreaterThanOrEqual(3);
    expect(late.hits.length).toBe(due(SCORE, seq.segments[0]!, 3, 3 + LOOK_AHEAD).length);
  });

  it('a stopped clock (suspended context) hands out nothing new; it resumes where it was', () => {
    let seq = begin(SCORE, 0, 'MARCH');
    const all: Timed[] = [];
    const tick = (now: number) => {
      const r = advance(SCORE, seq, now);
      seq = r.seq;
      all.push(...r.hits);
      return r.hits.length;
    };
    for (let now = 0; now < 2; now += 1 / 60) tick(now);
    const lastNow = Math.floor(2 * 60 - 1e-9) / 60;
    let paused = 0;
    for (let k = 0; k < 120; k++) paused += tick(lastNow); // the clock is frozen
    expect(paused).toBe(0);
    let end = lastNow;
    for (let now = lastNow; now < 6; now += 1 / 60) end = (tick(now), now);
    const expected = due(SCORE, seq.segments[0]!, 0, end + LOOK_AHEAD);
    expect(all.map((h) => h.inst + h.step)).toEqual(expected.map((h) => h.inst + h.step));
  });

  it('every instrument of the MARCH is scheduled', () => {
    const { hits } = run(begin(SCORE, 0, 'MARCH'), 0, 8);
    for (const inst of INSTRUMENTS) expect(hits.some((h) => h.inst === inst)).toBe(true);
  });
});

describe('rolls (instruments.ts)', () => {
  it('a roll is `roll` strokes a step across its length, evenly spaced, rising to its velocity', async () => {
    const { rollStrokes, MUSIC_LEVELS } = await import('./instruments');
    const s = rollStrokes(2, 0.8, 3, 2, SS);
    expect(s.length).toBe(6);
    s.forEach(([t], i) => expect(t).toBeCloseTo(2 + (i * SS) / 3, 9));
    expect(s[0]![1]).toBeCloseTo(0.8 * (1 - MUSIC_LEVELS.rollRise), 9);
    expect(s[5]![1]).toBeCloseTo(0.8, 9);
    for (let i = 1; i < s.length; i++) expect(s[i]![1]).toBeGreaterThan(s[i - 1]![1]);
    const long = rollStrokes(0, 1, 3, 8, SS);
    expect(long.length).toBe(24);
    expect(long[0]![1]).toBeCloseTo(1 - MUSIC_LEVELS.longRollRise, 9);
  });
});
