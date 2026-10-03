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
