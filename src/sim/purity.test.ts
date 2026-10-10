import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// src/sim is pure: no three.js, no DOM, no randomness, no clock. It advances only through step(dt).
const SIM_DIR = join(process.cwd(), 'src', 'sim');

const BANNED: Array<[RegExp, string]> = [
  [/from\s+['"]three(\/[^'"]*)?['"]/, 'imports three.js'],
  [/\bMath\.random\b/, 'uses Math.random'],
  [/\bDate\.now\b|\bnew Date\b/, 'reads the clock (Date)'],
  [/\bperformance\.now\b/, 'reads the clock (performance)'],
  [/\b(window|document|navigator)\./, 'touches the DOM'],
  [/from\s+['"]\.\.\/(render|input|game|audio)\b/, 'imports from outside the sim'],
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('src/sim purity', () => {
  const files = sources(SIM_DIR);

  it('finds the sim sources', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(BANNED)('no sim file matches %s (%s)', (pattern, _why) => {
    const offenders = files.filter((f) => pattern.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

// Phase 4 S2 (a listed test change): the score and the music scheduler's core are pure data and pure functions —
// no Web Audio, no DOM, no clock, no three.js — so the founder tunes by number and the scheduler is tested on a
// fake clock. music.ts and instruments.ts are the Web Audio shell around them and are not on this list.
const AUDIO_PURE = [join(process.cwd(), 'src', 'audio', 'score.ts'), join(process.cwd(), 'src', 'audio', 'sequence.ts')];

const AUDIO_BANNED: Array<[RegExp, string]> = [
  [/from\s+['"]three(\/[^'"]*)?['"]/, 'imports three.js'],
  [/\b(AudioContext|OfflineAudioContext|BaseAudioContext|AudioParam|AudioNode|GainNode|AudioBuffer)\b|\.create(Gain|Oscillator|BiquadFilter|BufferSource)\b|\bcurrentTime\b/, 'touches Web Audio'],
  [/\bMath\.random\b/, 'uses Math.random'],
  [/\bDate\.now\b|\bnew Date\b/, 'reads the clock (Date)'],
  [/\bperformance\.now\b|\brequestAnimationFrame\b|\bsetTimeout\b|\bsetInterval\b/, 'reads or waits on a clock'],
  [/\b(window|document|navigator|localStorage)\b/, 'touches the DOM'],
  [/from\s+['"](?!\.\/(score|sequence)['"])[^'"]+['"]/, 'imports anything but the score/sequence'],
];

describe('src/audio score purity', () => {
  it('finds the files', () => {
    expect(AUDIO_PURE.every((f) => statSync(f).isFile())).toBe(true);
  });

  it.each(AUDIO_BANNED)('neither file matches %s (%s)', (pattern, _why) => {
    const offenders = AUDIO_PURE.filter((f) => pattern.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
