// The game menu (phase 2, T9) — pure, no DOM; render/menu.ts draws it and main.ts carries out its actions.
//
//   - The title menu is up on load, over the live start — phase 3 (M9): Troy standing in the control room; the pause
//     menu opens on Esc during play, on foot as aboard.
//   - While either is up the sim does not step (main.ts); game keys only move through the menu.
//   - One continuous world: closing a menu never reloads or cuts — it only changes what the game does next.

export type MenuKind = 'title' | 'pause';
export type MenuPage = 'main' | 'controls';

// M9: 'controlRoom' is the title's "Start in the control room" and the pause menu's "Return to the control room";
// 'pen' is "Skip to Pen 3" / "Return to Pen 3" — one item each, labelled by the menu's kind (itemLabel).
export type MenuItem = 'controlRoom' | 'resume' | 'pen' | 'ocean' | 'controls' | 'sound' | 'back';

export interface MenuState {
  /** Which menu is up; null in play. */
  kind: MenuKind | null;
  page: MenuPage;
  /** The selected item on the page. */
  index: number;
}

export type MenuEvent =
  | { type: 'up' }
  | { type: 'down' }
  | { type: 'choose' }
  | { type: 'back' }
  /** Esc in play: open the pause menu. */
  | { type: 'pause' }
  /** The pointer is over an item. */
  | { type: 'select'; index: number };

/**
 * What the game must do after an event: nothing; close the menu and play on as things stand; close it and go to the
 * control room (M9: R, the game's start — toControlRoom), to standby in Pen 3 (toStandby) or to the open ocean
 * (?start=ocean); or toggle the persisted mute (M).
 */
export type MenuAction = 'none' | 'close' | 'controlRoom' | 'standby' | 'ocean' | 'toggleSound';

export const CLOSED: MenuState = Object.freeze({ kind: null, page: 'main', index: 0 });

export const openMenu = (kind: MenuKind): MenuState => ({ kind, page: 'main', index: 0 });

export function menuItems(kind: MenuKind, page: MenuPage): readonly MenuItem[] {
  if (page === 'controls') return ['back'];
  // M9: title — Start in the control room · Skip to Pen 3 · Skip to open ocean · Controls · Sound;
  // pause — Resume · Return to the control room · Return to Pen 3 · Skip to open ocean · Controls · Sound.
  return kind === 'title'
    ? ['controlRoom', 'pen', 'ocean', 'controls', 'sound']
    : ['resume', 'controlRoom', 'pen', 'ocean', 'controls', 'sound'];
}

/** An item's words on the menu `kind` it is on (M9: the title starts or skips; the pause menu returns). */
export function itemLabel(item: MenuItem, muted: boolean, kind: MenuKind): string {
  switch (item) {
    case 'controlRoom': return kind === 'title' ? 'Start in the control room' : 'Return to the control room';
    case 'resume': return 'Resume';
    case 'pen': return kind === 'title' ? 'Skip to Pen 3' : 'Return to Pen 3';
    case 'ocean': return 'Skip to open ocean';
    case 'controls': return 'Controls';
    case 'sound': return muted ? 'Sound: Off' : 'Sound: On';
    case 'back': return 'Back';
  }
}

export function menuOn(s: MenuState, e: MenuEvent): { state: MenuState; action: MenuAction } {
  const stay = { state: s, action: 'none' as const };
  if (s.kind === null) return e.type === 'pause' ? { state: openMenu('pause'), action: 'none' } : stay;
  const items = menuItems(s.kind, s.page);
  const n = items.length;
  switch (e.type) {
    case 'pause':
      return stay;
    case 'up':
      return { state: { ...s, index: (s.index - 1 + n) % n }, action: 'none' };
    case 'down':
      return { state: { ...s, index: (s.index + 1) % n }, action: 'none' };
    case 'select':
      return Number.isInteger(e.index) && e.index >= 0 && e.index < n ? { state: { ...s, index: e.index }, action: 'none' } : stay;
    case 'back':
      if (s.page === 'controls') return { state: backFromControls(s.kind), action: 'none' };
      // Esc on the pause menu resumes; the title menu has nothing behind it to go back to.
      return s.kind === 'pause' ? { state: CLOSED, action: 'close' } : stay;
    case 'choose':
      switch (items[s.index]) {
        case 'resume': return { state: CLOSED, action: 'close' };
        // M9: an explicit jump, not 'close' — the title may sit over any start (?menu=1&start=ocean).
        case 'controlRoom': return { state: CLOSED, action: 'controlRoom' };
        case 'pen': return { state: CLOSED, action: 'standby' };
        case 'ocean': return { state: CLOSED, action: 'ocean' };
        case 'controls': return { state: { kind: s.kind, page: 'controls', index: 0 }, action: 'none' };
        case 'sound': return { state: s, action: 'toggleSound' };
        case 'back': return { state: backFromControls(s.kind), action: 'none' };
        default: return stay;
      }
  }
}

function backFromControls(kind: MenuKind): MenuState {
  return { kind, page: 'main', index: menuItems(kind, 'main').indexOf('controls') };
}

/** Keys the menu reads (KeyboardEvent.code). Esc is handled first, as back / pause. */
export function menuEventFor(code: string): MenuEvent | null {
  switch (code) {
    case 'ArrowUp': case 'KeyW': return { type: 'up' };
    case 'ArrowDown': case 'KeyS': return { type: 'down' };
    case 'Enter': case 'NumpadEnter': case 'Space': return { type: 'choose' };
    case 'Escape': return { type: 'back' };
    default: return null;
  }
}

/**
 * Whether the title menu is up on load. Witness tooling needs immediate play, so any of ?script=, ?at=, ?start=,
 * ?hold or ?view= skips it, as does ?menu=0; ?menu=1 forces it. ?menu=pause (a witnessing hook) opens the pause
 * menu after the script instead.
 */
export function titleOnLoad(params: URLSearchParams): boolean {
  const menu = params.get('menu');
  if (menu === '1') return true;
  if (menu !== null) return false;
  return !['script', 'at', 'start', 'hold', 'view'].some((k) => params.has(k));
}

/**
 * The key that closes a menu (or acts in one) must not also act in the game: it is swallowed — its keydowns,
 * auto-repeats included, never reach the game — until it is released.
 */
export class Swallow {
  private readonly keys = new Set<string>();

  add(code: string): void {
    this.keys.add(code);
  }

  /** A keydown: true if the game must not hear it. */
  down(code: string): boolean {
    return this.keys.has(code);
  }

  /** A keyup releases the key. */
  up(code: string): void {
    this.keys.delete(code);
  }

  /** Window blur: every key is released. */
  clear(): void {
    this.keys.clear();
  }
}
