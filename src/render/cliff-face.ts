import * as THREE from 'three';
import { hash3, mulberry32 } from './random';

// The rock face Marineville stands on, as the series shows it around the ocean door: dark,
// weathered rock in tall columns split by deep vertical flutes, banded by strata, with moss on
// the ledges and weed at the foot. Built in the face's own frame: x along the coast, y up, and
// z = 0 the collider face — every rock vertex is cut back to z ≤ 0, so nothing seen is softer
// than what you hit.

export interface CliffSpec {
  /** Length of coast to cover, metres, centred on x = 0. */
  width: number;
  /** Clifftop height above the surface. */
  top: number;
  /** World z of the collider face. */
  faceZ: number;
  /** Centre and radius of the ocean door's ring: the rock is dressed back around it. */
  door: { x: number; y: number; radius: number };
}

const FOOT_Y = -420; // well under the bed, so no edge shows
const DETAIL_BOTTOM = -95; // fine rows from here to the top: the bed at the face is ≈ −70
const ROW_FINE = 1.6;
const COLUMN_STEPS: ReadonlyArray<readonly [number, number]> = [
  [180, 2], // |x| up to 180 m: 2 m columns
  [600, 5],
  [Infinity, 15],
];

/** Depth the rock inside the ring would sit at; faceGeometry leaves it out, so the ring's bore is open. */
const PLUG_DEPTH = 9;
const COLUMN_WIDTH = 11; // m between flutes, before warping
const STRATA = 6.5; // m between strata ledges
const CREST_ROWS = 6;
const CREST_RUN = 14; // m the crest takes to roll back from the face into the grass
const LAND_DEPTH = 2400; // m of clifftop running north, past where the fog hides it
const FRONTAGE_HALF = 230; // m either side of x = 0 where Marineville fronts the cliff edge

const ROCK_DARK = new THREE.Color(0x3d423f);
const ROCK_GREEN = new THREE.Color(0x667060);
const ROCK_PURPLE = new THREE.Color(0x6a6474);
const ROCK_LIGHT = new THREE.Color(0x9da196);
const RUST = new THREE.Color(0x6f4a38);
const MOSS = new THREE.Color(0x58782c);
const MOSS_OLIVE = new THREE.Color(0x7d7a36);
const GRASS = new THREE.Color(0x6f8f48);

const smooth = (t: number) => {
  const u = Math.min(Math.max(t, 0), 1);
  return u * u * (3 - 2 * u);
};

/** Smooth 2D value noise in [0, 1). */
function noise(x: number, y: number, salt: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = hash3(ix, iy, salt);
  const b = hash3(ix + 1, iy, salt);
  const c = hash3(ix, iy + 1, salt);
  const d = hash3(ix + 1, iy + 1, salt);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

interface Sample {
  /** Metres the rock is cut back from the face (≥ 0). */
  depth: number;
  /** 0 on a column's crest, 1 in the bottom of a flute: for shading. */
  groove: number;
  column: number;
}

/** The rock's depth behind the face at (x, y). */
function sampleRock(x: number, y: number, door: CliffSpec['door']): Sample {
  // Columns wander a little as they rise, so the flutes are not ruled lines.
  const wx = x + 8 * (noise(y / 55, x / 70, 1) - 0.5) + 2 * (noise(y / 9, x / 30, 2) - 0.5);
  const cell = wx / COLUMN_WIDTH;
  const column = Math.floor(cell);
  const u = cell - column;
  const fromFlute = Math.min(u, 1 - u) * COLUMN_WIDTH; // metres to the nearest flute

  // Flutes deepen and fade along their height: clefts in some stretches, shallow in others.
  const fluteDepth = 2 + 13 * noise(column + 0.5, y / 26, 4) ** 1.5 + 3 * hash3(column, 7, 6);
  const fluteHalf = 1.2 + 2.4 * noise(column + 0.5, y / 30, 8);
  const flute = 1 - smooth(fromFlute / fluteHalf);
  // Some columns are split again by a narrower crack.
  const crackAt = 0.35 + 0.3 * hash3(column, 3, 3);
  const crackDepth = hash3(column, 5, 5) > 0.55 ? 4 * noise(column + 0.5, y / 18, 9) : 0;
  const crack = crackDepth * (1 - smooth((Math.abs(u - crackAt) * COLUMN_WIDTH) / 0.7));
  const groove = Math.max(flute, crack / 6);

  const crown = Math.sqrt(Math.max(1 - (2 * u - 1) ** 2, 0)); // rounded column face
  const setBack = 4 * hash3(column, 11, 9); // columns stand at different depths
  const period = STRATA * (0.7 + 0.6 * hash3(column, 13, 10));
  const strata = 0.5 * ((((y / period + hash3(column, 15, 11)) % 1) + 1) % 1); // sawtooth: a small ledge each band
  const swell = 7 * noise(x / 90, y / 70, 12);
  const grain = 0.6 * noise(x / 1.7, y / 2.3, 14);

  let depth = 2.5 + setBack + swell + fluteDepth * flute + crack - 1.8 * crown + strata + grain;

  // Around the door the rock is dressed back into a rough apron the ring sits in.
  const r = Math.hypot(x - door.x, y - door.y);
  const apron = 2.4 + grain + 0.8 * strata;
  const dressed = 1 - smooth((r - door.radius - 4) / 9);
  depth += (apron - depth) * dressed;
  if (r < door.radius - 0.5) depth = PLUG_DEPTH; // behind the ring's collar: cut away (faceGeometry)

  return { depth: Math.max(depth, 0.05), groove, column };
}

function axisSamples(steps: ReadonlyArray<readonly [number, number]>, half: number): number[] {
  const xs: number[] = [0];
  let x = 0;
  for (const [limit, step] of steps) {
    while (x + step <= Math.min(limit, half) + 1e-6) {
      x += step;
      xs.push(x);
    }
    if (x >= half) break;
  }
  if (x < half) xs.push(half);
  return [...xs.slice(1).reverse().map((v) => -v), ...xs];
}

function rowSamples(top: number): number[] {
  const ys = [FOOT_Y, -300, -200, -150, -120, -105];
  for (let y = DETAIL_BOTTOM; y < top; y += ROW_FINE) ys.push(y);
  ys.push(top);
  return ys;
}

function rockColour(out: THREE.Color, s: Sample, x: number, y: number): THREE.Color {
  out.copy(ROCK_GREEN).lerp(ROCK_PURPLE, noise(x / 40, y / 30, 20));
  // Weathering runs down the face in streaks, lighter on the columns' crowns.
  out.lerp(ROCK_LIGHT, (0.15 + 0.4 * noise(x / 3, y / 40, 21)) * (1 - s.groove));
  if (hash3(s.column, 0, 22) > 0.8) out.lerp(RUST, 0.45 * noise(x / 3, y / 18, 23)); // rust streaks down some columns
  out.lerp(ROCK_DARK, 0.75 * s.groove);
  return out;
}

/** The face, its rolled-over crest and the grass running north from it, as one mesh. */
function faceGeometry(spec: CliffSpec): THREE.BufferGeometry {
  const xs = axisSamples(COLUMN_STEPS, spec.width / 2);
  const ys = rowSamples(spec.top);
  const rows = ys.length + CREST_ROWS;
  const cols = xs.length;
  const positions = new Float32Array(rows * cols * 3);
  const colours = new Float32Array(rows * cols * 3);
  const grooves = new Float32Array(rows * cols);
  const col = new THREE.Color();

  for (let i = 0; i < cols; i++) {
    const x = xs[i]!;
    let topDepth = 0;
    for (let j = 0; j < ys.length; j++) {
      const y = ys[j]!;
      const s = sampleRock(x, y, spec.door);
      const k = j * cols + i;
      positions.set([x, y, -s.depth], k * 3);
      rockColour(col, s, x, y);
      colours.set([col.r, col.g, col.b], k * 3);
      grooves[k] = s.groove;
      topDepth = s.depth;
    }
    // The crest: the rock rolls back over the top in a broken lip, then grassed, into the land.
    // Lower in front of Marineville, so the base keeps its frontage on the sea.
    const frontage = smooth((Math.abs(x) - FRONTAGE_HALF) / 60);
    const lip = 0.8 + frontage * (1.7 + 6 * noise(x / 26, 0, 30)) + 2 * hash3(Math.round(x / 3), 0, 31);
    for (let c = 1; c <= CREST_ROWS; c++) {
      const a = c / CREST_ROWS;
      const k = (ys.length + c - 1) * cols + i;
      const y = spec.top + lip * Math.sin(Math.PI * a) - 0.6 * a;
      positions.set([x, y, -(topDepth + CREST_RUN * a)], k * 3);
      col.copy(ROCK_GREEN).lerp(GRASS, smooth((a - 0.2) / 0.4));
      colours.set([col.r, col.g, col.b], k * 3);
    }
  }

  // Phase 2 (T4): the rock that stood inside the ring, behind the door, is left out — the ring's bore runs on
  // into the tunnel. A triangle is dropped only if all its corners are inside the ring, so the rock that remains
  // still reaches in behind the ring's face (inside its outer wall) and no gap opens round it.
  const inRing = (k: number) => k < ys.length * cols && Math.hypot(positions[k * 3]! - spec.door.x, positions[k * 3 + 1]! - spec.door.y) < spec.door.radius - 0.5;
  const indices: number[] = [];
  const tri = (a: number, b: number, c: number) => {
    if (!(inRing(a) && inRing(b) && inRing(c))) indices.push(a, b, c);
  };
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      tri(a, b, c);
      tri(b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  // Moss settles where the rock faces up (ledges, strata tops) and thickly along the foot.
  const normals = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const moss = new THREE.Color();
  for (let j = 0; j < ys.length; j++) {
    const y = ys[j]!;
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      const x = xs[i]!;
      const up = smooth((normals.getY(k) - 0.25) / 0.35);
      const foot = 1 - smooth((y + 66 - 8 * noise(x / 15, 0, 40)) / 7);
      const amount = Math.max(up * (0.55 + 0.45 * noise(x / 8, y / 8, 41)), foot * 0.85) * (1 - (grooves[k] ?? 0) * 0.5);
      if (amount <= 0) continue;
      moss.copy(MOSS).lerp(MOSS_OLIVE, noise(x / 12, y / 10, 42));
      col.fromArray(colours, k * 3).lerp(moss, amount);
      colours.set([col.r, col.g, col.b], k * 3);
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return geometry;
}

const WEED_COUNT = 900;
const WEED_SPAN = 260; // m either side of the door the weed is planted

/** Weed tufts on the ledges and along the foot: thin cones leaning out from the face. */
function weed(spec: CliffSpec): THREE.InstancedMesh {
  const geometry = new THREE.ConeGeometry(0.5, 1, 4, 1, true);
  geometry.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), WEED_COUNT);
  const rand = mulberry32(0x5eed);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const tint = new THREE.Color();
  let placed = 0;
  for (let tries = 0; placed < WEED_COUNT && tries < WEED_COUNT * 20; tries++) {
    const x = (rand() * 2 - 1) * WEED_SPAN;
    const atFoot = rand() < 0.45;
    const y = atFoot ? -70 + rand() * 7 : -66 + rand() * (spec.top + 60);
    const here = sampleRock(x, y, spec.door);
    if (Math.hypot(x - spec.door.x, y - spec.door.y) < spec.door.radius + 1) continue;
    // A ledge: the rock steps back just above this point.
    if (!atFoot && sampleRock(x, y + 0.8, spec.door).depth - here.depth < 0.35) continue;
    const h = atFoot ? 2 + rand() * 4 : 0.8 + rand() * 1.8;
    s.set(0.6 + rand() * 0.8, h, 0.6 + rand() * 0.8);
    q.setFromEuler(e.set(0.25 + rand() * 0.35, rand() * Math.PI * 2, (rand() - 0.5) * 0.4));
    mesh.setMatrixAt(placed, m.compose(p.set(x, y - 0.2, -here.depth), q, s));
    mesh.setColorAt(placed, tint.setHSL(0.18 + rand() * 0.14, 0.45 + rand() * 0.25, 0.2 + rand() * 0.16));
    placed++;
  }
  mesh.count = placed;
  return mesh;
}

export function createCliffFace(spec: CliffSpec): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cliff';
  const face = new THREE.Mesh(faceGeometry(spec), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  group.add(face, weed(spec));

  // The land on top, running north out of sight behind the crest.
  const land = new THREE.Mesh(new THREE.PlaneGeometry(spec.width, LAND_DEPTH), new THREE.MeshLambertMaterial({ color: GRASS }));
  land.rotation.x = -Math.PI / 2;
  land.position.set(0, spec.top - 0.1, -LAND_DEPTH / 2);
  group.add(land);

  group.position.z = spec.faceZ;
  return group;
}
