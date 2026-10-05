import { describe, expect, it } from 'vitest';
import { LEGEND_AFTER_DRIVE, LEGEND_AFTER_LAUNCH, initialLegend, legendOn, legendTick } from './legend';

const run = (s: ReturnType<typeof initialLegend>, seconds: number) => {
  for (let t = 0; t < seconds; t += 0.1) s = legendTick(s, 0.1);
  return s;
};

describe('the key legend (T8)', () => {
  it('shows at the start and stays while nothing is pressed', () => {
    expect(run(initialLegend(), 60).shown).toBe(true);
  });

  it('fades a few seconds after the first launch control, not at once', () => {
    let s = legendOn(initialLegend(), 'launch');
    s = run(s, LEGEND_AFTER_LAUNCH - 0.5);
    expect(s.shown).toBe(true);
    s = legendOn(s, 'launch'); // later presses do not restart the countdown
    s = run(s, 1);
    expect(s.shown).toBe(false);
  });

  it('a driving key hides it sooner', () => {
    let s = legendOn(initialLegend(), 'launch');
    s = run(s, 1);
    s = legendOn(s, 'drive');
    s = run(s, LEGEND_AFTER_DRIVE + 0.2);
    expect(s.shown).toBe(false);
  });

  it('H brings it back to stay, and H again hides it; launch and drive keys then leave it alone', () => {
    let s = run(legendOn(initialLegend(), 'launch'), LEGEND_AFTER_LAUNCH + 1);
    expect(s.shown).toBe(false);
    s = legendOn(s, 'help');
    expect(s.shown).toBe(true);
    s = run(legendOn(legendOn(s, 'drive'), 'launch'), 30);
    expect(s.shown).toBe(true);
    s = legendOn(s, 'help');
    expect(s.shown).toBe(false);
    expect(legendOn(s, 'launch').shown).toBe(false);
  });

  it('H before anything else hides it at once', () => {
    expect(legendOn(initialLegend(), 'help').shown).toBe(false);
  });
});
