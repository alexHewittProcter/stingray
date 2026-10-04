import { describe, expect, it } from 'vitest';
import { contact, distanceTo, type Collider } from './collide';
import { confine, confineCamera, inInterior, northOfFace } from './interior';
import { forwardOf } from './sub';
import { TUNING as T } from './tuning';
import type { Vec3 } from './vec3';
import { CLIFF_TOP, COAST_Z, MARINEVILLE, createWorld, type Interior } from './world';

const SEEDS = [1964, 1, 42];
const I: Interior = MARINEVILLE.interior;
const LINE = I.tunnel.centreline;
const REACH = T.tunnelHullReach;
const EPS = 1e-9;

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const dist = (a: Vec3, b: Vec3) => len(sub(a, b));
const unit = (a: Vec3) => scale(a, 1 / len(a));
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/** Distance from p to the tunnel's centreline polyline. */
function toCentreline(p: Vec3): number {
  let best = Infinity;
  for (let k = 1; k < LINE.length; k++) {
    const a = LINE[k - 1]!;
    const ab = sub(LINE[k]!, a);
    const s = Math.min(Math.max(dot(sub(p, a), ab) / dot(ab, ab), 0), 1);
    best = Math.min(best, dist(p, add(a, scale(ab, s))));
  }
  return best;
}

/** Distance from p to the hull's interior volume (0 inside): a reference version of confine's union, worked separately. */
function toVolume(p: Vec3): number {
  const lo = I.pen.min;
  const hi = I.pen.max;
  const i = T.hullRadius;
  const outside = (v: number, a: number, b: number) => Math.max(a - v, 0, v - b);
  const pen = Math.hypot(outside(p.x, lo.x + i, hi.x - i), outside(p.y, lo.y + i, hi.y - i), outside(p.z, lo.z + i, hi.z - i));
  return Math.max(Math.min(toCentreline(p) - REACH, pen), 0);
}

/** Points every `step` metres along a path of waypoints. */
function along(path: Vec3[], step: number): Vec3[] {
  const out: Vec3[] = [path[0]!];
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1]!;
    const d = sub(path[k]!, a);
    const n = Math.max(1, Math.ceil(len(d) / step));
    for (let j = 1; j <= n; j++) out.push(add(a, scale(d, j / n)));
  }
  return out;
}

const cradleLowered = (): Vec3 => ({ ...I.cradle.pos, y: I.cradle.loweredY });

describe('interior geometry (L1)', () => {
  it('13. the centreline starts at tunnelMouth heading inward; the interior lies north of the face, inside the bounds and under the clifftop; tunnelMouth and the spawn are unchanged', () => {
    const m = MARINEVILLE.tunnelMouth;
    expect(m).toEqual({ x: 0, y: -40, z: COAST_Z });
    expect(MARINEVILLE.tunnelHeading).toBe(Math.PI);
    const w = createWorld(1964);
    expect(w.spawn.pos.x).toBeCloseTo(0, 9);
    expect(w.spawn.pos.y).toBe(-40);
    expect(w.spawn.pos.z).toBe(COAST_Z + 60);
    expect(w.spawn.yaw).toBe(Math.PI);
    expect(w.marineville.interior).toBe(I);

    // Starts at the mouth, heading inward (against tunnelHeading's way out), level along the door chamber.
    expect(LINE[0]).toEqual(m);
    const inward = scale(forwardOf(MARINEVILLE.tunnelHeading, 0), -1);
    expect(dot(unit(sub(LINE[1]!, LINE[0]!)), inward)).toBeCloseTo(1, 12);
    expect(LINE[1]!.z).toBeLessThanOrEqual(m.z - 70);
    expect(LINE[1]!.y).toBe(m.y);

    // About 250 m long, ending on the pen's south wall level with the lowered cradle.
    let length = 0;
    for (let k = 1; k < LINE.length; k++) length += dist(LINE[k]!, LINE[k - 1]!);
    expect(length).toBeGreaterThan(230);
    expect(length).toBeLessThan(270);
    const end = LINE[LINE.length - 1]!;
    expect(end).toEqual({ x: 0, y: I.cradle.loweredY, z: I.pen.max.z });

    // Gentle bends: no corner sharper than 15°, and an S-bend of about ±13 m.
    for (let k = 1; k < LINE.length - 1; k++) {
      const a = unit(sub(LINE[k]!, LINE[k - 1]!));
      const b = unit(sub(LINE[k + 1]!, LINE[k]!));
      expect(Math.acos(Math.min(dot(a, b), 1)), `corner ${k}`).toBeLessThan((15 * Math.PI) / 180);
    }
    expect(Math.max(...LINE.map((p) => p.x))).toBeCloseTo(13, 0);
    expect(Math.min(...LINE.map((p) => p.x))).toBeCloseTo(-13, 0);

    // North of the face (the bore starts at the face itself), inside the bounds, under the clifftop.
    const half = w.bounds.halfSize;
    const r = I.tunnel.radius;
    expect(r).toBe(13);
    for (const p of LINE.slice(1)) expect(p.z).toBeLessThan(COAST_Z);
    for (const p of LINE) {
      expect(Math.abs(p.x) + r).toBeLessThan(half);
      expect(p.z - r).toBeGreaterThan(-half);
      expect(p.y + r).toBeLessThan(CLIFF_TOP);
    }
    expect(I.pen.max.z).toBeLessThan(COAST_Z);
    expect(I.pen.min.z).toBeGreaterThan(-half);
    expect(Math.max(Math.abs(I.pen.min.x), Math.abs(I.pen.max.x))).toBeLessThan(half);
    expect(I.pen.max.y).toBeLessThan(CLIFF_TOP);
    expect(I.pen).toEqual({ min: { x: -32, y: -28, z: -1450 }, max: { x: 32, y: 20, z: -1340 }, waterY: 0 });

    // The cradle in the middle of the pool, the door in the mouth.
    expect(I.cradle).toEqual({ pos: { x: 0, y: -14, z: -1395 }, raisedY: 7, loweredY: -14, yawOut: Math.PI });
    expect(inInterior({ ...I.cradle.pos, y: I.cradle.raisedY }, I)).toBe(true);
    expect(inInterior(cradleLowered(), I)).toBe(true);
    expect(I.door).toEqual({ centre: m, range: 120 });

    // Plain frozen data.
    expect(Object.isFrozen(I)).toBe(true);
    expect(Object.isFrozen(LINE)).toBe(true);
    expect(Object.isFrozen(LINE[5])).toBe(true);
    expect(Object.isFrozen(I.pen.min)).toBe(true);
  });

  it.each(SEEDS)('13. the seabed stays clear below the interior volume (seed %i)', (seed) => {
    // stepSub's bed rule runs inside too: the bed plus the hull clearance never reaches the volume.
    const bed = createWorld(seed).seabedHeight;
    const lowest = (x: number, z: number) => {
      if (z >= I.pen.min.z && z <= I.pen.max.z && Math.abs(x) <= I.pen.max.x) return I.pen.min.y;
      return Math.min(...LINE.map((p) => p.y)) - I.tunnel.radius;
    };
    for (let x = -40; x <= 40; x += 4) {
      for (let z = COAST_Z; z >= I.pen.min.z; z -= 4) expect(bed(x, z) + T.hullRadius).toBeLessThan(lowest(x, z));
    }
  });
});

describe('the slab (amendment 4)', () => {
  const w = createWorld(1964);
  const coast = w.landmarks.find((l) => l.id === 'marineville')!;
  const m = MARINEVILLE.tunnelMouth;
  // The shut door: the one collider that fills the mouth just behind the face (as 12d finds it).
  const door = coast.colliders.find((c) => distanceTo(c, { ...m, z: m.z - 1 }) < 0)!;
  const slab = coast.colliders.filter((c) => c !== door);
  const touches = (cs: readonly Collider[], p: Vec3) => cs.some((c) => contact(c, p, T.hullRadius) !== null);

  it('keeps the shut door where phase 1 put it, and has four slab boxes 12 m deep', () => {
    expect(door).toEqual({ kind: 'box', min: { x: -20, y: -52, z: COAST_Z - 6 }, max: { x: 20, y: -28, z: COAST_Z } });
    expect(slab).toHaveLength(4);
    for (const c of slab) {
      if (c.kind !== 'box') throw new Error('slab boxes only');
      expect(c.max.z).toBe(COAST_Z);
      expect(c.min.z).toBe(COAST_Z - 12);
    }
    // Solid in the slab, open behind it.
    expect(touches(slab, { x: 300, y: -40, z: COAST_Z - 6 })).toBe(true);
    expect(touches(slab, { x: 300, y: -40, z: COAST_Z - 12 - T.hullRadius - 0.01 })).toBe(false);
  });

  it('opens an 18 m square mouth: a hull centre 5 m off the axis passes, 5.5 m off does not', () => {
    for (let z = COAST_Z + 2; z >= COAST_Z - 14; z -= 0.5) {
      for (const [dx, dy] of [[5, 0], [-5, 0], [0, 5], [0, -5], [3, 4], [-4, -3]] as const) {
        expect(touches(slab, { x: m.x + dx, y: m.y + dy, z })).toBe(false);
      }
    }
    for (const [dx, dy] of [[5.5, 0], [-5.5, 0], [0, 5.5], [0, -5.5]] as const) {
      expect(touches(slab, { x: m.x + dx, y: m.y + dy, z: COAST_Z - 6 })).toBe(true);
    }
  });

  it('5. with the door left out (it is always shut until T2), a point moved along the whole centreline from 30 m outside the mouth to the cradle is never moved by the slab or by confine', () => {
    const path = along([{ ...m, z: m.z + 30 }, ...LINE, cradleLowered()], 0.25);
    expect(path.length).toBeGreaterThan(1000);
    for (const p of path) {
      expect(touches(slab, p), `slab at z ${p.z}`).toBe(false);
      const c = confine(p, I);
      expect(c.normal, `confine at z ${p.z}`).toBeNull();
      expect(c.pos).toEqual(p);
      expect(p.y - w.seabedHeight(p.x, p.z)).toBeGreaterThan(T.hullRadius);
    }
    // And the shut door does block it.
    expect(path.some((p) => touches([door], p))).toBe(true);
  });
});

describe('confine (L1)', () => {
  // A unit vector square to the centreline at segment k: the sideways or the up-and-over direction, turned by `angle`.
  function across(k: number, angle: number): Vec3 {
    const d = unit(sub(LINE[k]!, LINE[k - 1]!));
    const side = unit(cross(d, { x: 0, y: 1, z: 0 }));
    const up = cross(side, d);
    return add(scale(side, Math.cos(angle)), scale(up, Math.sin(angle)));
  }
  const mid = (k: number) => scale(add(LINE[k - 1]!, LINE[k]!), 0.5);

  it('leaves a point already inside unmoved, and anything south of the face alone', () => {
    for (let k = 1; k < LINE.length; k++) {
      for (let a = 0; a < 8; a++) {
        const p = add(mid(k), scale(across(k, (a * Math.PI) / 4), REACH - 0.01));
        if (!northOfFace(p)) continue;
        expect(confine(p, I)).toEqual({ pos: p, normal: null });
        expect(inInterior(p, I)).toBe(true);
      }
    }
    for (const p of [{ x: 0, y: 0, z: -1400 }, { x: 27, y: 15, z: -1345 }, { x: -27, y: -23, z: -1445 }]) {
      expect(confine(p, I)).toEqual({ pos: p, normal: null });
    }
    // South of the face nothing is confined, however far from the axis.
    for (const p of [{ x: 300, y: -40, z: COAST_Z + 0.5 }, { x: 0, y: -40, z: COAST_Z }, { x: 0, y: 100, z: 0 }]) {
      expect(northOfFace(p)).toBe(false);
      expect(confine(p, I)).toEqual({ pos: p, normal: null });
      expect(inInterior(p, I)).toBe(false);
    }
  });

  it('4. holds the hull centre within 5 m of the centreline against the tunnel wall, correcting by the overlap only', () => {
    let checked = 0;
    for (let k = 1; k < LINE.length; k++) {
      for (let a = 0; a < 12; a++) {
        const out = across(k, (a * Math.PI) / 6);
        for (const r of [5.5, 8, 13]) {
          const p = add(mid(k), scale(out, r));
          if (!northOfFace(p)) continue;
          const overlap = toVolume(p);
          const c = confine(p, I);
          if (overlap === 0) {
            // A bend's inside, where another segment's capsule holds it, or the pen beyond the tunnel's end.
            expect(c).toEqual({ pos: p, normal: null });
            continue;
          }
          checked++;
          expect(c.normal).not.toBeNull();
          expect(toVolume(c.pos)).toBeLessThanOrEqual(EPS); // the margin kept
          expect(dist(c.pos, p)).toBeCloseTo(overlap, 9); // moved by the overlap, no more
          expect(len(c.normal!)).toBeCloseTo(1, 12);
          if (toCentreline(p) - REACH === overlap) expect(dot(c.normal!, out)).toBeLessThan(0); // back toward the axis
          else expect(p.z).toBeLessThan(I.pen.max.z + REACH); // only by the pen does the pen box win
          expect(confine(c.pos, I).normal).toBeNull(); // and left there next time
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it('4. holds the hull centre 4 m inside the pen walls, the pool floor and the ceiling', () => {
    const inset = T.hullRadius;
    const { min, max } = I.pen;
    const cases: Array<[Vec3, Vec3, Vec3]> = [
      // [position, where it ends up, normal]
      [{ x: max.x - 1, y: 0, z: -1400 }, { x: max.x - inset, y: 0, z: -1400 }, { x: -1, y: 0, z: 0 }], // east wall
      [{ x: min.x + 2, y: -5, z: -1380 }, { x: min.x + inset, y: -5, z: -1380 }, { x: 1, y: 0, z: 0 }], // west wall
      [{ x: 10, y: -5, z: min.z + 1 }, { x: 10, y: -5, z: min.z + inset }, { x: 0, y: 0, z: 1 }], // north wall
      [{ x: 20, y: 5, z: max.z - 1 }, { x: 20, y: 5, z: max.z - inset }, { x: 0, y: 0, z: -1 }], // south wall, clear of the tunnel
      [{ x: 0, y: min.y + 0.5, z: -1420 }, { x: 0, y: min.y + inset, z: -1420 }, { x: 0, y: 1, z: 0 }], // pool floor
      [{ x: -10, y: max.y - 2, z: -1400 }, { x: -10, y: max.y - inset, z: -1400 }, { x: 0, y: -1, z: 0 }], // ceiling
      [{ x: 5, y: max.y + 30, z: -1400 }, { x: 5, y: max.y - inset, z: -1400 }, { x: 0, y: -1, z: 0 }], // well above it
    ];
    for (const [p, to, normal] of cases) {
      const c = confine(p, I);
      expect(c.pos.x).toBeCloseTo(to.x, 9);
      expect(c.pos.y).toBeCloseTo(to.y, 9);
      expect(c.pos.z).toBeCloseTo(to.z, 9);
      expect(c.normal!.x).toBeCloseTo(normal.x, 12);
      expect(c.normal!.y).toBeCloseTo(normal.y, 12);
      expect(c.normal!.z).toBeCloseTo(normal.z, 12);
      expect(dist(c.pos, p)).toBeCloseTo(dist(to, p), 9);
      expect(confine(c.pos, I).normal).toBeNull();
    }
    // A corner: pushed in along both faces at once, to the shrunk box's corner.
    const corner = confine({ x: max.x + 3, y: min.y - 1, z: -1430 }, I);
    expect(corner.pos).toEqual({ x: max.x - inset, y: min.y + inset, z: -1430 });
  });

  it('the camera is held inside the drawn walls less 1 m, not the hull margins', () => {
    const k = 3;
    const out = across(k, 0.7);
    const p = add(mid(k), scale(out, 12.5));
    expect(toCentreline(confineCamera(p, I).pos)).toBeCloseTo(I.tunnel.radius - T.cameraWallInset, 9);
    const inside = add(mid(k), scale(out, 11.5));
    expect(confineCamera(inside, I)).toEqual({ pos: inside, normal: null });
    expect(confine(inside, I).normal).not.toBeNull(); // the hull may not go there
    expect(confineCamera({ x: 0, y: 19.5, z: -1400 }, I).pos.y).toBeCloseTo(I.pen.max.y - T.cameraWallInset, 9);
    expect(confineCamera({ x: 30.5, y: 0, z: -1400 }, I)).toEqual({ pos: { x: 30.5, y: 0, z: -1400 }, normal: null });
  });
});
