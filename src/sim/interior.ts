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
 * Phase 4 D6: the forward speed cap at a hull centre — a ramp by distance to the pen. The full cruise/boost cap
 * (boostSpeed) more than capRamp south of the pen's south wall (the tunnel proper and the sea), falling linearly to
 * interiorSpeedCap at the wall, and interiorSpeedCap inside the pen box. Boost is allowed wherever it exceeds
 * cruiseSpeed (launch.ts drive).
 */
export function capAt(pos: Vec3, interior: Interior): number {
  const south = pos.z - interior.pen.max.z; // metres south of the pen's south wall (≤ 0: in the pen)
  const k = clamp(south / T.capRamp, 0, 1);
  return T.interiorSpeedCap + (T.boostSpeed - T.interiorSpeedCap) * k;
}

/**
 * Phase 4 D6, the bore's pitch assist: the pitch (radians, + nose up) of the tunnel's bore along heading `yaw` at a
 * hull centre inside the bore (within the drawn radius of the centreline, north of the face, south of the pen's south
 * wall), else 0. The slope comes from the centreline segment at the hull's arc position, blended over boreTrimBlend
 * metres across each join (centred on the corner), and down to level over the last boreTrimBlend before the pen's
 * wall; taken along the heading, so facing in up the incline it is ≈ +8.7°, facing out ≈ −8.7°, broadside 0.
 */
export function boreSlopeAt(pos: Vec3, yaw: number, interior: Interior): number {
  if (!northOfFace(pos) || pos.z <= interior.pen.max.z) return 0;
  const line = interior.tunnel.centreline;
  // The hull's arc position and its distance from the axis; each segment's horizontal gradient (rise per metre run).
  let best = Infinity;
  let at = 0;
  let s0 = 0;
  const grads: Array<{ s: number; gx: number; gz: number }> = [];
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1]!;
    const b = line[k]!;
    const ab = sub(b, a);
    const length = Math.hypot(ab.x, ab.y, ab.z);
    const run = Math.hypot(ab.x, ab.z);
    grads.push({ s: s0, gx: run > 0 ? (ab.x / run) * (ab.y / run) : 0, gz: run > 0 ? (ab.z / run) * (ab.y / run) : 0 });
    const t = clamp(dot(sub(pos, a), ab) / dot(ab, ab), 0, 1);
    const d = distance(pos, add(a, scale(ab, t)));
    if (d < best) [best, at] = [d, s0 + t * length];
    s0 += length;
  }
  if (best > interior.tunnel.radius) return 0;
  const W = T.boreTrimBlend;
  const step = (s: number, centre: number) => {
    const u = clamp((s - centre) / W + 0.5, 0, 1);
    return u * u * (3 - 2 * u);
  };
  let gx = grads[0]!.gx;
  let gz = grads[0]!.gz;
  for (let k = 1; k < grads.length; k++) {
    const w = step(at, grads[k]!.s);
    gx += (grads[k]!.gx - grads[k - 1]!.gx) * w;
    gz += (grads[k]!.gz - grads[k - 1]!.gz) * w;
  }
  // Level at the pen's wall: the last segment's slope fades out over the bore's last W metres.
  const fade = 1 - step(at, s0 - W / 2);
  const along = (-Math.sin(yaw) * gx - Math.cos(yaw) * gz) * fade;
  return Math.atan(along);
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
