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
// The corridor: north out of the control room's north-east corner, then west — ≈ 15 m along its centreline. T5 (M1 art):
// its west leg runs into the lounge's east wall — a single 2.4 m doorway, framed in red as the control room's is — and
// no longer along the lounge's south side (T1's greybox had a 6 m L-shaped slot there that no doorway could frame).
const CORRIDOR_NORTH: Room = { id: 'corridor', min: v(4, FLOOR_Y, -1270.6), max: v(6.4, FLOOR_Y + 3, -1258) };
const CORRIDOR_WEST: Room = { id: 'corridor', min: v(0, FLOOR_Y, -1270.6), max: v(6.4, FLOOR_Y + 3, -1268.2) };
const LOUNGE: Room = { id: 'lounge', min: v(-8.5, FLOOR_Y, -1281), max: v(2, FLOOR_Y + 4, -1267) };

const CHAIR = { pos: v(0, FLOOR_Y, -1277), yaw: 0 };

// The control room's furniture (T4 — M1 art, after 02_MARINEVILLE_CONTROL_ROOM/): each drawn piece Troy can reach is
// drawn inside one of these boxes (render/rooms.test.ts). Named so the interactables (M5) can hang on them. The room is
// x −9…9, z −1259…−1241: north (−z, inland) is the solid wall with the map and the corridor's doorway at x 4…6.4; south
// (+z) is the window band over Marineville and the sea; the west wall carries the Videophone, the east the locator.
const F = FLOOR_Y;
export const CONTROL_ROOM_PROPS = Object.freeze({
  /** The big wall map on the north wall, its console beneath, the banner above, the Action Area screen, the extinguisher. */
  map: box(v(-7.6, F, -1259), v(2.6, F + 4.2, -1258.2)),
  /** The World Videophone on the west wall's perforated panel, over a ledge. */
  videophone: box(v(-9, F, -1254), v(-8.3, F + 3.4, -1249)),
  /** The locator compass on the east wall's green panel, and its lamp unit on a pedestal in front. */
  locator: box(v(7.3, F, -1257.4), v(9, F + 4, -1254.4)),
  /** The main console bank across the room, its sloping panels facing south (toward the start). */
  consoles: box(v(-4.5, F, -1252.2), v(4, F + 1.25, -1250.6)),
  /** Two operators' swivel chairs at the main bank. */
  chairWest: box(v(-2.9, F, -1249.9), v(-2.1, F + 1.05, -1249.1)),
  chairEast: box(v(1.1, F, -1249.9), v(1.9, F + 1.05, -1249.1)),
  /** Commander Shore's desk by the south windows, facing into the room, his hover chair behind it. */
  shoreDesk: box(v(-2.4, F, -1245.8), v(2.4, F + 1.3, -1243.2)),
  /** Low console banks under the windows: south-west, south-east, west, east. */
  bankSouthWest: box(v(-8.7, F, -1241.8), v(-3.2, F + 0.95, -1241)),
  bankSouthEast: box(v(3.2, F, -1241.8), v(8.7, F + 0.95, -1241)),
  bankWest: box(v(-9, F, -1246.6), v(-8.2, F + 0.95, -1241.8)),
  bankEast: box(v(8.2, F, -1250.2), v(9, F + 0.95, -1241.8)),
});

// The Standby Lounge's furniture (T5 — M1 art, after 03_STANDBY_INJECTOR/). The lounge is x −8.5…2, z −1281…−1267; the
// corridor comes in through the east wall at z −1270.6…−1268.2. The north part is the injector bay: a low plinth from
// the east wall to x −7, with three chairs in a row on it facing south (toward the lounge and the door) — Troy's
// (ROOMS.chair) over the open bore, Phones's and Marina's west of it over closed hatches — and a walkway behind them
// under the INJECTOR BAY panel, reached round the plinth's west end. The plinth is one solid box: Troy cannot walk
// into the bore, and no gap narrower than he is opens between props or between a prop and a wall (sim/troy.ts's
// push-out jitters in those). The south half is the lounge proper: red quilted loungers along the south wall, a low
// red table, a plant, a side console on the west wall.
/** The injector bay plinth's front edge: 1.1 m in front of the chair's pos (+z, the side Troy walks up from). */
export const BAY_FRONT_Z = CHAIR.pos.z + 1.1;
export const LOUNGE_PROPS = Object.freeze({
  /**
   * M8: the injector bay plinth — the bore in it under Troy's chair, and the three chairs on it. Its front (+z) edge is
   * the nearest to the chair's pos (1.1 m; back 1.3 m, east 2 m), so Troy stands 1.5 m from the chair to sit (inside
   * M5's 2.2 m reach) and a foot circle at the chair's pos — standing up out of it, M6b — is pushed out to the front.
   */
  injectorBay: box(v(-7, F, CHAIR.pos.z - 1.3), v(2, F + 2.1, BAY_FRONT_Z)),
  /** The plant in its tub in the south-west corner, and two quilted loungers along the south wall, facing north. */
  plant: box(v(-8.5, F, -1268.4), v(-7.6, F + 2.2, -1267)),
  loungerWest: box(v(-7.6, F, -1268.2), v(-5.6, F + 1.1, -1267)),
  loungerEast: box(v(-4.6, F, -1268.2), v(-2.6, F + 1.1, -1267)),
  /** The round red table in front of them. */
  table: box(v(-5.6, F, -1271.4), v(-4.2, F + 0.62, -1270)),
  /** The side console on the west wall: the lounge's intercom and the standby board, waist high. */
  sideConsole: box(v(-8.5, F, -1274.6), v(-7.8, F + 1.15, -1271.6)),
});

const PROPS: Box[] = [...Object.values(CONTROL_ROOM_PROPS), ...Object.values(LOUNGE_PROPS)];

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
