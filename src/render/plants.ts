import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noise3 } from './noise';
import { strataRock } from './rocks';
import { addSway } from './sway';
import { bushTexture, frondTexture, groundTextures, kelpTexture } from './textures';
import { mulberry32 } from './random';

// Plant shapes and their materials. Geometry is built in metres with its root at the origin, so it can be
// instanced straight onto the bed; cards are alpha-cut silhouettes that sway in the vertex shader.

// ---- Geometry ----

interface ClumpOptions {
  knobs: number;
  /** Radius of the central knob, and of the ring of smaller knobs around it. */
  core: number;
  ring: number;
  /** How far out the ring sits, and how high its knobs ride (min, range). */
  spread: number;
  lift: [number, number];
  /** Noise roughness of each knob's surface. */
  rough: number;
  /** Icosahedron detail per knob: 1 up close, 0 for the distant version. */
  detail: number;
  seed: number;
}

/** A rounded clump of knobs packed together, flattened at the root: the base of moss mounds and coral heads. */
function clumpGeometry(o: ClumpOptions): THREE.BufferGeometry {
  const rand = mulberry32(o.seed ^ 0xc0a1);
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < o.knobs; k++) {
    const g = mergeVertices(withoutUvNormal(new THREE.IcosahedronGeometry(1, o.detail)));
    const p = g.attributes.position as THREE.BufferAttribute;
    const a = (k / o.knobs) * Math.PI * 2 + rand();
    const centre =
      k === 0
        ? new THREE.Vector3(0, o.lift[0] + o.lift[1], 0)
        : new THREE.Vector3(Math.cos(a) * o.spread, o.lift[0] + rand() * o.lift[1], Math.sin(a) * o.spread);
    const size = k === 0 ? o.core : o.ring * (0.8 + rand() * 0.4);
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      const r = size * (1 - o.rough + 2 * o.rough * noise3(v.x * 2.5 + k * 7, v.y * 2.5, v.z * 2.5, o.seed));
      v.multiplyScalar(r).add(centre);
      p.setXYZ(i, v.x, Math.max(v.y, -0.1), v.z);
    }
    parts.push(g);
  }
  return mergeGeometries(parts)!;
}

/** Close-up shapes, or the cheap distant versions (a few hundred are in view at once). */
export type Lod = 'near' | 'far';

/** A soft cushion of moss: a few broad knobs, low and wide. */
export function moundGeometry(seed: number, lod: Lod = 'near'): THREE.BufferGeometry {
  const near = lod === 'near';
  const g = clumpGeometry({ knobs: near ? 5 : 3, core: 0.7, ring: near ? 0.5 : 0.6, spread: 0.65, lift: [0.1, 0.25], rough: 0.25, detail: near ? 1 : 0, seed });
  return finish(g, 0.9, 0.5);
}

/** A rounded head of coral: tighter, knobblier, standing taller than the moss. */
export function coralGeometry(seed: number, lod: Lod = 'near'): THREE.BufferGeometry {
  const near = lod === 'near';
  const g = clumpGeometry({ knobs: near ? 6 : 3, core: 0.6, ring: near ? 0.42 : 0.5, spread: 0.55, lift: [0.35, 0.4], rough: 0.32, detail: near ? 1 : 0, seed: seed + 5 });
  return finish(g, 1.6, 0.4);
}

function withoutUvNormal(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  return g;
}

/**
 * Rescales so the top is at y = 1 (an instance's y scale is then its height), and adds normals, planar UVs
 * (`uvScale` repeats per unit) and a vertex colour that darkens toward the root.
 */
function finish(g: THREE.BufferGeometry, uvScale: number, rootShade: number): THREE.BufferGeometry {
  g.computeBoundingBox();
  g.scale(1, 1 / (g.boundingBox!.max.y || 1), 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  const color = new Float32Array(p.count * 3);
  const top = 1;
  for (let i = 0; i < p.count; i++) {
    // Skewed planar UVs: no direction on a rounded clump leaves the texture smeared flat.
    uv[i * 2] = (p.getX(i) + 0.5 * p.getZ(i)) * uvScale;
    uv[i * 2 + 1] = (p.getY(i) + 0.5 * p.getZ(i)) * uvScale;
    const s = rootShade + (1 - rootShade) * THREE.MathUtils.clamp(p.getY(i) / top, 0, 1);
    color.set([s, s, s], i * 3);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.computeVertexNormals();
  return g;
}

export interface CardOptions {
  /** Number of cards around the root. */
  count: number;
  width: number;
  height: number;
  /** Segments along the height (more bend more smoothly when they sway). */
  segments: number;
  /** Outward lean of each card from the vertical, radians, and how much it curls further out toward the tip. */
  lean: number;
  curl?: number;
  /** Twist about the vertical along the height, radians (kelp ribbons). */
  twist?: number;
  seed: number;
}

/**
 * Upright alpha cards around a root. Both windings are emitted with normals pointing up and out, so the cards
 * light evenly from either side without the darkening a double-sided material gives back faces.
 */
export function cardGeometry(o: CardOptions): THREE.BufferGeometry {
  const rand = mulberry32(o.seed ^ 0xca4d);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const curl = o.curl ?? 0;
  const twist = o.twist ?? 0;
  for (let c = 0; c < o.count; c++) {
    const yaw = (c / o.count) * Math.PI + rand() * 0.5;
    const out = new THREE.Vector3(Math.cos(yaw + Math.PI / 2), 0, Math.sin(yaw + Math.PI / 2));
    const lean = o.lean * (0.7 + 0.6 * rand()) * (rand() < 0.5 ? -1 : 1);
    const base = positions.length / 3;
    for (let s = 0; s <= o.segments; s++) {
      const t = s / o.segments;
      // The card's centre line leans out from the root and curls further as it rises.
      const angle = lean * (1 + curl * t);
      const y = o.height * t * Math.cos(angle);
      const reach = o.height * t * Math.sin(angle);
      const across = yaw + twist * t;
      const ax = Math.cos(across);
      const az = Math.sin(across);
      for (const side of [-0.5, 0.5]) {
        positions.push(out.x * reach + ax * side * o.width, y, out.z * reach + az * side * o.width);
        normals.push(out.x * Math.sign(lean) * 0.35, 1, out.z * Math.sign(lean) * 0.35);
        uvs.push(side + 0.5, t);
        const shade = 0.55 + 0.45 * t;
        colors.push(shade, shade, shade);
      }
    }
    for (let s = 0; s < o.segments; s++) {
      const a = base + s * 2;
      indices.push(a, a + 1, a + 3, a, a + 3, a + 2); // front
      indices.push(a, a + 3, a + 1, a, a + 2, a + 3); // back
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.normalizeNormals();
  return g;
}

/** Unit boulders (footprint |x|, |z| <= 1, top at y = 1, buried to y = -0.35) to be scaled per instance. */
export function boulderGeometry(seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  return strataRock({
    halfX: 1,
    halfZ: 1,
    bottom: -0.35,
    top: 1,
    layer: 0.3 + rand() * 0.12,
    sides: 9,
    inset: 0.35,
    squareness: 2.4 + rand(),
    profile: (t) => 1 - 0.4 * t,
    moss: 0.55,
    jag: 0.28,
    rand,
  });
}

// ---- Materials (one set per seed, shared by every instance and every landmark) ----

export interface PlantMaterials {
  mound: THREE.MeshLambertMaterial;
  coral: THREE.MeshLambertMaterial;
  rock: THREE.MeshLambertMaterial;
  frond: THREE.MeshLambertMaterial;
  bush: THREE.MeshLambertMaterial;
  kelp: THREE.MeshLambertMaterial;
  ground: { map: THREE.Texture; bump: THREE.Texture };
}

const cache = new Map<number, PlantMaterials>();

export function plantMaterials(seed: number): PlantMaterials {
  const hit = cache.get(seed);
  if (hit) return hit;
  const ground = groundTextures(seed);
  const card = (map: THREE.Texture) =>
    new THREE.MeshLambertMaterial({ map, vertexColors: true, alphaTest: 0.45, alphaToCoverage: true });
  const coralMap = ground.map.clone();
  coralMap.repeat.set(2.5, 2.5);
  const made: PlantMaterials = {
    mound: new THREE.MeshLambertMaterial({ vertexColors: true, map: ground.map, bumpMap: ground.bump, bumpScale: 3 }),
    coral: new THREE.MeshLambertMaterial({ vertexColors: true, map: coralMap, bumpMap: ground.bump, bumpScale: 4 }),
    rock: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    frond: card(frondTexture(seed)),
    bush: card(bushTexture(seed)),
    kelp: card(kelpTexture(seed)),
    ground,
  };
  addSway(made.frond, { amount: 0.35, height: 2.5, speed: 1.1, ripple: 0.6 });
  addSway(made.bush, { amount: 0.18, height: 3, speed: 0.8, ripple: 0.4 });
  addSway(made.kelp, { amount: 2.2, height: 30, speed: 0.55, ripple: 0.12 });
  cache.set(seed, made);
  return made;
}
