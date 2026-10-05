import { describe, expect, it } from 'vitest';
import { LEGEND_IDLE, LEGEND_KEYS, type LegendState, initialLegend, legendKeysFor, legendOn, legendTick } from './legend';

const PLAY = { held: false, menu: false };
const HELD = { held: true, menu: false };
const MENU = { held: false, menu: true };

const run = (s: LegendState, seconds: number, now = PLAY) => {
  for (let t = 0; t < seconds - 1e-9; t += 0.1) s = legendTick(s, 0.1, now);
  return s;
};

describe('the key legend (T9: shown while the keys are idle)', () => {
  it('shows at the start and stays while nothing is touched', () => {
    expect(initialLegend().shown).toBe(true);
    expect(run(initialLegend(), 60).shown).toBe(true);
  });

  it('a key press hides it at once', () => {
    expect(legendOn(run(initialLegend(), 5), 'key').shown).toBe(false);
  });

  it('comes back after LEGEND_IDLE seconds with no key pressed or held, not before', () => {
    let s = legendOn(initialLegend(), 'key');
    s = run(s, LEGEND_IDLE - 0.3);
    expect(s.shown).toBe(false);
    s = run(s, 0.5);
    expect(s.shown).toBe(true);
  });

  it('a held key keeps it away however long it is held; the idle count starts on release', () => {
    let s = run(legendOn(initialLegend(), 'key'), 30, HELD);
    expect(s.shown).toBe(false);
    s = run(s, LEGEND_IDLE - 0.3);
    expect(s.shown).toBe(false);
    expect(run(s, 0.5).shown).toBe(true);
  });

  it('H pins it on: it stays through presses and held keys', () => {
    let s = legendOn(legendOn(initialLegend(), 'key'), 'help');
    expect(s.shown).toBe(true);
    s = run(legendOn(s, 'key'), 5, HELD);
    expect(s.shown).toBe(true);
  });

  it('H again unpins it: hidden now, back after an idle spell', () => {
    let s = legendOn(legendOn(initialLegend(), 'help'), 'help');
    expect(s.pinned).toBe(false);
    expect(s.shown).toBe(false);
    s = run(s, LEGEND_IDLE + 0.2);
    expect(s.shown).toBe(true);
  });

  it('never shows over an open menu, pinned or idle', () => {
    expect(run(initialLegend(), 5, MENU).shown).toBe(false);
    expect(run(legendOn(initialLegend(), 'help'), 1, MENU).shown).toBe(false);
  });
});

describe('the keys that matter first', () => {
  it('docked: the launch keys lead; nothing is lost', () => {
    const rows = legendKeysFor('docked');
    expect(rows[0]!.key).toBe('1 2 3 4');
    expect(rows.length).toBe(LEGEND_KEYS.length);
    expect(rows.filter((r) => r.first).every((r, i) => rows[i] === r)).toBe(true);
  });

  it('driving: throttle, turn, climb and dive lead, the launch keys come after', () => {
    const rows = legendKeysFor('driving');
    expect(rows.slice(0, 4).map((r) => r.key)).toEqual(['W / S', 'A / D', '↓ / E', '↑ / Q']);
    expect(rows.find((r) => r.key === '1 2 3 4')!.first).toBe(false);
    expect(rows.length).toBe(LEGEND_KEYS.length);
  });
});
