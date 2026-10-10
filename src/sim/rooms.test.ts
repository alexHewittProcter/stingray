import { describe, expect, it } from 'vitest';
import { northOfFace } from './interior';
import {
  type Box, CONTROL_ROOM_PROPS, DRUM_RADIUS, FLOOR_Y, ROOMS, type Room, SEAT, SEATS_LOCAL, SHAFT_OPEN_TOP, SHAFT_RADIUS, STATION_CHAIRS,
  STATION_PROP_NAMES, TOWER_AXIS, shaftLength,
} from './rooms';
import { walkable } from './troy';
import type { Vec3 } from './vec3';
import { CLIFF_TOP, MARINEVILLE } from './world';

const R = ROOMS;
const I = MARINEVILLE.interior;
const byId = (id: Room['id']) => R.rooms.filter((r) => r.id === id);

/** Points along the shaft every `step` metres of arc, with their arc length. */
function alongShaft(step: number): Array<{ p: Vec3; s: number; leg: number }> {
  const out: Array<{ p: Vec3; s: number; leg: number }> = [];
  let s0 = 0;
  for (let k = 1; k < R.shaft.length; k++) {
    const a = R.shaft[k - 1]!;
    const b = R.shaft[k]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    for (let d = 0; d <= len; d += step) {
      const t = d / len;
      out.push({ p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }, s: s0 + d, leg: k });
    }
    s0 += len;
  }
  return out;
}

function distanceToBox(p: Vec3, b: Box): number {
  const dx = Math.max(b.min.x - p.x, 0, p.x - b.max.x);
  const dy = Math.max(b.min.y - p.y, 0, p.y - b.max.y);
  const dz = Math.max(b.min.z - p.z, 0, p.z - b.max.z);
  return Math.hypot(dx, dy, dz);
}

function distanceToCentreline(p: Vec3): number {
  const line = I.tunnel.centreline;
  let best = Infinity;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1]!;
    const b = line[k]!;
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / (ab.x ** 2 + ab.y ** 2 + ab.z ** 2)));
    best = Math.min(best, Math.hypot(p.x - a.x - ab.x * t, p.y - a.y - ab.y * t, p.z - a.z - ab.z * t));
  }
  return best;
}

describe('the rooms (M1; phase 4, D2)', () => {
  it('is the control room alone (D2), on the gallery floor, north of the face and above the clifftop', () => {
    expect(R.rooms.length).toBeGreaterThanOrEqual(1);
    expect(byId('controlRoom').length).toBe(R.rooms.length);
    for (const r of R.rooms) {
      expect(r.min.y).toBe(FLOOR_Y);
      expect(r.min.y).toBeGreaterThan(CLIFF_TOP);
      expect(northOfFace(r.max)).toBe(true);
      expect(r.max.y - r.min.y).toBeGreaterThanOrEqual(2.5);
    }
  });

  it("puts the control room in the tower's glazed gallery: floor ≈ y 92, ceiling ≥ 4 m, corners inside the drum, 18 m across", () => {
    const [c] = byId('controlRoom');
    expect(Math.abs(c!.min.y - 92)).toBeLessThanOrEqual(1);
    expect(c!.max.y - c!.min.y).toBeGreaterThanOrEqual(4);
    for (const x of [c!.min.x, c!.max.x]) {
      for (const z of [c!.min.z, c!.max.z]) expect(Math.hypot(x - TOWER_AXIS.x, z - TOWER_AXIS.z)).toBeLessThanOrEqual(DRUM_RADIUS);
    }
    expect(c!.max.x - c!.min.x).toBeGreaterThanOrEqual(18);
    expect(c!.max.z - c!.min.z).toBeGreaterThanOrEqual(18);
  });

  it('stands every prop on the floor inside a room', () => {
    for (const p of R.props) {
      expect(p.min.y).toBe(FLOOR_Y);
      expect(R.rooms.some((r) => p.min.x >= r.min.x && p.max.x <= r.max.x && p.min.z >= r.min.z && p.max.z <= r.max.z)).toBe(true);
    }
  });

  it("D2: the station at the room's centre — a dais ≤ 0.3 m, Troy's chair on it 0.6 m east of the axis, plumb over SEAT", () => {
    const P = CONTROL_ROOM_PROPS;
    const [c] = byId('controlRoom');
    expect((c!.min.x + c!.max.x) / 2).toBeCloseTo(TOWER_AXIS.x, 9);
    expect((c!.min.z + c!.max.z) / 2).toBeCloseTo(TOWER_AXIS.z, 9);
    expect(P.station.max.y - P.station.min.y).toBeLessThanOrEqual(0.3);
    expect((P.station.min.x + P.station.max.x) / 2).toBeCloseTo(TOWER_AXIS.x, 9);
    expect(R.chair.pos.x).toBe(SEAT.x);
    expect(R.chair.pos.z).toBe(SEAT.z);
    expect(R.chair.pos.x - TOWER_AXIS.x).toBeCloseTo(0.6, 9);
    expect(R.chair.yaw).toBe(0); // he walks up facing north, so the seat faces south (the windows)
    // Troy's and Phones's side by side, 1.2 m apart (Phones west); Marina's behind (north), between them.
    expect(STATION_CHAIRS.troy).toEqual(R.chair.pos);
    expect(STATION_CHAIRS.troy.x - STATION_CHAIRS.phones.x).toBeCloseTo(1.2, 9);
    expect(STATION_CHAIRS.phones.z).toBe(STATION_CHAIRS.troy.z);
    expect(STATION_CHAIRS.marina.x).toBeCloseTo(TOWER_AXIS.x, 9);
    expect(STATION_CHAIRS.marina.z).toBeLessThan(STATION_CHAIRS.troy.z);
    // Every chair stands on the dais.
    for (const ch of Object.values(STATION_CHAIRS)) {
      expect(ch.x).toBeGreaterThan(P.station.min.x);
      expect(ch.x).toBeLessThan(P.station.max.x);
      expect(ch.z).toBeGreaterThan(P.station.min.z);
      expect(ch.z).toBeLessThan(P.station.max.z);
    }
  });

  it("D2: no furniture within 1.6 m of the chair's front; start near the south windows, facing the station", () => {
    const front = { x: R.chair.pos.x + Math.sin(R.chair.yaw) * 1.6, y: FLOOR_Y, z: R.chair.pos.z + Math.cos(R.chair.yaw) * 1.6 };
    const furniture = Object.entries(CONTROL_ROOM_PROPS).filter(([name]) => !(STATION_PROP_NAMES as readonly string[]).includes(name));
    // The segment from the chair out to its front point: every piece of furniture at least 1.6 m from all of it.
    for (const [name, b] of furniture) {
      for (let f = 0; f <= 1; f += 0.05) {
        const p = { x: R.chair.pos.x + (front.x - R.chair.pos.x) * f, y: FLOOR_Y, z: R.chair.pos.z + (front.z - R.chair.pos.z) * f };
        expect(distanceToBox({ ...p, y: b.min.y }, b), name).toBeGreaterThanOrEqual(1.6);
      }
    }
    const [c] = byId('controlRoom');
    expect(c!.max.z - R.start.pos.z).toBeLessThanOrEqual(4); // by the south windows (the follow camera's boom behind him)
    expect(R.start.pos.z - R.chair.pos.z).toBeGreaterThan(4); // across the room from the station
    // Facing it: the heading from start to the chair is within 30° of start's yaw (yaw of (dx, dz) = atan2(−dx, −dz)).
    const toChair = Math.atan2(-(R.chair.pos.x - R.start.pos.x), -(R.chair.pos.z - R.start.pos.z));
    expect(Math.abs(Math.atan2(Math.sin(toChair - R.start.yaw), Math.cos(toChair - R.start.yaw)))).toBeLessThan(Math.PI / 6);
  });

  it('has start walkable, a point 1.6 m south of the chair walkable, and a walkable path from one to the other', () => {
    expect(walkable(R.start.pos, R)).toBe(true);
    // The chair stands on the solid dais over the bore, so its pos is not walkable; Troy reaches it from the front —
    // the south, the side he faces it from (yaw 0), inside M5's reach.
    const front = { x: R.chair.pos.x + Math.sin(R.chair.yaw) * 1.6, y: FLOOR_Y, z: R.chair.pos.z + Math.cos(R.chair.yaw) * 1.6 };
    expect(front.z).toBeCloseTo(R.chair.pos.z + 1.6, 9); // south
    expect(walkable(R.chair.pos, R)).toBe(false);
    expect(walkable(front, R)).toBe(true);
    // Flood fill on a 0.2 m grid from the start.
    const step = 0.2;
    const key = (i: number, j: number) => `${i},${j}`;
    const point = (i: number, j: number): Vec3 => ({ x: R.start.pos.x + i * step, y: FLOOR_Y, z: R.start.pos.z + j * step });
    const seen = new Set([key(0, 0)]);
    const queue: Array<[number, number]> = [[0, 0]];
    let reached = false;
    while (queue.length > 0 && !reached) {
      const [i, j] = queue.shift()!;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const n: [number, number] = [i + di, j + dj];
        if (seen.has(key(...n)) || !walkable(point(...n), R)) continue;
        seen.add(key(...n));
        queue.push(n);
        const p = point(...n);
        if (Math.hypot(p.x - front.x, p.z - front.z) < step) reached = true;
      }
    }
    expect(reached).toBe(true);
  });
});

describe('the shaft (M1; phase 4, D1)', () => {
  it("runs from the chair to SEAT, Troy's seat in the raised sub (port side, the cabin roof's forward third)", () => {
    expect(R.shaft[0]).toEqual(R.chair.pos);
    expect(R.shaft[R.shaft.length - 1]).toEqual(SEAT);
    // D3: the model-local seat turned by the sub's yaw (π): world x +0.6, z ≈ cradle z + 3, raisedY + 2.
    expect(SEATS_LOCAL.troy.x).toBe(-0.6);
    expect(SEATS_LOCAL.phones.x).toBe(0.6);
    expect(SEATS_LOCAL.troy.z).toBe(SEATS_LOCAL.phones.z);
    expect(SEATS_LOCAL.troy.z).toBeGreaterThanOrEqual(-3.5);
    expect(SEATS_LOCAL.troy.z).toBeLessThanOrEqual(-2.5);
    expect(SEAT.x).toBeCloseTo(I.cradle.pos.x + 0.6, 9);
    expect(SEAT.z - I.cradle.pos.z).toBeCloseTo(-SEATS_LOCAL.troy.z, 9);
    expect(SEAT.y).toBe(I.cradle.raisedY + 2);
  });

  it("D1: TOWER_AXIS is the cradle's x and SEAT's z", () => {
    expect(TOWER_AXIS.x).toBe(I.cradle.pos.x);
    expect(TOWER_AXIS.z).toBe(SEAT.z);
  });

  it('is one vertical leg, 80–90 m long: top = the chair, bottom = SEAT', () => {
    expect(R.shaft.length).toBe(2);
    const [a, b] = R.shaft as [Vec3, Vec3];
    expect([a.x, a.z]).toEqual([b.x, b.z]);
    expect(a).toEqual(R.chair.pos);
    expect(b).toEqual(SEAT);
    const length = shaftLength(R.shaft);
    expect(length).toBeCloseTo(FLOOR_Y - SEAT.y, 9);
    expect(length).toBeGreaterThanOrEqual(80);
    expect(length).toBeLessThanOrEqual(90);
  });

  it("stays inside the tower's stalk: the tube's wall within the stalk's 4.2 m top radius of the axis", () => {
    const [a] = R.shaft as [Vec3, Vec3];
    expect(Math.hypot(a.x - TOWER_AXIS.x, a.z - TOWER_AXIS.z) + SHAFT_RADIUS).toBeLessThanOrEqual(4.2);
  });

  it("keeps its tube out of phase 2's Interior (the pen and the bore) except below the hall's ceiling", () => {
    for (const { p } of alongShaft(0.5)) {
      if (p.y < I.pen.max.y) {
        // Below the ceiling it is in the open hall, inside the pen's box.
        expect(p.y).toBeGreaterThan(I.pen.min.y);
        continue;
      }
      // Above the ceiling the tube clears the pen box (but for its foot, where it meets the ceiling) and the bore.
      if (p.y >= I.pen.max.y + SHAFT_RADIUS) expect(distanceToBox(p, I.pen)).toBeGreaterThanOrEqual(SHAFT_RADIUS);
      expect(distanceToCentreline(p)).toBeGreaterThanOrEqual(I.tunnel.radius + SHAFT_RADIUS);
    }
    const [a, b] = R.shaft as [Vec3, Vec3];
    expect(a.y).toBeGreaterThan(CLIFF_TOP); // from the room …
    expect(b.y).toBeLessThan(I.pen.max.y); // … through the pen's roof into the hall
    expect(SHAFT_OPEN_TOP).toBeLessThan(a.y - CLIFF_TOP);
  });
});
