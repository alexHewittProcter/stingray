import * as THREE from 'three';
import type { World } from '../sim/world';
import { hash3, mulberry32 } from './random';

// The seabed as the series dressed it: grey-blue crags under a dense, colourful cover of plants.
// The mesh is sampled from the same seabedHeight() the collision uses.

const SEGMENTS = 320;
const MOSS = new THREE.Color(0x5d7a34);
const OCHRE = new THREE.Color(0xa08a3c);
const ROCK = new THREE.Color(0x5a6b82);
const DEEP = new THREE.Color(0x27384f);

export function createSeabed(world: World): THREE.Group {
  const group = new THREE.Group();
  const size = world.bounds.halfSize * 2 + 600;

  const geometry = new THREE.PlaneGeometry(size, size, SEGMENTS, SEGMENTS);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const c = new THREE.Color();
  const step = size / SEGMENTS;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const y = world.seabedHeight(x, z);
    position.setY(i, y);

    // Steep ground shows bare rock; flatter ground carries moss and ochre weed; the trench goes dark.
    const slope = Math.hypot(world.seabedHeight(x + step, z) - y, world.seabedHeight(x, z + step) - y) / step;
    const patch = hash3(Math.floor(x / 45), 0, Math.floor(z / 45));
    c.copy(patch < 0.55 ? MOSS : OCHRE).lerp(ROCK, Math.min(slope * 2.2, 1));
    c.lerp(DEEP, THREE.MathUtils.clamp((-y - 120) / 160, 0, 0.85));
    c.multiplyScalar(0.85 + 0.3 * hash3(x, y, z));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  group.add(new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));

  group.add(dressing(world));
  return group;
}

// ---- Scattered rocks and plants (instanced, never solid, all lower than the hull's bed clearance) ----

const DRESS_CENTRE = { x: 0, z: -620 };
const DRESS_RADIUS = 1150;
const PLANT_COLORS = [0x6f8f2f, 0x8a9a35, 0xb89a3a, 0xd2622f, 0xc7453a, 0x3fb7a8, 0x58c2c9, 0x7da33a];

function scatter(world: World, count: number, rand: () => number, place: (x: number, y: number, z: number, i: number) => void): void {
  for (let i = 0; i < count; i++) {
    const r = DRESS_RADIUS * Math.sqrt(rand());
    const a = rand() * Math.PI * 2;
    const x = DRESS_CENTRE.x + r * Math.cos(a);
    const z = Math.max(DRESS_CENTRE.z + r * Math.sin(a), -1090);
    place(x, world.seabedHeight(x, z), z, i);
  }
}

function dressing(world: World): THREE.Group {
  const group = new THREE.Group();
  const rand = mulberry32(world.seed ^ 0x51ab);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const tint = new THREE.Color();

  const ROCKS = 2600;
  const rocks = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
    ROCKS,
  );
  scatter(world, ROCKS, rand, (x, y, z, i) => {
    const w = 1.2 + rand() * 3.2;
    s.set(w, 0.8 + rand() * 2.2, w * (0.6 + rand() * 0.8));
    q.setFromEuler(e.set(rand() * 0.6, rand() * Math.PI * 2, rand() * 0.6));
    rocks.setMatrixAt(i, m.compose(p.set(x, y + s.y * 0.2, z), q, s));
    rocks.setColorAt(i, tint.setHSL(0.6 + rand() * 0.05, 0.16 + rand() * 0.1, 0.3 + rand() * 0.18));
  });
  group.add(rocks);

  // Bushy plants: squashed low-poly blobs in the series' ochres, greens, corals and turquoises.
  const PLANTS = 9000;
  const plants = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
    PLANTS,
  );
  scatter(world, PLANTS, rand, (x, y, z, i) => {
    const w = 0.9 + rand() * 2.6;
    s.set(w, 1.1 + rand() * 2.2, w);
    q.setFromEuler(e.set(0, rand() * Math.PI * 2, 0));
    plants.setMatrixAt(i, m.compose(p.set(x, y + s.y * 0.35, z), q, s));
    const base = PLANT_COLORS[Math.floor(rand() * PLANT_COLORS.length)] ?? 0x6f8f2f;
    plants.setColorAt(i, tint.setHex(base).multiplyScalar(0.8 + rand() * 0.4));
  });
  group.add(plants);

  // Fronds: thin upright cones that read as weed at a distance.
  const FRONDS = 4200;
  const fronds = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.35, 1, 5),
    new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
    FRONDS,
  );
  scatter(world, FRONDS, rand, (x, y, z, i) => {
    const h = 1.5 + rand() * 2.4;
    s.set(1 + rand(), h, 1 + rand());
    q.setFromEuler(e.set((rand() - 0.5) * 0.4, rand() * Math.PI * 2, (rand() - 0.5) * 0.4));
    fronds.setMatrixAt(i, m.compose(p.set(x, y + h / 2, z), q, s));
    fronds.setColorAt(i, tint.setHSL(0.24 + rand() * 0.2, 0.55, 0.3 + rand() * 0.2));
  });
  group.add(fronds);

  return group;
}
