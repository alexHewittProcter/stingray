import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { cradleHeight } from '../sim/launch';
import { MARINEVILLE, type Interior } from '../sim/world';
import { isInteriorMaterial } from './indoors';
import { createPen } from './pen';

// What you see is what you hit, inside Marineville (L6): every vertex of the drawn interior's shell — walls, floor,
// ceiling, the collar of bore behind the pen's tunnel opening — sits on or outside the interior volume (the pen box
// and the drawn bore about the tunnel's centreline), so the hull never visibly passes through a wall it is kept off.
//
// To extend (T4): add the tunnel's root to SHELL_ROOTS and tag its bore meshes userData.interiorShell.

const interior = MARINEVILLE.interior;
const EPSILON = 1e-3;

const pen = createPen(interior);
const SHELL_ROOTS: THREE.Object3D[] = [pen.hall];

/** Strictly inside the interior volume: inside the pen box, or nearer the centreline than the drawn bore. */
function insideVolume(p: THREE.Vector3, i: Interior): boolean {
  const { min, max } = i.pen;
  const inBox = p.x > min.x + EPSILON && p.x < max.x - EPSILON
    && p.y > min.y + EPSILON && p.y < max.y - EPSILON
    && p.z > min.z + EPSILON && p.z < max.z - EPSILON;
  if (inBox) return true;
  const line = i.tunnel.centreline;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const q = new THREE.Vector3();
  const seg = new THREE.Line3();
  for (let k = 1; k < line.length; k++) {
    seg.set(a.set(line[k - 1]!.x, line[k - 1]!.y, line[k - 1]!.z), b.set(line[k]!.x, line[k]!.y, line[k]!.z));
    seg.closestPointToPoint(p, true, q);
    if (q.distanceTo(p) < i.tunnel.radius - EPSILON) return true;
  }
  return false;
}

/** Every shell triangle under the roots, in world space: its corners and its edge midpoints. */
function shellSamples(roots: THREE.Object3D[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !o.userData.interiorShell) return;
      const position = o.geometry.attributes.position as THREE.BufferAttribute;
      const index = o.geometry.index;
      const count = index ? index.count : position.count;
      const at = (k: number) => new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(k) : k).applyMatrix4(o.matrixWorld);
      for (let k = 0; k < count; k += 3) {
        const [a, b, c] = [at(k), at(k + 1), at(k + 2)];
        out.push(a, b, c, a.clone().lerp(b, 0.5), b.clone().lerp(c, 0.5), c.clone().lerp(a, 0.5));
      }
    });
  }
  return out;
}

describe('the interior shell', () => {
  const samples = shellSamples(SHELL_ROOTS);

  it('has walls, floor and ceiling on every face of the pen box', () => {
    const { min, max } = interior.pen;
    const on = (v: number, face: number) => Math.abs(v - face) < EPSILON;
    expect(samples.some((p) => on(p.x, min.x))).toBe(true);
    expect(samples.some((p) => on(p.x, max.x))).toBe(true);
    expect(samples.some((p) => on(p.y, min.y))).toBe(true);
    expect(samples.some((p) => on(p.y, max.y))).toBe(true);
    expect(samples.some((p) => on(p.z, min.z))).toBe(true);
    expect(samples.some((p) => on(p.z, max.z))).toBe(true);
  });

  it('draws every wall, floor and ceiling vertex on or outside the interior volume', () => {
    expect(samples.length).toBeGreaterThan(100);
    const inside = samples.filter((p) => insideVolume(p, interior));
    expect(inside.slice(0, 3)).toEqual([]);
  });

  it('leaves the tunnel opening in the south wall clear', () => {
    const end = interior.tunnel.centreline[interior.tunnel.centreline.length - 1]!;
    const blocking = samples.filter((p) => Math.abs(p.z - interior.pen.max.z) < EPSILON
      && Math.hypot(p.x - end.x, p.y - end.y) < interior.tunnel.radius - EPSILON);
    expect(blocking).toEqual([]);
  });
});

describe('pen lighting', () => {
  it('builds every lit material in the hall as an interior one (no sun, no sky, no caustics)', () => {
    const lit: THREE.Material[] = [];
    pen.hall.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      for (const m of [o.material].flat() as THREE.Material[]) {
        if (m instanceof THREE.MeshLambertMaterial || m instanceof THREE.MeshPhongMaterial || m instanceof THREE.MeshStandardMaterial) lit.push(m);
      }
    });
    expect(lit.length).toBeGreaterThan(10);
    expect(lit.filter((m) => !isInteriorMaterial(m) || m.userData.noCaustics !== true).map((m) => m.name)).toEqual([]);
  });

  it('stays within its triangle budget', () => {
    let triangles = 0;
    pen.hall.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const g = o.geometry as THREE.BufferGeometry;
      triangles += ((g.index ? g.index.count : g.attributes.position!.count) / 3) * (o instanceof THREE.InstancedMesh ? o.count : 1);
    });
    expect(triangles).toBeLessThan(60_000);
  });
});

describe('the cradle', () => {
  it('carries the hull centre at the launch state\'s height, raised and lowered', () => {
    for (const cradle of [0, 0.5, 1]) {
      pen.cradle.snap(cradle, 'locked', interior.cradle.yawOut);
      expect(pen.cradle.head.position.y).toBeCloseTo(cradleHeight(cradle, interior), 6);
      expect(pen.cradle.head.position.x).toBe(interior.cradle.pos.x);
      expect(pen.cradle.head.position.z).toBe(interior.cradle.pos.z);
    }
  });

  it('opens its clamp arms on release and closes them on lock within half a second', () => {
    const arms = () => pen.cradle.head.children.filter((c) => c.children.length === 1 && c.children[0]!.name === 'cradle-arm');
    pen.cradle.snap(1, 'locked', Math.PI);
    expect(arms().length).toBe(4);
    expect(arms().every((a) => a.rotation.z === 0)).toBe(true);
    for (let i = 0; i < 30; i++) pen.cradle.update(1, 'released', Math.PI, 1 / 60);
    expect(arms().every((a) => Math.abs(a.rotation.z) > 0.9)).toBe(true);
    for (let i = 0; i < 30; i++) pen.cradle.update(1, 'locked', Math.PI, 1 / 60);
    expect(arms().every((a) => a.rotation.z === 0)).toBe(true);
  });

  it('turns with the craft while clamped and holds its heading while released', () => {
    pen.cradle.snap(1, 'locked', 0);
    for (let i = 0; i < 240; i++) pen.cradle.update(0.5, 'locked', Math.PI / 2, 1 / 60);
    expect(Math.cos(pen.cradle.head.rotation.y - Math.PI / 2)).toBeGreaterThan(0.999);
    for (let i = 0; i < 60; i++) pen.cradle.update(1, 'released', 0, 1 / 60);
    expect(Math.cos(pen.cradle.head.rotation.y - Math.PI / 2)).toBeGreaterThan(0.999);
  });
});
