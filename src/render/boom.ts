// The boom walk (phase 2 L1's keepInside, generalised for phase 3 M4): from a point the camera may see from (the
// craft, Troy's pivot) toward where the camera wants to be, keep the farthest point before the first sample that
// `inside` rejects — so a boom that would reach through a wall is shortened to the wall instead. Pure arithmetic,
// no three.js; any {x, y, z} will do (a THREE.Vector3 included).
//
//   - The samples are `step` metres apart at most; the first one that is outside ends the walk and the camera takes
//     the sample before it (phase 2's behaviour exactly, with refine 0).
//   - refine > 0 then bisects between those two samples that many times, so a boom sliding along a wall moves
//     smoothly rather than in step-sized jumps.
//   - If `from` itself is outside nothing is walked and `to` comes back: the caller's own clamp decides then.

export interface Point {
  x: number;
  y: number;
  z: number;
}

const lerp = (a: Point, b: Point, t: number): Point =>
  ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

export function walkBoom(from: Point, to: Point, inside: (p: Point) => boolean, step: number, refine = 0): Point {
  if (!inside(from)) return { x: to.x, y: to.y, z: to.z };
  const span = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  const steps = Math.ceil(span / step);
  for (let i = 1; i <= steps; i++) {
    if (inside(lerp(from, to, i / steps))) continue;
    let lo = (i - 1) / steps;
    let hi = i / steps;
    for (let k = 0; k < refine; k++) {
      const mid = (lo + hi) / 2;
      if (inside(lerp(from, to, mid))) lo = mid;
      else hi = mid;
    }
    return lerp(from, to, lo);
  }
  return { x: to.x, y: to.y, z: to.z };
}
