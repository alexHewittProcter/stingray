import type { GameMode } from './game/mode';

// window.__stingray: how a browser-driven check witnesses behaviour without a human at the keys.
// Phase 1 grows this with state(), combat(), teleport() and setInput() as the sim lands.
export interface DebugHandle {
  mode(): GameMode;
  steps(): number;
  camera(): { x: number; y: number; z: number };
  setCameraY(y: number): void;
  /** Run the sim for this many seconds of fixed steps and draw one frame — works in a hidden tab, where requestAnimationFrame is paused. */
  advance(seconds: number): void;
}

declare global {
  interface Window {
    __stingray?: DebugHandle;
  }
}

export function installDebugHandle(handle: DebugHandle): void {
  window.__stingray = handle;
}
