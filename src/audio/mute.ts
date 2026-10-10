// M mutes and unmutes (L5); the choice persists across reloads. Storage can be missing or throw (private
// windows, blocked site data), so every access is guarded and the game plays on unmuted.

export const MUTE_KEY = 'stingray.muted';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function readMuted(store: Store | undefined): boolean {
  try {
    return store?.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeMuted(store: Store | undefined, muted: boolean): void {
  try {
    store?.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // Not remembered; the toggle still works for this session.
  }
}

// Phase 4 (S4): the menu's Music switch — on/off, remembered as the mute is, default on. ?music=0 starts a page with
// the music off without touching what is stored (a witnessing run).
export const MUSIC_KEY = 'stingray.music';

export function readMusic(store: Store | undefined): boolean {
  try {
    return store?.getItem(MUSIC_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeMusic(store: Store | undefined, on: boolean): void {
  try {
    store?.setItem(MUSIC_KEY, on ? '1' : '0');
  } catch {
    // Not remembered; the switch still works for this session.
  }
}

/** The switch a page starts with: the stored one, unless ?music=0 says off for this page. */
export function musicOnLoad(store: Store | undefined, params: URLSearchParams): boolean {
  return params.get('music') === '0' ? false : readMusic(store);
}
