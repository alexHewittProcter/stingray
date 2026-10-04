import { describe, expect, it } from 'vitest';
import { initialCombatState, stepCombat, targetsLeft, type CombatState, type Target } from './combat';
import type { Collider } from './collide';
import { NO_INPUT, forwardOf, speedOf, stepSub, type SubInput, type SubState } from './sub';
import { TUNING as T } from './tuning';
import type { Vec3 } from './vec3';
import { CLIFF_TOP, COAST_Z, FIXED_DT, createWorld, targetPos, type Env, type TargetSpec } from './world';

const world = createWorld(1964);
const DT = FIXED_DT;
const DEG = Math.PI / 180;
const NORTH = 0;
const SOUTH = Math.PI;
const EAST = -Math.PI / 2;
const HULL_HALF_LENGTH = 13; // C6: Stingray is 26 m long

// Open water well away from landmarks, targets, trench and edges.
const OPEN: Vec3 = { x: -600, y: -50, z: 400 };

function subAt(pos: Vec3, yaw: number, pitch = 0, speed = 0, medium: SubState['medium'] = 'submerged'): SubState {
  const f = forwardOf(yaw, pitch);
  return { pos: { ...pos }, vel: { x: f.x * speed, y: f.y * speed, z: f.z * speed }, yaw, pitch, medium };
}

const spec = (id: string): TargetSpec => world.targets.find((s) => s.id === id)!;
const target = (c: CombatState, id: string): Target => c.targets.find((t) => t.id === id)!;
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Fires once, then steps without fire until the first detonation (or `seconds` run out). */
function fireUntilDetonation(c: CombatState, sub: SubState, seconds = 3, env: Env = world, dt = DT) {
  const seen: Vec3[] = [];
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    c = stepCombat(c, sub, k === 0, dt, env);
    if (c.detonations.length > 0) return { c, detonation: c.detonations[0]!, seen };
    seen.push(...c.missiles.map((m) => m.pos));
  }
  return { c, detonation: null, seen };
}

/** Yaw that points a level nose from `from` toward `to`. */
const yawToward = (from: Vec3, to: Vec3) => Math.atan2(-(to.x - from.x), -(to.z - from.z));

describe('stepCombat', () => {
  it('9a. fire respects the cooldown', () => {
    // Nose up into empty sky, so every missile is still flying when counted.
    const sub = subAt(OPEN, EAST, 50 * DEG);
    let c = initialCombatState(world);
    const launches: number[] = [];
    for (let k = 0; k < Math.round(2 / DT); k++) {
      const n = c.missiles.length;
      c = stepCombat(c, sub, true, DT, world);
      if (c.missiles.length > n) launches.push(k);
      expect(c.missiles.length - n).toBeLessThanOrEqual(1);
    }
    expect(launches[0]).toBe(0); // ready at the start
    expect(launches.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < launches.length; i++) {
      const gap = (launches[i]! - launches[i - 1]!) * DT;
      expect(gap).toBeGreaterThanOrEqual(T.missileCooldown - 1e-9);
      expect(gap).toBeLessThanOrEqual(T.missileCooldown + DT + 1e-9);
    }

    // Released and pressed again after the cooldown has run out: fires at once.
    for (let k = 0; k < 30; k++) c = stepCombat(c, sub, false, DT, world);
    const n = c.missiles.length;
    expect(stepCombat(c, sub, true, DT, world).missiles.length).toBe(n + 1);
  });

  it('9b. a missile at top speed still hits a buoy it would step past (swept test)', () => {
    const buoy = spec('buoy-1');
    const reach = buoy.radius + T.missileRadius;
    const missileSpeed = T.boostSpeed + T.missileSpeed;
    const stepLength = missileSpeed * DT;
    // A grazing line 2.9 m off the buoy's centre: the chord inside its reach is shorter than one step,
    // and the start is placed so the buoy falls midway between two steps' end points.
    const z0 = buoy.pos.z - T.missileNoseOffset - stepLength * 21.5;
    const sub = subAt({ x: buoy.pos.x + 2.9, y: buoy.pos.y, z: z0 }, SOUTH, 0, T.boostSpeed);

    const { c, detonation, seen } = fireUntilDetonation(initialCombatState(world), sub);

    // Precondition: no step's end point comes within reach — a point test would miss.
    expect(seen.length).toBeGreaterThan(10);
    for (const p of seen) expect(dist(p, buoy.pos)).toBeGreaterThan(reach);
    const last = seen[seen.length - 1]!;
    expect(last.z).toBeLessThan(buoy.pos.z);
    expect(last.z + stepLength).toBeGreaterThan(buoy.pos.z);

    expect(detonation).not.toBeNull();
    expect(dist(detonation!, buoy.pos)).toBeLessThanOrEqual(reach + 1e-9);
    expect(target(c, 'buoy-1').alive).toBe(false);
  });

  it('9c. a missile aimed at a buoy destroys it', () => {
    const buoy = spec('buoy-1');
    const sub = subAt({ x: buoy.pos.x, y: buoy.pos.y, z: buoy.pos.z - 100 }, SOUTH);
    const { c, detonation } = fireUntilDetonation(initialCombatState(world), sub);
    expect(detonation).not.toBeNull();
    expect(dist(detonation!, buoy.pos)).toBeLessThanOrEqual(buoy.radius + T.missileRadius + 1e-9);
    expect(target(c, 'buoy-1')).toMatchObject({ hp: 0, alive: false });
    expect(targetsLeft(c)).toBe(11);
    expect(c.missiles).toEqual([]);
  });

  it('9d. a drone needs two hits', () => {
    const drone = spec('drone-1');
    const centre = drone.loop!.centre;
    // From the loop's centre a missile flies straight out to the loop; aim where the drone will be then.
    const flight = (drone.loop!.radius - T.missileNoseOffset) / T.missileSpeed;
    const shoot = (c: CombatState) => {
      const sub = subAt(centre, yawToward(centre, targetPos(drone, c.t + flight)));
      return fireUntilDetonation(c, sub);
    };

    let c = initialCombatState(world);
    const first = shoot(c);
    expect(first.detonation).not.toBeNull();
    expect(target(first.c, 'drone-1')).toMatchObject({ hp: 1, alive: true });

    c = first.c;
    while (c.cooldown > 0) c = stepCombat(c, subAt(centre, 0), false, DT, world);
    const second = shoot(c);
    expect(second.detonation).not.toBeNull();
    expect(target(second.c, 'drone-1')).toMatchObject({ hp: 0, alive: false });
    expect(targetsLeft(second.c)).toBe(11);
  });

  it("9d+. a drone that crosses the missile's line between two steps is still hit (swept against its motion)", () => {
    // At a coarse 1 s step drone-1 moves 10 m: it starts and ends the crossing step 5 m either side of the
    // missile's line, so testing against its start or end position alone would miss.
    const drone = spec('drone-1');
    const centre = drone.loop!.centre;
    const dt = 1;
    const t0 = (Math.PI / 2 - drone.loop!.phase) / (drone.loop!.speed / drone.loop!.radius) - dt / 2; // south of the loop mid-step
    const p = targetPos(drone, t0 + dt / 2);
    const out = { x: (p.x - centre.x) / drone.loop!.radius, y: 0, z: (p.z - centre.z) / drone.loop!.radius };
    // Launch at t0 - dt; the missile is at the crossing point P half-way through the step after.
    const back = T.missileNoseOffset + T.missileSpeed * 1.5 * dt;
    const sub = subAt({ x: p.x + out.x * back, y: p.y, z: p.z + out.z * back }, yawToward({ x: p.x + out.x, y: p.y, z: p.z + out.z }, p));

    let c = stepCombat(initialCombatState(world), sub, false, t0 - dt, world);
    c = stepCombat(c, sub, true, dt, world);
    expect(c.detonations).toEqual([]);
    for (const end of [targetPos(drone, t0), targetPos(drone, t0 + dt)]) expect(dist(end, p)).toBeGreaterThan(drone.radius + T.missileRadius);
    c = stepCombat(c, sub, false, dt, world);
    expect(c.detonations).toHaveLength(1);
    expect(dist(c.detonations[0]!, p)).toBeLessThan(drone.radius + T.missileRadius + 0.5);
    expect(target(c, 'drone-1')).toMatchObject({ hp: 1, alive: true });
  });

  it('9e. a missile aimed at the seabed detonates there', () => {
    const sub = subAt(OPEN, EAST, -50 * DEG);
    const { c, detonation } = fireUntilDetonation(initialCombatState(world), sub);
    expect(detonation).not.toBeNull();
    const bed = world.seabedHeight(detonation!.x, detonation!.z);
    expect(detonation!.y - T.missileRadius).toBeCloseTo(bed, 2);
    expect(c.missiles).toEqual([]);
    expect(targetsLeft(c)).toBe(12);
  });

  it('9f. missiles expire at 6 s, flying straight through the surface with no gravity', () => {
    const sub = subAt(OPEN, EAST, 50 * DEG);
    let c = stepCombat(initialCombatState(world), sub, true, DT, world);
    const launched = c.missiles[0]!;
    const lifeSteps = Math.round(T.missileLifetime / DT);
    for (let k = 1; k < lifeSteps - 1; k++) {
      c = stepCombat(c, sub, false, DT, world);
      expect(c.detonations).toEqual([]);
    }
    expect(c.missiles).toHaveLength(1);
    const m = c.missiles[0]!;
    expect(m.age).toBeGreaterThan(T.missileLifetime - 2 * DT);
    expect(m.pos.y).toBeGreaterThan(100); // left the water and kept climbing
    expect(m.vel).toEqual(launched.vel);

    c = stepCombat(stepCombat(c, sub, false, DT, world), sub, false, DT, world);
    expect(c.missiles).toEqual([]);
    expect(c.detonations).toEqual([]); // expiry is not an explosion
  });

  it('10. a missile fired at boost speed leaves the nose ahead of the sub and never collides with it', () => {
    const boost: SubInput = { ...NO_INPUT, throttle: 1, boost: true };
    let s = subAt(OPEN, EAST, 0, T.boostSpeed);
    let c = initialCombatState(world);
    let ahead = -Infinity;
    for (let k = 0; k < Math.round(2 / DT); k++) {
      s = stepSub(s, boost, DT, world);
      c = stepCombat(c, s, k === 0, DT, world);
      expect(c.detonations).toEqual([]);
      const m = c.missiles[0]!;
      const f = forwardOf(s.yaw, s.pitch);
      const rel = { x: m.pos.x - s.pos.x, y: m.pos.y - s.pos.y, z: m.pos.z - s.pos.z };
      const along = rel.x * f.x + rel.y * f.y + rel.z * f.z;
      if (k === 0) {
        expect(speedOf({ ...s, vel: m.vel })).toBeCloseTo(speedOf(s) + T.missileSpeed, 9);
        expect(along).toBeGreaterThan(HULL_HALF_LENGTH + T.missileRadius);
      }
      expect(along).toBeGreaterThan(ahead); // pulling away every step
      expect(dist(m.pos, s.pos)).toBeGreaterThan(T.hullRadius + T.missileRadius);
      ahead = along;
    }
  });

  it('fires in any medium and in reverse, always leaving the nose', () => {
    const cases: SubState[] = [
      subAt({ x: OPEN.x, y: 12, z: OPEN.z }, EAST, 20 * DEG, 40, 'airborne'),
      subAt({ x: OPEN.x, y: -1, z: OPEN.z }, EAST, 0, 30, 'surface'),
      { ...subAt(OPEN, EAST), vel: { x: -10, y: 0, z: 0 } }, // reversing (east is +x)
    ];
    for (const s of cases) {
      const c = stepCombat(initialCombatState(world), s, true, DT, world);
      expect(c.missiles).toHaveLength(1);
      const m = c.missiles[0]!;
      const f = forwardOf(s.yaw, s.pitch);
      const along = s.vel.x * f.x + s.vel.y * f.y + s.vel.z * f.z;
      expect(m.vel.x * f.x + m.vel.y * f.y + m.vel.z * f.z).toBeCloseTo(along + T.missileSpeed, 9);
    }
  });

  it('is deterministic over a recorded input script', () => {
    const script = (k: number): SubInput => ({
      throttle: k % 600 < 400 ? 1 : -0.5,
      yaw: Math.sin(k / 90),
      pitch: k % 300 < 100 ? 0.6 : k % 300 < 160 ? -0.8 : 0,
      boost: k % 900 > 500,
      fire: k % 37 < 20,
    });
    const play = () => {
      let s: SubState = { pos: { ...world.spawn.pos }, vel: { x: 0, y: 0, z: 0 }, yaw: world.spawn.yaw, pitch: 0, medium: 'submerged' };
      let c = initialCombatState(world);
      let shots = 0;
      for (let k = 0; k < Math.round(30 / DT); k++) {
        const i = script(k);
        s = stepSub(s, i, DT, world);
        c = stepCombat(c, s, i.fire, DT, world);
        shots += c.detonations.length;
      }
      return { s, c, shots };
    };
    const a = play();
    const b = play();
    expect(a.shots).toBeGreaterThan(0); // the script does exercise hits
    expect(b).toStrictEqual(a);
  });

  it('is pure: never mutates its arguments and shares nothing mutable with them', () => {
    const buoy = spec('buoy-1');
    const sub = subAt({ x: buoy.pos.x, y: buoy.pos.y, z: buoy.pos.z - 100 }, SOUTH, 0, 20);
    let c = initialCombatState(world);
    for (let k = 0; k < Math.round(2 / DT); k++) {
      const before = structuredClone(c);
      const subBefore = structuredClone(sub);
      const next = stepCombat(deepFreeze(structuredClone(c)), deepFreeze(structuredClone(sub)), k % 30 === 0, DT, world);
      stepCombat(c, sub, k % 30 === 0, DT, world);
      expect(c).toStrictEqual(before);
      expect(sub).toStrictEqual(subBefore);
      c = next;
    }
    const next = stepCombat(c, sub, true, DT, world);
    next.targets[0]!.pos.x += 1;
    next.missiles[0]!.pos.x += 1;
    expect(c.targets[0]!.pos.x).not.toBe(next.targets[0]!.pos.x);
    expect(c.missiles.some((m) => m === next.missiles[0])).toBe(false);
  });

  it('destroyed targets stay destroyed and no longer block missiles', () => {
    const buoy = spec('buoy-1');
    const sub = subAt({ x: buoy.pos.x, y: buoy.pos.y, z: buoy.pos.z - 100 }, SOUTH);
    let { c } = fireUntilDetonation(initialCombatState(world), sub);
    expect(target(c, 'buoy-1').alive).toBe(false);

    for (let k = 0; k < Math.round(10 / DT); k++) c = stepCombat(c, sub, false, DT, world);
    expect(target(c, 'buoy-1')).toMatchObject({ hp: 0, alive: false });

    // A second missile down the same line flies through where the buoy was.
    let passed = false;
    for (let k = 0; k < Math.round(2 / DT) && !passed; k++) {
      c = stepCombat(c, sub, k === 0, DT, world);
      for (const d of c.detonations) expect(dist(d, buoy.pos)).toBeGreaterThan(10);
      passed = c.missiles.some((m) => m.pos.z > buoy.pos.z + 10);
    }
    expect(passed).toBe(true);
    expect(target(c, 'buoy-1')).toMatchObject({ hp: 0, alive: false });
  });

  it('reports a detonation for the step it happens in only', () => {
    const buoy = spec('buoy-1');
    const sub = subAt({ x: buoy.pos.x, y: buoy.pos.y, z: buoy.pos.z - 100 }, SOUTH);
    const { c } = fireUntilDetonation(initialCombatState(world), sub);
    expect(c.detonations).toHaveLength(1);
    expect(stepCombat(c, sub, false, DT, world).detonations).toEqual([]);
  });

  it('detonates on solid landmarks: the shut marine door and an arch pillar', () => {
    const mouth = world.marineville.tunnelMouth;
    const door = fireUntilDetonation(initialCombatState(world), subAt({ ...mouth, z: mouth.z + 60 }, NORTH));
    expect(door.detonation).not.toBeNull();
    expect(door.detonation!.z).toBeCloseTo(mouth.z + T.missileRadius, 9);

    const arch = world.landmarks.find((l) => l.id === 'arch')!;
    const pillar = arch.colliders[0]! as Extract<Collider, { kind: 'box' }>;
    const x = (pillar.min.x + pillar.max.x) / 2;
    const y = (pillar.min.y + pillar.max.y) / 2;
    const hit = fireUntilDetonation(initialCombatState(world), subAt({ x, y, z: pillar.max.z + 60 }, NORTH));
    expect(hit.detonation).not.toBeNull();
    expect(hit.detonation!.z).toBeCloseTo(pillar.max.z + T.missileRadius, 9);
  });

  it('a coarse step cannot carry a missile through the 6 m marine door', () => {
    // At dt = 0.25 s a missile moves 20 m a step: its end points straddle the door, into the open tunnel behind.
    const mouth = world.marineville.tunnelMouth;
    const { detonation } = fireUntilDetonation(initialCombatState(world), subAt({ ...mouth, z: mouth.z + 60 }, NORTH), 3, world, 0.25);
    expect(detonation).not.toBeNull();
    expect(detonation!.z).toBeCloseTo(mouth.z + T.missileRadius, 9);
  });

  it('a coarse step cannot carry a missile through a thin seabed ridge', () => {
    // A 3 m-wide ridge sitting between two step end points, rising above the missile's line.
    const dt = 0.25;
    const ridgeZ = OPEN.z + T.missileNoseOffset + T.missileSpeed * dt * 2.5;
    const ridged: Env = { ...world, seabedHeight: (_x, z) => (Math.abs(z - ridgeZ) < 1.5 ? OPEN.y + 10 : -200) };
    const { detonation } = fireUntilDetonation(initialCombatState(world), subAt(OPEN, SOUTH), 3, ridged, dt);
    expect(detonation).not.toBeNull();
    expect(Math.abs(detonation!.z - ridgeZ)).toBeLessThanOrEqual(1.5 + 1e-3);
  });

  it('passes through non-solid landmarks such as the kelp', () => {
    // Give the kelp a collider across the missile's path: only `solid` decides whether it counts.
    const wall: Collider = { kind: 'box', min: { x: OPEN.x - 20, y: OPEN.y - 20, z: OPEN.z + 40 }, max: { x: OPEN.x + 20, y: OPEN.y + 20, z: OPEN.z + 50 } };
    const withKelp = (solid: boolean): Env => ({
      ...world,
      landmarks: world.landmarks.map((l) => (l.id === 'kelp' ? { ...l, solid, colliders: [wall] } : l)),
    });
    expect(world.landmarks.find((l) => l.id === 'kelp')!.solid).toBe(false);

    const through = fireUntilDetonation(initialCombatState(world), subAt(OPEN, SOUTH), 1, withKelp(false));
    expect(through.detonation).toBeNull();
    expect(Math.max(...through.seen.map((p) => p.z))).toBeGreaterThan(OPEN.z + 60);

    const blocked = fireUntilDetonation(initialCombatState(world), subAt(OPEN, SOUTH), 1, withKelp(true));
    expect(blocked.detonation!.z).toBeCloseTo(OPEN.z + 40 - T.missileRadius, 9);
  });

  it('moves live drones along their loops; buoys stay put', () => {
    let c = initialCombatState(world);
    const start = structuredClone(c.targets);
    const sub = subAt(OPEN, EAST);
    for (let k = 0; k < Math.round(2 / DT); k++) {
      c = stepCombat(c, sub, false, DT, world);
      for (const t of c.targets) expect(t.pos).toEqual(targetPos(spec(t.id), c.t));
    }
    for (const t of c.targets) {
      const moved = dist(t.pos, start.find((s) => s.id === t.id)!.pos);
      if (t.kind === 'drone') expect(moved).toBeGreaterThan(10);
      else expect(moved).toBe(0);
    }
  });
});

describe('missiles never enter Marineville (phase 2, L2)', () => {
  const mouth = world.marineville.tunnelMouth;
  const coast = world.landmarks.find((l) => l.id === 'marineville')!;
  const door = coast.colliders.find((c) => c.kind === 'box' && c.min.z === COAST_Z - 6)!;
  // stepCombat is always given the door as solid; this world without it shows the face rule holds on its own.
  const doorless: Env = {
    ...world,
    landmarks: world.landmarks.map((l) => (l === coast ? { ...l, colliders: l.colliders.filter((c) => c !== door) } : l)),
  };
  const neverInside = (seen: Vec3[]) => expect(Math.min(...seen.map((p) => p.z), Infinity)).toBeGreaterThanOrEqual(COAST_Z);

  it('9. a missile fired from the sea at the mouth detonates at the face, with the door shut and without it', () => {
    const sea = subAt({ ...mouth, z: mouth.z + 60 }, NORTH);
    const shut = fireUntilDetonation(initialCombatState(world), sea);
    expect(shut.detonation!.z).toBeCloseTo(COAST_Z + T.missileRadius, 9); // on the door
    neverInside(shut.seen);

    const open = fireUntilDetonation(initialCombatState(world), sea, 3, doorless);
    expect(open.detonation).not.toBeNull();
    expect(open.detonation!.z).toBeCloseTo(COAST_Z, 9); // at the crossing
    expect(open.detonation!.x).toBeCloseTo(mouth.x, 9);
    expect(open.detonation!.y).toBeCloseTo(mouth.y, 9);
    neverInside(open.seen);
  });

  it('9. a sub pressed against the shut door, launch point already past it: detonates at the crossing, z ≈ −1100', () => {
    const pressed = subAt({ ...mouth, z: COAST_Z + T.hullRadius }, NORTH);
    expect(pressed.pos.z - T.missileNoseOffset).toBeLessThan(COAST_Z - 12); // the nose's launch point is behind the slab
    for (const env of [world, doorless]) {
      const c = stepCombat(initialCombatState(world), pressed, true, DT, env);
      expect(c.missiles).toEqual([]);
      expect(c.detonations).toHaveLength(1);
      expect(c.detonations[0]!.z).toBeCloseTo(COAST_Z, 9);
      expect(c.detonations[0]!.x).toBeCloseTo(mouth.x, 9);
      expect(c.cooldown).toBe(T.missileCooldown); // it still counts as a launch
    }
    // Pitched and yawed off the axis, the crossing is where the launch line meets the face.
    const skew = subAt({ x: mouth.x + 2, y: mouth.y - 1, z: COAST_Z + T.hullRadius }, 10 * DEG, 5 * DEG);
    const hit = stepCombat(initialCombatState(world), skew, true, DT, world).detonations[0]!;
    expect(hit.z).toBeCloseTo(COAST_Z, 9);
    const f = forwardOf(skew.yaw, skew.pitch);
    const s = (skew.pos.z - COAST_Z) / -f.z;
    expect(hit.x).toBeCloseTo(skew.pos.x + f.x * s, 9);
    expect(hit.y).toBeCloseTo(skew.pos.y + f.y * s, 9);
  });

  it('a nose past the slab anywhere along the cliff detonates at the face, as phase 1\'s deep rock did', () => {
    const c = stepCombat(initialCombatState(world), subAt({ x: 300, y: -40, z: COAST_Z + T.hullRadius }, NORTH), true, DT, world);
    expect(c.missiles).toEqual([]);
    expect(c.detonations[0]).toMatchObject({ x: 300, y: -40 });
    expect(c.detonations[0]!.z).toBeCloseTo(COAST_Z, 9);
  });

  it('over the clifftop the face rule does not apply (phase 1: missiles may cross the land above the cliff)', () => {
    const high = subAt({ x: 300, y: CLIFF_TOP + 10, z: COAST_Z + 30 }, NORTH, 0, 0, 'airborne');
    const { seen } = fireUntilDetonation(initialCombatState(world), high, 1);
    expect(Math.min(...seen.map((p) => p.z))).toBeLessThan(COAST_Z - 20);
  });
});

function deepFreeze<V>(o: V): V {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const value of Object.values(o)) deepFreeze(value);
  }
  return o;
}
