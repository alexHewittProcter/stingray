// Seeded smooth noise for scenery colour and shape. Render-only: the collision heightfield lives in sim/seabed.ts.

function hash(ix: number, iy: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 1103515245) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const wrap = (i: number, period: number) => (period > 0 ? ((i % period) + period) % period : i);

/**
 * Smooth value noise in [0, 1] on a unit grid. With `period` > 0 it tiles every `period` cells in x and y,
 * which is what a repeating texture needs.
 */
export function noise2(x: number, y: number, seed: number, period = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const x0 = wrap(ix, period);
  const x1 = wrap(ix + 1, period);
  const y0 = wrap(iy, period);
  const y1 = wrap(iy + 1, period);
  return lerp(
    lerp(hash(x0, y0, 0, seed), hash(x1, y0, 0, seed), fx),
    lerp(hash(x0, y1, 0, seed), hash(x1, y1, 0, seed), fx),
    fy,
  );
}

export function noise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const fz = fade(z - iz);
  const plane = (k: number) =>
    lerp(
      lerp(hash(ix, iy, k, seed), hash(ix + 1, iy, k, seed), fx),
      lerp(hash(ix, iy + 1, k, seed), hash(ix + 1, iy + 1, k, seed), fx),
      fy,
    );
  return lerp(plane(iz), plane(iz + 1), fz);
}

/** Fractal value noise in [0, 1]: `octaves` layers, each twice the frequency and half the weight. */
export function fbm2(x: number, y: number, seed: number, octaves: number, period = 0): number {
  let sum = 0;
  let weight = 0.5;
  let total = 0;
  let scale = 1;
  for (let o = 0; o < octaves; o++) {
    sum += weight * noise2(x * scale, y * scale, seed + o * 31, period * scale);
    total += weight;
    weight *= 0.5;
    scale *= 2;
  }
  return sum / total;
}

export function fbm3(x: number, y: number, z: number, seed: number, octaves: number): number {
  let sum = 0;
  let weight = 0.5;
  let total = 0;
  let scale = 1;
  for (let o = 0; o < octaves; o++) {
    sum += weight * noise3(x * scale, y * scale, z * scale, seed + o * 31);
    total += weight;
    weight *= 0.5;
    scale *= 2;
  }
  return sum / total;
}
