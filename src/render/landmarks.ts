import * as THREE from 'three';
import { ARCH, CLIFF_TOP, COAST_Z, type Collider, type World } from '../sim/world';
import { hash3, mulberry32 } from './random';

// Landmark scenery. Solid shapes are drawn inside their colliders, so what you see is what you hit.

const ROCK_COLOR = new THREE.Color(0x66707c);
const ROCK_MOSS = new THREE.Color(0x56703a);

/** A craggy rock filling a box collider: a subdivided box with its faces eroded inward. */
function rockBox(c: Extract<Collider, { kind: 'box' }>, erosion = 0.16): THREE.Mesh {
  const w = c.max.x - c.min.x;
  const h = c.max.y - c.min.y;
  const d = c.max.z - c.min.z;
  const geometry = new THREE.BoxGeometry(w, h, d, Math.ceil(w / 6), Math.ceil(h / 6), Math.ceil(d / 6));
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    // Erode by a noise that depends only on position, so coincident vertices stay welded.
    const n = hash3(Math.round(x), Math.round(y), Math.round(z));
    const k = 1 - erosion * n;
    position.setXYZ(i, x * k, y, z * k);
    col.copy(ROCK_COLOR).lerp(ROCK_MOSS, hash3(Math.round(x / 8), Math.round(y / 10), Math.round(z / 8)) * 0.7);
    col.multiplyScalar(0.75 + 0.5 * n);
    colors.set([col.r, col.g, col.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.position.set((c.min.x + c.max.x) / 2, (c.min.y + c.max.y) / 2, (c.min.z + c.max.z) / 2);
  return mesh;
}

function landmark(world: World, id: string) {
  const found = world.landmarks.find((l) => l.id === id);
  if (!found) throw new Error(`landmark missing: ${id}`);
  return found;
}

const boxes = (colliders: readonly Collider[]) =>
  colliders.filter((c): c is Extract<Collider, { kind: 'box' }> => c.kind === 'box');

// ---- The Marineville cliff and the ocean door ----

const CLIFF_DEPTH = 420;
const FLUTE_DEPTH = 12; // m the flutes are cut back (north) from the collider face

function cliff(world: World): THREE.Group {
  const group = new THREE.Group();
  const width = world.bounds.halfSize * 2 + 200;
  const height = CLIFF_TOP + CLIFF_DEPTH;
  const geometry = new THREE.PlaneGeometry(width, height, 520, 24);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    // Vertical flutes, as on the series' rock face: columns of varying depth, roughened along their height.
    const column = hash3(Math.floor(x / 9), 1, 0);
    const cut = FLUTE_DEPTH * (0.25 + 0.75 * column) * (0.7 + 0.3 * hash3(Math.floor(x / 9), Math.floor(y / 30), 2));
    position.setZ(i, -cut);
    col.setHex(0x6c7466).lerp(new THREE.Color(0x4d5a3e), hash3(Math.floor(x / 20), Math.floor(y / 25), 5) * 0.8);
    col.multiplyScalar(0.55 + 0.6 * (1 - cut / FLUTE_DEPTH) + 0.15 * hash3(x, y, 9));
    colors.set([col.r, col.g, col.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const face = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  face.position.set(0, CLIFF_TOP - height / 2, COAST_Z);
  group.add(face);

  // The land on top, running north out of sight.
  const top = new THREE.Mesh(
    new THREE.PlaneGeometry(width, 700),
    new THREE.MeshLambertMaterial({ color: 0x7c9a58 }),
  );
  top.rotation.x = -Math.PI / 2;
  top.position.set(0, CLIFF_TOP, COAST_Z - 350);
  group.add(top);

  group.add(oceanDoor(world));
  return group;
}

// The series' ocean door: a round steel port set in the rock, shut by a domed door.
function oceanDoor(world: World): THREE.Group {
  const group = new THREE.Group();
  const steel = new THREE.MeshPhongMaterial({ color: 0x9aa3a8, specular: 0xffffff, shininess: 60 });
  const dark = new THREE.MeshPhongMaterial({ color: 0x6f6a72, specular: 0xaabbcc, shininess: 40 });

  const ring = new THREE.Mesh(new THREE.TorusGeometry(13, 3, 14, 48), steel);
  group.add(ring);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(13, 14.5, 3, 48, 1, true), steel);
  collar.rotation.x = Math.PI / 2;
  collar.position.z = -1.5;
  group.add(collar);
  // The door: a shallow dome bulging seaward, split by a seam like the series' two-leaf door.
  const dome = new THREE.Mesh(new THREE.SphereGeometry(12.2, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), dark);
  dome.rotation.x = Math.PI / 2;
  dome.scale.set(1, 0.28, 1);
  dome.position.z = -1.2;
  group.add(dome);
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 24, 0.6), steel);
  seam.position.z = 2.1;
  group.add(seam);

  // A beacon either side, so the way home shows through the murk.
  for (const side of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe9a0 }));
    lamp.position.set(side * 19, 0, 1);
    group.add(lamp);
  }

  const m = world.marineville.tunnelMouth;
  group.position.set(m.x, m.y, m.z + 0.5);
  return group;
}

// ---- Arch, stacks, wreck, kelp ----

function arch(world: World): THREE.Group {
  const group = new THREE.Group();
  for (const c of boxes(landmark(world, 'arch').colliders)) group.add(rockBox(c, 0.1));
  // Weed hanging under the lintel marks the opening from a distance.
  const weed = new THREE.Mesh(
    new THREE.ConeGeometry(1.2, 9, 5),
    new THREE.MeshLambertMaterial({ color: 0x3fb7a8, flatShading: true }),
  );
  const floor = world.seabedHeight(ARCH.x, ARCH.z);
  for (let i = -2; i <= 2; i++) {
    const w = weed.clone();
    w.rotation.x = Math.PI;
    w.position.set(ARCH.x + i * 5.5, floor + ARCH.openingHeight - 4.5, ARCH.z);
    group.add(w);
  }
  return group;
}

function stacks(world: World): THREE.Group {
  const group = new THREE.Group();
  for (const c of boxes(landmark(world, 'stacks').colliders)) group.add(rockBox(c, 0.3));
  return group;
}

function wreck(world: World): THREE.Group {
  const group = new THREE.Group();
  const l = landmark(world, 'wreck');
  const rust = new THREE.MeshLambertMaterial({ color: 0x7a4a32, flatShading: true });
  const hull = new THREE.Mesh(new THREE.CapsuleGeometry(6.5, 46, 6, 14), rust);
  hull.rotation.z = Math.PI / 2;
  hull.rotation.x = 0.12;
  hull.scale.set(1, 1, 0.95);
  hull.position.set(l.pos.x, l.pos.y + 3.5, l.pos.z);
  group.add(hull);
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4, 11, 10), rust);
  tower.position.set(l.pos.x + 10, l.pos.y + 13, l.pos.z);
  tower.rotation.z = -0.1;
  group.add(tower);
  const band = new THREE.Mesh(new THREE.TorusGeometry(6.7, 0.5, 6, 20), new THREE.MeshLambertMaterial({ color: 0x3f4c44 }));
  band.rotation.y = Math.PI / 2;
  band.position.set(l.pos.x - 12, l.pos.y + 3.5, l.pos.z);
  group.add(band);
  return group;
}

function kelp(world: World): THREE.InstancedMesh {
  const l = landmark(world, 'kelp');
  const rand = mulberry32(world.seed ^ 0x6e1f);
  const COUNT = 420;
  const geometry = new THREE.ConeGeometry(0.9, 1, 5);
  geometry.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), COUNT);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const tint = new THREE.Color();
  for (let i = 0; i < COUNT; i++) {
    const r = 95 * Math.sqrt(rand());
    const a = rand() * Math.PI * 2;
    const x = l.pos.x + r * Math.cos(a);
    const z = l.pos.z + r * Math.sin(a);
    const h = 14 + rand() * 30;
    s.set(1 + rand(), h, 1 + rand());
    q.setFromEuler(e.set((rand() - 0.5) * 0.25, rand() * Math.PI * 2, (rand() - 0.5) * 0.25));
    mesh.setMatrixAt(i, m.compose(p.set(x, world.seabedHeight(x, z), z), q, s));
    mesh.setColorAt(i, tint.setHSL(0.27 + rand() * 0.12, 0.6, 0.22 + rand() * 0.16));
  }
  return mesh;
}

export function createLandmarks(world: World): THREE.Group {
  const group = new THREE.Group();
  group.add(cliff(world), arch(world), stacks(world), wreck(world), kelp(world));
  return group;
}

