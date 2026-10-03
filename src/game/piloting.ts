import { toSubInput } from '../input/pilot';
import type { RawInput } from '../input/raw';
import { type SubInput, type SubState, NO_INPUT, initialSubState, stepSub } from '../sim/sub';
import type { World } from '../sim/world';
import type { ModeController } from './mode';

// Piloting Stingray: owns the sub's sim state and advances it one fixed step at a time.
// It keeps the previous state too, so rendering can interpolate between steps.
export class PilotingMode implements ModeController {
  steps = 0;
  /** Set when the sub is put somewhere discontinuously (spawn, restart, teleport) so the camera can snap. */
  jumped = true;
  input: SubInput = NO_INPUT;
  /** Debug: axes that replace the keyboard's while set. */
  override: Partial<SubInput> = {};

  private world!: World;
  private current!: SubState;
  private previous!: SubState;
  private restartHeld = false;

  enter(world: World): void {
    this.world = world;
    this.steps = 0;
    this.respawn();
  }

  step(held: RawInput, dt: number): void {
    const restart = held.has('KeyR');
    if (restart && !this.restartHeld) this.respawn();
    this.restartHeld = restart;

    this.input = { ...toSubInput(held), ...this.override };
    this.previous = this.current;
    this.current = stepSub(this.current, this.input, dt, this.world);
    this.steps += 1;
  }

  exit(): void {}

  get state(): SubState {
    return this.current;
  }

  get lastState(): SubState {
    return this.previous;
  }

  respawn(): void {
    this.place(initialSubState(this.world));
  }

  place(state: SubState): void {
    this.current = state;
    this.previous = state;
    this.jumped = true;
  }
}
