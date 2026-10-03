// World frame: right-handed, +Y up, metres, sea surface at y = 0. North is -Z.
// Headings: yaw 0 faces -Z (north); yaw grows counter-clockwise seen from above, so yaw π/2 faces -X (west).
// Immutable data + pure functions, built once by createWorld(seed).

import type { Collider } from './collide';
import { COAST_Z, TRENCH, makeSeabed } from './seabed';
import type { Vec3 } from './vec3';

export type { Collider } from './collide';
export { COAST_Z } from './seabed';

export const FIXED_DT = 1 / 60;

export interface Bounds {
  /** Half the side of the square ocean, centred on the origin: |x|, |z| <= halfSize. */
  halfSize: number;
}

export interface Marineville {
  /** Centre of the tunnel mouth, in the cliff face. */
  tunnelMouth: Vec3;
  /** The heading pointing out of the tunnel into the open sea. */
  tunnelHeading: number;
}

export interface Spawn {
  pos: Vec3;
  yaw: number;
}

export type LandmarkId = 'marineville' | 'arch' | 'stacks' | 'trench' | 'kelp' | 'wreck';

export interface Landmark {
  id: LandmarkId;
  name: string;
  /** A representative point: the mouth, the arch opening's centre, otherwise the bed beneath the landmark. */
  pos: Vec3;
  solid: boolean;
  colliders: Collider[];
}

export interface DroneLoop {
  centre: Vec3;
  radius: number;
  /** m/s along the loop. */
  speed: number;
  /** Angle on the loop at t = 0, radians. */
  phase: number;
}

export interface TargetSpec {
  id: string;
  kind: 'buoy' | 'drone';
  /** Position at t = 0 (a buoy never moves). */
  pos: Vec3;
  radius: number;
  hp: number;
  /** Drones only: the fixed loop they fly. */
  loop?: DroneLoop;
}

export interface World {
  seed: number;
  bounds: Bounds;
  seabedHeight: (x: number, z: number) => number;
  marineville: Marineville;
  landmarks: Landmark[];
  targets: TargetSpec[];
  /** Additive to C1: where the player starts — 60 m outside the mouth, facing away along tunnelHeading. */
  spawn: Spawn;
}

/** C3's Env: the step functions read the world and nothing else. */
export type Env = World;

export const OCEAN_HALF_SIZE = 1500;
export const CLIFF_TOP = 25; // m above the surface

// Phase 2 builds inward from this anchor and must not move it.
export const MARINEVILLE: Marineville = Object.freeze({
  tunnelMouth: Object.freeze({ x: 0, y: -40, z: COAST_Z }),
  tunnelHeading: Math.PI, // out of the cliff = south (+Z)
});

export const SPAWN_DISTANCE = 60;

// The mouth opening in the cliff face, plugged in phase 1 by the shut marine door.
const MOUTH_HALF_WIDTH = 20;
const MOUTH_HALF_HEIGHT = 12;
const DOOR_THICKNESS = 6;
// Land reaches past the bounds so no edge of the cliff is ever exposed.
const LAND_X = OCEAN_HALF_SIZE + 100;
const LAND_NORTH_Z = -OCEAN_HALF_SIZE - 100;
const CLIFF_FOOT_Y = -400;

const box = (min: Vec3, max: Vec3): Collider => ({ kind: 'box', min, max });
const sphere = (centre: Vec3, radius: number): Collider => ({ kind: 'sphere', centre, radius });
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export function createWorld(seed: number): World {
  const seabedHeight = makeSeabed(seed);
  const world: World = {
    seed,
    bounds: { halfSize: OCEAN_HALF_SIZE },
    seabedHeight,
    marineville: MARINEVILLE,
    landmarks: buildLandmarks(seabedHeight),
    targets: buildTargets(),
    spawn: buildSpawn(),
  };
  return deepFreeze(world);
}

/** Where a target is at time t (seconds since the start). Pure; a buoy never moves. */
export function targetPos(target: TargetSpec, t: number): Vec3 {
  const loop = target.loop;
  if (!loop) return { ...target.pos };
  const angle = loop.phase + (loop.speed / loop.radius) * t;
  return {
    x: loop.centre.x + loop.radius * Math.cos(angle),
    y: loop.centre.y,
    z: loop.centre.z + loop.radius * Math.sin(angle),
  };
}

function buildSpawn(): Spawn {
  const { tunnelMouth: m, tunnelHeading: yaw } = MARINEVILLE;
  return {
    pos: { x: m.x - Math.sin(yaw) * SPAWN_DISTANCE, y: m.y, z: m.z - Math.cos(yaw) * SPAWN_DISTANCE },
    yaw,
  };
}

type Bed = (x: number, z: number) => number;

function buildLandmarks(bed: Bed): Landmark[] {
  return [marineville(), arch(bed), stacks(bed), trench(bed), kelp(bed), wreck(bed)];
}

function marineville(): Landmark {
  const m = MARINEVILLE.tunnelMouth;
  const left = m.x - MOUTH_HALF_WIDTH;
  const right = m.x + MOUTH_HALF_WIDTH;
  const bottom = m.y - MOUTH_HALF_HEIGHT;
  const top = m.y + MOUTH_HALF_HEIGHT;
  return {
    id: 'marineville',
    name: 'Marineville cliff and tunnel mouth',
    pos: { ...m },
    solid: true,
    colliders: [
      box(v(-LAND_X, CLIFF_FOOT_Y, LAND_NORTH_Z), v(left, CLIFF_TOP, COAST_Z)), // west of the mouth
      box(v(right, CLIFF_FOOT_Y, LAND_NORTH_Z), v(LAND_X, CLIFF_TOP, COAST_Z)), // east of the mouth
      box(v(left, top, LAND_NORTH_Z), v(right, CLIFF_TOP, COAST_Z)), // above the mouth
      box(v(left, CLIFF_FOOT_Y, LAND_NORTH_Z), v(right, bottom, COAST_Z)), // below the mouth
      box(v(left, bottom, COAST_Z - DOOR_THICKNESS), v(right, top, COAST_Z)), // the shut marine door
    ],
  };
}

// Two pillars and a lintel; the opening between them is 30 m wide and 40 m tall, flown through along z.
export const ARCH = { x: -150, z: -850, openingHalfWidth: 15, openingHeight: 40, pillarWidth: 25, depth: 20, lintel: 15 };

function arch(bed: Bed): Landmark {
  const a = ARCH;
  const floor = bed(a.x, a.z);
  const zMin = a.z - a.depth / 2;
  const zMax = a.z + a.depth / 2;
  const inner = a.openingHalfWidth;
  const outer = inner + a.pillarWidth;
  const spring = floor + a.openingHeight;
  return {
    id: 'arch',
    name: 'Rock arch',
    pos: v(a.x, floor + a.openingHeight / 2, a.z),
    solid: true,
    colliders: [
      box(v(a.x - outer, floor - 10, zMin), v(a.x - inner, spring, zMax)),
      box(v(a.x + inner, floor - 10, zMin), v(a.x + outer, spring, zMax)),
      box(v(a.x - outer, spring, zMin), v(a.x + outer, spring + a.lintel, zMax)),
    ],
  };
}

// A slalom line of square columns, tops 10 m under the surface so a surface run passes over them.
const STACK_TOP = -10;
const STACK_HALF = 7;
const STACKS: Array<[number, number]> = [
  [125, -860], [175, -820], [125, -780], [175, -740], [125, -700], [175, -660],
];

function stacks(bed: Bed): Landmark {
  return {
    id: 'stacks',
    name: 'Sea-stack field',
    pos: v(150, bed(150, -760), -760),
    solid: true,
    colliders: STACKS.map(([x, z]) =>
      box(v(x - STACK_HALF, bed(x, z) - 10, z - STACK_HALF), v(x + STACK_HALF, STACK_TOP, z + STACK_HALF)),
    ),
  };
}

// The trench is terrain (seabed.ts): nothing to collide with but the bed itself.
function trench(bed: Bed): Landmark {
  const x = 50;
  const z = TRENCH.z - 50;
  return { id: 'trench', name: 'The trench', pos: v(x, bed(x, z), z), solid: false, colliders: [] };
}

function kelp(bed: Bed): Landmark {
  return { id: 'kelp', name: 'Kelp forest', pos: v(-250, bed(-250, -600), -600), solid: false, colliders: [] };
}

// A hull lying on the bed, east-west, with its conning tower.
function wreck(bed: Bed): Landmark {
  const x = 100;
  const z = -500;
  const floor = bed(x, z);
  return {
    id: 'wreck',
    name: 'Wreck',
    pos: v(x, floor, z),
    solid: true,
    colliders: [box(v(x - 30, floor - 4, z - 7), v(x + 30, floor + 10, z + 7)), sphere(v(x + 10, floor + 14, z), 6)],
  };
}

const BUOYS: Array<[string, Vec3]> = [
  ['buoy-1', v(0, -30, -900)], // ahead of spawn, 140 m
  ['buoy-2', v(40, -20, -760)], // ahead of spawn, ~285 m
  ['buoy-3', v(-260, -35, -820)], // beside the arch
  ['buoy-4', v(-320, -25, -560)], // over the kelp
  ['buoy-5', v(-300, -160, -230)], // down in the trench
  ['buoy-6', v(180, -50, -470)], // by the wreck
  ['buoy-7', v(420, -60, -300)], // over the trench, mid-water
  ['buoy-8', v(560, -12, -700)], // just under the surface
];

const DRONES: Array<[string, DroneLoop]> = [
  ['drone-1', { centre: v(-60, -30, -700), radius: 60, speed: 10, phase: 0 }],
  ['drone-2', { centre: v(300, -70, -450), radius: 50, speed: 8, phase: Math.PI / 2 }],
  ['drone-3', { centre: v(0, -200, -250), radius: 80, speed: 12, phase: Math.PI }],
  ['drone-4', { centre: v(-300, -45, -980), radius: 60, speed: 9, phase: -Math.PI / 2 }],
];

export const BUOY_RADIUS = 2.5;
export const DRONE_RADIUS = 3;

function buildTargets(): TargetSpec[] {
  const buoys = BUOYS.map(([id, pos]): TargetSpec => ({ id, kind: 'buoy', pos, radius: BUOY_RADIUS, hp: 1 }));
  const drones = DRONES.map(([id, loop]): TargetSpec => {
    const spec: TargetSpec = { id, kind: 'drone', pos: loop.centre, radius: DRONE_RADIUS, hp: 2, loop };
    return { ...spec, pos: targetPos(spec, 0) };
  });
  return [...buoys, ...drones];
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const value of Object.values(o)) deepFreeze(value);
  }
  return o;
}
