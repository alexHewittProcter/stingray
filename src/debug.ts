import type { GameMode } from './game/mode';
import type { CombatState } from './sim/combat';
import type { SubInput, SubState } from './sim/sub';
import type { Vec3 } from './sim/vec3';

// window.__stingray: how a browser-driven check witnesses behaviour without a human at the keys.
export interface DebugHandle {
  mode(): GameMode;
  steps(): number;
  state(): SubState;
  combat(): CombatState;
  /** Put the sub at rest at a position (optionally with a heading). */
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
