import type { LaunchControl } from '../sim/launch';
import type { SubInput } from '../sim/sub';
import type { RawInput } from './raw';

// Keys → the sub's axes. SubInput.yaw > 0 turns left; pitch > 0 climbs.
const axis = (held: RawInput, positive: string[], negative: string[]): number =>
  (positive.some((k) => held.has(k)) ? 1 : 0) - (negative.some((k) => held.has(k)) ? 1 : 0);

export function toSubInput(held: RawInput): SubInput {
  return {
    throttle: axis(held, ['KeyW'], ['KeyS']),
    yaw: axis(held, ['KeyA'], ['KeyD']),
    pitch: axis(held, ['ArrowDown', 'KeyE'], ['ArrowUp', 'KeyQ']),
    boost: held.has('ShiftLeft') || held.has('ShiftRight'),
    fire: held.has('Space'),
  };
}

// L5: 1–4 press the launch controls. Presses are edge-triggered — the keyboard reports a key once per press.
const PRESS_KEYS: ReadonlyMap<string, LaunchControl> = new Map([
  ['Digit1', 'cradle'], ['Digit2', 'engines'], ['Digit3', 'clamps'], ['Digit4', 'door'],
]);

export function pressFor(code: string): LaunchControl | null {
  return PRESS_KEYS.get(code) ?? null;
}
