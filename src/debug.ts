import type { GameMode } from './game/mode';
import type { CombatState } from './sim/combat';
import type { LaunchControl, LaunchState, Press } from './sim/launch';
import { FLOOR_Y, ROOMS, type Rooms, SEAT, TOWER_AXIS } from './sim/rooms';
import type { SubInput, SubState } from './sim/sub';
import type { TroyState } from './sim/troy';
import type { Vec3 } from './sim/vec3';
import { MARINEVILLE } from './sim/world';

// window.__stingray: how a browser-driven check witnesses behaviour without a human at the keys.
export interface DebugHandle {
  /** L4's derived mode: 'launch' while the hull centre is north of the cliff face. */
  mode(): GameMode;
  steps(): number;
  state(): SubState;
  combat(): CombatState;
  /** L8: the launch machinery's state. */
  launch(): LaunchState;
  /** L8: queue a press, as the 1–4 keys do; consumed on a later step, one per step. Phase 3: any Press (M7). */
  press(control: Press): void;
  /** Put the sub at rest at a position (optionally with a heading); released, engines on, the door left as it is. */
  teleport(pos: Vec3, yaw?: number): void;
  /** Hold these axes regardless of the keyboard; pass {} to release. */
  setInput(input: Partial<SubInput>): void;
  /** Run the sim for this many seconds of fixed steps and draw one frame — works in a hidden tab, where requestAnimationFrame is paused. */
  advance(seconds: number): void;
  camera(): Vec3;
  /** T9: which menu is up, if any. advance() steps the sim whether or not one is (it is a debug tool). */
  menu(): 'title' | 'pause' | null;
  /** T9: close whichever menu is up and play on as things stand (as Resume does; M9's title items all jump instead). */
  closeMenu(): void;
  /** Phase 3 (M10): Troy's state. */
  troy(): TroyState;
  /** Phase 3 (M10): the rooms' data (sim/rooms.ts). */
  rooms(): Rooms;
  /** Phase 3 (M10): Troy on foot at the walkable point nearest (x, z); the camera snaps. */
  walkTo(x: number, z: number): void;
  /** Phase 3 (M10): queue 'use' (M5), as E does on foot. */
  use(): void;
  /**
   * Phase 3 (M10): queue 'leave' — the launch panel's fifth control (M9). Refused 'Dock first' unless Troy is aboard a
   * docked, raised sub; accepted, Troy rides back up to the control room (M6b).
   */
  leave(): void;
  /**
   * Phase 3 (T9, witnessing): Troy, on foot, turned in place to face this heading (degrees, the sim's yaw: 0 north, 90
   * west); the camera snaps. Riding or aboard, nothing. (M6b's loop witness: he stands up facing away from the chair.)
   */
  face(degrees: number): void;
}

declare global {
  interface Window {
    __stingray?: DebugHandle;
  }
}

export function installDebugHandle(handle: DebugHandle): void {
  window.__stingray = handle;
}

const CONTROLS: readonly string[] = ['cradle', 'engines', 'clamps', 'door'];

const A = TOWER_AXIS;
const C = ROOMS.chair.pos;
const HALL_CEILING_Y = MARINEVILLE.interior.pen.max.y;

/**
 * Phase 3 (M10), phase 4 (W): named ?view= presets — the control room, the station, the shaft, and the port and hatch at
 * its foot in the pen hall — so each can be screenshotted headless (the default start puts Troy in the control room):
 * x, y, z, lookX, lookY, lookZ, as the six-number form, each relative to the tower's axis / the chair / the seat (D1).
 * Listed with their URLs in docs/witnessing.md. `port` and `hatch` (phase 4 D3) start in the pen without a ?start=
 * (game.ts startPlace): the docked sub, the port's lid open, the pole down to the open hatch.
 */
export const VIEW_PRESETS: Readonly<Record<string, readonly [number, number, number, number, number, number]>> = Object.freeze({
  // The control room from the south windows (west of Troy's start), across the room to the station.
  control: [A.x - 2.2, FLOOR_Y + 2.6, A.z + 8.4, C.x, FLOOR_Y + 0.9, C.z - 0.5],
  // The station from behind (north, over the back panel): the chairs' backs, the dais and the bore under Troy's.
  station: [A.x - 1, FLOOR_Y + 4, A.z - 3.4, C.x, FLOOR_Y - 0.2, C.z + 0.6],
  // Inside the injector shaft's tube, high in the stalk, looking down it toward the pen.
  shaft: [C.x + 0.9, 60, C.z + 0.6, C.x, 25, C.z],
  // The pen hall from beside the docked sub, looking up at Troy's port (lid open), Phones's dummy beside it and the pole
  // standing from the port down to the cabin roof.
  port: [SEAT.x + 11, SEAT.y + 6, SEAT.z + 11, SEAT.x - 0.6, HALL_CEILING_Y - 6.5, SEAT.z],
  // The docked sub's cabin roof close, from above and behind (north-east): Troy's hatch open with the pole coming down
  // into it, Phones's dummy beside it, the dome aft.
  hatch: [SEAT.x + 2.4, SEAT.y + 3.4, SEAT.z - 3.2, SEAT.x - 0.3, SEAT.y + 1.2, SEAT.z + 0.3],
});

/** The ?view= parameter as six numbers — a preset name or x,y,z,lookX,lookY,lookZ — or null. */
export function viewParam(value: string | null): readonly number[] | null {
  if (value === null) return null;
  const preset = VIEW_PRESETS[value];
  if (preset) return preset;
  const numbers = value.split(',').map(Number);
  return numbers.length === 6 && numbers.every(Number.isFinite) ? numbers : null;
}

/** Bounds on witnessing scripts and the handle's advance, so a typo'd or hostile URL cannot freeze the tab. */
export const SCRIPT_LIMITS = Object.freeze({ secondsPerAdvance: 120, totalSeconds: 600, tokens: 64 });

/** The seconds an advance may run: positive and finite, at most SCRIPT_LIMITS.secondsPerAdvance; anything else is 0. */
export function clampAdvance(seconds: number): number {
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, SCRIPT_LIMITS.secondsPerAdvance) : 0;
}

/**
 * A point on the tunnel's centreline `metres` in from the mouth (negative: out at sea along the tunnel's axis),
 * and the heading that faces out to sea (`out`) or in toward the pen (`in`) there.
 */
export function onCentreline(metres: number, facing: 'in' | 'out'): { pos: Vec3; yaw: number } {
  const line = MARINEVILLE.interior.tunnel.centreline;
  let left = metres;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1]!;
    const b = line[k]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const last = k === line.length - 1;
    if (left <= len || last || (k === 1 && left < 0)) {
      const t = Math.min(left, len) / len;
      const d = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
      // forwardOf(yaw) = (−sin yaw, ·, −cos yaw): yaw = atan2(−fx, −fz).
      const f = facing === 'in' ? d : { x: -d.x, z: -d.z };
      return {
        pos: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t },
        yaw: Math.atan2(-f.x, -f.z),
      };
    }
    left -= len;
  }
  return { pos: { ...line[0]! }, yaw: MARINEVILLE.tunnelHeading };
}

/**
 * A point on the pen's axis at the lowered cradle's height, `metres` south of the cradle position (toward the tunnel;
 * negative: north of it), facing the cradle.
 */
export function nearCradle(metres: number): { pos: Vec3; yaw: number } {
  const c = MARINEVILLE.interior.cradle;
  // North is −z; yaw 0 faces north, π south.
  return { pos: { x: c.pos.x, y: c.loweredY, z: c.pos.z + metres }, yaw: metres >= 0 ? 0 : Math.PI };
}

/**
 * Run a witnessing script once (the ?script= URL parameter): a comma list of words, run in order.
 *   - a control name (cradle, engines, clamps, door) presses it;
 *   - a number advances the sim that many seconds (clamped to SCRIPT_LIMITS; zero, negative or not a number: skipped);
 *   - out=M / in=M puts the released sub at rest on the tunnel's centreline M metres in from the mouth (negative:
 *     out at sea), facing out to sea or in toward the pen;
 *   - throttle=T, steer=Y, climb=P hold those axes at T / Y / P (−1 … 1; steer > 0 turns left, climb > 0 climbs)
 *     until the script changes them; fire=1 / boost=1 hold the trigger / boost (0 lets go);
 *   - dock=M puts the released sub at rest on the pen's axis at the lowered cradle's height, M metres south of the
 *     cradle (negative: north), facing it; dx= / dy= / dz= move it that many metres and turn= turns it (degrees,
 *     left), each at rest (all within ±100).
 *   - phase 3 (M10): walk=X:Z (a colon — the words split on commas) puts Troy on foot at the walkable point nearest
 *     world (X, Z), as __stingray.walkTo does; the camera snaps;
 *   - phase 3 (M10): use queues 'use' (M5), as __stingray.use does — E on foot;
 *   - phase 3 (M10): leave queues 'leave', as __stingray.leave does — the panel's 5 (refused 'Dock first' unless
 *     aboard a docked, raised sub; accepted, M6b, he rides back up to the control room);
 *   - phase 3 (T9): face=DEG turns Troy, on foot, to face that heading (the sim's yaw in degrees: 0 north), as
 *     __stingray.face does — "leave,12,face=0,use,12" stands him up, turns him back to his chair and sits him again.
 * "cradle,8.2,engines,2.1,clamps,1" lowers the cradle, starts the engines and releases the clamps;
 * "out=40,door,5" waits in the door chamber while the door opens. Phase 3 (T7), the full loop from the control room to
 * open water in one page (Troy walked to the front of his chair at the station — phase 4: (0.6, −1390.6), 1.6 m south
 * of it — sits, rides down 6 s and locks in, then phase 2's launch, steered out through the tunnel — the held axes
 * merge, main.ts setInput — ending out at sea; T4 re-steers the tunnel legs for the straight bore):
 *   ?start=control&menu=0&script=walk=0.6:-1390.6,1,use,8,cradle,8.2,engines,2.2,clamps,1,throttle=1,1.5,1.5,1.5,
 *   steer=-0.5,climb=-0.25,1.5,steer=0.5,climb=0,1.5,climb=-0.25,1.5,steer=-0.25,1.5,steer=0.25,climb=0.25,1.5,
 *   steer=-0.5,1.5,steer=0.25,1.5,door,steer=-1,climb=-0.5,1.5,steer=1,1.5,steer=-0.75,climb=0.5,1.5,steer=1,1.5,
 *   steer=-1,climb=0,1.5,steer=1,climb=-0.5,1.5,steer=-1,climb=0.25,1.5,steer=1,climb=0.5,1.5,steer=-1,1.5,
 *   steer=0,climb=0,6   (one line in the URL). Unknown words are ignored. At most
 * SCRIPT_LIMITS.tokens words run, and at most SCRIPT_LIMITS.totalSeconds in all.
 */
export function runScript(script: string, handle: DebugHandle): void {
  let total = 0;
  const words = script.split(',').map((w) => w.trim()).filter(Boolean).slice(0, SCRIPT_LIMITS.tokens);
  for (const word of words) {
    if (CONTROLS.includes(word)) {
      handle.press(word as LaunchControl);
      continue;
    }
    if (word === 'use') {
      handle.use();
      continue;
    }
    if (word === 'leave') {
      handle.leave();
      continue;
    }
    const [key, value] = word.split('=');
    if (key === 'walk' && value !== undefined) {
      const [x, z, ...rest] = value.split(':').map(Number);
      if (rest.length === 0 && x !== undefined && z !== undefined && Number.isFinite(x) && Number.isFinite(z)) handle.walkTo(x, z);
      continue;
    }
    if (value !== undefined) {
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      if (key === 'out' || key === 'in') {
        const at = onCentreline(Math.max(-1000, n), key);
        handle.teleport(at.pos, at.yaw);
      } else if (key === 'face') {
        handle.face(n);
      } else if (key === 'fire' || key === 'boost') {
        handle.setInput({ [key]: n !== 0 });
      } else if (key === 'throttle' || key === 'steer' || key === 'climb') {
        const axis = key === 'throttle' ? 'throttle' : key === 'steer' ? 'yaw' : 'pitch';
        handle.setInput({ [axis]: Math.max(-1, Math.min(1, n)) });
      } else if (key === 'dock') {
        const at = nearCradle(Math.max(-100, Math.min(100, n)));
        handle.teleport(at.pos, at.yaw);
      } else if (key === 'dx' || key === 'dy' || key === 'dz' || key === 'turn') {
        const s = handle.state();
        const d = Math.max(-100, Math.min(100, n));
        const pos = { ...s.pos };
        if (key === 'dx') pos.x += d;
        if (key === 'dy') pos.y += d;
        if (key === 'dz') pos.z += d;
        handle.teleport(pos, key === 'turn' ? s.yaw + (d * Math.PI) / 180 : s.yaw);
      }
      continue;
    }
    const seconds = Math.min(clampAdvance(Number(word)), SCRIPT_LIMITS.totalSeconds - total);
    if (seconds <= 0) continue;
    total += seconds;
    handle.advance(seconds);
  }
}
