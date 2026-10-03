// Missiles and targets: pure, deterministic, advanced only by stepCombat at a fixed dt.
// Hit tests are swept along each step's travel, so a fast missile never steps through anything.

import { distanceTo, type Collider } from './collide';
import { forwardOf, type SubState } from './sub';
import { TUNING as T } from './tuning';
import type { Vec3 } from './vec3';
import { targetPos, type Env, type TargetSpec, type World } from './world';

export interface Missile {
  pos: Vec3;
  vel: Vec3;
  /** Seconds since launch. */
  age: number;
}

export interface Target {
  id: string;
  kind: 'buoy' | 'drone';
  pos: Vec3;
  radius: number;
  hp: number;
  alive: boolean;
}

export interface CombatState {
  /** Seconds since start; drone positions are a pure function of it. */
  t: number;
  /** Seconds until the next missile can launch; ≤ 0 means ready. */
  cooldown: number;
  missiles: Missile[];
  targets: Target[];
  /** Points that exploded during this step only, for the renderer. */
  detonations: Vec3[];
}

export function initialCombatState(world: World): CombatState {
  return {
    t: 0,
    cooldown: 0,
    missiles: [],
    targets: world.targets.map((spec) => ({
      id: spec.id,
      kind: spec.kind,
      pos: targetPos(spec, 0),
      radius: spec.radius,
      hp: spec.hp,
      alive: true,
    })),
    detonations: [],
  };
}

export function targetsLeft(c: CombatState): number {
  return c.targets.filter((target) => target.alive).length;
}

export function stepCombat(c: CombatState, sub: SubState, fire: boolean, dt: number, env: Env): CombatState {
  const t = c.t + dt;
  const before = c.targets;
  const targets = before.map((target) => moveTarget(target, env.targets, t));

  let cooldown = Math.max(c.cooldown - dt, 0);
  const flying = c.missiles.slice();
  if (fire && cooldown <= 0) {
    flying.push(launch(sub));
    cooldown = T.missileCooldown;
  }

  const missiles: Missile[] = [];
  const detonations: Vec3[] = [];
  for (const m of flying) {
    const end = add(m.pos, scale(m.vel, dt));
    const hit = firstHit(m.pos, end, before, targets, env);
    if (hit) {
      detonations.push(hit.point);
      if (hit.target !== null) damage(targets, hit.target);
      continue;
    }
    const age = m.age + dt;
    if (age < T.missileLifetime) missiles.push({ pos: end, vel: { ...m.vel }, age });
  }
  return { t, cooldown, missiles, targets, detonations };
}

// ---- Launch ----

/** One missile from the nose, along the heading, at the sub's speed along its nose plus missileSpeed. */
function launch(sub: SubState): Missile {
  const f = forwardOf(sub.yaw, sub.pitch);
  // Signed speed along the nose: even in reverse the missile leaves the nose at missileSpeed relative to the hull.
  const speed = dot(sub.vel, f) + T.missileSpeed;
  return { pos: add(sub.pos, scale(f, T.missileNoseOffset)), vel: scale(f, speed), age: 0 };
}

// ---- Targets ----

function moveTarget(target: Target, specs: readonly TargetSpec[], t: number): Target {
  const spec = specs.find((s) => s.id === target.id);
  // A destroyed drone stays where it died; buoys never move.
  const pos = target.alive && spec?.loop ? targetPos(spec, t) : { ...target.pos };
  return { ...target, pos };
}

function damage(targets: Target[], index: number): void {
  const hit = targets[index]!;
  const hp = Math.max(hit.hp - 1, 0);
  targets[index] = { ...hit, hp, alive: hp > 0 };
}

// ---- Swept hit tests ----
// Each test returns s in [0, 1]: the fraction of the step's travel at first contact, or null for a miss.

interface Hit {
  point: Vec3;
  /** Index into targets, or null for the seabed or a landmark. */
  target: number | null;
}

function firstHit(from: Vec3, to: Vec3, before: Target[], after: Target[], env: Env): Hit | null {
  let bestS = Infinity;
  let bestTarget: number | null = null;
  // Strictly earlier wins, so on a tie the target tested first keeps the hit.
  const consider = (s: number | null, target: number | null) => {
    if (s !== null && s < bestS) [bestS, bestTarget] = [s, target];
  };

  after.forEach((target, k) => {
    if (target.alive) consider(sweepMoving(from, to, before[k]!.pos, target.pos, target.radius + T.missileRadius), k);
  });
  for (const landmark of env.landmarks) {
    if (!landmark.solid) continue;
    for (const collider of landmark.colliders) consider(sweepCollider(from, to, collider), null);
  }
  consider(sweepSeabed(from, to, env.seabedHeight), null);

  if (bestS === Infinity) return null;
  return { point: lerp(from, to, bestS), target: bestTarget };
}

/**
 * Missile from→to against a sphere whose centre moves c0→c1 over the same step: solved in the
 * target's frame, where the missile's relative path is a straight segment.
 */
function sweepMoving(from: Vec3, to: Vec3, c0: Vec3, c1: Vec3, reach: number): number | null {
  const start = sub(from, c0);
  const rel = sub(sub(to, from), sub(c1, c0));
  return segmentSphere(start, rel, reach);
}

/** First s in [0, 1] with |start + s·d| ≤ reach. */
function segmentSphere(start: Vec3, d: Vec3, reach: number): number | null {
  const c = dot(start, start) - reach * reach;
  if (c <= 0) return 0;
  const a = dot(d, d);
  if (a === 0) return null;
  const b = 2 * dot(start, d);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const s = (-b - Math.sqrt(disc)) / (2 * a);
  return s >= 0 && s <= 1 ? s : null;
}

function sweepCollider(from: Vec3, to: Vec3, c: Collider): number | null {
  if (c.kind === 'sphere') return segmentSphere(sub(from, c.centre), sub(to, from), c.radius + T.missileRadius);
  return segmentBox(from, to, c.min, c.max, T.missileRadius);
}

/** Slab test of the segment against the box grown by r on every side. */
function segmentBox(from: Vec3, to: Vec3, min: Vec3, max: Vec3, r: number): number | null {
  if (distanceTo({ kind: 'box', min, max }, from) <= r) return 0;
  let enter = 0;
  let exit = 1;
  for (const axis of ['x', 'y', 'z'] as const) {
    const lo = min[axis] - r;
    const hi = max[axis] + r;
    const p = from[axis];
    const d = to[axis] - p;
    if (d === 0) {
      if (p < lo || p > hi) return null;
      continue;
    }
    const s1 = (lo - p) / d;
    const s2 = (hi - p) / d;
    enter = Math.max(enter, Math.min(s1, s2));
    exit = Math.min(exit, Math.max(s1, s2));
    if (enter > exit) return null;
  }
  return enter;
}

/** Samples the bed every missileBedProbe metres along the travel, then bisects to the crossing. */
function sweepSeabed(from: Vec3, to: Vec3, bed: (x: number, z: number) => number): number | null {
  const below = (s: number) => {
    const p = lerp(from, to, s);
    return p.y - T.missileRadius <= bed(p.x, p.z);
  };
  if (below(0)) return 0;
  const probes = Math.max(1, Math.ceil(length(sub(to, from)) / T.missileBedProbe));
  for (let k = 1; k <= probes; k++) {
    if (!below(k / probes)) continue;
    let lo = (k - 1) / probes;
    let hi = k / probes;
    for (let pass = 0; pass < T.missileBedRefine; pass++) {
      const mid = (lo + hi) / 2;
      if (below(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }
  return null;
}

// ---- Small arithmetic ----

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const lerp = (a: Vec3, b: Vec3, s: number): Vec3 => add(a, scale(sub(b, a), s));
