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
