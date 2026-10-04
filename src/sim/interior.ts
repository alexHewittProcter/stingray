// The inside of Marineville (phase 2, L1): where the hull centre and the camera may be north of the cliff face.
// Pure geometry over MARINEVILLE.interior. The interior volume is a union of two shapes: capsules of radius
// `reach` about each segment of the tunnel's centreline, and the pen box shrunk by `inset` on every face.
// The capsule at the tunnel's end reaches past the pen's south wall into the shrunk pen box, so the union
// has no seam at the junction: a hull centre on the centreline is inside all the way from the mouth to the pool.

import { TUNING as T } from './tuning';
import type { Vec3 } from './vec3';
import { COAST_Z, type Interior } from './world';

export interface Confined {
  /** The position, moved to the nearest point of the interior volume if it was outside. */
  pos: Vec3;
  /** Unit normal of the wall touched, pointing back into the volume (as collide.ts's Contact); null if untouched. */
  normal: Vec3 | null;
}

interface Volume {
  /** Capsule radius about the centreline. */
  reach: number;
  /** How far the pen box is shrunk on every face. */
  inset: number;
}

/** North of the cliff face: inside Marineville's rock, where only the interior is open. */
export function northOfFace(p: Vec3): boolean {
  return p.z < COAST_Z;
}

/**
 * Confinement for the hull centre: within tunnelHullReach of the centreline, or in the pen box shrunk by the
 * hull radius. South of the face it does nothing (the sea and the slab are stepSub's business). The correction
 * is the distance to the volume and no more.
 */
export function confine(pos: Vec3, interior: Interior): Confined {
  return confineTo(pos, interior, hullVolume());
}

/** True when the hull centre is north of the face and confine would leave it where it is. */
export function inInterior(pos: Vec3, interior: Interior): boolean {
  return northOfFace(pos) && confine(pos, interior).normal === null;
}

/** Confinement for the camera: the drawn interior (bore and pen walls) less cameraWallInset. */
export function confineCamera(pos: Vec3, interior: Interior): Confined {
  const inset = T.cameraWallInset;
  return confineTo(pos, interior, { reach: interior.tunnel.radius - inset, inset });
}

// On the wall counts as inside, with a hair of slack so a corrected position is left alone on the next step.
const ON_WALL = 1e-9;

const hullVolume = (): Volume => ({ reach: T.tunnelHullReach, inset: T.hullRadius });

function confineTo(pos: Vec3, interior: Interior, volume: Volume): Confined {
  const untouched: Confined = { pos: { ...pos }, normal: null };
  if (!northOfFace(pos)) return untouched;

  // The nearest point of the union is the nearest of each shape's nearest points; inside any shape, stay put.
  const nearest = { pos: untouched.pos, distance: Infinity };
  const consider = (p: Vec3) => {
    const d = distance(p, pos);
    if (d < nearest.distance) [nearest.pos, nearest.distance] = [p, d];
  };

  const line = interior.tunnel.centreline;
  for (let k = 1; k < line.length; k++) {
    const q = closestOnSegment(pos, line[k - 1]!, line[k]!);
    const d = distance(pos, q);
    if (d <= volume.reach + ON_WALL) return untouched;
    consider(add(q, scale(sub(pos, q), volume.reach / d)));
  }

  const { min, max } = interior.pen;
  const lo = { x: min.x + volume.inset, y: min.y + volume.inset, z: min.z + volume.inset };
  const hi = { x: max.x - volume.inset, y: max.y - volume.inset, z: max.z - volume.inset };
  const inPen = { x: clamp(pos.x, lo.x, hi.x), y: clamp(pos.y, lo.y, hi.y), z: clamp(pos.z, lo.z, hi.z) };
  if (distance(inPen, pos) <= ON_WALL) return untouched;
  consider(inPen);

  return { pos: nearest.pos, normal: scale(sub(nearest.pos, pos), 1 / nearest.distance) };
}

function closestOnSegment(p: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ab = sub(b, a);
  const along = dot(sub(p, a), ab) / dot(ab, ab);
  return add(a, scale(ab, clamp(along, 0, 1)));
}

// ---- Small arithmetic ----

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
