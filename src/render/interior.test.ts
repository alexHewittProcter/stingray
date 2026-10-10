import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { cradleHeight } from '../sim/launch';
import { MARINEVILLE, type Interior } from '../sim/world';
import { isInteriorMaterial, oceanInView } from './indoors';
import { DOOR_BORE_RADIUS, DOOR_RING_DEPTH } from './ocean-door';
import { createPen } from './pen';
import { createTunnel } from './tunnel';

// What you see is what you hit, inside Marineville (L6): every vertex of the drawn interior's shell — walls, floor,
// ceiling, the collar of bore behind the pen's tunnel opening — sits on or outside the interior volume (the pen box
// and the drawn bore about the tunnel's centreline), so the hull never visibly passes through a wall it is kept off.
//
// T4 extends it to the tunnel: the bore wall from the back of the ocean door's ring to the pen's south wall, and the
// ring itself (its bore runs through the cliff's slab).

const interior = MARINEVILLE.interior;
const EPSILON = 1e-3;

const pen = createPen(interior);
const tunnel = createTunnel(interior);
const SHELL_ROOTS: THREE.Object3D[] = [pen.hall, tunnel.root];

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

describe('the tunnel shell', () => {
  const line = interior.tunnel.centreline;
  const mouth = line[0]!;
  const end = line[line.length - 1]!;
  const tunnelSamples = shellSamples([tunnel.root]);

  it('runs unbroken from the face, through the door\'s ring, to the pen\'s south wall', () => {
    expect(tunnelSamples.some((p) => p.z > mouth.z)).toBe(true); // the ring's lip on the face
    expect(tunnelSamples.some((p) => Math.abs(p.z - end.z) < EPSILON)).toBe(true); // the bore at the pen wall
    // Every metre along the centreline has wall round it: no gap between the ring and the bore, or along the bore.
    const path = tunnel.path;
    for (let s = 0; s <= path.length; s += 1) {
      const c = path.pointAt(s);
      const seg = path.segmentAt(Math.min(s, path.length - 1e-6));
      const near = tunnelSamples.filter((p) => Math.abs(p.clone().sub(c).dot(seg.dir)) < 4);
      expect(near.length, `wall round s = ${s}`).toBeGreaterThan(8);
    }
  });

  it('opens the ring\'s bore to the tunnel\'s, so the ring is outside the interior volume', () => {
    expect(DOOR_BORE_RADIUS).toBeGreaterThanOrEqual(interior.tunnel.radius);
    const ring = tunnel.door.ring;
    ring.updateMatrixWorld(true);
    const position = ring.geometry.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    let nearest = Infinity;
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(ring.matrixWorld);
      nearest = Math.min(nearest, Math.hypot(v.x - mouth.x, v.y - mouth.y));
    }
    expect(nearest).toBeGreaterThanOrEqual(interior.tunnel.radius);
  });

  it('builds every lit material in the tunnel as an interior one, but the door\'s seaward faces', () => {
    const lit: THREE.Material[] = [];
    tunnel.bore.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      for (const m of [o.material].flat() as THREE.Material[]) {
        if (m instanceof THREE.MeshLambertMaterial || m instanceof THREE.MeshPhongMaterial || m instanceof THREE.MeshStandardMaterial) lit.push(m);
      }
    });
    expect(lit.length).toBeGreaterThan(8);
    expect(lit.filter((m) => !isInteriorMaterial(m) || m.userData.noCaustics !== true).map((m) => m.name)).toEqual([]);
  });

  it('stays within its triangle and draw-call budget', () => {
    let triangles = 0;
    let meshes = 0;
    tunnel.bore.traverse((o) => {
      if (!(o instanceof THREE.Mesh) && !(o instanceof THREE.Points)) return;
      meshes++;
      if (!(o instanceof THREE.Mesh)) return;
      const g = o.geometry as THREE.BufferGeometry;
      triangles += ((g.index ? g.index.count : g.attributes.position!.count) / 3) * (o instanceof THREE.InstancedMesh ? o.count : 1);
    });
    expect(triangles).toBeLessThan(60_000);
    expect(meshes).toBeLessThanOrEqual(20);
  });
});

describe('tunnel culling (L6)', () => {
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.5, 8000);
  const mouth = interior.tunnel.centreline[0]!;
  const lights = () => {
    const found: THREE.Light[] = [];
    tunnel.root.traverse((o) => { if (o instanceof THREE.Light) found.push(o); });
    return found;
  };
  const view = (x: number, y: number, z: number, door: number) => {
    camera.position.set(x, y, z);
    camera.lookAt(mouth.x, mouth.y, mouth.z);
    camera.updateMatrixWorld();
    tunnel.update(camera, { door, doorMoving: false }, 0);
    return tunnel.bore.visible;
  };

  it('is not drawn far out at sea, nor at sea with the door shut', () => {
    expect(view(0, -40, 0, 1)).toBe(false);
    expect(view(0, -40, mouth.z + 60, 0)).toBe(false);
    expect(lights().every((l) => l.intensity === 0)).toBe(true);
  });

  it('is drawn from inside, and from the sea through a door that is not shut', () => {
    expect(view(0, -40, mouth.z + 60, 0.05)).toBe(true);
    expect(view(0, -40, mouth.z + 60, 1)).toBe(true);
    expect(view(0, -35, mouth.z - 40, 0)).toBe(true); // the door chamber
    expect(view(0, -10, -1390, 0)).toBe(true); // the pool, looking into the tunnel
    expect(lights().some((l) => l.intensity > 0)).toBe(true);
  });

  it('keeps the same lights in the scene whatever it shows (no material recompiles)', () => {
    view(0, -40, 0, 0);
    const before = lights().length;
    view(0, -35, mouth.z - 40, 1);
    expect(lights().length).toBe(before);
  });
});

describe('the ocean side from inside (T6)', () => {
  const mouth = interior.tunnel.centreline[0]!;
  const last = interior.tunnel.centreline[interior.tunnel.centreline.length - 1]!;
  const places: Array<[string, THREE.Vector3]> = [
    ['the door chamber', new THREE.Vector3(0, -35, mouth.z - 40)],
    ['the incline, mid-bore', new THREE.Vector3(6, -30, -1255)], // phase 4 D6: the straight bore, 6 m off its axis
    ['the bore\'s last metres', new THREE.Vector3(last.x, last.y, last.z + 3)],
    ['the pen, on the walkway', new THREE.Vector3(27, 8.6, -1391)],
    ['the pool', new THREE.Vector3(0, -10, -1390)],
  ];

  it('is never drawn inside behind a shut door, and always drawn through one that is not shut', () => {
    for (const [name, p] of places) {
      expect(oceanInView(p, 0), name).toBe(false);
      expect(oceanInView(p, 0.001), name).toBe(true);
      expect(oceanInView(p, 1), name).toBe(true);
    }
  });

  it('is always drawn from outside, door shut or not', () => {
    for (const p of [new THREE.Vector3(0, -40, mouth.z + 0.5), new THREE.Vector3(0, -40, 0), new THREE.Vector3(300, 20, -900)]) {
      expect(oceanInView(p, 0)).toBe(true);
      expect(oceanInView(p, 1)).toBe(true);
    }
  });

  it('the straight bore shows the door from the pen (phase 4 D6): sightlines from the bore\'s end and the lowered cradle to the door\'s opening stay inside the bore', () => {
    // The launch's reveal: with the S-bend gone the door is the view from the cradle. Sampled on straight lines from
    // camera places at the pen's end of the tunnel to the door's centre and round a 6 m circle of its opening: every
    // point on them south of the pen's wall (and short of the door's ring in the slab) is inside the drawn bore.
    const line = interior.tunnel.centreline;
    const distanceToCentreline = (p: THREE.Vector3) => {
      let best = Infinity;
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const q = new THREE.Vector3();
      for (let k = 1; k < line.length; k++) {
        a.set(line[k - 1]!.x, line[k - 1]!.y, line[k - 1]!.z);
        b.set(line[k]!.x, line[k]!.y, line[k]!.z);
        new THREE.Line3(a, b).closestPointToPoint(p, true, q);
        best = Math.min(best, q.distanceTo(p));
      }
      return best;
    };
    const froms = [
      new THREE.Vector3(last.x, last.y, last.z + 3), // the bore's last metres
      new THREE.Vector3(0, interior.cradle.loweredY, interior.cradle.pos.z), // Stingray on the lowered cradle
      new THREE.Vector3(0, interior.cradle.loweredY + 2, interior.cradle.pos.z + 14), // the pen camera behind and above her
    ];
    const tos = [new THREE.Vector3(mouth.x, mouth.y, mouth.z)];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      tos.push(new THREE.Vector3(mouth.x + 6 * Math.cos(a), mouth.y + 6 * Math.sin(a), mouth.z));
    }
    const p = new THREE.Vector3();
    let checked = 0;
    for (const from of froms) {
      for (const to of tos) {
        for (let i = 1; i < 400; i++) {
          p.lerpVectors(from, to, i / 400);
          if (p.z < interior.pen.max.z) continue; // in the hall: open
          if (p.z > mouth.z - DOOR_RING_DEPTH) break; // the door's ring through the cliff's slab
          expect(distanceToCentreline(p)).toBeLessThan(interior.tunnel.radius);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});
