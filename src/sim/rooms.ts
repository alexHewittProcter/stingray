// The rooms (phase 3, M1): Troy's part of Marineville — the WASP control room in the control tower's glazed gallery,
// a short corridor with a turn, and the Standby Lounge where the injector chairs stand — and the shaft the chair rides
// down to Stingray's pilot seat. Plain data over the world frame (C1: +Y up, north is −Z, metres); walking and
// collision are in troy.ts.
//
// Where (M1 "Where", Functionality notes "Scale check"): the tower stands on the clifftop at world (0, ·, −1250)
// (render/marineville.ts: TOWER.z −150 under the group at CLIFF_TOP, COAST_Z); its drum is y 72–92, radius 13, and the
// glazed gallery y 92–97 sits on top. The control room is the gallery level: floor y 92.7, an 18 m square whose corners
// (12.7 m out) lie inside the as-built drum. Every floor is flat at that height (M1: "flat is fine") — a ramp from the gallery
// one floor down into the drum would need 28 m at 1:4 for 7 m, longer than the corridor may be — so the corridor
// leaves the control room's north wall through the glazing as an enclosed bridge, turns west, and opens into the
// lounge, an annexe north of the tower (inland, behind the drum as seen from the sea). The chair's bore drops through
// the lounge floor into the annexe's column, so the shaft's first leg runs down that column, not the tower's stalk.
//
// The shaft (M1 "The shaft"): three legs — (1) straight down from the lounge to just below the clifftop, (2) a level
// run north through the 5 m of rock between the pen's ceiling (y 20) and the grounds (y 25), (3) a vertical drop
// through the pen hall's roof to SEAT. Leg 2 runs at y 22.4 so its 2.2 m tube clears both the pen's ceiling and the
// grounds. It is not part of phase 2's Interior and changes nothing about confine.

import type { Vec3 } from './vec3';
import { MARINEVILLE } from './world';

export interface Box {
  min: Vec3;
  max: Vec3;
}

/** Floor at min.y, ceiling at max.y. Overlapping boxes form doorways. */
export interface Room extends Box {
  id: 'controlRoom' | 'corridor' | 'lounge';
}

export interface Rooms {
  /** Walkable floor boxes. Two or more may share an id (the corridor turns, so it is two boxes). */
  rooms: Room[];
  /** Consoles, desks, tables — solid to Troy and the camera. */
  props: Box[];
  /**
   * Troy's injector chair in the lounge: pos = the seat's centre on the floor; yaw = the heading Troy faces walking up
   * to it (the seat faces the other way, yaw + π — so standing up out of it he faces yaw + π, M6b).
   */
  chair: { pos: Vec3; yaw: number };
  /** The chair's path from the lounge to the pilot's seat: first point = chair.pos, last = SEAT. */
  shaft: Vec3[];
  /** Where the game begins: Troy standing in the control room. */
  start: { pos: Vec3; yaw: number };
}

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const box = (min: Vec3, max: Vec3): Box => ({ min, max });

// ---- The tower and the levels ----

/** The control tower's axis on the clifftop (render/marineville.ts TOWER, in the world frame). */
export const TOWER_AXIS = Object.freeze({ x: 0, z: -1250 });
/** The as-built drum's radius (render/marineville.ts); T4 may widen it — nothing here depends on it. */
export const DRUM_RADIUS = 13;
/**
 * Every floor: the glazed gallery level. The gallery's glazing starts at y 92 on a white sill band whose top is
 * y 92.6 (render/marineville.ts); the floor sits just above it so the band never shows through it.
 */
export const FLOOR_Y = 92.7;

// ---- The seat (M1, phase 2 L3) ----

/** Model-local height of the pilot's seat point above the hull centre (render/stingray.ts: deck 1.8, roof ≈ 3.2). */
export const SEAT_RISE = 2.0;

/** The pilot's seat of a sub at the cradle's raised pose: cradle x/z, raisedY + SEAT_RISE. */
export function seatOf(cradle: { pos: Vec3; raisedY: number }): Vec3 {
  return { x: cradle.pos.x, y: cradle.raisedY + SEAT_RISE, z: cradle.pos.z };
}

export const SEAT: Vec3 = Object.freeze(seatOf(MARINEVILLE.interior.cradle));

// ---- The shaft ----

/** The injector shaft's tube radius (closed between its open ends). */
export const SHAFT_RADIUS = 2.2;
/** Leg 2's height: the 2.2 m tube clears the pen's ceiling (y 20) and the grounds (CLIFF_TOP, y 25). */
export const SHAFT_RUN_Y = 22.4;
/** How much of the shaft below the lounge floor is an open, visible bore (the rest is a closed tube to the pen hall). */
export const SHAFT_OPEN_TOP = 10;

// ---- The rooms ----

// 4.2 m high: its ceiling (y 96.9) is just under the gallery's roof (y 97.0–98.6).
const CONTROL_ROOM: Room = { id: 'controlRoom', min: v(-9, FLOOR_Y, -1259), max: v(9, FLOOR_Y + 4.2, -1241) };
// The corridor: north out of the control room's north-east corner, then west — 20.8 m along its centreline.
const CORRIDOR_NORTH: Room = { id: 'corridor', min: v(4, FLOOR_Y, -1268.4), max: v(6.4, FLOOR_Y + 3, -1258) };
const CORRIDOR_WEST: Room = { id: 'corridor', min: v(-4, FLOOR_Y, -1268.4), max: v(6.4, FLOOR_Y + 3, -1266) };
const LOUNGE: Room = { id: 'lounge', min: v(-8.5, FLOOR_Y, -1281), max: v(2, FLOOR_Y + 4, -1267) };

const CHAIR = { pos: v(0, FLOOR_Y, -1277), yaw: 0 };

// Placeholder props (greybox; T4 and T5 dress the rooms and may move these — each drawn prop keeps a collider here).
const PROPS: Box[] = [
  box(v(-4, FLOOR_Y, -1252), v(4, FLOOR_Y + 1.1, -1250.8)), // the main console bank, across the room
  box(v(-2, FLOOR_Y, -1245.6), v(2, FLOOR_Y + 0.8, -1244.4)), // Shore's desk, by the windows
  box(v(-9, FLOOR_Y, -1254), v(-8.4, FLOOR_Y + 3, -1246)), // the wall map's console, along the west wall
  box(v(7.4, FLOOR_Y, -1252), v(9, FLOOR_Y + 1.3, -1246)), // the locator, along the east wall
  box(v(-5.5, FLOOR_Y, -1273), v(-3.5, FLOOR_Y + 0.5, -1271)), // a low table in the lounge
];

export const ROOMS: Rooms = deepFreeze({
  rooms: [CONTROL_ROOM, CORRIDOR_NORTH, CORRIDOR_WEST, LOUNGE],
  props: PROPS,
  chair: CHAIR,
  shaft: [
    { ...CHAIR.pos },
    v(CHAIR.pos.x, SHAFT_RUN_Y, CHAIR.pos.z), // leg 1: down the annexe's column to below the clifftop
    v(SEAT.x, SHAFT_RUN_Y, SEAT.z), // leg 2: north under the grounds to above the cradle
    { ...SEAT }, // leg 3: down through the pen hall's roof into the cabin
  ],
  start: { pos: v(0, FLOOR_Y, -1247.5), yaw: 0 },
});

/** The shaft's length along the polyline (m). */
export function shaftLength(shaft: readonly Vec3[]): number {
  let total = 0;
  for (let k = 1; k < shaft.length; k++) total += distance(shaft[k - 1]!, shaft[k]!);
  return total;
}

/** True when p lies inside some room's box (floor to ceiling, inclusive) — for the indoors switch and the tests. */
export function inRoomBox(p: Vec3, rooms: Rooms, slack = 0): boolean {
  return rooms.rooms.some((r) =>
    p.x >= r.min.x - slack && p.x <= r.max.x + slack
    && p.y >= r.min.y - slack && p.y <= r.max.y + slack
    && p.z >= r.min.z - slack && p.z <= r.max.z + slack);
}

const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const value of Object.values(o)) deepFreeze(value);
  }
  return o;
}
