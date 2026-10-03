// World frame: right-handed, +Y up, metres, sea surface at y = 0.
// Immutable data + pure functions, built once by createWorld(seed).

export const FIXED_DT = 1 / 60;

export interface Bounds {
  /** Half the side of the square ocean, centred on the origin: |x|, |z| <= halfSize. */
  halfSize: number;
}

export interface World {
  seed: number;
  bounds: Bounds;
}

export function createWorld(seed: number): World {
  return { seed, bounds: { halfSize: 1500 } };
}
