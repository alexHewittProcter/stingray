import type { Vec3 } from './vec3';

export type Collider =
  | { kind: 'sphere'; centre: Vec3; radius: number }
  | { kind: 'box'; min: Vec3; max: Vec3 }; // axis-aligned

export interface Contact {
  /** Where a sphere of the given radius must move to so it just touches the collider. */
  pos: Vec3;
  /** Unit normal pointing out of the collider. */
  normal: Vec3;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Distance from p to the collider's surface; negative inside. */
export function distanceTo(c: Collider, p: Vec3): number {
  if (c.kind === 'sphere') {
    return Math.hypot(p.x - c.centre.x, p.y - c.centre.y, p.z - c.centre.z) - c.radius;
  }
  const dx = Math.max(c.min.x - p.x, 0, p.x - c.max.x);
  const dy = Math.max(c.min.y - p.y, 0, p.y - c.max.y);
  const dz = Math.max(c.min.z - p.z, 0, p.z - c.max.z);
  const outside = Math.hypot(dx, dy, dz);
  if (outside > 0) return outside;
  return -Math.min(p.x - c.min.x, c.max.x - p.x, p.y - c.min.y, c.max.y - p.y, p.z - c.min.z, c.max.z - p.z);
}

/** If a sphere at p with radius r overlaps the collider, where to push it out to; else null. */
export function contact(c: Collider, p: Vec3, r: number): Contact | null {
  return c.kind === 'sphere' ? sphereContact(c.centre, c.radius, p, r) : boxContact(c.min, c.max, p, r);
}

function sphereContact(centre: Vec3, radius: number, p: Vec3, r: number): Contact | null {
  const dx = p.x - centre.x;
  const dy = p.y - centre.y;
  const dz = p.z - centre.z;
  const d = Math.hypot(dx, dy, dz);
  if (d >= radius + r) return null;
  // Dead centre has no direction: push straight up.
  const normal = d > 1e-9 ? { x: dx / d, y: dy / d, z: dz / d } : { x: 0, y: 1, z: 0 };
  const reach = radius + r;
  return {
    pos: { x: centre.x + normal.x * reach, y: centre.y + normal.y * reach, z: centre.z + normal.z * reach },
    normal,
  };
}

function boxContact(min: Vec3, max: Vec3, p: Vec3, r: number): Contact | null {
  const q = { x: clamp(p.x, min.x, max.x), y: clamp(p.y, min.y, max.y), z: clamp(p.z, min.z, max.z) };
  const dx = p.x - q.x;
  const dy = p.y - q.y;
  const dz = p.z - q.z;
  const d = Math.hypot(dx, dy, dz);
  if (d >= r) return null;
  if (d > 1e-9) {
    const normal = { x: dx / d, y: dy / d, z: dz / d };
    return { pos: { x: q.x + normal.x * r, y: q.y + normal.y * r, z: q.z + normal.z * r }, normal };
  }
  return insideBoxContact(min, max, p, r);
}

// The centre is inside the box: leave by the nearest face.
function insideBoxContact(min: Vec3, max: Vec3, p: Vec3, r: number): Contact {
  const faces: Array<[number, Vec3, Vec3]> = [
    [p.x - min.x, { x: -1, y: 0, z: 0 }, { x: min.x - r, y: p.y, z: p.z }],
    [max.x - p.x, { x: 1, y: 0, z: 0 }, { x: max.x + r, y: p.y, z: p.z }],
    [p.y - min.y, { x: 0, y: -1, z: 0 }, { x: p.x, y: min.y - r, z: p.z }],
    [max.y - p.y, { x: 0, y: 1, z: 0 }, { x: p.x, y: max.y + r, z: p.z }],
    [p.z - min.z, { x: 0, y: 0, z: -1 }, { x: p.x, y: p.y, z: min.z - r }],
    [max.z - p.z, { x: 0, y: 0, z: 1 }, { x: p.x, y: p.y, z: max.z + r }],
  ];
  let best = faces[0]!;
  for (const f of faces) if (f[0] < best[0]) best = f;
  return { pos: best[2], normal: best[1] };
}
