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
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', // 5: leave the seat (phase 3, M3; T9 wires it)
]);

/** onPress hears each key once per press (auto-repeat ignored), for edge-triggered controls. */
export function listenKeyboard(target: Window, onPress?: (code: string) => void): Keyboard {
  const held = new Set<string>();
  const down = (e: KeyboardEvent) => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (!e.repeat && !held.has(e.code)) onPress?.(e.code);
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
