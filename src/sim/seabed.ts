// The seabed heightfield: one pure, seeded function used by both the render mesh and the collision.
// Land is never part of it — the Marineville coast is a set of box colliders (world.ts).

export const COAST_Z = -1100; // the cliff face; everything north (z < COAST_Z) is land
export const SHELF_Y = -70; // the bed in front of Marineville
const OPEN_SEA_Y = -110; // the bed once off the shelf
const SHELF_RUN = 400; // m south of the face over which the shelf deepens to the open sea

// The trench: an east-west canyon south of the landmarks' cluster.
export const TRENCH = { z: -250, floorY: -320, floorHalfWidth: 90, wallWidth: 70, halfLength: 700, taper: 300 };

const NOISE_NEAR = 2; // m of relief at the tunnel mouth, so the shelf reads flat there
const NOISE_FAR = 12; // m of relief elsewhere
const NOISE_RAMP = 300; // m from the mouth over which relief grows

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const smoothstep = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

// Integer hash → [0, 1): deterministic, seeded, no global randomness.
function hash(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Smooth value noise in [-1, 1] on a square grid of `cell` metres.
function valueNoise(x: number, z: number, cell: number, seed: number): number {
  const gx = x / cell;
  const gz = z / cell;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = smoothstep(gx - ix);
  const fz = smoothstep(gz - iz);
  const a = hash(ix, iz, seed);
  const b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed);
  const d = hash(ix + 1, iz + 1, seed);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return (top + (bottom - top) * fz) * 2 - 1;
}

function relief(x: number, z: number, seed: number): number {
  return 0.6 * valueNoise(x, z, 220, seed) + 0.3 * valueNoise(x, z, 90, seed + 1) + 0.1 * valueNoise(x, z, 35, seed + 2);
}

function trenchShape(x: number, z: number): number {
  const across = 1 - smoothstep((Math.abs(z - TRENCH.z) - TRENCH.floorHalfWidth) / TRENCH.wallWidth);
  const along = 1 - smoothstep((Math.abs(x) - TRENCH.halfLength) / TRENCH.taper);
  return across * along;
}

/** Builds the seeded seabed: y of the bed at (x, z). Always ≤ -20 inside the bounds. */
export function makeSeabed(seed: number): (x: number, z: number) => number {
  const s = seed | 0;
  return (x, z) => {
    const base = SHELF_Y + (OPEN_SEA_Y - SHELF_Y) * smoothstep((z - COAST_Z) / SHELF_RUN);
    const fromMouth = Math.hypot(x, z - COAST_Z);
    const amplitude = NOISE_NEAR + (NOISE_FAR - NOISE_NEAR) * smoothstep(fromMouth / NOISE_RAMP);
    const bed = base + amplitude * relief(x, z, s);
    return bed - (OPEN_SEA_Y - TRENCH.floorY) * trenchShape(x, z);
  };
}
