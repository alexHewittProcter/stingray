import type { RawInput } from '../input/raw';
import type { World } from '../sim/world';
import type { ModeController } from './mode';

// Skeleton: counts steps so the loop is observable; the sub arrives with the simulation.
export class PilotingMode implements ModeController {
  steps = 0;
  private world: World | null = null;

  enter(world: World): void {
    this.world = world;
    this.steps = 0;
  }

  step(_input: RawInput, _dt: number): void {
    if (!this.world) return;
    this.steps += 1;
  }

  exit(): void {
    this.world = null;
  }
}
