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
