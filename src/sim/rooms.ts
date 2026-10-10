// The rooms (phase 3, M1; phase 4, D1–D2): Troy's part of Marineville — the WASP control room in the control tower's
// glazed gallery, with the injector station at its centre — and the shaft the chair drops straight down to Stingray's
// pilot seat. Plain data over the world frame (C1: +Y up, north is −Z, metres); walking and collision are in troy.ts.
//
// Where (phase 4, D1): the tower stands plumb over Troy's seat in the raised sub — TOWER_AXIS = (the cradle's x, SEAT.z),
// world z ≈ −1392 (render/marineville.ts: TOWER.z = TOWER_AXIS.z − COAST_Z); its drum is y 72–92, radius 13, and the
// glazed gallery y 92–97 sits on top. The control room is the gallery level: floor y 92.7, an 18 m square about the
// axis whose corners (12.7 m out) lie inside the drum. **Every room coordinate below is relative to TOWER_AXIS** (and
// FLOOR_Y), so the tower can never be moved without the rooms.
//
// The station (D2): a low dais at the room's centre, three chairs on it facing the sea windows (south) — Troy's and
// Phones's side by side 1.2 m apart, Troy's the east one (his port side, facing south), Marina's behind between them —
// and a back panel behind the row. Troy's chair is plumb over his seat: the shaft (D1) is one vertical leg from it,
// down through the drum, the stalk and 5 m of rock, out through Pen 3's ceiling and into the cabin. It is not part of
// phase 2's Interior (except the ≈ 11 m of open hall at its foot) and changes nothing about confine.

import type { Vec3 } from './vec3';
import { MARINEVILLE } from './world';

export interface Box {
  min: Vec3;
  max: Vec3;
}

/** Floor at min.y, ceiling at max.y. Phase 4 (D2): the control room is the only room (several boxes may share its id). */
export interface Room extends Box {
  id: 'controlRoom';
}

export interface Rooms {
  /** Walkable floor boxes. */
  rooms: Room[];
  /** Consoles, desks, the injector station — solid to Troy and the camera. */
  props: Box[];
  /**
   * Troy's injector chair at the station: pos = the seat's centre on the floor; yaw = the heading Troy faces walking up
   * to it (the seat faces the other way, yaw + π — so standing up out of it he faces yaw + π, M6b).
   */
  chair: { pos: Vec3; yaw: number };
  /** The chair's path from the control room to the pilot's seat: first point = chair.pos, last = SEAT. */
  shaft: Vec3[];
  /** Where the game begins: Troy standing in the control room. */
  start: { pos: Vec3; yaw: number };
}

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const box = (min: Vec3, max: Vec3): Box => ({ min, max });

// ---- The seat (phase 4, D3; phase 2 L3) ----

/**
 * Phase 4 (D3): the two seats in the sub's cabin, model-local (+x starboard, forward −Z, y up from the hull centre) —
 * Troy's on the port side, Phones's to starboard, 1.2 m apart, under the cabin roof's forward third. z_f = −2.8: the
 * cabin loft (render/stingray.ts) runs CABIN_START_Z −5.2 … CABIN_END_Z 8.5 and reaches its full width at z −3 and
 * ≈ 99 % of its height by −2.8 (its top taper is full at −2.5), so −2.8 is the forward-most point where the roof is
 * essentially flat and full — the middle of the roof's forward third (−5.2 … −0.6) and ≈ 40 % of the 26 m hull back
 * from the nose (−13 + 10.4 = −2.6), where the series' pole lands. Troy's hatch (T3) is centred 0.2 m forward of it.
 */
export const SEATS_LOCAL = Object.freeze({
  troy: Object.freeze(v(-0.6, 2.0, -2.8)),
  phones: Object.freeze(v(0.6, 2.0, -2.8)),
});

/** A model-local offset turned by a yaw about +Y (three.js's rotation.y), as the sub's model is. */
function turn(p: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
}

/**
 * Troy's seat in a sub at the cradle's raised pose: the cradle's x/z plus his model-local seat turned by the sub's yaw
 * there (yawOut, π — the sub faces the tunnel), at raisedY + the seat's height. With yaw π his seat is world x +0.6
 * (port, for a south-facing sub, is east) and z = cradle z + 2.8.
 */
export function seatOf(cradle: { pos: Vec3; raisedY: number; yawOut: number }): Vec3 {
  const d = turn(SEATS_LOCAL.troy, cradle.yawOut);
  return { x: cradle.pos.x + d.x, y: cradle.raisedY + SEATS_LOCAL.troy.y, z: cradle.pos.z + d.z };
}

export const SEAT: Vec3 = Object.freeze(seatOf(MARINEVILLE.interior.cradle));

// ---- The tower and the levels ----

/**
 * Phase 4 (D1): the control tower's axis (render/marineville.ts TOWER, in the world frame) — the cradle's x and Troy's
 * seat's z, so his chair, 0.6 m east of the axis, is plumb over the seat and the shaft stays inside the 4.2 m stalk.
 */
export const TOWER_AXIS = Object.freeze({ x: MARINEVILLE.interior.cradle.pos.x, z: SEAT.z });
/** The as-built drum's radius (render/marineville.ts). */
export const DRUM_RADIUS = 13;
/**
 * The floor: the glazed gallery level. The gallery's glazing starts at y 92 on a white sill band whose top is y 92.6
 * (render/marineville.ts); the floor sits just above it so the band never shows through it.
 */
export const FLOOR_Y = 92.7;

const AX = TOWER_AXIS.x;
const AZ = TOWER_AXIS.z;
const F = FLOOR_Y;
/** A point on the floor at (dx, dz) from the tower's axis, h above it. */
const at = (dx: number, dz: number, h = 0): Vec3 => v(AX + dx, F + h, AZ + dz);
/** A prop box from (dx0, dz0) to (dx1, dz1) about the axis, h high, standing on the floor. */
const prop = (dx0: number, dz0: number, dx1: number, dz1: number, h: number): Box => box(at(dx0, dz0), at(dx1, dz1, h));

// ---- The shaft ----

/** The injector shaft's tube radius (closed between its open ends; the ride camera's boom needs the room, D4). */
export const SHAFT_RADIUS = 2.2;
/** How much of the shaft below the control room floor is an open, visible bore (the rest is a closed tube). */
export const SHAFT_OPEN_TOP = 10;

// ---- The room ----

// 18 m square about the axis, 4.2 m high: its ceiling (y 96.9) is just under the gallery's roof (y 97.0–98.6).
const CONTROL_ROOM: Room = { id: 'controlRoom', min: at(-9, -9), max: at(9, 9, 4.2) };

/** Troy's chair (D2): 0.6 m east of the axis, plumb over SEAT; he walks up to it from the south (yaw 0, facing north). */
const CHAIR = { pos: v(SEAT.x, F, SEAT.z), yaw: 0 };

/**
 * The three chairs' floor points (D2), for the art (render/rooms.ts): Troy's (= ROOMS.chair.pos), Phones's 1.2 m west
 * of it (plumb over Phones's seat, SEATS_LOCAL.phones), Marina's behind them (north), between.
 */
export const STATION_CHAIRS = Object.freeze({
  troy: Object.freeze({ ...CHAIR.pos }),
  phones: Object.freeze(v(CHAIR.pos.x - 1.2, F, CHAIR.pos.z)),
  marina: Object.freeze(v(CHAIR.pos.x - 0.6, F, CHAIR.pos.z - 1.2)),
});
/** Every chair fits inside this radius about its pole (D2). */
export const CHAIR_RADIUS = 0.6;
/**
 * The station dais's height (D2: ≤ 0.3 m). Phase 4 T2: 0.1 (T1's greybox had 0.25) — the chairs hang on their poles
 * over it, and a seated Troy's soles are 0.13 m above the chair's floor point (render/injector-chair.ts
 * CHAIR_FOOTPLATE_Y), so the footplate's underside (CHAIR_LOWEST_Y 0.115) must clear the dais and the bore's lid on it.
 */
export const DAIS_HEIGHT = 0.1;
/**
 * The dais's front (south) edge: 1.2 m in front of the chair's pos — the open bore under the chair (render/rooms.ts
 * BORE_RADIUS 1.2, D1) reaches exactly to it, so the bore never cuts the walkable floor — and Troy stands 1.6 m from
 * the chair to sit (inside M5's 2.2 m reach): the point 1.6 m south of it is the first walkable one (D5).
 */
export const DAIS_FRONT_Z = CHAIR.pos.z + 1.2;
/** The dais's half-width about the axis: wide enough for the bore under Troy's chair (0.6 m east of the axis + 1.2). */
const DAIS_HALF_WIDTH = 2;

/**
 * A chair's collider: its CHAIR_RADIUS footprint, from the floor to the ceiling — phase 4 T2: each chair's pole runs on
 * up into a sleeve hanging from a ceiling boss (render/rooms.ts), so the column is solid all the way up (T1: 1.7 m).
 */
const chairBox = (c: Vec3): Box => box(v(c.x - CHAIR_RADIUS, F, c.z - CHAIR_RADIUS), v(c.x + CHAIR_RADIUS, CONTROL_ROOM.max.y, c.z + CHAIR_RADIUS));

// The control room's furniture (phase 3 T4 — M1 art, after 02_MARINEVILLE_CONTROL_ROOM/; phase 4 D2 re-laid out round
// the station): each drawn piece Troy can reach is drawn inside one of these boxes (render/rooms.test.ts). Named so the
// interactables (M5) can hang on them. The room is ±9 m about the axis: north (−z, inland) is the solid wall with the
// map; south (+z) is the window band over Marineville and the sea; the west wall carries the Videophone, the east the
// locator. The station has the centre; the main bank and its operators' chairs stand at the back (north) behind it,
// Shore's desk on the west side; nothing but the station is within 1.6 m of the chair's front.
export const CONTROL_ROOM_PROPS = Object.freeze({
  /** The big wall map on the north wall, its console beneath, the banner above, the Action Area screen, the extinguisher. */
  map: prop(-7.6, -9, 2.6, -8.2, 4.2),
  /** The World Videophone on the west wall's perforated panel, over a ledge. */
  videophone: prop(-9, -4, -8.3, 1, 3.4),
  /** The locator compass on the east wall's green panel, and its lamp unit on a pedestal in front. */
  locator: prop(7.3, -7.4, 9, -4.4, 4),
  /** The main console bank at the back of the room, behind the station, its sloping panels facing south (the station). */
  consoles: prop(-4.5, -6.8, 4, -5.2, 1.25),
  /** Two operators' swivel chairs at the main bank, on its south side. */
  chairWest: prop(-2.9, -4.5, -2.1, -3.7, 1.05),
  chairEast: prop(1.1, -4.5, 1.9, -3.7, 1.05),
  /** Commander Shore's desk on the west side, facing into the room (north), his hover chair behind it. */
  shoreDesk: prop(-7, 2.6, -2.2, 5.2, 1.3),
  /** Low console banks under the windows: south-west, south-east, west, east. */
  bankSouthWest: prop(-8.7, 8.2, -3.2, 9, 0.95),
  bankSouthEast: prop(3.2, 8.2, 8.7, 9, 0.95),
  bankWest: prop(-9, 3.4, -8.2, 8.2, 0.95),
  bankEast: prop(8.2, -0.2, 9, 8.2, 0.95),
  /**
   * D2: the injector station's dais — a low step (Troy's walk does not climb it; it is solid to him, as phase 3's bay
   * plinth was), its front 1.2 m south of Troy's chair, its back under the back panel. The bore (render/rooms.ts) is in
   * it under Troy's chair.
   */
  station: box(v(AX - DAIS_HALF_WIDTH, F, AZ - 2.2), v(AX + DAIS_HALF_WIDTH, F + DAIS_HEIGHT, DAIS_FRONT_Z)),
  /** D2: the chairs' own colliders (each chair inside CHAIR_RADIUS of its axis, floor to ceiling) — Troy's (the one that drops), Phones's, Marina's. */
  troysChair: chairBox(STATION_CHAIRS.troy),
  phonesChair: chairBox(STATION_CHAIRS.phones),
  marinasChair: chairBox(STATION_CHAIRS.marina),
  /** D2: the maroon back panel and its mesh grille behind the row (T2 dresses it). */
  stationPanel: box(v(AX - DAIS_HALF_WIDTH, F, AZ - 2.4), v(AX + DAIS_HALF_WIDTH, F + 2.6, AZ - 2.2)),
});

/** The station's own props (D2) — the rest of CONTROL_ROOM_PROPS is the room's furniture. */
export const STATION_PROP_NAMES = Object.freeze(['station', 'troysChair', 'phonesChair', 'marinasChair', 'stationPanel'] as const);

export const ROOMS: Rooms = deepFreeze({
  rooms: [CONTROL_ROOM],
  props: Object.values(CONTROL_ROOM_PROPS),
  chair: CHAIR,
  // D1: one vertical leg, from the chair straight down to the seat.
  shaft: [{ ...CHAIR.pos }, { ...SEAT }],
  // Near the south windows, facing north across the room to the station (D2) — as near as leaves the follow camera's
  // whole boom (3.6 m at 18°, held 0.3 m inside) between him and the glass.
  start: { pos: at(CHAIR.pos.x - AX, 5.2), yaw: 0 },
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
