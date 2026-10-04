import * as THREE from 'three';
import { fbm3 } from './noise';

// Stratified rock, built as the series' model rocks look: a stack of rough slabs, each cut back by a different
// amount, so the faces show ledges and seams, with paler weathered tops and moss where things can settle.
// Every slab is cut INWARD from the footprint it is given, so a rock never leaves the box it was asked to fill.

const ROCK_BLUES = [0x56657a, 0x4c5a6e, 0x627287, 0x5b6676, 0x6b7b8f].map((h) => new THREE.Color(h));
const WEATHERED = new THREE.Color(0xa9b4bf);
const SEAM = new THREE.Color(0x232c38);
const MOSS = [0x6b7f34, 0x8a8a3a, 0x50692e].map((h) => new THREE.Color(h));

export interface StrataOptions {
  /** Half-extents of the footprint, centred on the origin: no vertex leaves |x| <= halfX, |z| <= halfZ. */
  halfX: number;
  halfZ: number;
  bottom: number;
  top: number;
  /** Typical stratum thickness. */
  layer: number;
  /** Outline points per slab. */
  sides: number;
  /** Most of the footprint (as a fraction) a slab may be cut back. */
  inset: number;
  /** Outline exponent: 2 is an ellipse, higher is boxier. */
  squareness: number;
  /** Width scale (0, 1] at height fraction t; shapes the silhouette (taper, waist). */
  profile?: (t: number) => number;
  /** 0..1: how readily up-facing ledges carry moss rather than bare weathered rock. */
  moss?: number;
  /** How deep (fraction of the half-extent) the craggy weathering cuts in. */
  jag?: number;
  /** Size of the weathering's lumps, in the rock's own units (defaults to half the narrower half-extent). */
  grain?: number;
  rand: () => number;
  /** If given, filled with exposed points on top of the slabs (ledges and the crown) where growth can sit. */
  ledges?: THREE.Vector3[];
}

interface Ring {
  y: number;
  scale: number;
  /** 0 = deep seam shadow, 1 = full light. */
  light: number;
}

/** A stratified rock as a non-indexed geometry with vertex colours (flat-shade it). */
export function strataRock(o: StrataOptions): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const { rand, sides } = o;
  const height = o.top - o.bottom;
  const slabs = Math.max(1, Math.round(height / o.layer));
  const jag = o.jag ?? 0.12;
  const moss = o.moss ?? 0.4;
  const unit: Array<[number, number]> = [];
  // Vertical cracks: a few outline points cut back through every stratum, so clefts run down the whole face.
  const cracks: number[] = [];
  const phase = rand() * Math.PI * 2;
  for (let k = 0; k < sides; k++) {
    cracks.push(rand() < 0.18 ? 1 - jag * (0.6 + 0.6 * rand()) : 1);
    const a = phase + (k / sides) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const e = 2 / o.squareness;
    unit.push([Math.sign(c) * Math.abs(c) ** e, Math.sign(s) * Math.abs(s) ** e]);
  }

  // Slab boundaries: roughly even, jittered so strata differ in thickness.
  const cuts = [o.bottom];
  for (let i = 1; i < slabs; i++) cuts.push(o.bottom + ((i + (rand() - 0.5) * 0.8) / slabs) * height);
  const grain = o.grain ?? Math.min(o.halfX, o.halfZ) * 0.5;
  const seed = Math.floor(rand() * 1e6);
  // Weathering is one 3D field through the whole rock, so the strata share a craggy envelope instead of
  // each slab reading as a separate disc.
  const weather = (x: number, y: number, z: number) => 1 - jag * fbm3(x / grain, y / grain, z / grain, seed, 3) * 1.6;
  cuts.push(o.top);

  const outlines: Array<Array<[number, number]>> = [];
  const tops: THREE.Vector3[][] = [];
  for (let i = 0; i < slabs; i++) {
    const y0 = cuts[i]!;
    const y1 = cuts[i + 1]!;
    const h = y1 - y0;
    const t = ((y0 + y1) / 2 - o.bottom) / Math.max(height, 1e-6);
    const dome = Math.min(h * 0.12, 0.6);
    // Most strata run nearly flush; now and then one is cut deeply back.
    const width = (o.profile?.(t) ?? 1) * (1 - o.inset * rand() ** 2);
    // A slab may drift off-centre, but only by the margin its own cut-back left.
    const ox = (rand() - 0.5) * 0.5 * (1 - width) * o.halfX;
    const oz = (rand() - 0.5) * 0.5 * (1 - width) * o.halfZ;
    const jitter = unit.map(() => 1 - jag * 0.25 * rand());
    const tint = ROCK_BLUES[Math.floor(rand() * ROCK_BLUES.length)]!;
    const detailed = sides >= 12;
    const rings: Ring[] = [
      { y: y0, scale: 0.975, light: 0.45 },
      { y: y0 + h * (0.12 + 0.08 * rand()), scale: 1, light: 0.7 },
      ...(detailed ? [{ y: y0 + h * (0.45 + 0.15 * rand()), scale: 0.97 + 0.03 * rand(), light: 0.9 }] : []),
      { y: y1 - dome - h * (0.08 + 0.08 * rand()), scale: 0.98 + 0.02 * rand(), light: 1 },
      { y: y1 - dome, scale: 0.94 + 0.04 * rand(), light: 1.15 },
    ];
    const at = (ring: Ring, k: number): THREE.Vector3 => {
      const [ux, uz] = unit[k % sides]!;
      const x = ux * o.halfX;
      const z = uz * o.halfZ;
      const j = jitter[k % sides]! * cracks[k % sides]! * ring.scale * width * weather(x, ring.y, z);
      return new THREE.Vector3(ox + ux * j * o.halfX, ring.y, oz + uz * j * o.halfZ);
    };
    const grid = rings.map((ring) => unit.map((_, k) => at(ring, k)));
    const mossy = rand() < moss;
    // Wound so the outside is the front face.
    const face = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, la: number, lb: number, lc: number) => {
      const normal = new THREE.Vector3().subVectors(c, a).cross(new THREE.Vector3().subVectors(b, a)).normalize();
      for (const [p, l] of [[a, la], [c, lc], [b, lb]] as const) {
        positions.push(p.x, p.y, p.z);
        const col = rockColour(tint, normal.y, l, mossy, rand);
        colors.push(col.r, col.g, col.b);
      }
    };
    for (let r = 0; r < rings.length - 1; r++) {
      const lo = grid[r]!;
      const hi = grid[r + 1]!;
      for (let k = 0; k < sides; k++) {
        const k1 = (k + 1) % sides;
        const ll = rings[r]!.light;
        const lh = rings[r + 1]!.light;
        face(lo[k]!, lo[k1]!, hi[k1]!, ll, ll, lh);
        face(lo[k]!, hi[k1]!, hi[k]!, ll, lh, lh);
      }
    }
    // Caps: a low dome on top, flat underneath (seen only where a slab overhangs the one below).
    const topRing = grid[rings.length - 1]!;
    const crown = new THREE.Vector3(ox, y1, oz);
    const bottomRing = grid[0]!;
    const base = new THREE.Vector3(ox, y0, oz);
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      face(topRing[k]!, topRing[k1]!, crown, 1.2, 1.2, 1.25);
      face(bottomRing[k1]!, bottomRing[k]!, base, 0, 0, 0);
    }
    outlines.push(grid[1]!.map((v) => [v.x, v.z]));
    tops.push([...topRing.map((v) => v.clone().lerp(crown, 0.2)), crown]);
  }

  // A ledge is a point on a slab's top that the slab above does not cover.
  if (o.ledges) {
    tops.forEach((points, i) => {
      const above = outlines[i + 1];
      for (const p of points) if (!above || !insidePolygon(above, p.x, p.z)) o.ledges!.push(p);
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function insidePolygon(poly: Array<[number, number]>, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

const scratch = new THREE.Color();

function rockColour(tint: THREE.Color, up: number, light: number, mossy: boolean, rand: () => number): THREE.Color {
  const c = scratch.copy(tint);
  if (up > 0.75) {
    // Tops weather pale; mossy strata grow a green-ochre cushion instead.
    if (mossy) c.copy(MOSS[Math.floor(rand() * MOSS.length)]!).multiplyScalar(0.85 + 0.3 * rand());
    else c.lerp(WEATHERED, 0.45 + 0.35 * rand());
  } else if (up < -0.4) {
    c.lerp(SEAM, 0.7);
  } else {
    // Sides: speckled, darkening into each seam.
    c.lerp(SEAM, THREE.MathUtils.clamp(1 - light, 0, 1) * 0.65);
    if (rand() < 0.12) c.lerp(WEATHERED, 0.5);
  }
  return c.multiplyScalar(0.88 + 0.24 * rand());
}
