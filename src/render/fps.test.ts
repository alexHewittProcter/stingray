import { describe, expect, it } from 'vitest';
import { FrameRing, frameStats } from './fps';

describe('the ?fps statistics', () => {
  it('reads a steady 60 fps as 60, with the 1 % low and worst at the same frame time', () => {
    const s = frameStats(Array(300).fill(1000 / 60));
    expect(s.fps).toBeCloseTo(60, 6);
    expect(s.meanMs).toBeCloseTo(16.667, 2);
    expect(s.low1Fps).toBeCloseTo(60, 6);
    expect(s.worstMs).toBeCloseTo(16.667, 2);
  });

  it('shows a hitch in the 1 % low and the worst frame but barely in the average', () => {
    const ms = Array(299).fill(1000 / 60);
    ms.push(100);
    const s = frameStats(ms);
    expect(s.fps).toBeGreaterThan(58);
    expect(s.worstMs).toBe(100);
    // 1 % of 300 frames = 3 slowest: (100 + 2 × 16.67) / 3 ≈ 44.4 ms → ≈ 22.5 fps
    expect(s.low1Fps).toBeCloseTo(1000 / ((100 + 2000 / 60) / 3), 6);
  });

  it('ignores junk and reads nothing as zeros', () => {
    expect(frameStats([]).frames).toBe(0);
    expect(frameStats([0, -1, NaN, Infinity]).fps).toBe(0);
    expect(frameStats([NaN, 20]).fps).toBeCloseTo(50, 6);
  });

  it('keeps only the last few seconds of frames', () => {
    const ring = new FrameRing(1000);
    for (let i = 0; i < 200; i++) ring.push(10);
    const v = ring.values();
    expect(v.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1000);
    expect(v.length).toBeGreaterThanOrEqual(99);
    ring.push(500);
    expect(ring.values().at(-1)).toBe(500);
    expect(ring.values().reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1000);
  });
});
