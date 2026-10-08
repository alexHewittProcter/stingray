import { toSubInput } from '../input/pilot';
import type { RawInput } from '../input/raw';
import { toTroyInput } from '../input/troy';
import { type GameState, type Press, oceanStart, released, standby } from '../sim/launch';
import { ROOMS, seatOf } from '../sim/rooms';
import { controlRoom, stepSession } from '../sim/session';
import { type SubInput, type SubState, NO_INPUT } from '../sim/sub';
import { STAND_STILL, aboard, nearestWalkable, onFoot } from '../sim/troy';
import type { Vec3 } from '../sim/vec3';
import type { World } from '../sim/world';
import { type GameMode, mappingOf, sessionMode } from './mode';

// The one owner of the session's GameState (L3, phase 3 M7). Every fixed step, in every mode, it consumes at most one
// queued press and calls stepSession (Troy, then phase 2's stepGame). It keeps the previous state too, so rendering
// (and sound) can interpolate between steps and read step-to-step changes. Presentation reads it; nothing else steps
// or resets it.
//
// M3's latch: after a jump (R, the menu's jumps, toControlRoom) or a change of key mapping (on foot ↔ riding ↔ aboard:
// lock-in, standing up), every key already held is ignored until it is released — so a W held across a transition
// does nothing. Crossing the mouth (launch ↔ piloting) is not a mapping change and latches nothing. Debug teleports
// (place) do not latch either: the witness scripts hold keys across them.
export class Game {
  steps = 0;
  /** Set when the sub is put somewhere discontinuously (start, R, teleport) so the camera can snap. */
  jumped = true;
  /** The driving input the last step applied (none while clamped), for drawing the craft. */
  input: SubInput = NO_INPUT;
  /**
   * M3: the drawn camera's yaw (the sim's convention: 0 looks north, +yaw left), written by main.ts each frame and read
   * by the next step's on-foot mapping (input/troy.ts) so W walks away from the camera. 0 with no camera (tests,
   * ?script=), so W is north.
   */
  cameraYaw = 0;
  /** Debug: axes that replace the keyboard's while set. */
  override: Partial<SubInput> = {};
  /** Hears every fixed step's (previous, current) pair once, for sound (L7). Never straddles a jump. */
  onStep: ((previous: GameState, current: GameState) => void) | null = null;

  private current: GameState;
  private previous: GameState;
  /** Detonations from every step since the last drawn frame (T8): a frame that ran two steps used to lose the first's. */
  private unseenDetonations: Vec3[] = [];
  private readonly queue: Press[] = [];
  private restartHeld = false;
  /** M3: keys held at the last jump or mapping change, ignored until released. */
  private readonly latched = new Set<string>();
  private latchPending = false;

  constructor(
    private readonly world: World,
    start: GameState,
  ) {
    this.current = start;
    this.previous = start;
  }

  /** Queue a press (key, click or debug): a launch control, 'use' or 'leave' (M7). Consumed one per step, in order. */
  press(p: Press): void {
    this.queue.push(p);
  }

  /** Presses waiting for a step. */
  get queued(): readonly Press[] {
    return this.queue;
  }

  step(held: RawInput, dt: number): void {
    const restart = held.has('KeyR');
    if (restart && !this.restartHeld) this.restartNow();
    this.restartHeld = restart;

    const live = this.unlatched(held);
    const input = { ...toSubInput(live), ...this.override };
    const mapping = mappingOf(sessionMode(this.current));
    // M3: which mapping applies is the session mode's when the keys are read. On foot W A S D walk Troy, relative to
    // the camera (input/troy.ts); aboard they are the sub's (stepSession gives the sub NO_INPUT unless Troy is aboard).
    const troyInput = mapping === 'onFoot' ? toTroyInput(live, this.cameraYaw) : STAND_STILL;
    const pressed = this.queue.shift() ?? null;
    this.previous = this.current;
    this.current = stepSession(this.current, input, troyInput, pressed, dt, this.world, ROOMS);
    if (mappingOf(sessionMode(this.current)) !== mapping) this.latchPending = true;
    if (this.current.combat.detonations.length > 0) this.unseenDetonations.push(...this.current.combat.detonations);
    const driven = this.current.troy.where === 'aboard' && this.current.launch.clamps === 'released';
    this.input = driven ? input : NO_INPUT;
    this.steps += 1;
    this.onStep?.(this.previous, this.current);
  }

  /** M3's latch: the held keys less those held since the last jump or mapping change (released ones drop out). */
  private unlatched(held: RawInput): RawInput {
    if (this.latchPending) {
      this.latched.clear();
      for (const k of held) this.latched.add(k);
      this.latchPending = false;
    }
    for (const k of this.latched) if (!held.has(k)) this.latched.delete(k);
    if (this.latched.size === 0) return held;
    return new Set([...held].filter((k) => !this.latched.has(k)));
  }

  /** Keys the latch is ignoring right now (for tests and debug). */
  get latchedKeys(): ReadonlySet<string> {
    return this.latched;
  }

  /**
   * What the R key does (phase 3 M3/M9, amending L4): back to the game's start — Troy standing in the control room, the
   * sub in standby — from anywhere, whichever way the session started. The menu's "Return to Pen 3" is toStandby.
   */
  restartNow(): void {
    this.toControlRoom();
  }

  /** L4's R: standby in the pen, keeping combat's clock and targets; missiles cleared, door shut at once. */
  toStandby(): void {
    this.set(standby(this.world, this.current.combat), true);
  }

  /** T9's "Skip to open ocean": phase 1's spawn, released, engines on (as ?start=ocean), keeping combat's clock and targets. */
  toOcean(): void {
    this.set(oceanStart(this.world, this.current.combat), true);
  }

  /** Phase 3 (M7, M9): Troy standing in the control room, the sub in standby, keeping combat's clock and targets. */
  toControlRoom(): void {
    this.set(controlRoom(this.world, ROOMS, this.current.combat), true);
  }

  /** Put the sub somewhere discontinuously (L8's teleport): Troy aboard, released, engines on, the door left as it is. */
  place(sub: SubState): void {
    const troy = aboard(seatOf(this.world.marineville.interior.cradle));
    this.set({ ...this.current, sub, launch: released(this.current.launch), troy });
  }

  /**
   * Debug (M10's walkTo, ?script= walk=x:z): Troy on foot at the walkable point nearest (x, z), keeping his facing if
   * he was on foot (else the start's); the sub, the machinery and combat left as they are. A jump for the camera
   * (it snaps), but no latch — as place(), the witness scripts hold keys across it.
   */
  walkTo(x: number, z: number): void {
    const t = this.current.troy;
    const yaw = t.where === 'onFoot' ? t.yaw : ROOMS.start.yaw;
    this.set({ ...this.current, troy: onFoot({ pos: nearestWalkable(x, z, ROOMS), yaw }) });
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

  /** M7: derived from the whole state — Troy's whereabouts, else where the hull centre is now. */
  get mode(): GameMode {
    return sessionMode(this.current);
  }

  private set(g: GameState, latch = false): void {
    this.current = g;
    this.previous = g;
    this.input = NO_INPUT;
    this.jumped = true;
    this.unseenDetonations = [];
    if (latch) this.latchPending = true;
  }
}

/**
 * L4's start: standby in Pen 3, unless the URL asks for the sea — ?start=ocean, or ?at=… (which implies it) —
 * in which case phase 1's spawn, released, engines on.
 */
export function startsAtSea(params: URLSearchParams): boolean {
  return params.get('start') === 'ocean' || params.has('at');
}

/**
 * Where the URL starts the game (M7): ?start=pen|control|ocean; ?at= implies ocean; ?script= without ?start implies
 * pen, so every phase-2 witnessing URL runs unchanged. The default is the pen until T8 makes it the control room.
 */
export function startPlace(params: URLSearchParams): StartPlace {
  if (startsAtSea(params)) return 'ocean';
  const start = params.get('start') ?? (params.has('script') ? 'pen' : DEFAULT_START);
  return start === 'control' ? 'control' : 'pen';
}

export type StartPlace = 'pen' | 'control' | 'ocean';

/** Where a URL with no ?start begins: the pen until T8 (main stays playable at every merge), then the control room. */
export const DEFAULT_START: StartPlace = 'pen';

export function startState(world: World, params: URLSearchParams): GameState {
  const place = startPlace(params);
  return place === 'ocean' ? oceanStart(world) : place === 'control' ? controlRoom(world, ROOMS) : standby(world);
}
