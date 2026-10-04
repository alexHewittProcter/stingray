import { toSubInput } from '../input/pilot';
import type { RawInput } from '../input/raw';
import { type GameState, type LaunchControl, released, standby, stepGame } from '../sim/launch';
import { type SubInput, type SubState, NO_INPUT, initialSubState } from '../sim/sub';
import { TUNING as T } from '../sim/tuning';
import type { World } from '../sim/world';
import { type GameMode, modeOf } from './mode';

/** What R does: phase 1's return to the sea spawn, or L4's return to standby in the pen. */
export type Restart = 'spawn' | 'standby';

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

  private current: GameState;
  private previous: GameState;
  private readonly queue: LaunchControl[] = [];
  private restartHeld = false;

  constructor(
    private readonly world: World,
    start: GameState,
    private readonly restart: Restart,
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
    this.input = this.current.launch.clamps === 'locked' ? NO_INPUT : input;
    this.steps += 1;
  }

  /** What the R key does. */
  restartNow(): void {
    if (this.restart === 'standby') this.toStandby();
    else this.respawn();
  }

  /** L4's R: standby in the pen, keeping combat's clock and targets; missiles cleared, door shut at once. */
  toStandby(): void {
    this.set(standby(this.world, this.current.combat));
  }

  /** Phase 1's R: back to the sea spawn, at rest. */
  respawn(): void {
    this.place(initialSubState(this.world));
  }

  /** Put the sub somewhere discontinuously (L8's teleport): released, engines on, the door left as it is. */
  place(sub: SubState): void {
    this.set({ sub, combat: this.current.combat, launch: released(this.current.launch) });
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
  }
}

/** A plain one-line status for the HUD in 'launch' mode: a fresh refusal first, then what the machinery is doing. */
export function launchStatus(g: GameState): string {
  const l = g.launch;
  if (l.refusal && l.refusal.age < T.refusalShow) return l.refusal.reason.toUpperCase();
  if (l.cradleDir === 1) return 'CRADLE LOWERING';
  if (l.cradleDir === -1) return 'CRADLE RAISING';
  if (l.engines === 'starting') return 'ENGINES STARTING';
  if (l.doorDir === 1) return 'OCEAN DOOR OPENING';
  if (l.doorDir === -1) return 'OCEAN DOOR CLOSING';
  if (l.clamps === 'locked') {
    if (l.cradle === 0) return 'STINGRAY DOCKED — PEN 3';
    return l.engines === 'on' ? 'ENGINES ON — CLAMPS LOCKED' : 'STINGRAY SUBMERGED';
  }
  return l.door === 1 ? 'OCEAN DOOR OPEN' : 'STINGRAY AWAY';
}
