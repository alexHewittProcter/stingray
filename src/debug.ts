import type { GameMode } from './game/mode';
import type { CombatState } from './sim/combat';
import type { LaunchControl, LaunchState } from './sim/launch';
import type { SubInput, SubState } from './sim/sub';
import type { Vec3 } from './sim/vec3';

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
