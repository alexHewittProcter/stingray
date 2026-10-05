import type { GameMode } from './game/mode';
import type { CombatState } from './sim/combat';
import type { LaunchControl, LaunchState } from './sim/launch';
import type { SubInput, SubState } from './sim/sub';
import type { Vec3 } from './sim/vec3';
import { MARINEVILLE } from './sim/world';

// window.__stingray: how a browser-driven check witnesses behaviour without a human at the keys.
export interface DebugHandle {
  /** L4's derived mode: 'launch' while the hull centre is north of the cliff face. */
  mode(): GameMode;
  steps(): number;
  state(): SubState;
  combat(): CombatState;
  /** L8: the launch machinery's state. */
  launch(): LaunchState;
  /** L8: queue a press, as the 1–4 keys do; consumed on a later step, one per step. */
  press(control: LaunchControl): void;
  /** Put the sub at rest at a position (optionally with a heading); released, engines on, the door left as it is. */
  teleport(pos: Vec3, yaw?: number): void;
  /** Hold these axes regardless of the keyboard; pass {} to release. */
  setInput(input: Partial<SubInput>): void;
  /** Run the sim for this many seconds of fixed steps and draw one frame — works in a hidden tab, where requestAnimationFrame is paused. */
  advance(seconds: number): void;
  camera(): Vec3;
}

declare global {
  interface Window {
    __stingray?: DebugHandle;
  }
}

export function installDebugHandle(handle: DebugHandle): void {
  window.__stingray = handle;
}

const CONTROLS: readonly string[] = ['cradle', 'engines', 'clamps', 'door'];

/** Bounds on witnessing scripts and the handle's advance, so a typo'd or hostile URL cannot freeze the tab. */
export const SCRIPT_LIMITS = Object.freeze({ secondsPerAdvance: 120, totalSeconds: 600, tokens: 64 });

/** The seconds an advance may run: positive and finite, at most SCRIPT_LIMITS.secondsPerAdvance; anything else is 0. */
export function clampAdvance(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, SCRIPT_LIMITS.secondsPerAdvance) : 0;
}

/**
 * A point on the tunnel's centreline `metres` in from the mouth (negative: out at sea along the tunnel's axis),
 * and the heading that faces out to sea (`out`) or in toward the pen (`in`) there.
 */
export function onCentreline(metres: number, facing: 'in' | 'out'): { pos: Vec3; yaw: number } {
  const line = MARINEVILLE.interior.tunnel.centreline;
  let left = metres;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1]!;
    const b = line[k]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const last = k === line.length - 1;
    if (left <= len || last || (k === 1 && left < 0)) {
      const t = Math.min(left, len) / len;
      const d = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
      // forwardOf(yaw) = (−sin yaw, ·, −cos yaw): yaw = atan2(−fx, −fz).
      const f = facing === 'in' ? d : { x: -d.x, z: -d.z };
      return {
        pos: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t },
        yaw: Math.atan2(-f.x, -f.z),
      };
    }
    left -= len;
  }
  return { pos: { ...line[0]! }, yaw: MARINEVILLE.tunnelHeading };
}

/**
 * A point on the pen's axis at the lowered cradle's height, `metres` south of the cradle position (toward the tunnel;
 * negative: north of it), facing the cradle.
 */
export function nearCradle(metres: number): { pos: Vec3; yaw: number } {
  const c = MARINEVILLE.interior.cradle;
  // North is −z; yaw 0 faces north, π south.
  return { pos: { x: c.pos.x, y: c.loweredY, z: c.pos.z + metres }, yaw: metres >= 0 ? 0 : Math.PI };
}

/**
 * Run a witnessing script once (the ?script= URL parameter): a comma list of words, run in order.
 *   - a control name (cradle, engines, clamps, door) presses it;
 *   - a number advances the sim that many seconds (clamped to SCRIPT_LIMITS; zero, negative or not a number: skipped);
 *   - out=M / in=M puts the released sub at rest on the tunnel's centreline M metres in from the mouth (negative:
 *     out at sea), facing out to sea or in toward the pen;
 *   - throttle=T, steer=Y, climb=P hold those axes at T / Y / P (−1 … 1; steer > 0 turns left, climb > 0 climbs)
 *     until the script changes them;
 *   - dock=M puts the released sub at rest on the pen's axis at the lowered cradle's height, M metres south of the
 *     cradle (negative: north), facing it; dx= / dy= / dz= move it that many metres and turn= turns it (degrees,
 *     left), each at rest (all within ±100).
 * "cradle,8.2,engines,2.1,clamps,1" lowers the cradle, starts the engines and releases the clamps;
 * "out=40,door,5" waits in the door chamber while the door opens. Unknown words are ignored. At most
 * SCRIPT_LIMITS.tokens words run, and at most SCRIPT_LIMITS.totalSeconds in all.
 */
export function runScript(script: string, handle: DebugHandle): void {
  let total = 0;
  const words = script.split(',').map((w) => w.trim()).filter(Boolean).slice(0, SCRIPT_LIMITS.tokens);
  for (const word of words) {
    if (CONTROLS.includes(word)) {
      handle.press(word as LaunchControl);
      continue;
    }
    const [key, value] = word.split('=');
    if (value !== undefined) {
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      if (key === 'out' || key === 'in') {
        const at = onCentreline(Math.max(-1000, n), key);
        handle.teleport(at.pos, at.yaw);
      } else if (key === 'throttle' || key === 'steer' || key === 'climb') {
        const axis = key === 'throttle' ? 'throttle' : key === 'steer' ? 'yaw' : 'pitch';
        handle.setInput({ [axis]: Math.max(-1, Math.min(1, n)) });
      } else if (key === 'dock') {
        const at = nearCradle(Math.max(-100, Math.min(100, n)));
        handle.teleport(at.pos, at.yaw);
      } else if (key === 'dx' || key === 'dy' || key === 'dz' || key === 'turn') {
        const s = handle.state();
        const d = Math.max(-100, Math.min(100, n));
        const pos = { ...s.pos };
        if (key === 'dx') pos.x += d;
        if (key === 'dy') pos.y += d;
        if (key === 'dz') pos.z += d;
        handle.teleport(pos, key === 'turn' ? s.yaw + (d * Math.PI) / 180 : s.yaw);
      }
      continue;
    }
    const seconds = Math.min(clampAdvance(Number(word)), SCRIPT_LIMITS.totalSeconds - total);
    if (seconds <= 0) continue;
    total += seconds;
    handle.advance(seconds);
  }
}
