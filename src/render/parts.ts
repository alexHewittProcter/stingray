import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Small helpers for building set pieces out of primitives: place a box or a rod between two points, and collect
// pieces per material so each material is one merged mesh (one draw call) however many pieces use it.

const UP = new THREE.Vector3(0, 1, 0);
const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const s = new THREE.Vector3();
const p = new THREE.Vector3();
const dir = new THREE.Vector3();

type V = THREE.Vector3 | { x: number; y: number; z: number };
const vec = (a: V) => new THREE.Vector3(a.x, a.y, a.z);

/** Keep only position, normal and uv (and make it indexed) so any two pieces can be merged. */
function normalise(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  if (!g.index) {
    const count = g.attributes.position!.count;
    g.setIndex(Array.from({ length: count }, (_, i) => i));
  }
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position!.count * 2), 2));
  return g;
}

/** An axis-aligned box of size (w, h, d) centred at c, optionally turned about Y. */
export function box(w: number, h: number, d: number, c: V, yaw = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (yaw) g.rotateY(yaw);
  g.translate(c.x, c.y, c.z);
  return g;
}

/** A square-section bar of thickness t from a to b. */
export function bar(a: V, b: V, t: number, depth = t): THREE.BufferGeometry {
  const A = vec(a);
  const B = vec(b);
  dir.subVectors(B, A);
  const len = dir.length();
  const g = new THREE.BoxGeometry(t, len, depth);
  q.setFromUnitVectors(UP, dir.normalize());
  m.compose(p.addVectors(A, B).multiplyScalar(0.5), q, s.set(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}

/** A round rod (or tapered leg) from a to b. */
export function rod(a: V, b: V, radiusA: number, radiusB = radiusA, segments = 10, openEnded = false): THREE.BufferGeometry {
  const A = vec(a);
  const B = vec(b);
  dir.subVectors(B, A);
  const len = dir.length();
  // CylinderGeometry's top is +Y: put the top radius at b.
  const g = new THREE.CylinderGeometry(radiusB, radiusA, len, segments, 1, openEnded);
  q.setFromUnitVectors(UP, dir.normalize());
  m.compose(p.addVectors(A, B).multiplyScalar(0.5), q, s.set(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}

/** Any geometry, transformed in place (position, then a yaw/pitch/roll in radians). */
export function place(g: THREE.BufferGeometry, at: V, rotation: { x?: number; y?: number; z?: number } = {}): THREE.BufferGeometry {
  if (rotation.x) g.rotateX(rotation.x);
  if (rotation.z) g.rotateZ(rotation.z);
  if (rotation.y) g.rotateY(rotation.y);
  g.translate(at.x, at.y, at.z);
  return g;
}

/** Pieces collected per material; build() merges each material's pieces into one mesh. */
export class Parts {
  private readonly pieces = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(material: THREE.Material, ...geometries: THREE.BufferGeometry[]): void {
    const list = this.pieces.get(material) ?? [];
    for (const g of geometries) list.push(normalise(g));
    this.pieces.set(material, list);
  }

  build(name: string): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    for (const [material, list] of this.pieces) {
      const merged = mergeGeometries(list, false);
      if (!merged) throw new Error(`${name}: pieces for one material could not be merged`);
      for (const g of list) g.dispose();
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `${name}:${material.name || material.type}`;
      group.add(mesh);
    }
    return group;
  }
}
