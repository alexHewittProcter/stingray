import type { TroyInput } from '../sim/troy';
import type { RawInput } from './raw';

// Keys → Troy on foot (phase 3, M3), as pilot.ts maps them to the sub. W A S D move relative to the camera's yaw
// (W = away from the camera, D = to its right) and are rotated into the world frame here, so the sim reads no
// presentation value (M2: TroyInput.move is world-frame, +x east, −z north). Yaws are the sim's: 0 faces north (−Z),
// +yaw turns left; forward(yaw) = (−sin yaw, −cos yaw), right(yaw) = (cos yaw, −sin yaw).
//
// E is not read here: M3/M5 make it an edge-triggered press, queued by main.ts's onPress as Game.press('use') only
// while the session mode is 'onFoot' (aboard, toSubInput keeps reading KeyE as climb). TroyInput.use stays false.

const axis = (held: RawInput, positive: string, negative: string): number =>
  (held.has(positive) ? 1 : 0) - (held.has(negative) ? 1 : 0);

export function toTroyInput(held: RawInput, cameraYaw: number): TroyInput {
  const ahead = axis(held, 'KeyW', 'KeyS');
  const right = axis(held, 'KeyD', 'KeyA');
  // |move| ≤ 1: a diagonal is as fast as a straight line.
  const n = Math.hypot(ahead, right);
  if (n === 0) return { move: { x: 0, z: 0 }, use: false };
  const f = ahead / n;
  const r = right / n;
  const s = Math.sin(cameraYaw);
  const c = Math.cos(cameraYaw);
  return { move: { x: -s * f + c * r, z: -c * f - s * r }, use: false };
}

/** M3: on foot, E is 'use' (edge-triggered — the keyboard reports a key once per press); nothing else presses. */
export function troyPressFor(code: string): 'use' | null {
  return code === 'KeyE' ? 'use' : null;
}

/**
 * The yaw of a camera looking along `forward` (world frame), in the sim's convention — what main.ts writes into
 * Game.cameraYaw each frame (M3). Straight up or down has no yaw: `fallback` is kept then.
 */
export function yawOfView(forward: { x: number; z: number }, fallback = 0): number {
  if (Math.hypot(forward.x, forward.z) < 1e-6) return fallback;
  return Math.atan2(-forward.x, -forward.z);
}
