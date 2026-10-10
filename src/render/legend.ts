// When the key legend shows (phase 2, T8; reworked in T9) — pure, no DOM; hud.ts draws it.
//
//   - It shows whenever the player is not touching the keys: no key held and none pressed for LEGEND_IDLE seconds
//     (and at the very start, so a first-time player sees the keys at once). The mouse does not count.
//   - Any key press hides it at once (hud.ts fades it out in ~0.3 s); it stays hidden while a key is held.
//   - H pins it on: then it stays while keys are pressed. H again unpins it, back to the idle behaviour.
//   - Never over an open menu.
//   - Which keys it puts first depends on the situation: the launch keys while the clamps hold the craft, the
//     driving keys once released (legendKeysFor).
//   - Phase 3 (M9): the card is per mode. On foot it is Troy's own list (W A S D, E, the orbit keys, R, Esc); riding
//     the chair it is one line; aboard it is phase 2's. The menu's Controls page draws the current mode's list.
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

/** Aboard: 'docked' (clamped) or 'driving' (released). Phase 3 (M9): 'onFoot' and 'riding' — the session mode's. */
export type LegendSituation = 'docked' | 'driving' | 'onFoot' | 'riding';

type Aboard = 'docked' | 'driving';

const FIRST: Record<Aboard, readonly string[]> = {
  docked: ['1 2 3 4', '5', 'J L I K', 'M', 'H', 'Esc', 'C'],
  driving: ['W / S', 'A / D', '↓ / E', '↑ / Q', 'Shift', 'Space', 'R', 'Esc'],
};

type Rows = readonly (readonly [key: string, action: string])[];

/** M9: Troy's card on foot — every row is his, so all of them lead. */
export const ON_FOOT_KEYS: Rows = [
  ['W A S D', 'walk'],
  ['E', 'use'],
  ['← → ↑ ↓', 'look round'],
  ['J L I K', 'look round'],
  ['C', 'recentre'],
  ['R', 'to control room'],
  ['M', 'mute'],
  ['H', 'this help'],
  ['Esc', 'menu'],
];

/** M9: riding the chair, one line — only R, Esc (and H, M) do anything (M6). */
export const RIDING_KEYS: Rows = [['R · Esc', 'control room · menu']];

/** The rows of a situation's card, in reading order (two columns, row by row). */
export function legendRows(situation: LegendSituation): Rows {
  return situation === 'onFoot' ? ON_FOOT_KEYS : situation === 'riding' ? RIDING_KEYS : LEGEND_KEYS;
}

/** The legend's rows for a situation: the keys that matter there first (`first`), then the rest. */
export function legendKeysFor(situation: LegendSituation): { key: string; action: string; first: boolean }[] {
  if (situation === 'onFoot' || situation === 'riding') {
    return legendRows(situation).map(([key, action]) => ({ key, action, first: true }));
  }
  const first = FIRST[situation];
  const rows = LEGEND_KEYS.map(([key, action]) => ({ key, action, first: first.includes(key) }));
  const lead = first.flatMap((key) => rows.filter((r) => r.key === key));
  return [...lead, ...rows.filter((r) => !r.first)];
}

/**
 * The keys aboard, in the legend's reading order (two columns, row by row) — the one list the HUD's legend and the
 * menu's Controls page both draw aboard (T9). Phase 3 (M9): R reads "to control room" — the game's start.
 */
export const LEGEND_KEYS: Rows = [
  ['1 2 3 4', 'launch'],
  ['Shift', 'boost'],
  ['W / S', 'throttle'],
  ['Space', 'fire'],
  ['A / D', 'turn'],
  ['R', 'to control room'],
  ['↓ / E', 'climb'],
  ['M', 'mute'],
  ['↑ / Q', 'dive'],
  ['H', 'this help'],
  ['J L I K', 'look round'],
  ['Esc', 'menu'],
  ['C', 'recentre'],
  ['5', 'leave seat'], // phase 3 (M3, M6b): docked and raised, back up to the control room
];

/** A situation's keys as HTML rows (`<div><b>key</b> action</div>`), for either drawing (aboard by default). */
export const legendRowsHtml = (situation: LegendSituation = 'driving'): string =>
  legendRows(situation).map(([k, a]) => `<div><b>${k}</b> ${a}</div>`).join('');

/**
 * Which card a moment calls for (M9): the session mode's — on foot, riding — and aboard phase 2's, by the clamps.
 * (Takes the mode and the clamps rather than the GameState, so render/ needs nothing from game/.)
 */
export function legendSituation(mode: 'piloting' | 'launch' | 'onFoot' | 'transport', clamps: 'locked' | 'released'): LegendSituation {
  if (mode === 'onFoot') return 'onFoot';
  if (mode === 'transport') return 'riding';
  return clamps === 'locked' ? 'docked' : 'driving';
}
