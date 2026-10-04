import * as THREE from 'three';
import type { Vec3 } from '../sim/vec3';

// The launch tunnel's centreline as a path the renderer can walk: arc length from the mouth, a frame at every
// point (parallel-transported, so nothing twists along the bore), and placement on the wall by angle and radius.
//
// Frame at a point: `dir` runs along the tunnel inward (mouth → pen), `up` is the cross-section's top (as near
// world up as the path allows), `side` = up × dir (west while the tunnel runs north). An angle round the bore is
// measured from `up` toward `side`: 0 the crown, ±π/2 the walls, π the floor.

export interface PathSegment {
  /** Arc length at the segment's start. */
  s: number;
  length: number;
  start: THREE.Vector3;
  dir: THREE.Vector3;
  up: THREE.Vector3;
  side: THREE.Vector3;
}

export interface TunnelPath {
  readonly length: number;
  readonly segments: readonly PathSegment[];
  /** Point on the centreline at arc length s (clamped to the path). */
  pointAt(s: number, out?: THREE.Vector3): THREE.Vector3;
  /** The segment carrying arc length s. */
  segmentAt(s: number): PathSegment;
  /** A point on a circle of radius r about the centreline at s, at `angle` from the crown. */
  wallPoint(s: number, angle: number, r: number, out?: THREE.Vector3): THREE.Vector3;
  /** A matrix whose local X = side, Y = up, Z = dir, rotated `angle` about Z (so local +Y points at that angle), at s. */
  frameMatrix(s: number, angle?: number, out?: THREE.Matrix4): THREE.Matrix4;
  /** Arc length of the centreline point nearest p (may be < 0 or > length when p is beyond the ends). */
  project(p: Vec3 | THREE.Vector3): number;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);

export function createTunnelPath(centreline: readonly Vec3[]): TunnelPath {
  const segments: PathSegment[] = [];
  let s = 0;
  let up = new THREE.Vector3();
  for (let k = 1; k < centreline.length; k++) {
    const a = new THREE.Vector3(centreline[k - 1]!.x, centreline[k - 1]!.y, centreline[k - 1]!.z);
    const b = new THREE.Vector3(centreline[k]!.x, centreline[k]!.y, centreline[k]!.z);
    const length = a.distanceTo(b);
    const dir = b.clone().sub(a).normalize();
    if (k === 1) {
      up = WORLD_UP.clone().addScaledVector(dir, -WORLD_UP.dot(dir)).normalize();
    } else {
      // Parallel transport: turn the previous frame by the rotation taking the previous direction to this one.
      const q = new THREE.Quaternion().setFromUnitVectors(segments[k - 2]!.dir, dir);
      up = up.clone().applyQuaternion(q);
      up.addScaledVector(dir, -up.dot(dir)).normalize();
    }
    const side = new THREE.Vector3().crossVectors(up, dir).normalize();
    segments.push({ s, length, start: a, dir, up, side });
    s += length;
  }
  const total = s;

  const segmentAt = (at: number): PathSegment => {
    for (let i = segments.length - 1; i >= 0; i--) if (at >= segments[i]!.s) return segments[i]!;
    return segments[0]!;
  };

  const pointAt = (at: number, out = new THREE.Vector3()) => {
    const c = THREE.MathUtils.clamp(at, 0, total);
    const seg = segmentAt(c);
    return out.copy(seg.start).addScaledVector(seg.dir, Math.min(c - seg.s, seg.length));
  };

  const m = new THREE.Matrix4();
  return {
    length: total,
    segments,
    pointAt,
    segmentAt,
    wallPoint(at, angle, r, out = new THREE.Vector3()) {
      const seg = segmentAt(THREE.MathUtils.clamp(at, 0, total));
      pointAt(at, out);
      return out.addScaledVector(seg.up, Math.cos(angle) * r).addScaledVector(seg.side, Math.sin(angle) * r);
    },
    frameMatrix(at, angle = 0, out = new THREE.Matrix4()) {
      const seg = segmentAt(THREE.MathUtils.clamp(at, 0, total));
      const p = pointAt(at);
      out.makeBasis(seg.side, seg.up, seg.dir).setPosition(p);
      // Local +Y should point at `angle` (measured from up toward side, i.e. from +Y toward +X): turn by −angle about Z.
      if (angle) out.multiply(m.makeRotationZ(-angle));
      return out;
    },
    project(p) {
      let best = Infinity;
      let bestS = 0;
      const v = new THREE.Vector3();
      for (const seg of segments) {
        v.set(p.x, p.y, p.z).sub(seg.start);
        let t = v.dot(seg.dir);
        // Beyond the ends the arc length runs on along the end segments' lines.
        const first = seg === segments[0];
        const last = seg === segments[segments.length - 1];
        if (!first) t = Math.max(t, 0);
        if (!last) t = Math.min(t, seg.length);
        const d = v.addScaledVector(seg.dir, -t).lengthSq();
        if (d < best) {
          best = d;
          bestS = seg.s + t;
        }
      }
      return bestS;
    },
  };
}
