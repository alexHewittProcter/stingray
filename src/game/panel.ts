// The launch panel's decisions (phase 2, L6) — pure, no DOM. From the session's GameState, the presented mode and
// the interior, it says what the panel and the HUD's status line show: each control's lamp, lever, state word and
// whether a press would be accepted; the refusal on show; the status line; and the first-time prompt.
// render/launch-panel.ts draws it; nothing here writes sim state.

import { COAST_Z } from '../sim/world';
import { type GameState, type LaunchControl, LAUNCH_CONTROLS, REFUSAL, cradleHeight, refusalFor } from '../sim/launch';
import { TUNING as T } from '../sim/tuning';
import type { Vec3 } from '../sim/vec3';
import type { Interior } from '../sim/world';

/** What presentation shows: the pen-and-tunnel panel and status ('launch') or the sea HUD ('piloting'). */
export type Shown = 'launch' | 'piloting';

/**
 * L4 lets presentation hold its mode until the hull centre is this far past the cliff face, so hovering in an open
 * doorway does not flicker the HUD.
 */
export const MODE_HOLD = 2; // m

/**
 * What the panel remembers between frames — presentation only, never sim state.
 * - `shown`: the presented mode, with L4's hold.
 * - `trip`: 'out' from standby until Stingray reaches the open sea, then 'home' until it is docked (raised) again.
 *   The machinery alone cannot tell "lowered, engines on, clamps locked" before release from the same state after
 *   a lock; the trip can, and it decides which control is the sensible next one.
 * - `launched`: a launch from the pen has reached the sea at least once this session (the prompts stop).
 */
export interface PanelMemory {
  shown: Shown;
  trip: 'out' | 'home';
  launched: boolean;
}

export type Lamp = 'dark' | 'amber' | 'green' | 'red';

export interface ControlView {
  control: LaunchControl;
  key: '1' | '2' | '3' | '4';
  label: string;
  /** dark = a press would be refused; amber = accepted, or moving; green = in its launch position; red = just refused. */
  lamp: Lamp;
  /** The machine is moving (amber, pulsing). */
  moving: boolean;
  /** 0 = up (raised / off / locked / shut) … 1 = down (lowered / running / released / open); tracks travel. */
  lever: number;
  /** One word for the state, e.g. RAISED · LOWERING · LOWERED. */
  word: string;
  /** A press now would be accepted (and would do something). */
  pressable: boolean;
  /** The sensible next control — marked quietly on the panel. */
  next: boolean;
}

export interface PanelView {
  /** The controls on show, in key order; empty when the panel is hidden. */
  controls: ControlView[];
  /** The last refused press, for refusalShow seconds. */
  refusal: { control: LaunchControl; reason: string } | null;
  /** The HUD's one-line status in 'launch' presentation; null at sea (the sea readouts show instead). */
  status: string | null;
  /** First-time guidance, until a launch has reached the sea once; null otherwise. */
  prompt: string | null;
}

const KEYS = { cradle: '1', engines: '2', clamps: '3', door: '4' } as const;
const LABELS = { cradle: 'CRADLE', engines: 'ENGINES', clamps: 'CLAMPS', door: 'OCEAN DOOR' } as const;

// ---- Memory ----

export function initialMemory(g: GameState): PanelMemory {
  return {
    shown: g.sub.pos.z < COAST_Z ? 'launch' : 'piloting',
    trip: g.launch.clamps === 'locked' ? 'out' : 'home',
    launched: false,
  };
}

/** Called once per drawn frame with the current state. */
export function remember(m: PanelMemory, g: GameState): PanelMemory {
  const z = g.sub.pos.z;
  let shown = m.shown;
  if (shown === 'piloting' && z < COAST_Z - MODE_HOLD) shown = 'launch';
  else if (shown === 'launch' && z > COAST_Z + MODE_HOLD) shown = 'piloting';

  let { trip, launched } = m;
  const l = g.launch;
  if (l.clamps === 'locked' && l.cradle === 0 && l.cradleDir === 0) trip = 'out';
  else if (trip === 'out' && l.clamps === 'released' && z > COAST_Z) [trip, launched] = ['home', true];

  return shown === m.shown && trip === m.trip && launched === m.launched ? m : { shown, trip, launched };
}

// ---- The view ----

export function panelView(g: GameState, m: PanelMemory, interior: Interior): PanelView {
  const l = g.launch;
  const next = nextControl(g, m, interior);
  const fresh = l.refusal && l.refusal.age < T.refusalShow ? l.refusal : null;

  const shownControls = LAUNCH_CONTROLS.filter((c) => {
    if (m.shown === 'launch') return true;
    if (fresh?.control === c) return true; // a refused press at sea shows its control for the reason's 3 s
    return c === 'door' && l.clamps === 'released' && refusalFor('door', l, g.sub, interior) !== REFUSAL.outOfRange;
  });

  return {
    controls: shownControls.map((c) => controlView(c, g, interior, next, fresh?.control === c)),
    refusal: fresh && shownControls.includes(fresh.control) ? { control: fresh.control, reason: fresh.reason } : null,
    status: m.shown === 'launch' ? statusLine(g, m, interior) : null,
    prompt: promptLine(g, m, interior, next),
  };
}

function controlView(c: LaunchControl, g: GameState, interior: Interior, next: LaunchControl | null, refused: boolean): ControlView {
  const l = g.launch;
  const moving = isMoving(c, g);
  const inPosition = c === 'cradle' ? l.cradle >= 1 && l.cradleDir === 0
    : c === 'engines' ? l.engines === 'on'
    : c === 'clamps' ? l.clamps === 'released'
    : l.door >= 1;
  const pressable = wouldAct(c, g, interior);
  // Green wins over amber unless the press that would take it out of position is the next step (coming home).
  const lamp: Lamp = refused ? 'red'
    : moving ? 'amber'
    : inPosition && !(pressable && next === c) ? 'green'
    : pressable ? 'amber'
    : 'dark';
  return { control: c, key: KEYS[c], label: LABELS[c], lamp, moving, lever: leverOf(c, g), word: wordOf(c, g, interior), pressable, next: next === c };
}

function isMoving(c: LaunchControl, g: GameState): boolean {
  const l = g.launch;
  if (c === 'cradle') return l.cradleDir !== 0;
  if (c === 'engines') return l.engines === 'starting';
  if (c === 'door') return l.doorDir !== 0;
  return false;
}

/** The press would be accepted and would change something (a press on an open or opening door does nothing). */
function wouldAct(c: LaunchControl, g: GameState, interior: Interior): boolean {
  const l = g.launch;
  if (refusalFor(c, l, g.sub, interior) !== null) return false;
  return !(c === 'door' && (l.door >= 1 || l.doorDir === 1));
}

function leverOf(c: LaunchControl, g: GameState): number {
  const l = g.launch;
  if (c === 'cradle') return l.cradle;
  if (c === 'engines') return l.engines === 'off' ? 0 : 1;
  if (c === 'clamps') return l.clamps === 'locked' ? 0 : 1;
  return l.door;
}

function wordOf(c: LaunchControl, g: GameState, interior: Interior): string {
  const l = g.launch;
  switch (c) {
    case 'cradle':
      return l.cradleDir === 1 ? 'LOWERING' : l.cradleDir === -1 ? 'RAISING' : l.cradle >= 1 ? 'LOWERED' : 'RAISED';
    case 'engines':
      return l.engines === 'off' ? 'OFF' : l.engines === 'starting' ? 'STARTING' : 'RUNNING';
    case 'clamps':
      return l.clamps === 'released' ? 'RELEASED' : carrying(g, interior) ? 'LOCKING' : 'LOCKED';
    case 'door':
      return l.doorDir === 1 ? 'OPENING' : l.doorDir === -1 ? 'CLOSING' : l.door >= 1 ? 'OPEN' : 'SHUT';
  }
}

/** Clamped but not yet on the cradle's pose: the lock's carry is under way. */
function carrying(g: GameState, interior: Interior): boolean {
  const c = interior.cradle;
  const p = g.sub.pos;
  return Math.hypot(p.x - c.pos.x, p.y - cradleHeight(g.launch.cradle, interior), p.z - c.pos.z) > 0.05;
}

// ---- The sensible next control ----

export function nextControl(g: GameState, m: PanelMemory, interior: Interior): LaunchControl | null {
  const l = g.launch;
  const doorWanted = l.clamps === 'released' && l.door < 1 && l.doorDir !== 1 && refusalFor('door', l, g.sub, interior) === null;
  if (l.clamps === 'locked') {
    if (l.cradleDir !== 0 || l.engines === 'starting') return null;
    if (m.trip === 'out') {
      if (l.cradle <= 0) return 'cradle';
      return l.engines === 'off' ? 'engines' : 'clamps';
    }
    if (carrying(g, interior)) return null;
    return l.engines !== 'off' ? 'engines' : 'cradle';
  }
  if (m.trip === 'home' && refusalFor('clamps', l, g.sub, interior) === null) return 'clamps';
  return doorWanted ? 'door' : null;
}

// ---- Words ----

const PROMPT: Record<LaunchControl, string> = {
  cradle: 'Press 1 — lower the cradle',
  engines: 'Press 2 — start the engines',
  clamps: 'Press 3 — release the clamps',
  door: 'Press 4 — open the ocean door',
};

/** First-time guidance: one quiet line naming the next step, until a launch has reached the open sea once. */
function promptLine(g: GameState, m: PanelMemory, interior: Interior, next: LaunchControl | null): string | null {
  if (m.launched || m.trip !== 'out' || m.shown !== 'launch') return null;
  if (next) return PROMPT[next];
  const l = g.launch;
  if (l.clamps === 'locked') return null; // a machine is moving; the status line says which
  if (l.doorDir === 1) return 'The ocean door is opening — drive on through';
  if (l.door >= 1) return 'Door open — W to drive out to sea';
  if (inPen(g.sub.pos, interior)) return 'W to drive, A / D to steer — into the tunnel';
  return 'Follow the tunnel to the ocean door';
}

/** The HUD's one line in 'launch' presentation. */
function statusLine(g: GameState, m: PanelMemory, interior: Interior): string {
  const l = g.launch;
  if (l.cradleDir === 1) return 'CRADLE LOWERING';
  if (l.cradleDir === -1) return 'CRADLE RAISING';

  if (l.clamps === 'locked') {
    if (carrying(g, interior)) return 'CLAMPS LOCKING';
    if (l.cradle <= 0) return m.launched ? 'STINGRAY DOCKED — PEN 3' : 'STINGRAY ON STANDBY — PEN 3';
    if (l.engines === 'starting') return 'ENGINES STARTING';
    if (m.trip === 'out') return l.engines === 'on' ? 'ENGINES RUNNING — READY TO RELEASE' : 'STINGRAY SUBMERGED — ENGINES OFF';
    return l.engines === 'on' ? 'CLAMPS LOCKED — ENGINES RUNNING' : 'ENGINES STOPPED — READY TO RAISE';
  }

  if (l.doorDir === 1) return 'OCEAN DOOR OPENING';
  if (l.doorDir === -1) return m.trip === 'home' ? 'OCEAN DOOR CLOSING BEHIND YOU' : 'OCEAN DOOR CLOSING';
  const toDoor = Math.round(distance(g.sub.pos, interior.door.centre));
  if (m.trip === 'out') {
    if (l.door >= 1) return 'OCEAN DOOR OPEN — CLEAR TO LAUNCH';
    if (inPen(g.sub.pos, interior)) return 'STINGRAY AWAY — PEN 3';
    return `LAUNCH TUNNEL — OCEAN DOOR ${toDoor} M`;
  }
  if (inPen(g.sub.pos, interior)) return 'STINGRAY IN PEN 3';
  return l.door >= 1 ? 'OCEAN DOOR OPEN' : 'LAUNCH TUNNEL — PEN 3 AHEAD';
}

function inPen(p: Vec3, interior: Interior): boolean {
  const { min, max } = interior.pen;
  return p.x >= min.x && p.x <= max.x && p.z >= min.z && p.z <= max.z;
}

const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
