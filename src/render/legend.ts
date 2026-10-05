// When the key legend shows (phase 2, T8) — pure, no DOM; hud.ts draws it.
//
//   - It shows at the start, so a first-time player sees the keys while the craft sits on the cradle.
//   - The first launch control (1–4, key or click) starts a short countdown; it fades when that runs out. A driving
//     key hides it sooner (the player has found the keys).
//   - H brings it back, and it then stays until H is pressed again; H on a shown legend hides it.

/** Seconds the legend stays after the first launch control. */
export const LEGEND_AFTER_LAUNCH = 6;
/** Seconds it stays after a driving key, if that comes first or sooner. */
export const LEGEND_AFTER_DRIVE = 1.5;

export interface LegendState {
  shown: boolean;
  /** Seconds left before it hides on its own; null = it stays (at the start, or recalled with H). */
  left: number | null;
  /** The countdown has run once: later launch presses and driving keys no longer touch it. */
  settled: boolean;
}

export type LegendEvent = 'launch' | 'drive' | 'help';

export const initialLegend = (): LegendState => ({ shown: true, left: null, settled: false });

export function legendOn(s: LegendState, e: LegendEvent): LegendState {
  if (e === 'help') return s.shown ? { shown: false, left: null, settled: true } : { shown: true, left: null, settled: true };
  if (s.settled || !s.shown) return s;
  const want = e === 'launch' ? LEGEND_AFTER_LAUNCH : LEGEND_AFTER_DRIVE;
  return { ...s, left: s.left === null ? want : Math.min(s.left, want) };
}

export function legendTick(s: LegendState, dtSeconds: number): LegendState {
  if (s.left === null) return s;
  const left = s.left - Math.max(dtSeconds, 0);
  return left > 0 ? { ...s, left } : { shown: false, left: null, settled: true };
}

/**
 * The keys, in the legend's reading order (two columns, row by row) — the one list the HUD's legend and the menu's
 * Controls page both draw (T9).
 */
export const LEGEND_KEYS: readonly (readonly [key: string, action: string])[] = [
  ['1 2 3 4', 'launch'],
  ['Shift', 'boost'],
  ['W / S', 'throttle'],
  ['Space', 'fire'],
  ['A / D', 'turn'],
  ['R', 'to pen'],
  ['↓ / E', 'climb'],
  ['M', 'mute'],
  ['↑ / Q', 'dive'],
  ['H', 'this help'],
  ['Esc', 'menu'],
];

/** The keys as HTML rows (`<div><b>key</b> action</div>`), for either drawing. */
export const legendRowsHtml = (): string => LEGEND_KEYS.map(([k, a]) => `<div><b>${k}</b> ${a}</div>`).join('');
