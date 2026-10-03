import { describe, expect, it } from 'vitest';
import { createStepper } from './loop';

const DT = 1 / 60;

describe('createStepper', () => {
  it('runs one step per fixed dt of elapsed time', () => {
    let steps = 0;
    const s = createStepper(() => { steps += 1; }, DT);
    for (let i = 0; i < 60; i++) s.advance(DT);
    expect(steps).toBe(60);
  });

  it('always hands the fixed dt to the step, never the frame time', () => {
    const seen: number[] = [];
    const s = createStepper((dt) => { seen.push(dt); }, DT);
    s.advance(0.031);
    s.advance(0.007);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((dt) => dt === DT)).toBe(true);
  });

  it('accumulates frames shorter than dt', () => {
    let steps = 0;
    const s = createStepper(() => { steps += 1; }, DT);
    s.advance(DT * 0.4);
    expect(steps).toBe(0);
    s.advance(DT * 0.4);
    expect(steps).toBe(0);
    s.advance(DT * 0.4);
    expect(steps).toBe(1);
  });

  it('caps the steps after a long pause and does not carry the backlog', () => {
    let steps = 0;
    const s = createStepper(() => { steps += 1; }, DT, 5);
    s.advance(10);
    expect(steps).toBe(5);
    s.advance(DT);
    expect(steps).toBe(6);
  });

  it('returns an interpolation alpha in [0, 1)', () => {
    const s = createStepper(() => {}, DT);
    const alpha = s.advance(DT * 1.5);
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThan(1);
    expect(alpha).toBeCloseTo(0.5, 5);
  });

  it('ignores negative frame times', () => {
    let steps = 0;
    const s = createStepper(() => { steps += 1; }, DT);
    s.advance(-1);
    expect(steps).toBe(0);
  });
});
