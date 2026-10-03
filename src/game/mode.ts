import type { RawInput } from '../input/raw';
import type { World } from '../sim/world';

// Phase 1 implements 'piloting' only; the other names are reserved for phases 2-3.
// Switching modes never reloads the scene.
export type GameMode = 'piloting' | 'launch' | 'onFoot' | 'transport';

export interface ModeController {
  enter(world: World): void;
  /** Advance by one fixed step (1/60 s). */
  step(input: RawInput, dt: number): void;
  exit(): void;
}
