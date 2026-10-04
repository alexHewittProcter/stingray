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
