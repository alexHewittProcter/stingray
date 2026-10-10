// Interactables (phase 3, M5): the things Troy can use on foot — the injector chair at the control room's station
// (phase 4, D2), and a few props in the control room that answer with a line of flavour. Plain data, never callbacks: the sim holds no function, and
// session.ts applies a Use when the 'use' press is consumed. Pure like the rest of src/sim.
//
// Positions: each say prop's pos is on the usable face of its dressed collider (sim/rooms.ts CONTROL_ROOM_PROPS, T4),
// where Troy stands in front of it — expressed from the colliders and the tower's axis (phase 4, D1), never as a
// literal world z.

import { CONTROL_ROOM_PROPS, FLOOR_Y, ROOMS, TOWER_AXIS } from './rooms';
import type { HudLines } from './launch';
import { type TroyState, wrapAngle } from './troy';
import type { Vec3 } from './vec3';

export type Use = { kind: 'ride' } | { kind: 'say'; line: string };

export interface Interactable {
  id: string;
  /** The point Troy walks up to, on the floor; range is measured from his feet on the floor plane (x, z). */
  pos: Vec3;
  /** Metres from Troy's feet within which it can be used (USE_RADIUS by default). */
  radius: number;
  /** M5: when set, Troy's own facing must also be within USE_CONE of this heading (approach from the right side). */
  facing?: number;
  prompt: string;
  use: Use;
}

/** M5: the default reach (m). */
export const USE_RADIUS = 2.2;
/** M5: the half-angle (rad) of the cone about Troy's facing that the thing must lie in. */
export const USE_CONE = Math.PI / 3;
/** M5: how long a say line stays in the HUD, in combat.t seconds. */
export const LINE_SECONDS = 4;

const at = (x: number, z: number): Vec3 => ({ x, y: FLOOR_Y, z });
const P = CONTROL_ROOM_PROPS;
const midX = (b: { min: Vec3; max: Vec3 }) => (b.min.x + b.max.x) / 2;
const midZ = (b: { min: Vec3; max: Vec3 }) => (b.min.z + b.max.z) / 2;

export const INTERACTABLES: readonly Interactable[] = deepFreeze<Interactable[]>([
  {
    // M5: exactly one ride — the injector chair (M6's sit; T7).
    id: 'chair',
    pos: { ...ROOMS.chair.pos },
    radius: USE_RADIUS,
    facing: ROOMS.chair.yaw,
    prompt: 'Sit — injector chair',
    use: { kind: 'ride' },
  },
  {
    // The wall map on the control room's north wall (CONTROL_ROOM_PROPS.map), on its face, under the map's middle
    // (3 m west of the axis — render/rooms.ts draws it there).
    id: 'wallMap',
    pos: at(TOWER_AXIS.x - 3, P.map.max.z),
    radius: USE_RADIUS,
    prompt: 'Look — the wall map',
    use: { kind: 'say', line: 'The whole Pacific on one wall — and somewhere out there, Titan is watching it too.' },
  },
  {
    // The World Videophone on the west wall (CONTROL_ROOM_PROPS.videophone, its face at x −8.3), at its panel (drawn
    // 0.3 m north of the collider's middle).
    id: 'videophone',
    pos: at(P.videophone.max.x, midZ(P.videophone) - 0.3),
    radius: USE_RADIUS,
    prompt: 'Call — World Videophone',
    use: { kind: 'say', line: 'Marineville Control to WASP Headquarters: Stingray in Pen 3, standing by.' },
  },
  {
    // The locator compass on the east wall and its lamp unit (CONTROL_ROOM_PROPS.locator, its face at x 7.3).
    id: 'locator',
    pos: at(P.locator.min.x, midZ(P.locator)),
    radius: USE_RADIUS,
    prompt: 'Check — the locator',
    use: { kind: 'say', line: 'Hydrophones are quiet — nothing on the locator but the ocean, and the ocean never stays quiet for long.' },
  },
  {
    // Commander Shore's desk on the room's west side (CONTROL_ROOM_PROPS.shoreDesk), its north face, toward the room.
    id: 'shoresDesk',
    pos: at(midX(P.shoreDesk), P.shoreDesk.min.z),
    radius: USE_RADIUS,
    prompt: "Read — Commander Shore's orders",
    use: { kind: 'say', line: 'Orders from Commander Shore: Stingray stands by in Pen 3 — and anything can happen in the next half hour.' },
  },
]);

/**
 * M5: the interactable Troy can use now — the nearest whose pos is within its radius of his feet (on the floor plane)
 * AND within USE_CONE of his facing (and, if it has one, whose `facing` he is within USE_CONE of) — or null. Only on
 * foot: riding and aboard nothing is usable.
 */
export function nearestUsable(troy: TroyState, list: readonly Interactable[] = INTERACTABLES): Interactable | null {
  if (troy.where !== 'onFoot') return null;
  let best: Interactable | null = null;
  let bestD = Infinity;
  for (const it of list) {
    const dx = it.pos.x - troy.pos.x;
    const dz = it.pos.z - troy.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > it.radius || d >= bestD) continue;
    // Standing on the very point, any facing will do; otherwise the heading to it (yaw of (dx, dz) = atan2(−dx, −dz),
    // as sim/troy.ts) must be inside the cone about his facing.
    if (d > 1e-6 && Math.abs(wrapAngle(Math.atan2(-dx, -dz) - troy.yaw)) > USE_CONE) continue;
    if (it.facing !== undefined && Math.abs(wrapAngle(troy.yaw - it.facing)) > USE_CONE) continue;
    best = it;
    bestD = d;
  }
  return best;
}

/** M5: the flavour line the HUD shows at combat time t, or null (the HUD compares; the sim does not time it). */
export function lineAt(hud: HudLines, t: number): string | null {
  return hud.line !== null && t < hud.line.until ? hud.line.text : null;
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const value of Object.values(o)) deepFreeze(value);
  }
  return o;
}
