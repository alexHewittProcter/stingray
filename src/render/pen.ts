import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import type { LaunchState } from '../sim/launch';
import type { Interior } from '../sim/world';
import { ROOMS } from '../sim/rooms';
import { type Cradle, createCradle } from './cradle';
import { cameraIndoors, indoorAmount, makeInteriorMaterial } from './indoors';
import { Parts, bar, box, place, rod } from './parts';
import { portsOf } from './shaft';
import {
  WALL_TILE_M, ceilingTexture, clockTexture, doorTexture, floorTexture, grilleTexture, hazardTexture, stencilTexture,
  wallTexture,
} from './pen-textures';
import { WATER_GLSL, displayVector } from './water-look';

// Pen 3 (phase 2, L6), after 04_PEN_3_LAUNCH: a tall hall of grey panelled concrete round a still pool, with an
// upper walkway and railings, wall brackets, pipes, clocks, a gantry, rows of round ceiling lamps, quays at the
// waterline and the round tunnel opening low in the south wall. Built in world coordinates from L1's pen box.
//
// The shell — walls, floor, ceiling and the tunnel collar — is tagged userData.interiorShell: the render test
// checks every one of its vertices sits on or outside the interior volume (what you see is what you hit). Dressing
// inside the hall (quays, walkway, pipes) is not solid; the hull centre is kept 4 m off the walls (L1).
//
// Lighting: every material here is an interior material (indoors.ts) — lit by the pen's own lamps and ambient,
// never by the sun or sky, and without caustics. The lamps live outside the culled hall so the scene's light count
// never changes (which would recompile every material); they are simply dark while the camera is outside.

/** Render layer for what the pool reflects: the hall, the cradle, the craft and the lights. */
export const PEN_LAYER = 1;

const TUNNEL_OPENING_RADIUS = 13.5; // a little over the 13 m bore: the centreline's last segment is not quite square to the wall
const COLLAR_DEPTH = 2.5;
const WALKWAY = { y: 8.5, depth: 3, thick: 0.35 };
const QUAY = { top: 0.6, depth: 2.2, bottom: -1.5 };
const LAMP_INTENSITY = 300; // candela, each of the four hall lamps
const LAMP_Y = 11;
const SPOT_INTENSITY = 900;
const AMBIENT = 0.55;

export interface PenView {
  /** Interpolated cradle travel, 0 raised … 1 lowered. */
  cradle: number;
  clamps: LaunchState['clamps'];
  /** The drawn craft's heading. */
  craftYaw: number;
  /** Dock guidance (T6): off, or on the way home near the cradle — 'ready' when a lock would be accepted. */
  guide?: 'off' | 'on' | 'ready';
}

export interface Pen {
  /** Add this to the scene: the hall (culled from outside) and the pen's lamps (always present). */
  readonly root: THREE.Group;
  /** The hall itself: shell, dressing, cradle and pool. Hidden while the camera is outside Marineville. */
  readonly hall: THREE.Group;
  readonly cradle: Cradle;
  /** Let an object (the craft) show in the pool's reflection. */
  reflect(object: THREE.Object3D): void;
  update(camera: THREE.Camera, view: PenView, dtSeconds: number, timeSeconds: number): void;
  snap(view: PenView): void;
}

// ---- Materials ----

const lambert = (colour: number, name: string, extra: THREE.MeshLambertMaterialParameters = {}) =>
  makeInteriorMaterial(new THREE.MeshLambertMaterial({ color: colour, name, ...extra }));
const phong = (colour: number, name: string, shininess = 50, extra: THREE.MeshPhongMaterialParameters = {}) =>
  makeInteriorMaterial(new THREE.MeshPhongMaterial({ color: colour, name, shininess, specular: 0x555555, ...extra }));
/** Self-lit: lamp faces, screens. */
const glow = (r: number, g: number, b: number, name: string) => {
  const m = new THREE.MeshBasicMaterial({ name });
  m.color.setRGB(r, g, b);
  return m;
};

// ---- The shell ----

/** A vertical wall quad from floor to ceiling, start → end, its face toward (end − start) × up. */
function wallQuad(x0: number, z0: number, x1: number, z1: number, floorY: number, ceilingY: number): THREE.BufferGeometry {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    x0, floorY, z0, x1, floorY, z1, x1, ceilingY, z1, x0, ceilingY, z0,
  ], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, len / WALL_TILE_M, 0, len / WALL_TILE_M, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

/** The south wall with the round tunnel opening, facing north (−Z) into the hall. */
function southWall(interior: Interior): THREE.BufferGeometry {
  const { min, max } = interior.pen;
  const end = interior.tunnel.centreline[interior.tunnel.centreline.length - 1]!;
  const shape = new THREE.Shape();
  shape.moveTo(min.x, min.y);
  shape.lineTo(max.x, min.y);
  shape.lineTo(max.x, max.y);
  shape.lineTo(min.x, max.y);
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(end.x, end.y, TUNNEL_OPENING_RADIUS, 0, Math.PI * 2, false);
  shape.holes.push(hole);
  const g = new THREE.ShapeGeometry(shape, 64);
  // ShapeGeometry faces +Z; turn it to face −Z (x → −x, so mirror the shape's x first to keep it in place).
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setXYZ(i, x, y, max.z);
    uv.setXY(i, (max.x - x) / WALL_TILE_M, (y - min.y) / (max.y - min.y));
  }
  // Flip the winding so the face points −Z.
  const index = g.index!;
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i + 1);
    index.setX(i + 1, index.getX(i + 2));
    index.setX(i + 2, a);
  }
  g.computeVertexNormals();
  return g;
}

function buildShell(interior: Interior): THREE.Group {
  const { min, max } = interior.pen;
  const width = max.x - min.x;
  const length = max.z - min.z;
  const midZ = (min.z + max.z) / 2;
  const shell = new THREE.Group();
  shell.name = 'pen-shell';

  const wallMap = wallTexture(min.y, max.y);
  const walls = lambert(0xffffff, 'pen-walls', { map: wallMap });
  if (!wallMap) walls.color.set(0x8d8a80);
  const wallParts = new Parts();
  wallParts.add(walls,
    wallQuad(min.x, max.z, min.x, min.z, min.y, max.y), // west, facing +X
    wallQuad(max.x, min.z, max.x, max.z, min.y, max.y), // east, facing −X
    wallQuad(min.x, min.z, max.x, min.z, min.y, max.y), // north, facing +Z
    southWall(interior),
  );

  const floorMap = floorTexture();
  if (floorMap) floorMap.repeat.set(width / 8, length / 8);
  const floor = new THREE.PlaneGeometry(width, length);
  floor.rotateX(-Math.PI / 2);
  floor.translate(0, min.y, midZ);
  wallParts.add(lambert(floorMap ? 0xffffff : 0x5a6560, 'pen-floor', { map: floorMap }), floor);

  const ceilingMap = ceilingTexture();
  if (ceilingMap) ceilingMap.repeat.set(width / 6, length / 6);
  // Phase 4 (D3): the ceiling is open at Troy's port (render/shaft.ts draws the port, its collar and flange over the
  // cut, and the tube's annulus above it) — the chair passes through it. A shape in world x/z with the hole, laid flat
  // facing down, its UVs as the plane's were (u along x, v along z, 0…1 over the hall).
  const troysPort = portsOf(ROOMS, interior).troy;
  const outline = new THREE.Shape([
    new THREE.Vector2(min.x, min.z), new THREE.Vector2(max.x, min.z), new THREE.Vector2(max.x, max.z), new THREE.Vector2(min.x, max.z),
  ]);
  outline.holes.push(new THREE.Path().absarc(troysPort.x, troysPort.z, troysPort.radius + 0.04, 0, Math.PI * 2, true));
  const ceiling = new THREE.ShapeGeometry(outline, 32);
  ceiling.rotateX(Math.PI / 2);
  ceiling.translate(0, max.y, 0);
  const ceilingPos = ceiling.getAttribute('position') as THREE.BufferAttribute;
  const ceilingUv = ceiling.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < ceilingPos.count; i++) ceilingUv.setXY(i, (ceilingPos.getX(i) - min.x) / width, (ceilingPos.getZ(i) - min.z) / length);
  wallParts.add(lambert(ceilingMap ? 0xffffff : 0x3d3f3f, 'pen-ceiling', { map: ceilingMap }), ceiling);

  // A short collar of bore behind the opening, square to the wall; the tunnel (T4) carries on from it.
  const end = interior.tunnel.centreline[interior.tunnel.centreline.length - 1]!;
  const collar = new THREE.CylinderGeometry(TUNNEL_OPENING_RADIUS, TUNNEL_OPENING_RADIUS, COLLAR_DEPTH, 64, 1, true);
  collar.rotateX(Math.PI / 2);
  collar.translate(end.x, end.y, max.z + COLLAR_DEPTH / 2);
  wallParts.add(lambert(0x4a504e, 'pen-collar', { side: THREE.BackSide }), collar);

  const built = wallParts.build('pen-shell');
  for (const mesh of built.children) mesh.userData.interiorShell = true;
  shell.add(built);
  return shell;
}

// ---- Dressing ----

interface Mats {
  steel: THREE.Material; rail: THREE.Material; silver: THREE.Material; paint: THREE.Material; concrete: THREE.Material;
  red: THREE.Material; yellow: THREE.Material; copper: THREE.Material; recess: THREE.Material; lamp: THREE.Material;
  white: THREE.Material; cabinet: THREE.Material;
}

/** Wall-local frame: `along` metres from the wall's start, `out` metres into the hall, at height y. */
interface Wall {
  start: THREE.Vector2;
  dir: THREE.Vector2; // along the wall
  inward: THREE.Vector2;
  length: number;
}

function walls(interior: Interior): Record<'west' | 'east' | 'north' | 'south', Wall> {
  const { min, max } = interior.pen;
  const w = (sx: number, sz: number, ex: number, ez: number, ix: number, iz: number): Wall => {
    const start = new THREE.Vector2(sx, sz);
    const d = new THREE.Vector2(ex - sx, ez - sz);
    const length = d.length();
    return { start, dir: d.normalize(), inward: new THREE.Vector2(ix, iz), length };
  };
  return {
    // Each runs left to right as seen from inside the hall.
    west: w(min.x, max.z, min.x, min.z, 1, 0),
    east: w(max.x, min.z, max.x, max.z, -1, 0),
    north: w(min.x, min.z, max.x, min.z, 0, 1),
    south: w(max.x, max.z, min.x, max.z, 0, -1),
  };
}

const at = (wall: Wall, along: number, out: number, y: number) => ({
  x: wall.start.x + wall.dir.x * along + wall.inward.x * out,
  y,
  z: wall.start.y + wall.dir.y * along + wall.inward.y * out,
});
/** Yaw that turns a piece's local +Z to face into the hall from this wall. */
const facing = (wall: Wall) => Math.atan2(wall.inward.x, wall.inward.y);

function buildDressing(interior: Interior, m: Mats): { group: THREE.Group; lampSpots: THREE.Vector3[] } {
  const { min, max } = interior.pen;
  const W = walls(interior);
  const all = [W.west, W.north, W.east, W.south];
  const parts = new Parts();
  const group = new THREE.Group();
  group.name = 'pen-dressing';

  // Quays at the waterline along every wall (the south one stops short of the tunnel opening's crown).
  for (const wall of all) {
    const bottom = wall === W.south ? -0.3 : QUAY.bottom;
    const mid = at(wall, wall.length / 2, QUAY.depth / 2, (QUAY.top + bottom) / 2);
    parts.add(m.concrete, box(wall.length, QUAY.top - bottom, QUAY.depth, mid, facing(wall)));
    // A dark kerb line along the quay's lip.
    parts.add(m.steel, box(wall.length, 0.12, 0.25, at(wall, wall.length / 2, QUAY.depth - 0.1, QUAY.top + 0.06), facing(wall)));
    // Bollards and ladders down into the pool.
    for (let a = 8; a < wall.length - 4; a += 13) {
      parts.add(m.steel, rod(at(wall, a, QUAY.depth - 0.6, QUAY.top), at(wall, a, QUAY.depth - 0.6, QUAY.top + 0.7), 0.28, 0.22, 10));
    }
    for (let a = 15; a < wall.length - 10; a += 31) {
      for (const side of [-0.35, 0.35]) {
        parts.add(m.rail, rod(at(wall, a + side, QUAY.depth + 0.1, -3.5), at(wall, a + side, QUAY.depth + 0.1, QUAY.top + 1), 0.05, 0.05, 6));
      }
      for (let y = -3; y < QUAY.top; y += 0.4) parts.add(m.rail, box(0.7, 0.05, 0.05, at(wall, a, QUAY.depth + 0.1, y), facing(wall)));
    }
  }

  // The upper walkway round all four walls, with its railing and the struts under it.
  const posts: THREE.Vector3[] = [];
  for (const wall of all) {
    parts.add(m.steel, box(wall.length, WALKWAY.thick, WALKWAY.depth, at(wall, wall.length / 2, WALKWAY.depth / 2, WALKWAY.y), facing(wall)));
    parts.add(m.paint, box(wall.length - 2 * WALKWAY.depth, 0.5, 0.12, at(wall, wall.length / 2, WALKWAY.depth, WALKWAY.y - 0.1), facing(wall)));
    const railStart = WALKWAY.depth;
    const railEnd = wall.length - WALKWAY.depth;
    for (const h of [0.55, 1.1]) {
      parts.add(m.rail, box(railEnd - railStart, 0.07, 0.07, at(wall, (railStart + railEnd) / 2, WALKWAY.depth - 0.1, WALKWAY.y + h), facing(wall)));
    }
    for (let a = railStart; a <= railEnd + 1e-6; a += 2) {
      const p = at(wall, a, WALKWAY.depth - 0.1, WALKWAY.y + 0.55);
      posts.push(new THREE.Vector3(p.x, p.y, p.z));
    }
    for (let a = 4; a < wall.length - 2; a += 6) {
      parts.add(m.steel, bar(at(wall, a, 0.1, WALKWAY.y - 2.6), at(wall, a, WALKWAY.depth - 0.3, WALKWAY.y - 0.2), 0.18));
    }
    // A pipe run along the wall just under the brackets, and a moulding course above the walkway.
    parts.add(m.rail, rod(at(wall, 0.2, 0.35, 15.3), at(wall, wall.length - 0.2, 0.35, 15.3), 0.16, 0.16, 8));
    parts.add(m.concrete, box(wall.length, 0.25, 0.3, at(wall, wall.length / 2, 0.15, 16.0), facing(wall)));
    // The angled brackets high on the walls (the series' "W" shapes): a doubled triangle standing off the wall.
    for (let a = 7; a < wall.length - 3; a += 10.5) {
      const top = at(wall, a, 0.05, 19.4);
      const low = at(wall, a + 0.9, 0.05, 16.6);
      const tip = at(wall, a + 0.2, 1.7, 18.4);
      parts.add(m.steel, bar(top, tip, 0.2), bar(low, tip, 0.2), bar(top, low, 0.2));
      const top2 = at(wall, a + 0.7, 0.05, 19.4);
      const tip2 = at(wall, a + 0.9, 1.2, 18.0);
      parts.add(m.steel, bar(top2, tip2, 0.14), bar(low, tip2, 0.14));
    }
  }
  const postMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), m.rail, posts.length);
  const mat4 = new THREE.Matrix4();
  posts.forEach((p, i) => postMesh.setMatrixAt(i, mat4.makeTranslation(p.x, p.y, p.z)));
  postMesh.name = 'pen-railing-posts';
  group.add(postMesh);

  // ---- The west wall: the hero wall seen behind the craft from the pen camera ----
  const west = W.west;
  const stencil = stencilTexture(['PEN 3', 'STINGRAY']);
  if (stencil) {
    const decal = new THREE.Mesh(
      place(new THREE.PlaneGeometry(10, 5), at(west, 30, 0.04, 12.4), { y: facing(west) }),
      lambert(0xffffff, 'pen-stencil', { map: stencil, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    decal.name = 'pen-stencil';
    group.add(decal);
  }
  // A clock with its lamp, over a grey switch cabinet, framed by pipework (TV_launch_cradle_detail).
  const clockMat = lambert(0xffffff, 'pen-clock', { map: clockTexture() });
  const clocks: THREE.BufferGeometry[] = [];
  const clockAt = (wall: Wall, along: number, y: number, r = 0.75) => {
    clocks.push(place(new THREE.CircleGeometry(r, 24), at(wall, along, 0.42, y), { y: facing(wall) }));
    parts.add(m.steel, place(new THREE.CylinderGeometry(r + 0.12, r + 0.12, 0.35, 24), at(wall, along, 0.22, y), { x: Math.PI / 2, y: facing(wall) }));
  };
  clockAt(west, 47, 15.0);
  parts.add(m.cabinet, box(1.8, 2.8, 0.5, at(west, 47, 0.25, 12.0), facing(west)));
  parts.add(m.red, box(0.5, 0.7, 0.2, at(west, 46.1, 0.55, 12.6), facing(west)));
  parts.add(m.recess, box(0.9, 1.1, 0.1, at(west, 47.2, 0.52, 12.4), facing(west)));
  for (const a of [40, 58]) parts.add(m.rail, rod(at(west, a, 0.3, WALKWAY.y + 0.3), at(west, a, 0.3, 15.3), 0.12, 0.12, 8));
  parts.add(m.rail, rod(at(west, 40, 0.3, 14.0), at(west, 58, 0.3, 14.0), 0.1, 0.1, 8));
  parts.add(m.rail, rod(at(west, 50, 0.3, 14.0), at(west, 50, 0.3, 11.0), 0.1, 0.1, 8));
  parts.add(m.cabinet, box(0.6, 0.6, 0.3, at(west, 50, 0.3, 10.8), facing(west)));
  // A door onto the walkway.
  const doorMat = lambert(0xffffff, 'pen-door', { map: doorTexture() });
  const doors: THREE.BufferGeometry[] = [];
  const doorAt = (wall: Wall, along: number) => {
    doors.push(place(new THREE.PlaneGeometry(1.4, 2.6), at(wall, along, 0.08, WALKWAY.y + 1.5), { y: facing(wall) }));
    parts.add(m.paint, box(1.8, 3.0, 0.12, at(wall, along, 0.03, WALKWAY.y + 1.6), facing(wall)));
  };
  doorAt(west, 53);
  // Silver tanks standing on the quay under the walkway, a column of small lamps, a grille, lifebuoys, canisters.
  for (let i = 0; i < 4; i++) {
    const base = at(west, 9 + i * 2.1, 1.0, QUAY.top);
    parts.add(m.silver, rod(base, { ...base, y: WALKWAY.y - 0.6 }, 0.85, 0.85, 20));
    parts.add(m.silver, place(new THREE.SphereGeometry(0.85, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), { ...base, y: WALKWAY.y - 0.6 }));
  }
  const smallLamps: THREE.Vector3[] = [];
  for (let k = 0; k < 7; k++) {
    const p = at(west, 21, 0.15, 1.6 + k * 0.85);
    smallLamps.push(new THREE.Vector3(p.x, p.y, p.z));
  }
  const grilles: THREE.BufferGeometry[] = [];
  grilles.push(place(new THREE.PlaneGeometry(4, 1.5), at(west, 27, 0.05, 3.2), { y: facing(west) }));
  for (const a of [25, 72]) {
    const centre = at(west, a, 0.25, 2.6);
    const ring = new THREE.TorusGeometry(0.55, 0.14, 8, 20);
    parts.add(m.white, place(ring, centre, { y: facing(west) }));
    for (let q = 0; q < 4; q++) {
      parts.add(m.red, place(new THREE.TorusGeometry(0.55, 0.15, 8, 5, Math.PI / 4), centre, { z: q * Math.PI / 2, y: facing(west) }));
    }
  }
  for (let k = 0; k < 6; k++) {
    const base = at(west, 31 + k * 0.7, 0.6, QUAY.top);
    parts.add(m.red, rod(base, { ...base, y: QUAY.top + 0.9 }, 0.25, 0.25, 10));
  }
  // A monitor on the lower wall.
  parts.add(m.cabinet, box(2.2, 1.3, 0.4, at(west, 40, 0.2, 3.6), facing(west)));
  const screens: THREE.BufferGeometry[] = [place(new THREE.PlaneGeometry(1.6, 0.8), at(west, 40, 0.42, 3.6), { y: facing(west) })];
  // Pipes running down the lower wall into the pool.
  for (const a of [5, 17.5, 63, 88]) parts.add(m.rail, rod(at(west, a, 0.3, -6), at(west, a, 0.3, WALKWAY.y - 0.2), 0.14, 0.14, 8));

  // The gantry: a lattice tower against the west wall at the north end, and a truss arm out over the pool
  // carrying a lamp head (TV_pen3_stingray_elevated, right of frame).
  const towerA = 82;
  const towerB = 90;
  parts.add(m.recess, box(towerB - towerA + 1, 13.5, 0.1, at(west, (towerA + towerB) / 2, 0.06, QUAY.top + 6.75), facing(west)));
  for (const a of [towerA, towerB]) {
    for (const out of [0.4, 3.2]) parts.add(m.steel, bar(at(west, a, out, QUAY.top), at(west, a, out, 15.5), 0.35));
  }
  for (let y = QUAY.top; y < 15; y += 3.6) {
    for (const out of [0.4, 3.2]) {
      parts.add(m.steel, bar(at(west, towerA, out, y), at(west, towerB, out, y + 3.6), 0.14));
      parts.add(m.steel, bar(at(west, towerA, out, y + 3.6), at(west, towerB, out, y), 0.14));
    }
    parts.add(m.steel, bar(at(west, towerA, 0.4, y), at(west, towerA, 3.2, y), 0.18));
    parts.add(m.steel, bar(at(west, towerB, 0.4, y), at(west, towerB, 3.2, y), 0.18));
  }
  const armRoot = (towerA + towerB) / 2;
  const armLen = 21;
  const chord = (out: number, y: number) => at(west, armRoot, out, y);
  for (const dz of [-0.9, 0.9]) {
    const off = (p: { x: number; y: number; z: number }) => ({ x: p.x, y: p.y, z: p.z + dz });
    parts.add(m.steel, bar(off(chord(3.2, 12.4)), off(chord(armLen, 13.0)), 0.25));
    parts.add(m.steel, bar(off(chord(3.2, 14.2)), off(chord(armLen, 14.0)), 0.25));
    for (let o = 3.2; o < armLen - 1; o += 1.8) {
      parts.add(m.steel, bar(off(chord(o, 12.4 + (o / armLen) * 0.6)), off(chord(o + 1.8, 14.2 - ((o + 1.8) / armLen) * 0.2)), 0.1));
    }
  }
  for (let o = 3.2; o < armLen; o += 3.6) parts.add(m.steel, box(0.12, 0.12, 1.8, chord(o, 14.1)));
  // The lamp head at the arm's tip: a cage, a lamp drum with its lit face down toward the cradle, two red lights.
  const tip = chord(armLen + 0.6, 13.2);
  parts.add(m.steel, box(1.8, 1.6, 2.2, tip));
  parts.add(m.cabinet, rod({ ...tip, y: tip.y - 0.6 }, { ...tip, y: tip.y - 1.5 }, 0.8, 0.95, 16));
  const lampFaces: THREE.BufferGeometry[] = [place(new THREE.CircleGeometry(0.85, 16), { ...tip, y: tip.y - 1.52 }, { x: Math.PI / 2 })];
  parts.add(m.red, place(new THREE.SphereGeometry(0.22, 8, 6), { x: tip.x - 1.0, y: tip.y + 0.2, z: tip.z - 0.6 }));
  parts.add(m.red, place(new THREE.SphereGeometry(0.22, 8, 6), { x: tip.x - 1.0, y: tip.y + 0.2, z: tip.z + 0.6 }));
  // A round lamp on top of the tower.
  const beacon = at(west, armRoot, 1.8, 16.3);
  parts.add(m.steel, box(1.2, 0.6, 1.2, { ...beacon, y: beacon.y - 0.5 }));
  lampFaces.push(place(new THREE.CircleGeometry(0.6, 16), at(west, armRoot, 2.45, 16.3), { y: facing(west) }));
  parts.add(m.steel, place(new THREE.CylinderGeometry(0.72, 0.72, 0.6, 16), at(west, armRoot, 2.1, 16.3), { x: Math.PI / 2, y: facing(west) }));

  // Phase 4 (D3): phase 2's hanging copper rod and its two ceiling drums (its guess at the series' pole) are gone — the
  // real pole and its two ports are render/shaft.ts's, over the seat.

  // ---- The north wall: a service bay behind the walkway, pipes, a clock ----
  const north = W.north;
  parts.add(m.recess, box(14, 6, 0.1, at(north, 32, 0.06, WALKWAY.y + 3), facing(north)));
  parts.add(m.paint, box(15, 0.5, 0.4, at(north, 32, 0.2, WALKWAY.y + 6.2), facing(north)));
  for (const a of [24.5, 39.5]) parts.add(m.paint, box(0.5, 6.4, 0.4, at(north, a, 0.2, WALKWAY.y + 3.1), facing(north)));
  clockAt(north, 45, 14.6, 0.65);
  for (const a of [10, 11.2, 12.4]) parts.add(m.silver, rod(at(north, a, 0.8, QUAY.top), at(north, a, 0.8, 17.5), 0.4, 0.4, 12));
  grilles.push(place(new THREE.PlaneGeometry(5, 1.8), at(north, 50, 0.05, 3.4), { y: facing(north) }));
  doorAt(north, 54);

  // ---- The east wall (behind the pen camera): tanks, pipework, a door, a clock ----
  const east = W.east;
  for (let i = 0; i < 3; i++) {
    const base = at(east, 70 + i * 2.1, 1.0, QUAY.top);
    parts.add(m.silver, rod(base, { ...base, y: WALKWAY.y - 0.6 }, 0.85, 0.85, 20));
  }
  doorAt(east, 40);
  clockAt(east, 55, 14.8);
  parts.add(m.cabinet, box(1.6, 2.4, 0.5, at(east, 55, 0.25, 12.0), facing(east)));
  for (const a of [12, 47, 90]) parts.add(m.rail, rod(at(east, a, 0.3, -6), at(east, a, 0.3, 15.3), 0.14, 0.14, 8));
  grilles.push(place(new THREE.PlaneGeometry(4, 1.5), at(east, 30, 0.05, 3.2), { y: facing(east) }));
  const stencilEast = stencilTexture(['PEN 3']);
  if (stencilEast) {
    const decal = new THREE.Mesh(
      place(new THREE.PlaneGeometry(7, 3.5), at(east, 80, 0.04, 12.6), { y: facing(east) }),
      lambert(0xffffff, 'pen-stencil-east', { map: stencilEast, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    group.add(decal);
  }

  // ---- The south wall: the tunnel opening's frame, hazard-banded, and its number ----
  const end = interior.tunnel.centreline[interior.tunnel.centreline.length - 1]!;
  const frame = new THREE.RingGeometry(TUNNEL_OPENING_RADIUS, TUNNEL_OPENING_RADIUS + 2.2, 64, 1);
  parts.add(m.steel, place(frame, { x: end.x, y: end.y, z: max.z - 0.06 }, { y: Math.PI }));
  const hazard = hazardTexture();
  if (hazard) hazard.repeat.set(48, 1);
  const band = new THREE.Mesh(
    place(new THREE.TorusGeometry(TUNNEL_OPENING_RADIUS + 0.35, 0.4, 6, 96), { x: end.x, y: end.y, z: max.z - 0.25 }),
    lambert(hazard ? 0xffffff : 0xd9a91e, 'pen-hazard', { map: hazard }),
  );
  band.name = 'pen-tunnel-band';
  group.add(band);
  const three = stencilTexture(['3']);
  if (three) {
    const decal = new THREE.Mesh(
      place(new THREE.PlaneGeometry(6, 3), { x: end.x, y: end.y + TUNNEL_OPENING_RADIUS + 4, z: max.z - 0.04 }, { y: Math.PI }),
      lambert(0xffffff, 'pen-stencil-3', { map: three, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    group.add(decal);
  }
  // Amber lamps either side of the opening, just under the surface.
  const amber: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    amber.push(place(new THREE.SphereGeometry(0.35, 10, 6), { x: end.x + sx * (TUNNEL_OPENING_RADIUS + 3.4), y: -2.2, z: max.z - 0.3 }));
  }

  // ---- Ceiling lamps: rows of round lamps in dark housings ----
  const lampSpots: THREE.Vector3[] = [];
  for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 9; k++) {
      const x = -21 + row * 14 + (k % 2) * 3;
      const z = min.z + 7 + k * 12 + (row % 2) * 4;
      lampSpots.push(new THREE.Vector3(x, max.y, z));
    }
  }
  const housing = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.85, 0.95, 0.5, 16), m.steel, lampSpots.length);
  const face = new THREE.InstancedMesh(place(new THREE.CircleGeometry(0.62, 16), { x: 0, y: 0, z: 0 }, { x: Math.PI / 2 }), m.lamp, lampSpots.length);
  lampSpots.forEach((p, i) => {
    housing.setMatrixAt(i, mat4.makeTranslation(p.x, p.y - 0.25, p.z));
    face.setMatrixAt(i, mat4.makeTranslation(p.x, p.y - 0.52, p.z));
  });
  housing.name = 'pen-lamp-housings';
  face.name = 'pen-lamp-faces';
  group.add(housing, face);

  const smallLampMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), m.lamp, smallLamps.length);
  smallLamps.forEach((p, i) => smallLampMesh.setMatrixAt(i, mat4.makeTranslation(p.x, p.y, p.z)));
  group.add(smallLampMesh);

  const extras = new Parts();
  extras.add(clockMat, ...clocks);
  extras.add(doorMat, ...doors);
  const grilleMap = grilleTexture();
  extras.add(lambert(grilleMap ? 0xffffff : 0x26292a, 'pen-grille', { map: grilleMap }), ...grilles);
  extras.add(glow(0.35, 0.75, 0.6, 'pen-screen'), ...screens);
  extras.add(m.lamp, ...lampFaces);
  extras.add(glow(3.0, 1.6, 0.4, 'pen-amber'), ...amber);
  group.add(parts.build('pen-dressing'), extras.build('pen-dressing-painted'));
  return { group, lampSpots };
}

// ---- The pool's surface ----

const POOL_SHADER = {
  name: 'PenPool',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uWater: { value: new THREE.Vector3(0.05, 0.16, 0.2) },
    uHorizon: { value: new THREE.Vector3(0.05, 0.23, 0.33) },
    uVisibility: { value: 400 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec3 uWater;
    uniform vec3 uHorizon;
    uniform float uVisibility;
    varying vec4 vUv;
    varying vec3 vWorld;
    ${WATER_GLSL}

    // A still pool: only the faintest slow wrinkle, enough to break a perfect mirror.
    vec2 wrinkle(vec2 p, float t) {
      return vec2(
        sin(p.x * 0.9 + t * 0.55 + sin(p.y * 0.37 + t * 0.2) * 2.0) + sin(p.y * 1.7 - t * 0.4),
        cos(p.y * 0.8 - t * 0.5 + sin(p.x * 0.41) * 2.0) + cos(p.x * 1.5 + t * 0.35)
      );
    }

    void main() {
      vec3 ray = vWorld - cameraPosition;
      float dist = length(ray);
      vec3 v = ray / dist;
      vec2 w = wrinkle(vWorld.xz, uTime);
      vec3 colour;
      float alpha = 1.0;
      if (cameraPosition.y >= vWorld.y) {
        // From above: the hall reflected, darkened by the water's own colour where the view looks steeply down.
        vec4 uv = vUv;
        uv.xy += w * 0.0007 * uv.w;
        vec3 reflected = texture2DProj(tDiffuse, uv).rgb;
        // T8: lamp lenses and glows in the reflection came back as big foam-white ovals near the camera. Above a
        // dim hall level the reflection rolls off hard, so lamps read as soft glints on still, dark water.
        vec3 over = max(reflected - 0.3, 0.0);
        reflected = min(reflected, vec3(0.3)) + 0.12 * (1.0 - exp(-over * 0.8));
        float cosi = abs(v.y);
        float fresnel = 0.3 + 0.7 * pow(1.0 - cosi, 4.0);
        colour = mix(uWater * 0.35, reflected * 0.9, fresnel);
        alpha = mix(0.72, 1.0, fresnel);
      } else {
        // From below: the lit hall through Snell's window, glinting where the faint ripples catch the lamps;
        // outside the window the surface mirrors the dark pool. Then the water between, as everything under it.
        vec3 n = normalize(vec3(w.x * 0.012, 1.0, w.y * 0.012));
        vec3 out_ = refract(v, -n, 1.333);
        float a = sin(vWorld.x * 0.9 + w.x * 2.0 + uTime * 0.5) * sin(vWorld.z * 0.7 + w.y * 2.0 - uTime * 0.4);
        float b = sin(vWorld.x * 2.3 - w.y * 1.5 - uTime * 0.7) * sin(vWorld.z * 2.9 + w.x * 1.5 + uTime * 0.6);
        float glint = pow(max(a * 0.6 + b * 0.4, 0.0), 3.0);
        colour = uWater * 0.4 + vec3(0.05, 0.07, 0.07) * glint;
        if (dot(out_, out_) > 0.0) {
          float fresnel = 0.02 + 0.98 * pow(1.0 - out_.y, 5.0);
          vec3 hall = vec3(0.16, 0.17, 0.16) + vec3(0.35, 0.34, 0.3) * glint;
          colour = mix(hall, colour, fresnel);
        }
        colour = swThroughWater(colour, ray, uHorizon, uVisibility);
      }
      gl_FragColor = vec4(colour, alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

function createPool(interior: Interior): { mesh: Reflector; time: { value: number }; water: THREE.Vector3 } {
  const { min, max } = interior.pen;
  const pixelRatio = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio, 2);
  const width = typeof window === 'undefined' ? 512 : Math.round(window.innerWidth * pixelRatio * 0.5);
  const height = typeof window === 'undefined' ? 512 : Math.round(window.innerHeight * pixelRatio * 0.5);
  const geometry = new THREE.PlaneGeometry(max.x - min.x, max.z - min.z);
  const mesh = new Reflector(geometry, { textureWidth: width, textureHeight: height, clipBias: 0.003, shader: POOL_SHADER, multisample: 4 });
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((min.x + max.x) / 2, interior.pen.waterY, (min.z + max.z) / 2);
  mesh.name = 'pen-pool';
  const material = mesh.material as THREE.ShaderMaterial;
  material.side = THREE.DoubleSide;
  material.transparent = true;
  mesh.renderOrder = -1;
  // The reflection sees only the pen's layer, without the water fog (the mirrored camera sits under the surface,
  // where the fog would turn the reflected hall into deep water).
  mesh.camera.layers.set(PEN_LAYER);
  const reflect = mesh.onBeforeRender;
  let lightsShared = false;
  const horizon = material.uniforms.uHorizon!.value as THREE.Vector3;
  const visibility = material.uniforms.uVisibility as { value: number };
  mesh.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
    // The water seen from under the surface takes the scene's water fog, as every other material does.
    if (scene.fog instanceof THREE.Fog) {
      displayVector(scene.fog.color, horizon);
      visibility.value = scene.fog.far;
    }
    if (camera.position.y < interior.pen.waterY) return;
    if (!lightsShared) {
      // Same lights in both passes, so no material needs a second program for the reflection.
      scene.traverse((o) => { if ((o as THREE.Light).isLight) o.layers.enable(PEN_LAYER); });
      lightsShared = true;
    }
    const fog = scene.fog;
    scene.fog = null;
    reflect.call(mesh, renderer, scene, camera, geometry, material, group);
    scene.fog = fog;
  };
  return { mesh, time: material.uniforms.uTime as { value: number }, water: material.uniforms.uWater!.value as THREE.Vector3 };
}

// ---- Assembly ----

export function createPen(interior: Interior): Pen {
  const root = new THREE.Group();
  root.name = 'pen';
  const hall = new THREE.Group();
  hall.name = 'pen-hall';
  root.add(hall);

  const mats: Mats = {
    steel: lambert(0x4d5257, 'pen-steel'),
    rail: phong(0x9ea2a2, 'pen-rail', 40),
    silver: phong(0xc9cdd0, 'pen-silver', 80, { specular: 0x999999 }),
    paint: lambert(0xd6d3c8, 'pen-paint'),
    concrete: lambert(0xc4c1b6, 'pen-quay'),
    red: lambert(0xb5301d, 'pen-red'),
    yellow: lambert(0xd8a722, 'pen-yellow'),
    copper: phong(0xb06f45, 'pen-copper', 60),
    recess: lambert(0x15181a, 'pen-recess'),
    lamp: glow(3.2, 3.05, 2.7, 'pen-lamp'),
    white: lambert(0xe9e6dc, 'pen-white'),
    cabinet: lambert(0x7d8286, 'pen-cabinet'),
  };

  hall.add(buildShell(interior));
  const dressing = buildDressing(interior, mats);
  hall.add(dressing.group);

  const cradle = createCradle(interior);
  hall.add(cradle.head, cradle.pedestal);

  const pool = createPool(interior);
  hall.add(pool.mesh);

  // The pen's lamps: four over the hall, a spot from the ceiling onto the cradle, and the hall's ambient.
  const { min, max } = interior.pen;
  const midZ = (min.z + max.z) / 2;
  const lamps: THREE.PointLight[] = [];
  for (const x of [-15, 15]) {
    for (const z of [midZ + 26, midZ - 26]) {
      const lamp = new THREE.PointLight(0xffefd6, 0, 0, 2);
      // Floods hung at walkway height light the walls and the pool evenly; the ceiling stays dark, as in the series.
      lamp.position.set(x, LAMP_Y, z);
      lamps.push(lamp);
    }
  }
  const c = interior.cradle;
  const spot = new THREE.SpotLight(0xfff3df, 0, 0, 0.55, 0.7, 2);
  spot.position.set(c.pos.x + 9, max.y - 1, c.pos.z + 4);
  spot.target.position.set(c.pos.x, c.raisedY, c.pos.z);
  const ambient = new THREE.AmbientLight(0xd8dce0, 0);
  const lights = new THREE.Group();
  lights.name = 'pen-lights';
  lights.add(...lamps, spot, spot.target, ambient);
  root.add(lights);

  hall.traverse((o) => o.layers.enable(PEN_LAYER));
  lights.traverse((o) => o.layers.enable(PEN_LAYER));
  // The reflector must not see itself.
  pool.mesh.layers.disable(PEN_LAYER);

  return {
    root,
    hall,
    cradle,
    reflect(object) {
      object.traverse((o) => o.layers.enable(PEN_LAYER));
    },
    update(camera, view, dt, time) {
      const indoors = cameraIndoors(camera.position);
      hall.visible = indoors;
      for (const lamp of lamps) lamp.intensity = indoors ? LAMP_INTENSITY : 0;
      spot.intensity = indoors ? SPOT_INTENSITY : 0;
      ambient.intensity = AMBIENT * indoorAmount(camera.position);
      if (!indoors) return;
      cradle.update(view.cradle, view.clamps, view.craftYaw, dt);
      cradle.guide(view.guide ?? 'off', time);
      spot.target.position.y = cradle.head.position.y;
      pool.time.value = time;
    },
    snap(view) {
      cradle.snap(view.cradle, view.clamps, view.craftYaw);
    },
  };
}

/** For the render test: every shell mesh (walls, floor, ceiling, collar) under a root. */
export function shellMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.userData.interiorShell) out.push(o);
  });
  return out;
}
