import { describe, expect, it } from 'vitest';
import { northOfFace } from './interior';
import { type Box, DRUM_RADIUS, FLOOR_Y, ROOMS, type Room, SEAT, SHAFT_OPEN_TOP, SHAFT_RADIUS, TOWER_AXIS, shaftLength } from './rooms';
import { walkable } from './troy';
import type { Vec3 } from './vec3';
import { CLIFF_TOP, MARINEVILLE } from './world';

const R = ROOMS;
const I = MARINEVILLE.interior;
const byId = (id: Room['id']) => R.rooms.filter((r) => r.id === id);

/** The overlap of two boxes' footprints (x, z), or null if they do not overlap. */
function overlap(a: Box, b: Box): Box | null {
  const min = { x: Math.max(a.min.x, b.min.x), y: Math.max(a.min.y, b.min.y), z: Math.max(a.min.z, b.min.z) };
  const max = { x: Math.min(a.max.x, b.max.x), y: Math.min(a.max.y, b.max.y), z: Math.min(a.max.z, b.max.z) };
  return min.x < max.x && min.z < max.z && min.y < max.y ? { min, max } : null;
}

const doorways = (): Array<[Room, Room, Box]> => {
  const out: Array<[Room, Room, Box]> = [];
  for (let i = 0; i < R.rooms.length; i++) {
    for (let j = i + 1; j < R.rooms.length; j++) {
      const o = overlap(R.rooms[i]!, R.rooms[j]!);
      if (o) out.push([R.rooms[i]!, R.rooms[j]!, o]);
    }
  }
  return out;
};

const inUnion = (x: number, z: number) => R.rooms.some((r) => x >= r.min.x && x <= r.max.x && z >= r.min.z && z <= r.max.z);

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

describe('the rooms (M1)', () => {
  it('has a control room, a corridor and a lounge, all on the gallery floor, north of the face and above the clifftop', () => {
    expect(byId('controlRoom').length).toBe(1);
    expect(byId('corridor').length).toBeGreaterThanOrEqual(2); // it turns
    expect(byId('lounge').length).toBe(1);
    for (const r of R.rooms) {
      expect(r.min.y).toBe(FLOOR_Y);
      expect(r.min.y).toBeGreaterThan(CLIFF_TOP);
      expect(northOfFace(r.max)).toBe(true);
      expect(r.max.y - r.min.y).toBeGreaterThanOrEqual(2.5);
    }
  });

  it("puts the control room in the tower's glazed gallery: floor ≈ y 92, ceiling ≥ 4 m, corners inside the drum, 18 m across", () => {
    const [c] = byId('controlRoom');
    expect(c!.min.y).toBeCloseTo(92, 6);
    expect(c!.max.y - c!.min.y).toBeGreaterThanOrEqual(4);
    for (const x of [c!.min.x, c!.max.x]) {
      for (const z of [c!.min.z, c!.max.z]) expect(Math.hypot(x - TOWER_AXIS.x, z - TOWER_AXIS.z)).toBeLessThanOrEqual(DRUM_RADIUS);
    }
    expect(c!.max.x - c!.min.x).toBeGreaterThanOrEqual(18);
    expect(c!.max.z - c!.min.z).toBeGreaterThanOrEqual(18);
  });

  it('has a corridor 10–25 m long with a turn, and a lounge 10–16 m across', () => {
    const corridor = byId('corridor');
    const long = corridor.map((b) => Math.max(b.max.x - b.min.x, b.max.z - b.min.z));
    const total = long.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(10);
    expect(total).toBeLessThanOrEqual(25);
    const axes = new Set(corridor.map((b) => (b.max.x - b.min.x > b.max.z - b.min.z ? 'x' : 'z')));
    expect(axes.size).toBe(2);
    const [l] = byId('lounge');
    for (const d of [l!.max.x - l!.min.x, l!.max.z - l!.min.z]) {
      expect(d).toBeGreaterThanOrEqual(10);
      expect(d).toBeLessThanOrEqual(16);
    }
  });

  it('joins control room ↔ corridor ↔ lounge, and not the control room to the lounge directly', () => {
    const touches = (a: Room['id'], b: Room['id']) =>
      doorways().some(([x, y]) => (x.id === a && y.id === b) || (x.id === b && y.id === a));
    expect(touches('controlRoom', 'corridor')).toBe(true);
    expect(touches('corridor', 'lounge')).toBe(true);
    expect(touches('controlRoom', 'lounge')).toBe(false);
  });

  it('makes every doorway at least 1.6 m wide and 1 m deep, and keeps every prop out of every doorway', () => {
    const all = doorways();
    expect(all.length).toBeGreaterThanOrEqual(3);
    for (const [a, b, o] of all) {
      const dims = [o.max.x - o.min.x, o.max.z - o.min.z].sort((p, q) => p - q);
      expect(dims[0], `${a.id}↔${b.id}`).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(dims[1], `${a.id}↔${b.id}`).toBeGreaterThanOrEqual(1.6);
      for (const prop of R.props) expect(overlap(prop, o), `${a.id}↔${b.id}`).toBeNull();
    }
  });

  it('stands every prop on the floor inside a room', () => {
    for (const p of R.props) {
      expect(p.min.y).toBe(FLOOR_Y);
      expect(R.rooms.some((r) => p.min.x >= r.min.x && p.max.x <= r.max.x && p.min.z >= r.min.z && p.max.z <= r.max.z)).toBe(true);
    }
  });

  it('has start and the chair walkable, and a walkable path from one to the other', () => {
    expect(walkable(R.start.pos, R)).toBe(true);
    expect(walkable(R.chair.pos, R)).toBe(true);
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
        if (Math.hypot(p.x - R.chair.pos.x, p.z - R.chair.pos.z) < step) reached = true;
      }
    }
    expect(reached).toBe(true);
  });

  it('keeps the lounge out of sight of the control room: no straight line between them stays inside the rooms', () => {
    const [c] = byId('controlRoom');
    const [l] = byId('lounge');
    const grid = (b: Box) => {
      const out: Array<[number, number]> = [];
      for (let x = b.min.x + 0.5; x < b.max.x; x += 1) for (let z = b.min.z + 0.5; z < b.max.z; z += 1) out.push([x, z]);
      return out;
    };
    const lounge = grid(l!);
    for (const [ax, az] of grid(c!)) {
      for (const [bx, bz] of lounge) {
        const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25);
        let clear = true;
        for (let k = 1; k < n && clear; k++) clear = inUnion(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
        expect(clear, `(${ax},${az}) → (${bx},${bz})`).toBe(false);
      }
    }
  });
});

describe('the shaft (M1)', () => {
  it("runs from the chair to SEAT, the pilot's seat of the raised sub (cradle x/z, raisedY + 2)", () => {
    expect(R.shaft[0]).toEqual(R.chair.pos);
    expect(R.shaft[R.shaft.length - 1]).toEqual(SEAT);
    expect(SEAT).toEqual({ x: I.cradle.pos.x, y: I.cradle.raisedY + 2, z: I.cradle.pos.z });
  });

  it('is three legs, 180–240 m in all: down, a level run north, a vertical drop', () => {
    expect(R.shaft.length).toBe(4);
    const [a, b, c, d] = R.shaft as [Vec3, Vec3, Vec3, Vec3];
    expect([a.x, a.z]).toEqual([b.x, b.z]); // leg 1 vertical
    expect(b.y).toBe(c.y); // leg 2 level
    expect(c.z).toBeLessThan(b.z); // … and north
    expect([c.x, c.z]).toEqual([d.x, d.z]); // leg 3 vertical
    const length = shaftLength(R.shaft);
    expect(length).toBeGreaterThanOrEqual(180);
    expect(length).toBeLessThanOrEqual(240);
  });

  it('never hangs in the air: past its first 10 m it is under the clifftop, or in the column straight under the chair', () => {
    for (const v of R.shaft.slice(1)) expect(v.y).toBeLessThanOrEqual(CLIFF_TOP);
    for (const { p, s } of alongShaft(0.5)) {
      if (s <= SHAFT_OPEN_TOP || p.y <= CLIFF_TOP) continue;
      expect([p.x, p.z]).toEqual([R.chair.pos.x, R.chair.pos.z]);
    }
  });

  it("keeps its tube out of phase 2's Interior (the pen and the bore) except on its last leg, and under the grounds", () => {
    for (const { p, leg } of alongShaft(0.5)) {
      if (leg === R.shaft.length - 1) continue;
      expect(distanceToBox(p, I.pen)).toBeGreaterThanOrEqual(SHAFT_RADIUS);
      expect(distanceToCentreline(p)).toBeGreaterThanOrEqual(I.tunnel.radius + SHAFT_RADIUS);
      // The level run's tube stays inside the 5 m of rock between the pen's ceiling and the grounds.
      if (leg === 2) expect(p.y + SHAFT_RADIUS).toBeLessThanOrEqual(CLIFF_TOP);
    }
    const [, , c, d] = R.shaft as [Vec3, Vec3, Vec3, Vec3];
    expect(c.y).toBeGreaterThan(I.pen.max.y); // the drop comes through the pen's roof …
    expect(d.y).toBeLessThan(I.pen.max.y); // … into the hall
  });
});
