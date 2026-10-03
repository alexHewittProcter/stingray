import { describe, expect, it } from 'vitest';
import { distanceTo, type Collider } from './collide';
import { NO_INPUT, initialSubState, speedOf, stepSub, type SubState } from './sub';
import { TUNING as T } from './tuning';
import type { Vec3 } from './vec3';
import { ARCH, COAST_Z, FIXED_DT, createWorld, targetPos, type World } from './world';

const SEEDS = [1964, 1, 42];
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const solidColliders = (w: World): Collider[] => w.landmarks.filter((l) => l.solid).flatMap((l) => l.colliders);

/** In open water: under the surface, clear of the bed by `clearance`, and clear of every solid collider. */
function expectOpenWater(w: World, p: Vec3, radius: number, what: string): void {
  expect(p.y + radius, `${what} under the surface`).toBeLessThan(0);
  expect(p.y - radius - w.seabedHeight(p.x, p.z), `${what} above the bed`).toBeGreaterThanOrEqual(T.hullRadius);
  for (const c of solidColliders(w)) expect(distanceTo(c, p), `${what} clear of colliders`).toBeGreaterThan(radius + 2);
}

describe.each(SEEDS)('world (seed %i)', (seed) => {
  const w = createWorld(seed);

  it('12a. seabedHeight is ≤ -20 m on a grid over the whole bounds; shelf ≈ -70 at the mouth; trench ≈ -320', () => {
    const h = w.bounds.halfSize;
    let highest = -Infinity;
    let deepest = Infinity;
    for (let x = -h; x <= h; x += 25) {
      for (let z = -h; z <= h; z += 25) {
        const y = w.seabedHeight(x, z);
        highest = Math.max(highest, y);
        deepest = Math.min(deepest, y);
      }
    }
    expect(highest).toBeLessThanOrEqual(-20);
    expect(deepest).toBeLessThan(-300);
    expect(deepest).toBeGreaterThan(-345);
    const m = w.marineville.tunnelMouth;
    expect(Math.abs(w.seabedHeight(m.x, m.z + 5) - (m.y - 30))).toBeLessThan(5); // shelf 30 m beneath the mouth
  });

  it('12b. the spawn point, every target and every drone loop sit in open water', () => {
    const spawn = initialSubState(w);
    expectOpenWater(w, spawn.pos, T.hullRadius, 'spawn');
    for (const t of w.targets) {
      for (let k = 0; k < 64; k++) {
        const period = t.loop ? (2 * Math.PI * t.loop.radius) / t.loop.speed : 1;
        expectOpenWater(w, targetPos(t, (period * k) / 64), t.radius, t.id);
      }
    }
  });

  it('12c. spawn is 60 m out along tunnelHeading, at rest, facing away from the mouth', () => {
    const s = initialSubState(w);
    const m = w.marineville.tunnelMouth;
    expect(dist(s.pos, m)).toBeCloseTo(60, 9);
    expect(s.yaw).toBe(w.marineville.tunnelHeading);
    expect(speedOf(s)).toBe(0);
    // Facing away: stepping forward moves it further from the mouth.
    let moved: SubState = s;
    for (let k = 0; k < 60; k++) moved = stepSub(moved, { ...NO_INPUT, throttle: 1 }, FIXED_DT, w);
    expect(dist(moved.pos, m)).toBeGreaterThan(60);
  });

  it('12d. the tunnel mouth lies on the cliff face, 40 m down, behind the shut door', () => {
    const m = w.marineville.tunnelMouth;
    expect(m.z).toBe(COAST_Z);
    expect(m.y).toBe(-40);
    const coast = w.landmarks.find((l) => l.id === 'marineville')!;
    expect(coast.solid).toBe(true);
    // Just outside the mouth is open water; just inside is solid (the door).
    expect(coast.colliders.some((c) => distanceTo(c, { ...m, z: m.z - 1 }) < 0)).toBe(true);
    expect(coast.colliders.every((c) => distanceTo(c, { ...m, z: m.z + 1 }) > 0)).toBe(true);
  });

  it('12e. the six landmarks: each within 1 000 m of the mouth and within 350 m of another', () => {
    const ids = w.landmarks.map((l) => l.id).sort();
    expect(ids).toEqual(['arch', 'kelp', 'marineville', 'stacks', 'trench', 'wreck']);
    const m = w.marineville.tunnelMouth;
    for (const l of w.landmarks) {
      expect(dist(l.pos, m), l.id).toBeLessThanOrEqual(1000);
      const nearest = Math.min(...w.landmarks.filter((o) => o !== l).map((o) => dist(o.pos, l.pos)));
      expect(nearest, l.id).toBeLessThanOrEqual(350);
    }
    expect(w.landmarks.find((l) => l.id === 'kelp')!.solid).toBe(false);
    for (const l of w.landmarks.filter((l) => l.solid)) expect(l.colliders.length).toBeGreaterThan(0);
  });

  it('12f. targets: 8 static 1-hp buoys and 4 2-hp drones on 8–12 m/s loops; two within ~300 m ahead of spawn', () => {
    const buoys = w.targets.filter((t) => t.kind === 'buoy');
    const drones = w.targets.filter((t) => t.kind === 'drone');
    expect(buoys).toHaveLength(8);
    expect(drones).toHaveLength(4);
    for (const b of buoys) {
      expect(b.hp).toBe(1);
      expect(targetPos(b, 37)).toEqual(b.pos);
    }
    for (const d of drones) {
      expect(d.hp).toBe(2);
      const step = dist(targetPos(d, 10), targetPos(d, 10 + 1e-3)) / 1e-3;
      expect(step).toBeGreaterThanOrEqual(8 - 1e-3);
      expect(step).toBeLessThanOrEqual(12 + 1e-3);
      expect(targetPos(d, 0)).toEqual(d.pos);
    }
    const s = initialSubState(w);
    const ahead = { x: -Math.sin(s.yaw), z: -Math.cos(s.yaw) };
    const near = w.targets.filter((t) => {
      const dx = t.pos.x - s.pos.x;
      const dz = t.pos.z - s.pos.z;
      const along = dx * ahead.x + dz * ahead.z;
      return dist(t.pos, s.pos) <= 300 && along > 0.8 * Math.hypot(dx, dz);
    });
    expect(near.length).toBeGreaterThanOrEqual(2);
    const depths = new Set(w.targets.map((t) => Math.round(t.pos.y / 25)));
    expect(depths.size).toBeGreaterThanOrEqual(4); // mixed depths
  });

  it('13. the arch opening is passable: a straight run through its centre touches no collider', () => {
    const arch = w.landmarks.find((l) => l.id === 'arch')!;
    const centre = arch.pos;
    expect(centre.x).toBe(ARCH.x);
    // Geometric sweep of the hull sphere along the run.
    for (let dz = -60; dz <= 60; dz += 0.5) {
      const p = { x: centre.x, y: centre.y, z: centre.z + dz };
      for (const c of solidColliders(w)) expect(distanceTo(c, p)).toBeGreaterThan(T.hullRadius);
      expect(p.y - w.seabedHeight(p.x, p.z)).toBeGreaterThan(T.hullRadius);
    }
    // And the sim agrees: a cruise through it keeps its line and its speed.
    let s: SubState = {
      pos: { x: centre.x, y: centre.y, z: centre.z - 60 },
      vel: { x: 0, y: 0, z: T.cruiseSpeed },
      yaw: Math.PI,
      pitch: 0,
      medium: 'submerged',
    };
    for (let k = 0; k < 5 * 60; k++) s = stepSub(s, { ...NO_INPUT, throttle: 1 }, FIXED_DT, w);
    expect(s.pos.z).toBeGreaterThan(centre.z + 60);
    expect(s.pos.x).toBeCloseTo(centre.x, 9);
    expect(s.pos.y).toBeCloseTo(centre.y, 9);
    expect(speedOf(s)).toBeCloseTo(T.cruiseSpeed, 9);
  });
});

describe('world', () => {
  it('12g. createWorld is pure: the same seed builds the same world, a different seed a different bed', () => {
    const a = createWorld(7);
    const b = createWorld(7);
    expect(a.landmarks).toEqual(b.landmarks);
    expect(a.seabedHeight(123.4, -567.8)).toBe(b.seabedHeight(123.4, -567.8));
    expect(createWorld(8).seabedHeight(123.4, -567.8)).not.toBe(a.seabedHeight(123.4, -567.8));
    expect(Object.isFrozen(a.landmarks)).toBe(true);
  });
});
