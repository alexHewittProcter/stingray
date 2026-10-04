import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Collider } from '../sim/world';
import { noise3 } from './noise';
import { cardGeometry, coralGeometry, moundGeometry, plantMaterials } from './plants';
import { strataRock, type StrataOptions } from './rocks';
import { SMALL_RANGE, onSceneryFrame } from './sway';

// The natural landmarks' parts: stratified rock that fills a box collider from the inside, growth that settles on
// its ledges, the wreck's hull and the kelp forest. Solid meshes are tagged `userData.solid` so a test can check
// every one of their vertices against the colliders.

type Box = Extract<Collider, { kind: 'box' }>;

/** A stratified rock filling a box collider: every slab is cut inward from the box, never out of it. */
export function strataBox(
  c: Box,
  seed: number,
  options: Omit<StrataOptions, 'halfX' | 'halfZ' | 'bottom' | 'top'>,
  ledges?: THREE.Vector3[],
): THREE.Mesh {
  const cx = (c.min.x + c.max.x) / 2;
  const cz = (c.min.z + c.max.z) / 2;
  const local: THREE.Vector3[] = [];
  const geometry = strataRock({
    ...options,
    halfX: (c.max.x - c.min.x) / 2,
    halfZ: (c.max.z - c.min.z) / 2,
    bottom: c.min.y,
    top: c.max.y,
    ledges: local,
  });
  const mesh = new THREE.Mesh(geometry, plantMaterials(seed).rock);
  mesh.position.set(cx, 0, cz);
  mesh.userData.solid = true;
  for (const p of local) ledges?.push(p.add(mesh.position));
  return mesh;
}

// ---- Growth: instanced plants placed one by one, built into one mesh per kind ----

export type GrowthKind = 'mound' | 'coral' | 'frond' | 'bush' | 'kelp';

const GROWTH_COLOURS: Record<GrowthKind, number[]> = {
  mound: [0xa08a3c, 0x7d7f35, 0x5d7a34, 0x8a8434, 0x6f8a3a],
  coral: [0xd85a2c, 0xc7453a, 0xe07a3a, 0xd9735a],
  frond: [0x6f9a3a, 0x8aa83a, 0x4f7f2f, 0x9cae48],
  bush: [0x3fb7a8, 0x58c2c9, 0x8fc6d8, 0x6fd0c0],
  kelp: [0x5f7a2a, 0x6f6a26, 0x4f6a28, 0x7a7a30, 0x56602a],
};

/** Kelp is built 30 m tall: an instance's scale is its height over 30. */
export const KELP_HEIGHT = 30;

export class Growth {
  /** Keyed by kind, and whether it hangs (hanging pieces need their normals turned over). */
  private readonly items = new Map<`${GrowthKind}:${boolean}`, Array<{ m: THREE.Matrix4; c: THREE.Color }>>();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();

  constructor(private readonly seed: number, private readonly rand: () => number) {}

  /** Plants one piece at `at` (its root), `size` (x/z, y) in metres; `flip` hangs it from a ceiling. */
  place(kind: GrowthKind, at: THREE.Vector3, width: number, height: number, flip = false, tilt = 0.15): void {
    const rand = this.rand;
    this.e.set((rand() - 0.5) * tilt + (flip ? Math.PI : 0), rand() * Math.PI * 2, (rand() - 0.5) * tilt);
    const m = new THREE.Matrix4().compose(at.clone(), this.q.setFromEuler(this.e), new THREE.Vector3(width, height, width));
    const palette = GROWTH_COLOURS[kind];
    const c = new THREE.Color(palette[Math.floor(rand() * palette.length)] ?? palette[0]!).multiplyScalar(0.8 + rand() * 0.4);
    const key = `${kind}:${flip}` as const;
    const list = this.items.get(key) ?? [];
    list.push({ m, c });
    this.items.set(key, list);
  }

  /** Scatters growth over ledge points: mostly moss, some coral and fronds, sized to sit on a ledge. */
  onLedges(points: THREE.Vector3[], share: number, scale = 1): void {
    const rand = this.rand;
    for (const p of points) {
      if (rand() > share) continue;
      const roll = rand();
      const at = p.clone().setY(p.y - 0.15);
      if (roll < 0.55) this.place('mound', at, (1 + rand() * 1.6) * scale, (0.6 + rand() * 0.8) * scale);
      else if (roll < 0.75) this.place('coral', at, (0.7 + rand() * 0.7) * scale, (0.8 + rand() * 0.9) * scale);
      else if (roll < 0.92) this.place('frond', at, (0.6 + rand() * 0.6) * scale, (0.6 + rand() * 0.6) * scale);
      else this.place('bush', at, (0.5 + rand() * 0.4) * scale, (0.5 + rand() * 0.4) * scale);
    }
  }

  build(): THREE.Group {
    const group = new THREE.Group();
    const mats = plantMaterials(this.seed);
    const geometry: Record<GrowthKind, () => THREE.BufferGeometry> = {
      mound: () => moundGeometry(this.seed),
      coral: () => coralGeometry(this.seed),
      frond: () => cardGeometry({ count: 5, width: 0.9, height: 2.5, segments: 4, lean: 0.5, curl: 0.6, seed: this.seed + 1 }),
      bush: () => cardGeometry({ count: 4, width: 3, height: 3, segments: 3, lean: 0.15, seed: this.seed }),
      kelp: () => kelpGeometry(this.seed),
    };
    const material: Record<GrowthKind, THREE.Material> = {
      mound: mats.mound,
      coral: mats.coral,
      frond: mats.frond,
      bush: mats.bush,
      kelp: mats.kelp,
    };
    const meshes: THREE.InstancedMesh[] = [];
    for (const [key, list] of this.items) {
      const [kind, hanging] = key.split(':') as [GrowthKind, string];
      const shape = geometry[kind]();
      // Turned upside down, a plant's up-facing normals would face the dark below; turn them back to the light.
      if (hanging === 'true') flipNormalsY(shape);
      const mesh = new THREE.InstancedMesh(shape, material[kind], list.length);
      list.forEach((item, i) => {
        mesh.setMatrixAt(i, item.m);
        mesh.setColorAt(i, item.c);
      });
      mesh.computeBoundingSphere();
      // Small plants vanish into the murk sooner than tall kelp.
      mesh.userData.range = kind === 'kelp' ? Infinity : SMALL_RANGE;
      meshes.push(mesh);
      group.add(mesh);
    }
    onSceneryFrame((camera, range) => {
      for (const mesh of meshes) {
        const sphere = mesh.boundingSphere!;
        mesh.visible = sphere.center.distanceTo(camera.position) - sphere.radius < Math.min(range, mesh.userData.range as number);
      }
    });
    return group;
  }
}

function flipNormalsY(geometry: THREE.BufferGeometry): void {
  const normal = geometry.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < normal.count; i++) normal.setY(i, -normal.getY(i));
}

/** A kelp plant: two long ribbons, twisting as they rise, KELP_HEIGHT tall. */
export function kelpGeometry(seed: number): THREE.BufferGeometry {
  return cardGeometry({ count: 2, width: 1.7, height: KELP_HEIGHT, segments: 14, lean: 0.06, curl: 1.5, twist: 2.4, seed: seed + 7 });
}

// ---- The wreck: a submarine on its side in the silt, holed, with its plating gone to rust ----

const RUSTS = [0x9a5a38, 0x8a5234, 0xa8643e, 0x7a4c34, 0x946a48].map((h) => new THREE.Color(h));
const SEAM = new THREE.Color(0x2c2420);
const WRECK_MOSS = new THREE.Color(0x5f6f34);

export interface WreckFrame {
  /** The hull's axis runs along x through this point. */
  axisY: number;
  /** Half the hull's length, and its largest radius. */
  halfLength: number;
  radius: number;
  /** Roll about the axis, radians (a sunk hull lists). */
  roll: number;
  /** Centre x of the conning tower, relative to the hull's middle. */
  towerX: number;
}

/** Hull radius at u in [-1 (stern), 1 (bow)]: a rounded bow, a long parallel middle, a tapering stern. */
function hullRadius(u: number): number {
  if (u > 0.55) return Math.sqrt(Math.max(0, 1 - ((u - 0.55) / 0.45) ** 2)) * 0.97 + 0.03;
  if (u < -0.35) return 0.25 + 0.75 * Math.sqrt(Math.max(0, 1 - ((u + 0.35) / 0.65) ** 2));
  return 1;
}

const RINGS = 48;
const BREACH_ANGLE = 0.35; // radians up from the +z flank's horizontal
const AROUND = 28;
const PLATE_RINGS = 4; // rings per plate along the hull
const PLATE_AROUND = 4;

/**
 * The hull as a lofted tube (local frame: axis along x at y = 0), with plate-by-plate rust colours, darker seams,
 * moss on its upper side, and a breach on its +z flank where the plating is torn away. Double-sided, so the
 * breach shows the dark inside.
 */
export function hullGeometry(f: WreckFrame, seed: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const at = (i: number, j: number) => {
    const u = (i / RINGS) * 2 - 1;
    const a = (j / AROUND) * Math.PI * 2;
    const r = f.radius * hullRadius(u);
    // A flat deck casing along the top: the section is clipped there.
    const y = Math.min(Math.sin(a) * r, f.radius * 0.88);
    return new THREE.Vector3(u * f.halfLength, y, Math.cos(a) * r);
  };
  const plate = (i: number, j: number) => {
    const pi = Math.floor(i / PLATE_RINGS);
    const pj = Math.floor(j / PLATE_AROUND);
    return RUSTS[Math.abs(Math.imul(pi * 7 + 3, pj * 13 + 5) ^ seed) % RUSTS.length]!;
  };
  // The breach: plating gone over part of the +z flank, with a ragged edge.
  const breached = (i: number, j: number) => {
    const u = (i + 0.5) / RINGS;
    const a = ((j + 0.5) / AROUND) * Math.PI * 2;
    const flank = Math.abs(a - BREACH_ANGLE);
    const ragged = 0.08 * noise3(i * 0.9, j * 0.9, 0, seed);
    return u > 0.34 + ragged && u < 0.54 - ragged && flank < 0.6 + ragged * 3;
  };
  const colour = (i: number, j: number, p: THREE.Vector3) => {
    const c = plate(i, j).clone();
    if (i % PLATE_RINGS === 0 || j % PLATE_AROUND === 0) c.lerp(SEAM, 0.45);
    const up = p.y / f.radius;
    if (up > 0.5) c.lerp(WRECK_MOSS, (up - 0.5) * 1.4 * noise3(p.x * 0.3, p.z * 0.3, 1, seed));
    return c.multiplyScalar(0.85 + 0.3 * noise3(p.x * 0.8, p.y * 0.8, p.z * 0.8, seed + 1));
  };
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < AROUND; j++) {
      if (breached(i, j)) continue;
      const quad = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)] as const;
      const cs = [colour(i, j, quad[0]), colour(i + 1, j, quad[1]), colour(i + 1, j + 1, quad[2]), colour(i, j + 1, quad[3])];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        positions.push(quad[k]!.x, quad[k]!.y, quad[k]!.z);
        colors.push(cs[k]!.r, cs[k]!.g, cs[k]!.b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/** Bared frames across the breach: arcs of rib at the plate seams. */
export function ribsGeometry(f: WreckFrame): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 17; i <= 26; i += 2) {
    const u = (i / RINGS) * 2 - 1;
    const r = f.radius * hullRadius(u) - 0.25;
    const arc = new THREE.TorusGeometry(r, 0.22, 4, 12, 1.6);
    arc.rotateZ(BREACH_ANGLE - 0.8); // centred on the breach, then turned so +x becomes the hull's +z flank
    arc.rotateY(-Math.PI / 2);
    arc.translate(u * f.halfLength, 0, 0);
    parts.push(arc);
  }
  // The deck beams inside, seen through the hole.
  const beam = new THREE.BoxGeometry(f.halfLength * 0.36, 0.4, f.radius * 1.6);
  beam.translate(f.halfLength * -0.12, -f.radius * 0.35, 0);
  parts.push(beam);
  return mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
}

/** The conning tower: a rounded fin with a cap, two periscope stubs and the hydroplanes on its flanks. */
export function towerGeometry(height: number, length: number, width: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const fin = new THREE.CylinderGeometry(1, 1, height, 16, 3);
  fin.scale(length / 2, 1, width / 2);
  fin.translate(0, height / 2, 0);
  parts.push(fin);
  const cap = new THREE.CylinderGeometry(1, 1, 0.3, 16);
  cap.scale(length / 2 - 0.2, 1, width / 2 - 0.1);
  cap.translate(0, height + 0.15, 0);
  parts.push(cap);
  for (const [x, h] of [[-0.4, 2.2], [0.6, 1.4]] as const) {
    const scope = new THREE.CylinderGeometry(0.16, 0.2, h, 6);
    scope.translate(x, height + h / 2, 0);
    parts.push(scope);
  }
  const plane = new THREE.BoxGeometry(1.4, 0.18, width + 2.6);
  plane.translate(0.8, height * 0.62, 0);
  parts.push(plane);
  return mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
}
