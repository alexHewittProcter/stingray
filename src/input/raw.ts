// RawInput is the set of keys currently held, by KeyboardEvent.code.
export type RawInput = ReadonlySet<string>;

export interface Keyboard {
  readonly held: RawInput;
  dispose(): void;
}

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'Space',
]);

export function listenKeyboard(target: Window): Keyboard {
  const held = new Set<string>();
  const down = (e: KeyboardEvent) => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    held.add(e.code);
  };
  const up = (e: KeyboardEvent) => held.delete(e.code);
  const clear = () => held.clear();
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  target.addEventListener('blur', clear);
  return {
    held,
    dispose() {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
      target.removeEventListener('blur', clear);
    },
  };
}
