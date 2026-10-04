import * as THREE from 'three';
import { COAST_Z, type World } from '../sim/world';
import { fbm2 } from './noise';
import { boulderGeometry, cardGeometry, coralGeometry, moundGeometry, plantMaterials } from './plants';
import { mulberry32 } from './random';
import { SMALL_RANGE, onSceneryFrame } from './sway';

// The dressing on the bed: boulder clusters with growth around their feet, and fields of moss, coral, bushes and
// fronds in patches. None of it is solid, so all of it stays under the hull's clearance above the bed.
// It is cut into square cells, each drawn only when the camera is near enough to see it through the murk.

const CELL = 100; // m
const NEAR = 70; // m: closer than this a cell draws its detailed shapes
const CENTRE = { x: 0, z: -600 }; // the landmarks' cluster: dressing thins with distance from it
const REGION = { minX: -1700, maxX: 1700, minZ: COAST_Z + 5, maxZ: 1700 };
/** Tallest any free-standing piece may reach above the lowest bed under it: under the hull's 4 m clearance. */
export const DRESSING_MAX_HEIGHT = 3.5;

type KindName = 'boulderA' | 'boulderB' | 'boulderC' | 'mound' | 'coral' | 'bush' | 'frond';
const BOULDERS: KindName[] = ['boulderA', 'boulderB', 'boulderC'];

const MOUND_COLOURS = [0xa08a3c, 0x8a8434, 0x6d7d34, 0x5d7a34, 0xb08a40, 0x7f6f30, 0x4f6a2c];
const CORAL_COLOURS = [0xd85a2c, 0xc7453a, 0xe07a3a, 0xd9735a, 0xb83a2e];
const BUSH_COLOURS = [0x3fb7a8, 0x58c2c9, 0x8fc6d8, 0x6fd0c0, 0x9ad8e6];
const FROND_COLOURS = [0x6f9a3a, 0x8aa83a, 0x4f7f2f, 0x9cae48, 0x5f8a34];

/** Instances per square metre, before patchiness and depth thin them. */
const DENSITY = { mound: 0.03, coral: 0.005, bush: 0.0045, frond: 0.016, clusters: 0.00014 };

interface Instance {
  kind: KindName;
  matrix: THREE.Matrix4;
  color: THREE.Color;
}

export function createDressing(world: World): THREE.Group {
  const group = new THREE.Group();
  const mats = plantMaterials(world.seed);
  const seed = world.seed;
  const near: Record<KindName, THREE.BufferGeometry> = {
    boulderA: boulderGeometry(seed ^ 0xa1),
    boulderB: boulderGeometry(seed ^ 0xb2),
    boulderC: boulderGeometry(seed ^ 0xc3),
    mound: moundGeometry(seed),
    coral: coralGeometry(seed),
    bush: cardGeometry({ count: 4, width: 3, height: 3, segments: 3, lean: 0.15, seed }),
    frond: cardGeometry({ count: 5, width: 0.9, height: 2.5, segments: 4, lean: 0.5, curl: 0.6, seed: seed + 1 }),
  };
  const far: Partial<Record<KindName, THREE.BufferGeometry>> = {
    mound: moundGeometry(seed, 'far'),
    coral: coralGeometry(seed, 'far'),
    bush: cardGeometry({ count: 2, width: 3, height: 3, segments: 1, lean: 0.15, seed }),
    frond: cardGeometry({ count: 3, width: 0.9, height: 2.5, segments: 2, lean: 0.5, curl: 0.6, seed: seed + 1 }),
  };
  const materials: Record<KindName, THREE.Material> = {
    boulderA: mats.rock,
    boulderB: mats.rock,
    boulderC: mats.rock,
    mound: mats.mound,
    coral: mats.coral,
    bush: mats.bush,
    frond: mats.frond,
  };

  const blocked = solidFootprints(world);
  const reach = footprints(near);
  const cells: Cell[] = [];
  for (let cz = REGION.minZ; cz < REGION.maxZ; cz += CELL) {
    for (let cx = REGION.minX; cx < REGION.maxX; cx += CELL) {
      const rand = mulberry32(seed ^ Math.imul(Math.round(cx), 73856093) ^ Math.imul(Math.round(cz), 19349663));
      const instances = dressCell(world, cx, cz, Math.min(CELL, REGION.maxZ - cz), rand, blocked, reach);
      if (instances.length === 0) continue;
      const cell: Cell = { group: new THREE.Group(), centre: new THREE.Vector3(), near: [], far: [] };
      for (const kind of Object.keys(near) as KindName[]) {
        const mine = instances.filter((i) => i.kind === kind);
        if (mine.length === 0) continue;
        const mesh = new THREE.InstancedMesh(near[kind], materials[kind], mine.length);
        mine.forEach((inst, i) => {
          mesh.setMatrixAt(i, inst.matrix);
          mesh.setColorAt(i, inst.color);
        });
        mesh.computeBoundingSphere();
        cell.group.add(mesh);
        const farGeometry = far[kind];
        if (!farGeometry) continue;
        // The distant version shares the instances; only one of the two is drawn at a time.
        const distant = new THREE.InstancedMesh(farGeometry, materials[kind], mine.length);
        distant.instanceMatrix = mesh.instanceMatrix;
        distant.instanceColor = mesh.instanceColor;
        distant.boundingSphere = mesh.boundingSphere;
        cell.group.add(distant);
        cell.near.push(mesh);
        cell.far.push(distant);
      }
      const mid = { x: cx + CELL / 2, z: cz + CELL / 2 };
      cell.centre.set(mid.x, world.seabedHeight(mid.x, mid.z), mid.z);
      cells.push(cell);
      group.add(cell.group);
    }
  }

  const corner = CELL * 0.75; // a cell's corner can be this far from its centre
  onSceneryFrame((camera, range) => {
    for (const cell of cells) {
      const d = cell.centre.distanceTo(camera.position) - corner;
      cell.group.visible = d < range;
      if (!cell.group.visible) continue;
      const close = d < NEAR;
      const small = d < Math.min(range, SMALL_RANGE);
      for (const mesh of cell.near) mesh.visible = close;
      for (const mesh of cell.far) mesh.visible = small && !close;
    }
  });
  return group;
}

interface Cell {
  group: THREE.Group;
  centre: THREE.Vector3;
  /** Plant meshes with a detailed and a distant version, index-matched. */
  near: THREE.InstancedMesh[];
  far: THREE.InstancedMesh[];
}

type Footprint = { minX: number; maxX: number; minZ: number; maxZ: number };

/** The ground under solid landmarks: nothing is planted where it would be hidden inside rock or hull. */
function solidFootprints(world: World): Footprint[] {
  const out: Footprint[] = [];
  for (const l of world.landmarks) {
    if (!l.solid || l.id === 'marineville') continue;
    for (const c of l.colliders) {
      if (c.kind === 'box') out.push({ minX: c.min.x + 1, maxX: c.max.x - 1, minZ: c.min.z + 1, maxZ: c.max.z - 1 });
    }
  }
  return out;
}

const inside = (blocked: Footprint[], x: number, z: number) =>
  blocked.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);

/** The lowest bed within `r` of (x, z): a piece standing there never rises more than its height above the bed. */
function lowestBed(world: World, x: number, z: number, r: number): number {
  const h = world.seabedHeight;
  let low = h(x, z);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    low = Math.min(low, h(x + dx * r, z + dz * r));
  }
  return low;
}

/** Ground that falls away more than this across a piece's footprint is too steep to plant: it shows bare rock. */
const STEEP_DROP = 1.2; // m

/** Half the widest horizontal extent of each shape at unit scale, so placement can read the ground it covers. */
function footprints(shapes: Record<KindName, THREE.BufferGeometry>): Record<KindName, number> {
  const out = {} as Record<KindName, number>;
  for (const kind of Object.keys(shapes) as KindName[]) {
    shapes[kind].computeBoundingBox();
    const b = shapes[kind].boundingBox!;
    out[kind] = Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z);
  }
  return out;
}

/** 1 on the shelf, thinning to 0.2 on the trench floor. */
function depthFactor(bed: number): number {
  return THREE.MathUtils.clamp((bed + 280) / 150, 0.2, 1);
}

function dressCell(
  world: World,
  cx: number,
  cz: number,
  depth: number,
  rand: () => number,
  blocked: Footprint[],
  reach: Record<KindName, number>,
): Instance[] {
  const out: Instance[] = [];
  const fromCentre = Math.hypot(cx + CELL / 2 - CENTRE.x, cz + depth / 2 - CENTRE.z);
  const area = CELL * depth * (1 - 0.6 * THREE.MathUtils.smoothstep(fromCentre, 900, 1600));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const pick = (list: number[]) => new THREE.Color(list[Math.floor(rand() * list.length)] ?? list[0]!);

  const add = (kind: KindName, x: number, z: number, scale: THREE.Vector3, tilt: number, yOffset: number, color: THREE.Color) => {
    if (inside(blocked, x, z) || z < REGION.minZ) return;
    const low = lowestBed(world, x, z, reach[kind] * Math.max(scale.x, scale.z));
    if (world.seabedHeight(x, z) - low > STEEP_DROP) return;
    q.setFromEuler(e.set((rand() - 0.5) * tilt, rand() * Math.PI * 2, (rand() - 0.5) * tilt));
    const y = low + yOffset;
    out.push({ kind, matrix: m.compose(p.set(x, y, z), q, scale).clone(), color });
  };
  const mound = (x: number, z: number, big: number) => {
    const w = (0.7 + rand() * 1.1) * big; // the cushion is about 2.4 units across
    const h = Math.min(w * (1.1 + rand() * 0.6), 2.6);
    add('mound', x, z, new THREE.Vector3(w, h, w * (0.7 + rand() * 0.6)), 0.1, -0.05, pick(MOUND_COLOURS).multiplyScalar(0.8 + rand() * 0.4));
  };
  const coral = (x: number, z: number) => {
    const k = 0.9 + rand() * 1.1;
    add('coral', x, z, new THREE.Vector3(k, Math.min(k * (1.1 + rand() * 0.4), 3), k), 0.2, -0.1, pick(CORAL_COLOURS).multiplyScalar(0.85 + rand() * 0.3));
  };
  const bush = (x: number, z: number) => {
    const k = 0.8 + rand() * 0.35; // 3 m card
    add('bush', x, z, new THREE.Vector3(k, k, k), 0.15, -0.1, pick(BUSH_COLOURS).multiplyScalar(0.85 + rand() * 0.3));
  };
  const frond = (x: number, z: number) => {
    const k = 0.7 + rand() * 0.65; // 2.5 m card
    add('frond', x, z, new THREE.Vector3(k, k, k), 0.2, -0.05, pick(FROND_COLOURS).multiplyScalar(0.8 + rand() * 0.4));
  };

  // Boulder clusters, each ringed with growth.
  const clusters = Math.round(area * DENSITY.clusters * (0.5 + rand()));
  for (let c = 0; c < clusters; c++) {
    const ox = cx + rand() * CELL;
    const oz = cz + rand() * depth;
    if (depthFactor(world.seabedHeight(ox, oz)) < 0.5 && rand() < 0.6) continue;
    const rocks = 2 + Math.floor(rand() * 6);
    const spread = 5 + rand() * 12;
    for (let r = 0; r < rocks; r++) {
      const a = rand() * Math.PI * 2;
      const d = r === 0 ? 0 : spread * Math.sqrt(rand());
      const x = ox + Math.cos(a) * d;
      const z = oz + Math.sin(a) * d;
      // The cluster's heart is a broad, flat-topped slab; its neighbours are smaller and rounder.
      const w = r === 0 ? 4 + rand() * 5 : 1.4 + rand() * 2.8;
      // Unit top is 1: the scale.y is the height above the lowest bed, tilt included.
      const h = Math.min(w * (0.45 + rand() * 0.5), DRESSING_MAX_HEIGHT - 0.5);
      const kind = BOULDERS[Math.floor(rand() * BOULDERS.length)] ?? 'boulderA';
      add(kind, x, z, new THREE.Vector3(w, h, w * (0.6 + rand() * 0.5)), 0.12, 0, new THREE.Color(0xffffff).multiplyScalar(0.85 + rand() * 0.3));
      const ring = 2 + Math.floor(rand() * 4);
      for (let g = 0; g < ring; g++) {
        const b = rand() * Math.PI * 2;
        const gx = x + Math.cos(b) * w * (0.8 + rand() * 0.6);
        const gz = z + Math.sin(b) * w * (0.8 + rand() * 0.6);
        const roll = rand();
        if (roll < 0.5) mound(gx, gz, 0.8);
        else if (roll < 0.7) coral(gx, gz);
        else if (roll < 0.85) bush(gx, gz);
        else frond(gx, gz);
      }
    }
  }

  // Fields in patches: each kind has its own patch pattern, so colours gather the way the series' beds do.
  const field = (count: number, patchSeed: number, place: (x: number, z: number) => void) => {
    for (let i = 0; i < count; i++) {
      const x = cx + rand() * CELL;
      const z = cz + rand() * depth;
      const patch = fbm2(x / 70, z / 70, world.seed + patchSeed, 3);
      const keep = THREE.MathUtils.clamp((patch - 0.32) * 3, 0, 1) * depthFactor(world.seabedHeight(x, z));
      if (rand() < keep) place(x, z);
    }
  };
  // Moss grows in drifts: each spot that takes is a knot of two or three overlapping cushions.
  field(Math.round(area * DENSITY.mound), 11, (x, z) => {
    const knot = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < knot; k++) mound(x + (rand() - 0.5) * 4, z + (rand() - 0.5) * 4, 1);
  });
  field(Math.round(area * DENSITY.coral), 23, coral);
  field(Math.round(area * DENSITY.bush), 37, bush);
  field(Math.round(area * DENSITY.frond), 41, frond);
  return out;
}
