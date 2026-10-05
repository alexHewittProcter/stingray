// When the key legend shows (phase 2, T8; reworked in T9) — pure, no DOM; hud.ts draws it.
//
//   - It shows whenever the player is not touching the keys: no key held and none pressed for LEGEND_IDLE seconds
//     (and at the very start, so a first-time player sees the keys at once). The mouse does not count.
//   - Any key press hides it at once (hud.ts fades it out in ~0.3 s); it stays hidden while a key is held.
//   - H pins it on: then it stays while keys are pressed. H again unpins it, back to the idle behaviour.
//   - Never over an open menu.
//   - Which keys it puts first depends on the situation: the launch keys while the clamps hold the craft, the
//     driving keys once released (legendKeysFor).
// This replaces T8's "fades 6 s after the first launch control" rule.

/** Seconds without touching a key before the legend comes back. */
export const LEGEND_IDLE = 2.5;

export interface LegendState {
  shown: boolean;
  /** Seconds since a key was last pressed or held. */
  idle: number;
  /** H: shown regardless of the keys (not over a menu). */
  pinned: boolean;
}

/** 'key': any key press (H included); 'help': the H press itself, which toggles the pin. */
export type LegendEvent = 'key' | 'help';

export const initialLegend = (): LegendState => ({ shown: true, idle: LEGEND_IDLE, pinned: false });

export function legendOn(s: LegendState, e: LegendEvent): LegendState {
  if (e === 'help') return { shown: !s.pinned, idle: 0, pinned: !s.pinned };
  return { ...s, idle: 0, shown: s.pinned };
}

/** Once per drawn frame: `held` = some key is down; `menu` = a menu is open. */
export function legendTick(s: LegendState, dtSeconds: number, now: { held: boolean; menu: boolean }): LegendState {
  const idle = now.held ? 0 : s.idle + Math.max(dtSeconds, 0);
  const shown = !now.menu && (s.pinned || idle >= LEGEND_IDLE);
  return shown === s.shown && idle === s.idle ? s : { ...s, idle, shown };
}

export type LegendSituation = 'docked' | 'driving';

const FIRST: Record<LegendSituation, readonly string[]> = {
  docked: ['1 2 3 4', 'J L I K', 'M', 'H', 'Esc', 'C'],
  driving: ['W / S', 'A / D', '↓ / E', '↑ / Q', 'Shift', 'Space', 'R', 'Esc'],
};

/** The legend's rows for a situation: the keys that matter there first (`first`), then the rest. */
export function legendKeysFor(situation: LegendSituation): { key: string; action: string; first: boolean }[] {
  const first = FIRST[situation];
  const rows = LEGEND_KEYS.map(([key, action]) => ({ key, action, first: first.includes(key) }));
  const lead = first.flatMap((key) => rows.filter((r) => r.key === key));
  return [...lead, ...rows.filter((r) => !r.first)];
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
  ['J L I K', 'look round'],
  ['Esc', 'menu'],
  ['C', 'recentre'],
];

/** The keys as HTML rows (`<div><b>key</b> action</div>`), for either drawing. */
export const legendRowsHtml = (): string => LEGEND_KEYS.map(([k, a]) => `<div><b>${k}</b> ${a}</div>`).join('');
