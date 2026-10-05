import { toSubInput } from '../input/pilot';
import type { RawInput } from '../input/raw';
import { type GameState, type LaunchControl, oceanStart, released, standby, stepGame } from '../sim/launch';
import { type SubInput, type SubState, NO_INPUT } from '../sim/sub';
import type { Vec3 } from '../sim/vec3';
import type { World } from '../sim/world';
import { type GameMode, modeOf } from './mode';

// The one owner of the session's GameState (L3). Every fixed step, in every mode, it consumes at most one
// queued press and calls stepGame. It keeps the previous state too, so rendering (and later sound) can
// interpolate between steps and read step-to-step changes. Presentation reads it; nothing else steps or resets it.
export class Game {
  steps = 0;
  /** Set when the sub is put somewhere discontinuously (start, R, teleport) so the camera can snap. */
  jumped = true;
  /** The driving input the last step applied (none while clamped), for drawing the craft. */
  input: SubInput = NO_INPUT;
  /** Debug: axes that replace the keyboard's while set. */
  override: Partial<SubInput> = {};
  /** Hears every fixed step's (previous, current) pair once, for sound (L7). Never straddles a jump. */
  onStep: ((previous: GameState, current: GameState) => void) | null = null;

  private current: GameState;
  private previous: GameState;
  /** Detonations from every step since the last drawn frame (T8): a frame that ran two steps used to lose the first's. */
  private unseenDetonations: Vec3[] = [];
  private readonly queue: LaunchControl[] = [];
  private restartHeld = false;

  constructor(
    private readonly world: World,
    start: GameState,
  ) {
    this.current = start;
    this.previous = start;
  }

  /** Queue a press (key, click or debug). Presses are consumed one per step, first in first out. */
  press(control: LaunchControl): void {
    this.queue.push(control);
  }

  /** Presses waiting for a step. */
  get queued(): readonly LaunchControl[] {
    return this.queue;
  }

  step(held: RawInput, dt: number): void {
    const restart = held.has('KeyR');
    if (restart && !this.restartHeld) this.restartNow();
    this.restartHeld = restart;

    const input = { ...toSubInput(held), ...this.override };
    const pressed = this.queue.shift() ?? null;
    this.previous = this.current;
    this.current = stepGame(this.current, input, pressed, dt, this.world);
    if (this.current.combat.detonations.length > 0) this.unseenDetonations.push(...this.current.combat.detonations);
    this.input = this.current.launch.clamps === 'locked' ? NO_INPUT : input;
    this.steps += 1;
    this.onStep?.(this.previous, this.current);
  }

  /** What the R key does (L4): back to standby in the pen, from anywhere, whichever way the session started. */
  restartNow(): void {
    this.toStandby();
  }

  /** L4's R: standby in the pen, keeping combat's clock and targets; missiles cleared, door shut at once. */
  toStandby(): void {
    this.set(standby(this.world, this.current.combat));
  }

  /** T9's "Skip to open ocean": phase 1's spawn, released, engines on (as ?start=ocean), keeping combat's clock and targets. */
  toOcean(): void {
    this.set(oceanStart(this.world, this.current.combat));
  }

  /** Put the sub somewhere discontinuously (L8's teleport): released, engines on, the door left as it is. */
  place(sub: SubState): void {
    this.set({ sub, combat: this.current.combat, launch: released(this.current.launch) });
  }

  /** The detonations of every step since the last call — for the frame that draws them, so none is skipped. */
  takeDetonations(): Vec3[] {
    const all = this.unseenDetonations;
    this.unseenDetonations = [];
    return all;
  }

  get state(): GameState {
    return this.current;
  }

  get lastState(): GameState {
    return this.previous;
  }

  /** L4: derived from where the hull centre is now. */
  get mode(): GameMode {
    return modeOf(this.current.sub.pos);
  }

  private set(g: GameState): void {
    this.current = g;
    this.previous = g;
    this.input = NO_INPUT;
    this.jumped = true;
    this.unseenDetonations = [];
  }
}

/**
 * L4's start: standby in Pen 3, unless the URL asks for the sea — ?start=ocean, or ?at=… (which implies it) —
 * in which case phase 1's spawn, released, engines on.
 */
export function startsAtSea(params: URLSearchParams): boolean {
  return params.get('start') === 'ocean' || params.has('at');
}

export function startState(world: World, params: URLSearchParams): GameState {
  return startsAtSea(params) ? oceanStart(world) : standby(world);
}
