import { describe, expect, it } from 'vitest';
import { LEVELS as L } from './levels';

describe('levels (phase 4 T6: the score in the mix)', () => {
  it('the music bus sits under the effects (S3: "the music sits under the effects"), near the readme\'s 0.35', () => {
    expect(L.musicBus).toBeGreaterThan(0);
    expect(L.musicBus).toBeLessThan(L.effectsBus);
    expect(L.musicBus).toBeGreaterThanOrEqual(0.2);
    expect(L.musicBus).toBeLessThanOrEqual(0.5);
  });

  it('every instrument level is a finite, positive number', () => {
    for (const [name, v] of Object.entries(L.music)) {
      expect(Number.isFinite(v), name).toBe(true);
      expect(v, name).toBeGreaterThan(0);
    }
    expect(L.music.rollRise).toBeLessThan(1);
    expect(L.music.longRollRise).toBeLessThan(1);
  });

  it('the ALERT (the PA, diegetic — through the effects bus) is quiet: under the klaxon and the chair', () => {
    expect(L.music.alert).toBeLessThan(0.5);
    expect(L.music.alert).toBeLessThanOrEqual(L.chair);
  });
});
